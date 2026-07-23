/* KaayPrint PWA v16 — assets statiques seulement (pas d'API ni shell /app/ authentifié) */
const STATIC_CACHE = 'kaayprint-static-v16';

const PRECACHE_URLS = [
    '/static/css/style.css',
    '/static/js/xaliss-offline.js',
    '/static/js/xaliss-flash.js',
    '/static/js/script.js',
    '/static/js/django-bridge.js',
    '/static/js/pwa.js',
    '/static/images/favicon.png',
    '/static/images/logo.png',
    '/static/manifest.webmanifest',
    '/static/offline.html',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js',
    'https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js',
];

/** Anciens caches sensibles (api / shell) détectés via isSensitiveCacheName. */
function isSensitiveCacheName(name) {
    const key = String(name || '');
    if (key.indexOf('kaayprint-api-') === 0 || key.indexOf('kaayprint-shell-') === 0) {
        return true;
    }
    if (key.indexOf('xaliss-api-') === 0 || key.indexOf('xaliss-shell-') === 0) {
        return true;
    }
    return false;
}

function isAuthOrPrivatePath(url) {
    return url.pathname.startsWith('/auth/')
        || url.pathname.startsWith('/admin/')
        || url.pathname === '/connexion/'
        || url.pathname === '/deconnexion/'
        || url.pathname === '/inscription/'
        || url.pathname === '/completer-inscription/'
        || url.pathname.indexOf('/app/api/') === 0
        || url.pathname === '/app'
        || url.pathname.indexOf('/app/') === 0;
}

function isStaticAsset(url) {
    return url.pathname.startsWith('/static/');
}

function staleWhileRevalidate(request, cacheName) {
    return caches.open(cacheName).then(function (cache) {
        return cache.match(request).then(function (cached) {
            const networkFetch = fetch(request).then(function (response) {
                if (response && response.status === 200) {
                    cache.put(request, response.clone());
                }
                return response;
            }).catch(function () { return cached; });
            return cached || networkFetch;
        });
    });
}

function clearSensitiveCaches() {
    return caches.keys().then(function (keys) {
        return Promise.all(
            keys.filter(isSensitiveCacheName).map(function (key) {
                return caches.delete(key);
            })
        );
    });
}

function deleteObsoleteCaches() {
    return caches.keys().then(function (keys) {
        return Promise.all(
            keys.filter(function (key) {
                if (key === STATIC_CACHE) return false;
                // Tout sauf le cache static courant : inclut anciens static + api + shell.
                return true;
            }).map(function (key) {
                return caches.delete(key);
            })
        );
    });
}

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(STATIC_CACHE).then(function (cache) {
            return cache.addAll(PRECACHE_URLS);
        }).then(function () {
            return self.skipWaiting();
        })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        deleteObsoleteCaches()
            .then(function () { return clearSensitiveCaches(); })
            .then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('message', function (event) {
    const data = event.data;
    const type = data && typeof data === 'object' ? data.type : data;
    if (type === 'CLEAR_SENSITIVE_CACHES' || type === 'PURGE_CACHES') {
        event.waitUntil(clearSensitiveCaches().then(deleteObsoleteCaches));
    }
});

self.addEventListener('fetch', function (event) {
    if (event.request.method !== 'GET') {
        return;
    }

    const url = new URL(event.request.url);
    const sameOrigin = url.origin === self.location.origin;
    const isCdnPrecache = PRECACHE_URLS.includes(event.request.url);

    if (!sameOrigin && !isCdnPrecache) {
        return;
    }

    // Jamais intercepter / cacher : API, shell /app/, auth.
    // Hors ligne : le bridge utilise IndexedDB ; navigation → offline.html uniquement.
    if (sameOrigin && isAuthOrPrivatePath(url)) {
        const isNavigate = event.request.mode === 'navigate'
            || (event.request.headers.get('accept') || '').indexOf('text/html') !== -1;
        if (isNavigate && (url.pathname === '/app' || url.pathname.indexOf('/app/') === 0)) {
            event.respondWith(
                fetch(event.request).catch(function () {
                    return caches.match('/static/offline.html');
                })
            );
        }
        // API et autres chemins privés : réseau navigateur natif (pas de cache SW).
        return;
    }

    if (event.request.mode === 'navigate'
        || (event.request.headers.get('accept') || '').includes('text/html')) {
        event.respondWith(
            fetch(event.request).catch(function () {
                return caches.match('/static/offline.html');
            })
        );
        return;
    }

    if (isStaticAsset(url) || isCdnPrecache) {
        event.respondWith(staleWhileRevalidate(event.request, STATIC_CACHE));
    }
});
