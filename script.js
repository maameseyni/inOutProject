// Configuration Firebase
const firebaseConfig = {
    apiKey: "AIzaSyAJ3HQ5W1ZE7WqVKt8-dcKYtNi4pdVsvYg",
    authDomain: "kaayprintinout.firebaseapp.com",
    projectId: "kaayprintinout",
    storageBucket: "kaayprintinout.firebasestorage.app",
    messagingSenderId: "492068359418",
    appId: "1:492068359418:web:ab174c0802aa9bfc4f8d43"
};

// Initialiser Firebase
let db = null;
let useFirebase = false;

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

// Gestion des transactions
let transactions = [];
let unsubscribeFirestore = null;

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

    useFirebase = false;
    updateConnectionStatus(false);
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
                updateDisplay();
                updateConnectionStatus(true);
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
    updateDisplay();
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

// Formater le montant
function formatAmount(amount) {
    return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'XOF',
        minimumFractionDigits: 0
    }).format(amount).replace('XOF', 'FCFA');
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
    updateChartIncomeVsExpense();
    updateChartBalanceEvolution();
    updateChartTop5Expenses();
    updateChartTop5Income();
    updateChartBenefitByMonth();
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
    updateChartIncomeVsExpense();
    updateChartBalanceEvolution();
    updateChartTop5Expenses();
    updateChartTop5Income();
    updateChartBenefitByMonth();
}

