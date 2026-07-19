// Configuration Firebase
const firebaseConfig = {
    apiKey: "AIzaSyAJ3HQ5W1ZE7WqVKt8-dcKYtNi4pdVsvYg",
    authDomain: "kaayprintinout.firebaseapp.com",
    projectId: "kaayprintinout",
    storageBucket: "kaayprintinout.firebasestorage.app",
    messagingSenderId: "492068359418",
    appId: "1:492068359418:web:ab174c0802aa9bfc4f8d43"
};

// Initialiser Firebase (désactivé en mode Django)
let db = null;
let useFirebase = false;

if (!window.XALISS_DJANGO) {
    try {
        if (firebaseConfig.apiKey !== "VOTRE_API_KEY") {
            firebase.initializeApp(firebaseConfig);
            db = firebase.firestore();
            useFirebase = true;
            console.log('✅ Firebase connecté avec succès');
        } else {
            console.log('⚠️ Firebase non configuré, utilisation du localStorage');
        }
    } catch (error) {
        console.error('❌ Erreur Firebase:', error);
        console.log('⚠️ Utilisation du localStorage comme solution de secours');
    }
}

// Gestion des transactions
let transactions = [];
let unsubscribeFirestore = null;

let unsubscribeCompanyProfile = null;
/** Dernières coordonnées facture (Firestore ou cache local), utilisées par la facture. */
let cachedCompanyProfile = { name: '', address: '', phone: '', email: '', website: '' };

/** Ancienne clé unique ; conservée pour migration lecture seule. */
const COMPANY_PROFILE_KEY = 'kaayprint_company_profile';

function companyProfileLocalStorageKey(accountId) {
    return 'kaayprint_company_profile_' + accountId;
}

/** Identifiant « compte » côté app : aujourd’hui le login session ; plus tard remplaçable par Firebase Auth uid. */
function getCurrentAccountId() {
    return sanitizeFirestoreDocId(sessionStorage.getItem('kaayprint_username') || 'default');
}

function sanitizeFirestoreDocId(raw) {
    let s = String(raw || 'default').trim().slice(0, 120);
    if (!s) s = 'default';
    return s.replace(/\//g, '_');
}

function normalizeCompanyProfilePayload(obj) {
    const o = obj && typeof obj === 'object' ? obj : {};
    return {
        name: o.name != null ? String(o.name).trim() : '',
        address: o.address != null ? String(o.address).trim() : '',
        phone: o.phone != null ? String(o.phone).trim() : '',
        email: o.email != null ? String(o.email).trim() : '',
        website: o.website != null ? String(o.website).trim() : ''
    };
}

function loadCompanyProfileFromLocalStorage(accountId) {
    try {
        const keyAcc = companyProfileLocalStorageKey(accountId);
        const rawAcc = localStorage.getItem(keyAcc);
        if (rawAcc) {
            return normalizeCompanyProfilePayload(JSON.parse(rawAcc));
        }
        const rawLegacy = localStorage.getItem(COMPANY_PROFILE_KEY);
        if (rawLegacy) {
            return normalizeCompanyProfilePayload(JSON.parse(rawLegacy));
        }
    } catch (e) {
        /* ignore */
    }
    return normalizeCompanyProfilePayload({});
}

function persistCompanyProfileLocal(accountId, data) {
    const n = normalizeCompanyProfilePayload(data);
    localStorage.setItem(companyProfileLocalStorageKey(accountId), JSON.stringify(n));
    cachedCompanyProfile = n;
}

const CURRENCY_SHORT_LABELS = {
    XOF: 'FCFA',
    XAF: 'FCFA',
    EUR: 'EUR',
    USD: 'USD',
    GBP: 'GBP',
    MAD: 'MAD',
    GNF: 'GNF',
    CHF: 'CHF',
    CAD: 'CAD',
};

const CURRENCY_LEGACY_MAP = {
    FCFA: 'XOF',
    CFA: 'XOF',
};

const DEFAULT_APP_SETTINGS = { currencyLabel: 'XOF', autoRefreshLocal: true };
let cachedAppSettings = { ...DEFAULT_APP_SETTINGS };

function normalizeCurrencyCode(code) {
    const raw = String(code || '').trim().toUpperCase().slice(0, 16);
    if (!raw) return DEFAULT_APP_SETTINGS.currencyLabel;
    const mapped = CURRENCY_LEGACY_MAP[raw] || raw;
    if (CURRENCY_SHORT_LABELS[mapped]) return mapped;
    return DEFAULT_APP_SETTINGS.currencyLabel;
}

function getAppSettingsStorageKey() {
    return 'kaayprint_app_settings_' + getCurrentAccountId();
}

function loadAppSettingsFromStorage() {
    try {
        const raw = localStorage.getItem(getAppSettingsStorageKey());
        if (!raw) {
            cachedAppSettings = { ...DEFAULT_APP_SETTINGS };
            return cachedAppSettings;
        }
        const o = JSON.parse(raw);
        cachedAppSettings = {
            currencyLabel: normalizeCurrencyCode(
                o.currencyLabel != null ? o.currencyLabel : DEFAULT_APP_SETTINGS.currencyLabel
            ),
            autoRefreshLocal: o.autoRefreshLocal !== false
        };
        return cachedAppSettings;
    } catch (e) {
        cachedAppSettings = { ...DEFAULT_APP_SETTINGS };
        return cachedAppSettings;
    }
}

/** Code ISO de la devise (XOF, EUR…). */
function getCurrencyCode() {
    return normalizeCurrencyCode(
        cachedAppSettings && cachedAppSettings.currencyLabel
            ? cachedAppSettings.currencyLabel
            : DEFAULT_APP_SETTINGS.currencyLabel
    );
}

/** Libellé court pour labels UI : FCFA, EUR, USD… */
function getCurrencyLabel() {
    const code = getCurrencyCode();
    return CURRENCY_SHORT_LABELS[code] || code;
}

function getAppSettingsAutoRefreshLocal() {
    return cachedAppSettings.autoRefreshLocal !== false;
}

function syncCurrencyLabelsInUI() {
    const label = getCurrencyLabel();
    document.querySelectorAll('.js-currency-label').forEach(function (el) {
        el.textContent = label;
    });
}

/** Paramètres org depuis l'API Django (devise, rafraîchissement). */
function applyOrgAppSettingsFromApi(profil) {
    if (!profil || typeof profil !== 'object') return;
    if (profil.currencyLabel != null && String(profil.currencyLabel).trim()) {
        cachedAppSettings.currencyLabel = normalizeCurrencyCode(profil.currencyLabel);
    }
    if (profil.autoRefreshLocal !== undefined) {
        cachedAppSettings.autoRefreshLocal = profil.autoRefreshLocal !== false;
    }
    try {
        localStorage.setItem(getAppSettingsStorageKey(), JSON.stringify(cachedAppSettings));
    } catch (e) { /* ignore */ }
    syncCurrencyLabelsInUI();
    updateDisplay();
}

function loadCompanyProfile() {
    return normalizeCompanyProfilePayload(cachedCompanyProfile);
}

function applyCompanyProfileToForm(p) {
    const n = normalizeCompanyProfilePayload(p);
    const nameEl = document.getElementById('companyName');
    const addrEl = document.getElementById('companyAddress');
    const phoneEl = document.getElementById('companyPhone');
    const emailEl = document.getElementById('companyEmail');
    const webEl = document.getElementById('companyWebsite');
    if (nameEl) nameEl.value = n.name || '';
    if (addrEl) addrEl.value = n.address || '';
    if (phoneEl) phoneEl.value = n.phone || '';
    if (emailEl) emailEl.value = n.email || '';
    if (webEl) webEl.value = n.website || '';
    updateCompanyWebsiteQrPreview();
}

function applyUserProfileToForm(profil) {
    if (!profil || typeof profil !== 'object') return;
    const firstEl = document.getElementById('userFirstName');
    const lastEl = document.getElementById('userLastName');
    const emailEl = document.getElementById('userEmail');
    const countryEl = document.getElementById('userCountry');
    const cityEl = document.getElementById('userCity');
    const currencyEl = document.getElementById('userCurrencyLabel');
    if (firstEl) firstEl.value = profil.firstName || '';
    if (lastEl) lastEl.value = profil.lastName || '';
    if (emailEl) emailEl.value = profil.email || '';
    if (window.xalissGeoSelects && typeof window.xalissGeoSelects.applyValues === 'function') {
        window.xalissGeoSelects.applyValues(profil.country || '', profil.city || '');
    } else {
        if (countryEl) countryEl.value = profil.country || '';
        if (cityEl) cityEl.value = profil.city || '';
    }
    if (currencyEl && profil.currencyLabel) {
        currencyEl.value = normalizeCurrencyCode(profil.currencyLabel);
        if (typeof refreshEnhancedSelectMenu === 'function') {
            refreshEnhancedSelectMenu(currencyEl);
        }
    }
    applyUserPasswordUiState(profil.hasPassword !== false);
    if (currencyEl) {
        const canEdit = profil.canEditCurrency !== false;
        currencyEl.disabled = !canEdit;
        const trigger = currencyEl.closest('.kp-select-wrap')
            ? currencyEl.closest('.kp-select-wrap').querySelector('.kp-select-trigger')
            : null;
        if (trigger) trigger.disabled = !canEdit;
    }
    updateSidebarProfileName(profil.firstName, profil.lastName);
}

function updateSidebarProfileName(firstName, lastName) {
    const name = [String(firstName || '').trim(), String(lastName || '').trim()].filter(Boolean).join(' ');
    if (!name) return;
    const el = document.getElementById('sidebarProfileName');
    const profile = document.getElementById('sidebarProfile');
    if (el) el.textContent = name;
    if (profile) profile.title = name;
}

function applyUserPasswordUiState(hasPassword) {
    const currentGroup = document.getElementById('userCurrentPasswordGroup');
    const currentInput = document.getElementById('userCurrentPassword');
    const saveBtn = document.getElementById('userPasswordSave');
    if (currentGroup) {
        currentGroup.hidden = false;
        currentGroup.classList.toggle('is-disabled', !hasPassword);
    }
    if (currentInput) {
        currentInput.disabled = !hasPassword;
        currentInput.value = '';
        currentInput.placeholder = hasPassword ? '••••••••' : 'Compte Google — aucun mot de passe actuel';
        currentInput.setAttribute('aria-disabled', hasPassword ? 'false' : 'true');
    }
    if (saveBtn) {
        saveBtn.textContent = hasPassword ? 'Changer le mot de passe' : 'Définir le mot de passe';
    }
}

function clearUserPasswordFields() {
    ['userCurrentPassword', 'userNewPassword', 'userConfirmPassword'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

function initUserProfileUI() {
    const currencyEl = document.getElementById('userCurrencyLabel');
    if (currencyEl) enhanceSelectField(currencyEl);
    if (window.xalissGeoSelects && typeof window.xalissGeoSelects.init === 'function') {
        window.xalissGeoSelects.init();
    }
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getNotificationTypeLabel(type) {
    const labels = {
        success: 'Succès',
        error: 'Erreur',
        warning: 'Attention',
        info: 'Info'
    };
    return labels[type] || labels.info;
}

function getNotificationIcon(type) {
    if (type === 'success') {
        return '<path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    if (type === 'error') {
        return '<path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    if (type === 'warning') {
        return '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 9v4M12 17h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    }
    return '<path d="M12 16v-4M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>';
}

function formatNotificationDate(value) {
    const date = new Date(value);
    if (isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function getNotificationHistory() {
    if (typeof window.xalissGetNotifications === 'function') {
        return window.xalissGetNotifications();
    }
    return [];
}

function updateNotificationsBadge() {
    const countEl = document.getElementById('notificationsCount');
    const count = getNotificationHistory().length;
    if (!countEl) return;
    if (count > 0) {
        countEl.hidden = false;
        countEl.textContent = count > 99 ? '99+' : String(count);
    } else {
        countEl.hidden = true;
        countEl.textContent = '0';
    }
}

function renderNotificationsModal() {
    const listEl = document.getElementById('notificationsList');
    const emptyEl = document.getElementById('notificationsEmpty');
    const countEl = document.getElementById('notificationsModalCount');
    const clearBtn = document.getElementById('notificationsClearBtn');
    if (!listEl) return;
    const notifications = getNotificationHistory();
    const count = notifications.length;
    if (countEl) countEl.textContent = count + ' notification' + (count !== 1 ? 's' : '');
    if (emptyEl) emptyEl.hidden = count > 0;
    if (clearBtn) clearBtn.disabled = count === 0;
    if (!count) {
        listEl.innerHTML = '';
        return;
    }
    listEl.innerHTML = notifications.map(function (item) {
        const type = item && item.type ? item.type : 'info';
        return '<div class="notification-item notification-item--' + escapeHtml(type) + '">' +
            '<div class="notification-item-icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' + getNotificationIcon(type) + '</svg></div>' +
            '<div class="notification-item-main">' +
            '<div class="notification-item-topline">' +
            '<div class="notification-item-message">' + escapeHtml(item.message || '') + '</div>' +
            '<span class="notification-item-badge">' + escapeHtml(getNotificationTypeLabel(type)) + '</span>' +
            '</div>' +
            '<div class="notification-item-meta">' + escapeHtml(getNotificationTypeLabel(type)) + (item.createdAt ? ' · ' + escapeHtml(formatNotificationDate(item.createdAt)) : '') + '</div>' +
            '</div>' +
            '</div>';
    }).join('');
}

function openNotificationsModal() {
    renderNotificationsModal();
    const modal = document.getElementById('notificationsModal');
    if (modal) modal.style.display = 'flex';
    lockPageScroll();
}

function closeNotificationsModal() {
    const modal = document.getElementById('notificationsModal');
    if (modal) modal.style.display = 'none';
    unlockPageScroll();
}

window.closeNotificationsModal = closeNotificationsModal;

let notificationsListenersBound = false;

function initNotificationsUI() {
    if (notificationsListenersBound) {
        updateNotificationsBadge();
        renderNotificationsModal();
        return;
    }
    notificationsListenersBound = true;
    const btn = document.getElementById('notificationsBtn');
    const modal = document.getElementById('notificationsModal');
    const clearBtn = document.getElementById('notificationsClearBtn');
    if (btn) btn.addEventListener('click', openNotificationsModal);
    if (modal) {
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeNotificationsModal();
        });
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            if (typeof window.xalissClearNotifications === 'function') {
                window.xalissClearNotifications();
            }
            renderNotificationsModal();
            updateNotificationsBadge();
        });
    }
    window.addEventListener('xaliss:notifications-updated', function () {
        updateNotificationsBadge();
        const modalEl = document.getElementById('notificationsModal');
        if (modalEl && modalEl.style.display === 'flex') {
            renderNotificationsModal();
        }
    });
    updateNotificationsBadge();
    renderNotificationsModal();
}

function addAppNotification(message, type, extra) {
    if (typeof window.xalissAddNotification === 'function') {
        window.xalissAddNotification(message, type || 'info', extra || {});
    } else if (typeof showNotification === 'function') {
        showNotification(message, type || 'info');
    }
}

function getUnusualExpenseBenchmark(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return null;
    const previousExpenses = transactions
        .filter(function (transaction) {
            return transaction && transaction.type === 'expense' && Number(transaction.amount) > 0;
        })
        .map(function (transaction) { return Number(transaction.amount); });

    if (previousExpenses.length < 5) return null;

    const total = previousExpenses.reduce(function (sum, item) { return sum + item; }, 0);
    const average = total / previousExpenses.length;
    const sorted = previousExpenses.slice().sort(function (a, b) { return a - b; });
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
    const threshold = Math.max(average * 2.5, median * 3);

    if (value < threshold) return null;

    return {
        count: previousExpenses.length,
        average: average,
        median: median,
        threshold: threshold
    };
}

function notifyUnusualExpenseIfNeeded(amount, description, benchmark) {
    if (!benchmark) return;
    const desc = String(description || '').trim();
    const label = desc ? ' (« ' + desc.slice(0, 60) + (desc.length > 60 ? '…' : '') + ' »)' : '';
    showNotification(
        'Dépense inhabituelle détectée' + label + ' : ' + formatAmount(amount) +
        ' contre une moyenne de ' + formatAmount(benchmark.average) + '.',
        'warning',
        { duration: 6500, history: true }
    );
}

const UNPAID_REMINDER_DAYS = 10;

function hasNotificationSystemId(systemId) {
    if (!systemId) return false;
    return getNotificationHistory().some(function (item) {
        return item && item.systemId === systemId;
    });
}

function getTransactionAgeInDays(transaction) {
    const date = new Date(transaction && transaction.date);
    if (isNaN(date.getTime())) return 0;
    const ms = Date.now() - date.getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function getUnpaidTransactionsOverDays(minDays) {
    const days = Number(minDays) || UNPAID_REMINDER_DAYS;
    return (transactions || []).filter(function (transaction) {
        const remaining = parseFloat(transaction && transaction.remainingAmount);
        if (!Number.isFinite(remaining) || remaining <= 0) return false;
        return getTransactionAgeInDays(transaction) >= days;
    });
}

function ensureUnpaidReminders() {
    const unpaid = getUnpaidTransactionsOverDays(UNPAID_REMINDER_DAYS);
    unpaid.forEach(function (transaction) {
        const txId = transaction && transaction.id != null ? String(transaction.id) : '';
        if (!txId) return;
        const systemId = 'unpaid-10d-' + txId;
        if (hasNotificationSystemId(systemId)) return;

        const ageDays = getTransactionAgeInDays(transaction);
        const remaining = parseFloat(transaction.remainingAmount) || 0;
        const clientName = typeof resolveTransactionClientName === 'function'
            ? resolveTransactionClientName(transaction)
            : '';
        const contactLabel = typeof getTransactionContactLabel === 'function'
            ? getTransactionContactLabel(transaction)
            : (transaction.type === 'expense' ? 'Payé à' : 'Client');
        const desc = String(transaction.description || '').trim();
        const descPart = desc
            ? ' — « ' + desc.slice(0, 70) + (desc.length > 70 ? '…' : '') + ' »'
            : '';
        const clientPart = clientName
            ? ' (' + contactLabel + ' : ' + clientName + ')'
            : '';

        addAppNotification(
            'Impayé depuis ' + ageDays + ' jour' + (ageDays > 1 ? 's' : '') +
            clientPart + ' : reste ' + formatAmount(remaining) + descPart + '.',
            'warning',
            { systemId: systemId }
        );
    });
}

function isUserProfileIncomplete() {
    const firstEl = document.getElementById('userFirstName');
    const lastEl = document.getElementById('userLastName');
    const emailEl = document.getElementById('userEmail');
    const currencyEl = document.getElementById('userCurrencyLabel');
    const countryEl = document.getElementById('userCountry');
    const cityEl = document.getElementById('userCity');
    const firstName = firstEl ? String(firstEl.value || '').trim() : '';
    const lastName = lastEl ? String(lastEl.value || '').trim() : '';
    const email = emailEl ? String(emailEl.value || '').trim() : '';
    const currency = currencyEl ? String(currencyEl.value || '').trim() : '';
    const country = countryEl ? String(countryEl.value || '').trim() : '';
    const city = cityEl ? String(cityEl.value || '').trim() : '';
    return !firstName || !lastName || !email || !currency || !country || !city;
}

function isCompanyProfileIncomplete() {
    const nameEl = document.getElementById('companyName');
    const addrEl = document.getElementById('companyAddress');
    const phoneEl = document.getElementById('companyPhone');
    const emailEl = document.getElementById('companyEmail');
    const webEl = document.getElementById('companyWebsite');
    const name = nameEl ? String(nameEl.value || '').trim() : String(cachedCompanyProfile.name || '').trim();
    const address = addrEl ? String(addrEl.value || '').trim() : String(cachedCompanyProfile.address || '').trim();
    const phone = phoneEl ? String(phoneEl.value || '').trim() : String(cachedCompanyProfile.phone || '').trim();
    const email = emailEl ? String(emailEl.value || '').trim() : String(cachedCompanyProfile.email || '').trim();
    const website = webEl ? String(webEl.value || '').trim() : String(cachedCompanyProfile.website || '').trim();
    return !name || !address || !phone || !email || !website;
}

function getCurrentMondayDateKey(date) {
    const d = new Date(date || Date.now());
    d.setHours(12, 0, 0, 0);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dayNum = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dayNum;
}

function ensureMondayIncompleteProfileReminder() {
    const today = new Date();
    if (today.getDay() !== 1) return;

    const mondayKey = getCurrentMondayDateKey(today);

    if (isUserProfileIncomplete()) {
        const personalId = 'profile-incomplete-monday-' + mondayKey;
        if (!hasNotificationSystemId(personalId)) {
            addAppNotification(
                'Complétez « Mes informations personnelles » (prénom, nom, e-mail, devise, pays et ville) dans Paramètres.',
                'warning',
                { systemId: personalId }
            );
        }
    }

    if (isCompanyProfileIncomplete()) {
        const companyId = 'company-incomplete-monday-' + mondayKey;
        if (!hasNotificationSystemId(companyId)) {
            addAppNotification(
                'Complétez « Entreprise & application » (raison sociale, adresse, téléphone, e-mail et site/WhatsApp) dans Paramètres.',
                'warning',
                { systemId: companyId }
            );
        }
    }
}

function checkScheduledAppNotifications() {
    ensureUnpaidReminders();
    ensureMondayIncompleteProfileReminder();
    updateNotificationsBadge();
    const modalEl = document.getElementById('notificationsModal');
    if (modalEl && modalEl.style.display === 'flex') {
        renderNotificationsModal();
    }
}
window.xalissCheckScheduledNotifications = checkScheduledAppNotifications;

function getEditLockBannerHtml(ressourceType, ressourceId) {
    return '';
}

function isResourceEditLocked(ressourceType, ressourceId) {
    if (typeof window.xalissGetEditLock !== 'function') return false;
    return !!window.xalissGetEditLock(ressourceType, ressourceId);
}

function formatAddressLines(address) {
    if (!address || !String(address).trim()) return [];
    return String(address).trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

/** URL ou texte encodable dans un QR à partir du champ « Site web ou WhatsApp pro ». */
function normalizeCompanyWebsiteForQr(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^\/\//.test(s)) return 'https:' + s;
    const lower = s.toLowerCase().replace(/^\s+/, '');
    if (/^(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\//i.test(lower) || lower.startsWith('wa.me/')) {
        const rest = s.replace(/^\/+/, '');
        return /^https?:\/\//i.test(rest) ? rest : 'https://' + rest.replace(/^\/+/, '');
    }
    const digitsOnly = s.replace(/\D/g, '');
    if (digitsOnly.length >= 8 && /^[\d\s+().-]+$/.test(s) && !s.includes('/') && !s.includes('.')) {
        return 'https://wa.me/' + digitsOnly;
    }
    if (/^www\./i.test(s)) return 'https://' + s;
    if (/\.[a-z]{2,}(\/|$)/i.test(s) && !/\s/.test(s)) return 'https://' + s;
    return s;
}

function getQrCodeLib() {
    return (typeof QRCode !== 'undefined' && QRCode) || (typeof window !== 'undefined' && window.QRCode) || null;
}

function generateQrDataUrl(text) {
    return new Promise(function (resolve, reject) {
        const lib = getQrCodeLib();
        if (!lib || typeof lib.toDataURL !== 'function') {
            reject(new Error('Bibliothèque QR indisponible'));
            return;
        }
        lib.toDataURL(text, { width: 240, margin: 2, errorCorrectionLevel: 'M' }, function (err, url) {
            if (err) reject(err);
            else resolve(url);
        });
    });
}

let companyWebsiteQrDebounce = null;
let companyWebsiteQrResizeTimer = null;

function syncCompanyWebsiteQrImgToInputHeight() {
    const img = document.getElementById('companyWebsiteQrImg');
    const section = document.getElementById('companyWebsiteQrSection');
    if (!img) return;
    if (!section || section.hidden || !img.getAttribute('src')) {
        img.style.width = '';
        img.style.height = '';
    }
}

function scheduleSyncCompanyWebsiteQrImgSize() {
    if (companyWebsiteQrResizeTimer) clearTimeout(companyWebsiteQrResizeTimer);
    companyWebsiteQrResizeTimer = setTimeout(syncCompanyWebsiteQrImgToInputHeight, 80);
}

function updateCompanyWebsiteQrPreview() {
    const section = document.getElementById('companyWebsiteQrSection');
    const img = document.getElementById('companyWebsiteQrImg');
    const webEl = document.getElementById('companyWebsite');
    const raw = webEl && webEl.value ? webEl.value : '';
    const target = normalizeCompanyWebsiteForQr(raw);
    if (!section || !img) return;
    if (!target) {
        section.hidden = true;
        img.removeAttribute('src');
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        img.style.width = '';
        img.style.height = '';
        return;
    }
    generateQrDataUrl(target).then(function (dataUrl) {
        img.onload = function () {
            syncCompanyWebsiteQrImgToInputHeight();
        };
        img.src = dataUrl;
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        section.hidden = false;
        requestAnimationFrame(function () {
            syncCompanyWebsiteQrImgToInputHeight();
        });
    }).catch(function () {
        section.hidden = true;
        img.removeAttribute('src');
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        img.style.width = '';
        img.style.height = '';
    });
}

function downloadCompanyWebsiteQr() {
    const webEl = document.getElementById('companyWebsite');
    const raw = webEl && webEl.value ? webEl.value : '';
    const target = normalizeCompanyWebsiteForQr(raw);
    if (!target) {
        showNotification('Saisissez un site ou un lien WhatsApp pour générer le QR.', 'error');
        return;
    }
    generateQrDataUrl(target).then(function (dataUrl) {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'kaayprint-qrcode.png';
        a.click();
    }).catch(function () {
        showNotification('Impossible de générer le QR code.', 'error');
    });
}

function shareCompanyWebsiteQr() {
    const webEl = document.getElementById('companyWebsite');
    const raw = webEl && webEl.value ? webEl.value : '';
    const target = normalizeCompanyWebsiteForQr(raw);
    if (!target) {
        showNotification('Saisissez un site ou un lien WhatsApp pour générer le QR.', 'error');
        return;
    }
    generateQrDataUrl(target).then(function (dataUrl) {
        return fetch(dataUrl).then(function (r) { return r.blob(); });
    }).then(function (blob) {
        const file = new File([blob], 'kaayprint-qrcode.png', { type: 'image/png' });
        if (navigator.share && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }))) {
            return navigator.share({ title: 'QR code Xaliss', text: 'Scannez pour nous contacter.', files: [file] });
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'kaayprint-qrcode.png';
        a.click();
        URL.revokeObjectURL(a.href);
        showNotification('Téléchargez le QR puis partagez-le depuis votre appareil.', 'info');
    }).catch(function () {
        showNotification('Partage impossible sur cet appareil.', 'error');
    });
}

let companyProfileListenersBound = false;
function initCompanyProfileUI() {
    const nameEl = document.getElementById('companyName');
    const addrEl = document.getElementById('companyAddress');
    const phoneEl = document.getElementById('companyPhone');
    const emailEl = document.getElementById('companyEmail');
    const webEl = document.getElementById('companyWebsite');
    const btn = document.getElementById('companyProfileSave');
    const accountId = getCurrentAccountId();

    cachedCompanyProfile = loadCompanyProfileFromLocalStorage(accountId);
    applyCompanyProfileToForm(cachedCompanyProfile);

    if (unsubscribeCompanyProfile) {
        unsubscribeCompanyProfile();
        unsubscribeCompanyProfile = null;
    }

    if (useFirebase && db) {
        const docRef = db.collection('companyProfiles').doc(accountId);
        unsubscribeCompanyProfile = docRef.onSnapshot((snap) => {
            if (snap.exists) {
                const data = normalizeCompanyProfilePayload(snap.data());
                persistCompanyProfileLocal(accountId, data);
                applyCompanyProfileToForm(data);
            }
        }, (error) => {
            console.error('Profil entreprise Firestore:', error);
            showNotification(getSyncErrorMessage(error) + ' Coordonnées locales affichées.', 'error');
            cachedCompanyProfile = loadCompanyProfileFromLocalStorage(accountId);
            applyCompanyProfileToForm(cachedCompanyProfile);
        });
    }

    if (btn && !companyProfileListenersBound) {
        companyProfileListenersBound = true;
        if (!window.XALISS_DJANGO) {
        btn.addEventListener('click', () => {
            const payload = normalizeCompanyProfilePayload({
                name: nameEl && nameEl.value ? nameEl.value : '',
                address: addrEl && addrEl.value ? addrEl.value : '',
                phone: phoneEl && phoneEl.value ? phoneEl.value : '',
                email: emailEl && emailEl.value ? emailEl.value : '',
                website: webEl && webEl.value ? webEl.value : ''
            });
            const accId = getCurrentAccountId();

            if (useFirebase && db) {
                db.collection('companyProfiles').doc(accId).set(payload, { merge: true })
                    .then(() => {
                        persistCompanyProfileLocal(accId, payload);
                    })
                    .catch((error) => {
                        console.error(error);
                        persistCompanyProfileLocal(accId, payload);
                        showNotification('Firebase indisponible : coordonnées enregistrées sur cet appareil uniquement.', 'error');
                    });
            } else {
                persistCompanyProfileLocal(accId, payload);
            }
            updateCompanyWebsiteQrPreview();
        });
        }
        if (webEl) {
            webEl.addEventListener('input', function () {
                if (companyWebsiteQrDebounce) clearTimeout(companyWebsiteQrDebounce);
                companyWebsiteQrDebounce = setTimeout(updateCompanyWebsiteQrPreview, 350);
            });
            webEl.addEventListener('change', scheduleSyncCompanyWebsiteQrImgSize);
        }
        window.addEventListener('resize', scheduleSyncCompanyWebsiteQrImgSize);
        const qrDl = document.getElementById('companyWebsiteQrDownload');
        const qrSh = document.getElementById('companyWebsiteQrShare');
        if (qrDl) qrDl.addEventListener('click', downloadCompanyWebsiteQr);
        if (qrSh) qrSh.addEventListener('click', shareCompanyWebsiteQr);
    }
    updateCompanyWebsiteQrPreview();
}

// ——— Liste des clients (Paramètres + listes déroulantes facture) ———
let cachedClients = [];
let unsubscribeClientList = null;
let clientsListenersBound = false;
let clientsImportAttempted = false;
let editingClientId = null;
let clientsCurrentPage = 1;
const clientsItemsPerPage = 15;

const CLIENT_SELECT_IDS = ['incomeInvoiceClient', 'expenseInvoiceClient', 'editInvoiceClient', 'noteClient'];
const CATEGORY_SELECT_IDS = ['incomeCategory', 'editCategory', 'noteCategory'];

const CLIENT_PROVENANCE_OPTIONS = [
    { value: 'whatsapp', label: 'WhatsApp' },
    { value: 'instagram', label: 'Instagram' },
    { value: 'facebook', label: 'Facebook' },
    { value: 'tiktok', label: 'TikTok' },
    { value: 'site_web', label: 'Site web' },
    { value: 'amis', label: 'Amis' },
    { value: 'recommandation', label: 'Recommandation' },
    { value: 'passage_magasin', label: 'Passage en boutique' },
    { value: 'google', label: 'Google / Recherche' },
    { value: 'salon_evenement', label: 'Salon / Événement' },
    { value: 'bouche_a_oreille', label: 'Bouche-à-oreille' },
    { value: 'neant', label: 'Non applicable' },
    { value: 'autre', label: 'Autre' }
];

function normalizeClientProvenance(value) {
    const v = String(value || '').trim();
    if (v === 'collaborateur' || v === 'prestataire') return '';
    return v;
}

function getClientProvenanceLabel(value) {
    const v = normalizeClientProvenance(value);
    if (!v) return '';
    const opt = CLIENT_PROVENANCE_OPTIONS.find(function (o) { return o.value === v; });
    return opt ? opt.label : v;
}

function isValidClientProvenance(value) {
    return CLIENT_PROVENANCE_OPTIONS.some(function (o) { return o.value === value; });
}

function fillClientProvenanceSelect(selectEl, selectedValue) {
    if (!selectEl) return;
    const current = normalizeClientProvenance(selectedValue != null ? String(selectedValue) : selectEl.value);
    while (selectEl.options.length > 0) selectEl.remove(0);
    const optPlaceholder = document.createElement('option');
    optPlaceholder.value = '';
    optPlaceholder.textContent = '— Choisir —';
    selectEl.appendChild(optPlaceholder);
    CLIENT_PROVENANCE_OPTIONS.forEach(function (o) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        selectEl.appendChild(opt);
    });
    if (current && isValidClientProvenance(current)) {
        selectEl.value = current;
    } else {
        selectEl.value = '';
    }
    refreshEnhancedSelectMenu(selectEl);
}

function initClientProvenanceSelects() {
    fillClientProvenanceSelect(document.getElementById('clientFormProvenance'));
    fillClientProvenanceSelect(document.getElementById('clientEditProvenance'));
    enhanceSelectField(document.getElementById('clientFormProvenance'));
    enhanceSelectField(document.getElementById('clientEditProvenance'));
}

let kpSelectOutsideListenerBound = false;
let kpSelectTypeahead = { buffer: '', timer: null, wrap: null };

function normalizeSelectFilterText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function resetEnhancedSelectTypeahead() {
    kpSelectTypeahead.buffer = '';
    kpSelectTypeahead.wrap = null;
    if (kpSelectTypeahead.timer) {
        clearTimeout(kpSelectTypeahead.timer);
        kpSelectTypeahead.timer = null;
    }
}

function appendEnhancedSelectTypeahead(wrap, char) {
    if (!wrap || !char) return;
    if (kpSelectTypeahead.wrap !== wrap) {
        kpSelectTypeahead.buffer = '';
    }
    kpSelectTypeahead.wrap = wrap;
    kpSelectTypeahead.buffer += char;
    if (kpSelectTypeahead.timer) clearTimeout(kpSelectTypeahead.timer);
    kpSelectTypeahead.timer = setTimeout(resetEnhancedSelectTypeahead, 1000);

    const query = kpSelectTypeahead.buffer;
    const selectEl = wrap.querySelector('select.kp-select-native, select');
    if (!wrap.classList.contains('is-open')) {
        openEnhancedSelectMenu(wrap, { initialQuery: query, matchMode: 'prefix' });
        return;
    }
    const searchInput = wrap.querySelector('.kp-select-search-input');
    if (searchInput && document.activeElement !== searchInput) {
        searchInput.value = query;
    }
    filterEnhancedSelectOptions(wrap, query, 'prefix');
    if (selectEl) highlightFirstEnhancedSelectMatch(wrap, selectEl);
}

function highlightFirstEnhancedSelectMatch(wrap, selectEl) {
    const list = getEnhancedSelectList(wrap);
    if (!list) return;
    const first = Array.from(list.querySelectorAll('.kp-select-option')).find(function (li) {
        if (li.hidden) return false;
        const value = li.getAttribute('data-value') || '';
        return value !== '' && value !== '__new__';
    });
    list.querySelectorAll('.kp-select-option').forEach(function (li) {
        li.classList.remove('is-typeahead-active');
    });
    if (first) first.classList.add('is-typeahead-active');
}

function isEnhancedSelectTypeaheadKey(key) {
    return key.length === 1 && /[0-9a-zA-Z\u00C0-\u024F]/.test(key);
}

function bindEnhancedSelectTypeahead(trigger, wrap, selectEl) {
    if (!trigger || trigger.dataset.kpTypeaheadBound === '1') return;
    trigger.dataset.kpTypeaheadBound = '1';
    trigger.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === 'Backspace' && kpSelectTypeahead.wrap === wrap && kpSelectTypeahead.buffer) {
            e.preventDefault();
            kpSelectTypeahead.buffer = kpSelectTypeahead.buffer.slice(0, -1);
            const query = kpSelectTypeahead.buffer;
            const searchInput = wrap.querySelector('.kp-select-search-input');
            if (searchInput) searchInput.value = query;
            filterEnhancedSelectOptions(wrap, query, query ? 'prefix' : 'contains');
            if (selectEl) highlightFirstEnhancedSelectMatch(wrap, selectEl);
            if (!query) resetEnhancedSelectTypeahead();
            return;
        }
        if (!isEnhancedSelectTypeaheadKey(e.key)) return;
        e.preventDefault();
        appendEnhancedSelectTypeahead(wrap, normalizeSelectFilterText(e.key));
    });
}

function isClientSearchableSelect(selectEl) {
    return !!(selectEl && (
        CLIENT_SELECT_IDS.indexOf(selectEl.id) !== -1
        || CATEGORY_SELECT_IDS.indexOf(selectEl.id) !== -1
        || selectEl.dataset.kpSearchable === '1'
    ));
}

function getTransactionContactLabel(transaction) {
    return transaction && transaction.type === 'expense' ? 'Payé à' : 'Client';
}

function getInvoiceDocumentTitle(transaction) {
    return transaction && transaction.type === 'expense' ? 'Note de paiement' : 'Facture';
}

function getInvoiceDocumentTitleUpper(transaction) {
    return transaction && transaction.type === 'expense' ? 'NOTE DE PAIEMENT' : 'FACTURE';
}

