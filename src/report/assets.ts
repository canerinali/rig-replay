/** Inline stylesheet for the report. No external fonts, images or URLs. */
export const CSS = String.raw`
:root {
  --bg: #fbfaf8; --fg: #1d1d1f; --muted: #6b6b70; --line: #e4e2dd; --panel: #ffffff;
  --claude: #c8643b; --codex: #0f8a6a; --high: #c62828; --low: #b7791f; --hl: #fff4c2;
  --k-prompt: #3b6fd6; --k-tool_call: #8a8a8f; --k-file_edit: #8e44ad; --k-shell: #1f9d55; --k-result: #aaaaaa;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161618; --fg: #ececf0; --muted: #9a9aa2; --line: #2d2d33; --panel: #1e1e22;
    --claude: #e08a64; --codex: #3cc49c; --high: #ff6b6b; --low: #f0b44c; --hl: #4a4020;
    --k-prompt: #6d9bff; --k-tool_call: #9a9aa2; --k-file_edit: #c07ee0; --k-shell: #4cc486; --k-result: #777;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1280px; margin: 0 auto; padding: 20px 16px 48px; }
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 28px 0 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.sub { color: var(--muted); margin: 2px 0; }
.mono, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
.stats { display: flex; flex-wrap: wrap; gap: 8px 22px; margin-top: 10px; }
.stats b { font-size: 16px; }
.note { font-size: 12.5px; color: var(--muted); margin-top: 8px; }
.warn { border-left: 4px solid var(--low); margin: 0 0 8px; }
.warn.high { border-left-color: var(--high); }
.badge { display: inline-block; font-size: 11px; font-weight: 600; text-transform: uppercase; padding: 1px 7px; border-radius: 10px; color: #fff; background: var(--low); margin-right: 8px; }
.badge.high { background: var(--high); }
.warn .title { font-weight: 600; }
.warn .detail { margin: 4px 0; }
.ev-links a { margin-right: 8px; font-size: 12px; }
a { color: var(--k-prompt); }
.empty { color: var(--muted); font-style: italic; }
#timeline { overflow-x: auto; }
#timeline svg { display: block; }
#timeline .dot { cursor: pointer; }
#timeline .dot.warned { stroke: var(--high); stroke-width: 2.5; }
#timeline .brk { fill: var(--line); }
.filters { display: flex; flex-wrap: wrap; gap: 10px 20px; align-items: center; }
.filters label { white-space: nowrap; }
.filters select, .filters input[type=search] { font: inherit; padding: 3px 6px; background: var(--panel); color: var(--fg); border: 1px solid var(--line); border-radius: 5px; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin: 0 4px 0 2px; vertical-align: -1px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: 12px; color: var(--muted); font-weight: 600; position: sticky; top: 0; background: var(--bg); }
td.files { max-width: 280px; word-break: break-all; }
td.summary { max-width: 460px; word-break: break-word; }
tr.warned td:first-child { box-shadow: inset 3px 0 0 var(--high); }
tr.hl td { background: var(--hl); }
.lane-claude { color: var(--claude); }
.lane-codex { color: var(--codex); }
.fail { color: var(--high); font-weight: 600; }
.ok { color: var(--k-shell); }
.outside { color: var(--muted); font-style: italic; }
footer { margin-top: 32px; }
footer table { width: auto; }
footer td.num, footer th.num { text-align: right; }
`;

/**
 * Client script. Reads the embedded JSON and builds the page. All data-derived strings are inserted
 * with textContent / setAttribute, never innerHTML. Kept free of backticks so it can live in a template.
 */
