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

    async function enqueue(item) {
        const db = await openDb();
        const entry = {
            orgKey: orgKey,
            method: item.method,
            path: item.path,
            body: item.body || null,
            label: item.label || '',
            createdAt: new Date().toISOString(),
        };
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE_OUTBOX, 'readwrite');
            const request = tx.objectStore(STORE_OUTBOX).add(entry);
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
    }

    async function listOutbox() {
        const db = await openDb();
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE_OUTBOX, 'readonly');
            const store = tx.objectStore(STORE_OUTBOX);
            const index = store.index('orgKey');
            const request = index.getAll(orgKey);
            request.onsuccess = function () {
                const items = (request.result || []).sort(function (a, b) {
                    return String(a.createdAt).localeCompare(String(b.createdAt));
                });
                resolve(items);
            };
            request.onerror = function () { reject(request.error); };
        });
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

    async function countOutbox() {
        const items = await listOutbox();
        return items.length;
    }

    async function clearOutbox() {
        const items = await listOutbox();
        for (let i = 0; i < items.length; i++) {
            await removeOutboxItem(items[i].id);
        }
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
        removeOutboxItem: removeOutboxItem,
        countOutbox: countOutbox,
        clearOutbox: clearOutbox,
        getSnapshotResponse: getSnapshotResponse,
    };
})(window);
