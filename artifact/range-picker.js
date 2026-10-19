/*
 * Custom date range picker for the Hark dashboard artifact.
 *
 * Opens from the filter bar's "Custom" button (patched in scripts/build-artifact.ts) and
 * drives the dashboard through window.__harkDash, the app's own state: a calendar that shows
 * which days have data, quick ranges, typed dates, and a comparison that can be the previous
 * period, any custom range, or off. Every view, delta and CSV then follows the chosen range.
 */
(function (root) {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS_LONG = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  var DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  // The dashboard never shows a range before this day (the bundle clamps to it).
  var FLOOR = '2026-10-01';
  var CHANNELS = {
    apple: 'Apple Search Ads',
    google: 'Google App',
    search: 'Google Search',
    meta: 'Meta',
    tiktok: 'TikTok',
    hi: 'High Impact',
  };

  // ---- Dates (ISO YYYY-MM-DD, UTC arithmetic) -------------------------------------------------

  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function daysIn(from, to) {
    return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5) + 1;
  }
  function weekday(iso) {
    return (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
  }
  function monthOf(iso) {
    return iso.slice(0, 7);
  }
  function addMonths(ym, n) {
    var y = Number(ym.slice(0, 4));
    var m = Number(ym.slice(5, 7)) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + '-' + String(m + 1).padStart(2, '0');
  }
  function lastOfMonth(ym) {
    return addDays(addMonths(ym, 1) + '-01', -1);
  }
  function fmt(iso, withYear) {
    var s = MONTHS[Number(iso.slice(5, 7)) - 1] + ' ' + Number(iso.slice(8, 10));
    return withYear ? s + ', ' + iso.slice(0, 4) : s;
  }
  /** Same format as the dashboard's own readout (the bundle's Rs). */
  function fmtRange(r) {
    if (r.from === r.to) return fmt(r.from, true);
    if (r.from.slice(0, 4) !== r.to.slice(0, 4)) return fmt(r.from, true) + ' – ' + fmt(r.to, true);
    if (r.from.slice(0, 7) !== r.to.slice(0, 7)) return fmt(r.from) + ' – ' + fmt(r.to, true);
    return fmt(r.from) + ' – ' + Number(r.to.slice(8, 10)) + ', ' + r.to.slice(0, 4);
  }
  function clamp(r, min, max) {
    var from = r.from < min ? min : r.from;
    var to = r.to > max ? max : r.to;
    return from <= to ? { from: from, to: to } : null;
  }
  function order(a, b) {
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  }
  /** Same rule as the bundle's Ps: the same number of days immediately before. */
  function previousPeriod(r) {
    var end = addDays(r.from, -1);
    return { from: addDays(end, -(daysIn(r.from, r.to) - 1)), to: end };
  }

  /** Quick ranges, relative to the latest day with data (as the dashboard's presets are). */
  function quickRange(id, latest) {
    var monday = addDays(latest, -weekday(latest));
    switch (id) {
      case 'thisWeek':
        return { from: monday, to: latest };
      case 'lastWeek':
        return { from: addDays(monday, -7), to: addDays(monday, -1) };
      case 'last7':
        return { from: addDays(latest, -6), to: latest };
      case 'last14':
        return { from: addDays(latest, -13), to: latest };
      case 'last28':
        return { from: addDays(latest, -27), to: latest };
      case 'mtd':
        return { from: monthOf(latest) + '-01', to: latest };
      case 'lastMonth': {
        var ym = addMonths(monthOf(latest), -1);
        return { from: ym + '-01', to: lastOfMonth(ym) };
      }
      default:
        return null;
    }
  }
  var QUICK = [
    ['thisWeek', 'This week'],
    ['lastWeek', 'Last week'],
    ['last7', 'Last 7 days'],
    ['last14', 'Last 14 days'],
    ['last28', 'Last 28 days'],
    ['mtd', 'Month to date'],
    ['lastMonth', 'Last month'],
    ['all', 'All dates'],
  ];

  // Exposed for the tests.
  root.HarkRange = {
    fmtRange: fmtRange,
    addDays: addDays,
    daysIn: daysIn,
    weekday: weekday,
    quickRange: quickRange,
    previousPeriod: previousPeriod,
    clamp: clamp,
  };

  if (typeof document === 'undefined') return;

  // ---- Picker ---------------------------------------------------------------------------------

  var el = null; // the popover
  var anchor = null; // the Custom button
  var s = null; // working state while open

  function dash() {
    return window.__harkDash || null;
  }

  function h(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs)
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : v);
      });
    (children || []).forEach(function (c) {
      if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  /** date → channels that spent or served that day (a row of zeros is not activity). */
  function coverage(rows) {
    var m = {};
    rows.forEach(function (r) {
      if ((r.spend || 0) > 0 || (r.impressions || 0) > 0) (m[r.date] = m[r.date] || {})[r.channel] = 1;
    });
    return m;
  }
  /** Dates with any row, the dashboard's own "days with data" count. */
  function rowDates(rows) {
    var m = {};
    rows.forEach(function (r) {
      m[r.date] = 1;
    });
    return m;
  }

  function channelsIn(r) {
    var set = {};
    if (!r) return set;
    for (var d = r.from; d <= r.to; d = addDays(d, 1))
      Object.keys(s.cov[d] || {}).forEach(function (c) {
        set[c] = 1;
      });
    return set;
  }

  function daysWithData(r) {
    var n = 0;
    for (var d = r.from; d <= r.to; d = addDays(d, 1)) if (s.dates[d]) n++;
    return n;
  }

  function open(btn) {
    var d = dash();
    if (!d || !d.bounds || !d.range) return;
    anchor = btn;
    var cov = coverage(d.dataset.rows);
    var rangeMin = d.bounds.first > FLOOR ? d.bounds.first : FLOOR;
    s = {
      cov: cov,
      dates: rowDates(d.dataset.rows),
      rows: d.dataset.rows,
      maxChannels: Object.keys(cov).reduce(function (m, k) {
        return Math.max(m, Object.keys(cov[k]).length);
      }, 0),
      latest: d.bounds.last,
      min: { range: rangeMin, compare: d.bounds.first },
      range: { from: d.range.from, to: d.range.to },
      mode: !d.compare ? 'off' : d.cmpCustom ? 'custom' : 'previous',
      compare: d.cmpCustom && d.prevRange ? { from: d.prevRange.from, to: d.prevRange.to } : null,
      target: 'range',
      anchorDay: null, // first click of a two-click pick
      hover: null,
      focus: d.range.to,
      month: monthOf(d.range.to),
    };
    render();
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    focusDay(s.focus);
  }

  function close(restoreFocus) {
    if (!el) return;
    el.remove();
    el = null;
    s = null;
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    if (restoreFocus && anchor) anchor.focus();
  }

  function onOutside(e) {
    if (el && !el.contains(e.target) && e.target !== anchor) close(false);
  }

  function onKey(e) {
    if (e.key === 'Escape' && el) {
      e.stopPropagation();
      close(true);
    }
  }

  function apply() {
    var d = dash();
    if (!d || !s) return;
    var r = s.range;
    var cmp = s.mode === 'custom' ? s.compare : null;
    if (s.mode === 'custom' && !cmp) return;
    d.setCustom({
      from: r.from,
      to: r.to,
      compare: s.mode !== 'off',
      cmpFrom: cmp ? cmp.from : null,
      cmpTo: cmp ? cmp.to : null,
    });
    close(true);
  }

  function setTargetRange(r) {
    if (!r) return;
    if (s.target === 'compare') s.compare = r;
    else s.range = r;
    s.anchorDay = null;
    s.month = monthOf(r.to);
    s.focus = r.to;
  }

  function pickDay(day) {
    if (!s.anchorDay) {
      s.anchorDay = day;
      if (s.target === 'compare') s.compare = { from: day, to: day };
      else s.range = { from: day, to: day };
    } else {
      setTargetRange(order(s.anchorDay, day));
    }
    s.focus = day;
    render();
    focusDay(day);
  }

  function monthsShown() {
    return window.innerWidth < 640 ? 1 : 2;
  }

  // ---- Rendering --------------------------------------------------------------------------------

  /** Re-render and put focus back on the control with this data-k (re-rendering replaces it). */
  function rerender(key) {
    render();
    var b = el && el.querySelector('[data-k="' + key + '"]');
    if (b) b.focus();
  }

  function render() {
    var fresh = !el;
    if (!el) {
      el = h('div', { class: 'hrp', role: 'dialog', 'aria-label': 'Custom date range' });
      document.body.appendChild(el);
    }
    el.textContent = '';
    var min = s.min[s.target];
    var active = s.target === 'compare' ? s.compare : s.range;

    // Quick ranges
    var quick = h(
      'div',
      { class: 'hrp-quick', role: 'group', 'aria-label': 'Quick ranges' },
      QUICK.map(function (q) {
        var r =
          q[0] === 'all' ? { from: min, to: s.latest } : clamp(quickRange(q[0], s.latest), min, s.latest);
        var on = r && active && r.from === active.from && r.to === active.to;
        return h('button', {
          type: 'button',
          'data-k': 'q-' + q[0],
          'aria-pressed': on ? 'true' : 'false',
          disabled: !r,
          text: q[1],
          onclick: function () {
            setTargetRange(r);
            rerender('q-' + q[0]);
          },
        });
      }),
    );

    // Which range the calendar edits
    var targets =
      s.mode === 'custom'
        ? h('div', { class: 'segmented', role: 'group', 'aria-label': 'Calendar edits' }, [
            h('button', {
              type: 'button',
              'aria-pressed': s.target === 'range' ? 'true' : 'false',
              'data-k': 't-range',
              text: 'Date range',
              onclick: function () {
                s.target = 'range';
                s.anchorDay = null;
                rerender('t-range');
              },
            }),
            h('button', {
              type: 'button',
              'aria-pressed': s.target === 'compare' ? 'true' : 'false',
              'data-k': 't-compare',
              text: 'Comparison',
              onclick: function () {
                s.target = 'compare';
                s.anchorDay = null;
                if (!s.compare) s.compare = clamp(previousPeriod(s.range), s.min.compare, s.latest);
                if (s.compare) s.month = monthOf(s.compare.to);
                rerender('t-compare');
              },
            }),
          ])
        : null;

    // Typed dates for the range being edited
    var fields = h('div', { class: 'hrp-fields' }, [
      dateField('hrp-from', 'From', active ? active.from : '', min, s.latest, function (v) {
        var cur = active || { from: v, to: v };
        setTargetRange(order(v, cur.to));
        render();
      }),
      h('span', { 'aria-hidden': 'true', text: '→' }),
      dateField('hrp-to', 'To', active ? active.to : '', min, s.latest, function (v) {
        var cur = active || { from: v, to: v };
        setTargetRange(order(cur.from, v));
        render();
      }),
      h('span', {
        class: 'hrp-len',
        text: active ? daysIn(active.from, active.to) + ' days · ' + daysWithData(active) + ' with data' : '',
      }),
    ]);

    // Calendar
    var minMonth = monthOf(min);
    var maxMonth = monthOf(s.latest);
    var span =
      (Number(maxMonth.slice(0, 4)) - Number(minMonth.slice(0, 4))) * 12 +
      Number(maxMonth.slice(5, 7)) -
      Number(minMonth.slice(5, 7)) +
      1;
    var n = Math.min(monthsShown(), span);
    var first = n === 2 ? addMonths(s.month, -1) : s.month;
    if (first < minMonth) first = minMonth;
    if (addMonths(first, n - 1) > maxMonth)
      first = addMonths(maxMonth, -(n - 1)) < minMonth ? minMonth : addMonths(maxMonth, -(n - 1));
    var months = [];
    for (var i = 0; i < n; i++) months.push(addMonths(first, i));
    var nav = h('div', { class: 'hrp-nav' }, [
      h('button', {
        type: 'button',
        class: 'icon-btn',
        'aria-label': 'Previous month',
        'data-k': 'prev',
        disabled: first <= minMonth,
        text: '‹',
        onclick: function () {
          s.month = addMonths(first, n === 2 ? 0 : -1);
          rerender('prev');
        },
      }),
      h('button', {
        type: 'button',
        class: 'icon-btn',
        'aria-label': 'Next month',
        'data-k': 'next',
        disabled: addMonths(first, n - 1) >= maxMonth,
        text: '›',
        onclick: function () {
          s.month = addMonths(first, n === 2 ? 2 : 1);
          rerender('next');
        },
      }),
    ]);
    var cal = h('div', { class: 'hrp-cal' }, [
      nav,
      h(
        'div',
        { class: 'hrp-months', style: 'grid-template-columns:repeat(' + n + ',minmax(0,1fr))' },
        months.map(function (ym) {
          return monthGrid(ym, min);
        }),
      ),
    ]);

    // Comparison
    var cmpRange = s.mode === 'previous' ? previousPeriod(s.range) : s.mode === 'custom' ? s.compare : null;
    var compare = h('div', { class: 'hrp-compare' }, [
      h('span', { class: 'filter-label', text: 'Compare to' }),
      h(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': 'Compare to' },
        [
          ['previous', 'Previous period'],
          ['custom', 'Custom range'],
          ['off', 'No comparison'],
        ].map(function (m) {
          return h('button', {
            type: 'button',
            'data-k': 'm-' + m[0],
            'aria-pressed': s.mode === m[0] ? 'true' : 'false',
            text: m[1],
            onclick: function () {
              s.mode = m[0];
              if (m[0] === 'custom') {
                if (!s.compare) s.compare = clamp(previousPeriod(s.range), s.min.compare, s.latest);
                s.target = 'compare';
                if (s.compare) s.month = monthOf(s.compare.to);
              } else s.target = 'range';
              s.anchorDay = null;
              rerender('m-' + m[0]);
            },
          });
        }),
      ),
    ]);

    var notes = h('div', { class: 'hrp-notes' }, summaryNotes(cmpRange));

    var apply_ = h('button', {
      type: 'button',
      class: 'hrp-btn primary',
      disabled: s.mode === 'custom' && !s.compare,
      text: 'Apply',
      onclick: apply,
    });
    var foot = h('div', { class: 'hrp-foot' }, [
      h('div', { class: 'hrp-legend', 'aria-hidden': 'true' }, [
        h('span', null, [h('i', { class: 'dot' }), 'All channels spending']),
        h('span', null, [h('i', { class: 'dot part' }), 'Some channels']),
        h('span', null, [h('i', { class: 'swatch cmp' }), 'Comparison']),
      ]),
      h('div', { class: 'hrp-actions' }, [
        h('button', {
          type: 'button',
          class: 'hrp-btn',
          text: 'Cancel',
          onclick: function () {
            close(true);
          },
        }),
        apply_,
      ]),
    ]);

    el.appendChild(
      h('div', { class: 'hrp-body' }, [
        quick,
        h('div', { class: 'hrp-main' }, [targets, fields, cal, compare, notes]),
      ]),
    );
    el.appendChild(foot);
    if (fresh) place();
  }

  function dateField(id, label, value, min, max, onChange) {
    return h('label', { class: 'hrp-field', for: id }, [
      h('span', { class: 'sr-only', text: label }),
      h('input', {
        id: id,
        type: 'date',
        value: value,
        min: min,
        max: max,
        onchange: function (e) {
          var v = e.target.value;
          if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= min && v <= max) onChange(v);
        },
      }),
    ]);
  }

  function monthGrid(ym, min) {
    var y = Number(ym.slice(0, 4));
    var mi = Number(ym.slice(5, 7)) - 1;
    var start = ym + '-01';
    var cells = DOW.map(function (d) {
      return h('span', { class: 'hrp-dow', 'aria-hidden': 'true', text: d });
    });
    for (var i = 0; i < weekday(start); i++) cells.push(h('span', { class: 'hrp-pad' }));
    var r = s.range;
    var c = s.mode === 'previous' ? previousPeriod(s.range) : s.mode === 'custom' ? s.compare : null;
    // While a two-click pick is in progress, preview up to the hovered day.
    var preview = s.anchorDay && s.hover ? order(s.anchorDay, s.hover) : null;
    var editing = s.target === 'compare' ? 'c' : 'r';
    for (var d = start; monthOf(d) === ym; d = addDays(d, 1)) {
      var sel = editing === 'r' && preview ? preview : r;
      var cmpSel = editing === 'c' && preview ? preview : c;
      var inR = sel && d >= sel.from && d <= sel.to;
      var inC = cmpSel && d >= cmpSel.from && d <= cmpSel.to;
      var chans = s.cov[d] ? Object.keys(s.cov[d]) : [];
      var disabled = d < min || d > s.latest;
      var cls = ['hrp-day'];
      if (inR) cls.push('in');
      if (inR && d === sel.from) cls.push('start');
      if (inR && d === sel.to) cls.push('end');
      if (inC) cls.push('cmp');
      if (inC && d === cmpSel.from) cls.push('cstart');
      if (inC && d === cmpSel.to) cls.push('cend');
      var label =
        fmt(d, true) +
        (chans.length
          ? ': ' +
            chans
              .map(function (k) {
                return CHANNELS[k] || k;
              })
              .join(', ')
          : ': no spend');
      cells.push(
        h(
          'button',
          {
            type: 'button',
            class: cls.join(' '),
            'data-day': d,
            tabindex: d === s.focus ? '0' : '-1',
            disabled: disabled,
            'aria-pressed': inR ? 'true' : 'false',
            'aria-label': label,
            title: label,
            onclick: pickHandler(d),
            onmouseenter: hoverHandler(d),
            onkeydown: keyHandler(d),
          },
          [
            h('span', { text: String(Number(d.slice(8, 10))) }),
            chans.length ? h('i', { class: chans.length < s.maxChannels ? 'dot part' : 'dot' }) : null,
          ],
        ),
      );
    }
    return h('div', { class: 'hrp-month' }, [
      h('div', { class: 'hrp-month-head', text: MONTHS_LONG[mi] + ' ' + y }),
      h('div', { class: 'hrp-grid', role: 'group', 'aria-label': MONTHS_LONG[mi] + ' ' + y }, cells),
    ]);
  }

  function pickHandler(d) {
    return function () {
      pickDay(d);
    };
  }
  function hoverHandler(d) {
    return function () {
      if (s && s.anchorDay && s.hover !== d) {
        s.hover = d;
        render();
        focusDay(s.focus, true);
      }
    };
  }
  function keyHandler(d) {
    return function (e) {
      var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      var next = null;
      if (step) next = addDays(d, step);
      else if (e.key === 'Home') next = addDays(d, -weekday(d));
      else if (e.key === 'End') next = addDays(d, 6 - weekday(d));
      else if (e.key === 'PageUp') next = addDays(d, -28);
      else if (e.key === 'PageDown') next = addDays(d, 28);
      if (!next) return;
      e.preventDefault();
      var min = s.min[s.target];
      if (next < min) next = min;
      if (next > s.latest) next = s.latest;
      s.focus = next;
      if (s.anchorDay) s.hover = next;
      var shown = el.querySelector('[data-day="' + next + '"]');
      if (!shown) s.month = monthOf(next);
      render();
      focusDay(next);
    };
  }

  function focusDay(day, quiet) {
    if (!el) return;
    var b =
      el.querySelector('[data-day="' + day + '"]:not([disabled])') ||
      el.querySelector('.hrp-day:not([disabled])');
    if (b && !quiet) b.focus();
  }

  function summaryNotes(cmp) {
    var out = [];
    var r = s.range;
    out.push(
      h('p', { class: 'hrp-note' }, [
        h('strong', { text: fmtRange(r) }),
        ' · ' + daysIn(r.from, r.to) + ' days, ' + daysWithData(r) + ' with data',
      ]),
    );
    if (cmp) {
      out.push(
        h('p', { class: 'hrp-note' }, [
          'vs ',
          h('strong', { text: fmtRange(cmp) }),
          ' · ' + daysIn(cmp.from, cmp.to) + ' days, ' + daysWithData(cmp) + ' with data',
        ]),
      );
      var have = channelsIn(r);
      var cmpHave = channelsIn(cmp);
      var missing = Object.keys(have).filter(function (k) {
        return !cmpHave[k];
      });
      if (missing.length)
        out.push(
          h('p', {
            class: 'hrp-note warn',
            text:
              'Nothing to compare for ' +
              missing
                .map(function (k) {
                  return CHANNELS[k] || k;
                })
                .join(', ') +
              ': no spend in the comparison range.',
          }),
        );
      if (daysIn(cmp.from, cmp.to) !== daysIn(r.from, r.to))
        out.push(
          h('p', {
            class: 'hrp-note warn',
            text: 'The ranges are different lengths: totals compare unevenly; rates like CPI and CTR still compare.',
          }),
        );
    }
    return out;
  }

  /** Below the Custom button, kept inside the page's side gutters. */
  function place() {
    if (!el || !anchor) return;
    var a = anchor.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var w = el.offsetWidth;
    var left = Math.min(Math.max(16, a.left), Math.max(16, vw - 16 - w));
    el.style.left = left + window.scrollX + 'px';
    el.style.top = a.bottom + window.scrollY + 8 + 'px';
  }

  window.__harkOpenRange = function (btn) {
    if (el) close(false);
    else open(btn);
  };
  // Live data can arrive while the picker is open: refresh its coverage dots.
  window.__harkOnDash = function (d) {
    if (!el || !s || !d || !d.dataset) return;
    var rows = d.dataset.rows;
    if (rows === s.rows) return;
    s.rows = rows;
    Promise.resolve().then(function () {
      if (!s) return;
      s.cov = coverage(rows);
      s.dates = rowDates(rows);
      s.latest = d.bounds ? d.bounds.last : s.latest;
      render();
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
