(function () {
    'use strict';

    const INVOICE_THEME_PRESETS = {
        xaliss: {
            preset: 'xaliss',
            accent: '#43277d',
            accentSecondary: '#e72060',
            gradientStart: '#fde8f0',
            gradientMid: '#faf0f5',
            gradientEnd: '#f6f4fa',
            logoFrame: false,
            logoFrameColor: '#ffffff',
            logoFrameBorder: false,
            logoFrameBorderColor: '#43277d',
        },
        blue: {
            preset: 'blue',
            accent: '#1e3a8a',
            accentSecondary: '#2563eb',
            gradientStart: '#eff6ff',
            gradientMid: '#f0f7ff',
            gradientEnd: '#f8fafc',
            logoFrame: false,
            logoFrameColor: '#ffffff',
            logoFrameBorder: false,
            logoFrameBorderColor: '#43277d',
        },
        green: {
            preset: 'green',
            accent: '#166534',
            accentSecondary: '#22c55e',
            gradientStart: '#ecfdf5',
            gradientMid: '#f0fdf4',
            gradientEnd: '#f8faf8',
            logoFrame: false,
            logoFrameColor: '#ffffff',
            logoFrameBorder: false,
            logoFrameBorderColor: '#43277d',
        },
        neutral: {
            preset: 'neutral',
            accent: '#374151',
            accentSecondary: '#6b7280',
            gradientStart: '#f9fafb',
            gradientMid: '#f3f4f6',
            gradientEnd: '#ffffff',
            logoFrame: false,
            logoFrameColor: '#ffffff',
            logoFrameBorder: false,
            logoFrameBorderColor: '#43277d',
        },
        coral: {
            preset: 'coral',
            accent: '#c2410c',
            accentSecondary: '#f97316',
            gradientStart: '#fff7ed',
            gradientMid: '#ffedd5',
            gradientEnd: '#fffbf7',
            logoFrame: false,
            logoFrameColor: '#ffffff',
            logoFrameBorder: false,
            logoFrameBorderColor: '#c2410c',
        },
        teal: {
            preset: 'teal',
            accent: '#0f766e',
            accentSecondary: '#14b8a6',
            gradientStart: '#f0fdfa',
            gradientMid: '#ccfbf1',
            gradientEnd: '#f8fffe',
            logoFrame: false,
            logoFrameColor: '#ffffff',
            logoFrameBorder: false,
            logoFrameBorderColor: '#0f766e',
        },
        wine: {
            preset: 'wine',
            accent: '#7f1d1d',
            accentSecondary: '#be123c',
            gradientStart: '#fef2f2',
            gradientMid: '#fce7f3',
            gradientEnd: '#fafafa',
            logoFrame: false,
            logoFrameColor: '#ffffff',
            logoFrameBorder: false,
            logoFrameBorderColor: '#7f1d1d',
        },
        gold: {
            preset: 'gold',
            accent: '#92400e',
            accentSecondary: '#d97706',
            gradientStart: '#fffbeb',
            gradientMid: '#fef3c7',
            gradientEnd: '#fffef8',
            logoFrame: false,
            logoFrameColor: '#ffffff',
            logoFrameBorder: false,
            logoFrameBorderColor: '#92400e',
        },
        violet: {
            preset: 'violet',
            accent: '#6d28d9',
            accentSecondary: '#a855f7',
            gradientStart: '#f5f3ff',
            gradientMid: '#ede9fe',
            gradientEnd: '#fafafa',
            logoFrame: false,
            logoFrameColor: '#ffffff',
            logoFrameBorder: false,
            logoFrameBorderColor: '#6d28d9',
        },
    };

    let invoicePaperRenderSeq = 0;
    let invoiceThemePreviewQrUrl = '';
    let invoiceThemeDraft = null;
    let invoiceThemeModalBound = false;

    function normalizeHexColor(value, fallback) {
        const raw = String(value || fallback || '').trim();
        return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : String(fallback || '#43277d').toLowerCase();
    }

    function parseThemeFlag(value) {
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'on' || value.toLowerCase() === 'yes';
        }
        return !!value;
    }

    function applyLogoFrameClasses(frame, theme) {
        if (!frame) return;
        const t = normalizeInvoiceTheme(theme);
        frame.classList.toggle('has-logo-frame', !!t.logoFrame);
        frame.classList.toggle('has-logo-outline', !!t.logoFrameBorder);
    }

    function normalizeInvoiceLayout(value) {
        const key = String(value || 'classique').trim().toLowerCase();
        if (key === 'editorial' || key === 'edito' || key === 'elegant' || key === 'élégant') return 'editorial';
        if (key === 'signature' || key === 'bold' || key === 'impact' || key === 'audacieux') return 'signature';
        return 'classique';
    }

    function normalizeInvoiceTheme(obj) {
        const source = obj && typeof obj === 'object' ? obj : {};
        const presetKey = String(source.preset || 'xaliss').trim().toLowerCase();
        const base = INVOICE_THEME_PRESETS[presetKey] || INVOICE_THEME_PRESETS.xaliss;
        const theme = {
            preset: INVOICE_THEME_PRESETS[presetKey] ? presetKey : 'custom',
            layout: normalizeInvoiceLayout(source.layout != null ? source.layout : base.layout),
            accent: normalizeHexColor(source.accent, base.accent),
            accentSecondary: normalizeHexColor(source.accentSecondary, base.accentSecondary),
            gradientStart: normalizeHexColor(source.gradientStart, base.gradientStart),
            gradientMid: normalizeHexColor(source.gradientMid, base.gradientMid),
            gradientEnd: normalizeHexColor(source.gradientEnd, base.gradientEnd),
            logoFrame: parseThemeFlag(source.logoFrame),
            logoFrameColor: normalizeHexColor(source.logoFrameColor, base.logoFrameColor),
            logoFrameBorder: parseThemeFlag(source.logoFrameBorder),
            logoFrameBorderColor: normalizeHexColor(source.logoFrameBorderColor, base.logoFrameBorderColor),
        };
        if (presetKey === 'custom' || !INVOICE_THEME_PRESETS[presetKey]) {
            theme.preset = 'custom';
        }
        return theme;
    }

    function getInvoiceThemePreset(presetKey) {
        const key = String(presetKey || 'xaliss').trim().toLowerCase();
        return normalizeInvoiceTheme(INVOICE_THEME_PRESETS[key] || INVOICE_THEME_PRESETS.xaliss);
    }

    function resolveInvoiceTheme(profile) {
        const company = typeof getCompanyProfileForInvoice === 'function'
            ? getCompanyProfileForInvoice()
            : (typeof loadCompanyProfile === 'function' ? loadCompanyProfile() : {});
        const source = profile || company;
        return normalizeInvoiceTheme(source.invoiceTheme || source.themeFacture || {});
    }

    function hexToRgb(hex) {
        const normalized = normalizeHexColor(hex, '#000000').slice(1);
        return {
            r: parseInt(normalized.slice(0, 2), 16),
            g: parseInt(normalized.slice(2, 4), 16),
            b: parseInt(normalized.slice(4, 6), 16),
        };
    }

    function hexToRgbString(hex) {
        const rgb = hexToRgb(hex);
        return rgb.r + ', ' + rgb.g + ', ' + rgb.b;
    }

    function applyInvoiceThemeVars(el, theme) {
        if (!el) return;
        const t = normalizeInvoiceTheme(theme);
        el.style.setProperty('--inv-accent', t.accent);
        el.style.setProperty('--inv-accent-rgb', hexToRgbString(t.accent));
        el.style.setProperty('--inv-accent-secondary', t.accentSecondary);
        el.style.setProperty('--inv-accent-secondary-rgb', hexToRgbString(t.accentSecondary));
        el.style.setProperty('--inv-gradient-start', t.gradientStart);
        el.style.setProperty('--inv-gradient-mid', t.gradientMid);
        el.style.setProperty('--inv-gradient-end', t.gradientEnd);
        el.style.setProperty('--inv-logo-frame-bg', t.logoFrameColor);
        el.style.setProperty('--inv-logo-frame-border', t.logoFrameBorderColor);
        el.classList.remove('invoice-layout--classique', 'invoice-layout--editorial', 'invoice-layout--signature');
        el.classList.add('invoice-layout--' + t.layout);
        el.setAttribute('data-layout', t.layout);
        applyLogoFrameClasses(el.querySelector('.invoice-logo-frame'), t);
    }

    function getSampleInvoiceTransaction() {
        const today = new Date();
        const isoDate = today.getFullYear() + '-'
            + String(today.getMonth() + 1).padStart(2, '0') + '-'
            + String(today.getDate()).padStart(2, '0') + 'T14:22:00';
        return {
            id: 'preview-sample',
            type: 'income',
            amount: 10000,
            remainingAmount: 5000,
            description: 'Sac en cuir noir\nBandoulière réglable incluse',
            date: isoDate,
            documentNumber: 'FAC-' + today.getFullYear() + '-00062',
            invoiceClient: 'Latyr KEBE',
        };
    }

    function buildInvoiceQrFallbackUrl(target) {
        const encoded = encodeURIComponent(String(target || '').trim());
        return 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encoded;
    }

    function resolveInvoiceQrTarget(company, options) {
        options = options || {};
        const profile = company || (typeof getCompanyProfileForInvoice === 'function' ? getCompanyProfileForInvoice() : {});
        const website = profile.website ? String(profile.website).trim() : '';
        const normalized = typeof normalizeCompanyWebsiteForQr === 'function'
            ? normalizeCompanyWebsiteForQr(website)
            : website;
        if (normalized) return normalized;
        if (options.forceQrPreview) {
            return options.qrPreviewUrl || 'https://www.xaliss.com';
        }
        return '';
    }

    function getInvoiceQrDataUrl(target) {
        const normalized = String(target || '').trim();
        if (!normalized) return Promise.resolve('');
        if (window.invoiceQrDataUrlCache && window.invoiceQrDataUrlCache[normalized]) {
            return Promise.resolve(window.invoiceQrDataUrlCache[normalized]);
        }
        return (typeof generateQrDataUrl === 'function' ? generateQrDataUrl(normalized) : Promise.resolve(''))
            .then(function (url) {
                return url || buildInvoiceQrFallbackUrl(normalized);
            })
            .catch(function () {
                return buildInvoiceQrFallbackUrl(normalized);
            })
            .then(function (url) {
                if (url) {
                    window.invoiceQrDataUrlCache = window.invoiceQrDataUrlCache || {};
                    window.invoiceQrDataUrlCache[normalized] = url;
                }
                return url || '';
            });
    }

    function buildInvoiceFooterHtml(qrDataUrl, theme) {
        const t = normalizeInvoiceTheme(theme);
        const gradId = 'invFootArG' + String(Date.now()) + String(Math.floor(Math.random() * 10000));
        if (qrDataUrl) {
            return '<div class="invoice-footer invoice-footer--split">' +
                '<div class="invoice-footer-copy">' +
                '<p class="invoice-qr-caption">Scannez et abonnez-vous !</p>' +
                '<p class="invoice-footer-text">Merci pour votre confiance</p>' +
                '</div>' +
                '<div class="invoice-footer-arrow" aria-hidden="true">' +
                '<svg viewBox="0 0 56 28" width="40" height="20" xmlns="http://www.w3.org/2000/svg">' +
                '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="1" y2="0">' +
                '<stop offset="0%" stop-color="' + escapeHtml(t.accent) + '"/>' +
                '<stop offset="100%" stop-color="' + escapeHtml(t.accentSecondary) + '"/></linearGradient></defs>' +
                '<path d="M4 14h36M38 8l12 6-12 6" stroke="url(#' + gradId + ')" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>' +
                '</div>' +
                '<div class="invoice-footer-qr">' +
                '<img class="invoice-qr-img" src="' + qrDataUrl + '" width="64" height="64" alt="QR code">' +
                '</div></div>';
        }
        return '<div class="invoice-footer invoice-footer--solo">' +
            '<p class="invoice-footer-text">Merci pour votre confiance</p></div>';
    }

    function buildInvoiceCompanyBlockHtml(company) {
        const addressLines = typeof formatAddressLines === 'function' ? formatAddressLines(company.address) : [];
        const hasCompany = (company.name && String(company.name).trim()) ||
            addressLines.length ||
            (company.phone && String(company.phone).trim()) ||
            (company.email && String(company.email).trim());
        if (!hasCompany) return '';
        let inner = '';
        if (company.name && String(company.name).trim()) {
            inner += '<p class="invoice-company-name">' + escapeHtml(String(company.name).trim()) + '</p>';
        }
        addressLines.forEach(function (line) {
            inner += '<div class="invoice-company-line">' + escapeHtml(line) + '</div>';
        });
        if (company.phone && String(company.phone).trim()) {
            inner += '<div class="invoice-company-line">Tél. ' + escapeHtml(String(company.phone).trim()) + '</div>';
        }
        if (company.email && String(company.email).trim()) {
            inner += '<div class="invoice-company-line">' + escapeHtml(String(company.email).trim()) + '</div>';
        }
        return '<div class="invoice-company-block">' + inner + '</div>';
    }

    function buildInvoicePaperHtml(transaction, options) {
        options = options || {};
        const company = typeof getCompanyProfileForInvoice === 'function'
            ? getCompanyProfileForInvoice()
            : (typeof loadCompanyProfile === 'function' ? loadCompanyProfile() : {});
        const theme = normalizeInvoiceTheme(options.theme || company.invoiceTheme);
        const paperId = options.paperId || 'invoicePaper';
        const typeLabel = transaction.type === 'income' ? 'Entrant' : 'Sortant';
        const dateFormatted = formatDate(transaction.date);
        const hasRemaining = transaction.remainingAmount != null && transaction.remainingAmount > 0;
        const factureNum = getInvoiceDocumentNumber(transaction);
        const logoSrc = options.logoSrc || resolveInvoiceLogoSource(company);
        const companyBlockHtml = buildInvoiceCompanyBlockHtml(company);
        const clientRaw = resolveTransactionClientName(transaction);
        const contactLabel = getTransactionContactLabel(transaction);
        const clientBlockHtml = clientRaw
            ? '<div class="invoice-client-row"><span class="invoice-client-label">' + contactLabel + ' :</span>' + escapeHtml(clientRaw) + '</div>'
            : '';
        const descSafe = transaction.description ? escapeHtml(transaction.description) : '-';
        const logoFrameClass = (theme.logoFrame ? ' has-logo-frame' : '') + (theme.logoFrameBorder ? ' has-logo-outline' : '');
        const footerHtml = options.footerHtml != null
            ? options.footerHtml
            : buildInvoiceFooterHtml('', theme);
        return '<div class="invoice-paper invoice-layout--' + escapeHtml(theme.layout) + '" data-layout="' + escapeHtml(theme.layout) + '" id="' + escapeHtml(paperId) + '">' +
            '<div class="invoice-header">' +
            '<div class="invoice-header-brand">' +
            '<div class="invoice-logo-frame' + logoFrameClass + '">' +
            '<img src="' + escapeHtml(logoSrc) + '" alt="' + escapeHtml((company.name && String(company.name).trim()) || 'Xaliss') + '" class="invoice-logo">' +
            '</div>' +
            '</div>' +
            '<div class="invoice-header-meta">' +
            '<p class="invoice-title">' + getInvoiceDocumentTitleUpper(transaction) + '</p>' +
            '<span class="invoice-num">N° : ' + escapeHtml(factureNum) + '</span>' +
            '</div>' +
            '</div>' +
            '<div class="invoice-parties">' +
            companyBlockHtml +
            clientBlockHtml +
            '</div>' +
            '<div class="invoice-body">' +
            '<table class="invoice-table">' +
            '<tr><td class="invoice-label">Date</td><td class="invoice-value">' + dateFormatted + '</td></tr>' +
            '<tr><td class="invoice-label">Type</td><td class="invoice-value">' + typeLabel + '</td></tr>' +
            '<tr class="invoice-row-desc"><td class="invoice-label">Description</td><td class="invoice-value">' + descSafe + '</td></tr>' +
            '<tr class="invoice-row-amount"><td class="invoice-label">Montant</td><td class="invoice-amount">' + formatAmount(transaction.amount) + '</td></tr>' +
            (hasRemaining ? '<tr class="invoice-row-remaining"><td class="invoice-label">Reste à payer</td><td class="invoice-value">' + formatAmount(transaction.remainingAmount) + '</td></tr>' : '') +
            '</table></div>' +
            footerHtml +
            '<p class="invoice-branding">Facture générée depuis www.xaliss.com</p>' +
            '</div>';
    }

    function renderInvoicePaper(container, transaction, options) {
        if (!container || !transaction) return Promise.resolve(null);
        options = options || {};
        const renderSeq = ++invoicePaperRenderSeq;
        const theme = normalizeInvoiceTheme(options.theme || resolveInvoiceTheme());
        const company = typeof getCompanyProfileForInvoice === 'function'
            ? getCompanyProfileForInvoice()
            : (typeof loadCompanyProfile === 'function' ? loadCompanyProfile() : {});
        const qrTarget = resolveInvoiceQrTarget(company, options);
        const cachedQr = options.cachedQrUrl ? String(options.cachedQrUrl) : '';
        const qrPromise = cachedQr
            ? Promise.resolve(cachedQr)
            : (qrTarget ? getInvoiceQrDataUrl(qrTarget) : Promise.resolve(''));

        return qrPromise.then(function (qrDataUrl) {
            if (renderSeq !== invoicePaperRenderSeq) return null;
            const freshCompany = typeof getCompanyProfileForInvoice === 'function'
                ? getCompanyProfileForInvoice()
                : company;
            const resolvedTheme = normalizeInvoiceTheme(options.theme || freshCompany.invoiceTheme);
            const footerHtml = buildInvoiceFooterHtml(qrDataUrl, resolvedTheme);
            container.innerHTML = buildInvoicePaperHtml(transaction, Object.assign({}, options, {
                theme: resolvedTheme,
                footerHtml: footerHtml,
            }));
            const paper = container.querySelector('.invoice-paper');
            if (paper) applyInvoiceThemeVars(paper, resolvedTheme);
            if (options.preloadLogo !== false && typeof preloadInvoiceLogo === 'function') {
                return preloadInvoiceLogo(true).then(function (url) {
                    if (renderSeq !== invoicePaperRenderSeq) return paper;
                    if (url && paper) {
                        var logoImg = paper.querySelector('img.invoice-logo');
                        if (logoImg) logoImg.src = url;
                    }
                    return paper;
                });
            }
            return paper;
        });
    }

    function scaleInvoicePaperToFit(container) {
        if (!container) return;
        const paper = container.querySelector('.invoice-paper');
        if (!paper) return;

        let wrap = paper.parentElement;
        if (!wrap || !wrap.classList.contains('invoice-paper-scale-wrap')) {
            wrap = document.createElement('div');
            wrap.className = 'invoice-paper-scale-wrap';
            paper.parentNode.insertBefore(wrap, paper);
            wrap.appendChild(paper);
        }

        /* Forme fixe 420×580 : on ne change jamais les dimensions CSS, seulement un scale uniforme. */
        const PAPER_W = 420;
        paper.style.transform = '';
        paper.style.setProperty('--inv-fit-scale', '1');
        paper.style.width = PAPER_W + 'px';
        paper.style.maxWidth = PAPER_W + 'px';
        paper.style.minWidth = PAPER_W + 'px';
        paper.style.minHeight = '580px';
        wrap.style.width = '';
        wrap.style.height = '';
        wrap.style.marginLeft = 'auto';
        wrap.style.marginRight = 'auto';

        requestAnimationFrame(function () {
            const styles = window.getComputedStyle(container);
            const padY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
            const padX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
            const availableH = container.clientHeight - padY - 4;
            const availableW = container.clientWidth - padX - 4;
            const neededH = Math.max(paper.offsetHeight, 580);
            const neededW = PAPER_W;
            if (!availableH || !neededH) return;

            const scaleH = availableH / neededH;
            const scaleW = availableW > 0 ? availableW / neededW : 1;
            let finalScale = Math.min(1, scaleH, scaleW);
            if (finalScale >= 0.98) finalScale = 0.94;
            finalScale = Math.max(0.62, finalScale);

            paper.style.transform = 'scale(' + finalScale + ')';
            paper.style.transformOrigin = 'top center';
            paper.style.setProperty('--inv-fit-scale', String(finalScale));
            wrap.style.width = Math.ceil(neededW * finalScale) + 'px';
            wrap.style.height = Math.ceil(neededH * finalScale) + 2 + 'px';
        });
    }

    function readInvoiceThemeControls() {
        const presetEl = document.getElementById('invoiceThemePreset');
        const layoutEl = document.getElementById('invoiceThemeLayout');
        const accentEl = document.getElementById('invoiceThemeAccent');
        const secondaryEl = document.getElementById('invoiceThemeAccentSecondary');
        const gradStartEl = document.getElementById('invoiceThemeGradientStart');
        const gradEndEl = document.getElementById('invoiceThemeGradientEnd');
        const frameEl = document.getElementById('invoiceThemeLogoFrame');
        const frameColorEl = document.getElementById('invoiceThemeLogoFrameColor');
        const frameBorderEl = document.getElementById('invoiceThemeLogoFrameBorder');
        const frameBorderColorEl = document.getElementById('invoiceThemeLogoFrameBorderColor');
        const layout = normalizeInvoiceLayout(layoutEl ? layoutEl.value : 'classique');
        const preset = presetEl ? presetEl.value : 'xaliss';
        if (preset !== 'custom' && INVOICE_THEME_PRESETS[preset]) {
            const base = getInvoiceThemePreset(preset);
            base.layout = layout;
            base.logoFrame = frameEl ? frameEl.checked : base.logoFrame;
            base.logoFrameColor = frameColorEl ? frameColorEl.value : base.logoFrameColor;
            base.logoFrameBorder = frameBorderEl ? frameBorderEl.checked : base.logoFrameBorder;
            base.logoFrameBorderColor = frameBorderColorEl ? frameBorderColorEl.value : base.logoFrameBorderColor;
            return normalizeInvoiceTheme(base);
        }
        return normalizeInvoiceTheme({
            preset: 'custom',
            layout: layout,
            accent: accentEl ? accentEl.value : undefined,
            accentSecondary: secondaryEl ? secondaryEl.value : undefined,
            gradientStart: gradStartEl ? gradStartEl.value : undefined,
            gradientMid: gradStartEl ? gradStartEl.value : undefined,
            gradientEnd: gradEndEl ? gradEndEl.value : undefined,
            logoFrame: frameEl ? frameEl.checked : false,
            logoFrameColor: frameColorEl ? frameColorEl.value : undefined,
            logoFrameBorder: frameBorderEl ? frameBorderEl.checked : false,
            logoFrameBorderColor: frameBorderColorEl ? frameBorderColorEl.value : undefined,
        });
    }

    function syncInvoiceThemeControls(theme) {
        const t = normalizeInvoiceTheme(theme);
        const presetEl = document.getElementById('invoiceThemePreset');
        const layoutEl = document.getElementById('invoiceThemeLayout');
        const accentEl = document.getElementById('invoiceThemeAccent');
        const secondaryEl = document.getElementById('invoiceThemeAccentSecondary');
        const gradStartEl = document.getElementById('invoiceThemeGradientStart');
        const gradEndEl = document.getElementById('invoiceThemeGradientEnd');
        const frameEl = document.getElementById('invoiceThemeLogoFrame');
        const frameColorEl = document.getElementById('invoiceThemeLogoFrameColor');
        const frameColorGroup = document.getElementById('invoiceThemeLogoFrameColorGroup');
        const frameBorderEl = document.getElementById('invoiceThemeLogoFrameBorder');
        const frameBorderColorEl = document.getElementById('invoiceThemeLogoFrameBorderColor');
        const frameBorderColorGroup = document.getElementById('invoiceThemeLogoFrameBorderColorGroup');
        if (presetEl) presetEl.value = INVOICE_THEME_PRESETS[t.preset] ? t.preset : 'custom';
        if (layoutEl) layoutEl.value = t.layout;
        if (accentEl) accentEl.value = t.accent;
        if (secondaryEl) secondaryEl.value = t.accentSecondary;
        if (gradStartEl) gradStartEl.value = t.gradientStart;
        if (gradEndEl) gradEndEl.value = t.gradientEnd;
        if (frameEl) frameEl.checked = !!t.logoFrame;
        if (frameColorEl) frameColorEl.value = t.logoFrameColor;
        if (frameColorGroup) frameColorGroup.hidden = !t.logoFrame;
        if (frameBorderEl) frameBorderEl.checked = !!t.logoFrameBorder;
        if (frameBorderColorEl) frameBorderColorEl.value = t.logoFrameBorderColor;
        if (frameBorderColorGroup) frameBorderColorGroup.hidden = !t.logoFrameBorder;
        document.querySelectorAll('.invoice-theme-preset-chip').forEach(function (chip) {
            chip.classList.toggle('is-active', chip.dataset.preset === (INVOICE_THEME_PRESETS[t.preset] ? t.preset : 'custom'));
        });
        document.querySelectorAll('.invoice-theme-layout-card').forEach(function (card) {
            const active = card.dataset.layout === t.layout;
            card.classList.toggle('is-active', active);
            card.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        syncAllColorPickerSwatches();
    }

    let colorPopoverBound = false;
    let colorPopoverTarget = null;
    let colorPopoverState = { h: 0, s: 1, v: 1 };
    let colorPopoverDrag = null;

    function hexToRgbChannels(hex) {
        const h = normalizeHexColor(hex, '#000000').slice(1);
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16),
        };
    }

    function rgbChannelsToHex(r, g, b) {
        return '#' + [r, g, b].map(function (v) {
            return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
        }).join('');
    }

    function rgbToHsv(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        const s = max === 0 ? 0 : d / max;
        const v = max;
        if (d !== 0) {
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
                case g: h = ((b - r) / d + 2); break;
                default: h = ((r - g) / d + 4); break;
            }
            h /= 6;
        }
        return { h: h * 360, s: s, v: v };
    }

    function hsvToRgb(h, s, v) {
        h = ((h % 360) + 360) % 360;
        const c = v * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = v - c;
        let rp = 0;
        let gp = 0;
        let bp = 0;
        if (h < 60) { rp = c; gp = x; }
        else if (h < 120) { rp = x; gp = c; }
        else if (h < 180) { gp = c; bp = x; }
        else if (h < 240) { gp = x; bp = c; }
        else if (h < 300) { rp = x; bp = c; }
        else { rp = c; bp = x; }
        return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
    }

    function updateColorPickerSwatch(input) {
        if (!input) return;
        const wrap = input.closest('.invoice-theme-color-picker');
        if (wrap) wrap.style.setProperty('--picker-color', normalizeHexColor(input.value, '#43277d'));
    }

    function syncAllColorPickerSwatches() {
        document.querySelectorAll('.invoice-theme-color-picker input[type="color"]').forEach(updateColorPickerSwatch);
    }

    function renderColorPopoverUi() {
        const sv = document.getElementById('invoiceThemeColorSv');
        const svThumb = document.getElementById('invoiceThemeColorSvThumb');
        const hueThumb = document.getElementById('invoiceThemeColorHueThumb');
        const preview = document.getElementById('invoiceThemeColorPreview');
        const hexInput = document.getElementById('invoiceThemeColorHex');
        if (!sv || !svThumb || !hueThumb || !preview || !hexInput) return;

        const rgb = hsvToRgb(colorPopoverState.h, colorPopoverState.s, colorPopoverState.v);
        const hex = rgbChannelsToHex(rgb.r, rgb.g, rgb.b);
        sv.style.background = 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl('
            + Math.round(colorPopoverState.h) + ', 100%, 50%))';
        svThumb.style.left = (colorPopoverState.s * 100) + '%';
        svThumb.style.top = ((1 - colorPopoverState.v) * 100) + '%';
        hueThumb.style.left = ((colorPopoverState.h / 360) * 100) + '%';
        hueThumb.style.backgroundColor = hex;
        preview.style.backgroundColor = hex;
        hexInput.value = hex;
    }

    function applyColorPopoverValue() {
        if (!colorPopoverTarget) return;
        const rgb = hsvToRgb(colorPopoverState.h, colorPopoverState.s, colorPopoverState.v);
        const hex = rgbChannelsToHex(rgb.r, rgb.g, rgb.b);
        colorPopoverTarget.value = hex;
        updateColorPickerSwatch(colorPopoverTarget);
        colorPopoverTarget.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function positionColorPopover(anchor) {
        const pop = document.getElementById('invoiceThemeColorPopover');
        if (!pop || !anchor) return;
        const rect = anchor.getBoundingClientRect();
        const margin = 8;
        pop.style.visibility = 'hidden';
        pop.hidden = false;
        const popRect = pop.getBoundingClientRect();
        let top = rect.bottom + margin;
        let left = rect.left + (rect.width / 2) - (popRect.width / 2);
        if (left + popRect.width > window.innerWidth - margin) {
            left = window.innerWidth - popRect.width - margin;
        }
        if (left < margin) left = margin;
        if (top + popRect.height > window.innerHeight - margin) {
            top = rect.top - popRect.height - margin;
        }
        if (top < margin) top = margin;
        pop.style.top = top + 'px';
        pop.style.left = left + 'px';
        pop.style.visibility = '';
    }

    function openColorPopover(input, anchor) {
        const pop = document.getElementById('invoiceThemeColorPopover');
        if (!pop || !input || !anchor) return;
        colorPopoverTarget = input;
        const rgb = hexToRgbChannels(input.value);
        colorPopoverState = rgbToHsv(rgb.r, rgb.g, rgb.b);
        renderColorPopoverUi();
        pop.hidden = false;
        positionColorPopover(anchor);
    }

    function closeColorPopover() {
        const pop = document.getElementById('invoiceThemeColorPopover');
        if (pop) pop.hidden = true;
        colorPopoverTarget = null;
        colorPopoverDrag = null;
    }

    function setColorFromPointer(type, clientX, clientY) {
        if (type === 'sv') {
            const sv = document.getElementById('invoiceThemeColorSv');
            if (!sv) return;
            const rect = sv.getBoundingClientRect();
            const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
            const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
            colorPopoverState.s = rect.width ? x / rect.width : 0;
            colorPopoverState.v = rect.height ? 1 - (y / rect.height) : 0;
        } else if (type === 'hue') {
            const hue = document.getElementById('invoiceThemeColorHue');
            if (!hue) return;
            const rect = hue.getBoundingClientRect();
            const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
            colorPopoverState.h = rect.width ? (x / rect.width) * 360 : 0;
        }
        renderColorPopoverUi();
        applyColorPopoverValue();
    }

    function initInvoiceThemeColorPickers() {
        if (colorPopoverBound) return;
        const pop = document.getElementById('invoiceThemeColorPopover');
        const sv = document.getElementById('invoiceThemeColorSv');
        const hue = document.getElementById('invoiceThemeColorHue');
        const hexInput = document.getElementById('invoiceThemeColorHex');
        if (!pop || !sv || !hue || !hexInput) return;
        colorPopoverBound = true;

        document.querySelectorAll('.invoice-theme-color-picker').forEach(function (wrap) {
            const input = wrap.querySelector('input[type="color"]');
            if (!input) return;
            updateColorPickerSwatch(input);
            wrap.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                openColorPopover(input, wrap);
            });
        });

        sv.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            colorPopoverDrag = 'sv';
            sv.setPointerCapture(e.pointerId);
            setColorFromPointer('sv', e.clientX, e.clientY);
        });
        hue.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            colorPopoverDrag = 'hue';
            hue.setPointerCapture(e.pointerId);
            setColorFromPointer('hue', e.clientX, e.clientY);
        });
        window.addEventListener('pointermove', function (e) {
            if (!colorPopoverDrag) return;
            setColorFromPointer(colorPopoverDrag, e.clientX, e.clientY);
        });
        window.addEventListener('pointerup', function () {
            colorPopoverDrag = null;
        });

        hexInput.addEventListener('input', function () {
            let raw = String(hexInput.value || '').trim();
            if (!raw.startsWith('#')) raw = '#' + raw;
            if (!/^#[0-9a-fA-F]{6}$/.test(raw)) return;
            const rgb = hexToRgbChannels(raw);
            colorPopoverState = rgbToHsv(rgb.r, rgb.g, rgb.b);
            renderColorPopoverUi();
            applyColorPopoverValue();
        });

        document.addEventListener('click', function (e) {
            if (pop.hidden) return;
            if (pop.contains(e.target)) return;
            if (e.target.closest('.invoice-theme-color-picker')) return;
            closeColorPopover();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !pop.hidden) closeColorPopover();
        });
        window.addEventListener('resize', function () {
            if (pop.hidden || !colorPopoverTarget) return;
            const wrap = colorPopoverTarget.closest('.invoice-theme-color-picker');
            if (wrap) positionColorPopover(wrap);
        });
    }

    function applyInvoiceThemePreviewLive(theme) {
        invoiceThemeDraft = normalizeInvoiceTheme(theme);
        document.querySelectorAll('.invoice-theme-preset-chip').forEach(function (chip) {
            const isPreset = invoiceThemeDraft.preset !== 'custom' && chip.dataset.preset === invoiceThemeDraft.preset;
            chip.classList.toggle('is-active', isPreset);
        });
        const host = document.getElementById('invoiceThemePreviewHost');
        const paper = host && host.querySelector('.invoice-paper');
        if (!paper) return;
        applyInvoiceThemeVars(paper, invoiceThemeDraft);
        applyLogoFrameClasses(paper.querySelector('.invoice-logo-frame'), invoiceThemeDraft);
        const stops = paper.querySelectorAll('.invoice-footer-arrow stop');
        if (stops.length >= 2) {
            stops[0].setAttribute('stop-color', invoiceThemeDraft.accent);
            stops[1].setAttribute('stop-color', invoiceThemeDraft.accentSecondary);
        }
        scaleInvoicePaperToFit(host);
    }

    function preloadInvoiceThemePreviewQr() {
        const company = typeof getCompanyProfileForInvoice === 'function'
            ? getCompanyProfileForInvoice()
            : {};
        const target = resolveInvoiceQrTarget(company, {
            forceQrPreview: true,
            qrPreviewUrl: 'https://www.xaliss.com',
        }) || 'https://www.xaliss.com';
        return getInvoiceQrDataUrl(target).then(function (url) {
            if (url) invoiceThemePreviewQrUrl = url;
            return invoiceThemePreviewQrUrl;
        });
    }

    function refreshInvoiceThemePreview(forceFullRender) {
        invoiceThemeDraft = readInvoiceThemeControls();
        const host = document.getElementById('invoiceThemePreviewHost');
        if (!host) return Promise.resolve();

        if (!forceFullRender && host.querySelector('.invoice-paper')) {
            applyInvoiceThemePreviewLive(invoiceThemeDraft);
            return Promise.resolve();
        }

        const buildPreview = function (qrUrl) {
            if (qrUrl) invoiceThemePreviewQrUrl = qrUrl;
            return renderInvoicePaper(host, getSampleInvoiceTransaction(), {
                paperId: 'invoiceThemePreviewPaper',
                theme: invoiceThemeDraft,
                preloadLogo: true,
                forceQrPreview: true,
                cachedQrUrl: invoiceThemePreviewQrUrl,
            }).then(function () {
                scaleInvoicePaperToFit(host);
            });
        };

        if (invoiceThemePreviewQrUrl) {
            return buildPreview(invoiceThemePreviewQrUrl);
        }
        return preloadInvoiceThemePreviewQr().then(buildPreview);
    }

    function openInvoiceThemeModal() {
        if (typeof ensureCompanyProfileHydratedForInvoice === 'function') {
            ensureCompanyProfileHydratedForInvoice();
        }
        invoiceThemeDraft = resolveInvoiceTheme();
        syncInvoiceThemeControls(invoiceThemeDraft);
        invoiceThemePreviewQrUrl = '';
        const modal = document.getElementById('invoiceThemeModal');
        preloadInvoiceThemePreviewQr().then(function () {
            return refreshInvoiceThemePreview(true);
        }).then(function () {
            if (modal) modal.style.display = 'flex';
        });
    }

    function closeInvoiceThemeModal() {
        closeColorPopover();
        const modal = document.getElementById('invoiceThemeModal');
        if (modal) modal.style.display = 'none';
    }

    function saveInvoiceThemeDraft() {
        const theme = readInvoiceThemeControls();
        const accId = getCurrentAccountId();
        const baseProfile = typeof getCompanyProfileForInvoice === 'function'
            ? getCompanyProfileForInvoice()
            : loadCompanyProfile();
        const profile = normalizeCompanyProfilePayload(Object.assign({}, baseProfile, { invoiceTheme: theme }));
        persistCompanyProfileLocal(accId, profile);
        if (typeof updateCompanyLogoPreview === 'function') updateCompanyLogoPreview(profile);
        if (window.XALISS_DJANGO && typeof window.xalissSaveInvoiceTheme === 'function') {
            return window.xalissSaveInvoiceTheme(theme);
        }
        showNotification('Personnalisation enregistrée localement.', 'success');
        closeInvoiceThemeModal();
        return Promise.resolve();
    }

    function initInvoiceThemeModal() {
        if (invoiceThemeModalBound) return;
        const openBtn = document.getElementById('invoiceThemeOpenBtn');
        const saveBtn = document.getElementById('invoiceThemeSaveBtn');
        const resetBtn = document.getElementById('invoiceThemeResetBtn');
        const presetEl = document.getElementById('invoiceThemePreset');
        const controls = [
            'invoiceThemeAccent',
            'invoiceThemeAccentSecondary',
            'invoiceThemeGradientStart',
            'invoiceThemeGradientEnd',
            'invoiceThemeLogoFrame',
            'invoiceThemeLogoFrameColor',
            'invoiceThemeLogoFrameBorder',
            'invoiceThemeLogoFrameBorderColor',
        ];
        if (!openBtn && !saveBtn) return;
        invoiceThemeModalBound = true;
        initInvoiceThemeColorPickers();

        if (openBtn) openBtn.addEventListener('click', openInvoiceThemeModal);
        if (saveBtn) saveBtn.addEventListener('click', saveInvoiceThemeDraft);
        if (resetBtn) resetBtn.addEventListener('click', function () {
            if (typeof ensureCompanyProfileHydratedForInvoice === 'function') {
                ensureCompanyProfileHydratedForInvoice();
            }
            const resetTheme = getInvoiceThemePreset('xaliss');
            resetTheme.layout = 'classique';
            syncInvoiceThemeControls(resetTheme);
            if (presetEl) presetEl.value = 'xaliss';
            refreshInvoiceThemePreview(true);
        });

        document.querySelectorAll('.invoice-theme-layout-card').forEach(function (card) {
            card.addEventListener('click', function () {
                const layoutEl = document.getElementById('invoiceThemeLayout');
                const key = normalizeInvoiceLayout(card.dataset.layout || 'classique');
                if (layoutEl) layoutEl.value = key;
                document.querySelectorAll('.invoice-theme-layout-card').forEach(function (c) {
                    const active = c.dataset.layout === key;
                    c.classList.toggle('is-active', active);
                    c.setAttribute('aria-checked', active ? 'true' : 'false');
                });
                refreshInvoiceThemePreview(true);
            });
        });

        document.querySelectorAll('.invoice-theme-preset-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                const key = chip.dataset.preset || 'xaliss';
                const layoutEl = document.getElementById('invoiceThemeLayout');
                const currentLayout = normalizeInvoiceLayout(layoutEl ? layoutEl.value : 'classique');
                if (presetEl) presetEl.value = key;
                const next = getInvoiceThemePreset(key);
                next.layout = currentLayout;
                syncInvoiceThemeControls(next);
                refreshInvoiceThemePreview(true);
            });
        });

        controls.forEach(function (id) {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', function () {
                if (presetEl) presetEl.value = 'custom';
                if (id === 'invoiceThemeLogoFrame') {
                    const frameColorGroup = document.getElementById('invoiceThemeLogoFrameColorGroup');
                    if (frameColorGroup) frameColorGroup.hidden = !el.checked;
                }
                if (id === 'invoiceThemeLogoFrameBorder') {
                    const borderColorGroup = document.getElementById('invoiceThemeLogoFrameBorderColorGroup');
                    if (borderColorGroup) borderColorGroup.hidden = !el.checked;
                }
                refreshInvoiceThemePreview(false);
            });
            el.addEventListener('change', function () {
                if (presetEl) presetEl.value = 'custom';
                refreshInvoiceThemePreview(false);
            });
        });

        let themePreviewResizeTimer = null;
        window.addEventListener('resize', function () {
            const modal = document.getElementById('invoiceThemeModal');
            if (!modal || modal.style.display !== 'flex') return;
            clearTimeout(themePreviewResizeTimer);
            themePreviewResizeTimer = setTimeout(function () {
                const host = document.getElementById('invoiceThemePreviewHost');
                if (host) scaleInvoicePaperToFit(host);
            }, 120);
        });
    }

    function patchOpenInvoiceModal() {
        window.openInvoiceModal = function (id) {
            if (!id) return;
            const transactionId = typeof id === 'string' && !isNaN(id) && !id.includes('-') ? parseInt(id) : id;
            const transaction = transactions.find(function (t) { return String(t.id) === String(transactionId); });
            if (!transaction) {
                showNotification('Transaction non trouvée', 'error');
                return;
            }
            currentInvoiceTransaction = transaction;
            const invoiceDocTitle = getInvoiceDocumentTitle(transaction);
            const invoiceModalTitleEl = document.getElementById('invoiceModalTitle');
            if (invoiceModalTitleEl) invoiceModalTitleEl.textContent = invoiceDocTitle;

            const contentEl = document.getElementById('invoiceContent');
            const modal = document.getElementById('invoiceModal');
            if (typeof ensureCompanyProfileHydratedForInvoice === 'function') {
                ensureCompanyProfileHydratedForInvoice();
            }
            if (typeof updateCompanyWebsiteQrPreview === 'function') updateCompanyWebsiteQrPreview();

            renderInvoicePaper(contentEl, transaction, {
                theme: resolveInvoiceTheme(),
                paperId: 'invoicePaper',
            }).then(function () {
                if (modal) modal.style.display = 'flex';
                scaleInvoicePaperToFit(contentEl);
            });
        };
    }

    window.normalizeInvoiceTheme = normalizeInvoiceTheme;
    window.normalizeInvoiceLayout = normalizeInvoiceLayout;
    window.resolveInvoiceTheme = resolveInvoiceTheme;
    window.applyInvoiceThemeVars = applyInvoiceThemeVars;
    window.renderInvoicePaper = renderInvoicePaper;
    window.openInvoiceThemeModal = openInvoiceThemeModal;
    window.closeInvoiceThemeModal = closeInvoiceThemeModal;
    window.invoiceQrDataUrlCache = window.invoiceQrDataUrlCache || {};

    const INVOICE_LAYOUT_PRINT_CSS =
        '.invoice-header{background:linear-gradient(180deg,var(--inv-gradient-start,#fde8f0) 0%,var(--inv-gradient-mid,#faf0f5) 50%,var(--inv-gradient-end,#f6f4fa) 100%) !important;border-bottom-color:var(--inv-accent,#43277d) !important;}' +
        '.invoice-title{color:var(--inv-accent,#43277d) !important;}' +
        '.invoice-num{color:rgba(var(--inv-accent-rgb,67,39,125),0.72) !important;background:rgba(var(--inv-accent-rgb,67,39,125),0.08) !important;font-weight:700 !important;}' +
        '.invoice-company-name,.invoice-client-label,.invoice-qr-caption{color:var(--inv-accent,#43277d) !important;}' +
        '.invoice-client-row{border-left-color:var(--inv-accent,#43277d) !important;background:rgba(var(--inv-accent-rgb,67,39,125),0.06) !important;}' +
        '.invoice-amount{color:var(--inv-accent,#43277d) !important;}' +
        '.invoice-footer-text{color:var(--inv-accent-secondary,#e72060) !important;}' +
        '.invoice-header-brand,.invoice-header-meta{display:block;}' +
        '.invoice-parties{display:block;}' +
        '.invoice-layout--classique .invoice-header{text-align:center;}' +
        '.invoice-layout--classique .invoice-header-meta{margin-top:2px;}' +
        '.invoice-layout--classique .invoice-company-block{background:#fafafa !important;border:1px solid #eee !important;border-radius:8px;text-align:center;}' +
        '.invoice-layout--classique .invoice-company-name{text-align:center;}' +
        '.invoice-layout--editorial .invoice-header{display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:18px;margin:-20px -28px 14px;padding:18px 28px 16px;text-align:left;border-bottom:none;border-radius:12px 12px 0 0;background:linear-gradient(180deg,var(--inv-gradient-start,#f8fafc) 0%,#fff 100%) !important;box-shadow:inset 0 -2px 0 var(--inv-accent,#43277d);}' +
        '.invoice-layout--editorial .invoice-header-brand{flex:0 0 auto;}' +
        '.invoice-layout--editorial .invoice-logo-frame{justify-content:flex-start;margin:0;min-height:64px;}' +
        '.invoice-layout--editorial .invoice-logo-frame.has-logo-frame,.invoice-layout--editorial .invoice-logo-frame.has-logo-outline{margin-left:0;margin-right:0;}' +
        '.invoice-layout--editorial .invoice-header-meta{flex:1 1 auto;text-align:right;}' +
        '.invoice-layout--editorial .invoice-title{font-size:1.12em;letter-spacing:0.2em;margin:0 0 10px;}' +
        '.invoice-layout--editorial .invoice-num{background:rgba(var(--inv-accent-rgb,67,39,125),0.08) !important;padding:4px 12px;border-radius:999px;font-size:0.68em;letter-spacing:0.06em;color:rgba(var(--inv-accent-rgb,67,39,125),0.78) !important;}' +
        '.invoice-layout--editorial .invoice-parties{display:grid;grid-template-columns:1.15fr 0.85fr;gap:14px;margin:2px 0 14px;min-height:118px;align-items:stretch;}' +
        '.invoice-layout--editorial .invoice-company-block{margin:0;padding:16px 14px;background:#fafafa !important;border:1px solid rgba(var(--inv-accent-rgb,67,39,125),0.16) !important;border-left:3px solid var(--inv-accent,#43277d) !important;border-radius:10px;text-align:left;box-sizing:border-box;}' +
        '.invoice-layout--editorial .invoice-company-name{font-size:1.08em;margin:0 0 6px;letter-spacing:0.02em;}' +
        '.invoice-layout--editorial .invoice-company-line{font-size:0.9em;color:#333;}' +
        '.invoice-layout--editorial .invoice-client-row{margin:0;padding:16px 14px;background:#fafafa !important;border:1px solid rgba(var(--inv-accent-rgb,67,39,125),0.16) !important;border-left:3px solid var(--inv-accent,#43277d) !important;border-radius:10px;box-sizing:border-box;font-size:1em;}' +
        '.invoice-layout--editorial .invoice-client-label{font-size:1.08em;font-weight:700;letter-spacing:0.02em;}' +
        '.invoice-layout--editorial .invoice-body{margin:4px 0 12px;flex:1 1 auto;}' +
        '.invoice-layout--editorial .invoice-table .invoice-label{font-size:0.72em;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;}' +
        '.invoice-layout--editorial .invoice-row-amount .invoice-amount{font-size:1.32em;}' +
        '.invoice-layout--signature .invoice-header{margin:-20px -28px 16px;padding:22px 28px 20px;min-height:112px;text-align:left;border-bottom:none;border-radius:12px 12px 0 0;background:linear-gradient(118deg,var(--inv-accent,#43277d) 0%,var(--inv-accent-secondary,#e72060) 100%) !important;color:#fff;display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:18px;box-shadow:none;}' +
        '.invoice-layout--signature .invoice-header-brand{flex:0 0 auto;}' +
        '.invoice-layout--signature .invoice-logo-frame{justify-content:flex-start;margin:0;min-height:64px;}' +
        '.invoice-layout--signature .invoice-logo-frame:not(.has-logo-frame):not(.has-logo-outline){padding:0;background:transparent;}' +
        '.invoice-layout--signature .invoice-logo-frame.has-logo-frame{background:var(--inv-logo-frame-bg,#fff);margin-left:0;margin-right:0;}' +
        '.invoice-layout--signature .invoice-logo-frame.has-logo-outline{border-color:var(--inv-logo-frame-border,#43277d);margin-left:0;margin-right:0;}' +
        '.invoice-layout--signature .invoice-header-meta{flex:1 1 auto;text-align:right;}' +
        '.invoice-layout--signature .invoice-title{color:#fff !important;margin:0 0 8px;letter-spacing:0.22em;font-size:1.18em;font-weight:800;text-shadow:none;}' +
        '.invoice-layout--signature .invoice-num{background:rgba(255,255,255,0.18) !important;color:#fff !important;border-radius:999px;padding:5px 12px;font-size:0.66em;}' +
        '.invoice-layout--signature .invoice-parties{display:grid;grid-template-columns:1.1fr 0.9fr;gap:18px;margin:2px 0 16px;min-height:108px;align-items:stretch;}' +
        '.invoice-layout--signature .invoice-company-block{margin:0;padding:12px 0 12px 14px;text-align:left;background:transparent !important;border:none !important;border-left:3px solid var(--inv-accent,#43277d) !important;border-radius:0;}' +
        '.invoice-layout--signature .invoice-company-name{margin:0 0 6px;font-size:1.06em;}' +
        '.invoice-layout--signature .invoice-company-line{font-size:0.9em;color:#333;}' +
        '.invoice-layout--signature .invoice-client-row{margin:0;padding:16px 14px;border:none !important;border-left:3px solid var(--inv-accent-secondary,#e72060) !important;border-radius:0;background:transparent !important;font-size:1em;}' +
        '.invoice-layout--signature .invoice-client-label{font-size:1.06em;font-weight:700;letter-spacing:0.01em;}' +
        '.invoice-layout--signature .invoice-body{margin:4px 0 14px;flex:1 1 auto;min-height:210px;}' +
        '.invoice-layout--signature .invoice-table{border-collapse:separate;border-spacing:0;}' +
        '.invoice-layout--signature .invoice-table tr{border-bottom:none;}' +
        '.invoice-layout--signature .invoice-table td{padding:13px 0;border-bottom:1px solid #f0f0f0;}' +
        '.invoice-layout--signature .invoice-table .invoice-label{font-size:0.72em;letter-spacing:0.08em;text-transform:uppercase;color:#9ca3af;}' +
        '.invoice-layout--signature .invoice-table .invoice-row-desc td,.invoice-layout--signature .invoice-table tr:has(+ .invoice-row-amount) td,.invoice-layout--signature .invoice-table .invoice-row-amount td,.invoice-layout--signature .invoice-table .invoice-row-remaining td{border-bottom:none;}' +
        '.invoice-layout--signature .invoice-row-amount td,.invoice-layout--signature .invoice-row-remaining td{padding:14px 16px;height:52px;box-sizing:border-box;vertical-align:middle;background:rgba(var(--inv-accent-rgb,67,39,125),0.07) !important;border:none;}' +
        '.invoice-layout--signature .invoice-row-amount:not(:has(+ .invoice-row-remaining)) td:first-child{border-radius:10px 0 0 10px;}' +
        '.invoice-layout--signature .invoice-row-amount:not(:has(+ .invoice-row-remaining)) td:last-child{border-radius:0 10px 10px 0;}' +
        '.invoice-layout--signature .invoice-row-amount:has(+ .invoice-row-remaining) td:first-child{border-radius:10px 0 0 0;}' +
        '.invoice-layout--signature .invoice-row-amount:has(+ .invoice-row-remaining) td:last-child{border-radius:0 10px 0 0;}' +
        '.invoice-layout--signature .invoice-row-amount:has(+ .invoice-row-remaining) td{padding-bottom:10px;height:48px;}' +
        '.invoice-layout--signature .invoice-row-remaining td{padding-top:10px;height:48px;}' +
        '.invoice-layout--signature .invoice-row-remaining td:first-child{border-radius:0 0 0 10px;}' +
        '.invoice-layout--signature .invoice-row-remaining td:last-child{border-radius:0 0 10px 0;}' +
        '.invoice-layout--signature .invoice-row-amount .invoice-label,.invoice-layout--signature .invoice-row-remaining .invoice-label{color:var(--inv-accent,#43277d);font-size:0.72em;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;}' +
        '.invoice-layout--signature .invoice-row-amount .invoice-amount{font-size:1.36em;font-weight:800;color:var(--inv-accent,#43277d);text-align:right;line-height:1.15;}' +
        '.invoice-layout--signature .invoice-row-remaining .invoice-value{font-size:1.12em;font-weight:700;color:var(--inv-accent,#43277d);text-align:right;line-height:1.15;}' +
        '@media print{.invoice-layout--signature .invoice-header,.invoice-layout--editorial .invoice-header,.invoice-row-amount td,.invoice-row-remaining td{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}}';

    if (typeof window.getInvoicePaperCssString === 'function') {
        const originalInvoiceCss = window.getInvoicePaperCssString;
        window.getInvoicePaperCssString = function () {
            return originalInvoiceCss() + INVOICE_LAYOUT_PRINT_CSS;
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            initInvoiceThemeModal();
            patchOpenInvoiceModal();
        });
    } else {
        initInvoiceThemeModal();
        patchOpenInvoiceModal();
    }
})();