// Appliquer l'onglet actif (Transactions ou Statistiques) — utilisé au clic et au chargement
function applyActiveTab(tabKey) {
    if (tabKey !== 'transactions' && tabKey !== 'statistiques') return;
    document.querySelectorAll('.main-tab').forEach(t => {
        t.classList.toggle('active', t.getAttribute('data-tab') === tabKey);
    });
    document.querySelectorAll('.main-section').forEach(s => {
        s.classList.toggle('active', s.id === 'section-' + tabKey);
    });
    if (tabKey === 'statistiques') {
        updateChartsFilterPeriodLabel();
        updateChartIncomeVsExpense();
        updateChartBalanceEvolution();
        updateChartTop5Expenses();
        updateChartTop5Income();
        updateChartBenefitByMonth();
    }
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
    const canvas = document.getElementById('chartIncomeVsExpense');
    const emptyEl = document.getElementById('chartIncomeVsExpenseEmpty');
    const containerEl = document.getElementById('chartIncomeVsExpenseContainer');
    if (!canvas || typeof Chart === 'undefined') return;
    const { labels, income, expense, countIncome, countExpense } = getMonthlyIncomeExpenseData();
    if (labels.length === 0) {
        if (chartIncomeVsExpense) { chartIncomeVsExpense.destroy(); chartIncomeVsExpense = null; }
        if (emptyEl) emptyEl.classList.add('visible');
        if (containerEl) containerEl.style.display = 'none';
        return;
    }
    if (emptyEl) emptyEl.classList.remove('visible');
    if (containerEl) containerEl.style.display = '';
    if (chartIncomeVsExpense) {
        chartIncomeVsExpense.data.labels = labels;
        chartIncomeVsExpense.data.datasets[0].data = income;
        chartIncomeVsExpense.data.datasets[1].data = expense;
        chartIncomeVsExpense.data.datasets[0].countByMonth = countIncome;
        chartIncomeVsExpense.data.datasets[1].countByMonth = countExpense;
        chartIncomeVsExpense.update('none');
        return;
    }
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
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const amount = context.raw;
                            const count = context.dataset.countByMonth ? context.dataset.countByMonth[context.dataIndex] : 0;
                            const isEntrant = context.datasetIndex === 0;
                            const typeLabel = isEntrant ? 'entrant' : 'sortant';
                            const countLabel = count === 1 ? '1 ' + typeLabel : count + ' ' + typeLabel + 's';
                            return [
                                'Somme : ' + amount.toLocaleString('fr-FR') + ' FCFA',
                                'Nombre : ' + countLabel
                            ];
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value >= 1000 ? (value / 1000) + 'k' : value;
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

// Mise à jour du graphique "Évolution de la recette"
function updateChartBalanceEvolution() {
    const canvas = document.getElementById('chartBalanceEvolution');
    const emptyEl = document.getElementById('chartBalanceEvolutionEmpty');
    const containerEl = document.getElementById('chartBalanceEvolutionContainer');
    if (!canvas || typeof Chart === 'undefined') return;
    const { labels, balance } = getBalanceEvolutionData();
    if (labels.length === 0) {
        if (chartBalanceEvolution) { chartBalanceEvolution.destroy(); chartBalanceEvolution = null; }
        if (emptyEl) emptyEl.classList.add('visible');
        if (containerEl) containerEl.style.display = 'none';
        return;
    }
    if (emptyEl) emptyEl.classList.remove('visible');
    if (containerEl) containerEl.style.display = '';
    if (chartBalanceEvolution) {
        chartBalanceEvolution.data.labels = labels;
        chartBalanceEvolution.data.datasets[0].data = balance;
        chartBalanceEvolution.update('none');
        return;
    }
    chartBalanceEvolution = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Recette (FCFA)',
                data: balance,
                borderColor: '#43277d',
                backgroundColor: 'rgba(67, 39, 125, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' }
            },
            scales: {
                y: {
                    ticks: {
                        callback: function(value) {
                            return value >= 1000 ? (value / 1000) + 'k' : value;
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
    const canvas = document.getElementById('chartBenefitByMonth');
    const emptyEl = document.getElementById('chartBenefitByMonthEmpty');
    const containerEl = document.getElementById('chartBenefitByMonthContainer');
    if (!canvas || typeof Chart === 'undefined') return;
    const { labels, benefits } = getBenefitByMonthData();
    if (labels.length === 0) {
        if (chartBenefitByMonth) { chartBenefitByMonth.destroy(); chartBenefitByMonth = null; }
        if (emptyEl) emptyEl.classList.add('visible');
        if (containerEl) containerEl.style.display = 'none';
        return;
    }
    if (emptyEl) emptyEl.classList.remove('visible');
    if (containerEl) containerEl.style.display = '';
    const colors = benefits.map(b => b >= 0 ? 'rgba(16, 185, 129, 0.7)' : CHART_COLOR_SORTANTS_RGBA);
    const borderColors = benefits.map(b => b >= 0 ? '#10b981' : CHART_COLOR_SORTANTS);
    if (chartBenefitByMonth) {
        chartBenefitByMonth.data.labels = labels;
        chartBenefitByMonth.data.datasets[0].data = benefits;
        chartBenefitByMonth.data.datasets[0].backgroundColor = colors;
        chartBenefitByMonth.data.datasets[0].borderColor = borderColors;
        chartBenefitByMonth.update('none');
        return;
    }
    chartBenefitByMonth = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Bénéfice (FCFA)',
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
                legend: { position: 'top' }
            },
            scales: {
                y: {
                    ticks: {
                        callback: function(value) {
                            return value >= 1000 ? (value / 1000) + 'k' : (value <= -1000 ? (value / 1000) + 'k' : value);
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

let chartTop5Expenses = null;
let chartTop5Income = null;

function updateChartTop5Expenses() {
    const canvas = document.getElementById('chartTop5Expenses');
    const emptyEl = document.getElementById('chartTop5ExpensesEmpty');
    const containerEl = document.getElementById('chartTop5ExpensesContainer');
    if (!canvas || typeof Chart === 'undefined') return;
    const { labels, values, fullDescriptions } = getTop5ExpensesData();
    if (labels.length === 0) {
        if (chartTop5Expenses) { chartTop5Expenses.destroy(); chartTop5Expenses = null; }
        if (emptyEl) emptyEl.classList.add('visible');
        if (containerEl) containerEl.style.display = 'none';
        return;
    }
    if (emptyEl) emptyEl.classList.remove('visible');
    if (containerEl) containerEl.style.display = '';
    if (chartTop5Expenses) {
        chartTop5Expenses.data.labels = labels;
        chartTop5Expenses.data.datasets[0].data = values;
        chartTop5Expenses.data.datasets[0].fullDescriptions = fullDescriptions;
        chartTop5Expenses.update('none');
        return;
    }
    chartTop5Expenses = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Montant (FCFA)',
                data: values,
                fullDescriptions: fullDescriptions,
                backgroundColor: CHART_COLOR_SORTANTS_RGBA,
                borderColor: CHART_COLOR_SORTANTS,
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
                        title: function(ctx) {
                            const full = ctx[0].dataset.fullDescriptions;
                            return full && full[ctx[0].dataIndex] ? full[ctx[0].dataIndex] : ctx[0].label;
                        },
                        label: function(ctx) {
                            return ctx.raw.toLocaleString('fr-FR') + ' FCFA';
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(v) {
                            return v >= 1000 ? (v / 1000) + 'k' : v;
                        }
                    }
                }
            }
        }
    });
}

function updateChartTop5Income() {
    const canvas = document.getElementById('chartTop5Income');
    const emptyEl = document.getElementById('chartTop5IncomeEmpty');
    const containerEl = document.getElementById('chartTop5IncomeContainer');
    if (!canvas || typeof Chart === 'undefined') return;
    const { labels, values, fullDescriptions } = getTop5IncomeData();
    if (labels.length === 0) {
        if (chartTop5Income) { chartTop5Income.destroy(); chartTop5Income = null; }
        if (emptyEl) emptyEl.classList.add('visible');
        if (containerEl) containerEl.style.display = 'none';
        return;
    }
    if (emptyEl) emptyEl.classList.remove('visible');
    if (containerEl) containerEl.style.display = '';
    if (chartTop5Income) {
        chartTop5Income.data.labels = labels;
        chartTop5Income.data.datasets[0].data = values;
        chartTop5Income.data.datasets[0].fullDescriptions = fullDescriptions;
        chartTop5Income.update('none');
        return;
    }
    chartTop5Income = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Montant (FCFA)',
                data: values,
                fullDescriptions: fullDescriptions,
                backgroundColor: 'rgba(16, 185, 129, 0.7)',
                borderColor: '#10b981',
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
                        title: function(ctx) {
                            const full = ctx[0].dataset.fullDescriptions;
                            return full && full[ctx[0].dataIndex] ? full[ctx[0].dataIndex] : ctx[0].label;
                        },
                        label: function(ctx) {
                            return ctx.raw.toLocaleString('fr-FR') + ' FCFA';
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(v) {
                            return v >= 1000 ? (v / 1000) + 'k' : v;
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

// Variables pour la pagination
let currentPage = 1;
const itemsPerPage = 20;

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
        transactionsList.innerHTML = '<p class="empty-state">Aucune transaction trouvée</p>';
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
        
        return `
            <div class="transaction-item ${typeClass}" style="animation-delay: ${animationDelay}s">
                <div class="transaction-info">
                    <div class="transaction-description">${transaction.description}</div>
                    <div class="transaction-date">${formatDate(transaction.date)}</div>
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
                    <button class="invoice-btn" onclick="openInvoiceModal('${transaction.id}')" title="Voir la facture">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            <circle cx="8.5" cy="8.5" r="1.5" stroke="#43277d" stroke-width="2"/>
                            <path d="M21 15l-5-5L5 21" stroke="#43277d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="edit-btn" onclick="openEditModal('${transaction.id}')">
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
        errorElement.textContent = 'Le montant minimum est de 1 FCFA';
        inputElement.classList.add('error');
        return false;
    }
    
    if (amountValue > 1000000000) {
        errorElement.textContent = 'Le montant est trop élevé (max: 1 000 000 000 FCFA)';
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
function addTransaction(type, amount, description, date, remainingAmount = null) {
    const amt = parseFloat(amount);
    const dateIso = new Date(date).toISOString();
    const transaction = {
        type,
        amount: amt,
        description: description.trim(),
        date: dateIso,
        payments: [{ amount: amt, date: dateIso }]
    };
    
    // Ajouter le montant restant si fourni
    if (remainingAmount !== null && remainingAmount !== '') {
        transaction.remainingAmount = parseFloat(remainingAmount);
    }
    
    if (useFirebase && db) {
        // Ajouter à Firestore
        db.collection('transactions').add(transaction)
            .then(() => {
                console.log('Transaction ajoutée à Firebase');
            })
            .catch((error) => {
                console.error('Erreur lors de l\'ajout:', error);
                switchToLocalMode(error);
                showNotification('Synchronisation indisponible. Donnees sauvegardees en local.', 'error');
                // Fallback : ajouter localement
                transaction.id = Date.now();
                transactions.push(transaction);
                saveTransactions();
            });
    } else {
        // Ajouter localement
        transaction.id = Date.now();
        transactions.push(transaction);
        saveTransactions();
    }
}

// Supprimer une transaction
function deleteTransaction(id) {
    console.log('deleteTransaction appelé avec id:', id, 'type:', typeof id);
    if (!id) {
        console.error('ID de transaction manquant');
        return;
    }
    
    if (confirm('Êtes-vous sûr de vouloir supprimer cette transaction ?')) {
        // Convertir l'ID en string pour la comparaison
        const transactionId = String(id);
        
        if (useFirebase && db) {
            // Supprimer de Firestore
            db.collection('transactions').doc(transactionId).delete()
                .then(() => {
                    console.log('Transaction supprimée de Firebase');
                    showNotification('Transaction supprimée avec succès', 'success');
                })
                .catch((error) => {
                    console.error('Erreur lors de la suppression:', error);
                    switchToLocalMode(error);
                    showNotification('Synchronisation indisponible. Suppression en local.', 'error');
                    // Fallback : supprimer localement
                    transactions = transactions.filter(t => String(t.id) !== transactionId);
                    saveTransactions();
                });
        } else {
            // Supprimer localement
            transactions = transactions.filter(t => String(t.id) !== transactionId);
            saveTransactions();
            showNotification('Transaction supprimée avec succès', 'success');
        }
    }
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
    
    // Libellé du montant : "Montant payé à ce jour" pour les deux (entrant et sortant peuvent être partiels)
    const editAmountLabel = document.querySelector('#editForm label[for="editAmount"]');
    if (editAmountLabel) {
        editAmountLabel.textContent = 'Montant payé à ce jour (FCFA)';
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
var currentInvoiceData = null;
function getAppBaseUrl() {
    return new URL('.', window.location.href).href;
}

function preloadInvoiceLogo() {
    if (invoiceLogoDataUrlCache) return Promise.resolve(invoiceLogoDataUrlCache);
    var logoUrl = new URL('images/logo.png', getAppBaseUrl()).href;
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
    const typeLabel = transaction.type === 'income' ? 'Entrant' : 'Sortant';
    const dateFormatted = formatDate(transaction.date);
    const hasRemaining = transaction.remainingAmount != null && transaction.remainingAmount > 0;
    const factureNum = 'FAC-' + String(transaction.id).slice(-8).toUpperCase();
    currentInvoiceData = {
        date: dateFormatted,
        type: typeLabel,
        description: transaction.description || '-',
        amount: formatAmount(transaction.amount),
        remaining: hasRemaining ? formatAmount(transaction.remainingAmount) : null,
        factureNum: factureNum
    };
    var logoSrc = invoiceLogoDataUrlCache || 'images/logo.png';
    const invoiceHtml = `
        <div class="invoice-paper" id="invoicePaper">
            <div class="invoice-header">
                <img src="${logoSrc}" alt="KaayPrint" class="invoice-logo">
                <p class="invoice-title">FACTURE</p>
                <span class="invoice-num">N° ${factureNum}</span>
            </div>
            <div class="invoice-body">
                <table class="invoice-table">
                    <tr><td class="invoice-label">Date</td><td class="invoice-value">${dateFormatted}</td></tr>
                    <tr><td class="invoice-label">Type</td><td class="invoice-value">${typeLabel}</td></tr>
                    <tr><td class="invoice-label">Description</td><td class="invoice-value">${transaction.description || '-'}</td></tr>
                    <tr class="invoice-row-amount"><td class="invoice-label">Montant</td><td class="invoice-amount">${formatAmount(transaction.amount)}</td></tr>
                    ${hasRemaining ? `<tr><td class="invoice-label">Reste à payer</td><td class="invoice-value">${formatAmount(transaction.remainingAmount)}</td></tr>` : ''}
                </table>
            </div>
            <div class="invoice-footer">
                <p class="invoice-footer-text">Merci pour votre confiance</p>
            </div>
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
}

function closeInvoiceModal() {
    const modal = document.getElementById('invoiceModal');
    if (modal) modal.style.display = 'none';
}

function printInvoice() {
    const paper = document.getElementById('invoicePaper');
    if (!paper) return;
    const win = window.open('', '_blank');
    const base = getAppBaseUrl();
    const printHtml = paper.outerHTML.replace('src="images/logo.png"', 'src="' + new URL('images/logo.png', base).href + '"');
    const printStyles = 'body{font-family:Segoe UI,sans-serif;padding:24px;background:#f8f8f8;}.invoice-paper{max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:0 32px 32px;box-shadow:0 4px 24px rgba(0,0,0,0.08);border:1px solid #e8e8e8;}.invoice-logo{max-width:150px;height:auto;display:block;margin:0 auto 18px;}.invoice-header{text-align:center;margin:0 -32px 24px -32px;padding:28px 32px 22px;border-bottom:2px solid #43277d;border-radius:12px 12px 0 0;background:linear-gradient(180deg,rgba(231,32,96,0.08) 0%,rgba(231,32,96,0.04) 50%,rgba(67,39,125,0.03) 100%);}.invoice-title{font-size:1.25em;font-weight:800;margin:0 0 10px;color:#43277d;letter-spacing:0.12em;}.invoice-num{display:inline-block;font-size:0.8em;color:#5a4a7a;font-weight:600;letter-spacing:0.04em;padding:4px 12px;background:rgba(67,39,125,0.08);border-radius:20px;}table{width:100%;border-collapse:collapse;}.invoice-table tr{border-bottom:1px solid #f0f0f0;}.invoice-table td{padding:12px 0;vertical-align:top;}.invoice-label{color:#666;width:38%;font-size:0.9em;font-weight:500;}.invoice-value{color:#333;font-size:0.95em;}.invoice-row-amount td{padding-top:14px;padding-bottom:14px;border-bottom:none;}.invoice-row-amount .invoice-amount{font-size:1.1em;font-weight:700;color:#43277d;}.invoice-footer{margin-top:24px;padding:18px 20px;text-align:center;background:linear-gradient(180deg,rgba(231,32,96,0.06) 0%,rgba(231,32,96,0.03) 100%);border-radius:8px;}.invoice-footer-text{margin:0;color:#777;font-size:0.9em;letter-spacing:0.02em;}';
    win.document.write('<html><head><title>Facture</title><base href="' + base + '"><style>' + printStyles + '</style></head><body>' + printHtml + '</body></html>');
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 250);
}

function loadImage(src) {
    return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('logo-load-failed')); };
        img.src = src;
    });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    var words = String(text || '').split(' ');
    var line = '';
    var drawn = 0;
    for (var i = 0; i < words.length; i++) {
        var test = line ? line + ' ' + words[i] : words[i];
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, x, y + drawn * lineHeight);
            line = words[i];
            drawn++;
        } else {
            line = test;
        }
    }
    if (line) {
        ctx.fillText(line, x, y + drawn * lineHeight);
        drawn++;
    }
    return drawn;
}

