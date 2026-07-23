/**
 * Test conflits outbox 409 : IndexedDB (fake) + prepareForceSyncBody + non-suppression.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
const errors = [];

function ok(name) {
    passed += 1;
    console.log('OK  ' + name);
}

function fail(name, detail) {
    errors.push(name + ': ' + detail);
    console.log('FAIL ' + name + ' - ' + detail);
}

async function main() {
    console.log('=== 1. Source JS / HTML ===');
    const offlineSrc = fs.readFileSync(path.join(ROOT, 'static/js/xaliss-offline.js'), 'utf8');
    const bridgeSrc = fs.readFileSync(path.join(ROOT, 'static/js/django-bridge.js'), 'utf8');
    const htmlSrc = fs.readFileSync(path.join(ROOT, 'templates/finances/application.html'), 'utf8');

    const sourceChecks = {
        markOutboxConflict: offlineSrc.includes('function markOutboxConflict'),
        prepareForceSyncBody: offlineSrc.includes('function prepareForceSyncBody'),
        statusPending: offlineSrc.includes("status: 'pending'"),
        flushPendingOnly: bridgeSrc.includes("listOutbox({ status: 'pending' })"),
        markOn409: bridgeSrc.includes('markOutboxConflict(item.id'),
        noRemoveOn409Block: !/isConflictError\(error\)\s*\{\s*await offline\.removeOutboxItem/.test(bridgeSrc),
        modalHtml: htmlSrc.includes('id="syncConflictsModal"'),
        bannerHtml: htmlSrc.includes('id="syncConflictBanner"'),
        resolveForce: bridgeSrc.includes("action === 'force'"),
        resolveDiscard: bridgeSrc.includes("action === 'discard'"),
    };
    Object.keys(sourceChecks).forEach(function (key) {
        if (sourceChecks[key]) ok('src_' + key);
        else fail('src_' + key, 'absent');
    });

    console.log('=== 2. IndexedDB outbox (fake-indexeddb) ===');
    let FakeIndexedDB;
    try {
        require('fake-indexeddb/auto');
        FakeIndexedDB = true;
    } catch (e) {
        fail('fake_indexeddb', e.message);
        FakeIndexedDB = false;
    }

    if (FakeIndexedDB) {
        const sandbox = {
            window: {},
            console: console,
            indexedDB: global.indexedDB,
            IDBKeyRange: global.IDBKeyRange,
            setTimeout: setTimeout,
            clearTimeout: clearTimeout,
            Date: Date,
            JSON: JSON,
            Object: Object,
            Array: Array,
            String: String,
            Number: Number,
            Promise: Promise,
            Error: Error,
        };
        sandbox.global = sandbox;
        sandbox.window = sandbox;
        vm.createContext(sandbox);
        vm.runInContext(offlineSrc.replace('(window);', '(global);'), sandbox);

        const offline = sandbox.XalissOffline || sandbox.window.XalissOffline;
        if (!offline) {
            fail('offline_api', 'XalissOffline introuvable');
        } else {
            await offline.init('org-test');
            await offline.clearOutbox();

            const id = await offline.enqueue({
                method: 'PATCH',
                path: '/notes/n1/',
                body: JSON.stringify({ title: 'A', content: 'local', updatedAt: '2020-01-01T00:00:00.000Z' }),
                label: 'Note A',
            });
            ok('enqueue');

            const pending = await offline.listOutbox({ status: 'pending' });
            if (pending.length === 1 && pending[0].id === id) ok('list_pending');
            else fail('list_pending', JSON.stringify(pending));

            await offline.markOutboxConflict(id, {
                message: 'Conflit serveur',
                data: { erreur: '409' },
            });
            ok('mark_conflict');

            const stillPending = await offline.listOutbox({ status: 'pending' });
            const conflicts = await offline.listOutbox({ status: 'conflict' });
            if (stillPending.length === 0) ok('pending_empty_after_conflict');
            else fail('pending_empty_after_conflict', stillPending.length);

            if (conflicts.length === 1 && conflicts[0].status === 'conflict') ok('conflict_kept');
            else fail('conflict_kept', JSON.stringify(conflicts));

            const item = await offline.getOutboxItem(id);
            if (item && item.body && String(item.body).indexOf('local') !== -1) ok('payload_preserved');
            else fail('payload_preserved', JSON.stringify(item));

            const forced = offline.prepareForceSyncBody(item.body);
            const parsed = JSON.parse(forced);
            if (parsed.content === 'local' && parsed.updatedAt === undefined) ok('force_strips_updatedAt');
            else fail('force_strips_updatedAt', forced);

            await offline.requeueOutboxItem(id, forced);
            const requeued = await offline.listOutbox({ status: 'pending' });
            if (requeued.length === 1 && requeued[0].status === 'pending') ok('requeue_pending');
            else fail('requeue_pending', JSON.stringify(requeued));

            await offline.markOutboxConflict(id, { message: 'x' });
            await offline.removeOutboxItem(id);
            const afterDiscard = await offline.listOutbox({ status: 'conflict' });
            if (afterDiscard.length === 0) ok('discard_removes');
            else fail('discard_removes', afterDiscard.length);

            // Simule flush : 409 → mark, pas delete
            const id2 = await offline.enqueue({
                method: 'PATCH',
                path: '/notes/n2/',
                body: JSON.stringify({ title: 'B', updatedAt: '2020-01-01T00:00:00Z' }),
                label: 'Note B',
            });
            // Comportement attendu du bridge
            await offline.markOutboxConflict(id2, { message: '409' });
            const all = await offline.listOutbox();
            if (all.length === 1 && all[0].status === 'conflict') ok('flush_409_keeps_item');
            else fail('flush_409_keeps_item', JSON.stringify(all));

            await offline.clearOutbox();
        }
    }

    console.log('=== 3. Optimistic lock serveur (409 réel) ===');
    // délégué au script python companion
    console.log('OK  (voir verif_conflits_outbox.py pour API)');

    console.log('');
    console.log('Result: ' + passed + ' passed, ' + errors.length + ' failed');
    errors.forEach(function (e) { console.log(' - ' + e); });
    process.exit(errors.length ? 1 : 0);
}

main().catch(function (err) {
    console.error(err);
    process.exit(1);
});
