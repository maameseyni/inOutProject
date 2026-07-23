/**
 * Xaliss PWA — IndexedDB : snapshot lecture hors ligne + file de synchronisation
 */
(function (global) {
    const DB_NAME = 'xaliss-pwa';
    const DB_VERSION = 1;
    const STORE_SNAPSHOT = 'snapshots';
    const STORE_OUTBOX = 'outbox';

    let dbPromise = null;
    let orgKey = 'default';

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve, reject) {
            if (!global.indexedDB) {
                reject(new Error('IndexedDB indisponible'));
                return;
            }
            const request = global.indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = function (event) {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_SNAPSHOT)) {
                    db.createObjectStore(STORE_SNAPSHOT);
                }
                if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
                    const outbox = db.createObjectStore(STORE_OUTBOX, {
                        keyPath: 'id',
                        autoIncrement: true,
                    });
                    outbox.createIndex('orgKey', 'orgKey', { unique: false });
                }
            };
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
        return dbPromise;
    }

    function init(orgSlug) {
        orgKey = orgSlug || 'default';
        return openDb();
    }

    function isOnline() {
        return global.navigator.onLine !== false;
    }

    async function saveSnapshot(data) {
        const db = await openDb();
        const payload = {
            orgKey: orgKey,
            transactions: data.transactions || [],
            clients: data.clients || [],
            notes: data.notes || [],
            categories: data.categories || [],
            profil: data.profil || null,
            syncSeq: data.syncSeq != null ? data.syncSeq : null,
            cachedAt: new Date().toISOString(),
        };
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE_SNAPSHOT, 'readwrite');
            tx.objectStore(STORE_SNAPSHOT).put(payload, orgKey);
            tx.oncomplete = function () { resolve(payload); };
            tx.onerror = function () { reject(tx.error); };
        });
    }

    async function loadSnapshot() {
        const db = await openDb();
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE_SNAPSHOT, 'readonly');
            const request = tx.objectStore(STORE_SNAPSHOT).get(orgKey);
            request.onsuccess = function () { resolve(request.result || null); };
            request.onerror = function () { reject(request.error); };
        });
    }

    function normalizeOutboxStatus(status) {
        return status === 'conflict' ? 'conflict' : 'pending';
    }

    async function enqueue(item) {
        const db = await openDb();
        const entry = {
            orgKey: orgKey,
            method: item.method,
            path: item.path,
            body: item.body || null,
            label: item.label || '',
            status: 'pending',
            createdAt: new Date().toISOString(),
            conflictAt: null,
            conflictMessage: '',
            conflictData: null,
        };
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE_OUTBOX, 'readwrite');
            const request = tx.objectStore(STORE_OUTBOX).add(entry);
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
    }

    async function listOutbox(filter) {
        const statusFilter = filter && filter.status ? normalizeOutboxStatus(filter.status) : null;
        const db = await openDb();
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE_OUTBOX, 'readonly');
            const store = tx.objectStore(STORE_OUTBOX);
            const index = store.index('orgKey');
            const request = index.getAll(orgKey);
            request.onsuccess = function () {
                let items = (request.result || []).map(function (item) {
                    if (!item.status) item.status = 'pending';
                    return item;
                });
                if (statusFilter) {
                    items = items.filter(function (item) {
                        return normalizeOutboxStatus(item.status) === statusFilter;
                    });
                }
                items.sort(function (a, b) {
                    return String(a.createdAt).localeCompare(String(b.createdAt));
                });
                resolve(items);
            };
            request.onerror = function () { reject(request.error); };
        });
    }

    async function getOutboxItem(id) {
        const db = await openDb();
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE_OUTBOX, 'readonly');
            const request = tx.objectStore(STORE_OUTBOX).get(id);
            request.onsuccess = function () { resolve(request.result || null); };
            request.onerror = function () { reject(request.error); };
        });
    }

    async function updateOutboxItem(id, patch) {
        const db = await openDb();
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE_OUTBOX, 'readwrite');
            const store = tx.objectStore(STORE_OUTBOX);
            const getReq = store.get(id);
            getReq.onsuccess = function () {
                const current = getReq.result;
                if (!current) {
                    resolve(null);
                    return;
                }
                const next = Object.assign({}, current, patch || {}, { id: current.id, orgKey: current.orgKey });
                if (next.status) next.status = normalizeOutboxStatus(next.status);
                store.put(next);
            };
            tx.oncomplete = function () { resolve(true); };
            tx.onerror = function () { reject(tx.error); };
        });
    }

    async function markOutboxConflict(id, info) {
        const meta = info || {};
        return updateOutboxItem(id, {
            status: 'conflict',
            conflictAt: new Date().toISOString(),
            conflictMessage: meta.message || '',
            conflictData: meta.data != null ? meta.data : null,
        });
    }

    async function requeueOutboxItem(id, bodyOverride) {
        const patch = {
            status: 'pending',
            conflictAt: null,
            conflictMessage: '',
            conflictData: null,
        };
        if (bodyOverride !== undefined) {
            patch.body = bodyOverride;
        }
        return updateOutboxItem(id, patch);
    }

    async function removeOutboxItem(id) {
        const db = await openDb();
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE_OUTBOX, 'readwrite');
            tx.objectStore(STORE_OUTBOX).delete(id);
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
        });
    }

    async function countOutbox(filter) {
        const items = await listOutbox(filter);
        return items.length;
    }

    async function clearOutbox() {
        const items = await listOutbox();
        for (let i = 0; i < items.length; i++) {
            await removeOutboxItem(items[i].id);
        }
    }

    /**
     * Prépare un body JSON pour forcer l'écrasement serveur (ignore le verrou optimiste).
     */
    function prepareForceSyncBody(body) {
        if (body == null || body === '') return body;
        let parsed = body;
        if (typeof body === 'string') {
            try {
                parsed = JSON.parse(body);
            } catch (e) {
                return body;
            }
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return typeof body === 'string' ? body : JSON.stringify(body);
        }
        const next = Object.assign({}, parsed);
        delete next.updatedAt;
        return JSON.stringify(next);
    }

    async function clearSnapshot() {
        const db = await openDb();
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE_SNAPSHOT, 'readwrite');
            tx.objectStore(STORE_SNAPSHOT).delete(orgKey);
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
        });
    }

    function clearPrefixedStorage(storage, prefixes, keepExact) {
        if (!storage) return;
        const keep = keepExact || {};
        const toRemove = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (!key || keep[key]) continue;
            for (let p = 0; p < prefixes.length; p++) {
                if (key === prefixes[p] || key.indexOf(prefixes[p]) === 0) {
                    toRemove.push(key);
                    break;
                }
            }
        }
        toRemove.forEach(function (key) {
            storage.removeItem(key);
        });
    }

    async function clearCacheStorage() {
        if (!global.caches || !global.caches.keys) return;
        try {
            const keys = await global.caches.keys();
            await Promise.all(keys.filter(function (key) {
                return key.indexOf('kaayprint-') === 0 || key.indexOf('xaliss-') === 0;
            }).map(function (key) {
                return global.caches.delete(key);
            }));
        } catch (e) {
            /* ignore */
        }
    }

    async function deleteDatabase() {
        try {
            if (dbPromise) {
                const db = await dbPromise;
                try { db.close(); } catch (e) { /* ignore */ }
            }
        } catch (e) {
            /* ignore */
        }
        dbPromise = null;
        if (!global.indexedDB) return;
        return new Promise(function (resolve) {
            const request = global.indexedDB.deleteDatabase(DB_NAME);
            request.onsuccess = function () { resolve(); };
            request.onerror = function () { resolve(); };
            request.onblocked = function () { resolve(); };
        });
    }

    async function notifyServiceWorkerPurge() {
        if (!global.navigator || !global.navigator.serviceWorker) return;
        try {
            const reg = await global.navigator.serviceWorker.getRegistration();
            const worker = (reg && (reg.active || reg.waiting || reg.installing))
                || global.navigator.serviceWorker.controller;
            if (worker) {
                worker.postMessage({ type: 'CLEAR_SENSITIVE_CACHES' });
            }
        } catch (e) {
            /* ignore */
        }
    }

    /**
     * Purge données sensibles côté client (logout / changement de compte).
     * Conserve les préférences UI non financières (ex. sidebar repliée).
     */
    async function purgeSensitiveClientData() {
        clearPrefixedStorage(global.localStorage, ['kaayprint_', 'xaliss_'], {
            kaayprint_sidebar_collapsed: true,
        });
        clearPrefixedStorage(global.sessionStorage, ['kaayprint_', 'xaliss_'], {});
        await notifyServiceWorkerPurge();
        await clearCacheStorage();
        await deleteDatabase();
    }

    function getSnapshotResponse(path, snapshot) {
        if (!snapshot) return null;
        const p = path.split('?')[0];
        if (p === '/transactions/' || p.endsWith('/transactions/')) {
            return { transactions: snapshot.transactions || [] };
        }
        if (p === '/clients/' || p.endsWith('/clients/')) {
            return { clients: snapshot.clients || [] };
        }
        if (p === '/notes/' || p.endsWith('/notes/')) {
            return { notes: snapshot.notes || [] };
        }
        if (p === '/categories/' || p.endsWith('/categories/')) {
            return { categories: snapshot.categories || [] };
        }
        if (p.indexOf('/organisation/profil') !== -1) {
            return { profil: snapshot.profil || {} };
        }
        if (p === '/sync/' || p.endsWith('/sync/')) {
            return { syncSeq: snapshot.syncSeq || 0 };
        }
        if (p === '/verrous/' || p.endsWith('/verrous/')) {
            return { verrous: [] };
        }
        return null;
    }

    global.XalissOffline = {
        init: init,
        isOnline: isOnline,
        saveSnapshot: saveSnapshot,
        loadSnapshot: loadSnapshot,
        enqueue: enqueue,
        listOutbox: listOutbox,
        getOutboxItem: getOutboxItem,
        updateOutboxItem: updateOutboxItem,
        markOutboxConflict: markOutboxConflict,
        requeueOutboxItem: requeueOutboxItem,
        removeOutboxItem: removeOutboxItem,
        countOutbox: countOutbox,
        clearOutbox: clearOutbox,
        clearSnapshot: clearSnapshot,
        purgeSensitiveClientData: purgeSensitiveClientData,
        getSnapshotResponse: getSnapshotResponse,
        prepareForceSyncBody: prepareForceSyncBody,
        normalizeOutboxStatus: normalizeOutboxStatus,
    };
})(window);
