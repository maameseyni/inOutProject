/**
 * Notifications toast Xaliss (app + auth) et messages après redirection.
 * Historique cloche : cache local + sync serveur (via django-bridge).
 */
(function (global) {
    var NOTIFICATION_COLORS = {
        success: '#10b981',
        error: '#ef4444',
        info: '#f59e0b',
        warning: '#f59e0b',
    };
    var MAX_NOTIFICATION_HISTORY = 60;
    var stylesInjected = false;
    var audioCtx = null;
    var lastAlertSoundAt = 0;
    var pendingToastBatch = [];
    var toastBatchTimer = null;
    var memoryCache = null;
    var ignoredSystemIds = {};

    function getNotificationStorageKey() {
        var cfg = global.XALISS_DJANGO || {};
        var userId = cfg.userId || 'anonymous';
        var orgSlug = cfg.orgSlug || 'default';
        return 'xaliss_notifications_' + orgSlug + '_' + userId;
    }

    function getIgnoredStorageKey() {
        return getNotificationStorageKey() + '_ignored';
    }

    function getWelcomeNotificationFlagKey() {
        return getNotificationStorageKey() + '_welcome_v1';
    }

    function loadIgnoredFromStorage() {
        ignoredSystemIds = {};
        try {
            var raw = global.localStorage.getItem(getIgnoredStorageKey());
            var list = raw ? JSON.parse(raw) : [];
            if (Array.isArray(list)) {
                list.forEach(function (sid) {
                    if (sid) ignoredSystemIds[String(sid)] = true;
                });
            }
        } catch (e) {
            ignoredSystemIds = {};
        }
    }

    function persistIgnored() {
        var list = Object.keys(ignoredSystemIds);
        global.localStorage.setItem(getIgnoredStorageKey(), JSON.stringify(list));
    }

    function markSystemIdsIgnored(systemIds) {
        var changed = false;
        (systemIds || []).forEach(function (sid) {
            var key = String(sid || '').trim();
            if (!key || ignoredSystemIds[key]) return;
            ignoredSystemIds[key] = true;
            changed = true;
        });
        if (changed) persistIgnored();
    }

    function isSystemIdIgnored(systemId) {
        if (!systemId) return false;
        return !!ignoredSystemIds[String(systemId)];
    }

    function normalizeItem(item) {
        if (!item || typeof item !== 'object') return null;
        if (item.systemId === 'security-session') return null;
        var next = {
            id: String(item.id || (Date.now() + '-' + Math.random().toString(16).slice(2))),
            message: String(item.message || ''),
            type: item.type || 'info',
            createdAt: item.createdAt || new Date().toISOString(),
        };
        if (item.systemId) next.systemId = String(item.systemId);
        if (next.systemId === 'welcome-v1' && next.type !== 'success') {
            next.type = 'success';
        }
        if (!next.message) return null;
        return next;
    }

    function readNotificationHistory() {
        if (memoryCache) {
            return memoryCache.slice();
        }
        var raw = global.localStorage.getItem(getNotificationStorageKey());
        if (!raw) {
            memoryCache = [];
            return [];
        }
        try {
            var list = JSON.parse(raw);
            if (!Array.isArray(list)) {
                memoryCache = [];
                return [];
            }
            memoryCache = list.map(normalizeItem).filter(Boolean);
            return memoryCache.slice();
        } catch (e) {
            memoryCache = [];
            return [];
        }
    }

    function writeNotificationHistory(list) {
        memoryCache = (Array.isArray(list) ? list : []).map(normalizeItem).filter(Boolean)
            .slice(0, MAX_NOTIFICATION_HISTORY);
        global.localStorage.setItem(
            getNotificationStorageKey(),
            JSON.stringify(memoryCache)
        );
        global.dispatchEvent(new CustomEvent('xaliss:notifications-updated'));
    }

    function replaceNotificationHistory(list, ignoredList) {
        if (Array.isArray(ignoredList)) {
            ignoredSystemIds = {};
            ignoredList.forEach(function (sid) {
                if (sid) ignoredSystemIds[String(sid)] = true;
            });
            persistIgnored();
        }
        writeNotificationHistory(list || []);
    }

    function playNotificationSound() {
        var now = Date.now();
        if (now - lastAlertSoundAt < 1400) return;
        lastAlertSoundAt = now;
        try {
            var Ctx = global.AudioContext || global.webkitAudioContext;
            if (!Ctx) return;
            if (!audioCtx) audioCtx = new Ctx();
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(function () {});
            }
            var t0 = audioCtx.currentTime;
            var notes = [
                { freq: 880, at: 0, dur: 0.14 },
                { freq: 1174.66, at: 0.11, dur: 0.22 },
            ];
            notes.forEach(function (note) {
                var osc = audioCtx.createOscillator();
                var gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(note.freq, t0 + note.at);
                gain.gain.setValueAtTime(0.0001, t0 + note.at);
                gain.gain.exponentialRampToValueAtTime(0.14, t0 + note.at + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.at + note.dur);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(t0 + note.at);
                osc.stop(t0 + note.at + note.dur + 0.02);
            });
        } catch (e) {
            /* ignore */
        }
    }

    function unlockNotificationAudio() {
        try {
            var Ctx = global.AudioContext || global.webkitAudioContext;
            if (!Ctx) return;
            if (!audioCtx) audioCtx = new Ctx();
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(function () {});
            }
        } catch (e) {
            /* ignore */
        }
    }

    ['pointerdown', 'keydown', 'touchstart'].forEach(function (evtName) {
        global.addEventListener(evtName, unlockNotificationAudio, { once: true, passive: true });
    });

    function vibrateForNotification() {
        try {
            if (global.navigator && typeof global.navigator.vibrate === 'function') {
                global.navigator.vibrate([70, 40, 90]);
            }
        } catch (e) {
            /* ignore */
        }
    }

    function pulseNotificationBell() {
        global.dispatchEvent(new CustomEvent('xaliss:notification-alert'));
    }

    function alertNewNotification() {
        playNotificationSound();
        vibrateForNotification();
        pulseNotificationBell();
    }

    function injectNotificationStyles() {
        if (stylesInjected) return;
        stylesInjected = true;
        var style = document.createElement('style');
        style.textContent =
            '@keyframes xalissSlideIn{from{transform:translateX(400px);opacity:0}to{transform:translateX(0);opacity:1}}' +
            '@keyframes xalissSlideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(400px);opacity:0}}';
        document.head.appendChild(style);
    }

    function showNotification(message, type, options) {
        if (!message) return;
        injectNotificationStyles();

        var opts = options && typeof options === 'object' ? options : {};
        var transient = opts.transient === true || isTransientConcurrencyMessage(message);
        var duration = opts.duration != null ? opts.duration : (transient ? 2500 : 4000);
        var notifType = type || 'error';
        var bg = NOTIFICATION_COLORS[notifType] || NOTIFICATION_COLORS.error;
        if (opts.history === true) {
            saveNotificationToHistory(message, notifType);
            alertNewNotification();
        }

        if (transient) {
            document.querySelectorAll('.kp-notification.kp-notification-transient').forEach(function (el) {
                el.remove();
            });
        }

        var notification = document.createElement('div');
        notification.className = 'kp-notification' + (transient ? ' kp-notification-transient' : '');
        notification.setAttribute('role', 'status');
        notification.style.cssText =
            'position:fixed;top:20px;right:20px;background:' + bg + ';color:#fff;padding:15px 25px;' +
            'border-radius:8px;box-shadow:0 5px 15px rgba(0,0,0,0.3);z-index:10000;' +
            'max-width:min(420px,calc(100vw - 40px));animation:xalissSlideIn 0.3s ease;';
        notification.textContent = message;
        document.body.appendChild(notification);

        global.setTimeout(function () {
            notification.style.animation = 'xalissSlideOut 0.3s ease';
            global.setTimeout(function () {
                if (notification.parentNode) notification.remove();
            }, 300);
        }, duration);
    }

    function flushToastBatch() {
        toastBatchTimer = null;
        if (!pendingToastBatch.length) return;
        var items = pendingToastBatch.slice();
        pendingToastBatch = [];
        if (items.length === 1) {
            showNotification(items[0].message, items[0].type, {
                transient: true,
                duration: 4800,
            });
            return;
        }
        showNotification(
            items.length + ' nouvelles notifications — ouvrez la cloche pour les voir.',
            'info',
            {
                transient: true,
                duration: 5200,
            }
        );
    }

    function queueCenterToast(message, type) {
        pendingToastBatch.push({ message: String(message || ''), type: type || 'info' });
        if (toastBatchTimer) return;
        toastBatchTimer = global.setTimeout(flushToastBatch, 180);
    }

    function addNotificationToHistory(message, type, extra) {
        var extras = extra && typeof extra === 'object' ? extra : {};
        var systemId = extras.systemId ? String(extras.systemId) : '';
        if (systemId && isSystemIdIgnored(systemId)) {
            return null;
        }

        var list = readNotificationHistory();
        if (systemId) {
            var exists = list.some(function (item) {
                return item && item.systemId === systemId;
            });
            if (exists) return null;
        }

        var item = {
            id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
            message: String(message || ''),
            type: type || 'info',
            createdAt: new Date().toISOString(),
        };
        Object.keys(extras).forEach(function (key) {
            if (key === 'silent' || key === 'toast' || key === 'alert') return;
            item[key] = extras[key];
        });
        list.unshift(item);
        writeNotificationHistory(list);

        if (typeof global.xalissNotificationsRemoteAdd === 'function') {
            global.xalissNotificationsRemoteAdd(item);
        }

        var silent = !!extras.silent;
        if (!silent) {
            alertNewNotification();
            if (extras.toast !== false) {
                queueCenterToast(item.message, item.type);
            }
        }
        return item;
    }

    function saveNotificationToHistory(message, type) {
        addNotificationToHistory(message, type, { silent: true, toast: false });
    }

    function ensureWelcomeNotification() {
        if (!global.XALISS_DJANGO) return;
        var flagKey = getWelcomeNotificationFlagKey();
        if (global.localStorage.getItem(flagKey) === '1') return;

        var list = readNotificationHistory();
        var alreadyExists = list.some(function (item) {
            return item && item.systemId === 'welcome-v1';
        });
        if (!alreadyExists && !isSystemIdIgnored('welcome-v1')) {
            addNotificationToHistory(
                'Bienvenue sur Xaliss. Votre espace est prêt.',
                'success',
                { systemId: 'welcome-v1', silent: true }
            );
        }
        global.localStorage.setItem(flagKey, '1');
    }

    function isTransientConcurrencyMessage(message) {
        var text = String(message || '').toLowerCase();
        return text.indexOf('modifie cette donnée') !== -1
            || text.indexOf('rechargez avant') !== -1
            || text.indexOf('rechargez la page') !== -1
            || text.indexOf('changé sur le serveur') !== -1;
    }

    function mapDjangoMessageType(tags) {
        var parts = String(tags || '').split(/\s+/);
        if (parts.indexOf('error') !== -1) return 'error';
        if (parts.indexOf('success') !== -1) return 'success';
        if (parts.indexOf('warning') !== -1) return 'warning';
        return 'info';
    }

    function showDjangoMessages() {
        var el = document.getElementById('xaliss-django-messages');
        if (!el) return;

        var list;
        try {
            list = JSON.parse(el.textContent);
        } catch (e) {
            el.remove();
            return;
        }
        el.remove();

        if (!Array.isArray(list)) return;

        list.forEach(function (item, index) {
            if (!item || !item.text) return;
            global.setTimeout(function () {
                showNotification(item.text, item.type || mapDjangoMessageType(item.tags), {
                    duration: item.duration || 5000,
                });
            }, index * 320);
        });
    }

    function showFlashMessageFromStorage() {
        var raw = global.sessionStorage.getItem('xaliss_flash_message');
        if (!raw) return;
        global.sessionStorage.removeItem('xaliss_flash_message');

        var flash;
        try {
            flash = JSON.parse(raw);
        } catch (e) {
            return;
        }
        if (!flash || !flash.text) return;

        showNotification(flash.text, flash.type || 'warning', {
            duration: flash.duration || 5500,
        });
    }

    function bootFlashMessages() {
        loadIgnoredFromStorage();
        readNotificationHistory();
        ensureWelcomeNotification();
        showFlashMessageFromStorage();
        showDjangoMessages();
    }

    global.showNotification = showNotification;
    global.xalissGetNotifications = readNotificationHistory;
    global.xalissAddNotification = addNotificationToHistory;
    global.xalissEnsureWelcomeNotification = ensureWelcomeNotification;
    global.xalissPlayNotificationSound = playNotificationSound;
    global.xalissReplaceNotifications = replaceNotificationHistory;
    global.xalissIsNotificationSystemIdIgnored = isSystemIdIgnored;
    global.xalissMarkNotificationSystemIdsIgnored = markSystemIdsIgnored;
    global.xalissClearNotifications = function () {
        var list = readNotificationHistory();
        var systemIds = list
            .map(function (item) { return item && item.systemId; })
            .filter(Boolean);
        markSystemIdsIgnored(systemIds);
        writeNotificationHistory([]);
        if (typeof global.xalissNotificationsRemoteClear === 'function') {
            global.xalissNotificationsRemoteClear();
        }
    };
    global.xalissRemoveNotificationsBySystemIdPrefix = function (prefix) {
        var needle = String(prefix || '');
        if (!needle) return;
        var list = readNotificationHistory();
        var removedIds = [];
        var next = list.filter(function (item) {
            var match = item && item.systemId && String(item.systemId).indexOf(needle) === 0;
            if (match && item.systemId) removedIds.push(item.systemId);
            return !match;
        });
        if (next.length !== list.length) {
            markSystemIdsIgnored(removedIds);
            writeNotificationHistory(next);
        }
        if (typeof global.xalissNotificationsRemoteRemovePrefix === 'function') {
            global.xalissNotificationsRemoteRemovePrefix(needle);
        }
    };
    global.showFlashMessageFromStorage = showFlashMessageFromStorage;
    global.showDjangoMessages = showDjangoMessages;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootFlashMessages);
    } else {
        bootFlashMessages();
    }
})(window);