function getInvoiceDocumentNumPrefix(transaction) {
    return transaction && transaction.type === 'expense' ? 'NP-' : 'FAC-';
}

let currentInvoiceTransaction = null;

function getContactSelectSearchMeta(selectId, transactionType) {
    if (selectId === 'expenseInvoiceClient' || (selectId === 'editInvoiceClient' && transactionType === 'expense')) {
        return {
            placeholder: 'Rechercher un prestataire…',
            ariaLabel: 'Rechercher un prestataire',
            emptyText: 'Aucun prestataire trouvé'
        };
    }
    if (selectId === 'incomeInvoiceClient' || (selectId === 'editInvoiceClient' && transactionType === 'income')) {
        return {
            placeholder: 'Rechercher un client…',
            ariaLabel: 'Rechercher un client',
            emptyText: 'Aucun client trouvé'
        };
    }
    if (selectId === 'userCountry') {
        return {
            placeholder: 'Rechercher un pays…',
            ariaLabel: 'Rechercher un pays',
            emptyText: 'Aucun pays trouvé'
        };
    }
    if (selectId === 'userCity') {
        return {
            placeholder: 'Rechercher une ville…',
            ariaLabel: 'Rechercher une ville',
            emptyText: 'Aucune ville trouvée'
        };
    }
    return {
        placeholder: 'Rechercher…',
        ariaLabel: 'Rechercher',
        emptyText: 'Aucun résultat'
    };
}

function updateContactSelectSearchUi(selectId, transactionType) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const wrap = sel.closest('.kp-select-wrap');
    if (!wrap) return;
    const meta = getContactSelectSearchMeta(selectId, transactionType);
    const searchInput = wrap.querySelector('.kp-select-search-input');
    const emptyEl = wrap.querySelector('.kp-select-search-empty');
    if (searchInput) {
        searchInput.placeholder = meta.placeholder;
        searchInput.setAttribute('aria-label', meta.ariaLabel);
    }
    if (emptyEl) emptyEl.textContent = meta.emptyText;
}

function updateEditInvoiceClientFieldUi(transaction) {
    const isExpense = transaction && transaction.type === 'expense';
    const labelEl = document.getElementById('editInvoiceClientLabel');
    const otherInput = document.getElementById('editInvoiceClientOther');
    if (labelEl) {
        labelEl.textContent = isExpense ? 'Payé à (optionnel)' : 'Client (optionnel, sur la facture)';
    }
    if (otherInput) {
        otherInput.placeholder = isExpense ? 'Nom du prestataire' : 'Nom du client';
    }
    updateContactSelectSearchUi('editInvoiceClient', isExpense ? 'expense' : 'income');
}

function getEnhancedSelectList(wrap) {
    if (!wrap) return null;
    return wrap.querySelector('.kp-select-menu-list') || wrap.querySelector('.kp-select-menu');
}

function getEnhancedSelectPanel(wrap) {
    return wrap ? wrap.querySelector('.kp-select-dropdown') : null;
}

function filterEnhancedSelectOptions(wrap, query, matchMode) {
    if (!wrap) return;
    const list = getEnhancedSelectList(wrap);
    const emptyEl = wrap.querySelector('.kp-select-search-empty');
    if (!list) return;
    const q = normalizeSelectFilterText(query);
    const prefixMatch = matchMode === 'prefix';
    list.querySelectorAll('.kp-select-option').forEach(function (li) {
        const value = li.getAttribute('data-value') || '';
        const text = normalizeSelectFilterText(li.textContent || '');
        const alwaysShow = value === '' || value === '__new__';
        const match = alwaysShow || !q || (prefixMatch ? text.startsWith(q) : text.indexOf(q) !== -1);
        li.hidden = !match;
        if (!match) li.classList.remove('is-typeahead-active');
    });
    const realMatches = Array.from(list.querySelectorAll('.kp-select-option')).filter(function (li) {
        if (li.hidden) return false;
        const value = li.getAttribute('data-value') || '';
        return value !== '' && value !== '__new__';
    }).length;
    if (emptyEl) {
        emptyEl.hidden = !(q && realMatches === 0);
    }
}

function clearEnhancedSelectSearch(wrap) {
    if (!wrap) return;
    const input = wrap.querySelector('.kp-select-search-input');
    if (input) input.value = '';
    filterEnhancedSelectOptions(wrap, '');
}

function refreshEnhancedSelectMenu(selectEl) {
    if (!selectEl || !selectEl.dataset.kpEnhanced) return;
    const wrap = selectEl.closest('.kp-select-wrap');
    if (!wrap) return;
    const menu = getEnhancedSelectList(wrap);
    const labelSpan = wrap.querySelector('.kp-select-trigger-label');
    if (!menu || !labelSpan) return;

    menu.innerHTML = '';
    Array.from(selectEl.options).forEach(function (opt) {
        const li = document.createElement('li');
        li.className = 'kp-select-option';
        if (!opt.value) li.classList.add('kp-select-option-muted');
        if (opt.value === '__new__') li.classList.add('kp-select-option-new');
        li.setAttribute('role', 'option');
        li.setAttribute('data-value', opt.value);
        li.textContent = opt.textContent;
        if (opt.value === selectEl.value) li.classList.add('is-selected');
        const optValue = opt.value;
        li.addEventListener('click', function (e) {
            e.stopPropagation();
            selectEl.value = optValue;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            syncEnhancedSelectLabel(selectEl);
            closeEnhancedSelectMenu(wrap);
        });
        menu.appendChild(li);
    });
    const searchInput = wrap.querySelector('.kp-select-search-input');
    filterEnhancedSelectOptions(wrap, searchInput ? searchInput.value : '');
    syncEnhancedSelectLabel(selectEl);
}

function syncEnhancedSelectLabel(selectEl) {
    const wrap = selectEl && selectEl.closest('.kp-select-wrap');
    if (!wrap) return;
    const labelSpan = wrap.querySelector('.kp-select-trigger-label');
    const menu = getEnhancedSelectList(wrap);
    if (!labelSpan) return;
    const opt = selectEl.options[selectEl.selectedIndex];
    labelSpan.textContent = opt ? opt.textContent : '— Choisir —';
    labelSpan.classList.toggle('is-placeholder', selectEl.value === '');
    if (menu) {
        menu.querySelectorAll('.kp-select-option').forEach(function (li) {
            li.classList.toggle('is-selected', li.getAttribute('data-value') === selectEl.value);
        });
    }
}

function closeEnhancedSelectMenu(wrap) {
    if (!wrap) return;
    const panel = getEnhancedSelectPanel(wrap);
    const menu = wrap.querySelector('.kp-select-menu');
    const trigger = wrap.querySelector('.kp-select-trigger');
    if (panel) panel.hidden = true;
    else if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    wrap.classList.remove('is-open');
    if (kpSelectTypeahead.wrap === wrap) resetEnhancedSelectTypeahead();
    clearEnhancedSelectSearch(wrap);
    const list = getEnhancedSelectList(wrap);
    if (list) {
        list.querySelectorAll('.kp-select-option.is-typeahead-active').forEach(function (li) {
            li.classList.remove('is-typeahead-active');
        });
    }
}

function openEnhancedSelectMenu(wrap, options) {
    options = options || {};
    document.querySelectorAll('.kp-select-wrap.is-open').forEach(function (other) {
        if (other !== wrap) closeEnhancedSelectMenu(other);
    });
    const panel = getEnhancedSelectPanel(wrap);
    const menu = wrap.querySelector('.kp-select-menu');
    const trigger = wrap.querySelector('.kp-select-trigger');
    const selectEl = wrap.querySelector('select');
    if (panel) panel.hidden = false;
    else if (menu) menu.hidden = false;
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    wrap.classList.add('is-open');
    const searchInput = wrap.querySelector('.kp-select-search-input');
    const initialQuery = options.initialQuery != null ? String(options.initialQuery) : '';
    const matchMode = options.matchMode || (initialQuery ? 'prefix' : 'contains');
    if (searchInput) {
        if (initialQuery) {
            searchInput.value = initialQuery;
            filterEnhancedSelectOptions(wrap, initialQuery, matchMode);
        } else {
            clearEnhancedSelectSearch(wrap);
        }
        setTimeout(function () {
            searchInput.focus();
            if (initialQuery) {
                searchInput.setSelectionRange(initialQuery.length, initialQuery.length);
            } else {
                searchInput.select();
            }
        }, 0);
    } else if (initialQuery) {
        filterEnhancedSelectOptions(wrap, initialQuery, matchMode);
    }
    if (selectEl && initialQuery) {
        highlightFirstEnhancedSelectMatch(wrap, selectEl);
    }
}

function enhanceSelectField(selectEl) {
    if (!selectEl || selectEl.dataset.kpEnhanced === '1') {
        refreshEnhancedSelectMenu(selectEl);
        return;
    }
    selectEl.dataset.kpEnhanced = '1';
    const searchable = isClientSearchableSelect(selectEl);

    const wrap = document.createElement('div');
    wrap.className = 'kp-select-wrap' + (searchable ? ' kp-select-wrap--searchable' : '');
    selectEl.parentNode.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'kp-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('tabindex', '0');

    const labelSpan = document.createElement('span');
    labelSpan.className = 'kp-select-trigger-label is-placeholder';
    labelSpan.textContent = '— Choisir —';
    trigger.appendChild(labelSpan);

    const chevron = document.createElement('span');
    chevron.className = 'kp-select-chevron';
    chevron.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    trigger.appendChild(chevron);

    wrap.insertBefore(trigger, selectEl);

    if (searchable) {
        const dropdown = document.createElement('div');
        dropdown.className = 'kp-select-dropdown';
        dropdown.hidden = true;

        const searchWrap = document.createElement('div');
        searchWrap.className = 'kp-select-search';
        searchWrap.innerHTML =
            '<svg class="kp-select-search-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
            '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>' +
            '<path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
            '</svg>';

        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.className = 'kp-select-search-input';
        const searchMeta = getContactSelectSearchMeta(selectEl.id);
        searchInput.placeholder = searchMeta.placeholder;
        searchInput.setAttribute('autocomplete', 'off');
        searchInput.setAttribute('aria-label', searchMeta.ariaLabel);
        searchWrap.appendChild(searchInput);

        const emptyEl = document.createElement('div');
        emptyEl.className = 'kp-select-search-empty';
        emptyEl.textContent = searchMeta.emptyText;
        emptyEl.hidden = true;

        const menu = document.createElement('ul');
        menu.className = 'kp-select-menu kp-select-menu-list';
        menu.setAttribute('role', 'listbox');

        dropdown.appendChild(searchWrap);
        dropdown.appendChild(emptyEl);
        dropdown.appendChild(menu);
        wrap.appendChild(dropdown);

        searchWrap.addEventListener('click', function (e) {
            e.stopPropagation();
        });
        searchInput.addEventListener('click', function (e) {
            e.stopPropagation();
        });
        searchInput.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (e.key === 'Escape') {
                e.preventDefault();
                closeEnhancedSelectMenu(wrap);
                trigger.focus();
            }
        });
        searchInput.addEventListener('input', function () {
            if (kpSelectTypeahead.wrap === wrap) resetEnhancedSelectTypeahead();
            const q = searchInput.value;
            const mode = q.length === 1 ? 'prefix' : 'contains';
            filterEnhancedSelectOptions(wrap, q, mode);
            highlightFirstEnhancedSelectMatch(wrap, selectEl);
        });
        dropdown.addEventListener('click', function (e) {
            e.stopPropagation();
        });
    } else {
        const menu = document.createElement('ul');
        menu.className = 'kp-select-menu';
        menu.setAttribute('role', 'listbox');
        menu.hidden = true;
        wrap.appendChild(menu);
    }

    trigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (wrap.classList.contains('is-open')) closeEnhancedSelectMenu(wrap);
        else openEnhancedSelectMenu(wrap);
    });

    bindEnhancedSelectTypeahead(trigger, wrap, selectEl);

    selectEl.addEventListener('change', function () {
        syncEnhancedSelectLabel(selectEl);
    });

    if (!kpSelectOutsideListenerBound) {
        kpSelectOutsideListenerBound = true;
        document.addEventListener('click', function () {
            document.querySelectorAll('.kp-select-wrap.is-open').forEach(closeEnhancedSelectMenu);
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                document.querySelectorAll('.kp-select-wrap.is-open').forEach(closeEnhancedSelectMenu);
            }
        });
    }

    refreshEnhancedSelectMenu(selectEl);
}

function clientListLocalStorageKey(accountId) {
    return 'kaayprint_clients_' + accountId;
}

function generateClientId() {
    return 'cli_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function normalizeClientEntry(c) {
    if (!c || typeof c !== 'object') return null;
    const name = c.name != null ? String(c.name).trim().slice(0, 200) : '';
    if (!name) return null;
    const aliasesRaw = Array.isArray(c.aliases) ? c.aliases : [];
    const aliases = [];
    const seenAlias = new Set();
    aliasesRaw.forEach(function (alias) {
        const a = String(alias || '').trim().slice(0, 200);
        const key = invoiceClientNameKey(a);
        if (!a || key === invoiceClientNameKey(name) || seenAlias.has(key)) return;
        seenAlias.add(key);
        aliases.push(a);
    });
    return {
        id: c.id ? String(c.id) : generateClientId(),
        name: name,
        phone: c.phone != null ? String(c.phone).trim().slice(0, 40) : '',
        note: c.note != null ? String(c.note).trim().slice(0, 500) : '',
        provenance: (function () {
            const p = normalizeClientProvenance(c.provenance);
            return isValidClientProvenance(p) ? p : '';
        })(),
        createdAt: c.createdAt || new Date().toISOString(),
        aliases: aliases
    };
}

function normalizeClientListPayload(obj) {
    const o = obj && typeof obj === 'object' ? obj : {};
    const raw = Array.isArray(o.clients) ? o.clients : (Array.isArray(o) ? o : []);
    const seen = new Set();
    const clients = [];
    raw.forEach(function (item) {
        const n = normalizeClientEntry(item);
        if (!n) return;
        const key = n.name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        clients.push(n);
    });
    clients.sort(compareClientsNewestFirst);
    return { clients: clients };
}

function compareClientsNewestFirst(a, b) {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
}

function loadClientsFromLocalStorage(accountId) {
    try {
        const raw = localStorage.getItem(clientListLocalStorageKey(accountId));
        if (raw) return normalizeClientListPayload(JSON.parse(raw));
    } catch (e) {
        /* ignore */
    }
    return { clients: [] };
}

function persistClientsLocal(accountId, data) {
    const n = normalizeClientListPayload(data);
    const prevJson = JSON.stringify(cachedClients);
    const nextJson = JSON.stringify(n.clients);
    localStorage.setItem(clientListLocalStorageKey(accountId), JSON.stringify(n));
    cachedClients = n.clients.slice();
    refreshClientSelectOptions();
    renderClientsModalTable();
    updateClientProfileReminderBadge();
    // Éviter un 2e refresh du tableau historique si la liste clients n'a pas changé
    if (prevJson === nextJson) return;
    hydrateTransactionClientLinks();
    if (transactions.length) updateDisplay();
    syncTransactionClientLinks();
}

function saveClientsList(accountId, data) {
    const payload = normalizeClientListPayload(data);
    if (useFirebase && db) {
        return db.collection('clientLists').doc(accountId).set(payload, { merge: true })
            .then(function () {
                persistClientsLocal(accountId, payload);
            })
            .catch(function (error) {
                console.error('Liste clients Firestore:', error);
                persistClientsLocal(accountId, payload);
                showNotification('Firebase indisponible : contacts enregistrés sur cet appareil uniquement.', 'error');
            });
    }
    persistClientsLocal(accountId, payload);
    return Promise.resolve();
}

let cachedProductCategories = [];
let cachedProductCategoryRecords = [];
let categoriesListenersBound = false;
let categoriesCurrentPage = 1;
const categoriesItemsPerPage = 15;

function categoryListLocalStorageKey(accountId) {
    return 'kaayprint_product_categories_' + accountId;
}

function normalizeCategoryName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function normalizeCategoryDescription(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 500);
}

function normalizeCategoryRecord(item) {
    if (item && typeof item === 'object') {
        return {
            name: normalizeCategoryName(item.name || item.nom),
            description: normalizeCategoryDescription(item.description || item.note)
        };
    }
    return {
        name: normalizeCategoryName(item),
        description: ''
    };
}

function normalizeCategoryListPayload(obj) {
    const o = obj && typeof obj === 'object' ? obj : {};
    const raw = Array.isArray(o.categories) ? o.categories : (Array.isArray(o) ? o : []);
    const seen = new Set();
    const categories = [];
    raw.forEach(function (item) {
        const category = normalizeCategoryRecord(item);
        const key = category.name.toLowerCase();
        if (!category.name || seen.has(key)) return;
        seen.add(key);
        categories.push(category);
    });
    categories.sort(function (a, b) {
        return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    });
    return { categories: categories };
}

function loadCategoriesFromLocalStorage(accountId) {
    try {
        const raw = localStorage.getItem(categoryListLocalStorageKey(accountId));
        if (raw) return normalizeCategoryListPayload(JSON.parse(raw));
    } catch (e) {
        /* ignore */
    }
    return { categories: [] };
}

function persistCategoriesLocal(accountId, data) {
    const n = normalizeCategoryListPayload(data);
    const prevJson = JSON.stringify(cachedProductCategoryRecords);
    const nextJson = JSON.stringify(n.categories);
    localStorage.setItem(categoryListLocalStorageKey(accountId), JSON.stringify(n));
    cachedProductCategoryRecords = n.categories.slice();
    cachedProductCategories = n.categories.map(function (category) { return category.name; });
    refreshCategorySelectOptions();
    renderCategoriesList();
    // Éviter un 2e refresh du tableau historique si les catégories n'ont pas changé
    if (prevJson === nextJson) return;
    if (transactions.length) updateDisplay();
}

function saveCategoriesList(accountId, data) {
    const payload = normalizeCategoryListPayload(data);
    persistCategoriesLocal(accountId, payload);
    return Promise.resolve();
}

function categoryExists(name) {
    const key = normalizeCategoryName(name).toLowerCase();
    return !!key && cachedProductCategories.some(function (item) {
        return item.toLowerCase() === key;
    });
}

function getCategoryRecord(name) {
    const key = categoryNameKey(name);
    if (!key) return null;
    return cachedProductCategoryRecords.find(function (category) {
        return categoryNameKey(category.name) === key;
    }) || null;
}

function getTransactionCategory(transaction) {
    return normalizeCategoryName(transaction && (transaction.category || transaction.categorie_produit));
}

function categoryNameKey(name) {
    return normalizeCategoryName(name).toLowerCase();
}

function transactionBelongsToCategory(transaction, categoryName) {
    return !!(
        transaction &&
        transaction.type === 'income' &&
        categoryNameKey(getTransactionCategory(transaction)) === categoryNameKey(categoryName)
    );
}

function getCategoryOrderStats(categoryName) {
    let count = 0;
    let totalOrdered = 0;
    let totalPaid = 0;
    let totalRemaining = 0;

    transactions.forEach(function (transaction) {
        if (!transactionBelongsToCategory(transaction, categoryName)) return;
        count++;
        const paid = parseFloat(transaction.amount) || 0;
        const remaining = parseFloat(transaction.remainingAmount) || 0;
        totalPaid += paid;
        totalRemaining += remaining;
        totalOrdered += paid + remaining;
    });

    return {
        count: count,
        totalOrdered: totalOrdered,
        totalPaid: totalPaid,
        totalRemaining: totalRemaining
    };
}

function buildCategoryOrderTotalHtml(stats) {
    if (!stats || stats.count === 0) {
        return '<div class="client-order-total category-order-total is-empty">' +
            '<span class="client-order-total-label">Aucune commande</span>' +
            '<span class="client-order-total-value">0&nbsp;' + escapeHtml(getCurrencyLabel()) + '</span>' +
            '</div>';
    }
    return '<div class="client-order-total category-order-total">' +
        '<span class="client-order-total-label">Total commandes</span>' +
        '<span class="client-order-total-value">' + formatAmount(stats.totalOrdered) + '</span>' +
        (stats.totalRemaining > 0
            ? '<span class="client-order-remaining">Reste&nbsp;' + formatAmount(stats.totalRemaining) + '</span>'
            : '') +
        '</div>';
}

function getCategoriesModalSearchQuery() {
    const searchEl = document.getElementById('categoriesModalSearch');
    return searchEl ? String(searchEl.value || '').trim().toLowerCase() : '';
}

function getFilteredCategoriesForModal() {
    const query = getCategoriesModalSearchQuery();
    if (!query) return cachedProductCategories.slice();
    return cachedProductCategories.filter(function (name) {
        const category = getCategoryRecord(name);
        const description = category ? category.description : '';
        return normalizeCategoryName(name).toLowerCase().indexOf(query) !== -1 ||
            description.toLowerCase().indexOf(query) !== -1;
    });
}

function updateCategoriesPaginationInfo(totalPages, totalItems) {
    const pageInfo = document.getElementById('categoriesPageInfo');
    const prevBtn = document.getElementById('categoriesPrevBtn');
    const nextBtn = document.getElementById('categoriesNextBtn');
    if (!pageInfo) return;
    const startItem = totalItems === 0 ? 0 : (categoriesCurrentPage - 1) * categoriesItemsPerPage + 1;
    const endItem = Math.min(categoriesCurrentPage * categoriesItemsPerPage, totalItems);
    pageInfo.textContent = totalItems === 0
        ? '0 catégorie'
        : startItem + '-' + endItem + ' sur ' + totalItems + ' (Page ' + categoriesCurrentPage + '/' + totalPages + ')';
    if (prevBtn) prevBtn.disabled = categoriesCurrentPage === 1;
    if (nextBtn) nextBtn.disabled = categoriesCurrentPage >= totalPages;
}

function changeCategoriesPage(direction) {
    const filtered = getFilteredCategoriesForModal();
    const totalPages = Math.ceil(filtered.length / categoriesItemsPerPage) || 1;
    categoriesCurrentPage += direction;
    categoriesCurrentPage = Math.max(1, Math.min(categoriesCurrentPage, totalPages));
    renderCategoriesList();
}

function fillCategorySelect(selectEl, selectedValue) {
    if (!selectEl) return;
    const otherInput = document.getElementById(selectEl.id + 'Other');
    const wasOther = selectEl.value === '__new__';
    const otherVal = otherInput ? otherInput.value : '';
    const current = normalizeCategoryName(selectedValue != null ? selectedValue : (wasOther ? otherVal : selectEl.value));
    while (selectEl.options.length > 0) selectEl.remove(0);
    const optPlaceholder = document.createElement('option');
    optPlaceholder.value = '';
    optPlaceholder.textContent = '— Non catégorisé —';
    selectEl.appendChild(optPlaceholder);
    const optNew = document.createElement('option');
    optNew.value = '__new__';
    optNew.textContent = '+ Ajouter';
    selectEl.appendChild(optNew);
    cachedProductCategories.forEach(function (name) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        selectEl.appendChild(opt);
    });
    if (current && categoryExists(current)) {
        selectEl.value = current;
        if (otherInput) {
            otherInput.hidden = true;
            otherInput.value = '';
        }
    } else if (current) {
        selectEl.value = '__new__';
        if (otherInput) {
            otherInput.hidden = false;
            otherInput.value = current;
        }
    } else {
        selectEl.value = '';
        if (otherInput) {
            otherInput.hidden = true;
            otherInput.value = '';
        }
    }
    refreshEnhancedSelectMenu(selectEl);
}

function refreshCategorySelectOptions() {
    CATEGORY_SELECT_IDS.forEach(function (selectId) {
        const sel = document.getElementById(selectId);
        fillCategorySelect(sel);
        enhanceSelectField(sel);
    });
}

function addCategoryEntry(name, description) {
    const normalized = normalizeCategoryName(name);
    if (!normalized) {
        showNotification('Le nom de la catégorie est obligatoire.', 'error');
        return Promise.resolve(false);
    }
    if (categoryExists(normalized)) {
        showNotification('Cette catégorie existe déjà.', 'warning');
        return Promise.resolve(false);
    }
    const next = normalizeCategoryListPayload({
        categories: cachedProductCategoryRecords.concat([{
            name: normalized,
            description: normalizeCategoryDescription(description)
        }])
    });
    return saveCategoriesList(getCurrentAccountId(), next).then(function () {
        return true;
    });
}

function ensureCategorySaved(name) {
    const normalized = normalizeCategoryName(name);
    if (!normalized) return Promise.resolve('');
    if (categoryExists(normalized)) return Promise.resolve(normalized);
    return addCategoryEntry(normalized).then(function (ok) {
        return ok ? normalized : '';
    });
}

function getCategorySelectionFromControl(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return '';
    if (sel.tagName === 'SELECT' && sel.value === '__new__') {
        const other = document.getElementById(selectId + 'Other');
        return normalizeCategoryName(other ? other.value : '');
    }
    return normalizeCategoryName(sel.value || '');
}

function resetCategorySelectForm(selectId) {
    const sel = document.getElementById(selectId);
    const other = document.getElementById(selectId + 'Other');
    if (sel) {
        sel.value = '';
        syncEnhancedSelectLabel(sel);
    }
    if (other) {
        other.hidden = true;
        other.value = '';
    }
}

function bindCategorySelectOtherToggle(selectId) {
    const sel = document.getElementById(selectId);
    const other = document.getElementById(selectId + 'Other');
    if (!sel || !other || sel.dataset.categoryBound === '1') return;
    sel.dataset.categoryBound = '1';
    sel.addEventListener('change', function () {
        if (sel.value === '__new__') {
            other.hidden = false;
            other.focus();
        } else {
            other.hidden = true;
            other.value = '';
        }
    });
}

function deleteCategoryEntry(name) {
    const normalized = normalizeCategoryName(name);
    if (!normalized) return Promise.resolve(false);
    const next = normalizeCategoryListPayload({
        categories: cachedProductCategoryRecords.filter(function (item) {
            return categoryNameKey(item.name) !== categoryNameKey(normalized);
        })
    });
    return saveCategoriesList(getCurrentAccountId(), next).then(function () {
        return true;
    });
}

function renameCategoryEntry(oldName, newName, description) {
    const oldNormalized = normalizeCategoryName(oldName);
    const newNormalized = normalizeCategoryName(newName);
    const newDescription = normalizeCategoryDescription(description);
    const currentRecord = getCategoryRecord(oldNormalized);
    if (!oldNormalized || !newNormalized) {
        showNotification('Le nom de la catégorie est obligatoire.', 'error');
        return Promise.resolve(false);
    }
    const nameChanged = categoryNameKey(oldNormalized) !== categoryNameKey(newNormalized);
    const descriptionChanged = (currentRecord ? currentRecord.description : '') !== newDescription;
    if (!nameChanged && !descriptionChanged) {
        closeCategoryEditModal();
        return Promise.resolve(true);
    }
    if (nameChanged && categoryExists(newNormalized)) {
        showNotification('Cette catégorie existe déjà.', 'warning');
        return Promise.resolve(false);
    }

    const next = normalizeCategoryListPayload({
        categories: cachedProductCategoryRecords.map(function (item) {
            if (categoryNameKey(item.name) !== categoryNameKey(oldNormalized)) return item;
            return {
                name: newNormalized,
                description: newDescription
            };
        })
    });
    const toUpdate = nameChanged
        ? transactions.filter(function (transaction) {
            return transactionBelongsToCategory(transaction, oldNormalized);
        })
        : [];
    const patch = { category: newNormalized };

    return saveCategoriesList(getCurrentAccountId(), next).then(function () {
        return Promise.all(toUpdate.map(function (transaction) {
            return patchTransactionOnFirestore(transaction.id, patch).then(function () {
                return true;
            }).catch(function (error) {
                console.error('Synchronisation catégorie transaction', transaction.id, error);
                return false;
            });
        }));
    }).then(function (results) {
        toUpdate.forEach(function (transaction) {
            applyTransactionPatchLocal(transaction.id, patch);
        });
        if (!useFirebase || !db) {
            persistTransactionsCache();
        } else {
            updateDisplay();
        }
        if (transactionCategoryFilter && categoryNameKey(transactionCategoryFilter) === categoryNameKey(oldNormalized)) {
            transactionCategoryFilter = newNormalized;
            updateCategoryTransactionFilterBar();
        }
        renderCategoriesList();
        closeCategoryEditModal();
        const failed = results.filter(function (ok) { return !ok; }).length;
        if (failed > 0) {
            showNotification('Catégorie modifiée, mais ' + failed + ' transaction(s) non synchronisée(s).', 'error');
        }
        return true;
    });
}

function renderCategoriesList() {
    const listEl = document.getElementById('categoriesList');
    const emptyEl = document.getElementById('categoriesModalEmpty');
    const noResultsEl = document.getElementById('categoriesModalNoResults');
    const wrapEl = document.getElementById('categoriesTableWrap');
    const toolbarEl = document.getElementById('categoriesModalToolbar');
    const countEl = document.getElementById('categoriesModalCount');
    const paginationEl = document.getElementById('categoriesPagination');
    if (!listEl) return;

    listEl.innerHTML = '';
    const isEmpty = cachedProductCategories.length === 0;
    const query = getCategoriesModalSearchQuery();
    const filtered = getFilteredCategoriesForModal();
    const totalPages = Math.ceil(filtered.length / categoriesItemsPerPage) || 1;
    categoriesCurrentPage = Math.min(categoriesCurrentPage, totalPages) || 1;
    const startIndex = (categoriesCurrentPage - 1) * categoriesItemsPerPage;
    const categories = filtered.slice(startIndex, startIndex + categoriesItemsPerPage);

    if (emptyEl) emptyEl.hidden = !isEmpty;
    if (toolbarEl) toolbarEl.hidden = isEmpty;
    if (wrapEl) wrapEl.hidden = isEmpty || filtered.length === 0;
    if (noResultsEl) noResultsEl.hidden = isEmpty || filtered.length > 0;
    if (countEl) {
        const total = cachedProductCategories.length;
        countEl.textContent = query
            ? filtered.length + ' / ' + total + ' catégorie' + (total !== 1 ? 's' : '')
            : total + ' catégorie' + (total !== 1 ? 's' : '');
    }
    if (paginationEl) {
        paginationEl.hidden = isEmpty || filtered.length <= categoriesItemsPerPage;
        if (!paginationEl.hidden) {
            updateCategoriesPaginationInfo(totalPages, filtered.length);
        }
    }
    if (isEmpty || filtered.length === 0) {
        return;
    }

    listEl.innerHTML = categories.map(function (name) {
        const category = getCategoryRecord(name) || { description: '' };
        const stats = getCategoryOrderStats(name);
        const metaHtml = '<div class="client-meta">' +
            '<span class="client-meta-part">' + stats.count + '&nbsp;commande' + (stats.count !== 1 ? 's' : '') + '</span>' +
            '</div>';
        const noteHtml = category.description
            ? '<div class="client-note">' + escapeHtml(category.description) + '</div>'
            : '';
        const orderTotalHtml = buildCategoryOrderTotalHtml(stats);
        return '<div class="client-item category-item visible">' +
            '<div class="client-item-main">' +
            '<div class="client-info">' +
            '<div class="client-name">' + escapeHtml(name) + '</div>' +
            metaHtml +
            noteHtml +
            '</div>' +
            orderTotalHtml +
            '</div>' +
            '<div class="transaction-actions client-item-actions">' +
            '<button type="button" class="invoice-btn" data-category-transactions="' + escapeHtml(name) + '" title="Voir les transactions" aria-label="Voir les transactions de la catégorie ' + escapeHtml(name) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</button>' +
            '<button type="button" class="edit-btn" data-category-edit="' + escapeHtml(name) + '" title="Modifier" aria-label="Modifier la catégorie ' + escapeHtml(name) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</button>' +
            '<button type="button" class="delete-btn" data-category-delete="' + escapeHtml(name) + '" title="Supprimer" aria-label="Supprimer la catégorie ' + escapeHtml(name) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</button>' +
            '</div>' +
            '</div>';
    }).join('');
}

function openCategoryEditModal(name) {
    const normalized = normalizeCategoryName(name);
    if (!normalized) return;
    const category = getCategoryRecord(normalized);
    const modal = document.getElementById('categoryEditModal');
    const originalEl = document.getElementById('categoryEditOriginalName');
    const nameEl = document.getElementById('categoryEditName');
    const descriptionEl = document.getElementById('categoryEditDescription');
    const errorEl = document.getElementById('categoryEditNameError');
    if (originalEl) originalEl.value = normalized;
    if (nameEl) {
        nameEl.value = normalized;
        nameEl.classList.remove('error', 'valid');
    }
    if (descriptionEl) descriptionEl.value = category ? category.description : '';
    if (errorEl) errorEl.textContent = '';
    if (modal) modal.style.display = 'flex';
    lockPageScroll();
    setTimeout(function () {
        if (nameEl) {
            nameEl.focus();
            nameEl.select();
        }
    }, 0);
}

function closeCategoryEditModal() {
    const modal = document.getElementById('categoryEditModal');
    const form = document.getElementById('categoryEditForm');
    const errorEl = document.getElementById('categoryEditNameError');
    if (modal) modal.style.display = 'none';
    if (form) form.reset();
    if (errorEl) errorEl.textContent = '';
    unlockPageScroll();
}

window.closeCategoryEditModal = closeCategoryEditModal;

function openCategoriesListModal() {
    const searchEl = document.getElementById('categoriesModalSearch');
    categoriesCurrentPage = 1;
    if (searchEl) searchEl.value = '';
    renderCategoriesList();
    const modal = document.getElementById('categoriesListModal');
    if (modal) modal.style.display = 'flex';
    lockPageScroll();
}

function closeCategoriesListModal() {
    const modal = document.getElementById('categoriesListModal');
    if (modal) modal.style.display = 'none';
    unlockPageScroll();
}

window.openCategoriesListModal = openCategoriesListModal;
window.closeCategoriesListModal = closeCategoriesListModal;

// ——— Notes utiles ———
let cachedNotes = [];
let notesListenersBound = false;
let editingNoteId = null;
let notesCurrentPage = 1;
const notesItemsPerPage = 15;
let notesQuickFilter = 'all';
let lastAddedNoteId = null;

function noteListLocalStorageKey(accountId) {
    return 'kaayprint_notes_' + accountId;
}

function normalizeNoteTitle(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 200);
}

function normalizeNoteContent(value) {
    return String(value || '').trim().slice(0, 4000);
}

function normalizeNoteRecord(item) {
    const o = item && typeof item === 'object' ? item : {};
    const clientId = o.clientId ? String(o.clientId).trim() : '';
    const clientName = String(o.clientName || o.invoiceClient || '').trim();
    return {
        id: String(o.id || '').trim(),
        title: normalizeNoteTitle(o.title),
        content: normalizeNoteContent(o.content),
        clientId: clientId || null,
        clientName: clientName || null,
        category: normalizeCategoryName(o.category),
        createdAt: o.createdAt || null,
        updatedAt: o.updatedAt || null,
    };
}

function normalizeNoteListPayload(obj) {
    const o = obj && typeof obj === 'object' ? obj : {};
    const raw = Array.isArray(o.notes) ? o.notes : (Array.isArray(o) ? o : []);
    return {
        notes: raw.map(normalizeNoteRecord).filter(function (n) { return n.id && n.title; }),
    };
}

function generateNoteId() {
    return 'note_' + Date.now().toString(16) + '_' + Math.random().toString(16).slice(2, 8);
}

function loadNotesFromLocalStorage(accountId) {
    try {
        const raw = localStorage.getItem(noteListLocalStorageKey(accountId));
        if (raw) return normalizeNoteListPayload(JSON.parse(raw));
    } catch (e) {
        /* ignore */
    }
    return { notes: [] };
}

function persistNotesLocal(accountId, data) {
    const n = normalizeNoteListPayload(data);
    localStorage.setItem(noteListLocalStorageKey(accountId), JSON.stringify(n));
    cachedNotes = n.notes.slice();
    renderNotesList();
    renderNotesModalList();
}

function saveNotesList(accountId, data) {
    persistNotesLocal(accountId, data);
    return Promise.resolve();
}

function resetNoteForm() {
    editingNoteId = null;
    const idEl = document.getElementById('noteEditId');
    const titleEl = document.getElementById('noteTitle');
    const contentEl = document.getElementById('noteContent');
    const errorEl = document.getElementById('noteTitleError');
    const submitBtn = document.getElementById('noteFormSubmit');
    if (idEl) idEl.value = '';
    if (titleEl) {
        titleEl.value = '';
        titleEl.classList.remove('error', 'valid');
    }
    if (contentEl) contentEl.value = '';
    if (errorEl) errorEl.textContent = '';
    resetClientSelectForm('noteClient');
    resetCategorySelectForm('noteCategory');
    if (submitBtn) submitBtn.textContent = 'Ajouter la note';
}

