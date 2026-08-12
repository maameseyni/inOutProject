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
    var boConfirmCallback = null;
    var boConfirmBound = false;
    var boConfirmPhraseExpected = '';

    var BO_CONFIRM_ICONS = {
        danger:
            '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
        warning:
            '<path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
        info:
            '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>' +
            '<path d="M12 8h.01M11 12h1v4h1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
        launch:
            '<path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
            '<path d="M5 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    };

    var BO_TOAST_ICONS = {
        success:
            '<path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
        error:
            '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
        warning:
            '<path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
            '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
        info:
            '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>' +
            '<path d="M12 8h.01M11 12h1v4h1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    };

    var BO_TOAST_KICKERS = {
        success: 'Succès',
        error: 'Erreur',
        warning: 'Attention',
        info: 'Info',
    };

    function ensureConfirmModal() {
        var modal = document.getElementById('boConfirmModal');
        if (modal) return modal;
        var wrap = document.createElement('div');
        wrap.innerHTML =
            '<div id="boConfirmModal" class="bo-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="boConfirmTitle" hidden>' +
            '<div class="bo-confirm-dialog">' +
            '<h2 class="bo-confirm-title">' +
            '<svg id="boConfirmIcon" class="bo-confirm-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"></svg>' +
            '<span id="boConfirmTitle">Confirmer</span></h2>' +
            '<p id="boConfirmMessage" class="bo-confirm-message"></p>' +
            '<p id="boConfirmDetail" class="bo-confirm-detail" hidden></p>' +
            '<div id="boConfirmPhraseWrap" class="bo-confirm-phrase" hidden>' +
            '<label for="boConfirmPhraseInput" class="bo-confirm-phrase-label">' +
            'Pour confirmer, tapez <strong id="boConfirmPhraseExpected"></strong></label>' +
            '<input type="text" id="boConfirmPhraseInput" class="bo-confirm-phrase-input" autocomplete="off" spellcheck="false">' +
            '</div>' +
            '<div class="bo-confirm-actions">' +
            '<button type="button" class="bo-confirm-btn bo-confirm-btn--cancel" id="boConfirmCancel">Annuler</button>' +
            '<button type="button" class="bo-confirm-btn bo-confirm-btn--ok" id="boConfirmOk">' +
            '<span id="boConfirmOkLabel">Confirmer</span></button>' +
            '</div></div></div>';
        document.body.appendChild(wrap.firstElementChild);
        return document.getElementById('boConfirmModal');
    }

    function normalizeConfirmPhrase(value) {
        return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
    }

    function syncConfirmPhraseOk() {
        var okBtn = document.getElementById('boConfirmOk');
        var input = document.getElementById('boConfirmPhraseInput');
        if (!okBtn) return;
        if (!boConfirmPhraseExpected) {
            okBtn.disabled = false;
            return;
        }
        var typed = input ? normalizeConfirmPhrase(input.value) : '';
        okBtn.disabled = typed !== boConfirmPhraseExpected;
    }

    function closeBoConfirm() {
        var modal = document.getElementById('boConfirmModal');
        if (!modal) return;
        modal.hidden = true;
        modal.style.display = 'none';
        boConfirmCallback = null;
        boConfirmPhraseExpected = '';
        document.body.classList.remove('bo-confirm-open');
        var phraseWrap = document.getElementById('boConfirmPhraseWrap');
        var phraseInput = document.getElementById('boConfirmPhraseInput');
        if (phraseWrap) phraseWrap.hidden = true;
        if (phraseInput) phraseInput.value = '';
        var okBtn = document.getElementById('boConfirmOk');
        if (okBtn) okBtn.disabled = false;
    }

    function showBoConfirm(options) {
        options = options || {};
        var modal = ensureConfirmModal();
        var titleEl = document.getElementById('boConfirmTitle');
        var messageEl = document.getElementById('boConfirmMessage');
        var detailEl = document.getElementById('boConfirmDetail');
        var okLabelEl = document.getElementById('boConfirmOkLabel');
        var iconEl = document.getElementById('boConfirmIcon');
        var cancelBtn = document.getElementById('boConfirmCancel');
        var phraseWrap = document.getElementById('boConfirmPhraseWrap');
        var phraseExpectedEl = document.getElementById('boConfirmPhraseExpected');
        var phraseInput = document.getElementById('boConfirmPhraseInput');
        var okBtn = document.getElementById('boConfirmOk');
        if (!modal || !titleEl || !messageEl) return;

        var tone = options.tone || 'danger';
        if (tone !== 'warning' && tone !== 'info' && tone !== 'danger' && tone !== 'launch') tone = 'danger';
        modal.setAttribute('data-tone', tone);

        titleEl.textContent = options.title || 'Confirmer';
        messageEl.textContent = options.message || 'Confirmez-vous cette action ?';
        if (detailEl) {
            if (options.detail) {
                detailEl.textContent = options.detail;
                detailEl.hidden = false;
            } else {
                detailEl.textContent = '';
                detailEl.hidden = true;
            }
        }
        if (okLabelEl) okLabelEl.textContent = options.confirmLabel || 'Confirmer';
        if (iconEl) {
            iconEl.innerHTML = BO_CONFIRM_ICONS[tone] || BO_CONFIRM_ICONS.danger;
        }

        boConfirmPhraseExpected = normalizeConfirmPhrase(options.confirmPhrase || '');
        if (phraseWrap && phraseExpectedEl && phraseInput) {
            if (boConfirmPhraseExpected) {
                phraseExpectedEl.textContent = boConfirmPhraseExpected;
                phraseInput.value = '';
                phraseInput.placeholder = boConfirmPhraseExpected;
                phraseWrap.hidden = false;
                modal.classList.add('has-phrase');
            } else {
                phraseWrap.hidden = true;
                phraseInput.value = '';
                modal.classList.remove('has-phrase');
            }
        }
        syncConfirmPhraseOk();

        boConfirmCallback = typeof options.onConfirm === 'function' ? options.onConfirm : null;

        modal.hidden = false;
        modal.style.display = 'flex';
        document.body.classList.add('bo-confirm-open');
        if (boConfirmPhraseExpected && phraseInput) {
            phraseInput.focus();
        } else if (cancelBtn) {
            cancelBtn.focus();
        }
    }

    function initBoConfirmModal() {
        if (boConfirmBound) return;
        ensureConfirmModal();
        var modal = document.getElementById('boConfirmModal');
        var cancelBtn = document.getElementById('boConfirmCancel');
        var okBtn = document.getElementById('boConfirmOk');
        var phraseInput = document.getElementById('boConfirmPhraseInput');
        if (!modal) return;
        boConfirmBound = true;

        if (cancelBtn) cancelBtn.addEventListener('click', closeBoConfirm);
        if (okBtn) {
            okBtn.addEventListener('click', function () {
                if (okBtn.disabled) return;
                var cb = boConfirmCallback;
                var typed = phraseInput ? normalizeConfirmPhrase(phraseInput.value) : '';
                closeBoConfirm();
                if (typeof cb === 'function') cb(typed);
            });
        }
        if (phraseInput) {
            phraseInput.addEventListener('input', syncConfirmPhraseOk);
            phraseInput.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (okBtn && !okBtn.disabled) okBtn.click();
            });
        }
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeBoConfirm();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            if (!modal.hidden) closeBoConfirm();
        });
    }

    function formFieldValue(form, name) {
        var el = form.querySelector('[name="' + name + '"]');
        if (!el) return '';
        if (el.tagName === 'SELECT') {
            var opt = el.options[el.selectedIndex];
            return {
                value: el.value || '',
                label: opt ? (opt.textContent || '').trim() : (el.value || ''),
            };
        }
        return { value: el.value || '', label: el.value || '' };
    }

    function pluralJours(n) {
        var num = parseInt(n, 10);
        if (!num || num < 1) return '';
        return num + ' jour' + (num > 1 ? 's' : '');
    }

    function optionsFromAboForm(form) {
        var actionEl = form.querySelector('[name="action"]');
        var action = actionEl ? String(actionEl.value || '').trim() : '';
        var jours = formFieldValue(form, 'jours');
        var statut = formFieldValue(form, 'statut');
        var plan = formFieldValue(form, 'plan');
        var renouv = formFieldValue(form, 'value');
        var ctx = form.closest('[data-bo-org], [data-bo-jours-defaut]') || form;
        var orgDetail =
            form.getAttribute('data-bo-org') ||
            form.getAttribute('data-bo-confirm-detail') ||
            (ctx.getAttribute && ctx.getAttribute('data-bo-org')) ||
            '';
        var defautJours =
            form.getAttribute('data-bo-jours-defaut') ||
            (ctx.getAttribute && ctx.getAttribute('data-bo-jours-defaut')) ||
            '';
        var joursLabel = pluralJours(jours.value) || pluralJours(defautJours);
        var titleEl = form.querySelector('.bo-abo-action-title');
        var titleText = titleEl ? String(titleEl.textContent || '').trim() : '';
        var isDemarrer = /Démarrer/.test(titleText);

        var presets = {
            prolonger_essai: {
                title: 'Prolonger l’essai',
                message: joursLabel
                    ? 'Prolonger l’essai de ' + joursLabel + ' ?'
                    : 'Prolonger l’essai avec la durée indiquée ?',
                confirmLabel: 'Prolonger',
                tone: 'info',
            },
            redemarrer_essai: {
                title: isDemarrer ? 'Démarrer un essai' : 'Redémarrer l’essai',
                message: isDemarrer
                    ? (joursLabel
                        ? 'Créer l’abonnement et démarrer un essai de ' + joursLabel + ' ?'
                        : 'Créer l’abonnement et démarrer un essai standard ?')
                    : (joursLabel
                        ? 'Remplacer l’essai en cours par un nouvel essai de ' + joursLabel + ' ?'
                        : 'Remplacer l’essai en cours par un nouvel essai ?'),
                confirmLabel: isDemarrer ? 'Démarrer' : 'Redémarrer',
                tone: 'warning',
            },
            prolonger_periode: {
                title: 'Prolonger le payant',
                message: joursLabel
                    ? 'Prolonger la période payante de ' + joursLabel + ' ?'
                    : 'Prolonger la période payante ?',
                confirmLabel: 'Prolonger',
                tone: 'info',
            },
            activer_payant: {
                title: 'Activer le payant',
                message: joursLabel
                    ? 'Activer une période payante de ' + joursLabel + ' ?'
                    : 'Activer une période payante ?',
                confirmLabel: 'Activer',
                tone: 'warning',
            },
            definir_statut: {
                title: 'Changer le statut',
                message: statut.label
                    ? 'Passer le statut à « ' + statut.label + ' » ?'
                    : 'Appliquer le nouveau statut ?',
                confirmLabel: 'Appliquer',
                tone: 'warning',
            },
            changer_plan: {
                title: 'Changer le plan',
                message: plan.label
                    ? 'Basculer vers le plan « ' + plan.label + ' » ?'
                    : 'Changer le plan d’abonnement ?',
                confirmLabel: 'Changer',
                tone: 'warning',
            },
            renouvellement: {
                title: 'Renouvellement auto',
                message: renouv.value === '0' || renouv.value === 'false'
                    ? 'Désactiver le renouvellement automatique ?'
                    : 'Activer le renouvellement automatique ?',
                confirmLabel: renouv.value === '0' || renouv.value === 'false' ? 'Désactiver' : 'Activer',
                tone: 'info',
            },
            synchroniser: {
                title: 'Synchroniser le statut',
                message: 'Réaligner le statut sur les dates d’essai / période ?',
                confirmLabel: 'Synchroniser',
                tone: 'info',
            },
        };

        var preset = presets[action] || {
            title: 'Confirmer l’action',
            message: 'Confirmez-vous cette action d’abonnement ?',
            confirmLabel: 'Confirmer',
            tone: 'info',
        };

        var detailParts = [];
        if (orgDetail) detailParts.push(orgDetail);
        if (action === 'definir_statut' && pluralJours(jours.value)) {
            detailParts.push('Jours si dates manquantes : ' + pluralJours(jours.value));
        }
        return {
            title: preset.title,
            message: preset.message,
            detail: detailParts.join(' · '),
            confirmLabel: preset.confirmLabel,
            tone: preset.tone,
        };
    }

    function optionsFromConfirmForm(form) {
        if (form.classList.contains('bo-abo-action')) {
            var aboOpts = optionsFromAboForm(form);
            // Attributs data-* optionnels pour surcharger
            if (form.hasAttribute('data-bo-confirm-title')) {
                aboOpts.title = form.getAttribute('data-bo-confirm-title');
            }
            if (form.hasAttribute('data-bo-confirm-message')) {
                aboOpts.message = form.getAttribute('data-bo-confirm-message');
            }
            if (form.hasAttribute('data-bo-confirm-ok')) {
                aboOpts.confirmLabel = form.getAttribute('data-bo-confirm-ok');
            }
            if (form.hasAttribute('data-bo-confirm-tone')) {
                aboOpts.tone = form.getAttribute('data-bo-confirm-tone');
            }
            if (form.hasAttribute('data-bo-confirm-detail')) {
                aboOpts.detail = form.getAttribute('data-bo-confirm-detail');
            }
            return aboOpts;
        }
        var opts = {
            title: form.getAttribute('data-bo-confirm-title') || 'Confirmer',
            message: form.getAttribute('data-bo-confirm-message') || 'Confirmez-vous cette action ?',
            detail: form.getAttribute('data-bo-confirm-detail') || '',
            confirmLabel: form.getAttribute('data-bo-confirm-ok') || 'Confirmer',
            tone: form.getAttribute('data-bo-confirm-tone') || 'danger',
            confirmPhrase: form.getAttribute('data-bo-confirm-phrase') || '',
        };
        // Si pas de détail fourni, reprendre l’e-mail du formulaire (ex. ajout d’accès).
        if (!opts.detail) {
            var emailField = form.querySelector('input[name="email"]');
            if (emailField && emailField.value) {
                opts.detail = String(emailField.value || '').trim();
            }
        }
        // Aperçu message broadcast
        if (form.classList.contains('bo-broadcast-form')) {
            var msgField = form.querySelector('textarea[name="message"]');
            var preview = msgField ? String(msgField.value || '').trim() : '';
            if (preview) {
                if (preview.length > 120) preview = preview.slice(0, 117) + '…';
                opts.detail = (opts.detail ? opts.detail + ' · ' : '') + '« ' + preview + ' »';
            }
        }
        return opts;
    }

    function bindConfirmForms() {
        document.addEventListener(
            'submit',
            function (e) {
                var form = e.target;
                if (!form || form.tagName !== 'FORM') return;
                var needsConfirm =
                    form.hasAttribute('data-bo-confirm') ||
                    form.classList.contains('bo-abo-action');
                if (!needsConfirm) return;
                if (form.dataset.boConfirmed === '1') {
                    delete form.dataset.boConfirmed;
                    return;
                }
                e.preventDefault();
                e.stopImmediatePropagation();
                var opts = optionsFromConfirmForm(form);
                opts.onConfirm = function (typedPhrase) {
                    if (opts.confirmPhrase) {
                        var hidden = form.querySelector('input[name="confirmation"]');
                        if (hidden) hidden.value = typedPhrase || '';
                    }
                    if (form.classList.contains('bo-abo-action')) {
                        softAboAction(form);
                        return;
                    }
                    form.dataset.boConfirmed = '1';
                    if (typeof form.requestSubmit === 'function') form.requestSubmit();
                    else form.submit();
                };
                showBoConfirm(opts);
            },
            true
        );
    }

    function normalizeToastLevel(level) {
        var raw = String(level || 'info').toLowerCase();
        if (raw.indexOf('success') !== -1) return 'success';
        if (raw.indexOf('error') !== -1 || raw.indexOf('danger') !== -1) return 'error';
        if (raw.indexOf('warn') !== -1) return 'warning';
        return 'info';
    }

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
        var tone = normalizeToastLevel(level);
        var stack = document.querySelector('.bo-toast-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.className = 'bo-toast-stack';
            stack.setAttribute('aria-live', 'polite');
            document.body.appendChild(stack);
        }
        var el = document.createElement('div');
        el.className = 'bo-toast bo-toast--' + tone;
        el.setAttribute('role', 'status');
        el.innerHTML =
            '<span class="bo-toast-icon" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="none">' + (BO_TOAST_ICONS[tone] || BO_TOAST_ICONS.info) + '</svg>' +
            '</span>' +
            '<span class="bo-toast-body">' +
            '<p class="bo-toast-kicker">' + (BO_TOAST_KICKERS[tone] || BO_TOAST_KICKERS.info) + '</p>' +
            '<p class="bo-toast-text"></p>' +
            '</span>';
        var textEl = el.querySelector('.bo-toast-text');
        if (textEl) textEl.textContent = message;
        stack.appendChild(el);
        setTimeout(function () {
            el.classList.add('is-leaving');
            setTimeout(function () { el.remove(); }, 300);
        }, 4600);
    }

    function installBoToastBridge() {
        window.showNotification = function (message, type, options) {
            showToast(message, type || 'info');
            if (options && options.history === true && typeof window.addNotificationToHistory === 'function') {
                try {
                    window.addNotificationToHistory(message, type || 'info', { silent: true, toast: false });
                } catch (e) { /* ignore */ }
            }
        };
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
        showToast: showToast,
        showConfirm: showBoConfirm,
    };

    // Avant DOMContentLoaded : remplace les toasts génériques pour les messages Django.
    installBoToastBridge();
    bindConfirmForms();

    function bootBoUi() {
        initBoConfirmModal();
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
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootBoUi);
    } else {
        bootBoUi();
    }
})(window, document);