function roundedRectPath(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function buildInvoiceCanvas(invoiceData, logoImg) {
    var canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1120;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Paper
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 2;
    roundedRectPath(ctx, 30, 30, 840, 1060, 16);
    ctx.fill();
    ctx.stroke();

    // Header gradient
    var grad = ctx.createLinearGradient(0, 30, 0, 270);
    grad.addColorStop(0, 'rgba(231,32,96,0.08)');
    grad.addColorStop(0.5, 'rgba(231,32,96,0.04)');
    grad.addColorStop(1, 'rgba(67,39,125,0.03)');
    ctx.fillStyle = grad;
    roundedRectPath(ctx, 30, 30, 840, 240, 16);
    ctx.fill();
    ctx.strokeStyle = '#43277d';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(30, 270);
    ctx.lineTo(870, 270);
    ctx.stroke();

    // Logo
    if (logoImg) {
        var targetW = 230;
        var ratio = logoImg.naturalHeight / logoImg.naturalWidth;
        var targetH = targetW * ratio;
        ctx.drawImage(logoImg, (canvas.width - targetW) / 2, 74, targetW, targetH);
    }

    // Title and number
    ctx.fillStyle = '#43277d';
    ctx.textAlign = 'center';
    ctx.font = '800 58px Segoe UI, Arial';
    ctx.fillText('FACTURE', 450, 230);
    ctx.fillStyle = 'rgba(67,39,125,0.08)';
    roundedRectPath(ctx, 288, 252, 324, 52, 26);
    ctx.fill();
    ctx.fillStyle = '#5a4a7a';
    ctx.font = '600 40px Segoe UI, Arial';
    ctx.fillText('N° ' + invoiceData.factureNum, 450, 291);

    var leftX = 90;
    var valueX = 350;
    var y = 380;
    var rowH = 96;
    var rows = [
        ['Date', invoiceData.date],
        ['Type', invoiceData.type],
        ['Description', invoiceData.description]
    ];
    if (invoiceData.remaining) rows.push(['Reste à payer', invoiceData.remaining]);

    ctx.textAlign = 'left';
    for (var r = 0; r < rows.length; r++) {
        ctx.strokeStyle = '#f0f0f0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(90, y + 44);
        ctx.lineTo(810, y + 44);
        ctx.stroke();

        ctx.fillStyle = '#666';
        ctx.font = '600 46px Segoe UI, Arial';
        ctx.fillText(rows[r][0], leftX, y);

        ctx.fillStyle = '#333';
        ctx.font = '400 44px Segoe UI, Arial';
        if (rows[r][0] === 'Description') {
            var lines = wrapText(ctx, rows[r][1], valueX, y, 460, 50);
            y += Math.max(rowH, lines * 50 + 24);
        } else {
            ctx.fillText(String(rows[r][1]), valueX, y);
            y += rowH;
        }
    }

    // Amount
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(90, y + 44);
    ctx.lineTo(810, y + 44);
    ctx.stroke();
    ctx.fillStyle = '#666';
    ctx.font = '600 46px Segoe UI, Arial';
    ctx.fillText('Montant', leftX, y);
    ctx.fillStyle = '#43277d';
    ctx.font = '700 50px Segoe UI, Arial';
    ctx.fillText(invoiceData.amount, valueX, y);

    // Footer badge
    ctx.fillStyle = 'rgba(231,32,96,0.06)';
    roundedRectPath(ctx, 90, 965, 720, 90, 12);
    ctx.fill();
    ctx.fillStyle = '#777';
    ctx.textAlign = 'center';
    ctx.font = '400 46px Segoe UI, Arial';
    ctx.fillText('Merci pour votre confiance', 450, 1025);

    return canvas;
}

function getInvoiceAsImage() {
    if (!currentInvoiceData) return Promise.reject(new Error('Facture indisponible'));
    var absoluteLogo = new URL('images/logo.png', getAppBaseUrl()).href;
    return preloadInvoiceLogo().then(function (logoDataUrl) {
        var logoSrc = logoDataUrl || invoiceLogoDataUrlCache || absoluteLogo;
        return loadImage(logoSrc).catch(function () {
            return loadImage(absoluteLogo).catch(function () {
                return null;
            });
        });
    }).then(function (logoImg) {
        var canvas = buildInvoiceCanvas(currentInvoiceData, logoImg);
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
    });
}

function downloadInvoice() {
    getInvoiceAsImage().then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'facture-kaayprint-' + (new Date().toISOString().slice(0, 10)) + '.png';
        a.click();
        URL.revokeObjectURL(url);
        if (typeof showNotification === 'function') showNotification('Facture téléchargée', 'success');
    }).catch(function () {
        var msg = 'Export impossible. Utilisez Imprimer puis Enregistrer en PDF.';
        if (typeof showNotification === 'function') showNotification(msg, 'error');
        else alert(msg);
    });
}