function startEditNote(noteId) {
    const note = cachedNotes.find(function (n) { return n.id === noteId; });
    if (!note) return;
    closeNoteViewModal();
    closeNotesListModal();
    editingNoteId = noteId;
    const idEl = document.getElementById('noteEditId');
    const titleEl = document.getElementById('noteTitle');
    const contentEl = document.getElementById('noteContent');
    const submitBtn = document.getElementById('noteFormSubmit');
    if (idEl) idEl.value = noteId;
    if (titleEl) {
        titleEl.value = note.title;
        titleEl.focus();
    }
    if (contentEl) contentEl.value = note.content || '';
    setInvoiceClientControl('noteClient', note.clientName || '');
    fillCategorySelect(document.getElementById('noteCategory'), note.category || '');
    if (submitBtn) submitBtn.textContent = 'Enregistrer';
    if (typeof applyActiveTab === 'function') applyActiveTab('notes');
}

function formatNoteDate(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
        return '';
    }
}

function formatNoteRelativeDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'à l\u2019instant';
    if (minutes < 60) return 'il y a ' + minutes + ' min';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return 'il y a ' + hours + ' h';
    const days = Math.floor(hours / 24);
    if (days === 1) return 'hier';
    if (days < 7) return 'il y a ' + days + ' j';
    return formatNoteDate(iso);
}

function noteColorClass(noteId) {
    const s = String(noteId || '');
    let sum = 0;
    for (let i = 0; i < s.length; i++) sum = (sum + s.charCodeAt(i)) % 997;
    return 'note-card--c' + (sum % 6);
}

function getNotesSearchQuery(searchId) {
    const searchEl = document.getElementById(searchId || 'noteSearch');
    return String(searchEl && searchEl.value || '').trim().toLowerCase();
}

function filterNotesByQuery(query, quickFilter) {
    const q = String(query || '').trim().toLowerCase();
    const filter = quickFilter || notesQuickFilter || 'all';
    let list = cachedNotes.slice();

    if (filter === 'client') {
        list = list.filter(function (n) { return !!(n.clientId || n.clientName); });
    } else if (filter === 'category') {
        list = list.filter(function (n) { return !!(n.category && String(n.category).trim()); });
    }

    if (q) {
        list = list.filter(function (n) {
            return (n.title || '').toLowerCase().indexOf(q) !== -1
                || (n.content || '').toLowerCase().indexOf(q) !== -1
                || (n.clientName || '').toLowerCase().indexOf(q) !== -1
                || (n.category || '').toLowerCase().indexOf(q) !== -1;
        });
    }
    list.sort(function (a, b) {
        const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
        const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
        return tb - ta;
    });
    return list;
}

function getFilteredNotes() {
    return filterNotesByQuery(getNotesSearchQuery('noteSearch'), notesQuickFilter);
}

function truncateNotePreview(text, maxLen) {
    const raw = String(text || '').trim().replace(/\s+/g, ' ');
    if (!raw) return '';
    if (raw.length <= maxLen) return raw;
    return raw.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

function getNotesEmptyStateHtml(isSearchOrFilter) {
    if (isSearchOrFilter) {
        return '<div class="notes-empty-state" id="notesEmptyState">'
            + '<svg class="notes-empty-illustration" viewBox="0 0 120 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
            + '<circle cx="52" cy="44" r="22" stroke="#43277d" stroke-width="2.5" fill="#f8f6fc"/>'
            + '<path d="M68 60l18 18" stroke="#43277d" stroke-width="2.5" stroke-linecap="round"/>'
            + '</svg>'
            + '<p class="notes-empty-title">Aucun résultat</p>'
            + '<p class="notes-empty-hint">Essayez un autre mot ou changez de filtre.</p>'
            + '</div>';
    }
    return '<div class="notes-empty-state" id="notesEmptyState">'
        + '<svg class="notes-empty-illustration" viewBox="0 0 120 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
        + '<rect x="28" y="12" width="64" height="72" rx="8" stroke="#43277d" stroke-width="2.5" fill="#f8f6fc"/>'
        + '<path d="M44 12v10a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4V12" stroke="#43277d" stroke-width="2.5"/>'
        + '<path d="M44 44h32M44 56h24M44 68h28" stroke="#43277d" stroke-width="2" stroke-linecap="round" opacity="0.45"/>'
        + '</svg>'
        + '<p class="notes-empty-title">Aucune note pour le moment</p>'
        + '<p class="notes-empty-hint">Ajoutez une note à gauche pour la retrouver ici.</p>'
        + '</div>';
}

function buildNoteItemHtml(note, index) {
    const isoDate = note.updatedAt || note.createdAt;
    const dateLabel = formatNoteRelativeDate(isoDate);
    const dateFull = formatNoteDate(isoDate);
    const preview = escapeHtml(truncateNotePreview(note.content, 220));
    const linkBits = [];
    if (note.clientName) {
        linkBits.push('<span class="transaction-client"><span class="transaction-client-label">Client\u00A0: </span><span class="transaction-client-name">' + escapeHtml(note.clientName) + '</span></span>');
    }
    if (note.category) {
        linkBits.push('<span class="transaction-category"><span class="transaction-client-label">Catégorie\u00A0: </span><span class="transaction-client-name">' + escapeHtml(note.category) + '</span></span>');
    }
    const isNew = lastAddedNoteId && note.id === lastAddedNoteId;
    return '<article class="note-item note-card visible' + (isNew ? ' note-item--new' : '') + '"'
        + ' data-note-open="' + escapeHtml(note.id) + '"'
        + ' title="Cliquer pour lire la note"'
        + ' style="animation-delay:' + (index * 0.04) + 's">'
        + '<h3 class="note-card-title">' + escapeHtml(note.title) + '</h3>'
        + (linkBits.length ? '<div class="note-item-links">' + linkBits.join('') + '</div>' : '')
        + (preview ? '<p class="note-card-text">' + preview + '</p>' : '')
        + '<div class="note-card-footer">'
        + '<span class="note-card-date" title="' + escapeHtml(dateFull) + '">' + escapeHtml(dateLabel) + '</span>'
        + '<div class="note-card-actions">'
        + '<button type="button" class="edit-btn" data-note-edit="' + escapeHtml(note.id) + '" title="Modifier" aria-label="Modifier la note">'
        + '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        + '</button>'
        + '<button type="button" class="delete-btn" data-note-delete="' + escapeHtml(note.id) + '" title="Supprimer" aria-label="Supprimer la note">'
        + '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        + '</button>'
        + '</div></div></article>';
}

function renderNotesList() {
    const listEl = document.getElementById('notesList');
    if (!listEl) return;
    const notes = getFilteredNotes();
    const hasQuery = !!getNotesSearchQuery('noteSearch');
    const hasFilter = notesQuickFilter && notesQuickFilter !== 'all';

    if (notes.length === 0) {
        listEl.innerHTML = getNotesEmptyStateHtml(cachedNotes.length > 0 && (hasQuery || hasFilter));
        return;
    }

    // Panneau « Mes notes » : uniquement les 2 plus récentes ; le reste via « Voir toutes les notes »
    const previewNotes = notes.slice(0, 2);
    listEl.innerHTML = previewNotes.map(function (note, index) {
        return buildNoteItemHtml(note, index);
    }).join('');

    if (lastAddedNoteId) {
        const animId = lastAddedNoteId;
        setTimeout(function () {
            if (lastAddedNoteId === animId) {
                lastAddedNoteId = null;
            }
            const el = document.querySelector('.note-item--new');
            if (el) el.classList.remove('note-item--new');
        }, 900);
    }
}

function updateNotesPaginationInfo(totalPages, totalItems) {
    const pageInfo = document.getElementById('notesPageInfo');
    const prevBtn = document.getElementById('notesPrevBtn');
    const nextBtn = document.getElementById('notesNextBtn');
    if (!pageInfo) return;
    const startItem = totalItems === 0 ? 0 : (notesCurrentPage - 1) * notesItemsPerPage + 1;
    const endItem = Math.min(notesCurrentPage * notesItemsPerPage, totalItems);
    pageInfo.textContent = totalItems === 0
        ? '0 note'
        : startItem + '-' + endItem + ' sur ' + totalItems + ' (Page ' + notesCurrentPage + '/' + totalPages + ')';
    if (prevBtn) prevBtn.disabled = notesCurrentPage === 1;
    if (nextBtn) nextBtn.disabled = notesCurrentPage >= totalPages;
}

function changeNotesPage(direction) {
    const filtered = filterNotesByQuery(getNotesSearchQuery('notesModalSearch'), 'all');
    const totalPages = Math.ceil(filtered.length / notesItemsPerPage) || 1;
    notesCurrentPage += direction;
    notesCurrentPage = Math.max(1, Math.min(notesCurrentPage, totalPages));
    renderNotesModalList();
}

function renderNotesModalList() {
    const listEl = document.getElementById('notesModalList');
    const emptyEl = document.getElementById('notesModalEmpty');
    const noResultsEl = document.getElementById('notesModalNoResults');
    const wrapEl = document.getElementById('notesTableWrap');
    const toolbarEl = document.getElementById('notesModalToolbar');
    const countEl = document.getElementById('notesModalCount');
    const paginationEl = document.getElementById('notesPagination');
    if (!listEl) return;

    const isEmpty = cachedNotes.length === 0;
    const query = getNotesSearchQuery('notesModalSearch');
    const filtered = filterNotesByQuery(query, 'all');
    const totalPages = Math.ceil(filtered.length / notesItemsPerPage) || 1;
    notesCurrentPage = Math.min(notesCurrentPage, totalPages) || 1;
    const startIndex = (notesCurrentPage - 1) * notesItemsPerPage;
    const paginated = filtered.slice(startIndex, startIndex + notesItemsPerPage);

    if (emptyEl) emptyEl.hidden = !isEmpty;
    if (toolbarEl) toolbarEl.hidden = isEmpty;
    if (wrapEl) wrapEl.hidden = isEmpty || filtered.length === 0;
    if (noResultsEl) noResultsEl.hidden = isEmpty || filtered.length > 0;

    if (countEl) {
        const total = cachedNotes.length;
        if (!query) {
            countEl.textContent = total + ' note' + (total !== 1 ? 's' : '');
        } else {
            countEl.textContent = filtered.length + ' / ' + total + ' note' + (total !== 1 ? 's' : '');
        }
    }

    if (paginationEl) {
        paginationEl.hidden = isEmpty || filtered.length <= notesItemsPerPage;
        if (!paginationEl.hidden) {
            updateNotesPaginationInfo(totalPages, filtered.length);
        }
    }

    if (isEmpty || filtered.length === 0) {
        listEl.innerHTML = '';
        return;
    }

    listEl.innerHTML = paginated.map(function (note, index) {
        return buildNoteItemHtml(note, index);
    }).join('');
}

function openNotesListModal() {
    const modal = document.getElementById('notesListModal');
    if (!modal) return;
    const searchEl = document.getElementById('notesModalSearch');
    const panelSearch = document.getElementById('noteSearch');
    notesCurrentPage = 1;
    if (searchEl) searchEl.value = panelSearch ? panelSearch.value : '';
    renderNotesModalList();
    modal.style.display = 'flex';
    lockPageScroll();
}

function closeNotesListModal() {
    const modal = document.getElementById('notesListModal');
    if (modal) modal.style.display = 'none';
    unlockPageScroll();
}
window.openNotesListModal = openNotesListModal;
window.closeNotesListModal = closeNotesListModal;
window.changeNotesPage = changeNotesPage;

function openNoteViewModal(noteId) {
    const note = cachedNotes.find(function (n) { return n.id === noteId; });
    if (!note) return;
    const modal = document.getElementById('noteViewModal');
    const titleEl = document.getElementById('noteViewTitle');
    const metaEl = document.getElementById('noteViewMeta');
    const bodyEl = document.getElementById('noteViewBody');
    const dateEl = document.getElementById('noteViewDate');
    const editBtn = document.getElementById('noteViewEditBtn');
    if (!modal) return;

    if (titleEl) titleEl.textContent = note.title || 'Note';

    if (metaEl) {
        const bits = [];
        if (note.clientName) {
            bits.push('<span class="transaction-client"><span class="transaction-client-label">Client\u00A0: </span><span class="transaction-client-name">' + escapeHtml(note.clientName) + '</span></span>');
        }
        if (note.category) {
            bits.push('<span class="transaction-category"><span class="transaction-client-label">Catégorie\u00A0: </span><span class="transaction-client-name">' + escapeHtml(note.category) + '</span></span>');
        }
        metaEl.innerHTML = bits.join('');
        metaEl.hidden = bits.length === 0;
    }

    if (bodyEl) {
        const content = String(note.content || '').trim();
        bodyEl.textContent = content || 'Aucun contenu.';
        bodyEl.classList.toggle('note-view-body--empty', !content);
    }

    if (dateEl) {
        const iso = note.updatedAt || note.createdAt;
        const relative = formatNoteRelativeDate(iso);
        const full = formatNoteDate(iso);
        dateEl.textContent = relative || full || '';
        dateEl.title = full || '';
    }

    if (editBtn) editBtn.setAttribute('data-note-edit', note.id);

    modal.style.display = 'flex';
    lockPageScroll();
}

function closeNoteViewModal() {
    const modal = document.getElementById('noteViewModal');
    if (modal) modal.style.display = 'none';
    const listModal = document.getElementById('notesListModal');
    if (!listModal || listModal.style.display !== 'flex') {
        unlockPageScroll();
    }
}
window.openNoteViewModal = openNoteViewModal;
window.closeNoteViewModal = closeNoteViewModal;

function clearAllNotes() {
    if (cachedNotes.length === 0) {
        showNotification('La liste est déjà vide.', 'info');
        return;
    }
    showDeleteConfirm({
        title: 'Vider les notes',
        message: 'Êtes-vous sûr de vouloir supprimer toutes les notes ?',
        detail: 'Cette action est irréversible.',
        confirmLabel: 'Vider les notes',
        onConfirm: function () {
            const accountId = getCurrentAccountId();
            saveNotesList(accountId, { notes: [] }).then(function () {
                resetNoteForm();
                closeNoteViewModal();
                closeNotesListModal();
                showNotification('Notes vidées avec succès.', 'success');
            });
        }
    });
}

function submitNoteForm() {
    const titleEl = document.getElementById('noteTitle');
    const contentEl = document.getElementById('noteContent');
    const errorEl = document.getElementById('noteTitleError');
    const title = normalizeNoteTitle(titleEl ? titleEl.value : '');
    const content = normalizeNoteContent(contentEl ? contentEl.value : '');
    const clientSel = getInvoiceClientSelectionFromControl('noteClient');
    const category = getCategorySelectionFromControl('noteCategory');

    if (errorEl) errorEl.textContent = '';
    if (!title) {
        if (errorEl) errorEl.textContent = 'Le titre est obligatoire.';
        if (titleEl) titleEl.classList.add('error');
        return Promise.resolve(false);
    }
    if (titleEl) titleEl.classList.remove('error');

    const accountId = getCurrentAccountId();
    const now = new Date().toISOString();

    function buildNotePayload(base, client) {
        return Object.assign({}, base, {
            title: title,
            content: content,
            clientId: client && client.id ? client.id : null,
            clientName: client && client.name ? client.name : null,
            category: category || '',
            updatedAt: now,
        });
    }

    function persist(client) {
        const wasEdit = !!editingNoteId;
        let nextNotes;
        if (editingNoteId) {
            nextNotes = cachedNotes.map(function (n) {
                if (n.id !== editingNoteId) return n;
                return buildNotePayload({
                    id: n.id,
                    createdAt: n.createdAt || now,
                }, client);
            });
        } else {
            const newNote = buildNotePayload({
                id: generateNoteId(),
                createdAt: now,
            }, client);
            lastAddedNoteId = newNote.id;
            nextNotes = [newNote].concat(cachedNotes);
        }
        return saveNotesList(accountId, { notes: nextNotes }).then(function () {
            resetNoteForm();
            showNotification(
                wasEdit ? 'Note modifiée avec succès.' : 'Note ajoutée avec succès.',
                'success'
            );
            return true;
        });
    }

    const categoryPromise = category && typeof ensureCategorySaved === 'function'
        ? ensureCategorySaved(category)
        : Promise.resolve();

    return categoryPromise.then(function () {
        if (!clientSel.name) return persist(null);
        if (clientSel.id) {
            const existing = findClientById(clientSel.id) || { id: clientSel.id, name: clientSel.name };
            return persist(existing);
        }
        return ensureClientSaved(clientSel.name).then(function (client) {
            return persist(client);
        });
    });
}

function deleteNoteEntry(noteId) {
    showDeleteConfirm({
        title: 'Supprimer la note',
        message: 'Cette note sera définitivement supprimée.',
        detail: 'Cette action est irréversible.',
        confirmLabel: 'Supprimer',
        onConfirm: function () {
            const accountId = getCurrentAccountId();
            const next = cachedNotes.filter(function (n) { return n.id !== noteId; });
            saveNotesList(accountId, { notes: next }).then(function () {
                if (editingNoteId === noteId) resetNoteForm();
                closeNoteViewModal();
                showNotification('Note supprimée avec succès.', 'success');
            });
        }
    });
}

function bindNotesListeners() {
    if (notesListenersBound) return;
    notesListenersBound = true;

    const form = document.getElementById('noteForm');
    const cancelBtn = document.getElementById('noteFormCancel');
    const searchEl = document.getElementById('noteSearch');
    const listEl = document.getElementById('notesList');
    const viewAllBtn = document.getElementById('notesViewAllBtn');
    const clearAllBtn = document.getElementById('notesClearAllBtn');
    const modal = document.getElementById('notesListModal');
    const modalSearch = document.getElementById('notesModalSearch');
    const modalList = document.getElementById('notesModalList');
    const prevBtn = document.getElementById('notesPrevBtn');
    const nextBtn = document.getElementById('notesNextBtn');

    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            submitNoteForm();
        });
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            resetNoteForm();
        });
    }
    if (searchEl) {
        const runNotesSearch = function () {
            renderNotesList();
        };
        searchEl.addEventListener('input', runNotesSearch);
        searchEl.addEventListener('keyup', runNotesSearch);
        searchEl.addEventListener('search', runNotesSearch);
    }
    document.querySelectorAll('[data-notes-filter]').forEach(function (chip) {
        chip.addEventListener('click', function () {
            const mode = chip.getAttribute('data-notes-filter') || 'all';
            notesQuickFilter = mode;
            document.querySelectorAll('[data-notes-filter]').forEach(function (c) {
                c.classList.toggle('active', c === chip);
            });
            renderNotesList();
        });
    });
    if (viewAllBtn) {
        viewAllBtn.addEventListener('click', openNotesListModal);
    }
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', clearAllNotes);
    }
    if (modalSearch) {
        const runModalNotesSearch = function () {
            notesCurrentPage = 1;
            renderNotesModalList();
        };
        modalSearch.addEventListener('input', runModalNotesSearch);
        modalSearch.addEventListener('keyup', runModalNotesSearch);
        modalSearch.addEventListener('search', runModalNotesSearch);
    }
    if (prevBtn) {
        prevBtn.addEventListener('click', function () { changeNotesPage(-1); });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', function () { changeNotesPage(1); });
    }
    if (modal) {
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeNotesListModal();
        });
    }

    function onNotesListClick(e) {
        const editBtn = e.target.closest('[data-note-edit]');
        if (editBtn) {
            startEditNote(editBtn.getAttribute('data-note-edit'));
            return;
        }
        const delBtn = e.target.closest('[data-note-delete]');
        if (delBtn) {
            deleteNoteEntry(delBtn.getAttribute('data-note-delete'));
            return;
        }
        const card = e.target.closest('[data-note-open]');
        if (card) {
            openNoteViewModal(card.getAttribute('data-note-open'));
        }
    }
    if (listEl) listEl.addEventListener('click', onNotesListClick);
    if (modalList) modalList.addEventListener('click', onNotesListClick);

    const viewModal = document.getElementById('noteViewModal');
    const viewEditBtn = document.getElementById('noteViewEditBtn');
    const viewCloseBtn = document.getElementById('noteViewCloseBtn');
    if (viewEditBtn) {
        viewEditBtn.addEventListener('click', function () {
            const id = viewEditBtn.getAttribute('data-note-edit');
            if (id) startEditNote(id);
        });
    }
    if (viewCloseBtn) {
        viewCloseBtn.addEventListener('click', closeNoteViewModal);
    }
    if (viewModal) {
        viewModal.addEventListener('click', function (e) {
            if (e.target === viewModal) closeNoteViewModal();
        });
    }
}

function initNotesUI() {
    const accountId = getCurrentAccountId();
    const localData = loadNotesFromLocalStorage(accountId);
    cachedNotes = localData.notes.slice();
    bindNotesListeners();
    renderNotesList();
}

function bindCategorySettingsListeners() {
    if (categoriesListenersBound) return;
    categoriesListenersBound = true;
    const form = document.getElementById('categoryAddForm');
    const input = document.getElementById('categoryFormName');
    const descriptionInput = document.getElementById('categoryFormDescription');
    const errorEl = document.getElementById('categoryFormNameError');
    const viewBtn = document.getElementById('categoriesViewAllBtn');
    const listEl = document.getElementById('categoriesList');
    const modal = document.getElementById('categoriesListModal');
    const modalSearch = document.getElementById('categoriesModalSearch');
    const exportBtn = document.getElementById('categoriesExportExcelBtn');
    const prevBtn = document.getElementById('categoriesPrevBtn');
    const nextBtn = document.getElementById('categoriesNextBtn');
    const editModal = document.getElementById('categoryEditModal');
    const editForm = document.getElementById('categoryEditForm');
    const editNameEl = document.getElementById('categoryEditName');
    const editDescriptionEl = document.getElementById('categoryEditDescription');
    const editOriginalEl = document.getElementById('categoryEditOriginalName');
    const editErrorEl = document.getElementById('categoryEditNameError');

    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (errorEl) errorEl.textContent = '';
            const name = normalizeCategoryName(input ? input.value : '');
            if (!name) {
                if (errorEl) errorEl.textContent = 'Le nom de la catégorie est obligatoire.';
                if (input) input.classList.add('error');
                return;
            }
            addCategoryEntry(name, descriptionInput ? descriptionInput.value : '').then(function (ok) {
                if (!ok) return;
                if (input) {
                    input.value = '';
                    input.classList.remove('error', 'valid');
                }
                if (descriptionInput) descriptionInput.value = '';
            });
        });
    }

    if (input) {
        input.addEventListener('input', function () {
            if (errorEl) errorEl.textContent = '';
            input.classList.remove('error');
        });
    }

    if (viewBtn) viewBtn.addEventListener('click', openCategoriesListModal);
    if (modal) {
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeCategoriesListModal();
        });
    }
    if (modalSearch) {
        modalSearch.addEventListener('input', function () {
            categoriesCurrentPage = 1;
            renderCategoriesList();
        });
    }
    if (exportBtn) {
        exportBtn.addEventListener('click', exportCategoriesToExcel);
    }
    if (prevBtn) {
        prevBtn.addEventListener('click', function () { changeCategoriesPage(-1); });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', function () { changeCategoriesPage(1); });
    }
    if (editModal) {
        editModal.addEventListener('click', function (e) {
            if (e.target === editModal) closeCategoryEditModal();
        });
    }
    if (editNameEl) {
        editNameEl.addEventListener('input', function () {
            if (editErrorEl) editErrorEl.textContent = '';
            editNameEl.classList.remove('error');
        });
    }
    if (editForm) {
        editForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const oldName = editOriginalEl ? editOriginalEl.value : '';
            const newName = normalizeCategoryName(editNameEl ? editNameEl.value : '');
            if (!newName) {
                if (editErrorEl) editErrorEl.textContent = 'Le nom de la catégorie est obligatoire.';
                if (editNameEl) editNameEl.classList.add('error');
                return;
            }
            renameCategoryEntry(oldName, newName, editDescriptionEl ? editDescriptionEl.value : '').then(function (ok) {
                if (!ok && editNameEl) editNameEl.classList.add('error');
            });
        });
    }
    if (listEl) {
        listEl.addEventListener('click', function (e) {
            const txBtn = e.target.closest('[data-category-transactions]');
            if (txBtn) {
                viewCategoryTransactions(txBtn.getAttribute('data-category-transactions'));
                return;
            }
            const editBtn = e.target.closest('[data-category-edit]');
            if (editBtn) {
                closeCategoriesListModal();
                openCategoryEditModal(editBtn.getAttribute('data-category-edit'));
                return;
            }
            const btn = e.target.closest('[data-category-delete]');
            if (!btn) return;
            const name = btn.getAttribute('data-category-delete');
            showDeleteConfirm({
                title: 'Supprimer la catégorie',
                message: 'Supprimer « ' + name + ' » ?',
                detail: 'Les anciennes transactions garderont leur catégorie pour les statistiques.',
                onConfirm: function () {
                    deleteCategoryEntry(name);
                }
            });
        });
    }
}

function findClientByName(name) {
    const t = String(name || '').trim().toLowerCase();
    if (!t) return null;
    return cachedClients.find(function (c) { return c.name.toLowerCase() === t; }) || null;
}

function findClientById(id) {
    if (!id) return null;
    return cachedClients.find(function (c) { return c.id === id; }) || null;
}

function invoiceClientNameKey(name) {
    return String(name || '').trim().toLowerCase();
}

function resolveTransactionClientName(transaction) {
    if (!transaction) return '';
    if (transaction.invoiceClientId) {
        const linked = findClientById(transaction.invoiceClientId);
        if (linked) return linked.name;
    }
    const raw = transaction.invoiceClient && String(transaction.invoiceClient).trim();
    if (!raw) return '';
    const byName = findClientByName(raw);
    return byName ? byName.name : raw;
}

function transactionBelongsToClient(transaction, client) {
    if (!transaction || !client) return false;
    if (transaction.invoiceClientId && transaction.invoiceClientId === client.id) return true;
    return transactionMatchesClientKeys(transaction, clientNameKeysForClient(client));
}

function normalizeInvoiceClientFields(name, clientId) {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
        return { invoiceClient: null, invoiceClientId: null };
    }
    const linked = (clientId && findClientById(clientId)) || findClientByName(trimmed);
    return {
        invoiceClient: linked ? linked.name : trimmed,
        invoiceClientId: linked ? linked.id : null
    };
}

function clientNameKeysForClient(client) {
    const keys = new Set();
    if (!client) return keys;
    const currentKey = invoiceClientNameKey(client.name);
    if (currentKey) keys.add(currentKey);
    (client.aliases || []).forEach(function (alias) {
        const key = invoiceClientNameKey(alias);
        if (key) keys.add(key);
    });
    return keys;
}

function transactionInvoiceClientKey(transaction) {
    return invoiceClientNameKey(transaction && transaction.invoiceClient ? transaction.invoiceClient : '');
}

function transactionMatchesClientKeys(transaction, keys) {
    if (!transaction || !keys || keys.size === 0) return false;
    const rawKey = transactionInvoiceClientKey(transaction);
    return rawKey && keys.has(rawKey);
}

function collectTransactionClientLinkPatches() {
    const patches = [];
    if (!Array.isArray(transactions)) return patches;

    transactions.forEach(function (t) {
        if (!t.id) return;
        const raw = t.invoiceClient && String(t.invoiceClient).trim();

        if (t.invoiceClientId) {
            const linked = findClientById(t.invoiceClientId);
            if (linked && raw !== linked.name) {
                patches.push({
                    id: t.id,
                    patch: { invoiceClient: linked.name, invoiceClientId: linked.id }
                });
            }
            return;
        }

        if (!raw) return;
        let matchedClient = findClientByName(raw);
        if (!matchedClient) {
            matchedClient = cachedClients.find(function (client) {
                return transactionMatchesClientKeys(t, clientNameKeysForClient(client));
            }) || null;
        }
        if (matchedClient) {
            patches.push({
                id: t.id,
                patch: { invoiceClient: matchedClient.name, invoiceClientId: matchedClient.id }
            });
        }
    });
    return patches;
}

function hydrateTransactionClientLinks() {
    collectTransactionClientLinkPatches().forEach(function (item) {
        applyTransactionPatchLocal(item.id, item.patch);
    });
}

let transactionClientLinkSyncPromise = null;

function syncTransactionClientLinks() {
    const patches = collectTransactionClientLinkPatches();
    patches.forEach(function (item) {
        applyTransactionPatchLocal(item.id, item.patch);
    });
    if (patches.length === 0) {
        return Promise.resolve(0);
    }
    if (!useFirebase || !db) {
        persistTransactionsCache();
        return Promise.resolve(patches.length);
    }
    if (transactionClientLinkSyncPromise) {
        return transactionClientLinkSyncPromise;
    }
    transactionClientLinkSyncPromise = Promise.all(patches.map(function (item) {
        return patchTransactionOnFirestore(item.id, item.patch).then(function () { return true; }).catch(function (error) {
            console.error('Synchronisation lien client transaction', item.id, error);
            return false;
        });
    })).then(function () {
        transactionClientLinkSyncPromise = null;
        return patches.length;
    });
    return transactionClientLinkSyncPromise;
}

function syncTransactionsForClient(client) {
    if (!client || !client.id) return Promise.resolve(0);
    const keys = clientNameKeysForClient(client);
    transactions.forEach(function (t) {
        if (t.invoiceClientId === client.id && t.invoiceClient) {
            keys.add(transactionInvoiceClientKey(t));
        }
    });
    const patches = [];
    transactions.forEach(function (t) {
        if (!t.id) return;
        if (t.invoiceClientId === client.id) {
            if (t.invoiceClient !== client.name) {
                patches.push({
                    id: t.id,
                    patch: { invoiceClient: client.name, invoiceClientId: client.id }
                });
            }
            return;
        }
        if (transactionMatchesClientKeys(t, keys)) {
            patches.push({
                id: t.id,
                patch: { invoiceClient: client.name, invoiceClientId: client.id }
            });
        }
    });
    patches.forEach(function (item) {
        applyTransactionPatchLocal(item.id, item.patch);
    });
    if (patches.length === 0) return Promise.resolve(0);
    if (!useFirebase || !db) {
        persistTransactionsCache();
        return Promise.resolve(patches.length);
    }
    return Promise.all(patches.map(function (item) {
        return patchTransactionOnFirestore(item.id, item.patch).catch(function (error) {
            console.error('Synchronisation client sur transaction', item.id, error);
            return false;
        });
    })).then(function () { return patches.length; });
}

function linkTransactionsToClientId(clientId, oldName) {
    const oldKey = invoiceClientNameKey(oldName);
    if (!clientId || !oldKey) return;
    transactions.forEach(function (t, idx) {
        if (t.invoiceClientId === clientId) return;
        if (t.invoiceClient && invoiceClientNameKey(t.invoiceClient) === oldKey) {
            transactions[idx] = Object.assign({}, t, { invoiceClientId: clientId });
        }
    });
}

function applyTransactionPatchLocal(id, patch) {
    const idx = transactions.findIndex(function (x) { return String(x.id) === String(id); });
    if (idx !== -1) {
        transactions[idx] = Object.assign({}, transactions[idx], patch);
    }
}

function patchTransactionOnFirestore(id, patch) {
    if (!useFirebase || !db) return Promise.resolve();
    return db.collection('transactions').doc(String(id)).update(patch);
}

function persistTransactionsCache() {
    if (!useFirebase || !db) {
        localStorage.setItem('kaayprint_transactions', JSON.stringify(transactions));
        updateDisplay();
    }
}

function renameInvoiceClientOnTransactions(clientId, oldName, newName) {
    const newTrimmed = String(newName || '').trim();
    const oldKey = invoiceClientNameKey(oldName);
    if (!clientId || !newTrimmed) {
        return Promise.resolve(0);
    }

    const client = findClientById(clientId);
    const matchKeys = client ? clientNameKeysForClient(client) : new Set();
    if (oldKey) matchKeys.add(oldKey);

    hydrateTransactionClientLinks();

    const toUpdate = transactions.filter(function (t) {
        if (t.invoiceClientId === clientId) return true;
        return transactionMatchesClientKeys(t, matchKeys);
    });
    if (toUpdate.length === 0) {
        return Promise.resolve(0);
    }

    const patch = { invoiceClient: newTrimmed, invoiceClientId: clientId };

    return Promise.all(toUpdate.map(function (t) {
        return patchTransactionOnFirestore(t.id, patch).then(function () { return true; }).catch(function (error) {
            console.error('Erreur mise à jour transaction', t.id, error);
            return false;
        });
    })).then(function (results) {
        toUpdate.forEach(function (t) {
            applyTransactionPatchLocal(t.id, patch);
        });
        if (!useFirebase || !db) {
            persistTransactionsCache();
        } else {
            updateDisplay();
        }
        return syncTransactionClientLinks().then(function () {
            if (transactionClientFilter && invoiceClientNameKey(transactionClientFilter) === oldKey) {
                transactionClientFilter = newTrimmed;
                updateClientTransactionFilterBar();
            }
            const failed = results.filter(function (ok) { return !ok; }).length;
            if (failed > 0) {
                showNotification('Contact modifié, mais ' + failed + ' transaction(s) non synchronisée(s).', 'error');
            }
            updateDisplay();
            return toUpdate.length;
        });
    });
}

function ensureClientSaved(name, defaultProvenance) {
    const trimmed = String(name || '').trim().slice(0, 200);
    if (!trimmed) return Promise.resolve(null);
    const existing = findClientByName(trimmed);
    if (existing) return Promise.resolve(existing);
    const accountId = getCurrentAccountId();
    const prov = isValidClientProvenance(defaultProvenance) ? defaultProvenance : 'autre';
    const entry = {
        id: generateClientId(),
        name: trimmed,
        phone: '',
        note: '',
        provenance: prov,
        createdAt: new Date().toISOString()
    };
    const next = { clients: [entry].concat(cachedClients) };
    return saveClientsList(accountId, next).then(function () {
        return findClientByName(trimmed);
    });
}

function ensureClientSavedAndSyncTransactions(name, defaultProvenance) {
    return ensureClientSaved(name, defaultProvenance).then(function (client) {
        if (!client) return null;
        return syncTransactionsForClient(client).then(function () {
            return syncTransactionClientLinks().then(function () {
                updateDisplay();
                return client;
            });
        });
    });
}

function resolveInvoiceClientSelectionForTransaction(sel, defaultProvenance) {
    const name = sel && sel.name ? String(sel.name).trim() : '';
    if (!name) return Promise.resolve({ name: '', id: null });
    if (sel.id) return Promise.resolve({ name: name, id: sel.id });
    return ensureClientSaved(name, defaultProvenance).then(function (client) {
        if (!client) return { name: name, id: null };
        return { name: client.name, id: client.id };
    });
}

function wasNewInvoiceClientFromControl(selectId) {
    const sel = document.getElementById(selectId);
    return !!(sel && sel.tagName === 'SELECT' && sel.value === '__new__');
}

const CLIENT_PROFILE_REMINDER_KEY = 'kaayprint_client_profile_reminders';

