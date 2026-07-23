/**
 * Pont API Django — remplace Firebase / localStorage pour l'app hébergée sur /app/
 */
(function () {
    if (!window.XALISS_DJANGO) return;

    const cfg = window.XALISS_DJANGO;
    const offline = window.XalissOffline;

    function isNetworkError(error) {
        if (!offline || !offline.isOnline()) return true;
        if (!error) return false;
        return error.name === 'TypeError'
            || String(error.message || '').indexOf('Failed to fetch') !== -1
            || String(error.message || '').indexOf('NetworkError') !== -1;
    }

    function apiUrl(path) {
        const base = cfg.apiBase.replace(/\/$/, '');
        const suffix = path.startsWith('/') ? path : '/' + path;
        return base + suffix;
    }

    function ApiError(message, status, data, extra) {
        this.name = 'ApiError';
        this.message = message;
        this.status = status;
        this.data = data || null;
        if (extra) {
            Object.keys(extra).forEach(function (key) {
                this[key] = extra[key];
            }, this);
        }
    }
    ApiError.prototype = Object.create(Error.prototype);

    function resolveApiErrorMessage(status, data) {
        if (data && data.erreur) return data.erreur;
        if (status === 409) {
            return 'Quelqu\'un d\'autre a modifié cette donnée. Rechargez la page avant de réenregistrer.';
        }
        if (status === 401) {
            return 'Votre session a expiré. Reconnectez-vous pour continuer.';
        }
        if (status === 403) {
            return 'Accès refusé. Vérifiez vos permissions ou reconnectez-vous.';
        }
        if (status === 423) {
            return 'Cette ressource est en cours de modification par un autre utilisateur.';
        }
        if (status === 404) {
            return 'Élément introuvable sur le serveur.';
        }
        if (status === 429) {
            return 'Trop de tentatives. Réessayez dans quelques minutes.';
        }
        if (status >= 500) {
            return 'Le serveur est temporairement indisponible. Réessayez dans un instant.';
        }
        return 'Une erreur est survenue (' + status + ').';
    }

    function createSessionExpiredError() {
        return new ApiError(
            'Votre session a expiré. Reconnectez-vous pour continuer.',
            401,
            null,
            { sessionExpired: true }
        );
    }

    function isSessionExpiredError(error) {
        return !!(error && (error.sessionExpired || error.status === 401));
    }

    function isConflictError(error) {
        return !!(error && error.status === 409);
    }

    async function handleSessionExpired() {
        let pending = 0;
        if (offline) {
            try {
                pending = await offline.countOutbox();
            } catch (e) {
                pending = 0;
            }
        }

        let text = 'Votre session a expiré. Reconnectez-vous pour continuer.';
        if (pending > 0) {
            text = 'Session expirée. Vos ' + pending + ' modification(s) locales sont conservées — reconnectez-vous pour les envoyer au serveur.';
        }

        sessionStorage.setItem('xaliss_flash_message', JSON.stringify({
            type: 'warning',
            text: text,
            duration: 6000,
        }));

        const loginBase = (cfg.loginUrl || '/connexion/').split('?')[0];
        window.location.href = loginBase + '?next=' + encodeURIComponent('/app/');
    }

    let sessionRedirectPending = false;

    function readCookieValue(cookieHeader, name) {
        const source = String(cookieHeader || '');
        if (!source || !name) return '';
        const parts = source.split(';');
        const prefix = name + '=';
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i].trim();
            if (part.indexOf(prefix) === 0) {
                try {
                    return decodeURIComponent(part.slice(prefix.length));
                } catch (e) {
                    return part.slice(prefix.length);
                }
            }
        }
        return '';
    }

    function readCsrfTokenFromDom() {
        const input = document.querySelector('input[name="csrfmiddlewaretoken"]');
        return (input && input.value) ? String(input.value) : '';
    }

    function syncCsrfDomToken(token) {
        if (!token) return;
        const inputs = document.querySelectorAll('input[name="csrfmiddlewaretoken"]');
        for (let i = 0; i < inputs.length; i++) {
            inputs[i].value = token;
        }
    }

    function readCsrfToken() {
        // Cookie = source de vérité (peut tourner sans rechargement de page).
        const fromCookie = readCookieValue(
            typeof document !== 'undefined' ? document.cookie : '',
            'csrftoken'
        );
        if (fromCookie) {
            cfg.csrfToken = fromCookie;
            syncCsrfDomToken(fromCookie);
            return fromCookie;
        }
        const fromDom = readCsrfTokenFromDom();
        if (fromDom) {
            cfg.csrfToken = fromDom;
            return fromDom;
        }
        return cfg.csrfToken || '';
    }

    function isUnsafeHttpMethod(method) {
        const m = String(method || 'GET').toUpperCase();
        return m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS' && m !== 'TRACE';
    }

    function looksLikeCsrfFailure(response, contentType) {
        if (!response || response.status !== 403) return false;
        const ct = String(contentType || '').toLowerCase();
        // Django CSRF failure → souvent HTML ; parfois corps vide / texte.
        return ct.indexOf('application/json') === -1;
    }

    async function apiFetchNetwork(path, options, retried) {
        const opts = options || {};
        const method = String(opts.method || 'GET').toUpperCase();
        const csrfToken = readCsrfToken();
        const headers = Object.assign(
            {},
            isUnsafeHttpMethod(method) ? { 'X-CSRFToken': csrfToken } : {},
            opts.body ? { 'Content-Type': 'application/json' } : {},
            opts.headers || {}
        );
        // Toujours envoyer le token si on en a un (comportement historique + APIs mixtes).
        if (csrfToken && !headers['X-CSRFToken']) {
            headers['X-CSRFToken'] = csrfToken;
        }

        const response = await fetch(apiUrl(path), Object.assign({
            credentials: 'same-origin',
            headers: headers
        }, opts));

        const contentType = response.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');

        if (response.redirected && response.url && response.url.indexOf('connexion') !== -1) {
            throw createSessionExpiredError();
        }

        if (looksLikeCsrfFailure(response, contentType) && isUnsafeHttpMethod(method) && !retried) {
            const latest = readCsrfToken();
            if (latest && latest !== csrfToken) {
                return apiFetchNetwork(path, options, true);
            }
            // Cookie pas encore à jour : ping léger pour récupérer un Set-Cookie éventuel.
            try {
                await fetch('/app/', {
                    method: 'GET',
                    credentials: 'same-origin',
                    headers: { Accept: 'text/html' },
                    cache: 'no-store',
                });
            } catch (e) { /* ignore */ }
            const afterPing = readCsrfToken();
            if (afterPing && afterPing !== csrfToken) {
                return apiFetchNetwork(path, options, true);
            }
        }

        if (contentType.includes('text/html')) {
            if (response.status === 403) {
                throw new ApiError(
                    'La page a expiré. Rechargez la page (F5) puis réessayez.',
                    403,
                    null,
                    { csrfFailure: true }
                );
            }
            throw createSessionExpiredError();
        }

        let data = null;
        if (isJson) {
            try {
                data = await response.json();
            } catch (e) {
                data = null;
            }
        }

        if (!response.ok) {
            const message = resolveApiErrorMessage(response.status, data);
            const extra = {};
            if (response.status === 401) extra.sessionExpired = true;
            throw new ApiError(message, response.status, data, extra);
        }

        return data;
    }

    async function apiFetch(path, options) {
        const method = ((options && options.method) || 'GET').toUpperCase();
        try {
            return await apiFetchNetwork(path, options);
        } catch (error) {
            if (method !== 'GET' || !offline) throw error;
            const snapshot = await offline.loadSnapshot();
            const cached = offline.getSnapshotResponse(path, snapshot);
            if (cached) return cached;
            throw error;
        }
    }

    async function refreshOfflineConnectionStatus() {
        if (!offline) return;
        const pending = await offline.countOutbox();
        const online = offline.isOnline();
        if (typeof updateConnectionStatus === 'function') {
            updateConnectionStatus(online, {
                offlineMode: !online,
                pendingCount: pending,
                cacheMode: !online,
            });
        }
    }

    async function persistOfflineSnapshot() {
        if (!offline) return;
        const accountId = getCurrentAccountId();
        await offline.saveSnapshot({
            transactions: transactions,
            clients: cachedClients,
            notes: cachedNotes,
            categories: (typeof cachedProductCategoryRecords !== 'undefined' && cachedProductCategoryRecords.length)
                ? cachedProductCategoryRecords
                : cachedProductCategories,
            profil: loadCompanyProfileFromLocalStorage(accountId),
            syncSeq: lastSyncSeq,
        });
    }

    function applySnapshotToUI(snapshot) {
        if (!snapshot) return false;
        transactions = (snapshot.transactions || []).slice();
        hydrateTransactionClientLinks();
        const accountId = getCurrentAccountId();
        persistClientsLocal(accountId, { clients: snapshot.clients || [] });
        persistNotesLocal(accountId, { notes: snapshot.notes || [] });
        persistCategoriesLocal(accountId, { categories: snapshot.categories || [] });
        if (snapshot.profil) {
            const profil = normalizeCompanyProfilePayload(snapshot.profil);
            persistCompanyProfileLocal(accountId, profil);
            applyCompanyProfileToForm(profil);
            if (typeof applyOrgAppSettingsFromApi === 'function') {
                applyOrgAppSettingsFromApi(snapshot.profil);
            }
        }
        updateDisplay();
        syncTransactionClientLinks();
        maybeImportClientsFromTransactions();
        if (typeof renderClientsList === 'function') renderClientsList();
        return true;
    }

    function markLocalSyncActivity() {
        suppressSyncToastUntil = Date.now() + 5000;
    }

    async function apiWriteOrQueue(path, options, meta) {
        const opts = options || {};
        const method = (opts.method || 'POST').toUpperCase();
        const metaInfo = meta || {};

        if (offline && offline.isOnline()) {
            try {
                const data = await apiFetchNetwork(path, opts);
                markLocalSyncActivity();
                await refreshOfflineConnectionStatus();
                return { queued: false, data: data };
            } catch (error) {
                if (!isNetworkError(error)) throw error;
            }
        } else if (offline && !offline.isOnline()) {
            /* file d'attente */
        } else {
            const data = await apiFetchNetwork(path, opts);
            markLocalSyncActivity();
            return { queued: false, data: data };
        }

        if (!offline) throw new Error('Hors ligne');

        await offline.enqueue({
            method: method,
            path: path,
            body: opts.body || null,
            label: metaInfo.label || method + ' ' + path,
        });
        if (typeof metaInfo.localApply === 'function') {
            metaInfo.localApply();
        }
        await persistOfflineSnapshot();
        await refreshOfflineConnectionStatus();
        showNotification(
            metaInfo.offlineMessage || 'Synchronisation : enregistré localement, envoi à la reconnexion.',
            'warning',
            { transient: true, duration: 2800 }
        );
        return { queued: true };
    }

    let syncFlushInProgress = false;

    function escapeConflictHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function describeOutboxItem(item) {
        if (!item) return 'Modification locale';
        if (item.label) return String(item.label);
        return String(item.method || '?') + ' ' + String(item.path || '');
    }

    async function refreshSyncConflictBanner() {
        const banner = document.getElementById('syncConflictBanner');
        if (!banner || !offline) return;
        let count = 0;
        try {
            count = await offline.countOutbox({ status: 'conflict' });
        } catch (e) {
            count = 0;
        }
        if (count > 0) {
            banner.hidden = false;
            const label = document.getElementById('syncConflictBannerText');
            if (label) {
                label.textContent = count === 1
                    ? '1 modification en conflit de synchronisation — à résoudre.'
                    : count + ' modifications en conflit de synchronisation — à résoudre.';
            }
        } else {
            banner.hidden = true;
        }
    }

    async function renderSyncConflictsModal() {
        const listEl = document.getElementById('syncConflictsList');
        const emptyEl = document.getElementById('syncConflictsEmpty');
        if (!listEl || !offline) return;
        const items = await offline.listOutbox({ status: 'conflict' });
        if (!items.length) {
            listEl.innerHTML = '';
            if (emptyEl) emptyEl.hidden = false;
            return;
        }
        if (emptyEl) emptyEl.hidden = true;
        listEl.innerHTML = items.map(function (item) {
            const title = escapeConflictHtml(describeOutboxItem(item));
            const detail = escapeConflictHtml(
                item.conflictMessage
                || 'La donnée a changé sur le serveur depuis votre modification hors ligne.'
            );
            const when = item.conflictAt
                ? escapeConflictHtml(String(item.conflictAt).replace('T', ' ').slice(0, 19))
                : '';
            return (
                '<article class="sync-conflict-item" data-conflict-id="' + escapeConflictHtml(item.id) + '">'
                + '<div class="sync-conflict-item-main">'
                + '<strong class="sync-conflict-item-title">' + title + '</strong>'
                + (when ? '<span class="sync-conflict-item-when">' + when + '</span>' : '')
                + '<p class="sync-conflict-item-detail">' + detail + '</p>'
                + '</div>'
                + '<div class="sync-conflict-item-actions">'
                + '<button type="button" class="btn sync-conflict-btn-discard" data-conflict-action="discard" data-conflict-id="' + escapeConflictHtml(item.id) + '">Garder le serveur</button>'
                + '<button type="button" class="btn sync-conflict-btn-force" data-conflict-action="force" data-conflict-id="' + escapeConflictHtml(item.id) + '">Forcer ma version</button>'
                + '</div>'
                + '</article>'
            );
        }).join('');
    }

    async function openSyncConflictsModal() {
        const modal = document.getElementById('syncConflictsModal');
        if (!modal) return;
        await renderSyncConflictsModal();
        modal.hidden = false;
        modal.style.display = 'flex';
    }

    function closeSyncConflictsModal() {
        const modal = document.getElementById('syncConflictsModal');
        if (!modal) return;
        modal.hidden = true;
        modal.style.display = 'none';
    }

    async function resolveSyncConflict(id, action) {
        if (!offline || id == null) return;
        const item = await offline.getOutboxItem(id);
        if (!item || offline.normalizeOutboxStatus(item.status) !== 'conflict') {
            await renderSyncConflictsModal();
            await refreshSyncConflictBanner();
            return;
        }

        if (action === 'discard') {
            await offline.removeOutboxItem(id);
            showNotification('Modification locale abandonnée — version serveur conservée.', 'info', {
                transient: true,
                duration: 3200,
            });
            if (typeof xalissReloadFromServer === 'function') {
                await xalissReloadFromServer(false);
            }
        } else if (action === 'force') {
            const forcedBody = offline.prepareForceSyncBody(item.body);
            await offline.requeueOutboxItem(id, forcedBody);
            try {
                await apiFetchNetwork(item.path, {
                    method: item.method,
                    body: forcedBody,
                });
                await offline.removeOutboxItem(id);
                if (typeof xalissReloadAfterWrite === 'function') {
                    await xalissReloadAfterWrite();
                }
                showNotification('Votre version locale a été synchronisée.', 'success', {
                    transient: true,
                    duration: 3200,
                });
            } catch (error) {
                if (isSessionExpiredError(error)) {
                    notifyApiError(error);
                    return;
                }
                if (isConflictError(error)) {
                    await offline.markOutboxConflict(id, {
                        message: (error && error.message) || '',
                        data: (error && error.data) || null,
                    });
                    showNotification(
                        'Le conflit persiste. Rechargez ou réessayez plus tard.',
                        'warning',
                        { duration: 4500 }
                    );
                } else {
                    // Remet en conflit pour ne pas perdre le payload.
                    await offline.markOutboxConflict(id, {
                        message: (error && error.message) || 'Échec du renvoi forcé.',
                        data: (error && error.data) || null,
                    });
                    notifyApiError(error, 'Impossible de forcer la synchronisation.');
                }
            }
        }

        await renderSyncConflictsModal();
        await refreshSyncConflictBanner();
        await refreshOfflineConnectionStatus();

        const remaining = await offline.countOutbox({ status: 'conflict' });
        if (remaining === 0) {
            closeSyncConflictsModal();
        }
    }

    function bindSyncConflictsUi() {
        if (window._xalissConflictsUiBound) return;
        window._xalissConflictsUiBound = true;

        const openBtn = document.getElementById('syncConflictBannerOpen');
        if (openBtn) {
            openBtn.addEventListener('click', function () {
                openSyncConflictsModal();
            });
        }
        const closeBtn = document.getElementById('syncConflictsClose');
        if (closeBtn) {
            closeBtn.addEventListener('click', closeSyncConflictsModal);
        }
        const modal = document.getElementById('syncConflictsModal');
        if (modal) {
            modal.addEventListener('click', function (event) {
                if (event.target === modal) closeSyncConflictsModal();
            });
            modal.addEventListener('click', function (event) {
                const btn = event.target.closest('[data-conflict-action]');
                if (!btn) return;
                const action = btn.getAttribute('data-conflict-action');
                const idRaw = btn.getAttribute('data-conflict-id');
                const id = /^\d+$/.test(String(idRaw || '')) ? Number(idRaw) : idRaw;
                resolveSyncConflict(id, action);
            });
        }
        window.openSyncConflictsModal = openSyncConflictsModal;
        window.closeSyncConflictsModal = closeSyncConflictsModal;
    }

    async function flushOfflineOutbox() {
        if (!offline || syncFlushInProgress || !offline.isOnline()) return;
        const items = await offline.listOutbox({ status: 'pending' });
        if (!items.length) {
            await refreshSyncConflictBanner();
            return;
        }

        syncFlushInProgress = true;
        let syncedCount = 0;
        let conflictCount = 0;

        try {
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                try {
                    await apiFetchNetwork(item.path, {
                        method: item.method,
                        body: item.body,
                    });
                    await offline.removeOutboxItem(item.id);
                    syncedCount++;
                    await refreshOfflineConnectionStatus();
                } catch (error) {
                    if (isSessionExpiredError(error)) {
                        throw error;
                    }
                    if (isConflictError(error)) {
                        // Conservé en outbox avec statut conflict (pas de perte silencieuse).
                        await offline.markOutboxConflict(item.id, {
                            message: (error && error.message) || '',
                            data: (error && error.data) || null,
                        });
                        conflictCount++;
                        continue;
                    }
                    throw error;
                }
            }

            if (syncedCount > 0) {
                await xalissReloadAfterWrite();
            }

            if (conflictCount > 0) {
                await xalissReloadAfterWrite();
                await refreshSyncConflictBanner();
                showNotification(
                    conflictCount === 1
                        ? 'Conflit de sync : une modification locale est conservée — choisissez la version à garder.'
                        : 'Conflits de sync : ' + conflictCount + ' modifications locales sont conservées — à résoudre.',
                    'warning',
                    { duration: 6500 }
                );
                openSyncConflictsModal();
            }
        } catch (error) {
            if (isSessionExpiredError(error)) {
                if (!sessionRedirectPending) {
                    sessionRedirectPending = true;
                    await handleSessionExpired();
                }
                return;
            }
            console.error('Sync hors ligne échouée:', error);
            const msg = (error && error.message)
                ? error.message
                : 'Certaines modifications n\'ont pas pu être synchronisées.';
            showNotification(msg, 'error');
        } finally {
            syncFlushInProgress = false;
            await refreshOfflineConnectionStatus();
            await refreshSyncConflictBanner();
        }
    }

    function bindOfflineLifecycle() {
        if (!offline || window._xalissOfflineBound) return;
        window._xalissOfflineBound = true;

        bindSyncConflictsUi();
        refreshSyncConflictBanner();

        window.addEventListener('offline', function () {
            refreshOfflineConnectionStatus();
            showNotification('Synchronisation : mode hors ligne, saisie locale activée.', 'warning', {
                transient: true,
                duration: 2800,
            });
        });

        window.addEventListener('online', function () {
            refreshOfflineConnectionStatus();
            flushOfflineOutbox();
        });
    }

    function notifyApiError(error, fallback) {
        console.error(error);

        if (isSessionExpiredError(error)) {
            if (!sessionRedirectPending) {
                sessionRedirectPending = true;
                handleSessionExpired();
            }
            return;
        }

        const message = (error && error.message) ? error.message : (fallback || 'Erreur serveur');

        if (isConflictError(error) || (typeof isTransientConcurrencyMessage === 'function' && isTransientConcurrencyMessage(message))) {
            showNotification(message, 'warning', { transient: true, duration: 4500 });
            if (isConflictError(error) && typeof xalissReloadFromServer === 'function') {
                xalissReloadFromServer(false);
            }
            refreshOfflineConnectionStatus();
            return;
        }

        showNotification(message, 'error');
        refreshOfflineConnectionStatus();
    }

    let lastSyncSeq = null;
    let syncPollTimer = null;
    let syncPollInFlight = false;
    const SYNC_POLL_MS = 30000;
    let activeEditLock = null;
    let lockHeartbeatTimer = null;
    let reloadInProgress = false;
    let suppressSyncToastUntil = 0;
    let activeLocksMap = {};
    let locksInitialLoadDone = false;

    function lockMapKey(type, id) {
        return type + ':' + String(id);
    }

    function locksRenderKey(map) {
        return Object.keys(map).filter(function (key) {
            const lock = map[key];
            return !(cfg.userId && lock.utilisateurId && String(lock.utilisateurId) === String(cfg.userId));
        }).sort().join('||');
    }

    async function loadActiveLocksFromApi() {
        const previous = Object.assign({}, activeLocksMap);
        try {
            const data = await apiFetch('/verrous/');
            activeLocksMap = {};
            (data.verrous || []).forEach(function (v) {
                activeLocksMap[lockMapKey(v.ressourceType, v.ressourceId)] = v;
            });
            if (locksInitialLoadDone) {
                Object.keys(activeLocksMap).forEach(function (key) {
                    if (previous[key]) return;
                    const lock = activeLocksMap[key];
                    if (cfg.userId && lock.utilisateurId && String(lock.utilisateurId) === String(cfg.userId)) {
                        return;
                    }
                    if (lock.message) {
                        showNotification(lock.message, 'warning', { transient: true, duration: 2500 });
                    }
                });
            }
            locksInitialLoadDone = true;
            // Ne re-rendre l'UI que si les verrous des AUTRES utilisateurs ont changé :
            // nos propres verrous sont invisibles à l'écran, et expireLe bouge à chaque
            // heartbeat sans impact visuel (évite l'effet de « refresh »).
            const locksChanged = locksRenderKey(previous) !== locksRenderKey(activeLocksMap);
            if (locksChanged) {
                if (typeof updateDisplay === 'function') updateDisplay();
                if (typeof renderClientsList === 'function') renderClientsList();
            }
        } catch (e) {
            console.warn('Verrous actifs non chargés', e);
        }
    }

    window.xalissGetEditLock = function (type, id) {
        const lock = activeLocksMap[lockMapKey(type, id)];
        if (!lock) return null;
        if (cfg.userId && lock.utilisateurId && String(lock.utilisateurId) === String(cfg.userId)) {
            return null;
        }
        return lock;
    };

    window.xalissGetEditLockMessage = function (type, id) {
        const lock = window.xalissGetEditLock(type, id);
        if (!lock) return null;
        return lock.message || (lock.utilisateurNom + ' est en train de modifier cette ressource, patientez.');
    };

    let reloadAfterWritePromise = null;

    async function xalissReloadAfterWrite() {
        // Coalescer les rechargements concurrents (écriture + poll sync de sa
        // propre modification) en un seul, pour éviter les re-rendus en rafale.
        if (reloadAfterWritePromise) return reloadAfterWritePromise;
        reloadAfterWritePromise = doReloadAfterWrite().finally(function () {
            reloadAfterWritePromise = null;
        });
        return reloadAfterWritePromise;
    }

    async function doReloadAfterWrite() {
        try {
            // Mettre à jour lastSyncSeq AVANT les rechargements : le poll sync
            // déclenché par notre propre écriture ne provoquera pas un 2e rechargement.
            const syncData = await apiFetch('/sync/');
            if (syncData && syncData.syncSeq !== undefined) {
                lastSyncSeq = syncData.syncSeq;
            }
            await Promise.all([
                loadTransactionsFromApi(),
                loadClientsFromApi(),
                loadNotesFromApi(),
                loadCategoriesFromApi(),
                loadActiveLocksFromApi()
            ]);
            if (typeof window.xalissCheckScheduledNotifications === 'function') {
                window.xalissCheckScheduledNotifications();
            }
        } catch (error) {
            if (offline) {
                const snapshot = await offline.loadSnapshot();
                if (applySnapshotToUI(snapshot)) {
                    await refreshOfflineConnectionStatus();
                    if (typeof window.xalissCheckScheduledNotifications === 'function') {
                        window.xalissCheckScheduledNotifications();
                    }
                    return;
                }
            }
            notifyApiError(error, 'Impossible de recharger les données.');
        }
    }

    window.xalissReloadAfterWrite = xalissReloadAfterWrite;
    window.refreshOfflineConnectionStatus = refreshOfflineConnectionStatus;

    async function xalissReloadFromServer(showToast) {
        if (reloadInProgress) return;
        reloadInProgress = true;
        try {
            await xalissReloadAfterWrite();
            if (typeof applyRolePermissionsUI === 'function') {
                applyRolePermissionsUI();
            }
        } finally {
            reloadInProgress = false;
        }
    }

    async function pollSyncSeq() {
        if (syncPollInFlight) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        syncPollInFlight = true;
        try {
            const syncData = await apiFetch('/sync/');
            if (!syncData || syncData.syncSeq === undefined) return;
            if (lastSyncSeq === null) {
                lastSyncSeq = syncData.syncSeq;
                return;
            }
            if (syncData.syncSeq !== lastSyncSeq) {
                lastSyncSeq = syncData.syncSeq;
                const showToast = Date.now() > suppressSyncToastUntil;
                xalissReloadFromServer(showToast);
            }
        } catch (e) {
            // Hors ligne / session : géré ailleurs
        } finally {
            syncPollInFlight = false;
        }
    }

    function connectSyncEvents() {
        if (syncPollTimer) return;
        syncPollTimer = setInterval(pollSyncSeq, SYNC_POLL_MS);
        if (typeof document !== 'undefined' && !window._xalissSyncVisibilityBound) {
            window._xalissSyncVisibilityBound = true;
            document.addEventListener('visibilitychange', function () {
                if (!document.hidden) {
                    pollSyncSeq();
                }
            });
        }
    }

    async function acquireEditLock(ressourceType, ressourceId) {
        try {
            await apiFetch('/verrous/', {
                method: 'POST',
                body: JSON.stringify({
                    ressourceType: ressourceType,
                    ressourceId: String(ressourceId)
                })
            });
            activeEditLock = { type: ressourceType, id: String(ressourceId) };
            if (lockHeartbeatTimer) clearInterval(lockHeartbeatTimer);
            lockHeartbeatTimer = setInterval(function () {
                if (!activeEditLock) return;
                apiFetch('/verrous/', {
                    method: 'POST',
                    body: JSON.stringify({
                        ressourceType: activeEditLock.type,
                        ressourceId: activeEditLock.id
                    })
                }).catch(function () {});
            }, 60000);
            await loadActiveLocksFromApi();
            return true;
        } catch (error) {
            const msg = error.message || 'Ressource verrouillée.';
            showNotification(msg, 'warning', { transient: true, duration: 2500 });
            return false;
        }
    }

    async function releaseEditLock() {
        if (!activeEditLock) return;
        const lock = activeEditLock;
        activeEditLock = null;
        if (lockHeartbeatTimer) {
            clearInterval(lockHeartbeatTimer);
            lockHeartbeatTimer = null;
        }
        try {
            await apiFetch('/verrous/', {
                method: 'DELETE',
                body: JSON.stringify({
                    ressourceType: lock.type,
                    ressourceId: lock.id
                })
            });
            await loadActiveLocksFromApi();
        } catch (e) {
            /* ignore */
        }
    }

    function patchEditModalsForLocks() {
        if (typeof window.openEditModal !== 'function') return;

        const originalOpenEditModal = window.openEditModal;
        window.openEditModal = async function (id) {
            const ok = await acquireEditLock('transaction', id);
            if (ok) originalOpenEditModal(id);
        };

        if (typeof closeEditModal === 'function') {
            const originalCloseEditModal = closeEditModal;
            closeEditModal = function () {
                releaseEditLock();
                originalCloseEditModal();
            };
            window.closeEditModal = closeEditModal;
        }

        if (typeof openClientEditModal === 'function') {
            const originalOpenClientEditModal = openClientEditModal;
            openClientEditModal = async function (clientId) {
                const ok = await acquireEditLock('client', clientId);
                if (ok) originalOpenClientEditModal(clientId);
            };
            window.openClientEditModal = openClientEditModal;
        }

        if (typeof closeClientEditModal === 'function') {
            const originalCloseClientEditModal = closeClientEditModal;
            closeClientEditModal = function () {
                releaseEditLock();
                originalCloseClientEditModal();
            };
            window.closeClientEditModal = closeClientEditModal;
        }
    }

    async function loadTransactionsFromApi() {
        const data = await apiFetch('/transactions/');
        const incoming = data.transactions || [];
        // Comparer avec ce qui est DÉJÀ affiché (après hydratation des liens clients) :
        // si l'écriture a déjà mis à jour la ligne localement, on ne re-rend pas une 2e fois.
        const displayedJson = JSON.stringify(transactions);
        transactions = incoming;
        hydrateTransactionClientLinks();
        const unchanged = JSON.stringify(transactions) === displayedJson;
        if (!unchanged) {
            updateDisplay();
            syncTransactionClientLinks();
            maybeImportClientsFromTransactions();
        }
        await persistOfflineSnapshot();
        await refreshOfflineConnectionStatus();
    }

    async function loadClientsFromApi() {
        const data = await apiFetch('/clients/');
        const accountId = getCurrentAccountId();
        persistClientsLocal(accountId, { clients: data.clients || [] });
        await persistOfflineSnapshot();
    }

    async function loadCategoriesFromApi() {
        const data = await apiFetch('/categories/');
        const accountId = getCurrentAccountId();
        persistCategoriesLocal(accountId, { categories: data.categories || [] });
        await persistOfflineSnapshot();
    }

    async function loadNotesFromApi() {
        const accountId = getCurrentAccountId();
        const pageSize = 50;
        let page = 1;
        let totalPages = 1;
        const allNotes = [];

        do {
            const data = await apiFetch(
                '/notes/?page=' + encodeURIComponent(page)
                + '&page_size=' + encodeURIComponent(pageSize)
            );
            const batch = Array.isArray(data.notes) ? data.notes : [];
            allNotes.push.apply(allNotes, batch);
            totalPages = Math.max(1, Number(data.totalPages) || 1);
            if (page === 1) {
                persistNotesLocal(accountId, { notes: allNotes.slice() });
            }
            page += 1;
        } while (page <= totalPages);

        persistNotesLocal(accountId, { notes: allNotes });
        if (typeof ensureNoteReminders === 'function') ensureNoteReminders();
        await persistOfflineSnapshot();
    }

    let noteReminderEmailInFlight = false;
    let noteReminderEmailLastAt = 0;
    window.xalissProcessNoteReminderEmails = function () {
        const now = Date.now();
        if (noteReminderEmailInFlight || (now - noteReminderEmailLastAt) < 20000) return;
        if (offline && !offline.isOnline()) return;
        noteReminderEmailInFlight = true;
        noteReminderEmailLastAt = now;
        apiFetchNetwork('/notes/rappels-email/', {
            method: 'POST',
            body: '{}',
        }).catch(function () {
            /* silencieux : l’envoi sera retenté au prochain sync */
        }).finally(function () {
            noteReminderEmailInFlight = false;
        });
    };

    async function loadUserProfileFromApi() {
        const data = await apiFetch('/utilisateur/profil/');
        if (typeof applyUserProfileToForm === 'function') {
            await applyUserProfileToForm(data.profil || {});
        }
        if (data.profil && typeof applyOrgAppSettingsFromApi === 'function') {
            applyOrgAppSettingsFromApi({ currencyLabel: data.profil.currencyLabel });
        }
    }

    function getLocalNotificationsMigrationKey() {
        const userId = (cfg && cfg.userId) || 'anonymous';
        const orgSlug = (cfg && cfg.orgSlug) || 'default';
        return 'xaliss_notifications_migrated_' + orgSlug + '_' + userId;
    }

    async function loadNotificationsFromApi() {
        const data = await apiFetch('/notifications/');
        const remote = Array.isArray(data.notifications) ? data.notifications : [];
        const ignored = Array.isArray(data.ignoredSystemIds) ? data.ignoredSystemIds : [];

        const migrationKey = getLocalNotificationsMigrationKey();
        const alreadyMigrated = localStorage.getItem(migrationKey) === '1';
        const localList = typeof window.xalissGetNotifications === 'function'
            ? window.xalissGetNotifications()
            : [];

        if (!alreadyMigrated && localList.length && remote.length === 0) {
            try {
                const migrated = await apiFetchNetwork('/notifications/', {
                    method: 'POST',
                    body: JSON.stringify({ notifications: localList }),
                });
                localStorage.setItem(migrationKey, '1');
                if (typeof window.xalissReplaceNotifications === 'function') {
                    window.xalissReplaceNotifications(
                        migrated.notifications || [],
                        migrated.ignoredSystemIds || ignored
                    );
                }
                return;
            } catch (e) {
                /* keep local until next boot */
            }
        }

        if (!alreadyMigrated) {
            localStorage.setItem(migrationKey, '1');
        }
        if (typeof window.xalissReplaceNotifications === 'function') {
            window.xalissReplaceNotifications(remote, ignored);
        }
    }

    let notifRemoteQueue = Promise.resolve();
    function enqueueNotifRemote(task) {
        notifRemoteQueue = notifRemoteQueue.then(task).catch(function () { /* ignore */ });
        return notifRemoteQueue;
    }

    window.xalissNotificationsRemoteAdd = function (item) {
        if (!item || !item.message) return;
        enqueueNotifRemote(function () {
            return apiFetchNetwork('/notifications/', {
                method: 'POST',
                body: JSON.stringify({
                    id: item.id,
                    message: item.message,
                    type: item.type || 'info',
                    systemId: item.systemId || '',
                }),
            }).then(function (data) {
                if (data && data.ignored && item.systemId) {
                    if (typeof window.xalissMarkNotificationSystemIdsIgnored === 'function') {
                        window.xalissMarkNotificationSystemIdsIgnored([item.systemId]);
                    }
                    if (typeof window.xalissReplaceNotifications === 'function'
                        && typeof window.xalissGetNotifications === 'function') {
                        const list = window.xalissGetNotifications().filter(function (n) {
                            return !(n && n.systemId === item.systemId);
                        });
                        window.xalissReplaceNotifications(list, null);
                    }
                }
            });
        });
    };

    window.xalissNotificationsRemoteClear = function () {
        enqueueNotifRemote(function () {
            return apiFetchNetwork('/notifications/', { method: 'DELETE' });
        });
    };

    window.xalissNotificationsRemoteRemovePrefix = function (prefix) {
        if (!prefix) return;
        enqueueNotifRemote(function () {
            return apiFetchNetwork('/notifications/remove-prefix/', {
                method: 'POST',
                body: JSON.stringify({ prefix: prefix }),
            });
        });
    };

    async function loadProfileFromApi() {
        const data = await apiFetch('/organisation/profil/');
        const accountId = getCurrentAccountId();
        const profil = normalizeCompanyProfilePayload(data.profil || {});
        persistCompanyProfileLocal(accountId, profil);
        applyCompanyProfileToForm(profil);
        if (typeof applyOrgAppSettingsFromApi === 'function') {
            applyOrgAppSettingsFromApi(data.profil || {});
        }
        await persistOfflineSnapshot();
    }

    window.xalissLoadTransactions = loadTransactionsFromApi;

    window.xalissLoadAllData = async function () {
        if (typeof showFlashMessageFromStorage === 'function') {
            showFlashMessageFromStorage();
        }
        if (offline) {
            await offline.init(cfg.orgSlug);
            bindOfflineLifecycle();
        }
        try {
            await Promise.all([
                loadProfileFromApi(),
                loadUserProfileFromApi(),
                loadClientsFromApi(),
                loadNotesFromApi(),
                loadCategoriesFromApi(),
                loadTransactionsFromApi(),
                loadNotificationsFromApi()
            ]);
            const syncData = await apiFetch('/sync/');
            if (syncData && syncData.syncSeq !== undefined) {
                lastSyncSeq = syncData.syncSeq;
            }
            await persistOfflineSnapshot();
            connectSyncEvents();
            patchEditModalsForLocks();
            await loadActiveLocksFromApi();
            await refreshOfflineConnectionStatus();
            if (offline && offline.isOnline()) {
                flushOfflineOutbox();
            }
            if (!window._xalissLocksPollStarted) {
                window._xalissLocksPollStarted = true;
                setInterval(loadActiveLocksFromApi, 8000);
            }
            if (typeof window.xalissEnsureWelcomeNotification === 'function') {
                window.xalissEnsureWelcomeNotification();
            }
            if (typeof window.xalissCheckScheduledNotifications === 'function') {
                window.xalissCheckScheduledNotifications();
            }
        } catch (error) {
            if (offline) {
                const snapshot = await offline.loadSnapshot();
                if (applySnapshotToUI(snapshot)) {
                    showNotification('Mode hors ligne — données du cache local', 'warning', {
                        transient: true,
                        duration: 2800,
                    });
                    await refreshOfflineConnectionStatus();
                    connectSyncEvents();
                    patchEditModalsForLocks();
                    if (typeof window.xalissCheckScheduledNotifications === 'function') {
                        window.xalissCheckScheduledNotifications();
                    }
                    return;
                }
            }
            notifyApiError(error, 'Impossible de charger les données.');
        }
    };

    const originalLoadTransactions = loadTransactions;
    loadTransactions = function () {
        loadTransactionsFromApi().catch(function (error) {
            notifyApiError(error, 'Impossible de charger les transactions.');
            originalLoadTransactions();
        });
    };

    const originalAddTransaction = addTransaction;
    addTransaction = function (type, amount, description, date, remainingAmount, invoiceClient, invoiceClientId, category) {
        const amt = parseFloat(amount);
        const unusualExpenseBenchmark = type === 'expense' && typeof getUnusualExpenseBenchmark === 'function'
            ? getUnusualExpenseBenchmark(amt)
            : null;
        const dateIso = new Date(date).toISOString();
        const payload = {
            type: type,
            amount: amt,
            description: String(description || '').trim(),
            category: type === 'income' ? normalizeCategoryName(category) : '',
            date: dateIso,
            payments: [{ amount: amt, date: dateIso }]
        };

        if (remainingAmount !== null && remainingAmount !== '') {
            payload.remainingAmount = parseFloat(remainingAmount);
        }

        const clientFields = normalizeInvoiceClientFields(invoiceClient, invoiceClientId);
        if (clientFields.invoiceClient) {
            payload.invoiceClient = clientFields.invoiceClient;
            if (clientFields.invoiceClientId) {
                payload.invoiceClientId = clientFields.invoiceClientId;
            }
        }

        const tempId = (typeof generateTransactionId === 'function')
            ? generateTransactionId()
            : ('tx_' + Date.now().toString(16) + '_' + Math.random().toString(16).slice(2, 10));
        payload.id = tempId;

        apiWriteOrQueue('/transactions/', {
            method: 'POST',
            body: JSON.stringify(payload)
        }, {
            label: 'Ajout transaction',
            localApply: function () {
                transactions.unshift(Object.assign({}, payload, { _offlinePending: true }));
                hydrateTransactionClientLinks();
                updateDisplay();
                syncTransactionClientLinks();
            }
        }).then(function (result) {
            if (typeof notifyUnusualExpenseIfNeeded === 'function') {
                notifyUnusualExpenseIfNeeded(amt, description, unusualExpenseBenchmark);
            }
            if (result.queued) return result;
            // Affichage immédiat de la nouvelle ligne, rechargement complet en arrière-plan
            if (result.data && result.data.transaction) {
                transactions.unshift(result.data.transaction);
                hydrateTransactionClientLinks();
                updateDisplay();
            }
            xalissReloadAfterWrite();
            if (!offline || offline.isOnline()) {
                showNotification('Transaction ajoutée avec succès', 'success');
            }
            return result;
        }).catch(function (error) {
            notifyApiError(error, 'Impossible d\'ajouter la transaction.');
        });
    };

    const originalDeleteTransaction = deleteTransaction;
    deleteTransaction = function (id) {
        if (!id) return;
        if (cfg.permissions && !cfg.permissions.canDeleteTransaction) {
            showNotification('Vous n\'avez pas la permission de supprimer une transaction.', 'error');
            return;
        }

        showDeleteConfirm({
            title: 'Supprimer la transaction',
            message: 'Êtes-vous sûr de vouloir supprimer cette transaction ?',
            detail: 'Cette action est irréversible.',
            onConfirm: function () {
                const transactionId = String(id);
                apiWriteOrQueue('/transactions/' + encodeURIComponent(transactionId) + '/', {
                    method: 'DELETE'
                }, {
                    label: 'Suppression transaction',
                    localApply: function () {
                        transactions = transactions.filter(function (t) {
                            return String(t.id) !== transactionId;
                        });
                        updateDisplay();
                    }
                }).then(function (result) {
                    if (result.queued) return;
                    // Retrait immédiat de la ligne, rechargement complet en arrière-plan
                    transactions = transactions.filter(function (t) {
                        return String(t.id) !== transactionId;
                    });
                    updateDisplay();
                    xalissReloadAfterWrite();
                    if (!offline || offline.isOnline()) {
                        showNotification('Transaction supprimée avec succès', 'success');
                    }
                }).catch(function (error) {
                    notifyApiError(error, 'Impossible de supprimer la transaction.');
                });
            }
        });
    };
    window.deleteTransaction = deleteTransaction;

    const originalUpdateTransaction = updateTransaction;
    updateTransaction = function (id, amount, description, date, remainingAmountParam, invoiceClient, invoiceClientId, category) {
        const originalTransaction = transactions.find(function (t) {
            return String(t.id) === String(id);
        });
        if (!originalTransaction) {
            showNotification('Transaction non trouvée', 'error');
            return false;
        }

        const newAmount = parseFloat(amount);
        const updatedData = {
            amount: newAmount,
            description: String(description || '').trim(),
            date: new Date(date).toISOString(),
            type: originalTransaction.type
        };

        if (remainingAmountParam !== undefined) {
            const val = remainingAmountParam === '' || remainingAmountParam === null
                ? 0
                : parseFloat(remainingAmountParam);
            updatedData.remainingAmount = (val === 0 || isNaN(val)) ? null : val;
        } else {
            updatedData.remainingAmount = originalTransaction.remainingAmount ?? null;
        }

        const newDateIso = new Date(date).toISOString();
        updatedData.payments = [{ amount: newAmount, date: newDateIso }];

        if (invoiceClient !== undefined) {
            const clientFields = normalizeInvoiceClientFields(
                invoiceClient,
                invoiceClientId !== undefined ? invoiceClientId : originalTransaction.invoiceClientId
            );
            updatedData.invoiceClient = clientFields.invoiceClient;
            updatedData.invoiceClientId = clientFields.invoiceClientId;
        }

        if (category !== undefined) {
            updatedData.category = originalTransaction.type === 'income' ? normalizeCategoryName(category) : '';
        }

        if (originalTransaction.updatedAt) {
            updatedData.updatedAt = originalTransaction.updatedAt;
        }

        return apiWriteOrQueue('/transactions/' + encodeURIComponent(String(id)) + '/', {
            method: 'PATCH',
            body: JSON.stringify(updatedData)
        }, {
            label: 'Modification transaction',
            localApply: function () {
                const idx = transactions.findIndex(function (t) { return String(t.id) === String(id); });
                if (idx !== -1) {
                    transactions[idx] = Object.assign({}, transactions[idx], updatedData, { _offlinePending: true });
                    updateDisplay();
                }
            }
        }).then(function (result) {
            if (!result.queued) {
                // Mise à jour immédiate de la ligne, rechargement complet en arrière-plan
                if (result.data && result.data.transaction) {
                    const idx = transactions.findIndex(function (t) { return String(t.id) === String(id); });
                    if (idx !== -1) {
                        transactions[idx] = result.data.transaction;
                        hydrateTransactionClientLinks();
                        updateDisplay();
                    }
                }
                xalissReloadAfterWrite();
            }
            return true;
        }).catch(function (error) {
            if (isSessionExpiredError(error)) {
                notifyApiError(error);
                return false;
            }
            if (error && error.message && error.message.indexOf('modifié') !== -1) {
                xalissReloadFromServer(false);
            }
            notifyApiError(error, 'Impossible de modifier la transaction.');
            return { ok: false, notified: true };
        });
    };

    const originalCompleteTransaction = completeTransaction;
    completeTransaction = function (transactionId, completeAmount, date) {
        const transaction = transactions.find(function (t) {
            return String(t.id) === String(transactionId);
        });
        if (!transaction || !transaction.remainingAmount || transaction.remainingAmount <= 0) {
            showNotification('Transaction non trouvée ou déjà complète', 'error');
            return false;
        }

        const amountToComplete = parseFloat(completeAmount);
        if (amountToComplete <= 0) {
            showNotification('Le montant à compléter doit être supérieur à 0', 'error');
            return false;
        }

        return apiWriteOrQueue('/transactions/' + encodeURIComponent(String(transactionId)) + '/completer/', {
            method: 'POST',
            body: JSON.stringify({
                amount: amountToComplete,
                date: new Date(date).toISOString(),
                updatedAt: transaction.updatedAt || null
            })
        }, {
            label: 'Complétion transaction',
            localApply: function () {
                const idx = transactions.findIndex(function (t) {
                    return String(t.id) === String(transactionId);
                });
                if (idx === -1) return;
                const tx = transactions[idx];
                const newRemaining = (tx.remainingAmount || 0) - amountToComplete;
                transactions[idx] = Object.assign({}, tx, {
                    amount: tx.amount + amountToComplete,
                    remainingAmount: newRemaining <= 0 ? null : newRemaining,
                    _offlinePending: true,
                });
                updateDisplay();
            }
        }).then(function (result) {
            if (!result.queued) {
                // Mise à jour immédiate de la ligne, rechargement complet en arrière-plan
                if (result.data && result.data.transaction) {
                    const idx = transactions.findIndex(function (t) {
                        return String(t.id) === String(transactionId);
                    });
                    if (idx !== -1) {
                        transactions[idx] = result.data.transaction;
                        updateDisplay();
                    }
                }
                xalissReloadAfterWrite();
                if (!offline || offline.isOnline()) {
                    showNotification('Paiement complété avec succès !', 'success');
                }
            }
            return true;
        }).catch(function (error) {
            if (isSessionExpiredError(error)) {
                notifyApiError(error);
                return false;
            }
            if (isConflictError(error)) {
                notifyApiError(error);
                return false;
            }
            if (error && error.message && error.message.indexOf('modifié') !== -1) {
                xalissReloadFromServer(false);
            }
            notifyApiError(error, 'Impossible de compléter le paiement.');
            return false;
        });
    };

    patchTransactionOnFirestore = function (id, patch) {
        return apiFetch('/transactions/' + encodeURIComponent(String(id)) + '/', {
            method: 'PATCH',
            body: JSON.stringify(patch)
        });
    };

    persistTransactionsCache = function () {
        updateDisplay();
    };

    const originalSaveClientsList = saveClientsList;
    saveClientsList = function (accountId, data) {
        const payload = normalizeClientListPayload(data);
        const newClients = payload.clients;
        const oldMap = {};
        cachedClients.forEach(function (c) { oldMap[c.id] = c; });
        const newMap = {};
        newClients.forEach(function (c) { newMap[c.id] = c; });

        const tasks = [];

        newClients.forEach(function (client) {
            if (!oldMap[client.id]) {
                tasks.push({
                    path: '/clients/',
                    method: 'POST',
                    body: JSON.stringify(client),
                    label: 'Ajout client',
                });
                return;
            }
            if (JSON.stringify(oldMap[client.id]) !== JSON.stringify(client)) {
                tasks.push({
                    path: '/clients/' + encodeURIComponent(client.id) + '/',
                    method: 'PATCH',
                    body: JSON.stringify(client),
                    label: 'Modification client',
                });
            }
        });

        Object.keys(oldMap).forEach(function (id) {
            if (!newMap[id]) {
                tasks.push({
                    path: '/clients/' + encodeURIComponent(id) + '/',
                    method: 'DELETE',
                    body: null,
                    label: 'Suppression client',
                });
            }
        });

        if (tasks.length === 0) {
            persistClientsLocal(accountId, payload);
            return Promise.resolve();
        }

        if (offline && !offline.isOnline()) {
            return Promise.all(tasks.map(function (task) {
                return offline.enqueue(task);
            })).then(function () {
                persistClientsLocal(accountId, payload);
                return persistOfflineSnapshot();
            }).then(function () {
                return refreshOfflineConnectionStatus();
            }).then(function () {
                showNotification('Contacts enregistrés localement — sync à la reconnexion', 'warning', {
                    transient: true,
                    duration: 2800,
                });
            });
        }

        return Promise.all(tasks.map(function (task) {
            return apiFetchNetwork(task.path, {
                method: task.method,
                body: task.body,
            }).catch(function (error) {
                if (!isNetworkError(error)) throw error;
                return offline.enqueue(task);
            });
        })).then(function () {
            return xalissReloadAfterWrite();
        }).then(function () {
            persistClientsLocal(accountId, payload);
        }).catch(function (error) {
            notifyApiError(error, 'Impossible de synchroniser les contacts.');
            persistClientsLocal(accountId, payload);
        });
    };

    const originalSaveNotesList = saveNotesList;
    saveNotesList = function (accountId, data) {
        const payload = normalizeNoteListPayload(data);
        const newNotes = payload.notes;
        const oldMap = {};
        cachedNotes.forEach(function (n) { oldMap[n.id] = n; });
        const newMap = {};
        newNotes.forEach(function (n) { newMap[n.id] = n; });
        const result = { reminderEmailSent: false };

        const tasks = [];

        newNotes.forEach(function (note) {
            if (!oldMap[note.id]) {
                tasks.push({
                    path: '/notes/',
                    method: 'POST',
                    body: JSON.stringify(note),
                    label: 'Ajout note',
                });
                return;
            }
            if (JSON.stringify(oldMap[note.id]) !== JSON.stringify(note)) {
                tasks.push({
                    path: '/notes/' + encodeURIComponent(note.id) + '/',
                    method: 'PATCH',
                    body: JSON.stringify(note),
                    label: 'Modification note',
                });
            }
        });

        Object.keys(oldMap).forEach(function (id) {
            if (!newMap[id]) {
                tasks.push({
                    path: '/notes/' + encodeURIComponent(id) + '/',
                    method: 'DELETE',
                    body: null,
                    label: 'Suppression note',
                });
            }
        });

        if (tasks.length === 0) {
            persistNotesLocal(accountId, payload);
            return Promise.resolve(result);
        }

        // Affiche tout de suite la note (animation d’ajout incluse), puis sync serveur.
        persistNotesLocal(accountId, payload);

        if (offline && !offline.isOnline()) {
            return Promise.all(tasks.map(function (task) {
                return offline.enqueue(task);
            })).then(function () {
                return persistOfflineSnapshot();
            }).then(function () {
                return refreshOfflineConnectionStatus();
            }).then(function () {
                showNotification('Notes enregistrées localement — sync à la reconnexion', 'warning', {
                    transient: true,
                    duration: 2800,
                });
            });
        }

        return Promise.all(tasks.map(function (task) {
            return apiFetchNetwork(task.path, {
                method: task.method,
                body: task.body,
            }).then(function (data) {
                if (data && data.reminderEmailSent) {
                    result.reminderEmailSent = true;
                }
                return data;
            }).catch(function (error) {
                if (!isNetworkError(error)) throw error;
                return offline.enqueue(task);
            });
        })).then(function () {
            return xalissReloadAfterWrite().then(function () {
                return result;
            });
        }).catch(function (error) {
            notifyApiError(error, 'Impossible de synchroniser les notes.');
            persistNotesLocal(accountId, payload);
            return result;
        });
    };

    const originalSaveCategoriesList = saveCategoriesList;
    saveCategoriesList = function (accountId, data) {
        const payload = normalizeCategoryListPayload(data);
        const task = {
            path: '/categories/',
            method: 'PATCH',
            body: JSON.stringify(payload),
            label: 'Modification catégories',
        };

        if (offline && !offline.isOnline()) {
            return offline.enqueue(task).then(function () {
                persistCategoriesLocal(accountId, payload);
                return persistOfflineSnapshot();
            }).then(function () {
                return refreshOfflineConnectionStatus();
            }).then(function () {
                showNotification('Catégories enregistrées localement — sync à la reconnexion', 'warning', {
                    transient: true,
                    duration: 2800,
                });
            });
        }

        return apiFetchNetwork(task.path, {
            method: task.method,
            body: task.body,
        }).then(function (data) {
            persistCategoriesLocal(accountId, { categories: data.categories || payload.categories });
            return persistOfflineSnapshot();
        }).catch(function (error) {
            if (offline && isNetworkError(error)) {
                return offline.enqueue(task).then(function () {
                    persistCategoriesLocal(accountId, payload);
                    return persistOfflineSnapshot();
                });
            }
            notifyApiError(error, 'Impossible de synchroniser les catégories.');
            originalSaveCategoriesList(accountId, payload);
        });
    };

    function applyRolePermissionsUI() {
        const p = cfg.permissions || {};
        const show = function (el, allowed) {
            if (!el) return;
            if (allowed) {
                el.removeAttribute('hidden');
                el.style.display = '';
                el.disabled = false;
            } else {
                el.setAttribute('hidden', 'hidden');
                el.style.display = 'none';
                el.disabled = true;
            }
        };

        document.querySelectorAll('#transactionsList .delete-btn').forEach(function (btn) {
            show(btn, !!p.canDeleteTransaction);
        });
        document.querySelectorAll('[data-client-delete]').forEach(function (btn) {
            show(btn, !!p.canDeleteClient);
        });

        show(document.getElementById('clientsClearAllBtn'), !!p.canDeleteClient);
        show(document.getElementById('companyProfileSave'), !!p.canEditOrganisation);
        show(document.getElementById('categoriesViewAllBtn'), !!p.canEditOrganisation);

        ['companyName', 'companyAddress', 'companyPhone', 'companyEmail', 'companyWebsite'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.readOnly = !p.canEditOrganisation;
        });

        const currencyEl = document.getElementById('userCurrencyLabel');
        if (currencyEl) {
            currencyEl.disabled = !p.canEditOrganisation;
            const trigger = currencyEl.closest('.kp-select-wrap')
                ? currencyEl.closest('.kp-select-wrap').querySelector('.kp-select-trigger')
                : null;
            if (trigger) trigger.disabled = !p.canEditOrganisation;
        }

        const clientAddForm = document.getElementById('clientAddForm');
        if (clientAddForm && !p.canWriteClient) {
            clientAddForm.querySelectorAll('input, select, textarea, button').forEach(function (el) {
                el.disabled = true;
            });
        } else if (clientAddForm) {
            clientAddForm.querySelectorAll('input, select, textarea, button').forEach(function (el) {
                el.disabled = false;
            });
        }

        const categoryAddForm = document.getElementById('categoryAddForm');
        if (categoryAddForm) {
            categoryAddForm.querySelectorAll('input, select, textarea, button').forEach(function (el) {
                el.disabled = !p.canEditOrganisation;
            });
        }
        document.querySelectorAll('button[form="categoryAddForm"], [data-category-delete]').forEach(function (el) {
            el.disabled = !p.canEditOrganisation;
        });

        ['incomeForm', 'expenseForm'].forEach(function (formId) {
            const form = document.getElementById(formId);
            if (!form) return;
            form.querySelectorAll('input, select, textarea, button[type="submit"]').forEach(function (el) {
                el.disabled = p.canWriteTransaction === false;
            });
        });
    }
    window.applyRolePermissionsUI = applyRolePermissionsUI;

    function patchCompanyProfileSave() {
        const btn = document.getElementById('companyProfileSave');
        if (!btn || btn.dataset.xalissDjangoBound === '1') return;
        if (cfg.permissions && !cfg.permissions.canEditOrganisation) return;
        btn.dataset.xalissDjangoBound = '1';

        btn.addEventListener('click', function () {
            const nameEl = document.getElementById('companyName');
            const addrEl = document.getElementById('companyAddress');
            const phoneEl = document.getElementById('companyPhone');
            const emailEl = document.getElementById('companyEmail');
            const webEl = document.getElementById('companyWebsite');
            const payload = normalizeCompanyProfilePayload({
                name: nameEl && nameEl.value ? nameEl.value : '',
                address: addrEl && addrEl.value ? addrEl.value : '',
                phone: phoneEl && phoneEl.value ? phoneEl.value : '',
                email: emailEl && emailEl.value ? emailEl.value : '',
                website: webEl && webEl.value ? webEl.value : ''
            });
            const accId = getCurrentAccountId();

            apiWriteOrQueue('/organisation/profil/', {
                method: 'PATCH',
                body: JSON.stringify(payload)
            }, {
                label: 'Profil organisation',
                localApply: function () {
                    persistCompanyProfileLocal(accId, payload);
                    updateCompanyWebsiteQrPreview();
                }
            }).then(function (result) {
                if (!result.queued) {
                    const profil = normalizeCompanyProfilePayload(payload);
                    persistCompanyProfileLocal(accId, profil);
                }
                updateCompanyWebsiteQrPreview();
                showNotification('Coordonnées entreprise enregistrées.', 'success');
                if (!result.queued) return xalissReloadAfterWrite();
            }).catch(function (error) {
                notifyApiError(error, 'Impossible d\'enregistrer les coordonnées.');
                persistCompanyProfileLocal(accId, payload);
            });
        });
    }

    function initParametresPasswordToggles() {
        document.querySelectorAll('.parametres-password-toggle').forEach(function (btn) {
            if (btn.dataset.xalissBound === '1') return;
            btn.dataset.xalissBound = '1';
            btn.addEventListener('click', function () {
                const wrap = btn.closest('.parametres-password-wrap');
                if (!wrap) return;
                const input = wrap.querySelector('input[type="password"], input[type="text"]');
                if (!input) return;
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                btn.setAttribute('aria-label', isPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
                btn.classList.toggle('is-visible', isPassword);
            });
        });
    }

    function patchUserProfileSave() {
        const btn = document.getElementById('userProfileSave');
        if (!btn || btn.dataset.xalissDjangoBound === '1') return;
        btn.dataset.xalissDjangoBound = '1';

        btn.addEventListener('click', function () {
            const firstEl = document.getElementById('userFirstName');
            const lastEl = document.getElementById('userLastName');
            const emailEl = document.getElementById('userEmail');
            const countryEl = document.getElementById('userCountry');
            const cityEl = document.getElementById('userCity');
            const currencyEl = document.getElementById('userCurrencyLabel');
            const payload = {
                firstName: firstEl && firstEl.value ? firstEl.value.trim() : '',
                lastName: lastEl && lastEl.value ? lastEl.value.trim() : '',
                email: emailEl && emailEl.value ? emailEl.value.trim() : '',
                country: countryEl && countryEl.value ? countryEl.value.trim() : '',
                city: cityEl && cityEl.value ? cityEl.value.trim() : '',
            };
            if (currencyEl && !currencyEl.disabled) {
                payload.currencyLabel = currencyEl.value;
            }

            apiFetch('/utilisateur/profil/', {
                method: 'PATCH',
                body: JSON.stringify(payload),
            }).then(function (data) {
                const profil = data.profil || {};
                if (typeof applyUserProfileToForm === 'function') {
                    applyUserProfileToForm(profil);
                }
                if (typeof applyOrgAppSettingsFromApi === 'function') {
                    applyOrgAppSettingsFromApi({ currencyLabel: profil.currencyLabel });
                }
                if (window.XALISS_DJANGO && profil.email) {
                    window.XALISS_DJANGO.userEmail = profil.email;
                }
                if (profil.pendingEmail) {
                    showNotification(
                        'Confirmation envoyée à ' + profil.pendingEmail
                        + '. Votre e-mail actuel reste actif jusqu’à confirmation.',
                        'info',
                        { duration: 7000 }
                    );
                } else {
                    showNotification('Profil enregistré.', 'success');
                }
            }).catch(function (error) {
                notifyApiError(error, 'Impossible d\'enregistrer le profil.');
            });
        });
    }

    function patchUserPasswordSave() {
        const btn = document.getElementById('userPasswordSave');
        if (!btn || btn.dataset.xalissDjangoBound === '1') return;
        btn.dataset.xalissDjangoBound = '1';

        btn.addEventListener('click', function () {
            const currentEl = document.getElementById('userCurrentPassword');
            const newEl = document.getElementById('userNewPassword');
            const confirmEl = document.getElementById('userConfirmPassword');
            const currentGroup = document.getElementById('userCurrentPasswordGroup');
            const hasCurrent = currentEl && !currentEl.disabled;

            const payload = {
                newPassword: newEl && newEl.value ? newEl.value : '',
                confirmPassword: confirmEl && confirmEl.value ? confirmEl.value : '',
            };
            if (hasCurrent) {
                payload.currentPassword = currentEl.value || '';
            }

            apiFetch('/utilisateur/mot-de-passe/', {
                method: 'POST',
                body: JSON.stringify(payload),
            }).then(function () {
                if (typeof clearUserPasswordFields === 'function') {
                    clearUserPasswordFields();
                }
                if (typeof applyUserPasswordUiState === 'function') {
                    applyUserPasswordUiState(true);
                }
                showNotification('Sécurité : mot de passe mis à jour.', 'success', { history: true });
            }).catch(function (error) {
                notifyApiError(error, 'Impossible de modifier le mot de passe.');
            });
        });
    }

    function bootDjangoApp() {
        patchCompanyProfileSave();
        patchUserProfileSave();
        patchUserPasswordSave();
        initParametresPasswordToggles();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () {
                scheduleAppBoot();
                setTimeout(applyRolePermissionsUI, 0);
            });
        } else {
            scheduleAppBoot();
            setTimeout(applyRolePermissionsUI, 0);
        }
    }

    bootDjangoApp();
})();
