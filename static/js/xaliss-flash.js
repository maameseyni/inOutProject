/**
 * Notifications toast Xaliss (app + auth) et messages après redirection.
 */
(function (global) {
    var NOTIFICATION_COLORS = {
        success: '#10b981',
        error: '#ef4444',
        info: '#43277d',
        warning: '#f59e0b',
    };
    var MAX_NOTIFICATION_HISTORY = 60;
    var stylesInjected = false;

    function getNotificationStorageKey() {
        var cfg = global.XALISS_DJANGO || {};
        var userId = cfg.userId || 'anonymous';
        var orgSlug = cfg.orgSlug || 'default';
        return 'xaliss_notifications_' + orgSlug + '_' + userId;
    }

    function getWelcomeNotificationFlagKey() {
        return getNotificationStorageKey() + '_welcome_v1';
    }

    function readNotificationHistory() {
        var raw = global.localStorage.getItem(getNotificationStorageKey());
        if (!raw) return [];
        try {
            var list = JSON.parse(raw);
            if (!Array.isArray(list)) return [];
            return list.filter(function (item) {
                return !(item && item.systemId === 'security-session');
            });
        } catch (e) {
            return [];
        }
    }

    function writeNotificationHistory(list) {
        global.localStorage.setItem(getNotificationStorageKey(), JSON.stringify(list.slice(0, MAX_NOTIFICATION_HISTORY)));
        global.dispatchEvent(new CustomEvent('xaliss:notifications-updated'));
    }

    function addNotificationToHistory(message, type, extra) {
        var list = readNotificationHistory();
        var item = {
            id: String(Date.now()) + '-' + Math.random().toString(16).slice(2),
            message: String(message || ''),
            type: type || 'info',
            createdAt: new Date().toISOString(),
        };
        if (extra && typeof extra === 'object') {
            Object.keys(extra).forEach(function (key) {
                item[key] = extra[key];
            });
        }
        list.unshift(item);
        writeNotificationHistory(list);
    }

    function saveNotificationToHistory(message, type) {
        addNotificationToHistory(message, type);
    }

    function ensureWelcomeNotification() {
        if (!global.XALISS_DJANGO) return;
        var flagKey = getWelcomeNotificationFlagKey();
        if (global.localStorage.getItem(flagKey) === '1') return;

        var list = readNotificationHistory();
        var alreadyExists = list.some(function (item) {
            return item && item.systemId === 'welcome-v1';
        });
        if (!alreadyExists) {
            addNotificationToHistory(
                'Bienvenue sur Xaliss. Votre espace est prêt.',
                'info',
                { systemId: 'welcome-v1' }
            );
        }
        global.localStorage.setItem(flagKey, '1');
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

    function isTransientConcurrencyMessage(message) {
        var text = String(message || '').toLowerCase();
        return text.indexOf('modifie cette donnée') !== -1
            || text.indexOf('rechargez avant') !== -1
            || text.indexOf('rechargez la page') !== -1
            || text.indexOf('changé sur le serveur') !== -1;
    }

    function showNotification(message, type, options) {
        if (!message) return;
        injectNotificationStyles();

        var opts = options && typeof options === 'object' ? options : {};
        var transient = opts.transient === true || isTransientConcurrencyMessage(message);
        var duration = opts.duration != null ? opts.duration : (transient ? 2500 : 4000);
        var notifType = type || 'error';
        var bg = NOTIFICATION_COLORS[notifType] || NOTIFICATION_COLORS.error;
        // Les toasts d'app (erreurs, validations, sync…) restent à l'écran.
        // Seuls les événements explicites (history: true) alimentent le centre de notifications.
        if (opts.history === true) {
            saveNotificationToHistory(message, notifType);
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
        ensureWelcomeNotification();
        showFlashMessageFromStorage();
        showDjangoMessages();
    }

    global.showNotification = showNotification;
    global.xalissGetNotifications = readNotificationHistory;
    global.xalissAddNotification = addNotificationToHistory;
    global.xalissEnsureWelcomeNotification = ensureWelcomeNotification;
    global.xalissClearNotifications = function () {
        writeNotificationHistory([]);
    };
    global.showFlashMessageFromStorage = showFlashMessageFromStorage;
    global.showDjangoMessages = showDjangoMessages;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootFlashMessages);
    } else {
        bootFlashMessages();
    }
})(window);