function loadClientProfileReminderIds() {
    try {
        const raw = sessionStorage.getItem(CLIENT_PROFILE_REMINDER_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter(function (id) { return typeof id === 'string' && id; }) : [];
    } catch (e) {
        return [];
    }
}

function saveClientProfileReminderIds(ids) {
    sessionStorage.setItem(CLIENT_PROFILE_REMINDER_KEY, JSON.stringify(ids));
}

function isClientProfileIncomplete(client) {
    return !client || !client.provenance || client.provenance === 'autre';
}

function pruneClientProfileReminders() {
    const ids = loadClientProfileReminderIds();
    const valid = ids.filter(function (id) {
        const client = cachedClients.find(function (c) { return c.id === id; });
        return client && isClientProfileIncomplete(client);
    });
    if (valid.length !== ids.length) saveClientProfileReminderIds(valid);
}

function addClientProfileReminder(clientName) {
    const name = String(clientName || '').trim();
    if (!name) return;
    const client = findClientByName(name);
    if (!client || !client.id || !isClientProfileIncomplete(client)) return;
    const ids = loadClientProfileReminderIds();
    if (ids.indexOf(client.id) === -1) {
        ids.push(client.id);
        saveClientProfileReminderIds(ids);
    }
    refreshClientProfileReminderUI();
}

function removeClientProfileReminder(clientId) {
    const ids = loadClientProfileReminderIds().filter(function (id) { return id !== clientId; });
    saveClientProfileReminderIds(ids);
    refreshClientProfileReminderUI();
}

function updateClientProfileReminderBadge() {
    const badge = document.getElementById('clientProfileReminderBadge');
    if (!badge) return;
    pruneClientProfileReminders();
    const count = loadClientProfileReminderIds().length;
    if (count > 0) {
        badge.hidden = false;
        badge.removeAttribute('hidden');
        badge.setAttribute('aria-hidden', 'false');
        badge.textContent = count + ' contact' + (count > 1 ? 's' : '') + ' à compléter';
    } else {
        badge.hidden = true;
        badge.setAttribute('hidden', '');
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = '';
    }
}

function refreshClientProfileReminderUI() {
    updateClientProfileReminderBadge();
    const modal = document.getElementById('clientsListModal');
    if (modal && modal.style.display === 'flex') {
        renderClientsModalTable();
    }
}

function bindClientProfileReminderBadge() {
    const badge = document.getElementById('clientProfileReminderBadge');
    if (!badge || badge.dataset.bound) return;
    badge.dataset.bound = '1';
    badge.addEventListener('click', function () {
        openClientsListModal({ incompleteOnly: true });
    });
}

function isClientsModalIncompleteFilterActive() {
    return getClientsModalProvenanceFilter() === '__incomplete__';
}

function updateClientsListModalTitle() {
    const el = document.getElementById('clientsListModalTitle');
    if (!el) return;
    el.textContent = isClientsModalIncompleteFilterActive()
        ? 'Contacts à compléter'
        : 'Clients et prestataires';
}

function refreshClientSelectOptions() {
    CLIENT_SELECT_IDS.forEach(function (selectId) {
        const sel = document.getElementById(selectId);
        if (!sel || sel.tagName !== 'SELECT') return;
        const otherInput = document.getElementById(selectId + 'Other');
        const wasOther = sel.value === '__new__';
        const otherVal = otherInput ? otherInput.value : '';
        const prevName = wasOther ? otherVal : sel.value;

        while (sel.options.length > 0) sel.remove(0);
        const optNone = document.createElement('option');
        optNone.value = '';
        optNone.textContent = '— Aucun —';
        sel.appendChild(optNone);
        const optNew = document.createElement('option');
        optNew.value = '__new__';
        optNew.textContent = '+ Ajouter';
        sel.appendChild(optNew);
        cachedClients.forEach(function (c) {
            const opt = document.createElement('option');
            opt.value = c.name;
            opt.textContent = c.name;
            sel.appendChild(opt);
        });

        if (prevName && findClientByName(prevName)) {
            sel.value = findClientByName(prevName).name;
            if (otherInput) {
                otherInput.hidden = true;
                otherInput.value = '';
            }
        } else if (wasOther && prevName) {
            sel.value = '__new__';
            if (otherInput) {
                otherInput.hidden = false;
                otherInput.value = prevName;
            }
        } else {
            sel.value = '';
            if (otherInput) {
                otherInput.hidden = true;
                otherInput.value = '';
            }
        }
        enhanceSelectField(sel);
    });
}

function getInvoiceClientValueFromControl(selectId) {
    return getInvoiceClientSelectionFromControl(selectId).name;
}

function getInvoiceClientSelectionFromControl(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return { name: '', id: null };
    if (sel.tagName === 'SELECT') {
        if (sel.value === '__new__') {
            const other = document.getElementById(selectId + 'Other');
            const name = other ? String(other.value || '').trim() : '';
            return { name: name, id: null };
        }
        const name = String(sel.value || '').trim();
        const client = findClientByName(name);
        return { name: name, id: client ? client.id : null };
    }
    const name = String(sel.value || '').trim();
    return { name: name, id: null };
}

function setInvoiceClientControl(selectId, clientName) {
    const sel = document.getElementById(selectId);
    const other = document.getElementById(selectId + 'Other');
    if (!sel || sel.tagName !== 'SELECT') return;
    const name = String(clientName || '').trim();
    if (!name) {
        sel.value = '';
        if (other) {
            other.hidden = true;
            other.value = '';
        }
        syncEnhancedSelectLabel(sel);
        return;
    }
    if (findClientByName(name)) {
        sel.value = findClientByName(name).name;
        if (other) {
            other.hidden = true;
            other.value = '';
        }
    } else {
        sel.value = '__new__';
        if (other) {
            other.hidden = false;
            other.value = name;
        }
    }
    syncEnhancedSelectLabel(sel);
}

function resetClientSelectForm(selectId) {
    const sel = document.getElementById(selectId);
    const other = document.getElementById(selectId + 'Other');
    if (sel) {
        sel.value = '';
        syncEnhancedSelectLabel(sel);
    }
    if (other) {
        other.hidden = true;
        other.value = '';
    }
}

function bindClientSelectOtherToggle(selectId) {
    const sel = document.getElementById(selectId);
    const other = document.getElementById(selectId + 'Other');
    if (!sel || !other || sel.dataset.clientBound === '1') return;
    sel.dataset.clientBound = '1';
    sel.addEventListener('change', function () {
        if (sel.value === '__new__') {
            other.hidden = false;
            other.focus();
        } else {
            other.hidden = true;
            other.value = '';
        }
    });
}

function validateClientName(name, errorId) {
    const errEl = document.getElementById(errorId);
    const trimmed = String(name || '').trim();
    if (!trimmed) {
        if (errEl) errEl.textContent = 'Le nom est obligatoire.';
        return false;
    }
    if (trimmed.length < 2) {
        if (errEl) errEl.textContent = 'Le nom doit contenir au moins 2 caractères.';
        return false;
    }
    if (errEl) errEl.textContent = '';
    return true;
}

function validateClientProvenance(provenance, errorId) {
    const errEl = document.getElementById(errorId);
    if (!isValidClientProvenance(provenance)) {
        if (errEl) errEl.textContent = 'La provenance est obligatoire.';
        return false;
    }
    if (errEl) errEl.textContent = '';
    return true;
}

function buildClientPayload(name, phone, note, provenance) {
    return {
        name: String(name || '').trim().slice(0, 200),
        phone: String(phone || '').trim().slice(0, 40),
        note: String(note || '').trim().slice(0, 500),
        provenance: isValidClientProvenance(provenance) ? provenance : ''
    };
}

function getClientsModalProvenanceFilter() {
    const el = document.getElementById('clientsModalProvenanceFilter');
    return el ? String(el.value || '') : '';
}

function clientMatchesSearch(client, query) {
    if (!query) return true;
    const name = String(client.name || '').toLowerCase();
    const phone = String(client.phone || '').toLowerCase();
    const note = String(client.note || '').toLowerCase();
    return name.indexOf(query) >= 0 || phone.indexOf(query) >= 0 || note.indexOf(query) >= 0;
}

function normalizePhoneDigits(phone) {
    return String(phone || '').replace(/\D/g, '');
}

function getClientTelHref(phone) {
    let digits = normalizePhoneDigits(phone);
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0')) digits = '221' + digits.slice(1);
    else if (digits.length === 9) digits = '221' + digits;
    return 'tel:+' + digits;
}

function getClientWhatsAppHref(phone) {
    let digits = normalizePhoneDigits(phone);
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0')) digits = '221' + digits.slice(1);
    else if (digits.length === 9) digits = '221' + digits;
    return 'https://wa.me/' + digits;
}

function getClientOrderStats(clientName) {
    const client = findClientByName(clientName);
    const n = String(clientName || '').trim().toLowerCase();
    if (!n && !client) {
        return {
            incomeCount: 0,
            expenseCount: 0,
            totalOrdered: 0,
            totalExpensed: 0,
            totalRemaining: 0,
            totalExpenseRemaining: 0,
            txCount: 0
        };
    }
    let incomeCount = 0;
    let expenseCount = 0;
    let totalOrdered = 0;
    let totalExpensed = 0;
    let totalRemaining = 0;
    let totalExpenseRemaining = 0;
    let txCount = 0;
    transactions.forEach(function (t) {
        if (client) {
            if (!transactionBelongsToClient(t, client)) return;
        } else if (!n || !t.invoiceClient || String(t.invoiceClient).trim().toLowerCase() !== n) {
            return;
        }
        txCount++;
        const paid = parseFloat(t.amount) || 0;
        const rest = parseFloat(t.remainingAmount) || 0;
        if (t.type === 'income') {
            incomeCount++;
            totalOrdered += paid + rest;
            totalRemaining += rest;
        } else if (t.type === 'expense') {
            expenseCount++;
            totalExpensed += paid + rest;
            totalExpenseRemaining += rest;
        }
    });
    return {
        incomeCount: incomeCount,
        expenseCount: expenseCount,
        totalOrdered: totalOrdered,
        totalExpensed: totalExpensed,
        totalRemaining: totalRemaining,
        totalExpenseRemaining: totalExpenseRemaining,
        txCount: txCount
    };
}

function getContactRoleLabel(stats) {
    const hasIncome = stats.incomeCount > 0;
    const hasExpense = stats.expenseCount > 0;
    if (hasIncome && hasExpense) return 'Client et prestataire';
    if (hasExpense) return 'Prestataire';
    if (hasIncome) return 'Client';
    return '—';
}

function getContactActivityCountLabel(stats) {
    const hasIncome = stats.incomeCount > 0;
    const hasExpense = stats.expenseCount > 0;
    if (hasIncome && hasExpense) {
        return stats.incomeCount + '\u00A0entrant' + (stats.incomeCount !== 1 ? 's' : '') +
            ' · ' + stats.expenseCount + '\u00A0paiement' + (stats.expenseCount !== 1 ? 's' : '');
    }
    if (hasExpense) {
        return stats.expenseCount + '\u00A0paiement' + (stats.expenseCount !== 1 ? 's' : '');
    }
    if (hasIncome) {
        return stats.incomeCount + '\u00A0commande' + (stats.incomeCount !== 1 ? 's' : '');
    }
    if (stats.txCount > 0) {
        return stats.txCount + '\u00A0transaction' + (stats.txCount !== 1 ? 's' : '');
    }
    return '';
}

function buildClientOrderTotalHtml(stats) {
    const parts = [];
    const hasIncome = stats.incomeCount > 0;
    const hasExpense = stats.expenseCount > 0;
    if (hasIncome) {
        parts.push(
            '<div class="client-order-total">' +
            '<span class="client-order-total-label">' + (hasExpense ? 'Total entrant' : 'Total client') + '</span>' +
            '<span class="client-order-total-value">' + formatAmount(stats.totalOrdered) + '</span>' +
            (stats.totalRemaining > 0
                ? '<span class="client-order-remaining">Reste\u00A0' + formatAmount(stats.totalRemaining) + '</span>'
                : '') +
            '</div>'
        );
    }
    if (hasExpense) {
        parts.push(
            '<div class="client-order-total client-order-total-expense">' +
            '<span class="client-order-total-label">' + (hasIncome ? 'Total sortant' : 'Total payé') + '</span>' +
            '<span class="client-order-total-value client-order-total-value-expense">' + formatAmount(stats.totalExpensed) + '</span>' +
            (stats.totalExpenseRemaining > 0
                ? '<span class="client-order-remaining">Reste\u00A0' + formatAmount(stats.totalExpenseRemaining) + '</span>'
                : '') +
            '</div>'
        );
    }
    return parts.join('');
}

function countTransactionsForClient(clientName) {
    return getClientOrderStats(clientName).txCount;
}

function clientMatchesProvenanceFilter(client, filterValue) {
    if (!filterValue) return true;
    if (filterValue === '__incomplete__') {
        return loadClientProfileReminderIds().indexOf(client.id) !== -1;
    }
    if (filterValue === '__none__') return !client.provenance;
    return normalizeClientProvenance(client.provenance) === filterValue;
}

function getFilteredClientsForModal() {
    const query = getClientsModalSearchQuery();
    const provFilter = getClientsModalProvenanceFilter();
    return cachedClients.filter(function (client) {
        return clientMatchesSearch(client, query) && clientMatchesProvenanceFilter(client, provFilter);
    });
}

function initClientsModalProvenanceFilter() {
    const sel = document.getElementById('clientsModalProvenanceFilter');
    if (!sel) return;
    if (sel.dataset.populated !== '1') {
        sel.dataset.populated = '1';
        const optIncomplete = document.createElement('option');
        optIncomplete.value = '__incomplete__';
        optIncomplete.textContent = 'Contacts à compléter';
        sel.appendChild(optIncomplete);
        const optNone = document.createElement('option');
        optNone.value = '__none__';
        optNone.textContent = 'Sans provenance';
        sel.appendChild(optNone);
        CLIENT_PROVENANCE_OPTIONS.forEach(function (o) {
            const opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            sel.appendChild(opt);
        });
    }
    if (sel.dataset.bound !== '1') {
        sel.dataset.bound = '1';
        sel.addEventListener('change', function () {
            clientsCurrentPage = 1;
            updateClientsListModalTitle();
            renderClientsModalTable();
        });
    }
    enhanceSelectField(sel);
}

function getClientsModalSearchQuery() {
    const searchEl = document.getElementById('clientsModalSearch');
    return searchEl ? String(searchEl.value || '').trim().toLowerCase() : '';
}

function updateClientsPaginationInfo(totalPages, totalItems) {
    const pageInfo = document.getElementById('clientsPageInfo');
    const prevBtn = document.getElementById('clientsPrevBtn');
    const nextBtn = document.getElementById('clientsNextBtn');
    if (!pageInfo) return;
    const startItem = totalItems === 0 ? 0 : (clientsCurrentPage - 1) * clientsItemsPerPage + 1;
    const endItem = Math.min(clientsCurrentPage * clientsItemsPerPage, totalItems);
    pageInfo.textContent = totalItems === 0
        ? '0 contact'
        : startItem + '-' + endItem + ' sur ' + totalItems + ' (Page ' + clientsCurrentPage + '/' + totalPages + ')';
    if (prevBtn) prevBtn.disabled = clientsCurrentPage === 1;
    if (nextBtn) nextBtn.disabled = clientsCurrentPage >= totalPages;
}

function changeClientsPage(direction) {
    const filtered = getFilteredClientsForModal();
    const totalPages = Math.ceil(filtered.length / clientsItemsPerPage) || 1;
    clientsCurrentPage += direction;
    clientsCurrentPage = Math.max(1, Math.min(clientsCurrentPage, totalPages));
    renderClientsModalTable();
}
window.changeClientsPage = changeClientsPage;

function renderClientsModalTable() {
    const listEl = document.getElementById('clientsList');
    const emptyEl = document.getElementById('clientsModalEmpty');
    const noResultsEl = document.getElementById('clientsModalNoResults');
    const incompleteHintEl = document.getElementById('clientsModalIncompleteHint');
    const wrapEl = document.getElementById('clientsTableWrap');
    const toolbarEl = document.getElementById('clientsModalToolbar');
    const countEl = document.getElementById('clientsModalCount');
    const paginationEl = document.getElementById('clientsPagination');
    if (!listEl) return;

    listEl.innerHTML = '';
    const isEmpty = cachedClients.length === 0;
    const query = getClientsModalSearchQuery();
    const provFilter = getClientsModalProvenanceFilter();
    const incompleteMode = provFilter === '__incomplete__';
    const hasActiveFilter = !!query || !!provFilter;
    const filtered = getFilteredClientsForModal();
    const totalPages = Math.ceil(filtered.length / clientsItemsPerPage) || 1;
    clientsCurrentPage = Math.min(clientsCurrentPage, totalPages) || 1;
    const startIndex = (clientsCurrentPage - 1) * clientsItemsPerPage;
    const paginated = filtered.slice(startIndex, startIndex + clientsItemsPerPage);

    updateClientsListModalTitle();
    if (wrapEl) {
        wrapEl.classList.toggle('clients-list-incomplete-mode', incompleteMode && filtered.length > 0);
    }
    if (incompleteHintEl) {
        incompleteHintEl.hidden = !incompleteMode || isEmpty || filtered.length === 0;
    }

    if (emptyEl) emptyEl.hidden = !isEmpty;
    if (toolbarEl) toolbarEl.hidden = isEmpty;
    if (wrapEl) wrapEl.hidden = isEmpty || filtered.length === 0;
    if (noResultsEl) {
        noResultsEl.hidden = isEmpty || filtered.length > 0;
        if (!noResultsEl.hidden) {
            noResultsEl.textContent = incompleteMode
                ? 'Aucun contact à compléter.'
                : 'Aucun contact ne correspond à votre recherche.';
        }
    }

    if (countEl) {
        const total = cachedClients.length;
        if (!hasActiveFilter) {
            countEl.textContent = total + ' contact' + (total !== 1 ? 's' : '');
        } else {
            countEl.textContent = filtered.length + ' / ' + total + ' contact' + (total !== 1 ? 's' : '');
        }
    }

    if (paginationEl) {
        paginationEl.hidden = isEmpty || filtered.length <= clientsItemsPerPage;
        if (!paginationEl.hidden) {
            updateClientsPaginationInfo(totalPages, filtered.length);
        }
    }

    if (isEmpty || filtered.length === 0) return;

    paginated.forEach(function (client, index) {
        const metaParts = [];
        if (client.provenance) {
            metaParts.push('<span class="client-meta-part">' + escapeHtml(getClientProvenanceLabel(client.provenance)) + '</span>');
        }
        if (client.phone) {
            metaParts.push('<span class="client-meta-part">' + escapeHtml(client.phone) + '</span>');
        }
        const stats = getClientOrderStats(client.name);
        const activityLabel = getContactActivityCountLabel(stats);
        if (activityLabel) {
            metaParts.push('<span class="client-meta-part">' + activityLabel + '</span>');
        }
        const roleLabel = getContactRoleLabel(stats);
        if (roleLabel !== '—') {
            metaParts.push('<span class="client-meta-part client-meta-role">' + escapeHtml(roleLabel) + '</span>');
        }
        const metaHtml = metaParts.length
            ? '<div class="client-meta">' + metaParts.join('<span class="client-meta-sep">·</span>') + '</div>'
            : '';
        const noteHtml = client.note
            ? '<div class="client-note">' + escapeHtml(client.note) + '</div>'
            : '';
        const completeHintHtml = incompleteMode
            ? '<span class="client-item-complete-hint">Cliquer pour compléter le contact</span>'
            : '';
        const orderTotalHtml = buildClientOrderTotalHtml(stats);
        const clientLocked = isResourceEditLocked('client', client.id);
        const clientEditTitle = clientLocked && typeof window.xalissGetEditLockMessage === 'function'
            ? window.xalissGetEditLockMessage('client', client.id)
            : 'Modifier';

        const telHref = getClientTelHref(client.phone);
        const waHref = getClientWhatsAppHref(client.phone);
        const contactBtns = (telHref || waHref)
            ? (telHref
                ? '<a class="client-contact-btn client-call-btn" href="' + escapeHtml(telHref) + '" title="Appeler" aria-label="Appeler ' + escapeHtml(client.name) + '">' +
                '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></a>'
                : '') +
            (waHref
                ? '<a class="client-contact-btn client-wa-btn" href="' + escapeHtml(waHref) + '" target="_blank" rel="noopener noreferrer" title="WhatsApp" aria-label="WhatsApp ' + escapeHtml(client.name) + '">' +
                '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" fill="#25D366"/></svg></a>'
                : '')
            : '';

        const item = document.createElement('div');
        item.className = 'client-item' + (clientLocked ? ' is-edit-locked' : '');
        item.style.animationDelay = (index * 0.05) + 's';
        item.innerHTML =
            '<div class="client-item-main">' +
            '<div class="client-info">' +
            '<div class="client-name">' + escapeHtml(client.name) + '</div>' +
            metaHtml +
            noteHtml +
            completeHintHtml +
            '</div>' +
            orderTotalHtml +
            '</div>' +
            '<div class="transaction-actions client-item-actions">' +
            contactBtns +
            '<button type="button" class="invoice-btn" data-client-transactions="' + escapeHtml(client.id) + '" title="Voir les transactions" aria-label="Voir les transactions de ' + escapeHtml(client.name) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
            '<button type="button" class="edit-btn" data-client-edit="' + escapeHtml(client.id) + '" title="' + escapeHtml(clientEditTitle) + '" aria-label="Modifier ' + escapeHtml(client.name) + '"' + (clientLocked ? ' disabled aria-disabled="true"' : '') + '>' +
            '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
            '<button type="button" class="delete-btn" data-client-delete="' + escapeHtml(client.id) + '" title="Supprimer" aria-label="Supprimer ' + escapeHtml(client.name) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
            '</div>';
        listEl.appendChild(item);
    });

    setTimeout(function () {
        const items = listEl.querySelectorAll('.client-item');
        items.forEach(function (item, i) {
            setTimeout(function () {
                item.classList.add('visible');
            }, i * 50);
        });
    }, 10);

    if (typeof applyRolePermissionsUI === 'function') {
        applyRolePermissionsUI();
    }
}

function lockPageScroll() {
    if (document.body.classList.contains('kp-scroll-lock')) return;
    document.body.dataset.scrollLockY = String(window.scrollY);
    document.body.style.top = '-' + window.scrollY + 'px';
    document.body.classList.add('kp-scroll-lock');
}

function unlockPageScroll() {
    if (!document.body.classList.contains('kp-scroll-lock')) return;
    const y = parseInt(document.body.dataset.scrollLockY || '0', 10);
    document.body.classList.remove('kp-scroll-lock');
    document.body.style.top = '';
    delete document.body.dataset.scrollLockY;
    window.scrollTo(0, y);
}

let deleteConfirmCallback = null;
let deleteConfirmListenersBound = false;

const DELETE_CONFIRM_ICONS = {
    delete: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 17l5-5-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12H9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
};

function initDeleteConfirmModal() {
    const modal = document.getElementById('deleteConfirmModal');
    const cancelBtn = document.getElementById('deleteConfirmCancel');
    const okBtn = document.getElementById('deleteConfirmOk');
    if (!modal || deleteConfirmListenersBound) return;
    deleteConfirmListenersBound = true;

    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeDeleteConfirmModal);
    }
    if (okBtn) {
        okBtn.addEventListener('click', function () {
            const callback = deleteConfirmCallback;
            closeDeleteConfirmModal();
            if (typeof callback === 'function') callback();
        });
    }
    modal.addEventListener('click', function (e) {
        if (e.target === modal) closeDeleteConfirmModal();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (modal.style.display === 'flex' && !modal.hidden) {
            closeDeleteConfirmModal();
        }
    });
}

function showDeleteConfirm(options) {
    options = options || {};
    const modal = document.getElementById('deleteConfirmModal');
    const titleEl = document.getElementById('deleteConfirmTitle');
    const messageEl = document.getElementById('deleteConfirmMessage');
    const detailEl = document.getElementById('deleteConfirmDetail');
    const okBtn = document.getElementById('deleteConfirmOk');
    const okLabelEl = document.getElementById('deleteConfirmOkLabel');
    const iconEl = document.getElementById('deleteConfirmTitleIcon');
    if (!modal || !titleEl || !messageEl || !okBtn) return;

    titleEl.textContent = options.title || 'Confirmer la suppression';
    messageEl.textContent = options.message || 'Êtes-vous sûr de vouloir supprimer cet élément ?';
    if (iconEl) {
        const iconKey = options.icon === 'logout' ? 'logout' : 'delete';
        iconEl.innerHTML = DELETE_CONFIRM_ICONS[iconKey];
    }
    if (detailEl) {
        if (options.detail) {
            detailEl.textContent = options.detail;
            detailEl.hidden = false;
        } else {
            detailEl.textContent = '';
            detailEl.hidden = true;
        }
    }
    const confirmLabel = options.confirmLabel || 'Supprimer';
    if (okLabelEl) {
        okLabelEl.textContent = confirmLabel;
    } else {
        okBtn.textContent = confirmLabel;
    }
    deleteConfirmCallback = typeof options.onConfirm === 'function' ? options.onConfirm : null;

    if (!document.body.classList.contains('kp-scroll-lock')) {
        lockPageScroll();
        modal.dataset.lockedScroll = '1';
    }

    modal.hidden = false;
    modal.style.display = 'flex';
    const cancelBtn = document.getElementById('deleteConfirmCancel');
    if (cancelBtn) {
        cancelBtn.focus();
    }
}

