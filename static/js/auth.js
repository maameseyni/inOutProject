(function () {
    function initAuthTabs() {
        var tabContainer = document.querySelector('.auth-tabs');
        var tabs = document.querySelectorAll('.auth-tab');
        var panels = document.querySelectorAll('.auth-panel');
        var slider = tabContainer ? tabContainer.querySelector('.auth-tabs-slider') : null;
        if (!tabContainer || !tabs.length || !panels.length || !slider) return;

        function updateAuthTabSlider(tabName, instant) {
            var activeTab = tabContainer.querySelector('.auth-tab[data-tab="' + tabName + '"]');
            if (!activeTab) return;

            if (instant) slider.classList.add('is-instant');
            var containerRect = tabContainer.getBoundingClientRect();
            var tabRect = activeTab.getBoundingClientRect();
            slider.style.width = tabRect.width + 'px';
            slider.style.transform = 'translateX(' + (tabRect.left - containerRect.left) + 'px)';

            if (instant) {
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () {
                        slider.classList.remove('is-instant');
                    });
                });
            }
        }

        function activateTab(tabName, instant) {
            tabs.forEach(function (tab) {
                var isActive = tab.dataset.tab === tabName;
                tab.classList.toggle('is-active', isActive);
                tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });
            panels.forEach(function (panel) {
                var show = panel.dataset.panel === tabName;
                panel.hidden = !show;
            });
            updateAuthTabSlider(tabName, !!instant);
            if (window.history && window.history.replaceState) {
                var url = new URL(window.location.href);
                if (tabName === 'inscription') {
                    url.searchParams.set('onglet', 'inscription');
                } else {
                    url.searchParams.delete('onglet');
                }
                window.history.replaceState({}, '', url);
            }
        }

        tabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                activateTab(tab.dataset.tab, false);
            });
        });

        window.addEventListener('resize', function () {
            var active = tabContainer.querySelector('.auth-tab.is-active');
            if (active) updateAuthTabSlider(active.dataset.tab, true);
        });

        var initial = document.body.dataset.authTab || 'connexion';
        activateTab(initial, true);
    }

    function initPasswordToggles() {
        document.querySelectorAll('.auth-password-toggle').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var wrap = btn.closest('.auth-field-wrap');
                if (!wrap) return;
                var input = wrap.querySelector('input[type="password"], input[type="text"]');
                if (!input) return;
                var isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                btn.setAttribute('aria-label', isPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
                btn.classList.toggle('is-visible', isPassword);
            });
        });
    }

    function initKpSelects() {
        if (typeof window.initKpSelectFields === 'function') {
            window.initKpSelectFields();
        }
    }

    function bootAuthPage() {
        initAuthTabs();
        initPasswordToggles();
        initKpSelects();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootAuthPage);
    } else {
        bootAuthPage();
    }
})();
