/* Launch Radar — the board page. Reads window.RADAR (written beside this page
   by the radar program from the same board as board.json) and renders a
   sortable, filterable board with a detail view per protocol. No network,
   no framework: the page is the program's own output, rendered as-is. */
(function () {
  'use strict';

  var data = window.RADAR;
  var rowsEl = document.getElementById('rows');
  var detailEl = document.getElementById('detail');
  var showingEl = document.getElementById('showing');
  var emptyEl = document.getElementById('empty');
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('cat');
  var chainEl = document.getElementById('chain');
  var watchEl = document.getElementById('watch');
  var risingEl = document.getElementById('rising');

  var state = { sortKey: 'rank', sortDir: 1, selected: null };

  function fmtUsd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(v) {
    if (v === null || v === undefined) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unreported';
    if (days < 60) return days + 'd';
    if (days < 730) return Math.round(days / 30.4) + ' mo';
    return (days / 365.25).toFixed(1) + ' yrs';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- header: the sweep's own numbers ---------- */
  var meta = data.meta;
  document.getElementById('as-of').textContent = meta.as_of;
  var stats = [
    ['Protocols scanned', meta.scanned],
    ['On the board', meta.board_size],
    ['Watchlist covered', meta.watchlist_covered + ' / ' + meta.watchlist_size],
    ['Tokens set aside', meta.tokenised],
    ['Shells set aside', meta.shells]
  ];
  document.getElementById('stats').innerHTML = stats
    .map(function (s) { return '<div><dt>' + esc(s[0]) + '</dt><dd>' + esc(s[1]) + '</dd></div>'; })
    .join('');
  document.getElementById('model-text').innerHTML =
    '<b>Implied value = TVL × peer multiple × momentum × maturity.</b> ' +
    esc(data.model.summary.replace(/^Implied value = [^.]*\. /, ''));
  document.getElementById('watch-hint').textContent =
    '(the house floor: TVL at or above ' + fmtUsd(meta.floor_usd) + ', no token recorded)';

  /* ---------- filter options, built from the data itself ---------- */
  function fillSelect(el, values, allLabel) {
    el.innerHTML = '<option value="">' + esc(allLabel) + '</option>' + values
      .map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; })
      .join('');
  }
  var cats = [];
  var chains = [];
  data.rows.forEach(function (r) {
    var c = r.category || '(none)';
    if (cats.indexOf(c) === -1) cats.push(c);
    r.chains.forEach(function (ch) { if (chains.indexOf(ch) === -1) chains.push(ch); });
  });
  cats.sort();
  chains.sort();
  fillSelect(catEl, cats, 'All categories');
  fillSelect(chainEl, chains, 'All chains');

  /* ---------- the board ---------- */
  function visibleRows() {
    var q = qEl.value.trim().toLowerCase();
    var cat = catEl.value;
    var chain = chainEl.value;
    var out = data.rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      if (cat && (r.category || '(none)') !== cat) return false;
      if (chain && r.chains.indexOf(chain) === -1) return false;
      if (watchEl.checked && !r.watchlist) return false;
      if (risingEl.checked && !(r.change_7d !== null && r.change_7d > 0)) return false;
      return true;
    });
    var key = state.sortKey;
    var dir = state.sortDir;
    out.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return dir * av.localeCompare(bv);
      return dir * (av - bv);
    });
    return out;
  }

  function render() {
    var rows = visibleRows();
    showingEl.innerHTML = 'Showing <b>' + rows.length + '</b> of ' + data.rows.length +
      ' ranked protocols — sorted by ' + state.sortKey.replace(/_/g, ' ') +
      (state.sortDir === 1 ? ' ascending' : ' descending') + '. Click a row for its detail and farm plan.';
    emptyEl.hidden = rows.length !== 0;
    rowsEl.innerHTML = rows.map(function (r) {
      var chainText = r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '');
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' +
        (r.watchlist ? '<span class="badge">watchlist</span>' : '') +
        '<span class="pslug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '<span class="chains">' + esc(chainText) + '</span></td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num value">' + fmtUsd(r.implied_value_usd) + '</td>' +
        '</tr>';
    }).join('');
    var ths = document.querySelectorAll('thead th');
    ths.forEach(function (th) {
      var on = th.getAttribute('data-key') === state.sortKey;
      th.classList.toggle('sorted', on);
      if (on) th.textContent = th.textContent.replace(/ [▲▼]$/, '') + (state.sortDir === 1 ? ' ▲' : ' ▼');
      else th.textContent = th.textContent.replace(/ [▲▼]$/, '');
    });
  }

  /* ---------- detail view ---------- */
  function showDetail(slug) {
    var r = null;
    data.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    state.selected = slug;
    var plan = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    detailEl.innerHTML =
      '<p class="kicker">Rank #' + r.rank + (r.watchlist ? ' · on the watchlist' : ' · early, below the house floor') + '</p>' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="dslug">' + esc(r.slug) + ' · ' + esc(r.category || 'no category recorded') + '</p>' +
      '<p class="big-value">' + fmtUsd(r.implied_value_usd) + '</p>' +
      '<p class="big-label">Implied launch value — the board\u2019s own claim</p>' +
      '<dl class="facts">' +
      '<div><dt>TVL</dt><dd>' + fmtUsd(r.tvl_usd) + '</dd></div>' +
      '<div><dt>TVL change, 7d</dt><dd>' + fmtPct(r.change_7d) + '</dd></div>' +
      '<div><dt>Tracked since</dt><dd>' + esc(r.listed_at || 'unreported') + '</dd></div>' +
      '<div><dt>Tracked for</dt><dd>' + fmtAge(r.age_days) + '</dd></div>' +
      '<div><dt>Chains</dt><dd>' + r.chains.length + '</dd></div>' +
      '<div><dt>Token recorded</dt><dd>none</dd></div>' +
      '</dl>' +
      '<h3>How the value is built</h3>' +
      '<p class="formula">' + fmtUsd(r.tvl_usd) + ' TVL × ' + r.peer_multiple.toFixed(2) + ' peer multiple × ' +
      r.momentum_factor.toFixed(2) + ' momentum × ' + r.maturity_factor.toFixed(2) + ' maturity = ' +
      fmtUsd(r.implied_value_usd) + '</p>' +
      '<p class="note">The peer multiple is the median market-cap-to-TVL ratio of tokenised ' +
      esc(r.category || 'uncategorised') + ' protocols in the same snapshot, shrunk toward the global median of ' +
      meta.global_multiple.toFixed(2) + '. Live on ' + esc(r.chains.join(', ')) + '.</p>' +
      '<h3>Farm plan — before any token exists</h3>' +
      '<ol class="plan">' + plan + '</ol>' +
      '<p class="note">' + esc(r.name) + ' records no token in the snapshot of ' + esc(meta.as_of) +
      '; that is DefiLlama\u2019s record, not proof it has none. The plan assumes a launch rewards real, ' +
      'sustained use — the only signal a pre-token protocol can keep.</p>';
    render();
  }

  detailEl.innerHTML = '<p class="placeholder">Pick any protocol on the board and its record, the ' +
    'workings of its implied value and its farm plan appear here. The radar\u2019s first contact, ' +
    'rank #1, is one click away.</p>';

  /* ---------- events ---------- */
  rowsEl.addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });
  [qEl, catEl, chainEl, watchEl, risingEl].forEach(function (el) {
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  });
  document.querySelectorAll('thead th.sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-key');
      if (state.sortKey === key) state.sortDir = -state.sortDir;
      else {
        state.sortKey = key;
        state.sortDir = key === 'name' || key === 'category' ? 1 : -1;
      }
      render();
    });
  });

  /* ---------- staged scenes for the entry's screenshots ----------
     ?shot=detail   opens the detail view of the board's rank #1
     ?shot=filtered watchlist-only, in the category holding most of the watchlist */
  var shot = new URLSearchParams(window.location.search).get('shot');
  if (shot === 'detail' && data.rows.length > 0) {
    showDetail(data.rows[0].slug);
  } else if (shot === 'filtered') {
    watchEl.checked = true;
    if (meta.shot_category) catEl.value = meta.shot_category;
    render();
  } else {
    render();
  }
})();