function shareInvoice() {
    getInvoiceAsImage().then(function (blob) {
        var file = new File([blob], 'facture-kaayprint.png', { type: 'image/png' });
        if (navigator.share && (typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }))) {
            return navigator.share({ title: 'Facture KaayPrint', files: [file] }).then(function () {
                if (typeof showNotification === 'function') showNotification('Partage réussi', 'success');
            });
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'facture-kaayprint-' + (new Date().toISOString().slice(0, 10)) + '.png';
        a.click();
        URL.revokeObjectURL(url);
        if (typeof showNotification === 'function') showNotification('Téléchargez l\'image puis partagez-la (WhatsApp, Instagram…)', 'info');
    }).catch(function () {
        var msg = 'Export impossible. Utilisez Imprimer puis Enregistrer en PDF.';
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
                showNotification('Paiement complété avec succès !', 'success');
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
                    showNotification('Paiement complété avec succès !', 'success');
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
            showNotification('Paiement complété avec succès !', 'success');
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
    document.querySelectorAll('#editForm .error-message').forEach(el => el.textContent = '');
    document.querySelectorAll('#editForm input').forEach(el => el.classList.remove('error', 'valid'));
    document.getElementById('editDescriptionCounter').textContent = '0';
    document.getElementById('editDescriptionCounter').parentElement.classList.remove('warning', 'danger');
}

// Modifier une transaction (remainingAmountParam = valeur du champ "Restant à payer", optionnel)
function updateTransaction(id, amount, description, date, remainingAmountParam = undefined) {
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

    // Onglets Transactions / Statistiques
    document.querySelectorAll('.main-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab');
            sessionStorage.setItem('kaayprint_active_tab', target);
            applyActiveTab(target);
        });
    });

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
        updateChartIncomeVsExpense();
        updateChartBalanceEvolution();
        updateChartTop5Expenses();
        updateChartTop5Income();
        updateChartBenefitByMonth();
    }
    if (benefitPeriodFrom) {
        benefitPeriodFrom.addEventListener('change', refreshChartsAndBenefit);
        benefitPeriodFrom.addEventListener('input', refreshChartsAndBenefit);
    }
    if (benefitPeriodTo) {
        benefitPeriodTo.addEventListener('change', refreshChartsAndBenefit);
        benefitPeriodTo.addEventListener('input', refreshChartsAndBenefit);
    }

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
        
        addTransaction('income', amountToAdd, description, date, remaining);
        
        // Réinitialiser le formulaire et les validations
        document.getElementById('incomeForm').reset();
        document.getElementById('incomeDate').value = new Date().toISOString().slice(0, 16);
        if (paymentComplete) paymentComplete.checked = true;
        if (remainingAmountGroup) remainingAmountGroup.style.display = 'none';
        if (remainingAmount) remainingAmount.removeAttribute('required');
        if (incomeAmount) incomeAmount.setAttribute('required', 'required');
        document.querySelectorAll('#incomeForm .error-message').forEach(el => el.textContent = '');
        document.querySelectorAll('#incomeForm input').forEach(el => el.classList.remove('error', 'valid'));
        document.getElementById('incomeDescriptionCounter').textContent = '0';
        document.getElementById('incomeDescriptionCounter').parentElement.classList.remove('warning', 'danger');
        
        // Restaurer le bouton
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        isSubmittingIncome = false;
        
        // Animation de confirmation
        showNotification('Entrant ajouté avec succès !', 'success');
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
    
    addTransaction('expense', amount, description, date, remaining);
    
    // Réinitialiser le formulaire et les validations
    document.getElementById('expenseForm').reset();
    document.getElementById('expenseDate').value = new Date().toISOString().slice(0, 16);
    // Réinitialiser les radio buttons
    if (expensePaymentComplete) expensePaymentComplete.checked = true;
    if (expenseRemainingAmountGroup) expenseRemainingAmountGroup.style.display = 'none';
    if (expenseRemainingAmount) expenseRemainingAmount.removeAttribute('required');
    document.querySelectorAll('#expenseForm .error-message').forEach(el => el.textContent = '');
    document.querySelectorAll('#expenseForm input').forEach(el => el.classList.remove('error', 'valid'));
    document.getElementById('expenseDescriptionCounter').textContent = '0';
    document.getElementById('expenseDescriptionCounter').parentElement.classList.remove('warning', 'danger');
    
    // Restaurer le bouton
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
    isSubmittingExpense = false;
    
        // Animation de confirmation
        showNotification('Sortant ajouté avec succès !', 'success');
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
                    updateChartIncomeVsExpense();
                    updateChartBalanceEvolution();
                    updateChartTop5Expenses();
                    updateChartTop5Income();
                    updateChartBenefitByMonth();
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
            
            // Mettre à jour la transaction (avec restant à payer si paiement partiel)
            const result = updateTransaction(editingTransactionId, amount, description, date, remainingValue);
            Promise.resolve(result).then((success) => {
                if (success) {
                    updateBenefitDisplays();
                    updateChartIncomeVsExpense();
                    updateChartBalanceEvolution();
                    updateChartTop5Expenses();
                    updateChartTop5Income();
                    updateChartBenefitByMonth();
                    closeEditModal();
                    showNotification('Transaction modifiée avec succès !', 'success');
                } else {
                    showNotification('Erreur lors de la modification', 'error');
                }
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
function showNotification(message, type) {
    // Créer une notification temporaire
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : '#ef4444'};
        color: white;
        padding: 15px 25px;
        border-radius: 8px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        z-index: 1000;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Ajouter les animations CSS pour les notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

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
                        <th>Montant (FCFA)</th>
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
        const amount = transaction.amount.toFixed(2);
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
    const avgIncome = incomeCount > 0 ? (totalIncome / incomeCount).toFixed(2) : '0.00';
    const avgExpense = expenseCount > 0 ? (totalExpense / expenseCount).toFixed(2) : '0.00';
    
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
                        <td class="income" colspan="4">${totalIncome.toFixed(2)} FCFA</td>
                    </tr>
                    <tr style="background-color: #f3f4f6; font-weight: bold;">
                        <td colspan="2">Total Sortants</td>
                        <td class="expense" colspan="4">${totalExpense.toFixed(2)} FCFA</td>
                    </tr>
                    <tr style="background-color: #43277d; color: white; font-weight: bold; font-size: 1.1em;">
                        <td colspan="2">Recette Actuelle (Bénéfice)</td>
                        <td style="color: white;" colspan="4">${balance.toFixed(2)} FCFA</td>
                    </tr>
                    <tr style="background-color: #f9fafb;">
                        <td colspan="2">Moyenne par entrant</td>
                        <td class="income" colspan="4">${avgIncome} FCFA</td>
                    </tr>
                    <tr style="background-color: #f9fafb;">
                        <td colspan="2">Moyenne par sortant</td>
                        <td class="expense" colspan="4">${avgExpense} FCFA</td>
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
    
    showNotification('Export Excel réussi !', 'success');
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
        doc.text('KaayPrint', margin, 15);
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
        doc.text(`Total Entrants : ${totalIncome.toFixed(2)} FCFA`, margin + 2, yPos);
        
        doc.setFillColor(...red);
        doc.rect(margin + contentWidth / 2 + 2, yPos - 5, contentWidth / 2 - 2, 8, 'F');
        doc.text(`Total Sortants : ${totalExpense.toFixed(2)} FCFA`, margin + contentWidth / 2 + 4, yPos);
        yPos += 10;
        
        doc.setFillColor(...violet);
        doc.rect(margin, yPos - 5, contentWidth, 10, 'F');
        doc.setFontSize(12);
        doc.text(`Recette Actuelle : ${balance.toFixed(2)} FCFA`, margin + 2, yPos + 3);
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
            const amount = transaction.amount.toFixed(2);
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
        
        const avgIncome = incomeCount > 0 ? (totalIncome / incomeCount).toFixed(2) : '0.00';
        const avgExpense = expenseCount > 0 ? (totalExpense / expenseCount).toFixed(2) : '0.00';
        const dates = transactionsToExport.map(t => new Date(t.date));
        const minDate = dates.length > 0 ? new Date(Math.min(...dates)).toLocaleDateString('fr-FR') : 'N/A';
        const maxDate = dates.length > 0 ? new Date(Math.max(...dates)).toLocaleDateString('fr-FR') : 'N/A';
        
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setFillColor(...gray);
        doc.rect(margin, yPos - 4, contentWidth, 6, 'F');
        doc.setTextColor(0, 0, 0);
        doc.text(`Moyenne par entrant : ${avgIncome} FCFA`, margin + 2, yPos);
        yPos += 7;
        
        doc.setFillColor(...gray);
        doc.rect(margin, yPos - 4, contentWidth, 6, 'F');
        doc.text(`Moyenne par sortant : ${avgExpense} FCFA`, margin + 2, yPos);
        yPos += 7;
        
        doc.setFillColor(...gray);
        doc.rect(margin, yPos - 4, contentWidth, 6, 'F');
        doc.text(`Période couverte : Du ${minDate} au ${maxDate}`, margin + 2, yPos);
        
        // Télécharger le PDF
        const dateStr = new Date().toISOString().split('T')[0];
        doc.save(`kaayprint_rapport_${dateStr}.pdf`);
        
        showNotification('Export PDF réussi !', 'success');
    } catch (error) {
        console.error('Erreur lors de l\'export PDF:', error);
        showNotification('Erreur lors de l\'export PDF', 'error');
    }
}