export const CLIENT_JS = String.raw`
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('rig-data').textContent);
  var SVGNS = 'http://www.w3.org/2000/svg';
  var KINDS = ['prompt', 'tool_call', 'file_edit', 'shell', 'result'];
  var GAP_MS = 30 * 60 * 1000;
  var lanesById = {};
  data.lanes.forEach(function (l) { lanesById[l.id] = l; });
  var warnedIds = {};
  data.warnings.forEach(function (w) { w.evidence.forEach(function (id) { warnedIds[id] = true; }); });

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'cls') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function svg(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function fmt(ms) { return ms ? new Date(ms).toLocaleString() : '-'; }
  function fmtTime(ms) { return new Date(ms).toLocaleTimeString(); }
  function fmtDate(ms) { return new Date(ms).toLocaleDateString(); }
  function num(n) { return Number(n || 0).toLocaleString(); }
  function usd(n) { return n === null || n === undefined ? 'no price' : '$' + n.toFixed(n < 1 ? 4 : 2); }

  // ---------- header ----------
  var hdr = document.getElementById('hdr');
  hdr.appendChild(el('h1', { text: 'rig-replay: ' + data.repo.root }));
  if (data.repo.worktrees.length) hdr.appendChild(el('div', { cls: 'sub', text: 'worktrees: ' + data.repo.worktrees.join(', ') }));
  hdr.appendChild(el('div', { cls: 'sub', text: 'activity ' + fmt(data.range.firstMs) + ' to ' + fmt(data.range.lastMs) +
    (data.range.sinceMs ? ' (since ' + fmt(data.range.sinceMs) + ')' : ' (all time)') + ', generated ' + new Date(data.generatedAt).toLocaleString() }));
  var s = data.stats;
  var stats = el('div', { cls: 'stats' });
  [['claude sessions', s.claudeSessions + (s.claudeSubagents ? ' (+' + s.claudeSubagents + ' subagents)' : '')],
   ['claude events', s.claudeEvents], ['codex sessions', s.codexSessions], ['codex events', s.codexEvents],
   ['warnings', data.warnings.length], ['estimated cost', usd(data.cost.totalUsd)]].forEach(function (p) {
    stats.appendChild(el('span', null, [el('b', { text: String(p[1]) }), ' ' + p[0]]));
  });
  hdr.appendChild(stats);
  hdr.appendChild(el('div', { cls: 'note', text: 'Attribution is based on edits observed in logs (tool-level edits only). ' +
    'Warnings are heuristics: a possible conflict is two sessions editing the same file close together, not proof of lost work.' +
    (data.options.redacted ? ' Prompt and command text is redacted.' : '') }));

  // ---------- filters state ----------
  var state = { file: '', kinds: {}, lanes: {}, q: '' };
  KINDS.forEach(function (k) { state.kinds[k] = true; });
  data.lanes.forEach(function (l) { state.lanes[l.id] = true; });

  function visible(e) {
    if (!state.kinds[e.kind] || !state.lanes[e.laneId]) return false;
    if (state.file && e.files.indexOf(state.file) < 0) return false;
    if (state.q) {
      var hay = (e.summary + ' ' + e.files.join(' ') + ' ' + (e.tool || '') + ' ' + lanesById[e.laneId].label).toLowerCase();
      if (hay.indexOf(state.q) < 0) return false;
    }
    return true;
  }

  // ---------- warnings ----------
  var wl = document.getElementById('warnings');
  if (!data.warnings.length) wl.appendChild(el('div', { cls: 'empty', text: 'No possible conflicts or loops found with the current settings.' }));
  data.warnings.forEach(function (w) {
    var links = el('div', { cls: 'ev-links' }, [el('span', { cls: 'sub', text: 'evidence: ' })]);
    w.evidence.forEach(function (id, i) {
      var a = el('a', { href: '#ev-' + id, text: '#' + (i + 1) });
      a.addEventListener('click', function (ev) { ev.preventDefault(); focusEvent(id, w.file); });
      links.appendChild(a);
    });
    wl.appendChild(el('div', { cls: 'panel warn ' + w.severity, id: 'w-' + w.id }, [
      el('span', { cls: 'badge ' + w.severity, text: w.severity }),
      el('span', { cls: 'title', text: w.title }),
      el('div', { cls: 'detail', text: w.detail }),
      el('div', { cls: 'sub', text: w.kind + ', ' + fmtTime(w.startMs) + ' to ' + fmtTime(w.endMs) }),
      links
    ]));
  });

  // ---------- timeline ----------
  var dots = {};
  function buildTimeline() {
    var box = document.getElementById('timeline');
    if (!data.events.length) { box.appendChild(el('div', { cls: 'empty', text: 'No events in range.' })); return; }
    var LABEL = 230, ROW = 24, BRK = 26, PAD = 12;
    var width = Math.max(720, Math.min(1600, box.clientWidth || 1000));
    var times = data.events.map(function (e) { return e.tsMs; }).sort(function (a, b) { return a - b; });
    var segs = [{ a: times[0], b: times[0] }];
    for (var i = 1; i < times.length; i++) {
      var cur = segs[segs.length - 1];
      if (times[i] - cur.b > GAP_MS) segs.push({ a: times[i], b: times[i] }); else cur.b = times[i];
    }
    var active = segs.reduce(function (t, sg) { return t + (sg.b - sg.a); }, 0);
    var avail = width - LABEL - PAD * 2 - BRK * (segs.length - 1);
    var perSeg = active === 0 ? avail / segs.length : 0;
    var scale = active === 0 ? 0 : avail / active;
    var x0 = [], xx = LABEL + PAD;
    segs.forEach(function (sg, idx) {
      x0.push(xx);
      xx += (active === 0 ? perSeg : (sg.b - sg.a) * scale) + (idx < segs.length - 1 ? BRK : 0);
    });
    function xOf(t) {
      for (var k = 0; k < segs.length; k++) {
        var sg = segs[k];
        if (t >= sg.a && t <= sg.b) return x0[k] + (active === 0 ? perSeg / 2 : (t - sg.a) * scale);
      }
      return x0[0];
    }
    var height = data.lanes.length * ROW + 34;
    var root = svg('svg', { width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, role: 'img' });
    root.appendChild(svg('title', {})).textContent = 'Timeline: one row per lane, one dot per event';
    var laneY = {};
    data.lanes.forEach(function (l, i) {
      var y = 14 + i * ROW + ROW / 2;
      laneY[l.id] = y;
      var t = svg('text', { x: 6, y: y + 4, 'font-size': 12, fill: 'var(--' + l.agent + ')' });
      t.textContent = l.label;
      root.appendChild(t);
      root.appendChild(svg('line', { x1: LABEL, x2: width - PAD, y1: y, y2: y, stroke: 'var(--line)' }));
    });
    for (var b = 0; b < segs.length - 1; b++) {
      var bx = x0[b + 1] - BRK;
      root.appendChild(svg('rect', { x: bx + 4, y: 8, width: BRK - 8, height: height - 34, 'class': 'brk', rx: 3 }));
      var gt = svg('title', {});
      gt.textContent = 'idle gap compressed';
      root.lastChild.appendChild(gt);
    }
    segs.forEach(function (sg, k) {
      var lab = svg('text', { x: x0[k], y: height - 8, 'font-size': 11, fill: 'var(--muted)' });
      lab.textContent = fmtTime(sg.a);
      root.appendChild(lab);
      var xe = xOf(sg.b);
      if (sg.b > sg.a && xe - x0[k] > 140) {
        var end = svg('text', { x: xe, y: height - 8, 'font-size': 11, fill: 'var(--muted)', 'text-anchor': 'end' });
        end.textContent = fmtTime(sg.b);
        root.appendChild(end);
      }
    });
    data.events.forEach(function (e) {
      var c = svg('circle', { cx: xOf(e.tsMs).toFixed(1), cy: laneY[e.laneId], r: 4.5, fill: 'var(--k-' + e.kind + ')',
        'class': 'dot' + (warnedIds[e.id] ? ' warned' : '') });
      var tt = svg('title', {});
      tt.textContent = fmtTime(e.tsMs) + ' ' + e.kind + ': ' + e.summary + (e.files.length ? ' [' + e.files.join(', ') + ']' : '');
      c.appendChild(tt);
      c.addEventListener('click', function () { focusEvent(e.id, null); });
      dots[e.id] = c;
      root.appendChild(c);
    });
    box.appendChild(root);
  }

  // ---------- filters ----------
  function buildFilters() {
    var f = document.getElementById('filters');
    var counts = {};
    data.events.forEach(function (e) {
      if (e.kind !== 'file_edit') return;
      e.files.forEach(function (p) { if (p.charAt(0) !== '/') counts[p] = (counts[p] || 0) + 1; });
    });
    var sel = el('select', { id: 'f-file' }, [el('option', { value: '', text: 'All files' })]);
    Object.keys(counts).sort().forEach(function (p) { sel.appendChild(el('option', { value: p, text: p + ' (' + counts[p] + ' edits)' })); });
    sel.addEventListener('change', function () { state.file = sel.value; apply(); });
    f.appendChild(el('label', null, ['File ', sel]));
    var kinds = el('span');
    KINDS.forEach(function (k) {
      var cb = el('input', { type: 'checkbox' }); cb.checked = true;
      cb.addEventListener('change', function () { state.kinds[k] = cb.checked; apply(); });
      var sw = el('span', { cls: 'swatch' }); sw.style.background = 'var(--k-' + k + ')';
      kinds.appendChild(el('label', null, [cb, sw, k, ' ']));
    });
    f.appendChild(kinds);
    var lanes = el('span');
    data.lanes.forEach(function (l) {
      var cb = el('input', { type: 'checkbox' }); cb.checked = true;
      cb.addEventListener('change', function () { state.lanes[l.id] = cb.checked; apply(); });
      lanes.appendChild(el('label', { cls: 'lane-' + l.agent }, [cb, l.label, ' ']));
    });
    f.appendChild(lanes);
    var q = el('input', { type: 'search', placeholder: 'search text' });
    q.addEventListener('input', function () { state.q = q.value.trim().toLowerCase(); apply(); });
    f.appendChild(q);
  }

  // ---------- table ----------
  var rows = {};
  function buildTable() {
    var tb = document.getElementById('events-body');
    var lastDay = '';
    data.events.forEach(function (e) {
      var lane = lanesById[e.laneId];
      var day = fmtDate(e.tsMs);
      var timeText = (day !== lastDay ? day + ' ' : '') + fmtTime(e.tsMs);
      lastDay = day;
      var files = el('td', { cls: 'files mono' });
      e.files.forEach(function (p, i) {
        if (i) files.appendChild(document.createTextNode(', '));
        files.appendChild(el('span', { cls: p.charAt(0) === '/' ? 'outside' : '', text: p }));
      });
      var status = e.ok === true ? el('span', { cls: 'ok', text: 'ok' }) : e.ok === false ? el('span', { cls: 'fail', text: 'failed' }) : el('span', { cls: 'sub', text: '-' });
      var tr = el('tr', { id: 'ev-' + e.id, cls: warnedIds[e.id] ? 'warned' : '' }, [
        el('td', { cls: 'mono', text: timeText }),
        el('td', { cls: 'lane-' + e.agent, text: lane ? lane.label : e.laneId }),
        el('td', { text: e.kind + (e.tool ? ' / ' + e.tool : '') }),
        files,
        el('td', { cls: 'summary', text: e.summary }),
        el('td', null, [status]),
        el('td', { cls: 'mono sub', text: e.src.file + ':' + e.src.line })
      ]);
      rows[e.id] = tr;
      tb.appendChild(tr);
    });
  }

  function apply() {
    var shown = 0;
    data.events.forEach(function (e) {
      var v = visible(e);
      if (v) shown++;
      if (rows[e.id]) rows[e.id].style.display = v ? '' : 'none';
      if (dots[e.id]) dots[e.id].style.display = v ? '' : 'none';
    });
    document.getElementById('shown').textContent = shown + ' of ' + data.events.length + ' events shown';
  }

  function focusEvent(id, file) {
    var sel = document.getElementById('f-file');
    if (file && sel) {
      var has = Array.prototype.some.call(sel.options, function (o) { return o.value === file; });
      if (has) { sel.value = file; state.file = file; }
    }
    var e = null;
    for (var i = 0; i < data.events.length; i++) if (data.events[i].id === id) { e = data.events[i]; break; }
    if (e && !visible(e)) {
      state.q = ''; state.kinds[e.kind] = true; state.lanes[e.laneId] = true;
      if (state.file && e.files.indexOf(state.file) < 0) { state.file = ''; if (sel) sel.value = ''; }
      syncChecks();
    }
    apply();
    var row = rows[id];
    if (!row) return;
    Object.keys(rows).forEach(function (k) { rows[k].classList.remove('hl'); });
    row.classList.add('hl');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (history.replaceState) history.replaceState(null, '', '#ev-' + id);
  }

  function syncChecks() {
    var boxes = document.querySelectorAll('#filters input[type=checkbox]');
    var i = 0;
    KINDS.forEach(function (k) { boxes[i++].checked = state.kinds[k]; });
    data.lanes.forEach(function (l) { boxes[i++].checked = state.lanes[l.id]; });
    var q = document.querySelector('#filters input[type=search]');
    if (q) q.value = state.q;
  }

  // ---------- footer ----------
  function buildFooter() {
    var tok = document.getElementById('tokens');
    var models = Object.keys(data.tokens.byModel).sort();
    if (!models.length) tok.appendChild(el('div', { cls: 'empty', text: 'No token usage recorded.' }));
    else {
      var costBy = {};
      data.cost.lines.forEach(function (c) { costBy[c.model] = c; });
      var t = el('table', null, [el('tr', null, ['model', 'input', 'output', 'cache read', 'cache write', 'estimated cost', 'price entry'].map(function (h, i) {
        return el('th', { cls: i && i < 6 ? 'num' : '', text: h });
      }))]);
      models.forEach(function (m) {
        var u = data.tokens.byModel[m], c = costBy[m] || { usd: null };
        t.appendChild(el('tr', null, [el('td', { cls: 'mono', text: m }), el('td', { cls: 'num', text: num(u.input) }), el('td', { cls: 'num', text: num(u.output) }),
          el('td', { cls: 'num', text: num(u.cacheRead) }), el('td', { cls: 'num', text: num(u.cacheWrite) }),
          el('td', { cls: 'num', text: usd(c.usd) }), el('td', { cls: 'mono sub', text: c.priceKey || '-' })]));
      });
      tok.appendChild(t);
      tok.appendChild(el('div', { cls: 'note', text: 'Total estimated cost: ' + usd(data.cost.totalUsd) + ' (price table: ' + data.cost.source + ', as of ' + data.cost.priceTable.asOf + '). Estimates only; your actual bill depends on plan, discounts and tokens not visible in logs.' }));
    }
    var pt = document.getElementById('prices');
    var t2 = el('table', null, [el('tr', null, ['match', 'input / MTok', 'output / MTok', 'cache read / MTok', 'cache write / MTok'].map(function (h, i) {
      return el('th', { cls: i ? 'num' : '', text: h });
    }))]);
    data.cost.priceTable.models.forEach(function (p) {
      t2.appendChild(el('tr', null, [el('td', { cls: 'mono', text: p.match }), el('td', { cls: 'num', text: '$' + p.inputPerMTok }), el('td', { cls: 'num', text: '$' + p.outputPerMTok }),
        el('td', { cls: 'num', text: '$' + p.cacheReadPerMTok }), el('td', { cls: 'num', text: '$' + p.cacheWritePerMTok })]));
    });
    pt.appendChild(el('div', { cls: 'sub', text: 'Price table (' + data.cost.priceTable.currency + ', as of ' + data.cost.priceTable.asOf + ', source: ' + data.cost.source + ')' }));
    pt.appendChild(t2);
    var notes = document.getElementById('notes');
    if (!data.notes.length) notes.appendChild(el('div', { cls: 'empty', text: 'No parser notes.' }));
    else {
      var ul = el('ul', { cls: 'mono' });
      data.notes.forEach(function (n) { ul.appendChild(el('li', { text: n })); });
      notes.appendChild(ul);
    }
  }

  buildFilters();
  buildTimeline();
  buildTable();
  buildFooter();
  apply();
  if (location.hash.indexOf('#ev-') === 0) focusEvent(decodeURIComponent(location.hash.slice(4)), null);
})();
`;
