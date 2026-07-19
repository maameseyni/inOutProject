/* KaayPrint PWA v2 — shell rapide, stale-while-revalidate, cache API lecture */
const STATIC_CACHE = 'kaayprint-static-v2';
const SHELL_CACHE = 'kaayprint-shell-v2';
const API_CACHE = 'kaayprint-api-v2';

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
];

const API_GET_PREFIXES = [
    '/app/api/transactions/',
    '/app/api/clients/',
    '/app/api/organisation/profil/',
    '/app/api/sync/',
];

function isAuthOrWriteApi(url) {
    return url.pathname.startsWith('/auth/')
        || url.pathname.startsWith('/admin/')
        || url.pathname === '/connexion/'
        || url.pathname === '/deconnexion/'
        || url.pathname === '/inscription/'
        || url.pathname === '/completer-inscription/'
        || url.pathname.indexOf('/app/api/evenements') !== -1
        || url.pathname.indexOf('/app/api/verrous') !== -1;
}

function isApiGetCacheable(url) {
    if (!url.pathname.startsWith('/app/api/')) return false;
    return API_GET_PREFIXES.some(function (prefix) {
        return url.pathname === prefix || url.pathname.startsWith(prefix);
    });
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
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (key) {
                    return key !== STATIC_CACHE && key !== SHELL_CACHE && key !== API_CACHE;
                }).map(function (key) { return caches.delete(key); })
            );
        }).then(function () {
            return self.clients.claim();
        })
    );
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

    if (isAuthOrWriteApi(url)) {
        return;
    }

    if (isApiGetCacheable(url)) {
        event.respondWith(
            fetch(event.request).then(function (response) {
                if (response && response.status === 200) {
                    const copy = response.clone();
                    caches.open(API_CACHE).then(function (cache) {
                        cache.put(event.request, copy);
                    });
                }
                return response;
            }).catch(function () {
                return caches.match(event.request);
            })
        );
        return;
    }

    if (event.request.mode === 'navigate' || (event.request.headers.get('accept') || '').includes('text/html')) {
        event.respondWith(
            fetch(event.request).then(function (response) {
                if (response && response.status === 200 && url.pathname.indexOf('/app') === 0) {
                    const copy = response.clone();
                    caches.open(SHELL_CACHE).then(function (cache) {
                        cache.put(event.request, copy);
                    });
                }
                return response;
            }).catch(function () {
                return caches.match(event.request).then(function (cached) {
                    return cached || caches.match('/app/') || caches.match('/static/offline.html');
                });
            })
        );
        return;
    }

    if (isStaticAsset(url) || isCdnPrecache) {
        event.respondWith(staleWhileRevalidate(event.request, STATIC_CACHE));
    }
});
