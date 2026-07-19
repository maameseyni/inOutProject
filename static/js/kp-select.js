(function (global) {
    'use strict';

    var kpSelectOutsideListenerBound = false;
    var kpSelectTypeahead = { buffer: '', timer: null, wrap: null };

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

    function getEnhancedSelectList(wrap) {
        if (!wrap) return null;
        return wrap.querySelector('.kp-select-menu-list') || wrap.querySelector('.kp-select-menu');
    }

    function getEnhancedSelectPanel(wrap) {
        return wrap ? wrap.querySelector('.kp-select-dropdown') : null;
    }

    function filterEnhancedSelectOptions(wrap, query, matchMode) {
        if (!wrap) return;
        var list = getEnhancedSelectList(wrap);
        var emptyEl = wrap.querySelector('.kp-select-search-empty');
        if (!list) return;
        var q = normalizeSelectFilterText(query);
        var prefixMatch = matchMode === 'prefix';
        list.querySelectorAll('.kp-select-option').forEach(function (li) {
            var value = li.getAttribute('data-value') || '';
            var text = normalizeSelectFilterText(li.textContent || '');
            var alwaysShow = value === '' || value === '__new__';
            var match = alwaysShow || !q || (prefixMatch ? text.indexOf(q) === 0 : text.indexOf(q) !== -1);
            li.hidden = !match;
            if (!match) li.classList.remove('is-typeahead-active');
        });
        if (emptyEl) {
            var realMatches = Array.from(list.querySelectorAll('.kp-select-option')).filter(function (li) {
                if (li.hidden) return false;
                var value = li.getAttribute('data-value') || '';
                return value !== '' && value !== '__new__';
            }).length;
            emptyEl.hidden = !(q && realMatches === 0);
        }
    }

    function clearEnhancedSelectSearch(wrap) {
        if (!wrap) return;
        var input = wrap.querySelector('.kp-select-search-input');
        if (input) input.value = '';
        filterEnhancedSelectOptions(wrap, '');
    }

    function highlightFirstEnhancedSelectMatch(wrap, selectEl) {
        var list = getEnhancedSelectList(wrap);
        if (!list) return;
        var first = Array.from(list.querySelectorAll('.kp-select-option')).find(function (li) {
            if (li.hidden) return false;
            var value = li.getAttribute('data-value') || '';
            return value !== '' && value !== '__new__';
        });
        list.querySelectorAll('.kp-select-option').forEach(function (li) {
            li.classList.remove('is-typeahead-active');
        });
        if (first) first.classList.add('is-typeahead-active');
    }

    function appendEnhancedSelectTypeahead(wrap, char) {
        if (!wrap || !char) return;
        if (kpSelectTypeahead.wrap !== wrap) kpSelectTypeahead.buffer = '';
        kpSelectTypeahead.wrap = wrap;
        kpSelectTypeahead.buffer += char;
        if (kpSelectTypeahead.timer) clearTimeout(kpSelectTypeahead.timer);
        kpSelectTypeahead.timer = setTimeout(resetEnhancedSelectTypeahead, 1000);
        var query = kpSelectTypeahead.buffer;
        var selectEl = wrap.querySelector('select.kp-select-native, select');
        if (!wrap.classList.contains('is-open')) {
            openEnhancedSelectMenu(wrap, { initialQuery: query, matchMode: 'prefix' });
            return;
        }
        var searchInput = wrap.querySelector('.kp-select-search-input');
        if (searchInput && document.activeElement !== searchInput) searchInput.value = query;
        filterEnhancedSelectOptions(wrap, query, 'prefix');
        if (selectEl) highlightFirstEnhancedSelectMatch(wrap, selectEl);
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
                var query = kpSelectTypeahead.buffer;
                var searchInput = wrap.querySelector('.kp-select-search-input');
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

    function isSearchableSelect(selectEl) {
        var ids = global.KP_SELECT_SEARCHABLE_IDS || [];
        return !!(selectEl && ids.indexOf(selectEl.id) !== -1);
    }

    function getSelectSearchMeta(selectId) {
        if (typeof global.getKpSelectSearchMeta === 'function') {
            return global.getKpSelectSearchMeta(selectId);
        }
        return {
            placeholder: 'Rechercher…',
            ariaLabel: 'Rechercher',
            emptyText: 'Aucun résultat'
        };
    }

    function syncEnhancedSelectLabel(selectEl) {
        var wrap = selectEl && selectEl.closest('.kp-select-wrap');
        if (!wrap) return;
        var labelSpan = wrap.querySelector('.kp-select-trigger-label');
        var menu = getEnhancedSelectList(wrap);
        if (!labelSpan) return;
        var opt = selectEl.options[selectEl.selectedIndex];
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
        var panel = getEnhancedSelectPanel(wrap);
        var menu = wrap.querySelector('.kp-select-menu');
        var trigger = wrap.querySelector('.kp-select-trigger');
        if (panel) panel.hidden = true;
        else if (menu) menu.hidden = true;
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
        wrap.classList.remove('is-open');
        if (kpSelectTypeahead.wrap === wrap) resetEnhancedSelectTypeahead();
        clearEnhancedSelectSearch(wrap);
        var list = getEnhancedSelectList(wrap);
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
        var panel = getEnhancedSelectPanel(wrap);
        var menu = wrap.querySelector('.kp-select-menu');
        var trigger = wrap.querySelector('.kp-select-trigger');
        var selectEl = wrap.querySelector('select');
        if (panel) panel.hidden = false;
        else if (menu) menu.hidden = false;
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
        wrap.classList.add('is-open');
        var searchInput = wrap.querySelector('.kp-select-search-input');
        var initialQuery = options.initialQuery != null ? String(options.initialQuery) : '';
        var matchMode = options.matchMode || (initialQuery ? 'prefix' : 'contains');
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
        if (selectEl && initialQuery) highlightFirstEnhancedSelectMatch(wrap, selectEl);
    }

    function refreshEnhancedSelectMenu(selectEl) {
        if (!selectEl || !selectEl.dataset.kpEnhanced) return;
        var wrap = selectEl.closest('.kp-select-wrap');
        if (!wrap) return;
        var menu = getEnhancedSelectList(wrap);
        var labelSpan = wrap.querySelector('.kp-select-trigger-label');
        if (!menu || !labelSpan) return;
        menu.innerHTML = '';
        Array.from(selectEl.options).forEach(function (opt) {
            var li = document.createElement('li');
            li.className = 'kp-select-option';
            if (!opt.value) li.classList.add('kp-select-option-muted');
            if (opt.value === '__new__') li.classList.add('kp-select-option-new');
            li.setAttribute('role', 'option');
            li.setAttribute('data-value', opt.value);
            li.textContent = opt.textContent;
            if (opt.value === selectEl.value) li.classList.add('is-selected');
            var optValue = opt.value;
            li.addEventListener('click', function (e) {
                e.stopPropagation();
                selectEl.value = optValue;
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                syncEnhancedSelectLabel(selectEl);
                closeEnhancedSelectMenu(wrap);
            });
            menu.appendChild(li);
        });
        var searchInput = wrap.querySelector('.kp-select-search-input');
        filterEnhancedSelectOptions(wrap, searchInput ? searchInput.value : '');
        syncEnhancedSelectLabel(selectEl);
    }

    function enhanceSelectField(selectEl) {
        if (!selectEl) return;
        if (selectEl.dataset.kpEnhanced === '1') {
            refreshEnhancedSelectMenu(selectEl);
            return;
        }
        selectEl.dataset.kpEnhanced = '1';
        selectEl.classList.add('kp-select-native');
        var searchable = isSearchableSelect(selectEl);
        var wrap = document.createElement('div');
        wrap.className = 'kp-select-wrap' + (searchable ? ' kp-select-wrap--searchable' : '');
        selectEl.parentNode.insertBefore(wrap, selectEl);
        wrap.appendChild(selectEl);

        var trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'kp-select-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('tabindex', '0');

        var labelSpan = document.createElement('span');
        labelSpan.className = 'kp-select-trigger-label is-placeholder';
        labelSpan.textContent = '— Choisir —';
        trigger.appendChild(labelSpan);

        var chevron = document.createElement('span');
        chevron.className = 'kp-select-chevron';
        chevron.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
        trigger.appendChild(chevron);
        wrap.insertBefore(trigger, selectEl);

        if (searchable) {
            var dropdown = document.createElement('div');
            dropdown.className = 'kp-select-dropdown';
            dropdown.hidden = true;
            var searchWrap = document.createElement('div');
            searchWrap.className = 'kp-select-search';
            searchWrap.innerHTML =
                '<svg class="kp-select-search-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
                '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>' +
                '<path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
                '</svg>';
            var searchInput = document.createElement('input');
            searchInput.type = 'search';
            searchInput.className = 'kp-select-search-input';
            var searchMeta = getSelectSearchMeta(selectEl.id);
            searchInput.placeholder = searchMeta.placeholder;
            searchInput.setAttribute('autocomplete', 'off');
            searchInput.setAttribute('aria-label', searchMeta.ariaLabel);
            searchWrap.appendChild(searchInput);
            var emptyEl = document.createElement('div');
            emptyEl.className = 'kp-select-search-empty';
            emptyEl.textContent = searchMeta.emptyText;
            emptyEl.hidden = true;
            var menu = document.createElement('ul');
            menu.className = 'kp-select-menu kp-select-menu-list';
            menu.setAttribute('role', 'listbox');
            dropdown.appendChild(searchWrap);
            dropdown.appendChild(emptyEl);
            dropdown.appendChild(menu);
            wrap.appendChild(dropdown);
            searchWrap.addEventListener('click', function (e) { e.stopPropagation(); });
            searchInput.addEventListener('click', function (e) { e.stopPropagation(); });
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
                var q = searchInput.value;
                var mode = q.length === 1 ? 'prefix' : 'contains';
                filterEnhancedSelectOptions(wrap, q, mode);
                highlightFirstEnhancedSelectMatch(wrap, selectEl);
            });
            dropdown.addEventListener('click', function (e) { e.stopPropagation(); });
        } else {
            var simpleMenu = document.createElement('ul');
            simpleMenu.className = 'kp-select-menu';
            simpleMenu.setAttribute('role', 'listbox');
            simpleMenu.hidden = true;
            wrap.appendChild(simpleMenu);
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

    function initKpSelectFields(root) {
        var scope = root || document;
        scope.querySelectorAll('select.kp-select-native').forEach(function (sel) {
            enhanceSelectField(sel);
        });
    }

    global.enhanceSelectField = enhanceSelectField;
    global.initKpSelectFields = initKpSelectFields;
    global.syncEnhancedSelectLabel = syncEnhancedSelectLabel;
    global.refreshEnhancedSelectMenu = refreshEnhancedSelectMenu;
})(window);