function closeDeleteConfirmModal() {
    const modal = document.getElementById('deleteConfirmModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.hidden = true;
    deleteConfirmCallback = null;
    if (modal.dataset.lockedScroll === '1') {
        unlockPageScroll();
        delete modal.dataset.lockedScroll;
    }
}
window.closeDeleteConfirmModal = closeDeleteConfirmModal;

function openClientsListModal(options) {
    options = options || {};
    const modal = document.getElementById('clientsListModal');
    if (!modal) return;
    const searchEl = document.getElementById('clientsModalSearch');
    const provFilterEl = document.getElementById('clientsModalProvenanceFilter');
    clientsCurrentPage = 1;
    if (searchEl) searchEl.value = '';
    initClientsModalProvenanceFilter();
    if (provFilterEl) {
        provFilterEl.value = options.incompleteOnly ? '__incomplete__' : '';
        syncEnhancedSelectLabel(provFilterEl);
    }
    updateClientsListModalTitle();
    renderClientsModalTable();
    modal.style.display = 'flex';
    lockPageScroll();
}

function closeClientsListModal() {
    const modal = document.getElementById('clientsListModal');
    if (modal) modal.style.display = 'none';
    unlockPageScroll();
}
window.closeClientsListModal = closeClientsListModal;

function maybeRepairClientInvoiceAliases(clientId) {
    const client = findClientById(clientId);
    if (!client) return Promise.resolve(null);

    const orphanNames = [];
    transactions.forEach(function (t) {
        if (t.invoiceClientId || !t.invoiceClient) return;
        const raw = String(t.invoiceClient).trim();
        if (!raw || findClientByName(raw)) return;
        orphanNames.push(raw);
    });

    const uniqueOrphans = [];
    const seen = new Set();
    orphanNames.forEach(function (name) {
        const key = invoiceClientNameKey(name);
        if (!seen.has(key)) {
            seen.add(key);
            uniqueOrphans.push(name);
        }
    });
    if (uniqueOrphans.length !== 1) return Promise.resolve(client);

    const orphan = uniqueOrphans[0];
    const aliasKey = invoiceClientNameKey(orphan);
    const aliases = Array.isArray(client.aliases) ? client.aliases.slice() : [];
    if (aliases.some(function (a) { return invoiceClientNameKey(a) === aliasKey; })) {
        return Promise.resolve(client);
    }
    aliases.push(orphan);
    const accountId = getCurrentAccountId();
    const next = {
        clients: cachedClients.map(function (c) {
            if (c.id !== clientId) return c;
            return Object.assign({}, c, { aliases: aliases });
        })
    };
    return saveClientsList(accountId, next).then(function () {
        return findClientById(clientId);
    });
}

function repairAndSyncClientTransactions(clientId) {
    return maybeRepairClientInvoiceAliases(clientId).then(function (client) {
        const resolved = client || findClientById(clientId);
        if (!resolved) return 0;
        return syncTransactionsForClient(resolved).then(function (count) {
            updateDisplay();
            return count;
        });
    });
}

function openClientEditModal(clientId) {
    const client = cachedClients.find(function (c) { return c.id === clientId; });
    if (!client) return;
    editingClientId = clientId;
    repairAndSyncClientTransactions(clientId);
    const modal = document.getElementById('clientEditModal');
    const idEl = document.getElementById('clientEditId');
    const nameEl = document.getElementById('clientEditName');
    const phoneEl = document.getElementById('clientEditPhone');
    const noteEl = document.getElementById('clientEditNote');
    const provEl = document.getElementById('clientEditProvenance');
    const errEl = document.getElementById('clientEditNameError');
    const errProvEl = document.getElementById('clientEditProvenanceError');
    if (idEl) idEl.value = client.id;
    if (nameEl) nameEl.value = client.name;
    if (phoneEl) phoneEl.value = client.phone || '';
    if (noteEl) noteEl.value = client.note || '';
    fillClientProvenanceSelect(provEl, client.provenance || '');
    if (errEl) errEl.textContent = '';
    if (errProvEl) errProvEl.textContent = '';
    if (modal) modal.style.display = 'flex';
}

function closeClientEditModal() {
    editingClientId = null;
    const modal = document.getElementById('clientEditModal');
    const form = document.getElementById('clientEditForm');
    if (form) form.reset();
    initClientProvenanceSelects();
    const errEl = document.getElementById('clientEditNameError');
    const errProvEl = document.getElementById('clientEditProvenanceError');
    if (errEl) errEl.textContent = '';
    if (errProvEl) errProvEl.textContent = '';
    if (modal) modal.style.display = 'none';
}
window.closeClientEditModal = closeClientEditModal;

function updateClientTransactionFilterBar() {
    const bar = document.getElementById('clientTransactionFilterBar');
    const label = document.getElementById('clientTransactionFilterLabel');
    const totalEl = document.getElementById('clientTransactionFilterTotal');
    if (!bar) return;
    if (transactionClientFilter) {
        bar.hidden = false;
        if (label) label.textContent = transactionClientFilter;
        const stats = getClientOrderStats(transactionClientFilter);
        if (totalEl) {
            const totalParts = [];
            if (stats.totalOrdered > 0) {
                let incomeText = (stats.incomeCount > 0 && stats.expenseCount === 0 ? 'Total client' : 'Total entrant') +
                    ' : ' + formatAmount(stats.totalOrdered);
                if (stats.totalRemaining > 0) {
                    incomeText += ' · Reste ' + formatAmount(stats.totalRemaining);
                }
                totalParts.push(incomeText);
            }
            if (stats.totalExpensed > 0) {
                let expenseText = (stats.expenseCount > 0 && stats.incomeCount === 0 ? 'Total payé' : 'Total sortant') +
                    ' : ' + formatAmount(stats.totalExpensed);
                if (stats.totalExpenseRemaining > 0) {
                    expenseText += ' · Reste ' + formatAmount(stats.totalExpenseRemaining);
                }
                totalParts.push(expenseText);
            }
            if (totalParts.length > 0) {
                totalEl.hidden = false;
                totalEl.textContent = totalParts.join(' · ');
            } else {
                totalEl.hidden = true;
                totalEl.textContent = '';
            }
        }
    } else {
        bar.hidden = true;
        if (totalEl) {
            totalEl.hidden = true;
            totalEl.textContent = '';
        }
    }
}

function scrollToTransactionsSection() {
    const el = document.querySelector('.transactions-section');
    if (!el) return;
    setTimeout(function () {
        const top = el.getBoundingClientRect().top + window.scrollY - 20;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, 120);
}

function viewClientTransactions(clientId) {
    const client = cachedClients.find(function (c) { return c.id === clientId; });
    if (!client) return;
    closeClientsListModal();
    transactionClientFilter = client.name;
    currentPage = 1;
    sessionStorage.setItem('kaayprint_active_tab', 'transactions');
    applyActiveTab('transactions');
    updateClientTransactionFilterBar();
    displayTransactions(currentFilter);
    scrollToTransactionsSection();
    const count = countTransactionsForClient(client.name);
    if (count === 0) {
        showNotification('Aucune transaction trouvée pour « ' + client.name + ' »', 'info');
    }
}

function clearClientTransactionFilter() {
    transactionClientFilter = '';
    currentPage = 1;
    updateClientTransactionFilterBar();
    displayTransactions(currentFilter);
}
window.clearClientTransactionFilter = clearClientTransactionFilter;

function updateCategoryTransactionFilterBar() {
    const bar = document.getElementById('categoryTransactionFilterBar');
    const label = document.getElementById('categoryTransactionFilterLabel');
    const totalEl = document.getElementById('categoryTransactionFilterTotal');
    if (!bar) return;
    if (transactionCategoryFilter) {
        const stats = getCategoryOrderStats(transactionCategoryFilter);
        bar.hidden = false;
        if (label) label.textContent = transactionCategoryFilter;
        if (totalEl) {
            totalEl.hidden = false;
            totalEl.textContent = stats.count + ' commande' + (stats.count !== 1 ? 's' : '') +
                ' · Total commandes : ' + formatAmount(stats.totalOrdered) +
                (stats.totalRemaining > 0 ? ' · Reste ' + formatAmount(stats.totalRemaining) : '');
        }
    } else {
        bar.hidden = true;
        if (totalEl) {
            totalEl.hidden = true;
            totalEl.textContent = '';
        }
    }
}

function activateTransactionFilterButton(filter) {
    document.querySelectorAll('.filter-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
    });
}

function viewCategoryTransactions(name) {
    const normalized = normalizeCategoryName(name);
    if (!normalized) return;
    closeCategoriesListModal();
    transactionCategoryFilter = normalized;
    currentFilter = 'all';
    currentPage = 1;
    activateTransactionFilterButton('all');
    sessionStorage.setItem('kaayprint_active_tab', 'transactions');
    applyActiveTab('transactions');
    updateCategoryTransactionFilterBar();
    displayTransactions(currentFilter);
    scrollToTransactionsSection();
    const stats = getCategoryOrderStats(normalized);
    if (stats.count === 0) {
        showNotification('Aucune commande trouvée pour « ' + normalized + ' »', 'info');
    }
}

function clearCategoryTransactionFilter() {
    transactionCategoryFilter = '';
    currentPage = 1;
    updateCategoryTransactionFilterBar();
    displayTransactions(currentFilter);
}

window.clearCategoryTransactionFilter = clearCategoryTransactionFilter;

function exportCategoriesToExcel() {
    const categoriesToExport = getFilteredCategoriesForModal();
    if (categoriesToExport.length === 0) {
        showNotification('Aucune catégorie à exporter', 'error');
        return;
    }

    function excelCell(value) {
        return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    let htmlContent = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">' +
        '<head><meta charset="utf-8">' +
        '<style>table{border-collapse:collapse;width:100%;}th{background-color:#43277d;color:white;font-weight:bold;padding:10px;text-align:left;border:1px solid #341d5f;}td{padding:8px;border:1px solid #ddd;}tr:nth-child(even){background-color:#f9fafb;}</style>' +
        '</head><body><table><thead><tr>' +
        '<th>Catégorie</th><th>Description</th><th>Commandes</th><th>Total commandes (' + getCurrencyLabel() + ')</th><th>Total encaissé (' + getCurrencyLabel() + ')</th><th>Reste à payer (' + getCurrencyLabel() + ')</th>' +
        '</tr></thead><tbody>';

    categoriesToExport.forEach(function (name) {
        const category = getCategoryRecord(name);
        const stats = getCategoryOrderStats(name);
        htmlContent += '<tr>' +
            '<td>' + excelCell(name) + '</td>' +
            '<td>' + excelCell(category ? category.description : '') + '</td>' +
            '<td>' + stats.count + '</td>' +
            '<td>' + stats.totalOrdered + '</td>' +
            '<td>' + stats.totalPaid + '</td>' +
            '<td>' + stats.totalRemaining + '</td>' +
            '</tr>';
    });

    htmlContent += '</tbody></table></body></html>';

    const blob = new Blob([htmlContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute('href', url);
    link.setAttribute('download', 'kaayprint_categories_' + dateStr + '.xls');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
window.exportCategoriesToExcel = exportCategoriesToExcel;

function exportClientsToExcel() {
    const clientsToExport = getFilteredClientsForModal();
    if (clientsToExport.length === 0) {
        showNotification('Aucun contact à exporter', 'error');
        return;
    }

    function excelCell(value) {
        return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    let htmlContent = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">' +
        '<head><meta charset="utf-8">' +
        '<style>table{border-collapse:collapse;width:100%;}th{background-color:#43277d;color:white;font-weight:bold;padding:10px;text-align:left;border:1px solid #341d5f;}td{padding:8px;border:1px solid #ddd;}tr:nth-child(even){background-color:#f9fafb;}</style>' +
        '</head><body><table><thead><tr>' +
        '<th>Nom</th><th>Profil</th><th>Provenance</th><th>Numéro</th><th>Notes</th><th>Entrants</th><th>Total entrant (' + getCurrencyLabel() + ')</th><th>Reste à payer (' + getCurrencyLabel() + ')</th><th>Sortants</th><th>Total sortant (' + getCurrencyLabel() + ')</th><th>Reste sortant (' + getCurrencyLabel() + ')</th><th>Date d\'ajout</th>' +
        '</tr></thead><tbody>';

    clientsToExport.forEach(function (client) {
        const prov = client.provenance ? getClientProvenanceLabel(client.provenance) : '';
        const created = client.createdAt
            ? new Date(client.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '';
        const stats = getClientOrderStats(client.name);
        htmlContent += '<tr>' +
            '<td>' + excelCell(client.name) + '</td>' +
            '<td>' + excelCell(getContactRoleLabel(stats)) + '</td>' +
            '<td>' + excelCell(prov) + '</td>' +
            '<td>' + excelCell(client.phone) + '</td>' +
            '<td>' + excelCell(client.note) + '</td>' +
            '<td>' + stats.incomeCount + '</td>' +
            '<td>' + formatAmount(stats.totalOrdered) + '</td>' +
            '<td>' + formatAmount(stats.totalRemaining) + '</td>' +
            '<td>' + stats.expenseCount + '</td>' +
            '<td>' + formatAmount(stats.totalExpensed) + '</td>' +
            '<td>' + formatAmount(stats.totalExpenseRemaining) + '</td>' +
            '<td>' + excelCell(created) + '</td>' +
            '</tr>';
    });

    const exportDate = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    htmlContent += '</tbody><tfoot><tr style="background-color:#e5e7eb;font-weight:bold;">' +
        '<td colspan="12">Export du ' + excelCell(exportDate) + ' — ' + clientsToExport.length + ' contact(s)</td></tr></tfoot></table></body></html>';

    const blob = new Blob([htmlContent], { type: 'application/vnd.ms-excel' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', 'kaayprint_clients_' + dateStr + '.xls');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
window.exportClientsToExcel = exportClientsToExcel;

function resetClientAddForm() {
    const form = document.getElementById('clientAddForm');
    if (form) form.reset();
    initClientProvenanceSelects();
    const errEl = document.getElementById('clientFormNameError');
    const errProvEl = document.getElementById('clientFormProvenanceError');
    if (errEl) errEl.textContent = '';
    if (errProvEl) errProvEl.textContent = '';
}

function addClientFromSettings(name, phone, note, provenance) {
    const payload = buildClientPayload(name, phone, note, provenance);
    if (!validateClientName(payload.name, 'clientFormNameError')) {
        return Promise.resolve(false);
    }
    if (!validateClientProvenance(payload.provenance, 'clientFormProvenanceError')) {
        return Promise.resolve(false);
    }
    if (findClientByName(payload.name)) {
        showNotification('Ce nom existe déjà dans la liste.', 'error');
        return Promise.resolve(false);
    }
    const accountId = getCurrentAccountId();
    const entry = {
        id: generateClientId(),
        name: payload.name,
        phone: payload.phone,
        note: payload.note,
        provenance: payload.provenance,
        createdAt: new Date().toISOString()
    };
    const next = { clients: [entry].concat(cachedClients) };
    return saveClientsList(accountId, next).then(function () {
        clientsCurrentPage = 1;
        return true;
    });
}

function updateClientById(clientId, name, phone, note, provenance) {
    const payload = buildClientPayload(name, phone, note, provenance);
    if (!validateClientName(payload.name, 'clientEditNameError')) {
        return Promise.resolve(false);
    }
    if (!validateClientProvenance(payload.provenance, 'clientEditProvenanceError')) {
        return Promise.resolve(false);
    }
    const existing = cachedClients.find(function (c) { return c.id === clientId; });
    if (!existing) return Promise.resolve(false);
    const previousName = existing.name;
    const duplicate = cachedClients.find(function (c) {
        return c.id !== clientId && c.name.toLowerCase() === payload.name.toLowerCase();
    });
    if (duplicate) {
        showNotification('Un autre contact porte déjà ce nom.', 'error');
        return Promise.resolve(false);
    }
    const accountId = getCurrentAccountId();
    const aliases = Array.isArray(existing.aliases) ? existing.aliases.slice() : [];
    if (previousName !== payload.name && previousName) {
        const prevKey = invoiceClientNameKey(previousName);
        const hasAlias = aliases.some(function (alias) {
            return invoiceClientNameKey(alias) === prevKey;
        });
        if (!hasAlias) aliases.push(previousName);
    }
    const next = {
        clients: cachedClients.map(function (c) {
            if (c.id !== clientId) return c;
            return {
                id: c.id,
                name: payload.name,
                phone: payload.phone,
                note: payload.note,
                provenance: payload.provenance,
                createdAt: c.createdAt || new Date().toISOString(),
                aliases: aliases
            };
        })
    };
    return saveClientsList(accountId, next).then(function () {
        const updated = next.clients.find(function (c) { return c.id === clientId; });
        if (updated && !isClientProfileIncomplete(updated)) {
            removeClientProfileReminder(clientId);
        } else {
            refreshClientProfileReminderUI();
        }
        return maybeRepairClientInvoiceAliases(clientId).then(function () {
            hydrateTransactionClientLinks();
            if (previousName !== payload.name) {
                linkTransactionsToClientId(clientId, previousName);
            }
            updateDisplay();
            const healPromise = syncTransactionsForClient(findClientById(clientId));
            const renamePromise = previousName !== payload.name
                ? healPromise.then(function () {
                    return renameInvoiceClientOnTransactions(clientId, previousName, payload.name);
                })
                : healPromise.then(function () { return 0; });
            return renamePromise.then(function () {
                return true;
            });
        });
    });
}

function deleteClientById(clientId) {
    const accountId = getCurrentAccountId();
    const next = { clients: cachedClients.filter(function (c) { return c.id !== clientId; }) };
    return saveClientsList(accountId, next).then(function () {
        removeClientProfileReminder(clientId);
    });
}

function clearAllClients() {
    if (cachedClients.length === 0) {
        showNotification('La liste est déjà vide.', 'info');
        return;
    }
    showDeleteConfirm({
        title: 'Vider la liste',
        message: 'Êtes-vous sûr de vouloir vider toute la liste des clients et prestataires ?',
        detail: 'Cette action est irréversible.',
        confirmLabel: 'Vider la liste',
        onConfirm: function () {
            const accountId = getCurrentAccountId();
            saveClientsList(accountId, { clients: [] });
        }
    });
}

function maybeImportClientsFromTransactions() {
    if (clientsImportAttempted || cachedClients.length > 0) return;
    clientsImportAttempted = true;
    const names = new Set();
    transactions.forEach(function (t) {
        const n = t.invoiceClient && String(t.invoiceClient).trim();
        if (n) names.add(n);
    });
    if (names.size === 0) return;
    const clients = Array.from(names).sort(function (a, b) {
        return a.localeCompare(b, 'fr', { sensitivity: 'base' });
    }).map(function (name) {
        return { id: generateClientId(), name: name, phone: '', note: '', provenance: '', createdAt: new Date().toISOString() };
    });
    const accountId = getCurrentAccountId();
    saveClientsList(accountId, { clients: clients });
}

function initClientsUI() {
    const accountId = getCurrentAccountId();
    const addForm = document.getElementById('clientAddForm');
    const viewAllBtn = document.getElementById('clientsViewAllBtn');
    const clearAllBtn = document.getElementById('clientsClearAllBtn');
    const clientsList = document.getElementById('clientsList');
    const clientEditForm = document.getElementById('clientEditForm');
    const clientsListModal = document.getElementById('clientsListModal');
    const clientEditModal = document.getElementById('clientEditModal');

    const localData = loadClientsFromLocalStorage(accountId);
    cachedClients = localData.clients.slice();
    const localCategories = loadCategoriesFromLocalStorage(accountId);
    cachedProductCategoryRecords = localCategories.categories.slice();
    cachedProductCategories = cachedProductCategoryRecords.map(function (category) { return category.name; });
    initClientProvenanceSelects();
    initClientsModalProvenanceFilter();
    refreshClientSelectOptions();
    refreshCategorySelectOptions();
    renderClientsModalTable();
    renderCategoriesList();
    bindClientProfileReminderBadge();
    bindCategorySettingsListeners();
    updateClientProfileReminderBadge();
    hydrateTransactionClientLinks();

    CLIENT_SELECT_IDS.forEach(bindClientSelectOtherToggle);
    CATEGORY_SELECT_IDS.forEach(bindCategorySelectOtherToggle);

    if (unsubscribeClientList) {
        unsubscribeClientList();
        unsubscribeClientList = null;
    }

    if (useFirebase && db) {
        const docRef = db.collection('clientLists').doc(accountId);
        unsubscribeClientList = docRef.onSnapshot(function (snap) {
            if (snap.exists) {
                const data = normalizeClientListPayload(snap.data());
                persistClientsLocal(accountId, data);
            }
        }, function (error) {
            console.error('Liste clients Firestore:', error);
            cachedClients = loadClientsFromLocalStorage(accountId).clients;
            refreshClientSelectOptions();
            renderClientsModalTable();
            updateClientProfileReminderBadge();
        });
    }

    if (!clientsListenersBound) {
        clientsListenersBound = true;

        if (addForm) {
            addForm.addEventListener('submit', function (e) {
                e.preventDefault();
                const nameEl = document.getElementById('clientFormName');
                const phoneEl = document.getElementById('clientFormPhone');
                const noteEl = document.getElementById('clientFormNote');
                const provEl = document.getElementById('clientFormProvenance');
                addClientFromSettings(
                    nameEl ? nameEl.value : '',
                    phoneEl ? phoneEl.value : '',
                    noteEl ? noteEl.value : '',
                    provEl ? provEl.value : ''
                ).then(function (ok) {
                    if (ok) resetClientAddForm();
                });
            });
        }

        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', openClientsListModal);
        }

        const clientsModalSearch = document.getElementById('clientsModalSearch');
        if (clientsModalSearch) {
            clientsModalSearch.addEventListener('input', function () {
                clientsCurrentPage = 1;
                renderClientsModalTable();
            });
        }

        const clientsExportBtn = document.getElementById('clientsExportExcelBtn');
        if (clientsExportBtn) {
            clientsExportBtn.addEventListener('click', exportClientsToExcel);
        }

        const clientsPrevBtn = document.getElementById('clientsPrevBtn');
        const clientsNextBtn = document.getElementById('clientsNextBtn');
        if (clientsPrevBtn) {
            clientsPrevBtn.addEventListener('click', function () { changeClientsPage(-1); });
        }
        if (clientsNextBtn) {
            clientsNextBtn.addEventListener('click', function () { changeClientsPage(1); });
        }

        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', clearAllClients);
        }

        if (clientsList) {
            clientsList.addEventListener('click', function (e) {
                if (isClientsModalIncompleteFilterActive()) {
                    const mainEl = e.target.closest('.client-item-main');
                    if (mainEl && !e.target.closest('a') && !e.target.closest('button')) {
                        const item = mainEl.closest('.client-item');
                        const editBtn = item ? item.querySelector('[data-client-edit]') : null;
                        if (editBtn) {
                            openClientEditModal(editBtn.getAttribute('data-client-edit'));
                            return;
                        }
                    }
                }
                const txBtn = e.target.closest('[data-client-transactions]');
                const editBtn = e.target.closest('[data-client-edit]');
                const deleteBtn = e.target.closest('[data-client-delete]');
                if (txBtn) {
                    viewClientTransactions(txBtn.getAttribute('data-client-transactions'));
                    return;
                }
                if (editBtn) {
                    openClientEditModal(editBtn.getAttribute('data-client-edit'));
                    return;
                }
                if (deleteBtn) {
                    const clientId = deleteBtn.getAttribute('data-client-delete');
                    const client = cachedClients.find(function (c) { return c.id === clientId; });
                    const label = client ? client.name : 'ce contact';
                    showDeleteConfirm({
                        title: 'Supprimer le contact',
                        message: 'Supprimer « ' + label + ' » de la liste ?',
                        detail: 'Les transactions existantes ne sont pas modifiées.',
                        onConfirm: function () {
                            deleteClientById(clientId);
                        }
                    });
                }
            });
        }

        if (clientEditForm) {
            clientEditForm.addEventListener('submit', function (e) {
                e.preventDefault();
                if (!editingClientId) return;
                const nameEl = document.getElementById('clientEditName');
                const phoneEl = document.getElementById('clientEditPhone');
                const noteEl = document.getElementById('clientEditNote');
                const provEl = document.getElementById('clientEditProvenance');
                updateClientById(
                    editingClientId,
                    nameEl ? nameEl.value : '',
                    phoneEl ? phoneEl.value : '',
                    noteEl ? noteEl.value : '',
                    provEl ? provEl.value : ''
                ).then(function (ok) {
                    if (ok) closeClientEditModal();
                });
            });
        }

        if (clientsListModal) {
            clientsListModal.addEventListener('click', function (e) {
                if (e.target === clientsListModal) closeClientsListModal();
            });
        }

        if (clientEditModal) {
            clientEditModal.addEventListener('click', function (e) {
                if (e.target === clientEditModal) closeClientEditModal();
            });
        }
    }
}

/** CSS facture : identique écran / impression / export PNG (copié dans la fenêtre d’impression). */
function getInvoicePaperCssString() {
    return 'body{font-family:\'Segoe UI\',Tahoma,Geneva,Verdana,sans-serif;padding:24px;background:#f8f8f8;}' +
        '@media print{@page{margin:12mm;}body{padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}.invoice-paper{box-shadow:none !important;max-width:100%;}.invoice-header{background:linear-gradient(180deg,#fde8f0 0%,#faf0f5 45%,#f6f4fa 100%) !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}.invoice-num,.invoice-company-block,.invoice-client-row,.invoice-footer-text{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}}' +
        '.invoice-paper{width:420px;max-width:420px;min-width:420px;min-height:580px;box-sizing:border-box;font-size:14px;line-height:1.4;margin:0 auto;display:flex;flex-direction:column;background:#fff;border-radius:12px;padding:20px 28px 20px;box-shadow:0 4px 24px rgba(0,0,0,0.08),0 0 0 1px rgba(67,39,125,0.04);border:1px solid #e8e8e8;-webkit-print-color-adjust:exact;print-color-adjust:exact;-webkit-text-size-adjust:100%;text-size-adjust:100%;}' +
        '.invoice-logo{max-width:118px;height:auto;display:block;margin:0 auto 10px;}' +
        '.invoice-header{text-align:center;margin:-20px -28px 14px -28px;padding:18px 28px 14px;border-bottom:2px solid #43277d;border-radius:12px 12px 0 0;background:linear-gradient(180deg,rgba(231,32,96,0.08) 0%,rgba(231,32,96,0.04) 50%,rgba(67,39,125,0.03) 100%);-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}' +
        '.invoice-title{font-size:1.05em;font-weight:800;margin:0 0 8px;color:#43277d;letter-spacing:0.14em;}' +
        '.invoice-num{display:inline-block;font-size:0.76em;color:#5a4a7a;font-weight:600;letter-spacing:0.05em;padding:4px 12px;background:rgba(67,39,125,0.08);border-radius:20px;}' +
        '.invoice-company-block{margin:0 0 8px;padding:10px 14px;background:#fafafa;border-radius:8px;border:1px solid #eee;font-size:0.82em;color:#555;text-align:center;line-height:1.4;}' +
        '.invoice-company-name{font-weight:700;color:#43277d;margin:0 0 3px;font-size:0.95em;}' +
        '.invoice-company-line{margin:1px 0;font-size:0.96em;}' +
        '.invoice-client-row{margin:10px 0;padding:10px 12px;background:rgba(67,39,125,0.06);border-radius:8px;font-size:0.9em;color:#333;text-align:left;border-left:3px solid #43277d;}' +
        '.invoice-client-label{font-weight:600;color:#43277d;margin-right:6px;}' +
        'table{width:100%;border-collapse:collapse;}' +
        '.invoice-body{flex:1 1 auto;margin:14px 0 0;min-height:120px;}' +
        '.invoice-table tr{border-bottom:1px solid #f0f0f0;}' +
        '.invoice-table tbody tr:last-child{border-bottom:none;}' +
        '.invoice-table td{padding:9px 0;vertical-align:top;}' +
        '.invoice-table tbody tr:last-child td{padding-bottom:2px;}' +
        '.invoice-label{color:#777;width:36%;font-size:0.84em;font-weight:600;padding-right:10px;}' +
        '.invoice-value{color:#333;font-size:0.92em;text-align:right;}' +
        '.invoice-row-desc td{padding:8px 0 12px;}' +
        '.invoice-row-desc .invoice-value{font-size:0.84em;line-height:1.52;color:#3d3d3d;text-align:left;word-break:break-word;}' +
        '.invoice-row-amount td{padding-top:11px;padding-bottom:5px;border-top:2px solid rgba(67,39,125,0.12);border-bottom:none;}' +
        '.invoice-row-amount .invoice-amount{font-size:1.2em;font-weight:700;color:#43277d;text-align:right;letter-spacing:0.02em;}' +
        '.invoice-row-remaining td{padding-top:5px;padding-bottom:2px;}' +
        '.invoice-row-remaining .invoice-value{font-weight:600;color:#5a4a7a;font-size:0.9em;}' +
        '.invoice-footer{margin-top:auto;flex-shrink:0;padding:0;background:none;border-radius:0;}' +
        '.invoice-footer--split{display:flex;flex-direction:row;justify-content:flex-end;align-items:center;gap:12px;padding:10px 0 0;border-top:1px solid #eee;}' +
        '.invoice-footer-copy{text-align:left;flex:1 1 auto;min-width:0;}' +
        '.invoice-footer-arrow{flex-shrink:0;display:flex;align-items:center;line-height:0;opacity:1;}' +
        '.invoice-footer-arrow svg{display:block;}' +
        '.invoice-footer--solo{text-align:center;padding:10px 0 0;border-top:1px solid #eee;}' +
        '.invoice-qr-caption{margin:0 0 5px;font-size:0.82em;font-weight:700;color:#43277d;letter-spacing:0.03em;line-height:1.3;}' +
        '.invoice-footer-text{margin:0;color:#e72060;font-size:0.72em;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;line-height:1.35;}' +
        '.invoice-footer--solo .invoice-footer-text{text-transform:none;font-size:0.86em;font-weight:600;letter-spacing:0.04em;}' +
        '.invoice-footer-qr{flex-shrink:0;line-height:0;}' +
        '.invoice-qr-img{display:block;width:76px;height:76px;border-radius:8px;border:2px solid #eee;box-shadow:0 2px 8px rgba(67,39,125,0.12);}';
}

function getSyncErrorMessage(error) {
    const code = error && error.code ? String(error.code) : '';

    if (code.includes('permission-denied')) {
        return 'Acces Firebase refuse (regles Firestore). Mode local active.';
    }
    if (code.includes('failed-precondition')) {
        return 'Index Firestore manquant. Creez-le depuis le lien dans la console (F12).';
    }
    if (code.includes('unavailable')) {
        return 'Firebase indisponible temporairement. Mode local active.';
    }

    return 'Erreur de synchronisation. Mode local active.';
}

function switchToLocalMode(error = null) {
    if (error) {
        console.warn('Basculer vers le mode local suite a une erreur Firebase:', error);
    }

    if (unsubscribeFirestore) {
        unsubscribeFirestore();
        unsubscribeFirestore = null;
    }

    if (unsubscribeCompanyProfile) {
        unsubscribeCompanyProfile();
        unsubscribeCompanyProfile = null;
    }

    useFirebase = false;
    updateConnectionStatus(false);

    const accId = getCurrentAccountId();
    cachedCompanyProfile = loadCompanyProfileFromLocalStorage(accId);
    applyCompanyProfileToForm(cachedCompanyProfile);
}

// Charger les transactions depuis Firebase ou localStorage
function loadTransactions() {
    if (useFirebase && db) {
        // Utiliser Firebase Firestore
        if (unsubscribeFirestore) {
            unsubscribeFirestore(); // Désabonner l'ancien listener
        }
        
        unsubscribeFirestore = db.collection('transactions')
            .orderBy('date', 'desc')
            .onSnapshot((snapshot) => {
                transactions = [];
                snapshot.forEach((doc) => {
                    const data = doc.data();
                    transactions.push({
                        id: doc.id,
                        ...data
                    });
                });
                hydrateTransactionClientLinks();
                updateDisplay();
                updateConnectionStatus(true);
                syncTransactionClientLinks();
                maybeImportClientsFromTransactions();
                if (typeof checkScheduledAppNotifications === 'function') {
                    checkScheduledAppNotifications();
                }
            }, (error) => {
                console.error('Erreur Firestore:', error);
                switchToLocalMode(error);
                showNotification(getSyncErrorMessage(error), 'error');
                // Fallback vers localStorage
                loadFromLocalStorage();
            });
    } else {
        // Utiliser localStorage
        loadFromLocalStorage();
    }
}

// Charger depuis localStorage (fallback)
function loadFromLocalStorage() {
    const saved = localStorage.getItem('kaayprint_transactions');
    if (saved) {
        transactions = JSON.parse(saved);
    }
    hydrateTransactionClientLinks();
    updateDisplay();
    syncTransactionClientLinks();
    maybeImportClientsFromTransactions();
    if (typeof checkScheduledAppNotifications === 'function') {
        checkScheduledAppNotifications();
    }
}

// Sauvegarder les transactions dans Firebase ou localStorage
function saveTransactions() {
    if (useFirebase && db) {
        // Les données sont déjà synchronisées via le listener onSnapshot
        // On ne fait rien ici car Firestore met à jour automatiquement
        return;
    } else {
        // Sauvegarder dans localStorage
        localStorage.setItem('kaayprint_transactions', JSON.stringify(transactions));
        updateDisplay();
    }
}

// Calculer les totaux
function calculateTotals() {
    const totalIncome = transactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);
    
    const totalExpense = transactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);
    
    const balance = totalIncome - totalExpense;
    
    return { totalIncome, totalExpense, balance };
}

// Formater le montant selon la devise ISO de l'organisation (affichage seul).
function formatAmount(amount) {
    const code = getCurrencyCode();
    const value = Number(amount);
    const safe = Number.isFinite(value) ? value : 0;
    try {
        return new Intl.NumberFormat('fr-FR', {
            style: 'currency',
            currency: code,
            currencyDisplay: 'symbol',
        }).format(safe).replace(/\u202f/g, ' ').replace(/\u00a0/g, ' ');
    } catch (e) {
        return safe.toLocaleString('fr-FR') + ' ' + getCurrencyLabel();
    }
}

// Formater la date
function formatDate(dateString) {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

// Mettre à jour l'affichage
function updateDisplay() {
    const { totalIncome, totalExpense, balance } = calculateTotals();
    
    // Animation des valeurs qui changent
    const balanceEl = document.getElementById('balance');
    const incomeEl = document.getElementById('totalIncome');
    const expenseEl = document.getElementById('totalExpense');
    
    balanceEl.textContent = formatAmount(balance);
    incomeEl.textContent = formatAmount(totalIncome);
    expenseEl.textContent = formatAmount(totalExpense);
    
    // Ajouter l'animation pulse
    [balanceEl, incomeEl, expenseEl].forEach(el => {
        el.classList.add('updated');
        setTimeout(() => el.classList.remove('updated'), 500);
    });
    
    displayTransactions();
    updateBenefitDisplays();
    refreshAllCharts();
}

// Bénéfice pour un jour donné = encaissements réels ce jour-là (chaque paiement à sa date)
function getBenefitForDay(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr);
    const startOfDay = new Date(d);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(d);
    endOfDay.setHours(23, 59, 59, 999);
    let income = 0, expense = 0;
    transactions.forEach(t => {
        getPaymentEntries(t).forEach(entry => {
            const ed = new Date(entry.date);
            if (ed >= startOfDay && ed <= endOfDay) {
                if (t.type === 'income') income += entry.amount;
                else expense += entry.amount;
            }
        });
    });
    return income - expense;
}

// Bénéfice sur une période = encaissements réels entre from et to (chaque paiement à sa date)
function getBenefitForPeriod(fromStr, toStr) {
    if (!fromStr || !toStr) return 0;
    const from = new Date(fromStr);
    from.setHours(0, 0, 0, 0);
    const to = new Date(toStr);
    to.setHours(23, 59, 59, 999);
    let income = 0, expense = 0;
    transactions.forEach(t => {
        getPaymentEntries(t).forEach(entry => {
            const ed = new Date(entry.date);
            if (ed >= from && ed <= to) {
                if (t.type === 'income') income += entry.amount;
                else expense += entry.amount;
            }
        });
    });
    return income - expense;
}

// Mettre à jour l'affichage des bénéfices (carte Bénéfice + carte Filtrer les graphiques)
function updateBenefitDisplays() {
    const dayEl = document.getElementById('benefitDayValue');
    const dayDateInput = document.getElementById('benefitDayDate');
    const benefitModeDay = document.getElementById('benefitModeDay');
    const benefitCardPeriodFrom = document.getElementById('benefitCardPeriodFrom');
    const benefitCardPeriodTo = document.getElementById('benefitCardPeriodTo');
    if (dayEl) {
        let benefit = 0;
        if (benefitModeDay && benefitModeDay.checked && dayDateInput) {
            benefit = getBenefitForDay(dayDateInput.value);
        } else if (benefitCardPeriodFrom && benefitCardPeriodTo) {
            benefit = getBenefitForPeriod(benefitCardPeriodFrom.value, benefitCardPeriodTo.value);
        }
        dayEl.textContent = formatAmount(benefit);
        dayEl.classList.toggle('negative', benefit < 0);
    }
}

// Effacer le filtre de la carte Bénéfice (jour → aujourd'hui, période → vider Du/Au)
function clearBenefitCardFilter() {
    const benefitModeDay = document.getElementById('benefitModeDay');
    const benefitDayDate = document.getElementById('benefitDayDate');
    const benefitCardPeriodFrom = document.getElementById('benefitCardPeriodFrom');
    const benefitCardPeriodTo = document.getElementById('benefitCardPeriodTo');
    if (benefitModeDay && benefitModeDay.checked) {
        if (benefitDayDate) {
            const today = new Date();
            benefitDayDate.value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
        }
    } else {
        if (benefitCardPeriodFrom) benefitCardPeriodFrom.value = '';
        if (benefitCardPeriodTo) benefitCardPeriodTo.value = '';
    }
    updateBenefitDisplays();
}

// Mettre à jour le libellé de période sous "Filtrer les graphiques"
function updateChartsFilterPeriodLabel() {
    const el = document.getElementById('chartsFilterPeriodLabel');
    if (!el) return;
    const from = (document.getElementById('benefitPeriodFrom') || {}).value || '';
    const to = (document.getElementById('benefitPeriodTo') || {}).value || '';
    if (!from && !to) {
        el.textContent = 'Toutes les données';
        return;
    }
    const fromDate = from ? new Date(from).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const toDate = to ? new Date(to).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    el.textContent = 'Du ' + fromDate + ' au ' + toDate;
}

// Effacer les filtres "Du" et "Au" de la carte "Filtrer les graphiques" et rafraîchir les graphiques
function clearStatsFiltersPeriod() {
    const benefitPeriodFrom = document.getElementById('benefitPeriodFrom');
    const benefitPeriodTo = document.getElementById('benefitPeriodTo');
    if (benefitPeriodFrom) benefitPeriodFrom.value = '';
    if (benefitPeriodTo) benefitPeriodTo.value = '';
    updateChartsFilterPeriodLabel();
    updateBenefitDisplays();
    refreshAllCharts();
}

// Appliquer l'onglet actif (Transactions, Statistiques ou Paramètres)
function applyActiveTab(tabKey) {
    if (tabKey !== 'transactions' && tabKey !== 'statistiques' && tabKey !== 'notes' && tabKey !== 'parametres') return;
    document.body.classList.remove('app-tab-transactions', 'app-tab-statistiques', 'app-tab-notes', 'app-tab-parametres');
    document.body.classList.add('app-tab-' + tabKey);
    document.querySelectorAll('.main-tab').forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-tab') === tabKey);
    });
    document.querySelectorAll('.main-section').forEach(s => {
        s.classList.toggle('active', s.id === 'section-' + tabKey);
    });
    if (tabKey === 'parametres') {
        scheduleSyncCompanyWebsiteQrImgSize();
    }
    if (tabKey === 'statistiques') {
        updateChartsFilterPeriodLabel();
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                refreshAllCharts();
            });
        });
    }
}

function initAppSidebar() {
    const sidebar = document.getElementById('appSidebar');
    const toggle = document.getElementById('sidebarToggle');
    if (!sidebar || !toggle) return;

    if (localStorage.getItem('kaayprint_sidebar_collapsed') === '1') {
        sidebar.classList.add('app-sidebar--collapsed');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Agrandir le menu');
    }

    toggle.addEventListener('click', function () {
        const collapsed = sidebar.classList.toggle('app-sidebar--collapsed');
        localStorage.setItem('kaayprint_sidebar_collapsed', collapsed ? '1' : '0');
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        toggle.setAttribute('aria-label', collapsed ? 'Agrandir le menu' : 'Réduire le menu');
        setTimeout(function () {
            if (typeof refreshAllCharts === 'function') refreshAllCharts();
        }, 280);
    });
}

// --- Graphiques (Chart.js) ---
const MONTH_NAMES = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];
// Même rouge que "Total Sortants" (stat-card expense) — #ef4444
const CHART_COLOR_SORTANTS = '#ef4444';
const CHART_COLOR_SORTANTS_RGBA = 'rgba(239, 68, 68, 0.7)';
let chartIncomeVsExpense = null;

// Filtre des graphiques = Du/Au de la carte "Filtrer les graphiques" (benefitPeriodFrom, benefitPeriodTo)
function getTransactionsForCharts() {
    const periodFrom = (document.getElementById('benefitPeriodFrom') || {}).value || '';
    const periodTo = (document.getElementById('benefitPeriodTo') || {}).value || '';
    if (!periodFrom && !periodTo) return transactions;
    const from = periodFrom ? new Date(periodFrom) : null;
    if (from) from.setHours(0, 0, 0, 0);
    const to = periodTo ? new Date(periodTo) : null;
    if (to) to.setHours(23, 59, 59, 999);
    return transactions.filter(t => {
        return getPaymentEntries(t).some(entry => {
            const d = new Date(entry.date);
            if (from && d < from) return false;
            if (to && d > to) return false;
            return true;
        });
    });
}

// Données mensuelles : Entrants et Sortants par mois (chaque encaissement à sa date)
function getMonthlyIncomeExpenseData() {
    const list = getTransactionsForCharts();
    const periodFrom = (document.getElementById('benefitPeriodFrom') || {}).value || '';
    const periodTo = (document.getElementById('benefitPeriodTo') || {}).value || '';
    const from = periodFrom ? new Date(periodFrom) : null;
    if (from) from.setHours(0, 0, 0, 0);
    const to = periodTo ? new Date(periodTo) : null;
    if (to) to.setHours(23, 59, 59, 999);
    const byMonth = {};
    list.forEach(t => {
        getPaymentEntries(t).forEach(entry => {
            const d = new Date(entry.date);
            if (from && d < from) return;
            if (to && d > to) return;
            const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            if (!byMonth[key]) byMonth[key] = { income: 0, expense: 0, countIncome: 0, countExpense: 0 };
            if (t.type === 'income') {
                byMonth[key].income += entry.amount;
                byMonth[key].countIncome += 1;
            } else {
                byMonth[key].expense += entry.amount;
                byMonth[key].countExpense += 1;
            }
        });
    });
    const keys = Object.keys(byMonth).sort();
    const labels = keys.map(k => {
        const [y, m] = k.split('-');
        return MONTH_NAMES[parseInt(m, 10) - 1] + ' ' + y;
    });
    const income = keys.map(k => byMonth[k].income);
    const expense = keys.map(k => byMonth[k].expense);
    const countIncome = keys.map(k => byMonth[k].countIncome);
    const countExpense = keys.map(k => byMonth[k].countExpense);
    return { labels, income, expense, countIncome, countExpense };
}

// Mise à jour du graphique "Entrants vs Sortants par mois"
function updateChartIncomeVsExpense() {
    const canvasId = 'chartIncomeVsExpense';
    const emptyEl = document.getElementById('chartIncomeVsExpenseEmpty');
    const containerEl = document.getElementById('chartIncomeVsExpenseContainer');
    chartIncomeVsExpense = destroyChartInstance(chartIncomeVsExpense);
    rebuildChartCanvas(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    const { labels, income, expense, countIncome, countExpense } = getMonthlyIncomeExpenseData();
    if (labels.length === 0) {
        if (emptyEl) emptyEl.classList.add('visible');
        if (containerEl) containerEl.style.display = 'none';
        return;
    }
    if (emptyEl) emptyEl.classList.remove('visible');
    if (containerEl) containerEl.style.display = '';
    applyChartScrollWidth(containerEl, labels.length, 56);
    chartIncomeVsExpense = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'Entrants', data: income, countByMonth: countIncome, backgroundColor: 'rgba(16, 185, 129, 0.7)', borderColor: '#10b981', borderWidth: 1 },
                { label: 'Sortants', data: expense, countByMonth: countExpense, backgroundColor: CHART_COLOR_SORTANTS_RGBA, borderColor: CHART_COLOR_SORTANTS, borderWidth: 1 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: getChartLegendOptions('top'),
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const amount = context.raw;
                            const count = context.dataset.countByMonth ? context.dataset.countByMonth[context.dataIndex] : 0;
                            const isEntrant = context.datasetIndex === 0;
                            const typeLabel = isEntrant ? 'entrant' : 'sortant';
                            const countLabel = count === 1 ? '1 ' + typeLabel : count + ' ' + typeLabel + 's';
                            return [
                                'Somme : ' + formatAmount(amount),
                                'Nombre : ' + countLabel
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        autoSkip: false,
                        maxRotation: 45,
                        minRotation: 0
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return formatChartAxisTick(value);
                        }
                    }
                }
            }
        }
    });
}

// Données pour l'évolution du solde : solde cumulé par jour (chaque encaissement à sa date)
function getBalanceEvolutionData() {
    const list = getTransactionsForCharts();
    const periodFrom = (document.getElementById('benefitPeriodFrom') || {}).value || '';
    const periodTo = (document.getElementById('benefitPeriodTo') || {}).value || '';
    const from = periodFrom ? new Date(periodFrom) : null;
    if (from) from.setHours(0, 0, 0, 0);
    const to = periodTo ? new Date(periodTo) : null;
    if (to) to.setHours(23, 59, 59, 999);
    const byDay = {};
    list.forEach(t => {
        getPaymentEntries(t).forEach(entry => {
            const d = new Date(entry.date);
            if (from && d < from) return;
            if (to && d > to) return;
            const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            if (!byDay[key]) byDay[key] = { income: 0, expense: 0 };
            if (t.type === 'income') byDay[key].income += entry.amount;
            else byDay[key].expense += entry.amount;
        });
    });
    const keys = Object.keys(byDay).sort();
    const labels = keys.map(k => {
        const [y, m, day] = k.split('-');
        return day + ' ' + MONTH_NAMES[parseInt(m, 10) - 1] + ' ' + y;
    });
    let cumul = 0;
    const balance = keys.map(k => {
        const net = byDay[k].income - byDay[k].expense;
        cumul += net;
        return cumul;
    });
    return { labels, balance };
}

let chartBalanceEvolution = null;

function isCoarsePointerDevice() {
    return window.matchMedia('(hover: none), (pointer: coarse)').matches;
}

/** Clic / toucher sur un point → même infobulle qu’au survol (mobile). */
function handleChartPointTap(_evt, elements, chart) {
    if (!isCoarsePointerDevice()) return;
    if (elements.length) {
        chart.setActiveElements(elements);
        chart.tooltip.setActiveElements(elements);
    } else {
        chart.setActiveElements([]);
        chart.tooltip.setActiveElements([]);
    }
    chart.update('none');
}

// Mise à jour du graphique "Évolution de la recette"
function updateChartBalanceEvolution() {
    const canvasId = 'chartBalanceEvolution';
    const emptyEl = document.getElementById('chartBalanceEvolutionEmpty');
    const containerEl = document.getElementById('chartBalanceEvolutionContainer');
    chartBalanceEvolution = destroyChartInstance(chartBalanceEvolution);
    rebuildChartCanvas(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    const { labels, balance } = getBalanceEvolutionData();
    if (labels.length === 0) {
        if (emptyEl) emptyEl.classList.add('visible');
        if (containerEl) containerEl.style.display = 'none';
        return;
    }
    if (emptyEl) emptyEl.classList.remove('visible');
    if (containerEl) containerEl.style.display = '';
    applyChartScrollWidth(containerEl, labels.length, 52);
    const yBounds = getLineChartYBounds(balance);
    chartBalanceEvolution = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Recette (' + getCurrencyLabel() + ')',
                data: balance,
                borderColor: '#43277d',
                backgroundColor: 'rgba(67, 39, 125, 0.1)',
                borderWidth: 2,
                fill: {
                    target: 'origin',
                    above: 'rgba(67, 39, 125, 0.1)'
                },
                tension: 0.2,
                clip: true,
                pointRadius: 4,
                pointHoverRadius: 6,
                pointHitRadius: 14
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            onClick: handleChartPointTap,
            plugins: {
                legend: getChartLegendOptions('top'),
                tooltip: {
                    enabled: true,
                    mode: 'nearest',
                    intersect: false,
                    callbacks: {
                        label: function (context) {
                            var v = context.parsed.y;
                            return context.dataset.label + ': ' + formatAmount(v);
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        autoSkip: false,
                        maxRotation: 45,
                        minRotation: 0
                    }
                },
                y: {
                    type: 'linear',
                    min: yBounds.min,
                    max: yBounds.max,
                    beginAtZero: yBounds.beginAtZero,
                    grace: 0,
                    bounds: 'ticks',
                    ticks: {
                        callback: function(value) {
                            if (yBounds.beginAtZero && value < 0) return '';
                            return formatChartAxisTick(value);
                        }
                    }
                }
            }
        }
    });
}

// Données bénéfice par mois (chaque encaissement à sa date)
function getBenefitByMonthData() {
    const list = getTransactionsForCharts();
    const periodFrom = (document.getElementById('benefitPeriodFrom') || {}).value || '';
    const periodTo = (document.getElementById('benefitPeriodTo') || {}).value || '';
    const from = periodFrom ? new Date(periodFrom) : null;
    if (from) from.setHours(0, 0, 0, 0);
    const to = periodTo ? new Date(periodTo) : null;
    if (to) to.setHours(23, 59, 59, 999);
    const byMonth = {};
    list.forEach(t => {
        getPaymentEntries(t).forEach(entry => {
            const d = new Date(entry.date);
            if (from && d < from) return;
            if (to && d > to) return;
            const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            if (!byMonth[key]) byMonth[key] = { income: 0, expense: 0 };
            if (t.type === 'income') byMonth[key].income += entry.amount;
            else byMonth[key].expense += entry.amount;
        });
    });
    const keys = Object.keys(byMonth).sort();
    const labels = keys.map(k => {
        const [y, m] = k.split('-');
        return MONTH_NAMES[parseInt(m, 10) - 1] + ' ' + y;
    });
    const benefits = keys.map(k => byMonth[k].income - byMonth[k].expense);
    return { labels, benefits };
}

let chartBenefitByMonth = null;

