/**
 * Soft-nav backoffice Xaliss — partials HTML/JSON sans rechargement full page.
 *
 * API côté serveur :
 *   GET ?partial=users|payments → fragment HTML panneau
 *   GET ?partial=refresh (+ X-BO-Partial) → JSON multi-panneaux
 *   POST abo action en XHR → JsonResponse
 */
(function (window, document) {
    'use strict';

    var FETCH_HEADERS = {
        'X-Requested-With': 'XMLHttpRequest',
        'X-BO-Partial': '1',
        Accept: 'application/json, text/html;q=0.9,*/*;q=0.8',
    };

    var navToken = 0;

    function qsFromUrl(url) {
        try {
            return new URL(url, window.location.origin);
        } catch (e) {
            return null;
        }
    }

    function stripPartialParams(urlObj) {
        if (!urlObj) return '';
        urlObj.searchParams.delete('partial');
        return urlObj.pathname + (urlObj.search || '') + (urlObj.hash || '');
    }

    function setLoading(on) {
        document.body.classList.toggle('is-bo-loading', !!on);
        document.body.setAttribute('aria-busy', on ? 'true' : 'false');
    }

    function replaceOuter(id, html) {
        var current = document.getElementById(id);
        if (!current || !html) return false;
        var wrap = document.createElement('div');
        wrap.innerHTML = String(html).trim();
        var neu = wrap.firstElementChild;
        if (!neu) return false;
        current.replaceWith(neu);
        return true;
    }

    function replaceByIdFromDoc(id, doc) {
        var oldEl = document.getElementById(id);
        var neu = doc.getElementById(id);
        if (!oldEl || !neu) return false;
        oldEl.replaceWith(neu);
        return true;
    }

    function csrfToken() {
        var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        if (m) return decodeURIComponent(m[1]);
        var input = document.querySelector('input[name="csrfmiddlewaretoken"]');
        return input ? input.value : '';
    }

    /**
     * Soft-navigate dashboard : period (refresh JSON) ou listes (HTML partial).
     * @param {string} url absolute or relative (peut contenir hash)
     * @param {object} opts
     *   - mode: 'refresh' | 'users' | 'payments' | 'auto'
     *   - keepFocusSearch: bool
     *   - tab: force tab after load
     *   - push: history push (default true)
     */
    async function softNavigate(url, opts) {
        opts = opts || {};
        var parsed = qsFromUrl(url);
        if (!parsed) {
            window.location.assign(url);
            return false;
        }

        var hash = (parsed.hash || '').replace(/^#/, '');
        var mode = opts.mode || 'auto';
        if (mode === 'auto') {
            if (hash === 'utilisateurs' || hash === 'users') mode = 'users';
            else if (hash === 'paiements' || hash === 'payments') mode = 'payments';
            else if (hash === 'finances' || hash === 'finance' || hash === 'charges') mode = 'finances';
            else mode = 'refresh';
        }

        var token = ++navToken;
        setLoading(true);

        var focusSearch = !!opts.keepFocusSearch;
        var searchValue = '';
        var selectionStart = null;
        var selectionEnd = null;
        if (focusSearch) {
            var qEl = document.getElementById('bo-q');
            if (qEl) {
                searchValue = qEl.value;
                try {
                    selectionStart = qEl.selectionStart;
                    selectionEnd = qEl.selectionEnd;
                } catch (e) {}
            }
        }

        try {
            if (mode === 'users' || mode === 'payments' || mode === 'finances') {
                var listParams = new URLSearchParams(parsed.search);
                var partialName = mode === 'users' ? 'users' : (mode === 'payments' ? 'payments' : 'finances');
                listParams.set('partial', partialName);
                var listUrl = parsed.pathname + '?' + listParams.toString();
                var listRes = await fetch(listUrl, {
                    credentials: 'same-origin',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        Accept: 'text/html',
                    },
                });
                if (!listRes.ok) throw new Error('partial ' + mode + ' ' + listRes.status);
                if (token !== navToken) return false;
                var listHtml = await listRes.text();
                var targetId = mode === 'users'
                    ? 'panel-utilisateurs'
                    : (mode === 'payments' ? 'panel-paiements' : 'panel-finances');
                if (!replaceOuter(targetId, listHtml)) throw new Error('swap ' + targetId);

                if (typeof window.boAfterPanelSwap === 'function') {
                    window.boAfterPanelSwap(mode, opts);
                }
            } else {
                var refreshParams = new URLSearchParams(parsed.search);
                refreshParams.set('partial', 'refresh');
                var refreshUrl = parsed.pathname + '?' + refreshParams.toString();
                var res = await fetch(refreshUrl, {
                    credentials: 'same-origin',
                    headers: FETCH_HEADERS,
                });
                if (!res.ok) throw new Error('refresh ' + res.status);
                var data = await res.json();
                if (token !== navToken) return false;
                if (!data || !data.ok || !data.html) throw new Error('bad refresh payload');

                if (typeof window.boDestroyCharts === 'function') {
                    window.boDestroyCharts();
                }

                Object.keys(data.html).forEach(function (id) {
                    replaceOuter(id, data.html[id]);
                });

                var label = document.getElementById('bo-period-active-label');
                if (label && data.periode_label) label.textContent = data.periode_label;

                // Sync period form hiddens for next list navigations
                var periodForm = document.getElementById('bo-period-form');
                if (periodForm) {
                    var duHidden = periodForm.querySelector('input[name="du"]');
                    var auHidden = periodForm.querySelector('input[name="au"]');
                    // du/au live in range fields; period form uses shared ids
                    var fromInput = document.getElementById('boPeriodFrom');
                    var toInput = document.getElementById('boPeriodTo');
                    var dayInput = document.getElementById('boPeriodDay');
                    if (typeof window.setKpDateValue === 'function') {
                        if (data.periode_du) {
                            if (dayInput) window.setKpDateValue('boPeriodDay', data.periode_du, false);
                            if (fromInput) window.setKpDateValue('boPeriodFrom', data.periode_du, false);
                        }
                        if (data.periode_au && toInput) {
                            window.setKpDateValue('boPeriodTo', data.periode_au, false);
                        }
                        if (!data.periode_du && !data.periode_au) {
                            if (dayInput) window.setKpDateValue('boPeriodDay', '', false);
                            if (fromInput) window.setKpDateValue('boPeriodFrom', '', false);
                            if (toInput) window.setKpDateValue('boPeriodTo', '', false);
                        }
                    }
                    // preset highlight
                    periodForm.querySelectorAll('[data-periode-preset]').forEach(function (btn) {
                        var key = btn.getAttribute('data-periode-preset') || '';
                        btn.classList.toggle('is-active', key === (data.periode || 'all'));
                    });
                    // Mode jour / plage
                    var mode = data.periode_mode || 'range';
                    periodForm.querySelectorAll('.bo-period-mode-btn').forEach(function (btn) {
                        btn.classList.toggle(
                            'is-active',
                            btn.getAttribute('data-period-mode') === mode
                        );
                    });
                    var dayFields = document.getElementById('boPeriodDayFields');
                    var rangeFields = document.getElementById('boPeriodRangeFields');
                    if (dayFields) dayFields.classList.toggle('is-hidden', mode !== 'day');
                    if (rangeFields) rangeFields.classList.toggle('is-hidden', mode === 'day');
                }

                if (typeof window.boApplyChartsJson === 'function') {
                    window.boApplyChartsJson(data.charts_json);
                }
                if (typeof window.boAfterPanelSwap === 'function') {
                    window.boAfterPanelSwap('refresh', opts);
                }
            }

            var clean = stripPartialParams(parsed);
            if (opts.push !== false) {
                window.history.pushState({ boSoft: true }, '', clean);
            } else {
                window.history.replaceState({ boSoft: true }, '', clean);
            }

            if (focusSearch) {
                var q2 = document.getElementById('bo-q');
                if (q2) {
                    q2.focus({ preventScroll: true });
                    try {
                        if (selectionStart != null) {
                            q2.setSelectionRange(selectionStart, selectionEnd);
                        } else {
                            var len = q2.value.length;
                            q2.setSelectionRange(len, len);
                        }
                    } catch (e2) {}
                }
            }

            // Tab déjà géré par boAfterPanelSwap ; n'appeler qu'en secours
            if (opts.tab && typeof window.boSetTab === 'function' && !window.boAfterPanelSwap) {
                window.boSetTab(opts.tab, false, { scrollTop: false, keepView: true });
            }

            return true;
        } catch (err) {
            if (window.console && console.warn) {
                console.warn('[bo-soft]', err);
            }
            window.location.assign(stripPartialParams(parsed) || url);
            return false;
        } finally {
            if (token === navToken) setLoading(false);
        }
    }

    /**
     * Soft POST for abonnement actions on detail page.
     */
    async function softAboAction(form) {
        if (!form) return false;
        setLoading(true);
        try {
            var fd = new FormData(form);
            var res = await fetch(form.action, {
                method: 'POST',
                body: fd,
                credentials: 'same-origin',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    Accept: 'application/json',
                    'X-CSRFToken': csrfToken(),
                },
            });
            var data = await res.json();
            if (!res.ok || !data) throw new Error('action failed');
            var next = data.next || window.location.href;
            // Soft reload fiche (HTML full) then swap shell
            var pageRes = await fetch(next.split('#')[0], {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html' },
            });
            if (!pageRes.ok) throw new Error('reload ' + pageRes.status);
            var html = await pageRes.text();
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var newShell = doc.querySelector('.bo-shell--detail') || doc.querySelector('.bo-shell');
            var oldShell = document.querySelector('.bo-shell--detail') || document.querySelector('.bo-shell');
            if (newShell && oldShell) {
                oldShell.replaceWith(newShell);
                if (typeof window.initKpSelectFields === 'function') {
                    window.initKpSelectFields();
                }
                bindDetailActions();
                var hash = (next.indexOf('#') >= 0) ? next.slice(next.indexOf('#')) : '';
                window.history.replaceState({ boSoft: true }, '', next);
                if (hash) {
                    var el = document.querySelector(hash);
                    if (el) el.scrollIntoView({ block: 'start' });
                }
                // flash toast
                showToast(data.message || (data.ok ? 'Action appliquée.' : 'Erreur'), data.level || 'info');
                return true;
            }
            window.location.assign(next);
            return false;
        } catch (err) {
            if (window.console && console.warn) console.warn('[bo-action]', err);
            form.submit();
            return false;
        } finally {
            setLoading(false);
        }
    }

    function showToast(message, level) {
        if (!message) return;
        if (typeof global.showNotification === 'function') {
            global.showNotification(message, level || 'info', { duration: 5000 });
            return;
        }
        var stack = document.querySelector('.bo-flash-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.className = 'bo-flash-stack';
            stack.setAttribute('role', 'status');
            var shell = document.querySelector('.bo-shell--detail') || document.querySelector('.bo-shell');
            if (shell) shell.prepend(stack);
            else document.body.prepend(stack);
        }
        var el = document.createElement('div');
        el.className = 'bo-flash bo-flash--' + (level || 'info');
        el.textContent = message;
        stack.appendChild(el);
        setTimeout(function () {
            el.classList.add('is-leaving');
            setTimeout(function () { el.remove(); }, 320);
        }, 4200);
    }

    function bindDetailActions() {
        document.querySelectorAll('form.bo-abo-action').forEach(function (form) {
            if (form.dataset.boSoftBound === '1') return;
            form.dataset.boSoftBound = '1';
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                softAboAction(form);
            });
        });
    }

    function isInternalBoHref(href) {
        if (!href || href.charAt(0) === '#') return false;
        if (href.indexOf('javascript:') === 0) return false;
        if (href.indexOf('export') !== -1) return false;
        try {
            var u = new URL(href, window.location.origin);
            if (u.origin !== window.location.origin) return false;
            return u.pathname.indexOf('/backoffice') === 0 && u.pathname.indexOf('/export') === -1;
        } catch (e) {
            return false;
        }
    }

    /** Intercept dashboard list/pagination/filter links for soft-nav. */
    function bindDashboardLinkInterception() {
        document.addEventListener(
            'click',
            function (e) {
                if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                    return;
                }
                var a = e.target.closest && e.target.closest('a[href]');
                if (!a || a.getAttribute('download') != null) return;
                if (a.target === '_blank') return;
                var href = a.getAttribute('href') || '';
                if (!isInternalBoHref(href) && href.charAt(0) !== '?') return;

                // Relative query links are dashboard filters
                var abs;
                try {
                    abs = new URL(href, window.location.href);
                } catch (err) {
                    return;
                }
                if (abs.pathname.indexOf('/backoffice') === -1) return;
                if (abs.pathname.indexOf('/utilisateurs/') !== -1 || abs.pathname.indexOf('/organisations/') !== -1) {
                    return; // fiches = navigation classique
                }
                if (abs.pathname.indexOf('export') !== -1) return;

                var hash = (abs.hash || '').replace(/^#/, '');
                var softHashes = {
                    utilisateurs: 'users',
                    paiements: 'payments',
                    finances: 'finances',
                    vue: 'refresh',
                    stats: 'refresh',
                    outils: null,
                    'bo-alertes': 'refresh',
                    'bo-users': 'users',
                    'bo-paiements': 'payments',
                    'bo-finances': 'finances',
                    'bo-charges': 'finances',
                };
                // pure in-page anchor without query: tab only
                if ((!abs.search || abs.search === '?') && hash && !softHashes[hash] && href.charAt(0) === '#') {
                    return;
                }

                if (hash === 'outils') return;

                e.preventDefault();
                var mode = 'refresh';
                if (hash === 'utilisateurs' || hash === 'users' || hash === 'bo-users') mode = 'users';
                else if (hash === 'paiements' || hash === 'payments' || hash === 'bo-paiements') mode = 'payments';
                else if (hash === 'finances' || hash === 'finance' || hash === 'charges' || hash === 'bo-finances' || hash === 'bo-charges') mode = 'finances';
                // chips statut / KPI -> may change filters on users list
                if (abs.searchParams.has('q') || abs.searchParams.has('statut') ||
                    abs.searchParams.has('plan') || abs.searchParams.has('page') ||
                    abs.searchParams.has('all') || abs.searchParams.has('user_scope') ||
                    abs.searchParams.has('non_verifies')) {
                    if (mode === 'refresh' && (hash === 'utilisateurs' || !hash)) mode = 'users';
                }
                if (abs.searchParams.has('pay_q') || abs.searchParams.has('pay_statut') ||
                    abs.searchParams.has('pay_page') || abs.searchParams.has('pay_all')) {
                    if (mode === 'refresh' && (hash === 'paiements' || !hash)) mode = 'payments';
                }
                if (abs.searchParams.has('charge_q') || abs.searchParams.has('charge_categorie') ||
                    abs.searchParams.has('charge_page') || abs.searchParams.has('charge_all')) {
                    if (mode === 'refresh' && (hash === 'finances' || !hash)) mode = 'finances';
                }
                // period presets etc use navigate() with full refresh
                softNavigate(abs.pathname + abs.search + abs.hash, {
                    mode: mode,
                    tab: hash === 'stats' ? 'stats'
                        : hash === 'vue' ? 'vue'
                        : hash === 'paiements' ? 'paiements'
                        : hash === 'finances' ? 'finances'
                        : hash === 'utilisateurs' ? 'utilisateurs'
                        : mode === 'users' ? 'utilisateurs'
                        : mode === 'payments' ? 'paiements'
                        : mode === 'finances' ? 'finances'
                        : null,
                });
            },
            true
        );
    }

    window.BoSoft = {
        softNavigate: softNavigate,
        softAboAction: softAboAction,
        bindDetailActions: bindDetailActions,
        setLoading: setLoading,
    };

    document.addEventListener('DOMContentLoaded', function () {
        if (document.body.classList.contains('bo-body--detail')) {
            bindDetailActions();
        }
        if (document.body.classList.contains('bo-body') && !document.body.classList.contains('bo-body--detail')) {
            bindDashboardLinkInterception();
        }
        window.addEventListener('popstate', function () {
            if (!document.body.classList.contains('bo-body--detail')) {
                window.location.reload();
            }
        });
    });
})(window, document);
