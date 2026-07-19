/**
 * Pays / villes via CountriesNow + libellés français (Intl.DisplayNames)
 * API : https://countriesnow.space/ (villes)
 * Pays affichés en français ; valeur enregistrée = nom FR
 */
(function (global) {
    const API_BASE = 'https://countriesnow.space/api/v0.1';
    let countriesPromise = null;
    let citiesCache = Object.create(null);
    let pendingCountry = '';
    let pendingCity = '';
    let bound = false;

    let regionNamesFr = null;
    try {
        regionNamesFr = new Intl.DisplayNames(['fr'], { type: 'region' });
    } catch (e) {
        regionNamesFr = null;
    }

    function frenchCountryLabel(iso2, fallbackEnglish) {
        const code = String(iso2 || '').trim().toUpperCase();
        if (code && regionNamesFr) {
            try {
                const label = regionNamesFr.of(code);
                if (label) return label;
            } catch (e) { /* ignore */ }
        }
        return String(fallbackEnglish || code || '').trim();
    }

    function getCountrySelect() {
        return document.getElementById('userCountry');
    }

    function getCitySelect() {
        return document.getElementById('userCity');
    }

    function refreshSelect(selectEl) {
        if (!selectEl) return;
        if (typeof enhanceSelectField === 'function') {
            enhanceSelectField(selectEl);
        } else if (typeof refreshEnhancedSelectMenu === 'function') {
            refreshEnhancedSelectMenu(selectEl);
        }
    }

    function setSelectEnabled(selectEl, enabled) {
        if (!selectEl) return;
        selectEl.disabled = !enabled;
        const wrap = selectEl.closest('.kp-select-wrap');
        const trigger = wrap ? wrap.querySelector('.kp-select-trigger') : null;
        if (trigger) trigger.disabled = !enabled;
    }

    function getSelectedApiCountryName(countrySel) {
        if (!countrySel) return '';
        const opt = countrySel.options[countrySel.selectedIndex];
        if (opt && opt.dataset && opt.dataset.apiName) {
            return opt.dataset.apiName;
        }
        return '';
    }

    function findCountryOption(selectEl, preferred) {
        const needle = String(preferred || '').trim();
        if (!needle || !selectEl) return null;
        const lower = needle.toLowerCase();
        return Array.prototype.find.call(selectEl.options, function (opt) {
            if (!opt.value) return false;
            if (opt.value === needle || opt.value.toLowerCase() === lower) return true;
            if (opt.dataset.apiName && opt.dataset.apiName.toLowerCase() === lower) return true;
            if (opt.dataset.iso2 && opt.dataset.iso2.toLowerCase() === lower) return true;
            if (opt.textContent && opt.textContent.trim().toLowerCase() === lower) return true;
            return false;
        }) || null;
    }

    function fillCountryOptions(selectEl, items, placeholder, selectedValue) {
        if (!selectEl) return;
        const preferred = String(selectedValue || '').trim();
        selectEl.innerHTML = '';
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = placeholder;
        selectEl.appendChild(empty);

        const seen = Object.create(null);
        (items || []).forEach(function (item) {
            const value = item.value;
            if (!value || seen[value]) return;
            seen[value] = true;
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = item.label || value;
            if (item.apiName) opt.dataset.apiName = item.apiName;
            if (item.iso2) opt.dataset.iso2 = item.iso2;
            selectEl.appendChild(opt);
        });

        if (preferred) {
            const match = findCountryOption(selectEl, preferred);
            if (match) {
                selectEl.value = match.value;
            } else {
                ensureOption(selectEl, preferred);
                selectEl.value = preferred;
            }
        } else {
            selectEl.value = '';
        }
        refreshSelect(selectEl);
    }

    function fillCityOptions(selectEl, items, placeholder, selectedValue) {
        if (!selectEl) return;
        const preferred = String(selectedValue || '').trim();
        selectEl.innerHTML = '';
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = placeholder;
        selectEl.appendChild(empty);

        const seen = Object.create(null);
        (items || []).forEach(function (name) {
            const value = String(name || '').trim();
            if (!value || seen[value]) return;
            seen[value] = true;
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = value;
            selectEl.appendChild(opt);
        });

        if (preferred) {
            ensureOption(selectEl, preferred);
            selectEl.value = preferred;
            if (selectEl.value !== preferred) {
                const match = Array.prototype.find.call(selectEl.options, function (opt) {
                    return opt.value.toLowerCase() === preferred.toLowerCase();
                });
                if (match) selectEl.value = match.value;
            }
        } else {
            selectEl.value = '';
        }
        refreshSelect(selectEl);
    }

    function ensureOption(selectEl, value) {
        if (!selectEl || !value) return;
        const exists = Array.prototype.some.call(selectEl.options, function (opt) {
            return opt.value === value;
        });
        if (exists) return;
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        selectEl.appendChild(opt);
    }

    async function fetchCountries() {
        if (countriesPromise) return countriesPromise;
        countriesPromise = fetch(API_BASE + '/countries/iso')
            .then(function (res) {
                if (!res.ok) throw new Error('countries ' + res.status);
                return res.json();
            })
            .then(function (payload) {
                const list = (payload && payload.data) || [];
                return list
                    .map(function (row) {
                        const apiName = String(row.name || '').trim();
                        const iso2 = String(row.Iso2 || '').trim().toUpperCase();
                        if (!apiName || !iso2) return null;
                        const label = frenchCountryLabel(iso2, apiName);
                        return {
                            value: label,
                            label: label,
                            apiName: apiName,
                            iso2: iso2,
                        };
                    })
                    .filter(Boolean)
                    .sort(function (a, b) {
                        return a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' });
                    });
            })
            .catch(function (err) {
                countriesPromise = null;
                throw err;
            });
        return countriesPromise;
    }

    async function fetchCities(apiCountryName) {
        const key = String(apiCountryName || '').trim();
        if (!key) return [];
        if (citiesCache[key]) return citiesCache[key];

        const res = await fetch(API_BASE + '/countries/cities', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({ country: key }),
        });
        if (!res.ok) throw new Error('cities ' + res.status);
        const payload = await res.json();
        if (payload && payload.error) {
            throw new Error(payload.msg || 'cities error');
        }
        const cities = ((payload && payload.data) || [])
            .map(function (name) { return String(name || '').trim(); })
            .filter(Boolean)
            .sort(function (a, b) {
                return a.localeCompare(b, 'fr', { sensitivity: 'base' });
            });
        citiesCache[key] = cities;
        return cities;
    }

    async function loadCitiesForSelectedCountry(selectedCity) {
        const countrySel = getCountrySelect();
        const citySel = getCitySelect();
        if (!citySel) return;

        const apiName = getSelectedApiCountryName(countrySel);
        if (!apiName) {
            fillCityOptions(citySel, [], '— Choisir d\'abord un pays —', '');
            setSelectEnabled(citySel, false);
            return;
        }

        setSelectEnabled(citySel, true);
        fillCityOptions(citySel, [], 'Chargement des villes…', '');
        setSelectEnabled(citySel, false);

        try {
            const cities = await fetchCities(apiName);
            fillCityOptions(
                citySel,
                cities,
                cities.length ? '— Choisir une ville —' : '— Aucune ville listée —',
                selectedCity || ''
            );
            setSelectEnabled(citySel, true);
        } catch (err) {
            fillCityOptions(citySel, [], '— Impossible de charger les villes —', selectedCity || '');
            if (selectedCity) {
                ensureOption(citySel, selectedCity);
                citySel.value = selectedCity;
                refreshSelect(citySel);
            }
            setSelectEnabled(citySel, true);
        }
    }

    function onCountryChange() {
        const citySel = getCitySelect();
        pendingCity = '';
        if (citySel) citySel.value = '';
        loadCitiesForSelectedCountry('');
    }

    async function applyValues(country, city) {
        pendingCountry = String(country || '').trim();
        pendingCity = String(city || '').trim();
        const countrySel = getCountrySelect();
        if (!countrySel) return;

        try {
            const countries = await fetchCountries();
            fillCountryOptions(countrySel, countries, '— Choisir un pays —', pendingCountry);
            await loadCitiesForSelectedCountry(pendingCity);
        } catch (err) {
            fillCountryOptions(countrySel, [], '— Impossible de charger les pays —', pendingCountry);
            if (pendingCountry) {
                ensureOption(countrySel, pendingCountry);
                countrySel.value = pendingCountry;
                refreshSelect(countrySel);
            }
            const citySel = getCitySelect();
            if (citySel) {
                fillCityOptions(citySel, [], '— Choisir une ville —', pendingCity);
                setSelectEnabled(citySel, !!pendingCountry);
            }
        }
    }

    async function init() {
        const countrySel = getCountrySelect();
        const citySel = getCitySelect();
        if (!countrySel || !citySel) return;

        if (!bound) {
            bound = true;
            countrySel.addEventListener('change', onCountryChange);
        }

        if (typeof enhanceSelectField === 'function') {
            enhanceSelectField(countrySel);
            enhanceSelectField(citySel);
        }

        fillCityOptions(citySel, [], '— Choisir d\'abord un pays —', '');
        setSelectEnabled(citySel, false);

        try {
            const countries = await fetchCountries();
            fillCountryOptions(
                countrySel,
                countries,
                '— Choisir un pays —',
                pendingCountry || countrySel.value || ''
            );
            if (countrySel.value) {
                await loadCitiesForSelectedCountry(pendingCity || citySel.value || '');
            }
        } catch (err) {
            fillCountryOptions(countrySel, [], '— Impossible de charger les pays —', pendingCountry || '');
        }
    }

    global.xalissGeoSelects = {
        init: init,
        applyValues: applyValues,
    };
})(window);