// Mise à jour du graphique "Bénéfice par mois"
function updateChartBenefitByMonth() {
    const canvasId = 'chartBenefitByMonth';
    const emptyEl = document.getElementById('chartBenefitByMonthEmpty');
    const containerEl = document.getElementById('chartBenefitByMonthContainer');
    chartBenefitByMonth = destroyChartInstance(chartBenefitByMonth);
    rebuildChartCanvas(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    const { labels, benefits } = getBenefitByMonthData();
    if (labels.length === 0) {
        if (emptyEl) emptyEl.classList.add('visible');
        if (containerEl) containerEl.style.display = 'none';
        return;
    }
    if (emptyEl) emptyEl.classList.remove('visible');
    if (containerEl) containerEl.style.display = '';
    const colors = benefits.map(b => b >= 0 ? 'rgba(16, 185, 129, 0.7)' : CHART_COLOR_SORTANTS_RGBA);
    const borderColors = benefits.map(b => b >= 0 ? '#10b981' : CHART_COLOR_SORTANTS);
    const yBounds = getLineChartYBounds(benefits);
    applyChartScrollWidth(containerEl, labels.length, 56);
    chartBenefitByMonth = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Bénéfice (' + getCurrencyLabel() + ')',
                data: benefits,
                backgroundColor: colors,
                borderColor: borderColors,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: getChartLegendOptions('top')
            },
            scales: {
                x: {
                    ticks: {
                        autoSkip: false,
                        maxRotation: 45,
                        minRotation: 0
                    }
                },
                y: {
                    type: 'linear',
                    min: yBounds.min,
                    max: yBounds.max,
                    beginAtZero: yBounds.beginAtZero,
                    grace: 0,
                    bounds: 'ticks',
                    ticks: {
                        callback: function(value) {
                            if (yBounds.beginAtZero && value < 0) return '';
                            return formatChartAxisTick(value);
                        }
                    }
                }
            }
        }
    });
}

// Top 5 : les 5 plus grosses transactions (sortants ou entrants)
function truncateLabel(str, maxLen) {
    if (!str) return '';
    return str.length <= maxLen ? str : str.slice(0, maxLen) + '…';
}

function getTop5ExpensesData() {
    const list = getTransactionsForCharts()
        .filter(t => t.type === 'expense')
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);
    return {
        labels: list.map(t => truncateLabel(t.description, 35)),
        values: list.map(t => t.amount),
        fullDescriptions: list.map(t => t.description || '')
    };
}

function getTop5IncomeData() {
    const list = getTransactionsForCharts()
        .filter(t => t.type === 'income')
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5);
    return {
        labels: list.map(t => truncateLabel(t.description, 35)),
        values: list.map(t => t.amount),
        fullDescriptions: list.map(t => t.description || '')
    };
}

function getIncomeByCategoryData() {
    const byCategory = {};
    getTransactionsForCharts()
        .filter(function (t) { return t.type === 'income'; })
        .forEach(function (t) {
            const category = getTransactionCategory(t) || 'Non catégorisé';
            if (!byCategory[category]) byCategory[category] = 0;
            getPaymentEntries(t).forEach(function (entry) {
                byCategory[category] += Number(entry.amount) || 0;
            });
        });
    const rows = Object.keys(byCategory)
        .map(function (label) { return { label: label, value: byCategory[label] }; })
        .filter(function (row) { return row.value > 0; })
        .sort(function (a, b) { return b.value - a.value; });
    return {
        labels: rows.map(function (row) { return row.label; }),
        values: rows.map(function (row) { return row.value; })
    };
}

let chartTop5Expenses = null;
let chartTop5Income = null;
let chartIncomeByCategory = null;

function destroyChartInstance(chart) {
    if (chart) {
        try {
            chart.destroy();
        } catch (e) { /* canvas déjà détruit */ }
    }
    return null;
}

/** Remplace le canvas pour effacer légendes, axes et pixels résiduels de Chart.js */
function rebuildChartCanvas(canvasId) {
    const old = document.getElementById(canvasId);
    if (!old || !old.parentNode) return null;
    const next = document.createElement('canvas');
    next.id = canvasId;
    old.parentNode.replaceChild(next, old);
    return next;
}

/** Largeur visible du cadre graphique (pour activer le scroll si besoin). */
function getChartScrollViewportWidth(containerEl) {
    var wrap = containerEl && containerEl.parentElement;
    if (wrap && wrap.clientWidth > 0) return wrap.clientWidth;
    var card = wrap && wrap.closest ? wrap.closest('.chart-card') : null;
    if (card && card.clientWidth > 0) return Math.max(280, card.clientWidth - 48);
    return Math.max(400, Math.min(960, (window.innerWidth || 800) - 80));
}

/** Indication discrète quand le graphique déborde (scroll horizontal). */
function updateChartScrollHint(containerEl, isScrollable) {
    if (!containerEl) return;
    var wrap = containerEl.parentElement;
    if (!wrap || !wrap.classList.contains('chart-scroll')) return;
    var hint = wrap.querySelector('.chart-scroll-hint');
    if (!hint) {
        hint = document.createElement('p');
        hint.className = 'chart-scroll-hint';
        hint.setAttribute('aria-hidden', 'true');
        hint.textContent = 'Glissez pour voir →';
        wrap.appendChild(hint);
        hint.addEventListener('click', function () {
            var maxScroll = wrap.scrollWidth - wrap.clientWidth;
            wrap.scrollBy({ left: Math.min(140, maxScroll), behavior: 'smooth' });
        });
    }
    if (isScrollable) {
        hint.removeAttribute('hidden');
        if (!wrap.dataset.scrollHintBound) {
            wrap.dataset.scrollHintBound = '1';
            wrap.addEventListener('scroll', function () {
                if (wrap.scrollLeft > 10) {
                    hint.setAttribute('hidden', '');
                }
            }, { passive: true });
        }
    } else {
        hint.setAttribute('hidden', '');
    }
}

/** Largeur min. du conteneur → scroll horizontal si les données dépassent le cadre. */
function applyChartScrollWidth(containerEl, labelCount, pxPerLabel) {
    if (!containerEl) return;
    if (!labelCount || labelCount <= 0) {
        containerEl.style.minWidth = '';
        containerEl.style.width = '';
        updateChartScrollHint(containerEl, false);
        return;
    }
    var viewportW = getChartScrollViewportWidth(containerEl);
    var contentW = labelCount * pxPerLabel;
    var scrollable = contentW > viewportW;
    if (scrollable) {
        containerEl.style.minWidth = contentW + 'px';
        containerEl.style.width = contentW + 'px';
    } else {
        containerEl.style.minWidth = '';
        containerEl.style.width = '';
    }
    updateChartScrollHint(containerEl, scrollable);
}

/** Top 5 : scroll horizontal = zone libellés + zone barres (libellés non coupés). */
function applyTop5ChartScrollWidth(containerEl, labels) {
    if (!containerEl) return;
    if (!labels.length) {
        containerEl.style.minWidth = '';
        containerEl.style.width = '';
        updateChartScrollHint(containerEl, false);
        return;
    }
    var maxLen = labels.reduce(function (m, l) {
        return Math.max(m, String(l || '').length);
    }, 0);
    var viewportW = getChartScrollViewportWidth(containerEl);
    var labelArea = Math.round(maxLen * 6) + 20;
    var barArea = 280;
    var contentW = labelArea + barArea;
    var scrollable = contentW > viewportW;
    if (scrollable) {
        containerEl.style.minWidth = contentW + 'px';
        containerEl.style.width = contentW + 'px';
    } else {
        containerEl.style.minWidth = '';
        containerEl.style.width = '';
    }
    updateChartScrollHint(containerEl, scrollable);
}

function getTop5YScaleOptions(labels) {
    return {
        ticks: {
            autoSkip: false,
            mirror: false,
            align: 'end',
            crossAlign: 'far',
            padding: 4,
            font: { size: 11 },
            callback: function (_value, index) {
                return labels[index] != null ? labels[index] : '';
            }
        },
        afterFit: function (axis) {
            var maxLen = labels.reduce(function (m, l) {
                return Math.max(m, String(l || '').length);
            }, 0);
            axis.width = Math.max(axis.width, Math.round(maxLen * 6) + 12);
        }
    };
}

function getTop5BarChartOptions(labels, fullDescriptions) {
    return {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: {
            padding: { left: 2, right: 8, top: 4, bottom: 4 }
        },
        datasets: {
            bar: {
                categoryPercentage: 0.68,
                barPercentage: 0.82,
                maxBarThickness: 26
            }
        },
        plugins: {
            legend: { display: false },
            tooltip: {
                callbacks: {
                    title: function (ctx) {
                        var full = ctx[0].dataset.fullDescriptions;
                        return full && full[ctx[0].dataIndex] ? full[ctx[0].dataIndex] : ctx[0].label;
                    },
                    label: function (ctx) {
                        return formatAmount(ctx.raw);
                    }
                }
            }
        },
        scales: {
            y: getTop5YScaleOptions(labels),
            x: {
                beginAtZero: true,
                ticks: {
                    callback: function (v) {
                        return formatChartAxisTick(v);
                    }
                }
            }
        }
    };
}

function getChartLegendOptions(position) {
    return {
        position: position || 'top',
        labels: {
            boxWidth: 12,
            padding: 14,
            font: { size: 12 }
        }
    };
}

/** Axe Y : minimum à 0 sauf s’il existe une valeur négative dans les données. */
function getLineChartYBounds(values) {
    if (!values || !values.length) {
        return { min: 0, max: 100, beginAtZero: true };
    }
    const min = Math.min.apply(null, values);
    const max = Math.max.apply(null, values);
    const hasNegative = min < 0;
    const yMin = hasNegative ? min - Math.max(Math.abs(min) * 0.06, 500) : 0;
    let yMax = max + Math.max((max - yMin) * 0.06, hasNegative ? 500 : 0);
    if (yMax <= yMin) {
        yMax = yMin + (Math.abs(yMin) * 0.1 || 1000);
    }
    return {
        min: Math.round(yMin),
        max: Math.round(yMax),
        beginAtZero: !hasNegative
    };
}

/** Libellé d’axe Y propre (évite 134.06032000000002k). */
function formatChartAxisTick(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    const abs = Math.abs(n);
    if (abs >= 1000) {
        const k = n / 1000;
        const rounded = Math.abs(k) >= 100 ? Math.round(k) : Math.round(k * 10) / 10;
        return String(rounded).replace(/\.0$/, '') + 'k';
    }
    return String(Math.round(n));
}

function isStatsSectionVisible() {
    const section = document.getElementById('section-statistiques');
    return !!(section && section.classList.contains('active'));
}

function invalidateAllCharts() {
    chartIncomeVsExpense = destroyChartInstance(chartIncomeVsExpense);
    chartBalanceEvolution = destroyChartInstance(chartBalanceEvolution);
    chartBenefitByMonth = destroyChartInstance(chartBenefitByMonth);
    chartTop5Expenses = destroyChartInstance(chartTop5Expenses);
    chartTop5Income = destroyChartInstance(chartTop5Income);
    chartIncomeByCategory = destroyChartInstance(chartIncomeByCategory);
    [
        'chartIncomeVsExpense',
        'chartBalanceEvolution',
        'chartBenefitByMonth',
        'chartTop5Expenses',
        'chartTop5Income',
        'chartIncomeByCategory'
    ].forEach(rebuildChartCanvas);
}

function refreshAllCharts() {
    updateChartsFilterPeriodLabel();
    if (!isStatsSectionVisible()) {
        invalidateAllCharts();
        return;
    }
    updateChartIncomeVsExpense();
    updateChartBalanceEvolution();
    updateChartTop5Expenses();
    updateChartTop5Income();
    updateChartIncomeByCategory();
    updateChartBenefitByMonth();
}

function updateChartTop5Expenses() {
    const canvasId = 'chartTop5Expenses';
    const emptyEl = document.getElementById('chartTop5ExpensesEmpty');
    const containerEl = document.getElementById('chartTop5ExpensesContainer');
    chartTop5Expenses = destroyChartInstance(chartTop5Expenses);
    rebuildChartCanvas(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    const { labels, values, fullDescriptions } = getTop5ExpensesData();
    if (labels.length === 0) {
        if (emptyEl) emptyEl.classList.add('visible');
        if (containerEl) containerEl.style.display = 'none';
        return;
    }
    if (emptyEl) emptyEl.classList.remove('visible');
    if (containerEl) containerEl.style.display = '';
    applyTop5ChartScrollWidth(containerEl, labels);
    chartTop5Expenses = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels.slice(),
            datasets: [{
                label: 'Montant (' + getCurrencyLabel() + ')',
                data: values.slice(),
                fullDescriptions: fullDescriptions.slice(),
                backgroundColor: CHART_COLOR_SORTANTS_RGBA,
                borderColor: CHART_COLOR_SORTANTS,
                borderWidth: 1
            }]
        },
        options: getTop5BarChartOptions(labels, fullDescriptions)
    });
}

function updateChartTop5Income() {
    const canvasId = 'chartTop5Income';
    const emptyEl = document.getElementById('chartTop5IncomeEmpty');
    const containerEl = document.getElementById('chartTop5IncomeContainer');
    chartTop5Income = destroyChartInstance(chartTop5Income);
    rebuildChartCanvas(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    const { labels, values, fullDescriptions } = getTop5IncomeData();
    if (labels.length === 0) {
        if (emptyEl) emptyEl.classList.add('visible');
        if (containerEl) containerEl.style.display = 'none';
        return;
    }
    if (emptyEl) emptyEl.classList.remove('visible');
    if (containerEl) containerEl.style.display = '';
    applyTop5ChartScrollWidth(containerEl, labels);
    chartTop5Income = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels.slice(),
            datasets: [{
                label: 'Montant (' + getCurrencyLabel() + ')',
                data: values.slice(),
                fullDescriptions: fullDescriptions.slice(),
                backgroundColor: 'rgba(16, 185, 129, 0.7)',
                borderColor: '#10b981',
                borderWidth: 1
            }]
        },
        options: getTop5BarChartOptions(labels, fullDescriptions)
    });
}

function updateChartIncomeByCategory() {
    const canvasId = 'chartIncomeByCategory';
    const emptyEl = document.getElementById('chartIncomeByCategoryEmpty');
    const containerEl = document.getElementById('chartIncomeByCategoryContainer');
    chartIncomeByCategory = destroyChartInstance(chartIncomeByCategory);
    rebuildChartCanvas(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    const data = getIncomeByCategoryData();
    if (data.labels.length === 0) {
        if (emptyEl) emptyEl.classList.add('visible');
        if (containerEl) containerEl.style.display = 'none';
        return;
    }
    if (emptyEl) emptyEl.classList.remove('visible');
    if (containerEl) containerEl.style.display = '';
    applyTop5ChartScrollWidth(containerEl, data.labels);
    chartIncomeByCategory = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: data.labels.slice(),
            datasets: [{
                label: 'Entrants (' + getCurrencyLabel() + ')',
                data: data.values.slice(),
                backgroundColor: 'rgba(67, 39, 125, 0.72)',
                borderColor: '#43277d',
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (ctx) {
                            return formatAmount(ctx.raw);
                        }
                    }
                }
            },
            scales: {
                y: getTop5YScaleOptions(data.labels),
                x: {
                    beginAtZero: true,
                    ticks: {
                        callback: function (v) {
                            return formatChartAxisTick(v);
                        }
                    }
                }
            }
        }
    });
}

// Variables globales pour les filtres
let currentFilter = 'all';
let searchKeyword = '';
let singleDate = '';
let dateFrom = '';
let dateTo = '';
let transactionClientFilter = '';
let transactionCategoryFilter = '';

// Variables pour la pagination
let currentPage = 1;
const itemsPerPage = 20;

function hasActiveTransactionFilters() {
    return currentFilter !== 'all'
        || searchKeyword.trim() !== ''
        || !!singleDate
        || !!dateFrom
        || !!dateTo
        || !!transactionClientFilter
        || !!transactionCategoryFilter;
}

function getTransactionsEmptyMessage() {
    if (transactions.length === 0) {
        return 'Aucune transaction pour le moment.';
    }
    if (transactionClientFilter) {
        return 'Aucune transaction pour ce contact.';
    }
    if (transactionCategoryFilter) {
        return 'Aucune transaction pour cette catégorie.';
    }
    if (hasActiveTransactionFilters()) {
        return 'Aucune transaction ne correspond à votre recherche.';
    }
    return 'Aucune transaction pour le moment.';
}

// Afficher les transactions avec tous les filtres
function displayTransactions(filter = currentFilter) {
    currentFilter = filter;
    const transactionsList = document.getElementById('transactionsList');
    
    let filteredTransactions = [...transactions];
    
    // Filtre par type (Entrant/Sortant) ou par statut (En attente de complément)
    if (filter === 'pending') {
        // Filtrer les transactions avec un montant restant > 0
        filteredTransactions = filteredTransactions.filter(t => t.remainingAmount && t.remainingAmount > 0);
    } else if (filter !== 'all') {
        filteredTransactions = filteredTransactions.filter(t => t.type === filter);
    }
    
    // Filtre par mot-clé (description ou montant)
    if (searchKeyword.trim() !== '') {
        const keyword = searchKeyword.toLowerCase().trim();
        filteredTransactions = filteredTransactions.filter(t => {
            const descriptionMatch = t.description.toLowerCase().includes(keyword);
            const amountMatch = t.amount.toString().includes(keyword);
            return descriptionMatch || amountMatch;
        });
    }

    if (transactionClientFilter) {
        const filterClient = findClientByName(transactionClientFilter);
        filteredTransactions = filteredTransactions.filter(function (t) {
            if (filterClient) return transactionBelongsToClient(t, filterClient);
            const clientKey = transactionClientFilter.toLowerCase();
            return resolveTransactionClientName(t).toLowerCase() === clientKey;
        });
    }

    if (transactionCategoryFilter) {
        filteredTransactions = filteredTransactions.filter(function (t) {
            return transactionBelongsToCategory(t, transactionCategoryFilter);
        });
    }
    
    // Filtre par date
    // Si un jour unique est sélectionné, priorité sur la plage de dates
    if (singleDate) {
        const selectedDate = new Date(singleDate);
        const startOfDay = new Date(selectedDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(selectedDate);
        endOfDay.setHours(23, 59, 59, 999);
        
        filteredTransactions = filteredTransactions.filter(t => {
            const transactionDate = new Date(t.date);
            return transactionDate >= startOfDay && transactionDate <= endOfDay;
        });
    } else {
        // Sinon, utiliser la plage de dates (Du/Au)
        if (dateFrom) {
            const fromDate = new Date(dateFrom);
            fromDate.setHours(0, 0, 0, 0);
            filteredTransactions = filteredTransactions.filter(t => {
                const transactionDate = new Date(t.date);
                transactionDate.setHours(0, 0, 0, 0);
                return transactionDate >= fromDate;
            });
        }
        
        if (dateTo) {
            const toDate = new Date(dateTo);
            toDate.setHours(23, 59, 59, 999);
            filteredTransactions = filteredTransactions.filter(t => {
                const transactionDate = new Date(t.date);
                return transactionDate <= toDate;
            });
        }
    }
    
    // Trier par date (plus récent en premier)
    filteredTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (filteredTransactions.length === 0) {
        transactionsList.innerHTML = '<p class="list-empty-state">' + escapeHtml(getTransactionsEmptyMessage()) + '</p>';
        document.getElementById('pagination').style.display = 'none';
        return;
    }
    
    // Pagination
    const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);
    currentPage = Math.min(currentPage, totalPages) || 1;
    
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedTransactions = filteredTransactions.slice(startIndex, endIndex);
    
    // Afficher les transactions paginées
    transactionsList.innerHTML = paginatedTransactions.map((transaction, index) => {
        const typeClass = transaction.type === 'income' ? 'income' : 'expense';
        const sign = transaction.type === 'income' ? '+' : '-';
        const animationDelay = index * 0.05;
        const hasRemaining = transaction.remainingAmount && transaction.remainingAmount > 0;
        const clientName = resolveTransactionClientName(transaction);
        const categoryName = transaction.type === 'income' ? getTransactionCategory(transaction) : '';
        const contactLabel = getTransactionContactLabel(transaction);
        const invoiceBtnTitle = transaction.type === 'expense' ? 'Voir la note de paiement' : 'Voir la facture';
        const authorLine = (transaction.cree_par_nom)
            ? '<div class="transaction-author" style="font-size:0.82em;color:#6b7280;margin-top:4px;">Par : ' + escapeHtml(transaction.cree_par_nom) + (transaction.cree_par_role ? ' · ' + escapeHtml(transaction.cree_par_role) : '') + '</div>'
            : '';
        const txLocked = isResourceEditLocked('transaction', transaction.id);
        const editLockTitle = txLocked && typeof window.xalissGetEditLockMessage === 'function'
            ? window.xalissGetEditLockMessage('transaction', transaction.id)
            : 'Modifier';
        const pendingMark = transaction._offlinePending
            ? '<span class="tx-pending-sync" title="En attente de synchronisation">⏳ </span>'
            : '';
        
        return `
            <div class="transaction-item ${typeClass}${txLocked ? ' is-edit-locked' : ''}${transaction._offlinePending ? ' is-offline-pending' : ''}" style="animation-delay: ${animationDelay}s">
                <div class="transaction-info">
                    <div class="transaction-description">${pendingMark}${escapeHtml(transaction.description)}</div>
                    ${(clientName || categoryName) ? '<div class="transaction-tags">' +
                        (clientName ? '<div class="transaction-client"><span class="transaction-client-label">' + contactLabel + '\u00A0: </span><span class="transaction-client-name">' + escapeHtml(clientName) + '</span></div>' : '') +
                        (categoryName ? '<div class="transaction-category"><span class="transaction-client-label">Catégorie\u00A0: </span><span class="transaction-client-name">' + escapeHtml(categoryName) + '</span></div>' : '') +
                    '</div>' : ''}
                    <div class="transaction-date">${formatDate(transaction.date)}</div>
                    ${authorLine}
                    ${hasRemaining ? `<div class="transaction-remaining" style="color: #f59e0b; font-size: 0.9em; margin-top: 5px; font-weight: 600;">⏳ Reste à payer: ${formatAmount(transaction.remainingAmount)}</div>` : ''}
                </div>
                <div class="transaction-amount">
                    ${sign} ${formatAmount(transaction.amount)}
                </div>
                <div class="transaction-actions">
                    ${hasRemaining ? `
                    <button class="complete-btn" onclick="openCompleteModal('${transaction.id}')" title="Compléter le paiement">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M20 6L9 17l-5-5" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    ` : ''}
                    <button class="invoice-btn" onclick="openInvoiceModal('${transaction.id}')" title="${invoiceBtnTitle}">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            <circle cx="8.5" cy="8.5" r="1.5" stroke="#43277d" stroke-width="2"/>
                            <path d="M21 15l-5-5L5 21" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="edit-btn" onclick="openEditModal('${transaction.id}')" title="${escapeHtml(editLockTitle)}" ${txLocked ? 'disabled aria-disabled="true"' : ''}>
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="delete-btn" onclick="deleteTransaction('${transaction.id}')">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    // Animer l'apparition des transactions
    setTimeout(() => {
        const items = transactionsList.querySelectorAll('.transaction-item');
        items.forEach((item, index) => {
            setTimeout(() => {
                item.classList.add('visible');
            }, index * 50);
        });
    }, 10);
    
    // Afficher/masquer la pagination
    const pagination = document.getElementById('pagination');
    if (filteredTransactions.length > itemsPerPage) {
        pagination.style.display = 'flex';
        updatePaginationInfo(totalPages, filteredTransactions.length);
    } else {
        pagination.style.display = 'none';
    }

    updateClientTransactionFilterBar();
    updateCategoryTransactionFilterBar();

    if (typeof applyRolePermissionsUI === 'function') {
        applyRolePermissionsUI();
    }
}

// Mettre à jour les informations de pagination
function updatePaginationInfo(totalPages, totalItems) {
    const pageInfo = document.getElementById('pageInfo');
    const startItem = (currentPage - 1) * itemsPerPage + 1;
    const endItem = Math.min(currentPage * itemsPerPage, totalItems);
    pageInfo.textContent = `${startItem}-${endItem} sur ${totalItems} (Page ${currentPage}/${totalPages})`;
    
    // Activer/désactiver les boutons
    document.getElementById('prevBtn').disabled = currentPage === 1;
    document.getElementById('nextBtn').disabled = currentPage === totalPages;
}

// Changer de page
function changePage(direction) {
    const filteredTransactions = getFilteredTransactions();
    const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);
    
    currentPage += direction;
    currentPage = Math.max(1, Math.min(currentPage, totalPages));
    
    displayTransactions(currentFilter);
    
    // Scroller vers le haut de la liste
    document.getElementById('transactionsList').scrollTop = 0;
}

// Obtenir les transactions filtrées (pour la pagination)
function getFilteredTransactions() {
    let filteredTransactions = [...transactions];
    
    if (currentFilter === 'pending') {
        // Filtrer les transactions avec un montant restant > 0
        filteredTransactions = filteredTransactions.filter(t => t.remainingAmount && t.remainingAmount > 0);
    } else if (currentFilter !== 'all') {
        filteredTransactions = filteredTransactions.filter(t => t.type === currentFilter);
    }
    
    if (searchKeyword.trim() !== '') {
        const keyword = searchKeyword.toLowerCase().trim();
        filteredTransactions = filteredTransactions.filter(t => {
            const descriptionMatch = t.description.toLowerCase().includes(keyword);
            const amountMatch = t.amount.toString().includes(keyword);
            return descriptionMatch || amountMatch;
        });
    }

    if (transactionClientFilter) {
        const filterClient = findClientByName(transactionClientFilter);
        filteredTransactions = filteredTransactions.filter(function (t) {
            if (filterClient) return transactionBelongsToClient(t, filterClient);
            const clientKey = transactionClientFilter.toLowerCase();
            return resolveTransactionClientName(t).toLowerCase() === clientKey;
        });
    }

    if (transactionCategoryFilter) {
        filteredTransactions = filteredTransactions.filter(function (t) {
            return transactionBelongsToCategory(t, transactionCategoryFilter);
        });
    }
    
    if (singleDate) {
        const selectedDate = new Date(singleDate);
        const startOfDay = new Date(selectedDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(selectedDate);
        endOfDay.setHours(23, 59, 59, 999);
        
        filteredTransactions = filteredTransactions.filter(t => {
            const transactionDate = new Date(t.date);
            return transactionDate >= startOfDay && transactionDate <= endOfDay;
        });
    } else {
        if (dateFrom) {
            const fromDate = new Date(dateFrom);
            fromDate.setHours(0, 0, 0, 0);
            filteredTransactions = filteredTransactions.filter(t => {
                const transactionDate = new Date(t.date);
                transactionDate.setHours(0, 0, 0, 0);
                return transactionDate >= fromDate;
            });
        }
        
        if (dateTo) {
            const toDate = new Date(dateTo);
            toDate.setHours(23, 59, 59, 999);
            filteredTransactions = filteredTransactions.filter(t => {
                const transactionDate = new Date(t.date);
                return transactionDate <= toDate;
            });
        }
    }
    
    filteredTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    return filteredTransactions;
}

// Fonction pour effacer tous les filtres
function clearFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('singleDate').value = '';
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    searchKeyword = '';
    singleDate = '';
    dateFrom = '';
    dateTo = '';
    transactionClientFilter = '';
    transactionCategoryFilter = '';
    updateClientTransactionFilterBar();
    updateCategoryTransactionFilterBar();
    currentPage = 1; // Réinitialiser à la première page
    displayTransactions(currentFilter);
}

// Fonctions de validation (allowZero = true pour "dette" : entrant 0 F + restant à payer)
function validateAmount(amount, errorElementId, allowZero = false) {
    const cleanAmount = amount ? amount.toString().replace(/\s/g, '') : '';
    let amountValue = parseFloat(cleanAmount);
    if (isNaN(amountValue)) amountValue = 0;
    const errorElement = document.getElementById(errorElementId);
    let inputElement;
    if (errorElementId === 'editAmountError') {
        inputElement = document.getElementById('editAmount');
    } else if (errorElementId.includes('income')) {
        inputElement = document.getElementById('incomeAmount');
    } else {
        inputElement = document.getElementById('expenseAmount');
    }
    
    errorElement.textContent = '';
    inputElement.classList.remove('error', 'valid');
    
    if (!cleanAmount || cleanAmount.trim() === '') {
        if (allowZero) {
            inputElement.classList.add('valid');
            return true;
        }
        errorElement.textContent = 'Le montant est requis';
        inputElement.classList.add('error');
        return false;
    }
    
    if (!/^[\d.,]+$/.test(cleanAmount)) {
        errorElement.textContent = 'Le montant ne peut contenir que des chiffres et un point ou une virgule';
        inputElement.classList.add('error');
        return false;
    }
    
    if (isNaN(parseFloat(cleanAmount.replace(',', '.')))) {
        errorElement.textContent = 'Le montant doit être un nombre valide';
        inputElement.classList.add('error');
        return false;
    }
    
    const decimalPart = cleanAmount.includes('.') ? cleanAmount.split('.')[1] : 
                       cleanAmount.includes(',') ? cleanAmount.split(',')[1] : '';
    if (decimalPart && decimalPart.length > 2) {
        errorElement.textContent = 'Le montant ne peut avoir que 2 décimales maximum';
        inputElement.classList.add('error');
        return false;
    }
    
    if (amountValue < 0) {
        errorElement.textContent = 'Le montant ne peut pas être négatif';
        inputElement.classList.add('error');
        return false;
    }
    
    if (amountValue === 0 && !allowZero) {
        errorElement.textContent = 'Le montant doit être supérieur à 0';
        inputElement.classList.add('error');
        return false;
    }
    
    if (amountValue > 0 && amountValue < 1 && !allowZero) {
        errorElement.textContent = 'Le montant minimum est de 1 ' + getCurrencyLabel();
        inputElement.classList.add('error');
        return false;
    }
    
    if (amountValue > 1000000000) {
        errorElement.textContent = 'Le montant est trop élevé (max: 1 000 000 000 ' + getCurrencyLabel() + ')';
        inputElement.classList.add('error');
        return false;
    }
    
    if (amountValue === 0 && allowZero) {
        inputElement.classList.add('valid');
        return true;
    }
    
    // Normaliser le format (remplacer virgule par point)
    if (cleanAmount.includes(',')) {
        inputElement.value = cleanAmount.replace(',', '.');
    }
    
    inputElement.classList.add('valid');
    return true;
}

function validateDescription(description, errorElementId) {
    const errorElement = document.getElementById(errorElementId);
    let inputElement, counterElement;
    if (errorElementId === 'editDescriptionError') {
        inputElement = document.getElementById('editDescription');
        counterElement = document.getElementById('editDescriptionCounter');
    } else if (errorElementId.includes('income')) {
        inputElement = document.getElementById('incomeDescription');
        counterElement = document.getElementById('incomeDescriptionCounter');
    } else {
        inputElement = document.getElementById('expenseDescription');
        counterElement = document.getElementById('expenseDescriptionCounter');
    }
    
    // Réinitialiser
    errorElement.textContent = '';
    inputElement.classList.remove('error', 'valid');
    
    // Mettre à jour le compteur
    const length = description ? description.length : 0;
    if (counterElement) {
        counterElement.textContent = length;
        counterElement.parentElement.classList.remove('warning', 'danger');
        if (length > 180) {
            counterElement.parentElement.classList.add('danger');
        } else if (length > 150) {
            counterElement.parentElement.classList.add('warning');
        }
    }
    
    if (!description || description.trim() === '') {
        errorElement.textContent = 'La description est requise';
        inputElement.classList.add('error');
        return false;
    }
    
    if (description.trim().length < 3) {
        errorElement.textContent = 'La description doit contenir au moins 3 caractères';
        inputElement.classList.add('error');
        return false;
    }
    
    if (description.length > 200) {
        errorElement.textContent = 'La description ne peut pas dépasser 200 caractères';
        inputElement.classList.add('error');
        return false;
    }
    
    // Vérifier les caractères suspects (éviter les injections)
    if (/<script|javascript:|onerror=|onclick=|onload=/i.test(description)) {
        errorElement.textContent = 'La description contient des caractères non autorisés';
        inputElement.classList.add('error');
        return false;
    }
    
    // Vérifier les espaces multiples
    if (/\s{3,}/.test(description)) {
        errorElement.textContent = 'La description ne peut pas contenir plus de 2 espaces consécutifs';
        inputElement.classList.add('error');
        return false;
    }
    
    inputElement.classList.add('valid');
    return true;
}

function validateDate(date, errorElementId) {
    const errorElement = document.getElementById(errorElementId);
    let inputElement;
    if (errorElementId === 'editDateError') {
        inputElement = document.getElementById('editDate');
    } else if (errorElementId.includes('income')) {
        inputElement = document.getElementById('incomeDate');
    } else {
        inputElement = document.getElementById('expenseDate');
    }
    
    // Réinitialiser
    errorElement.textContent = '';
    inputElement.classList.remove('error', 'valid');
    
    // La date est optionnelle, donc si vide, c'est valide
    if (!date || date.trim() === '') {
        inputElement.classList.add('valid');
        return true;
    }
    
    const selectedDate = new Date(date);
    const now = new Date();
    const maxFutureDate = new Date();
    maxFutureDate.setFullYear(now.getFullYear() + 1); // 1 an dans le futur max
    
    if (isNaN(selectedDate.getTime())) {
        errorElement.textContent = 'Date invalide';
        inputElement.classList.add('error');
        return false;
    }
    
    if (selectedDate > maxFutureDate) {
        errorElement.textContent = 'La date ne peut pas être plus d\'un an dans le futur';
        inputElement.classList.add('error');
        return false;
    }
    
    // Date trop ancienne (plus de 10 ans)
    const minDate = new Date();
    minDate.setFullYear(now.getFullYear() - 10);
    if (selectedDate < minDate) {
        errorElement.textContent = 'La date ne peut pas être plus de 10 ans dans le passé';
        inputElement.classList.add('error');
        return false;
    }
    
    inputElement.classList.add('valid');
    return true;
}

// Normalise une date (Firestore Timestamp ou string ISO) en string ISO
function toIsoDate(d) {
    if (!d) return '';
    if (typeof d.toDate === 'function') return d.toDate().toISOString();
    if (typeof d === 'string') return d;
    if (typeof d.toMillis === 'function') return new Date(d.toMillis()).toISOString();
    return new Date(d).toISOString();
}

// Retourne la liste des encaissements (montant + date) pour une transaction (recette par jour = somme par date réelle)
function getPaymentEntries(t) {
    if (t.payments && Array.isArray(t.payments) && t.payments.length > 0) {
        return t.payments.map(p => ({ amount: parseFloat(p.amount), date: toIsoDate(p.date) || toIsoDate(t.date) }));
    }
    return [{ amount: parseFloat(t.amount), date: toIsoDate(t.date) }];
}

// Ajouter une transaction
function addTransaction(type, amount, description, date, remainingAmount = null, invoiceClient = null, invoiceClientId = null, category = '') {
    const amt = parseFloat(amount);
    const unusualExpenseBenchmark = type === 'expense' ? getUnusualExpenseBenchmark(amt) : null;
    const dateIso = new Date(date).toISOString();
    const transaction = {
        type,
        amount: amt,
        description: description.trim(),
        category: type === 'income' ? normalizeCategoryName(category) : '',
        date: dateIso,
        payments: [{ amount: amt, date: dateIso }]
    };
    
    // Ajouter le montant restant si fourni
    if (remainingAmount !== null && remainingAmount !== '') {
        transaction.remainingAmount = parseFloat(remainingAmount);
    }

    const clientFields = normalizeInvoiceClientFields(invoiceClient, invoiceClientId);
    if (clientFields.invoiceClient) {
        transaction.invoiceClient = clientFields.invoiceClient;
        if (clientFields.invoiceClientId) {
            transaction.invoiceClientId = clientFields.invoiceClientId;
        }
    }
    
    if (useFirebase && db) {
        // Ajouter à Firestore
        db.collection('transactions').add(transaction)
            .then(() => {
                console.log('Transaction ajoutée à Firebase');
                notifyUnusualExpenseIfNeeded(amt, description, unusualExpenseBenchmark);
            })
            .catch((error) => {
                console.error('Erreur lors de l\'ajout:', error);
                switchToLocalMode(error);
                showNotification('Synchronisation indisponible. Donnees sauvegardees en local.', 'error');
                // Fallback : ajouter localement
                transaction.id = Date.now();
                transactions.push(transaction);
                saveTransactions();
                notifyUnusualExpenseIfNeeded(amt, description, unusualExpenseBenchmark);
            });
    } else {
        // Ajouter localement
        transaction.id = Date.now();
        transactions.push(transaction);
        saveTransactions();
        notifyUnusualExpenseIfNeeded(amt, description, unusualExpenseBenchmark);
    }
}

// Supprimer une transaction
function deleteTransaction(id) {
    console.log('deleteTransaction appelé avec id:', id, 'type:', typeof id);
    if (!id) {
        console.error('ID de transaction manquant');
        return;
    }
    
    showDeleteConfirm({
        title: 'Supprimer la transaction',
        message: 'Êtes-vous sûr de vouloir supprimer cette transaction ?',
        detail: 'Cette action est irréversible.',
        onConfirm: function () {
            const transactionId = String(id);
            transactions = transactions.filter(t => String(t.id) !== transactionId);

            if (useFirebase && db) {
                db.collection('transactions').doc(transactionId).delete()
                    .catch((error) => {
                        console.error('Erreur lors de la suppression:', error);
                        switchToLocalMode(error);
                        showNotification('Synchronisation indisponible. Suppression en local.', 'error');
                        localStorage.setItem('kaayprint_transactions', JSON.stringify(transactions));
                    });
            } else {
                localStorage.setItem('kaayprint_transactions', JSON.stringify(transactions));
            }
            updateDisplay();
        }
    });
}

// S'assurer que la fonction est accessible globalement
window.deleteTransaction = deleteTransaction;

// Variable pour stocker l'ID de la transaction en cours d'édition
let editingTransactionId = null;

// Ouvrir le modal d'édition
function openEditModal(id) {
    console.log('openEditModal appelé avec id:', id, 'type:', typeof id);
    if (!id) {
        console.error('ID de transaction manquant');
        return;
    }
    
    // Convertir l'ID en nombre si c'est un ID local (Date.now())
    const transactionId = typeof id === 'string' && !isNaN(id) && !id.includes('-') ? parseInt(id) : id;
    
    const transaction = transactions.find(t => String(t.id) === String(transactionId));
    if (!transaction) {
        console.error('Transaction non trouvée avec id:', transactionId);
        console.log('Transactions disponibles:', transactions.map(t => ({ id: t.id, type: typeof t.id })));
        return;
    }
    
    editingTransactionId = transactionId;
    const modal = document.getElementById('editModal');
    if (!modal) {
        console.error('Modal d\'édition non trouvé');
        return;
    }
    
    // Remplir le formulaire avec les données de la transaction
    const dateValue = new Date(transaction.date).toISOString().slice(0, 16);
    document.getElementById('editAmount').value = transaction.amount;
    document.getElementById('editDescription').value = transaction.description;
    document.getElementById('editDate').value = dateValue;

    const editInvoiceClient = document.getElementById('editInvoiceClient');
    if (editInvoiceClient) {
        setInvoiceClientControl('editInvoiceClient', resolveTransactionClientName(transaction));
    }
    updateEditInvoiceClientFieldUi(transaction);
    const editCategoryGroup = document.getElementById('editCategoryGroup');
    const editCategory = document.getElementById('editCategory');
    if (editCategoryGroup) {
        editCategoryGroup.style.display = transaction.type === 'income' ? '' : 'none';
    }
    if (editCategory) {
        fillCategorySelect(editCategory, transaction.type === 'income' ? getTransactionCategory(transaction) : '');
    }
    
    // Libellé du montant : "Montant payé à ce jour" pour les deux (entrant et sortant peuvent être partiels)
    const editAmountLabel = document.querySelector('#editForm label[for="editAmount"]');
    if (editAmountLabel) {
        editAmountLabel.textContent = 'Montant payé à ce jour (' + getCurrencyLabel() + ')';
    }
    
    // Entrants et sortants : afficher le champ "Restant à payer" (permettre de passer en partiel ou modifier le restant)
    const editRemainingGroup = document.getElementById('editRemainingGroup');
    const editRemainingAmount = document.getElementById('editRemainingAmount');
    if (editRemainingGroup && editRemainingAmount) {
        editRemainingGroup.style.display = 'block';
        editRemainingAmount.value = (transaction.remainingAmount != null && transaction.remainingAmount > 0) ? transaction.remainingAmount : '';
        editRemainingAmount.removeAttribute('required');
    }
    
    // Mettre à jour le compteur de caractères
    const descLength = transaction.description.length;
    const counterEl = document.getElementById('editDescriptionCounter');
    if (counterEl) {
        counterEl.textContent = descLength;
        const counterParent = counterEl.parentElement;
        counterParent.classList.remove('warning', 'danger');
        if (descLength > 180) {
            counterParent.classList.add('danger');
        } else if (descLength > 150) {
            counterParent.classList.add('warning');
        }
    }
    
    // Réinitialiser les erreurs
    document.querySelectorAll('#editForm .error-message').forEach(el => el.textContent = '');
    document.querySelectorAll('#editForm input').forEach(el => el.classList.remove('error', 'valid'));
    
    // Afficher le modal
    modal.style.display = 'flex';
}

// S'assurer que la fonction est accessible globalement
window.openEditModal = openEditModal;
window.clearBenefitCardFilter = clearBenefitCardFilter;
window.clearStatsFiltersPeriod = clearStatsFiltersPeriod;

// Logo facture en data URL pour affichage et export identiques
var invoiceLogoDataUrlCache = null;
function getAppBaseUrl() {
    return new URL('.', window.location.href).href;
}

function preloadInvoiceLogo() {
    if (invoiceLogoDataUrlCache) return Promise.resolve(invoiceLogoDataUrlCache);
    var logoUrl = (window.XALISS_DJANGO && window.XALISS_DJANGO.logoUrl)
        ? window.XALISS_DJANGO.logoUrl
        : new URL('images/logo.png', getAppBaseUrl()).href;
    var isHttp = window.location.protocol === 'http:' || window.location.protocol === 'https:';
    return new Promise(function (resolve) {
        var img = new Image();
        if (isHttp) img.crossOrigin = 'anonymous';
        img.onload = function () {
            try {
                var canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                invoiceLogoDataUrlCache = canvas.toDataURL('image/png');
            } catch (e) { }
            resolve(invoiceLogoDataUrlCache);
        };
        img.onerror = function () { resolve(null); };
        img.src = logoUrl;
    });
}

// Facture : ouvrir le modal avec le contenu généré à partir de la transaction
function openInvoiceModal(id) {
    if (!id) return;
    const transactionId = typeof id === 'string' && !isNaN(id) && !id.includes('-') ? parseInt(id) : id;
    const transaction = transactions.find(t => String(t.id) === String(transactionId));
    if (!transaction) {
        showNotification('Transaction non trouvée', 'error');
        return;
    }
    currentInvoiceTransaction = transaction;
    const invoiceDocTitle = getInvoiceDocumentTitle(transaction);
    const invoiceModalTitleEl = document.getElementById('invoiceModalTitle');
    if (invoiceModalTitleEl) invoiceModalTitleEl.textContent = invoiceDocTitle;

    const typeLabel = transaction.type === 'income' ? 'Entrant' : 'Sortant';
    const dateFormatted = formatDate(transaction.date);
    const hasRemaining = transaction.remainingAmount != null && transaction.remainingAmount > 0;
    const factureNum = getInvoiceDocumentNumPrefix(transaction) + String(transaction.id).slice(-8).toUpperCase();
    var logoSrc = invoiceLogoDataUrlCache || 'images/logo.png';

    const company = loadCompanyProfile();
    const addressLines = formatAddressLines(company.address);
    const hasCompany = (company.name && String(company.name).trim()) ||
        addressLines.length ||
        (company.phone && String(company.phone).trim()) ||
        (company.email && String(company.email).trim());
    let companyBlockHtml = '';
    if (hasCompany) {
        let inner = '';
        if (company.name && String(company.name).trim()) {
            inner += `<p class="invoice-company-name">${escapeHtml(String(company.name).trim())}</p>`;
        }
        addressLines.forEach(line => {
            inner += `<div class="invoice-company-line">${escapeHtml(line)}</div>`;
        });
        if (company.phone && String(company.phone).trim()) {
            inner += `<div class="invoice-company-line">Tél. ${escapeHtml(String(company.phone).trim())}</div>`;
        }
        if (company.email && String(company.email).trim()) {
            inner += `<div class="invoice-company-line">${escapeHtml(String(company.email).trim())}</div>`;
        }
        companyBlockHtml = `<div class="invoice-company-block">${inner}</div>`;
    }

    const clientRaw = resolveTransactionClientName(transaction);
    const contactLabel = getTransactionContactLabel(transaction);
    const clientBlockHtml = clientRaw
        ? `<div class="invoice-client-row"><span class="invoice-client-label">${contactLabel} :</span>${escapeHtml(clientRaw)}</div>`
        : '';

    const descSafe = transaction.description ? escapeHtml(transaction.description) : '-';

    const qrTarget = normalizeCompanyWebsiteForQr(company.website);
    const qrPromise = qrTarget
        ? generateQrDataUrl(qrTarget).then(function (dataUrl) {
            return dataUrl;
        }).catch(function () { return ''; })
        : Promise.resolve('');

    qrPromise.then(function (qrDataUrl) {
        const footerHtml = qrDataUrl
            ? '<div class="invoice-footer invoice-footer--split">' +
                '<div class="invoice-footer-copy">' +
                '<p class="invoice-qr-caption">Scannez et abonnez-vous !</p>' +
                '<p class="invoice-footer-text">Merci pour votre confiance</p>' +
                '</div>' +
                '<div class="invoice-footer-arrow" aria-hidden="true">' +
                '<svg viewBox="0 0 56 28" width="48" height="24" xmlns="http://www.w3.org/2000/svg">' +
                '<defs><linearGradient id="invFootArG" x1="0" y1="0" x2="1" y2="0">' +
                '<stop offset="0%" stop-color="#43277d"/><stop offset="100%" stop-color="#e72060"/></linearGradient></defs>' +
                '<path d="M4 14h36M38 8l12 6-12 6" stroke="url(#invFootArG)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>' +
                '</div>' +
                '<div class="invoice-footer-qr">' +
                '<img class="invoice-qr-img" src="' + qrDataUrl + '" width="76" height="76" alt="QR code">' +
                '</div></div>'
            : '<div class="invoice-footer invoice-footer--solo">' +
                '<p class="invoice-footer-text">Merci pour votre confiance</p></div>';

        const invoiceHtml = `
        <div class="invoice-paper" id="invoicePaper">
            <div class="invoice-header">
                <img src="${logoSrc}" alt="${escapeHtml((company.name && String(company.name).trim()) || 'Xaliss')}" class="invoice-logo">
                <p class="invoice-title">${getInvoiceDocumentTitleUpper(transaction)}</p>
                <span class="invoice-num">N° ${factureNum}</span>
            </div>
            ${companyBlockHtml}
            ${clientBlockHtml}
            <div class="invoice-body">
                <table class="invoice-table">
                    <tr><td class="invoice-label">Date</td><td class="invoice-value">${dateFormatted}</td></tr>
                    <tr><td class="invoice-label">Type</td><td class="invoice-value">${typeLabel}</td></tr>
                    <tr class="invoice-row-desc"><td class="invoice-label">Description</td><td class="invoice-value">${descSafe}</td></tr>
                    <tr class="invoice-row-amount"><td class="invoice-label">Montant</td><td class="invoice-amount">${formatAmount(transaction.amount)}</td></tr>
                    ${hasRemaining ? `<tr class="invoice-row-remaining"><td class="invoice-label">Reste à payer</td><td class="invoice-value">${formatAmount(transaction.remainingAmount)}</td></tr>` : ''}
                </table>
            </div>
            ${footerHtml}
        </div>
    `;
        const contentEl = document.getElementById('invoiceContent');
        if (contentEl) contentEl.innerHTML = invoiceHtml;
        const modal = document.getElementById('invoiceModal');
        if (modal) modal.style.display = 'flex';
        if (!invoiceLogoDataUrlCache) {
            preloadInvoiceLogo().then(function (url) {
                if (url) {
                    var paper = document.getElementById('invoicePaper');
                    var logoImg = paper && paper.querySelector('img.invoice-logo');
                    if (logoImg) logoImg.src = url;
                }
            });
        }
    });
}

function closeInvoiceModal() {
    currentInvoiceTransaction = null;
    const modal = document.getElementById('invoiceModal');
    if (modal) modal.style.display = 'none';
}

function printInvoice() {
    const paper = document.getElementById('invoicePaper');
    if (!paper) return;
    const win = window.open('', '_blank');
    const base = getAppBaseUrl();
    const printHtml = paper.outerHTML.replace('src="images/logo.png"', 'src="' + new URL('images/logo.png', base).href + '"');
    const printStyles = getInvoicePaperCssString();
    const printTitle = getInvoiceDocumentTitle(currentInvoiceTransaction);
    win.document.write('<html><head><title>' + printTitle + '</title><base href="' + base + '"><style>' + printStyles + '</style></head><body>' + printHtml + '</body></html>');
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 250);
}

