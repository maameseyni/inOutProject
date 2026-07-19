/**
 * Enregistrement PWA KaayPrint — service worker + invitation à installer
 */
(function () {
    if (!('serviceWorker' in navigator)) return;

    var deferredInstallPrompt = null;
    var installBtn = null;
    var installBlock = null;

    function getInstallButton() {
        if (!installBtn) {
            installBtn = document.getElementById('pwaInstallBtn');
        }
        return installBtn;
    }

    function getInstallBlock() {
        if (!installBlock) {
            installBlock = document.getElementById('pwaSettingsBlock');
        }
        return installBlock;
    }

    function showInstallButton() {
        var btn = getInstallButton();
        var block = getInstallBlock();
        if (block) {
            block.hidden = false;
        }
        if (!btn) return;
        btn.hidden = false;
        btn.style.display = '';
    }

    function hideInstallButton() {
        var btn = getInstallButton();
        var block = getInstallBlock();
        if (block) {
            block.hidden = true;
        }
        if (!btn) return;
        btn.hidden = true;
        btn.style.display = 'none';
    }

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    }

    window.addEventListener('beforeinstallprompt', function (event) {
        event.preventDefault();
        deferredInstallPrompt = event;
        if (!isStandalone()) {
            showInstallButton();
        }
    });

    window.addEventListener('appinstalled', function () {
        deferredInstallPrompt = null;
        hideInstallButton();
    });

    window.installKaayPrintPwa = function () {
        if (!deferredInstallPrompt) {
            if (typeof showNotification === 'function') {
                showNotification(
                    'Utilisez le menu du navigateur (⋮) puis « Ajouter à l\'écran d\'accueil ».',
                    'info'
                );
            }
            return;
        }
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(function (choice) {
            if (choice.outcome !== 'accepted') {
                deferredInstallPrompt = null;
            }
        });
    };

    function bindInstallButton() {
        var btn = getInstallButton();
        if (!btn || btn.dataset.pwaBound === '1') return;
        btn.dataset.pwaBound = '1';
        btn.addEventListener('click', function () {
            window.installKaayPrintPwa();
        });
    }

    window.addEventListener('load', function () {
        bindInstallButton();
        if (isStandalone()) {
            hideInstallButton();
        }

        navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
            .then(function (registration) {
                registration.update();
            })
            .catch(function (error) {
                console.warn('Service worker non enregistré:', error);
            });
    });
})();
