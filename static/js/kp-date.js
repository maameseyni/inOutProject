/**
 * Sélecteur de date (mode date seule) — même UX que l’app (calendrier custom).
 * Markup attendu (ids basés sur inputId) :
 *   #{id}Picker, #{id} (hidden), #{id}Trigger, #{id}TriggerText,
 *   #{id}Popover, #{id}Days, #{id}MonthLabel, #{id}PrevMonth, #{id}NextMonth, #{id}TodayBtn
 */
(function (global) {
    'use strict';

    var registry = global.kpDatePickers || (global.kpDatePickers = {});

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    function toDateOnly(value) {
        if (!value) return '';
        var raw = String(value).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
        var d = new Date(raw);
        if (isNaN(d.getTime())) return '';
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function parseLocalDate(value) {
        var raw = String(value || '').trim();
        var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) {
            return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        }
        var d = new Date(raw);
        return isNaN(d.getTime()) ? null : d;
    }

    function formatDisplay(value) {
        var d = parseLocalDate(value);
        if (!d) return '';
        try {
            return d.toLocaleDateString('fr-FR', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
            });
        } catch (e) {
            return toDateOnly(value);
        }
    }

    function sameDay(a, b) {
        return a.getFullYear() === b.getFullYear()
            && a.getMonth() === b.getMonth()
            && a.getDate() === b.getDate();
    }

    /**
     * @param {string} inputId
     * @param {{ placeholder?: string, allowClear?: boolean }} options
     */
    function initKpDatePicker(inputId, options) {
        var opts = Object.assign({
            placeholder: 'Choisir une date',
            allowClear: false,
        }, options || {});

        if (registry[inputId]) {
            registry[inputId].syncTrigger();
            return registry[inputId];
        }

        var picker = document.getElementById(inputId + 'Picker');
        var input = document.getElementById(inputId);
        var trigger = document.getElementById(inputId + 'Trigger');
        var triggerText = document.getElementById(inputId + 'TriggerText');
        var clearBtn = document.getElementById(inputId + 'Clear');
        var popover = document.getElementById(inputId + 'Popover');
        var daysEl = document.getElementById(inputId + 'Days');
        var monthLabel = document.getElementById(inputId + 'MonthLabel');
        var prevBtn = document.getElementById(inputId + 'PrevMonth');
        var nextBtn = document.getElementById(inputId + 'NextMonth');
        var todayBtn = document.getElementById(inputId + 'TodayBtn');

        if (!picker || !input || !trigger || !popover || !daysEl) return null;

        picker.classList.add('kp-date-picker', 'note-reminder-picker', 'note-reminder-picker--date');
        popover.classList.add('kp-date-popover', 'note-reminder-popover', 'note-reminder-popover--date');

        var state = {
            viewYear: null,
            viewMonth: null,
            selectedDate: null,
        };

        function syncTrigger() {
            var value = toDateOnly(input.value);
            var label = formatDisplay(value);
            if (triggerText) {
                triggerText.textContent = label || opts.placeholder;
                triggerText.classList.toggle('is-placeholder', !label);
            }
            if (clearBtn) clearBtn.hidden = !opts.allowClear || !value;
        }

        function close() {
            popover.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
        }

        function renderCalendar() {
            if (state.viewYear == null || state.viewMonth == null) return;
            var monthDate = new Date(state.viewYear, state.viewMonth, 1);
            if (monthLabel) {
                try {
                    monthLabel.textContent = monthDate.toLocaleDateString('fr-FR', {
                        month: 'long',
                        year: 'numeric',
                    });
                } catch (e) {
                    monthLabel.textContent = (state.viewMonth + 1) + '/' + state.viewYear;
                }
            }
            var firstDow = (monthDate.getDay() + 6) % 7;
            var daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
            var prevDays = new Date(state.viewYear, state.viewMonth, 0).getDate();
            var today = new Date();
            today.setHours(0, 0, 0, 0);
            var cells = [];
            for (var i = 0; i < 42; i++) {
                var y = state.viewYear;
                var m = state.viewMonth;
                var day;
                var outside = false;
                if (i < firstDow) {
                    day = prevDays - firstDow + i + 1;
                    m -= 1;
                    if (m < 0) { m = 11; y -= 1; }
                    outside = true;
                } else if (i >= firstDow + daysInMonth) {
                    day = i - firstDow - daysInMonth + 1;
                    m += 1;
                    if (m > 11) { m = 0; y += 1; }
                    outside = true;
                } else {
                    day = i - firstDow + 1;
                }
                var cellDate = new Date(y, m, day);
                var isToday = sameDay(cellDate, today);
                var isSelected = state.selectedDate && sameDay(cellDate, state.selectedDate);
                cells.push(
                    '<button type="button" class="note-reminder-day kp-date-day'
                    + (outside ? ' is-outside' : '')
                    + (isToday ? ' is-today' : '')
                    + (isSelected ? ' is-selected' : '')
                    + '" data-y="' + y + '" data-m="' + m + '" data-d="' + day + '">'
                    + day
                    + '</button>'
                );
            }
            daysEl.innerHTML = cells.join('');
        }

        function open() {
            var parsed = parseLocalDate(input.value);
            var base = parsed || new Date();
            state.selectedDate = new Date(base.getFullYear(), base.getMonth(), base.getDate());
            state.viewYear = base.getFullYear();
            state.viewMonth = base.getMonth();
            renderCalendar();
            popover.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
        }

        function setValue(ymd, dispatch) {
            input.value = toDateOnly(ymd);
            syncTrigger();
            if (dispatch !== false) {
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }

        function apply() {
            if (!state.selectedDate) return;
            var ymd = state.selectedDate.getFullYear()
                + '-' + pad(state.selectedDate.getMonth() + 1)
                + '-' + pad(state.selectedDate.getDate());
            setValue(ymd, true);
            close();
        }

        trigger.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (popover.hidden) open();
            else close();
        });

        if (clearBtn) {
            clearBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                setValue('', true);
                close();
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                state.viewMonth -= 1;
                if (state.viewMonth < 0) {
                    state.viewMonth = 11;
                    state.viewYear -= 1;
                }
                renderCalendar();
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                state.viewMonth += 1;
                if (state.viewMonth > 11) {
                    state.viewMonth = 0;
                    state.viewYear += 1;
                }
                renderCalendar();
            });
        }

        daysEl.addEventListener('click', function (e) {
            var btn = e.target.closest('.note-reminder-day, .kp-date-day');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            state.selectedDate = new Date(
                Number(btn.getAttribute('data-y')),
                Number(btn.getAttribute('data-m')),
                Number(btn.getAttribute('data-d'))
            );
            state.viewYear = state.selectedDate.getFullYear();
            state.viewMonth = state.selectedDate.getMonth();
            renderCalendar();
            apply();
        });

        if (todayBtn) {
            todayBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var now = new Date();
                state.selectedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                state.viewYear = now.getFullYear();
                state.viewMonth = now.getMonth();
                renderCalendar();
                apply();
            });
        }

        document.addEventListener('click', function (e) {
            if (!popover.hidden && !picker.contains(e.target)) close();
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !popover.hidden) close();
        });

        var api = {
            syncTrigger: syncTrigger,
            close: close,
            open: open,
            setValue: function (ymd) { setValue(ymd, true); },
            getValue: function () { return toDateOnly(input.value); },
            mode: 'date',
        };
        registry[inputId] = api;
        syncTrigger();
        return api;
    }

    function setKpDateValue(inputId, ymd, dispatch) {
        var api = registry[inputId];
        if (api && typeof api.setValue === 'function') {
            if (dispatch === false) {
                var input = document.getElementById(inputId);
                if (input) {
                    input.value = toDateOnly(ymd);
                    api.syncTrigger();
                }
            } else {
                api.setValue(ymd);
            }
            return;
        }
        var el = document.getElementById(inputId);
        if (el) el.value = toDateOnly(ymd);
    }

    global.initKpDatePicker = initKpDatePicker;
    global.setKpDateValue = setKpDateValue;
})(typeof window !== 'undefined' ? window : this);