function waitForAllImagesIn(root) {
    if (!root) return Promise.resolve();
    var imgs = root.querySelectorAll('img');
    var promises = [];
    for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        if (img.complete && img.naturalWidth) continue;
        promises.push(new Promise(function (resolve) {
            img.onload = resolve;
            img.onerror = resolve;
            setTimeout(resolve, 15000);
        }));
    }
    return promises.length ? Promise.all(promises) : Promise.resolve();
}

function canvasToBlobSafe(canvas) {
    return new Promise(function (resolve, reject) {
        if (typeof canvas.toBlob === 'function') {
            canvas.toBlob(function (blob) {
                if (blob) {
                    resolve(blob);
                    return;
                }
                try {
                    var dataUrl = canvas.toDataURL('image/png');
                    var base64 = dataUrl.split(',')[1];
                    var binary = atob(base64);
                    var len = binary.length;
                    var bytes = new Uint8Array(len);
                    for (var i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
                    resolve(new Blob([bytes], { type: 'image/png' }));
                } catch (e) {
                    reject(new Error('Export impossible'));
                }
            }, 'image/png', 1);
        } else {
            try {
                var dataUrl = canvas.toDataURL('image/png');
                var base64 = dataUrl.split(',')[1];
                var binary = atob(base64);
                var len = binary.length;
                var bytes = new Uint8Array(len);
                for (var i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
                resolve(new Blob([bytes], { type: 'image/png' }));
            } catch (e) {
                reject(new Error('Export impossible'));
            }
        }
    });
}

function getInvoiceAsImage() {
    var paper = document.getElementById('invoicePaper');
    if (!paper) return Promise.reject(new Error('Document indisponible'));
    var h2c = (typeof html2canvas !== 'undefined' && html2canvas) || (typeof window !== 'undefined' && window.html2canvas);
    if (!h2c || typeof h2c !== 'function') return Promise.reject(new Error('html2canvas indisponible'));
    return preloadInvoiceLogo().then(function (url) {
        if (url) {
            var logoImg = paper.querySelector('img.invoice-logo');
            if (logoImg) logoImg.src = url;
        }
        return new Promise(function (r) { setTimeout(r, 200); });
    }).then(function () {
        return waitForAllImagesIn(paper);
    }).then(function () {
        var host = document.createElement('div');
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;left:-10000px;top:0;width:420px;overflow:visible;background:#fff;z-index:-1;pointer-events:none;';
        var clone = paper.cloneNode(true);
        clone.removeAttribute('id');
        clone.style.width = '420px';
        clone.style.maxWidth = '420px';
        clone.style.minWidth = '420px';
        clone.style.minHeight = '580px';
        clone.style.fontSize = '14px';
        clone.style.transform = 'none';
        clone.style.zoom = '1';
        host.appendChild(clone);
        document.body.appendChild(host);
        return waitForAllImagesIn(clone).then(function () {
            var isFile = window.location.protocol === 'file:';
            var baseOpts = {
                scale: 2,
                width: 420,
                backgroundColor: '#ffffff',
                logging: false,
                imageTimeout: 20000
            };
            var capturePromise;
            if (isFile) {
                capturePromise = h2c(clone, Object.assign({}, baseOpts, {
                    foreignObjectRendering: true,
                    useCORS: false,
                    allowTaint: true
                })).catch(function () {
                    return h2c(clone, Object.assign({}, baseOpts, {
                        foreignObjectRendering: false,
                        useCORS: false,
                        allowTaint: true
                    }));
                });
            } else {
                capturePromise = h2c(clone, Object.assign({}, baseOpts, {
                    useCORS: true,
                    allowTaint: true
                }));
            }
            return capturePromise.finally(function () {
                if (host.parentNode) host.parentNode.removeChild(host);
            });
        }).catch(function (err) {
            if (host.parentNode) host.parentNode.removeChild(host);
            throw err;
        });
    }).then(canvasToBlobSafe);
}

function downloadInvoice() {
    const docTitle = getInvoiceDocumentTitle(currentInvoiceTransaction);
    const filePrefix = currentInvoiceTransaction && currentInvoiceTransaction.type === 'expense'
        ? 'note-paiement-kaayprint-'
        : 'facture-kaayprint-';
    getInvoiceAsImage().then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filePrefix + (new Date().toISOString().slice(0, 10)) + '.png';
        a.click();
        URL.revokeObjectURL(url);
    }).catch(function () {
        var msg = window.location.protocol === 'file:'
            ? 'Export PNG bloqué en mode fichier local. Lance start-local-server.bat puis ouvre http://localhost:8080/acceuil.html — ou utilise Imprimer puis Enregistrer en PDF.'
            : 'Export impossible. Utilisez Imprimer puis Enregistrer en PDF.';
        if (typeof showNotification === 'function') showNotification(msg, 'error');
        else alert(msg);
    });
}

function shareInvoice() {
    const docTitle = getInvoiceDocumentTitle(currentInvoiceTransaction);
    const filePrefix = currentInvoiceTransaction && currentInvoiceTransaction.type === 'expense'
        ? 'note-paiement-kaayprint'
        : 'facture-kaayprint';
    getInvoiceAsImage().then(function (blob) {
        var file = new File([blob], filePrefix + '.png', { type: 'image/png' });
        if (navigator.share && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }))) {
            return navigator.share({ title: docTitle + ' Xaliss', files: [file] });
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filePrefix + '-' + (new Date().toISOString().slice(0, 10)) + '.png';
        a.click();
        URL.revokeObjectURL(url);
        if (typeof showNotification === 'function') showNotification('Téléchargez l\'image puis partagez-la (WhatsApp, Instagram…)', 'info');
    }).catch(function () {
        var msg = window.location.protocol === 'file:'
            ? 'Export PNG bloqué en mode fichier local. Lance start-local-server.bat puis ouvre http://localhost:8080/acceuil.html — ou utilise Imprimer puis Enregistrer en PDF.'
            : 'Export impossible. Utilisez Imprimer puis Enregistrer en PDF.';
        if (typeof showNotification === 'function') showNotification(msg, 'error');
        else alert(msg);
    });
}

window.openInvoiceModal = openInvoiceModal;
window.closeInvoiceModal = closeInvoiceModal;
window.printInvoice = printInvoice;
window.downloadInvoice = downloadInvoice;
window.shareInvoice = shareInvoice;

// Variable pour stocker l'ID de la transaction en cours de complément
let completingTransactionId = null;

// Ouvrir le modal de complément
function openCompleteModal(id) {
    if (!id) {
        console.error('ID de transaction manquant');
        return;
    }
    
    const transactionId = typeof id === 'string' && !isNaN(id) && !id.includes('-') ? parseInt(id) : id;
    const transaction = transactions.find(t => String(t.id) === String(transactionId));
    
    if (!transaction) {
        console.error('Transaction non trouvée');
        return;
    }
    
    if (!transaction.remainingAmount || transaction.remainingAmount <= 0) {
        showNotification('Cette transaction est déjà complète', 'error');
        return;
    }
    
    completingTransactionId = transactionId;
    const modal = document.getElementById('completeModal');
    if (!modal) {
        console.error('Modal de complément non trouvé');
        return;
    }
    
    // Remplir le formulaire
    document.getElementById('completeRemainingAmount').value = formatAmount(transaction.remainingAmount);
    document.getElementById('completeAmount').value = '';
    document.getElementById('completeAmount').max = transaction.remainingAmount;
    document.getElementById('completeDate').value = '';
    
    // Réinitialiser les erreurs
    document.querySelectorAll('#completeForm .error-message').forEach(el => el.textContent = '');
    document.querySelectorAll('#completeForm input').forEach(el => el.classList.remove('error', 'valid'));
    
    // Afficher le modal
    modal.style.display = 'flex';
}

// S'assurer que la fonction est accessible globalement
window.openCompleteModal = openCompleteModal;

// Fermer le modal de complément
function closeCompleteModal() {
    const modal = document.getElementById('completeModal');
    if (modal) {
        modal.style.display = 'none';
    }
    completingTransactionId = null;
    
    // Réinitialiser le formulaire
    const completeForm = document.getElementById('completeForm');
    if (completeForm) {
        completeForm.reset();
        document.querySelectorAll('#completeForm .error-message').forEach(el => el.textContent = '');
        document.querySelectorAll('#completeForm input').forEach(el => el.classList.remove('error', 'valid'));
    }
}

// S'assurer que la fonction est accessible globalement
window.closeCompleteModal = closeCompleteModal;

// Compléter une transaction
function completeTransaction(transactionId, completeAmount, date) {
    const transaction = transactions.find(t => String(t.id) === String(transactionId));
    if (!transaction || !transaction.remainingAmount || transaction.remainingAmount <= 0) {
        showNotification('Transaction non trouvée ou déjà complète', 'error');
        return false;
    }
    
    const amountToComplete = parseFloat(completeAmount);
    if (amountToComplete <= 0) {
        showNotification('Le montant à compléter doit être supérieur à 0', 'error');
        return false;
    }
    
    // Calculer le nouveau montant et le nouveau remainingAmount
    const newAmount = transaction.amount + amountToComplete;
    const newRemainingAmount = transaction.remainingAmount - amountToComplete;
    const completeDateIso = new Date(date).toISOString();
    
    // Historique des paiements : ajouter cet encaissement à la date réelle
    const existingPayments = (transaction.payments && Array.isArray(transaction.payments)) ? [...transaction.payments] : [{ amount: transaction.amount, date: transaction.date }];
    existingPayments.push({ amount: amountToComplete, date: completeDateIso });
    
    const updatedData = {
        amount: newAmount,
        remainingAmount: newRemainingAmount <= 0 ? null : newRemainingAmount,
        payments: existingPayments
    };
    
    if (useFirebase && db) {
        // Mettre à jour dans Firestore
        return db.collection('transactions').doc(String(transactionId)).update(updatedData)
            .then(() => {
                console.log('Transaction complétée dans Firebase');
                const idx = transactions.findIndex(t => String(t.id) === String(transactionId));
                if (idx !== -1) {
                    transactions[idx] = { ...transactions[idx], ...updatedData };
                }
                return true;
            })
            .catch((error) => {
                console.error('Erreur lors de la complétion:', error);
                switchToLocalMode(error);
                showNotification('Synchronisation indisponible. Mise a jour locale.', 'error');
                // Fallback : mettre à jour localement
                const transactionIndex = transactions.findIndex(t => String(t.id) === String(transactionId));
                if (transactionIndex !== -1) {
                    transactions[transactionIndex].amount = newAmount;
                    transactions[transactionIndex].remainingAmount = updatedData.remainingAmount;
                    transactions[transactionIndex].payments = updatedData.payments;
                    saveTransactions();
                    return true;
                }
                return false;
            });
    } else {
        // Mettre à jour localement
        const transactionIndex = transactions.findIndex(t => String(t.id) === String(transactionId));
        if (transactionIndex !== -1) {
            transactions[transactionIndex].amount = newAmount;
            transactions[transactionIndex].remainingAmount = updatedData.remainingAmount;
            transactions[transactionIndex].payments = updatedData.payments;
            saveTransactions();
            return true;
        }
        return false;
    }
}

// Fermer le modal d'édition
function closeEditModal() {
    const modal = document.getElementById('editModal');
    modal.style.display = 'none';
    editingTransactionId = null;
    
    // Réinitialiser le formulaire
    document.getElementById('editForm').reset();
    const editRemainingGroup = document.getElementById('editRemainingGroup');
    if (editRemainingGroup) editRemainingGroup.style.display = 'none';
    const editCategoryGroup = document.getElementById('editCategoryGroup');
    if (editCategoryGroup) editCategoryGroup.style.display = '';
    fillCategorySelect(document.getElementById('editCategory'));
    document.querySelectorAll('#editForm .error-message').forEach(el => el.textContent = '');
    document.querySelectorAll('#editForm input').forEach(el => el.classList.remove('error', 'valid'));
    document.getElementById('editDescriptionCounter').textContent = '0';
    document.getElementById('editDescriptionCounter').parentElement.classList.remove('warning', 'danger');
}

// Modifier une transaction (remainingAmountParam = valeur du champ "Restant à payer", optionnel)
function updateTransaction(id, amount, description, date, remainingAmountParam = undefined, invoiceClient = undefined, invoiceClientId = undefined, category = undefined) {
    const originalTransaction = transactions.find(t => String(t.id) === String(id));
    if (!originalTransaction) {
        showNotification('Transaction non trouvée', 'error');
        return false;
    }
    
    const newAmount = parseFloat(amount);
    const updatedData = {
        amount: newAmount,
        description: description.trim(),
        date: new Date(date).toISOString()
    };
    
    // Restant à payer : si fourni par le formulaire (édition paiement partiel)
    if (remainingAmountParam !== undefined) {
        const val = remainingAmountParam === '' || remainingAmountParam === null ? 0 : parseFloat(remainingAmountParam);
        updatedData.remainingAmount = (val === 0 || isNaN(val)) ? null : val;
    } else {
        updatedData.remainingAmount = originalTransaction.remainingAmount ?? null;
    }
    
    // À l'édition : un seul encaissement = montant + date du formulaire (on ne garde pas les anciens compléments pour la recette du jour)
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
    
    if (useFirebase && db) {
        // Mettre à jour dans Firestore
        return db.collection('transactions').doc(String(id)).update(updatedData)
            .then(() => {
                console.log('Transaction mise à jour dans Firebase');
                // Mettre à jour le tableau local tout de suite pour que recette du jour / période et graphiques se rafraîchissent
                const idx = transactions.findIndex(t => String(t.id) === String(id));
                if (idx !== -1) {
                    transactions[idx] = { ...transactions[idx], ...updatedData };
                }
                return true;
            })
            .catch((error) => {
                console.error('Erreur lors de la mise à jour:', error);
                switchToLocalMode(error);
                showNotification('Synchronisation indisponible. Mise a jour locale.', 'error');
                // Fallback : mettre à jour localement
                const transactionIndex = transactions.findIndex(t => String(t.id) === String(id));
                if (transactionIndex !== -1) {
                    transactions[transactionIndex] = {
                        ...transactions[transactionIndex],
                        ...updatedData
                    };
                    saveTransactions();
                    return true;
                }
                return false;
            });
    } else {
        // Mettre à jour localement
        const transactionIndex = transactions.findIndex(t => String(t.id) === String(id));
        if (transactionIndex === -1) return Promise.resolve(false);
        
        transactions[transactionIndex] = {
            ...transactions[transactionIndex],
            ...updatedData
        };
        
        saveTransactions();
        return Promise.resolve(true);
    }
}