// S'assurer que la fonction est accessible globalement
window.exportToPDF = exportToPDF;

// Mettre à jour le statut de connexion
function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connectionStatus');
    const statusIcon = document.getElementById('statusIcon');
    const statusText = document.getElementById('statusText');
    
    if (useFirebase && statusEl) {
        statusEl.style.display = 'inline-flex';
        if (connected) {
            statusEl.classList.remove('offline');
            statusIcon.textContent = '🟢';
            statusText.textContent = 'Synchronisé en temps réel';
        } else {
            statusEl.classList.add('offline');
            statusIcon.textContent = '🔴';
            statusText.textContent = 'Hors ligne - Mode local';
        }
    } else if (statusEl) {
        statusEl.style.display = 'none';
    }
}

// Initialiser l'application quand le DOM est prêt
function initApp() {
    // Vérifier l'authentification
    if (sessionStorage.getItem('kaayprint_authenticated') !== 'true') {
        window.location.href = 'index.html';
        return;
    }
    
    // Attacher tous les event listeners
    attachEventListeners();
    
    // Charger les transactions au démarrage
    loadTransactions();

    // Précharger le logo pour la facture (écran + export identiques)
    preloadInvoiceLogo();

    // Restaurer l'onglet actif (Transactions ou Statistiques) après rechargement
    const savedTab = sessionStorage.getItem('kaayprint_active_tab');
    if (savedTab === 'statistiques' || savedTab === 'transactions') {
        applyActiveTab(savedTab);
    }

    // Date par défaut pour "Bénéfice du jour" = aujourd'hui
    const benefitDayDate = document.getElementById('benefitDayDate');
    if (benefitDayDate && !benefitDayDate.value) {
        const today = new Date();
        benefitDayDate.value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    }
    // Mettre à jour le statut initial
    if (useFirebase) {
        updateConnectionStatus(true);
    } else {
        updateConnectionStatus(false);
    }
    
    // Gestion de la déconnexion
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (confirm('Êtes-vous sûr de vouloir vous déconnecter ?')) {
                sessionStorage.removeItem('kaayprint_authenticated');
                sessionStorage.removeItem('kaayprint_username');
                window.location.href = 'index.html';
            }
        });
    }
}

// Attendre que le DOM soit chargé
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    // DOM déjà chargé
    initApp();
}

// Mettre à jour automatiquement toutes les 30 secondes (uniquement si localStorage)
if (!useFirebase) {
    setInterval(() => {
        if (sessionStorage.getItem('kaayprint_authenticated') === 'true') {
            loadTransactions();
        }
    }, 30000);
}