// Fonction pour initialiser tous les event listeners
function attachEventListeners() {
    // Vérifier que les éléments existent
    const incomeAmount = document.getElementById('incomeAmount');
    const incomeDescription = document.getElementById('incomeDescription');
    const incomeDate = document.getElementById('incomeDate');
    const incomeForm = document.getElementById('incomeForm');
    const paymentComplete = document.getElementById('paymentComplete');
    const paymentPartial = document.getElementById('paymentPartial');
    const remainingAmountGroup = document.getElementById('remainingAmountGroup');
    const remainingAmount = document.getElementById('remainingAmount');
    const expenseAmount = document.getElementById('expenseAmount');
    const expenseDescription = document.getElementById('expenseDescription');
    const expenseDate = document.getElementById('expenseDate');
    const expenseForm = document.getElementById('expenseForm');
    const expensePaymentComplete = document.getElementById('expensePaymentComplete');
    const expensePaymentPartial = document.getElementById('expensePaymentPartial');
    const expenseRemainingAmountGroup = document.getElementById('expenseRemainingAmountGroup');
    const expenseRemainingAmount = document.getElementById('expenseRemainingAmount');
    const searchInput = document.getElementById('searchInput');
    const singleDateInput = document.getElementById('singleDate');
    const dateFromInput = document.getElementById('dateFrom');
    const dateToInput = document.getElementById('dateTo');
    const editModal = document.getElementById('editModal');
    const editForm = document.getElementById('editForm');
    
    if (!incomeAmount || !incomeForm || !expenseForm) {
        console.warn('Certains éléments du formulaire ne sont pas trouvés', {
            incomeAmount: !!incomeAmount,
            incomeForm: !!incomeForm,
            expenseForm: !!expenseForm
        });
        // Réessayer après un court délai si les éléments ne sont pas encore chargés
        setTimeout(() => {
            if (document.getElementById('incomeForm') && document.getElementById('expenseForm')) {
                attachEventListeners();
            }
        }, 100);
        return;
    }
    
    console.log('Event listeners attachés avec succès');

    // Onglets Transactions / Statistiques / Notes / Paramètres
    document.querySelectorAll('.main-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab');
            sessionStorage.setItem('kaayprint_active_tab', target);
            applyActiveTab(target);
        });
    });

    initAppSidebar();

    // Bénéfices : mise à jour quand on change les dates
    const benefitDayDate = document.getElementById('benefitDayDate');
    const benefitPeriodFrom = document.getElementById('benefitPeriodFrom');
    const benefitPeriodTo = document.getElementById('benefitPeriodTo');
    if (benefitDayDate) {
        benefitDayDate.addEventListener('change', updateBenefitDisplays);
        benefitDayDate.addEventListener('input', updateBenefitDisplays);
    }
    function refreshChartsAndBenefit() {
        updateChartsFilterPeriodLabel();
        updateBenefitDisplays();
        refreshAllCharts();
    }
    if (benefitPeriodFrom) {
        benefitPeriodFrom.addEventListener('change', refreshChartsAndBenefit);
        benefitPeriodFrom.addEventListener('input', refreshChartsAndBenefit);
    }
    if (benefitPeriodTo) {
        benefitPeriodTo.addEventListener('change', refreshChartsAndBenefit);
        benefitPeriodTo.addEventListener('input', refreshChartsAndBenefit);
    }

    var chartResizeTimer = null;
    window.addEventListener('resize', function () {
        if (chartResizeTimer) clearTimeout(chartResizeTimer);
        chartResizeTimer = setTimeout(function () {
            refreshAllCharts();
        }, 150);
    });

    // Carte Bénéfice : bascule Par jour / Par période
    const benefitModeDay = document.getElementById('benefitModeDay');
    const benefitModePeriod = document.getElementById('benefitModePeriod');
    const benefitDayBlock = document.getElementById('benefitDayBlock');
    const benefitPeriodBlock = document.getElementById('benefitPeriodBlock');
    const benefitCardPeriodFrom = document.getElementById('benefitCardPeriodFrom');
    const benefitCardPeriodTo = document.getElementById('benefitCardPeriodTo');
    if (benefitModeDay && benefitModePeriod && benefitDayBlock && benefitPeriodBlock) {
        benefitModeDay.addEventListener('change', function() {
            benefitDayBlock.style.display = '';
            benefitPeriodBlock.style.display = 'none';
            updateBenefitDisplays();
        });
        benefitModePeriod.addEventListener('change', function() {
            benefitDayBlock.style.display = 'none';
            benefitPeriodBlock.style.display = '';
            if (benefitCardPeriodFrom && benefitCardPeriodTo && !benefitCardPeriodFrom.value && !benefitCardPeriodTo.value) {
                const today = new Date();
                benefitCardPeriodFrom.value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-01';
                benefitCardPeriodTo.value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
            }
            updateBenefitDisplays();
        });
    }
    if (benefitCardPeriodFrom) {
        benefitCardPeriodFrom.addEventListener('change', updateBenefitDisplays);
        benefitCardPeriodFrom.addEventListener('input', updateBenefitDisplays);
    }
    if (benefitCardPeriodTo) {
        benefitCardPeriodTo.addEventListener('change', updateBenefitDisplays);
        benefitCardPeriodTo.addEventListener('input', updateBenefitDisplays);
    }
    
    // Validation en temps réel pour le formulaire d'entrant
    incomeAmount.addEventListener('blur', () => {
        const allowZero = paymentPartial && paymentPartial.checked;
        validateAmount(incomeAmount.value, 'incomeAmountError', allowZero);
    });

    incomeAmount.addEventListener('input', (e) => {
        const value = e.target.value.replace(/\s/g, '');
        if (value !== e.target.value) e.target.value = value;
        const amount = e.target.value;
        const allowZero = paymentPartial && paymentPartial.checked;
        if (amount !== '' || allowZero) {
            validateAmount(amount, 'incomeAmountError', allowZero);
        } else {
            document.getElementById('incomeAmountError').textContent = '';
            incomeAmount.classList.remove('error', 'valid');
        }
    });

    incomeDescription.addEventListener('blur', () => {
        validateDescription(incomeDescription.value, 'incomeDescriptionError');
    });

    incomeDescription.addEventListener('input', (e) => {
        const desc = e.target.value;
        // Mettre à jour le compteur en temps réel
        const counter = document.getElementById('incomeDescriptionCounter');
        if (counter) {
            counter.textContent = desc.length;
            counter.parentElement.classList.remove('warning', 'danger');
            if (desc.length > 450) {
                counter.parentElement.classList.add('danger');
            } else if (desc.length > 400) {
                counter.parentElement.classList.add('warning');
            }
        }
        
        if (desc.trim().length >= 3) {
            validateDescription(desc, 'incomeDescriptionError');
        } else {
            document.getElementById('incomeDescriptionError').textContent = '';
            incomeDescription.classList.remove('error', 'valid');
        }
    });

    incomeDate.addEventListener('change', () => {
        validateDate(incomeDate.value, 'incomeDateError');
    });

    // Gestion du type de paiement (complet/partiel)
    if (paymentComplete && paymentPartial && remainingAmountGroup) {
        paymentComplete.addEventListener('change', () => {
            if (paymentComplete.checked) {
                remainingAmountGroup.style.display = 'none';
                remainingAmount.value = '';
                remainingAmount.removeAttribute('required');
                incomeAmount.setAttribute('required', 'required');
                validateAmount(incomeAmount.value, 'incomeAmountError', false);
            }
        });

        paymentPartial.addEventListener('change', () => {
            if (paymentPartial.checked) {
                remainingAmountGroup.style.display = 'block';
                remainingAmount.setAttribute('required', 'required');
                incomeAmount.removeAttribute('required');
                validateAmount(incomeAmount.value, 'incomeAmountError', true);
            }
        });
    }

    // Gestion du formulaire d'entrant
    let isSubmittingIncome = false;
    incomeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        // Protection contre les doubles soumissions
        if (isSubmittingIncome) {
            return;
        }
        
        const amount = incomeAmount.value;
        const description = incomeDescription.value;
        let date = incomeDate.value;
        
        const isPartialIncome = paymentPartial && paymentPartial.checked;
        const remainingVal = remainingAmount ? parseFloat(String(remainingAmount.value).replace(',', '.')) : 0;
        const isDebt = isPartialIncome && !isNaN(remainingVal) && remainingVal > 0 && (!amount || parseFloat(String(amount).replace(',', '.')) === 0);
        
        // Montant : refuser 0 si paiement complet, accepter 0 si paiement partiel (dette)
        const isAmountValid = validateAmount(amount, 'incomeAmountError', isPartialIncome);
        const isDescriptionValid = validateDescription(description, 'incomeDescriptionError');
        const isDateValid = validateDate(date, 'incomeDateError');
        
        let isRemainingValid = true;
        if (isPartialIncome && remainingAmount) {
            const r = remainingVal;
            const errEl = document.getElementById('remainingAmountError');
            if (isNaN(r) || r <= 0) {
                if (errEl) errEl.textContent = 'Le restant doit être un montant supérieur à 0';
                if (remainingAmount) remainingAmount.classList.add('error');
                isRemainingValid = false;
            } else {
                if (errEl) errEl.textContent = '';
                if (remainingAmount) remainingAmount.classList.remove('error');
            }
        }
        
        if (!isAmountValid || !isDescriptionValid || !isDateValid || !isRemainingValid) {
            showNotification('Veuillez corriger les erreurs dans le formulaire', 'error');
            return;
        }
        
        // Bloquer le bouton pendant le traitement
        isSubmittingIncome = true;
        const submitBtn = document.querySelector('#incomeForm button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Ajout en cours...';
        
        // Si la date n'est pas remplie, utiliser la date/heure actuelle
        if (!date) {
            date = new Date().toISOString().slice(0, 16);
        }
        
        const paymentType = paymentPartial && paymentPartial.checked ? 'partial' : 'complete';
        const remaining = paymentType === 'partial' && remainingAmount ? remainingAmount.value : null;
        const amountToAdd = isDebt ? '0' : amount;
        const category = getCategorySelectionFromControl('incomeCategory');
        
        const wasNewIncomeClient = wasNewInvoiceClientFromControl('incomeInvoiceClient');
        const incomeInvoiceClientSel = getInvoiceClientSelectionFromControl('incomeInvoiceClient');
        Promise.all([
            resolveInvoiceClientSelectionForTransaction(incomeInvoiceClientSel, 'autre'),
            ensureCategorySaved(category)
        ]).then(function (results) {
            const resolvedClient = results[0];
            const savedCategory = results[1];
            addTransaction('income', amountToAdd, description, date, remaining, resolvedClient.name, resolvedClient.id, savedCategory);
            if (resolvedClient.name) {
                ensureClientSavedAndSyncTransactions(resolvedClient.name, 'autre').then(function (client) {
                    if (wasNewIncomeClient && client) addClientProfileReminder(client.name);
                });
            }

            document.getElementById('incomeForm').reset();
            resetClientSelectForm('incomeInvoiceClient');
            resetCategorySelectForm('incomeCategory');
            document.getElementById('incomeDate').value = new Date().toISOString().slice(0, 16);
            if (paymentComplete) paymentComplete.checked = true;
            if (remainingAmountGroup) remainingAmountGroup.style.display = 'none';
            if (remainingAmount) remainingAmount.removeAttribute('required');
            if (incomeAmount) incomeAmount.setAttribute('required', 'required');
            document.querySelectorAll('#incomeForm .error-message').forEach(el => el.textContent = '');
            document.querySelectorAll('#incomeForm input').forEach(el => el.classList.remove('error', 'valid'));
            document.getElementById('incomeDescriptionCounter').textContent = '0';
            document.getElementById('incomeDescriptionCounter').parentElement.classList.remove('warning', 'danger');

            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
            isSubmittingIncome = false;
        }).catch(function () {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
            isSubmittingIncome = false;
            showNotification('Erreur lors de l\'enregistrement du contact.', 'error');
        });
    });

    // Validation en temps réel pour le formulaire de sortant
    expenseAmount.addEventListener('blur', () => {
        validateAmount(expenseAmount.value, 'expenseAmountError');
    });

    expenseAmount.addEventListener('input', (e) => {
        // Nettoyer automatiquement les espaces
        const value = e.target.value.replace(/\s/g, '');
        if (value !== e.target.value) {
            e.target.value = value;
        }
        
        const amount = e.target.value;
        if (amount && !isNaN(parseFloat(amount.replace(',', '.'))) && parseFloat(amount.replace(',', '.')) > 0) {
            validateAmount(amount, 'expenseAmountError');
        } else {
            document.getElementById('expenseAmountError').textContent = '';
            expenseAmount.classList.remove('error', 'valid');
        }
    });

    expenseDescription.addEventListener('blur', () => {
        validateDescription(expenseDescription.value, 'expenseDescriptionError');
    });

    expenseDescription.addEventListener('input', (e) => {
        const desc = e.target.value;
        // Mettre à jour le compteur en temps réel
        const counter = document.getElementById('expenseDescriptionCounter');
        if (counter) {
            counter.textContent = desc.length;
            counter.parentElement.classList.remove('warning', 'danger');
            if (desc.length > 450) {
                counter.parentElement.classList.add('danger');
            } else if (desc.length > 400) {
                counter.parentElement.classList.add('warning');
            }
        }
        
        if (desc.trim().length >= 3) {
            validateDescription(desc, 'expenseDescriptionError');
        } else {
            document.getElementById('expenseDescriptionError').textContent = '';
            expenseDescription.classList.remove('error', 'valid');
        }
    });

    expenseDate.addEventListener('change', () => {
        validateDate(expenseDate.value, 'expenseDateError');
    });

    // Gestion du type de paiement pour les sortants (complet/partiel)
    if (expensePaymentComplete && expensePaymentPartial && expenseRemainingAmountGroup) {
        expensePaymentComplete.addEventListener('change', () => {
            if (expensePaymentComplete.checked) {
                expenseRemainingAmountGroup.style.display = 'none';
                expenseRemainingAmount.value = '';
                expenseRemainingAmount.removeAttribute('required');
            }
        });

        expensePaymentPartial.addEventListener('change', () => {
            if (expensePaymentPartial.checked) {
                expenseRemainingAmountGroup.style.display = 'block';
                expenseRemainingAmount.setAttribute('required', 'required');
            }
        });
    }

    // Gestion du formulaire de sortant
    let isSubmittingExpense = false;
    expenseForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        // Protection contre les doubles soumissions
        if (isSubmittingExpense) {
            return;
        }
        
        const amount = expenseAmount.value;
        const description = expenseDescription.value;
        let date = expenseDate.value;
    
    // Validation complète avant soumission
    const isAmountValid = validateAmount(amount, 'expenseAmountError');
    const isDescriptionValid = validateDescription(description, 'expenseDescriptionError');
    const isDateValid = validateDate(date, 'expenseDateError');
    
    // Si paiement partiel, valider le restant > 0
    const isPartialExpense = expensePaymentPartial && expensePaymentPartial.checked;
    let isExpenseRemainingValid = true;
    if (isPartialExpense && expenseRemainingAmount) {
        const r = parseFloat(String(expenseRemainingAmount.value).replace(',', '.'));
        const errEl = document.getElementById('expenseRemainingAmountError');
        if (isNaN(r) || r <= 0) {
            if (errEl) errEl.textContent = 'Le restant doit être un montant supérieur à 0';
            if (expenseRemainingAmount) expenseRemainingAmount.classList.add('error');
            isExpenseRemainingValid = false;
        } else {
            if (errEl) errEl.textContent = '';
            if (expenseRemainingAmount) expenseRemainingAmount.classList.remove('error');
        }
    }
    
    if (!isAmountValid || !isDescriptionValid || !isDateValid || !isExpenseRemainingValid) {
        showNotification('Veuillez corriger les erreurs dans le formulaire', 'error');
        return;
    }
    
    // Bloquer le bouton pendant le traitement
    isSubmittingExpense = true;
    const submitBtn = document.querySelector('#expenseForm button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Ajout en cours...';
    
    // Si la date n'est pas remplie, utiliser la date/heure actuelle
    if (!date) {
        date = new Date().toISOString().slice(0, 16);
    }
    
    // Récupérer le type de paiement et le montant restant
    const paymentType = expensePaymentPartial && expensePaymentPartial.checked ? 'partial' : 'complete';
    const remaining = paymentType === 'partial' && expenseRemainingAmount ? expenseRemainingAmount.value : null;
    
    const wasNewExpenseClient = wasNewInvoiceClientFromControl('expenseInvoiceClient');
    const expenseInvoiceClientSel = getInvoiceClientSelectionFromControl('expenseInvoiceClient');
    resolveInvoiceClientSelectionForTransaction(expenseInvoiceClientSel, 'neant').then(function (resolvedClient) {
        addTransaction('expense', amount, description, date, remaining, resolvedClient.name, resolvedClient.id);
        if (resolvedClient.name) {
            ensureClientSavedAndSyncTransactions(resolvedClient.name, 'neant').then(function (client) {
                if (wasNewExpenseClient && client) addClientProfileReminder(client.name);
            });
        }

        document.getElementById('expenseForm').reset();
        resetClientSelectForm('expenseInvoiceClient');
        document.getElementById('expenseDate').value = new Date().toISOString().slice(0, 16);
        if (expensePaymentComplete) expensePaymentComplete.checked = true;
        if (expenseRemainingAmountGroup) expenseRemainingAmountGroup.style.display = 'none';
        if (expenseRemainingAmount) expenseRemainingAmount.removeAttribute('required');
        document.querySelectorAll('#expenseForm .error-message').forEach(el => el.textContent = '');
        document.querySelectorAll('#expenseForm input').forEach(el => el.classList.remove('error', 'valid'));
        document.getElementById('expenseDescriptionCounter').textContent = '0';
        document.getElementById('expenseDescriptionCounter').parentElement.classList.remove('warning', 'danger');

        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        isSubmittingExpense = false;
    }).catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        isSubmittingExpense = false;
        showNotification('Erreur lors de l\'enregistrement du contact.', 'error');
    });
    });

    // Gestion des filtres par type
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const filter = btn.getAttribute('data-filter');
            currentPage = 1; // Réinitialiser à la première page lors d'un changement de filtre
            displayTransactions(filter);
        });
    });

    // Gestion de la recherche par mot-clé
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchKeyword = e.target.value;
            currentPage = 1; // Réinitialiser à la première page lors d'une recherche
            displayTransactions(currentFilter);
        });
    }

    // Gestion du filtre par jour unique
    if (singleDateInput) {
        singleDateInput.addEventListener('change', (e) => {
            singleDate = e.target.value;
            // Si un jour unique est sélectionné, vider les champs de plage
            if (singleDate) {
                if (dateFromInput) dateFromInput.value = '';
                if (dateToInput) dateToInput.value = '';
                dateFrom = '';
                dateTo = '';
            }
            currentPage = 1; // Réinitialiser à la première page
            displayTransactions(currentFilter);
        });
    }

    // Gestion des filtres par date (plage)
    if (dateFromInput) {
        dateFromInput.addEventListener('change', (e) => {
            dateFrom = e.target.value;
            // Si une plage est utilisée, vider le champ jour unique
            if (dateFrom || dateTo) {
                if (singleDateInput) singleDateInput.value = '';
                singleDate = '';
            }
            currentPage = 1; // Réinitialiser à la première page
            displayTransactions(currentFilter);
        });
    }

    if (dateToInput) {
        dateToInput.addEventListener('change', (e) => {
            dateTo = e.target.value;
            // Si une plage est utilisée, vider le champ jour unique
            if (dateFrom || dateTo) {
                if (singleDateInput) singleDateInput.value = '';
                singleDate = '';
            }
            currentPage = 1; // Réinitialiser à la première page
            displayTransactions(currentFilter);
        });
    }

    // Gestion du formulaire de complément
    const completeForm = document.getElementById('completeForm');
    if (completeForm) {
        completeForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            if (!completingTransactionId) return;
            
            const completeAmount = document.getElementById('completeAmount').value;
            let date = document.getElementById('completeDate').value;
            
            // Date optionnelle : défaut = maintenant (pour recette du jour correcte)
            if (!date) date = new Date().toISOString().slice(0, 16);
            
            const isAmountValid = validateAmount(completeAmount, 'completeAmountError');
            const isDateValid = validateDate(date, 'completeDateError');
            
            if (!isAmountValid || !isDateValid) {
                showNotification('Veuillez corriger les erreurs dans le formulaire', 'error');
                return;
            }
            
            const transaction = transactions.find(t => String(t.id) === String(completingTransactionId));
            if (transaction && parseFloat(completeAmount) > transaction.remainingAmount) {
                document.getElementById('completeAmountError').textContent = `Le montant ne peut pas dépasser ${formatAmount(transaction.remainingAmount)}`;
                document.getElementById('completeAmount').classList.add('error');
                return;
            }
            
            // Compléter la transaction
            const completeResult = completeTransaction(completingTransactionId, completeAmount, date);
            Promise.resolve(completeResult).then((success) => {
                if (success) {
                    updateBenefitDisplays();
                    refreshAllCharts();
                    closeCompleteModal();
                } else {
                    showNotification('Erreur lors de la complétion', 'error');
                }
            });
        });
    }

    // Gestion du formulaire d'édition
    if (editForm) {
        editForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            if (!editingTransactionId) return;
            
            const amount = document.getElementById('editAmount').value;
            const description = document.getElementById('editDescription').value;
            const date = document.getElementById('editDate').value;
            const editRemainingGroup = document.getElementById('editRemainingGroup');
            const editRemainingAmount = document.getElementById('editRemainingAmount');
            const isPartialEdit = editRemainingGroup && editRemainingGroup.style.display !== 'none' && editRemainingAmount;
            const remainingValue = isPartialEdit ? editRemainingAmount.value : undefined;
            
            const isAmountValid = validateAmount(amount, 'editAmountError', isPartialEdit);
            const isDescriptionValid = validateDescription(description, 'editDescriptionError');
            const isDateValid = validateDate(date, 'editDateError');
            let isRemainingValid = true;
            if (isPartialEdit && remainingValue !== '' && remainingValue != null) {
                const r = parseFloat(remainingValue.replace(',', '.'));
                const errEl = document.getElementById('editRemainingError');
                if (isNaN(r) || r < 0) {
                    if (errEl) errEl.textContent = 'Le restant doit être un nombre ≥ 0';
                    if (editRemainingAmount) editRemainingAmount.classList.add('error');
                    isRemainingValid = false;
                } else {
                    if (errEl) errEl.textContent = '';
                    if (editRemainingAmount) editRemainingAmount.classList.remove('error');
                }
            }
            
            if (!isAmountValid || !isDescriptionValid || !isDateValid || !isRemainingValid) {
                showNotification('Veuillez corriger les erreurs dans le formulaire', 'error');
                return;
            }
            
            const wasNewEditClient = wasNewInvoiceClientFromControl('editInvoiceClient');
            const editInvoiceClientSel = getInvoiceClientSelectionFromControl('editInvoiceClient');
            const editingTx = transactions.find(function (t) { return String(t.id) === String(editingTransactionId); });
            const editDefaultProvenance = editingTx && editingTx.type === 'expense' ? 'neant' : 'autre';
            const editCategory = getCategorySelectionFromControl('editCategory');
            Promise.all([
                resolveInvoiceClientSelectionForTransaction(editInvoiceClientSel, editDefaultProvenance),
                ensureCategorySaved(editCategory)
            ]).then(function (results) {
                const resolvedClient = results[0];
                const savedCategory = results[1];
                const result = updateTransaction(
                    editingTransactionId,
                    amount,
                    description,
                    date,
                    remainingValue,
                    resolvedClient.name,
                    resolvedClient.id,
                    savedCategory
                );
                if (resolvedClient.name) {
                    ensureClientSavedAndSyncTransactions(resolvedClient.name, editDefaultProvenance).then(function (client) {
                        if (wasNewEditClient && client) addClientProfileReminder(client.name);
                    });
                }
                Promise.resolve(result).then((success) => {
                    if (success === true || (success && success.ok)) {
                        updateBenefitDisplays();
                        refreshAllCharts();
                        closeEditModal();
                        showNotification('Transaction modifiée avec succès !', 'success');
                    } else if (!(success && success.notified)) {
                        showNotification('Erreur lors de la modification', 'error');
                    }
                });
            }).catch(function () {
                showNotification('Erreur lors de l\'enregistrement du contact.', 'error');
            });
        });

        // Validation en temps réel pour le formulaire d'édition
        const editAmount = document.getElementById('editAmount');
        const editDescription = document.getElementById('editDescription');
        const editDate = document.getElementById('editDate');
        
        if (editAmount) {
            editAmount.addEventListener('blur', () => {
                const editRemainingGroupEl = document.getElementById('editRemainingGroup');
                const allowZero = editRemainingGroupEl && editRemainingGroupEl.style.display !== 'none';
                validateAmount(editAmount.value, 'editAmountError', allowZero);
            });

            editAmount.addEventListener('input', (e) => {
                const value = e.target.value.replace(/\s/g, '');
                if (value !== e.target.value) e.target.value = value;
                const amount = e.target.value;
                const editRemainingGroupEl = document.getElementById('editRemainingGroup');
                const allowZero = editRemainingGroupEl && editRemainingGroupEl.style.display !== 'none';
                if (amount !== '' || allowZero) {
                    validateAmount(amount, 'editAmountError', allowZero);
                } else {
                    document.getElementById('editAmountError').textContent = '';
                    editAmount.classList.remove('error', 'valid');
                }
            });
        }

        if (editDescription) {
            editDescription.addEventListener('blur', () => {
                validateDescription(editDescription.value, 'editDescriptionError');
            });

            editDescription.addEventListener('input', (e) => {
                const desc = e.target.value;
                const counter = document.getElementById('editDescriptionCounter');
                if (counter) {
                    counter.textContent = desc.length;
                    counter.parentElement.classList.remove('warning', 'danger');
                    if (desc.length > 180) {
                        counter.parentElement.classList.add('danger');
                    } else if (desc.length > 150) {
                        counter.parentElement.classList.add('warning');
                    }
                }
                if (desc.trim().length >= 3) {
                    validateDescription(desc, 'editDescriptionError');
                } else {
                    document.getElementById('editDescriptionError').textContent = '';
                    editDescription.classList.remove('error', 'valid');
                }
            });
        }

        if (editDate) {
            editDate.addEventListener('change', () => {
                validateDate(editDate.value, 'editDateError');
            });
        }
    }

    // Fermer le modal en cliquant en dehors
    if (editModal) {
        editModal.addEventListener('click', (e) => {
            if (e.target.id === 'editModal') {
                closeEditModal();
            }
        });
    }
    const invoiceModalEl = document.getElementById('invoiceModal');
    if (invoiceModalEl) {
        invoiceModalEl.addEventListener('click', (e) => {
            if (e.target.id === 'invoiceModal') {
                closeInvoiceModal();
            }
        });
    }

    // Fermer le modal facture avec Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const inv = document.getElementById('invoiceModal');
            if (inv && inv.style.display === 'flex') {
                closeInvoiceModal();
            }
        }
    });

    // Initialiser les dates à aujourd'hui
    if (incomeDate) {
        incomeDate.value = new Date().toISOString().slice(0, 16);
    }
    if (expenseDate) {
        expenseDate.value = new Date().toISOString().slice(0, 16);
    }
    
    // Initialiser les compteurs de caractères
    const incomeCounter = document.getElementById('incomeDescriptionCounter');
    const expenseCounter = document.getElementById('expenseDescriptionCounter');
    if (incomeCounter) {
        incomeCounter.textContent = '0';
    }
    if (expenseCounter) {
        expenseCounter.textContent = '0';
    }
}

// Fonction de notification (optionnelle, pour améliorer l'UX)
function isTransientConcurrencyMessage(message) {
    if (!message) return false;
    const text = String(message).toLowerCase();
    return text.indexOf('en train de modifier') !== -1
        || text.indexOf('modifié cette donnée') !== -1
        || text.indexOf('modifie cette donnée') !== -1
        || text.indexOf('rechargez avant') !== -1
        || text.indexOf('rechargez la page') !== -1
        || text.indexOf('changé sur le serveur') !== -1;
}

// showNotification est défini dans xaliss-flash.js (chargé avant ce fichier).

// Fonction d'export en Excel
function exportToExcel() {
    // Utiliser les transactions filtrées au lieu de toutes les transactions
    const transactionsToExport = getFilteredTransactions();
    
    if (transactionsToExport.length === 0) {
        showNotification('Aucune transaction à exporter', 'error');
        return;
    }
    
    // Créer le contenu HTML pour Excel (format table)
    let htmlContent = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
            <meta charset="utf-8">
            <!--[if gte mso 9]>
            <xml>
                <x:ExcelWorkbook>
                    <x:ExcelWorksheets>
                        <x:ExcelWorksheet>
                            <x:Name>Transactions</x:Name>
                            <x:WorksheetOptions>
                                <x:DefaultRowHeight>315</x:DefaultRowHeight>
                            </x:WorksheetOptions>
                        </x:ExcelWorksheet>
                    </x:ExcelWorksheets>
                </x:ExcelWorkbook>
            </xml>
            <![endif]-->
            <style>
                table { border-collapse: collapse; width: 100%; }
                th { background-color: #43277d; color: white; font-weight: bold; padding: 10px; text-align: left; border: 1px solid #341d5f; }
                td { padding: 8px; border: 1px solid #ddd; }
                tr:nth-child(even) { background-color: #f9fafb; }
                .income { color: #10b981; }
                .expense { color: #ef4444; }
            </style>
        </head>
        <body>
            <table>
                <thead>
                    <tr>
                        <th>N°</th>
                        <th>Type</th>
                        <th>Description</th>
                        <th>Montant (${getCurrencyLabel()})</th>
                        <th>Date</th>
                        <th>Heure</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    // Trier les transactions par date (plus récent en premier)
    const sortedTransactions = [...transactionsToExport].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    sortedTransactions.forEach((transaction, index) => {
        const type = transaction.type === 'income' ? 'Entrant' : 'Sortant';
        const typeClass = transaction.type === 'income' ? 'income' : 'expense';
        const description = transaction.description.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const amount = formatAmount(transaction.amount);
        const transactionDate = new Date(transaction.date);
        const date = transactionDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const time = transactionDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        
        htmlContent += `
            <tr>
                <td>${sortedTransactions.length - index}</td>
                <td class="${typeClass}">${type}</td>
                <td>${description}</td>
                <td class="${typeClass}">${amount}</td>
                <td>${date}</td>
                <td>${time}</td>
            </tr>
        `;
    });
    
    // Calculer les totaux basés sur les transactions filtrées
    const totalIncome = transactionsToExport.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
    const totalExpense = transactionsToExport.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    const balance = totalIncome - totalExpense;
    const incomeCount = transactionsToExport.filter(t => t.type === 'income').length;
    const expenseCount = transactionsToExport.filter(t => t.type === 'expense').length;
    const totalCount = transactionsToExport.length;
    const avgIncome = incomeCount > 0 ? totalIncome / incomeCount : 0;
    const avgExpense = expenseCount > 0 ? totalExpense / expenseCount : 0;
    
    // Dates min et max basées sur les transactions filtrées
    const dates = transactionsToExport.map(t => new Date(t.date));
    const minDate = dates.length > 0 ? new Date(Math.min(...dates)).toLocaleDateString('fr-FR') : 'N/A';
    const maxDate = dates.length > 0 ? new Date(Math.max(...dates)).toLocaleDateString('fr-FR') : 'N/A';
    const exportDate = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    
    htmlContent += `
                </tbody>
                <tfoot>
                    <tr style="background-color: #e5e7eb; font-weight: bold; font-size: 1.1em;">
                        <td colspan="6" style="text-align: center; padding: 15px;">RÉSUMÉ FINANCIER</td>
                    </tr>
                    <tr style="background-color: #f3f4f6; font-weight: bold;">
                        <td colspan="2">Nombre total de transactions</td>
                        <td colspan="4">${totalCount}</td>
                    </tr>
                    <tr style="background-color: #f3f4f6;">
                        <td colspan="2">Nombre d'entrants</td>
                        <td colspan="4">${incomeCount}</td>
                    </tr>
                    <tr style="background-color: #f3f4f6;">
                        <td colspan="2">Nombre de sortants</td>
                        <td colspan="4">${expenseCount}</td>
                    </tr>
                    <tr style="background-color: #f3f4f6; font-weight: bold;">
                        <td colspan="2">Total Entrants</td>
                        <td class="income" colspan="4">${formatAmount(totalIncome)}</td>
                    </tr>
                    <tr style="background-color: #f3f4f6; font-weight: bold;">
                        <td colspan="2">Total Sortants</td>
                        <td class="expense" colspan="4">${formatAmount(totalExpense)}</td>
                    </tr>
                    <tr style="background-color: #43277d; color: white; font-weight: bold; font-size: 1.1em;">
                        <td colspan="2">Recette Actuelle (Bénéfice)</td>
                        <td style="color: white;" colspan="4">${formatAmount(balance)}</td>
                    </tr>
                    <tr style="background-color: #f9fafb;">
                        <td colspan="2">Moyenne par entrant</td>
                        <td class="income" colspan="4">${formatAmount(avgIncome)}</td>
                    </tr>
                    <tr style="background-color: #f9fafb;">
                        <td colspan="2">Moyenne par sortant</td>
                        <td class="expense" colspan="4">${formatAmount(avgExpense)}</td>
                    </tr>
                    <tr style="background-color: #e5e7eb;">
                        <td colspan="2">Période couverte</td>
                        <td colspan="4">Du ${minDate} au ${maxDate}</td>
                    </tr>
                    <tr style="background-color: #e5e7eb;">
                        <td colspan="2">Date d'export</td>
                        <td colspan="4">${exportDate}</td>
                    </tr>
                </tfoot>
            </table>
        </body>
        </html>
    `;
    
    // Créer le fichier et le télécharger
    const blob = new Blob([htmlContent], { type: 'application/vnd.ms-excel' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `kaayprint_transactions_${dateStr}.xls`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
}

// Fonction d'export en PDF
function exportToPDF() {
    // Utiliser les transactions filtrées au lieu de toutes les transactions
    const transactionsToExport = getFilteredTransactions();
    
    if (transactionsToExport.length === 0) {
        showNotification('Aucune transaction à exporter', 'error');
        return;
    }
    
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        
        // Couleurs
        const violet = [67, 39, 125];
        const violetDark = [52, 29, 95];
        const green = [16, 185, 129];
        const red = [239, 68, 68];
        const gray = [249, 250, 251];
        const darkGray = [229, 231, 235];
        
        let yPos = 20;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 15;
        const contentWidth = pageWidth - (margin * 2);
        
        // En-tête avec logo
        doc.setFillColor(...violet);
        doc.rect(0, 0, pageWidth, 45, 'F');
        
        // Titre
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('Xaliss', margin, 15);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        doc.text('Rapport Financier', margin, 22);
        
        // Date d'export
        doc.setFontSize(9);
        const exportDate = new Date().toLocaleDateString('fr-FR', { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        doc.text(`Exporté le : ${exportDate}`, margin, 30);
        
        // Essayer d'ajouter le logo (optionnel, ne bloque pas si erreur)
        try {
            const logoImg = new Image();
            logoImg.crossOrigin = 'anonymous';
            logoImg.src = 'images/logo.png';
            
            logoImg.onload = function() {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = logoImg.width;
                    canvas.height = logoImg.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(logoImg, 0, 0);
                    const logoData = canvas.toDataURL('image/png');
                    
                    const logoWidth = 30;
                    const logoHeight = (logoImg.height / logoImg.width) * logoWidth;
                    const logoX = pageWidth - margin - logoWidth;
                    const logoY = 7;
                    
                    doc.addImage(logoData, 'PNG', logoX, logoY, logoWidth, logoHeight);
                } catch (e) {
                    console.log('Logo non ajouté:', e);
                }
            };
            
            logoImg.onerror = function() {
                console.log('Logo non chargé');
            };
        } catch (e) {
            console.log('Erreur logo:', e);
        }
        
        yPos = 50;
        
        // Statistiques en haut (basées sur les transactions filtrées)
        const totalIncome = transactionsToExport.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
        const totalExpense = transactionsToExport.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
        const balance = totalIncome - totalExpense;
        const incomeCount = transactionsToExport.filter(t => t.type === 'income').length;
        const expenseCount = transactionsToExport.filter(t => t.type === 'expense').length;
        const totalCount = transactionsToExport.length;
        
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Résumé Financier', margin, yPos);
        yPos += 10;
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setFillColor(...gray);
        doc.rect(margin, yPos - 5, contentWidth, 8, 'F');
        doc.text(`Nombre total de transactions : ${totalCount}`, margin + 2, yPos);
        yPos += 8;
        
        doc.setFillColor(...gray);
        doc.rect(margin, yPos - 5, contentWidth, 8, 'F');
        doc.text(`Entrants : ${incomeCount} | Sortants : ${expenseCount}`, margin + 2, yPos);
        yPos += 10;
        
        // Totaux
        doc.setFont('helvetica', 'bold');
        doc.setFillColor(...green);
        doc.rect(margin, yPos - 5, contentWidth / 2 - 2, 8, 'F');
        doc.setTextColor(255, 255, 255);
        doc.text(`Total Entrants : ${formatAmount(totalIncome)}`, margin + 2, yPos);
        
        doc.setFillColor(...red);
        doc.rect(margin + contentWidth / 2 + 2, yPos - 5, contentWidth / 2 - 2, 8, 'F');
        doc.text(`Total Sortants : ${formatAmount(totalExpense)}`, margin + contentWidth / 2 + 4, yPos);
        yPos += 10;
        
        doc.setFillColor(...violet);
        doc.rect(margin, yPos - 5, contentWidth, 10, 'F');
        doc.setFontSize(12);
        doc.text(`Recette Actuelle : ${formatAmount(balance)}`, margin + 2, yPos + 3);
        yPos += 15;
        
        // Tableau des transactions
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('Détail des Transactions', margin, yPos);
        yPos += 7;
        
        // En-tête du tableau
        doc.setFillColor(...violetDark);
        doc.rect(margin, yPos - 4, contentWidth, 7, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text('N°', margin + 1, yPos);
        doc.text('Type', margin + 8, yPos);
        doc.text('Description', margin + 20, yPos);
        doc.text('Montant', margin + 85, yPos);
        doc.text('Date', margin + 125, yPos);
        doc.text('Heure', margin + 155, yPos);
        yPos += 7;
        
        // Trier les transactions par date (plus récent en premier)
        const sortedTransactions = [...transactionsToExport].sort((a, b) => new Date(b.date) - new Date(a.date));
        
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        
        sortedTransactions.forEach((transaction, index) => {
            // Vérifier si on doit créer une nouvelle page
            if (yPos > pageHeight - 30) {
                doc.addPage();
                yPos = 20;
                // Réafficher l'en-tête du tableau sur la nouvelle page
                doc.setFillColor(...violetDark);
                doc.rect(margin, yPos - 4, contentWidth, 7, 'F');
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(8);
                doc.setFont('helvetica', 'bold');
                doc.text('N°', margin + 1, yPos);
                doc.text('Type', margin + 8, yPos);
                doc.text('Description', margin + 20, yPos);
                doc.text('Montant', margin + 85, yPos);
                doc.text('Date', margin + 125, yPos);
                doc.text('Heure', margin + 155, yPos);
                yPos += 7;
            }
            
            const type = transaction.type === 'income' ? 'Entrant' : 'Sortant';
            const amount = formatAmount(transaction.amount);
            const transactionDate = new Date(transaction.date);
            const date = transactionDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const time = transactionDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            
            // Calculer la hauteur nécessaire pour la description (texte multiligne)
            const descriptionWidth = 85 - 20; // Largeur disponible pour la description (de margin+20 à margin+85)
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            const descriptionLines = doc.splitTextToSize(transaction.description, descriptionWidth);
            const lineHeight = 4; // Hauteur d'une ligne en mm
            const descriptionHeight = descriptionLines.length * lineHeight;
            const rowHeight = Math.max(6, descriptionHeight + 1); // Hauteur minimale de 6mm
            
            // Ligne avec fond alterné
            if (index % 2 === 0) {
                doc.setFillColor(...gray);
                doc.rect(margin, yPos - 4, contentWidth, rowHeight, 'F');
            }
            
            // Couleur selon le type
            if (transaction.type === 'income') {
                doc.setTextColor(...green);
            } else {
                doc.setTextColor(...red);
            }
            
            // Afficher le numéro et le type (centré verticalement)
            const textY = yPos + (rowHeight / 2) - 2;
            doc.text(String(sortedTransactions.length - index), margin + 1, textY);
            doc.text(type, margin + 8, textY);
            
            // Afficher la description (multiligne)
            doc.setTextColor(0, 0, 0);
            doc.text(descriptionLines, margin + 20, yPos + 2);
            
            // Afficher le montant, date et heure (centrés verticalement)
            if (transaction.type === 'income') {
                doc.setTextColor(...green);
            } else {
                doc.setTextColor(...red);
            }
            doc.text(amount, margin + 85, textY);
            
            doc.setTextColor(0, 0, 0);
            doc.text(date, margin + 125, textY);
            doc.text(time, margin + 155, textY);
            
            yPos += rowHeight;
        });
        
        // Pied de page avec statistiques supplémentaires
        if (yPos > pageHeight - 40) {
            doc.addPage();
            yPos = 20;
        }
        
        yPos += 5;
        doc.setFillColor(...darkGray);
        doc.rect(margin, yPos - 4, contentWidth, 7, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.text('Statistiques Complémentaires', margin + 2, yPos);
        yPos += 8;
        
        const avgIncome = incomeCount > 0 ? totalIncome / incomeCount : 0;
        const avgExpense = expenseCount > 0 ? totalExpense / expenseCount : 0;
        const dates = transactionsToExport.map(t => new Date(t.date));
        const minDate = dates.length > 0 ? new Date(Math.min(...dates)).toLocaleDateString('fr-FR') : 'N/A';
        const maxDate = dates.length > 0 ? new Date(Math.max(...dates)).toLocaleDateString('fr-FR') : 'N/A';
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setFillColor(...gray);
        doc.rect(margin, yPos - 4, contentWidth, 6, 'F');
        doc.setTextColor(0, 0, 0);
        doc.text(`Moyenne par entrant : ${formatAmount(avgIncome)}`, margin + 2, yPos);
        yPos += 7;
        
        doc.setFillColor(...gray);
        doc.rect(margin, yPos - 4, contentWidth, 6, 'F');
        doc.text(`Moyenne par sortant : ${formatAmount(avgExpense)}`, margin + 2, yPos);
        yPos += 7;
        
        doc.setFillColor(...gray);
        doc.rect(margin, yPos - 4, contentWidth, 6, 'F');
        doc.text(`Période couverte : Du ${minDate} au ${maxDate}`, margin + 2, yPos);
        
        // Télécharger le PDF
        const dateStr = new Date().toISOString().split('T')[0];
        doc.save(`kaayprint_rapport_${dateStr}.pdf`);
    } catch (error) {
        console.error('Erreur lors de l\'export PDF:', error);
        showNotification('Erreur lors de l\'export PDF', 'error');
    }
}

// S'assurer que la fonction est accessible globalement
window.exportToPDF = exportToPDF;

// Mettre à jour le statut de connexion (badge retiré de l'interface)
function updateConnectionStatus() {}

// Initialiser l'application quand le DOM est prêt
function initApp() {
    if (!window.XALISS_DJANGO) {
        if (sessionStorage.getItem('kaayprint_authenticated') !== 'true') {
            window.location.href = 'index.html';
            return;
        }
    } else {
        sessionStorage.setItem('kaayprint_authenticated', 'true');
        sessionStorage.setItem(
            'kaayprint_username',
            window.XALISS_DJANGO.userEmail || window.XALISS_DJANGO.orgSlug || 'django'
        );
    }

    loadAppSettingsFromStorage();
    syncCurrencyLabelsInUI();

    // Attacher tous les event listeners
    attachEventListeners();

    initCompanyProfileUI();
    initUserProfileUI();
    initNotificationsUI();
    initDeleteConfirmModal();
    initClientsUI();
    initNotesUI();
    updateClientTransactionFilterBar();
    
    // Charger les transactions au démarrage
    if (window.XALISS_DJANGO && typeof window.xalissLoadAllData === 'function') {
        window.xalissLoadAllData();
    } else {
        loadTransactions();
    }

    // Précharger le logo pour la facture (écran + export identiques)
    preloadInvoiceLogo();

    // Onglet actif : URL (?onglet=) prioritaire, puis sessionStorage
    const urlTab = new URLSearchParams(window.location.search).get('onglet');
    if (urlTab === 'statistiques' || urlTab === 'transactions' || urlTab === 'notes' || urlTab === 'parametres') {
        applyActiveTab(urlTab);
        sessionStorage.setItem('kaayprint_active_tab', urlTab);
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('onglet');
        window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    } else {
        const savedTab = sessionStorage.getItem('kaayprint_active_tab');
        if (savedTab === 'statistiques' || savedTab === 'transactions' || savedTab === 'notes' || savedTab === 'parametres') {
            applyActiveTab(savedTab);
        }
    }

    // Date par défaut pour "Bénéfice du jour" = aujourd'hui
    const benefitDayDate = document.getElementById('benefitDayDate');
    if (benefitDayDate && !benefitDayDate.value) {
        const today = new Date();
        benefitDayDate.value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    }
    // Mettre à jour le statut initial
    if (window.XALISS_DJANGO) {
        if (typeof window.refreshOfflineConnectionStatus === 'function') {
            window.refreshOfflineConnectionStatus();
        } else {
            updateConnectionStatus(true);
        }
    } else if (useFirebase) {
        updateConnectionStatus(true);
    } else {
        updateConnectionStatus(false);
    }
    
    // Gestion de la déconnexion
    document.querySelectorAll('.sidebar-logout-btn').forEach(function (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
            showDeleteConfirm({
                title: 'Confirmer la déconnexion',
                message: 'Êtes-vous sûr de vouloir vous déconnecter ?',
                detail: 'Vous devrez vous reconnecter pour accéder à votre espace.',
                confirmLabel: 'Se déconnecter',
                icon: 'logout',
                onConfirm: function () {
                    if (unsubscribeCompanyProfile) {
                        unsubscribeCompanyProfile();
                        unsubscribeCompanyProfile = null;
                    }
                    if (unsubscribeClientList) {
                        unsubscribeClientList();
                        unsubscribeClientList = null;
                    }
                    if (window.XALISS_DJANGO) {
                        sessionStorage.setItem('xaliss_flash_message', JSON.stringify({
                            type: 'success',
                            text: 'Vous êtes déconnecté.',
                            duration: 4500,
                        }));
                        const form = document.getElementById('djangoLogoutForm');
                        if (form) form.submit();
                        return;
                    }
                    sessionStorage.removeItem('kaayprint_authenticated');
                    sessionStorage.removeItem('kaayprint_username');
                    window.location.href = 'index.html';
                }
            });
        });
    });
}

// Attendre que le DOM soit chargé (django-bridge démarre l'app en mode Django)
function scheduleAppBoot() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
}

if (!window.XALISS_DJANGO) {
    scheduleAppBoot();
}

// Mettre à jour automatiquement toutes les 2 minutes
if (window.XALISS_DJANGO) {
    setInterval(() => {
        if (!getAppSettingsAutoRefreshLocal()) return;
        if (typeof window.xalissLoadTransactions === 'function') {
            window.xalissLoadTransactions().catch(function () {
                updateConnectionStatus(false);
            });
        }
    }, 120000);
} else if (!useFirebase) {
    setInterval(() => {
        if (sessionStorage.getItem('kaayprint_authenticated') === 'true') {
            if (!getAppSettingsAutoRefreshLocal()) return;
            loadTransactions();
        }
    }, 120000);
}

