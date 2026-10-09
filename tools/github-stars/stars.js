/* Star History — chart styled like star-history.com:
   smooth monotone curves, xkcd sketch filter, clean axes, floating legend.
   Rendered as inline SVG (no canvas), so hovering works on desktop + touch. */

try {
  window.addEventListener('error', function (ev) {
    const el = document.getElementById('inlineMsg');
    if (el && ev && ev.message) {
      el.style.display = 'block';
      el.textContent = 'Error: ' + ev.message;
    }
  });
} catch (e) { /* ignore */ }

// star-history palette (bright, hand-drawn feel)
var COLORS = ["#dd4528", "#28a3dd", "#f3db52", "#ed84b5", "#4ab74e", "#9179c0", "#8e6d5a", "#f19839", "#949494", "#1a9988"];
var DARK_COLORS = ["#ff6b6b", "#48dbfb", "#feca57", "#ff9ff3", "#1dd1a1", "#f368e0", "#ff9f43", "#a4b0be", "#576574", "#00d2d3"];
var MAX_REPOS = 6;
var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

var svg = document.getElementById('myChart');   // <svg> now
var tip = document.getElementById('tooltip');   // floating tooltip
var repos = [];
var filterId = 'xkcdify';
var hoverLine = null;   // vertical guide element
var lastGeom = null;    // {x0,x1,y0,y1} plot area for hit-testing

function $(id) { return document.getElementById(id); }
function bind(id, fn) { const el = $(id); if (el) el.addEventListener('click', fn); }

function init() {
  bind('addRepo', function () { addRepo(false); });
  bind('clearAll', clearAll);
  bind('addRepo2', function () { addRepo(true); });
  bind('clearAll2', clearAll);
  bind('copyLink', copyLink);
  bind('dlCsv', downloadCsv);
  bind('dlPng', downloadPng);
  hideLoader();
  try {
    new MutationObserver(function () { render(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (e) { /* old browsers */ }
  try {
    const qp = new URLSearchParams(window.location.search);
    const jobs = [];
    qp.getAll('github').forEach(function (s) { jobs.push(['01', s]); });
    qp.getAll('gitlab').forEach(function (s) { jobs.push(['02', s]); });
    qp.getAll('repo').forEach(function (r) {
      r = (r || '').trim();
      if (r.length >= 3) jobs.push([r.slice(0, 2) === '02' ? '02' : '01', r.slice(2)]);
    });
    (function next(i) {
      if (i >= jobs.length || i >= MAX_REPOS) { render(); return; }
      addRepoBySlug(jobs[i][0], jobs[i][1], function () { next(i + 1); });
    })(0);
  } catch (e) { render(); }
  render();
}

function cleanSlug(s) {
  return (s || '').trim()
    .replace(/^https?:\/\/[^/]+\//i, '')
    .replace(/^git(hub|lab)\.com\//i, '')
    .replace(/\s+/g, '-')
    .replace(/^\/+|\/+$/g, '');
}

function addRepo(isMobile) {
  const input = $(isMobile ? 'repoNameM' : 'repoName');
  const forms = document.getElementsByName('source');
  const sel = (isMobile && forms[1]) ? forms[1] : forms[0];
  const src = sel ? sel.options[sel.selectedIndex].value : '01';
  addRepoBySlug(src, cleanSlug(input ? input.value : ''), null);
}

function addRepoBySlug(source, slug, done) {
  const finish = function () { if (done) done(); };
  if (!slug) { showMsg('Type user/repo first (example: torvalds/linux)'); finish(); return; }
  if (slug.length > 160 || slug.indexOf('..') !== -1 || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/.test(slug)) {
    showMsg('Wrong format. Use: user/repo'); finish(); return;
  }
  if (source !== '02') source = '01';
  const key = source + '/' + slug.toLowerCase();
  for (const r of repos) {
    if (r.key === key) { showMsg('Already shown'); finish(); return; }
  }
  if (repos.length >= MAX_REPOS) { showMsg('Max ' + MAX_REPOS + ' — remove one (✕) first'); finish(); return; }
  showLoader();
  ajax('/v1/stars/?repo=' + source + encodeURIComponent(slug),
    function (data) {
      hideLoader();
      if (!Array.isArray(data)) { showMsg((data && data.Error) || 'Server error'); finish(); return; }
      if (!data.length) { showMsg('No stars yet'); finish(); return; }
      const pts = [];
      for (const p of data) {
        const x = Date.parse(p.x), y = Number(p.y);
        if (!isNaN(x) && isFinite(y) && y >= 0) pts.push({ x, y });
      }
      pts.sort(function (a, b) { return a.x - b.x; });
      if (!pts.length) { showMsg('No usable data'); finish(); return; }
      repos.push({
        key, slug,
        label: (source === '02' ? 'gitlab/' : 'github/') + slug,
        color: null, // assigned at render
        points: pts
      });
      clearMsg();
      syncUrl();
      render();
      finish();
    },
    function (err) { hideLoader(); showMsg(err); finish(); });
}

function clearAll() {
  repos = [];
  hideTip();
  syncUrl();
  render();
}

function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
function palette() { return isDark() ? DARK_COLORS : COLORS; }

// ---------- date helpers ----------
function fmtDate(ms, short) {
  const d = new Date(ms);
  if (isNaN(d)) return String(ms);
  if (short) return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
}

// Weekly star counts are extremely bursty (stdev ~= mean), so drawing every
// week on a multi-year chart reads as noise. Downsample to a target number of
// points (~5px apart) and collapse each bucket to its last value, which is
// monotonic-safe (a bucket's end value is always >= its start value).
function bucketPoints(points, plotWidthPx) {
  if (points.length < 3) return points;
  const spanDays = (points[points.length - 1].x - points[0].x) / 864e5;
  if (spanDays <= 0) return points;
  const target = Math.max(30, Math.min(200, Math.round(plotWidthPx / 5)));
  if (points.length <= target) return points;
  // pick the candidate bucket size whose resulting count is closest to target
  const sizes = [1, 7, 14, 30, 91, 182, 365, 730, 1825, 3650];
  let chosen = sizes[sizes.length - 1], bestErr = Infinity;
  for (let i = 0; i < sizes.length; i++) {
    const count = Math.ceil(spanDays / sizes[i]) + 1;
    if (count < 2) continue;
    const err = Math.abs(count - target);
    if (err < bestErr) { bestErr = err; chosen = sizes[i]; }
    if (count <= target && sizes[i + 1] && Math.ceil(spanDays / sizes[i + 1]) < target) break;
  }
  if (chosen <= 1) return points;
  const out = [];
  let bucketStart = null, last = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const b = Math.floor(Math.floor(p.x / 864e5) / chosen);
    if (b !== bucketStart) {
      if (last) out.push(last);       // close previous bucket at its last real value
      bucketStart = b;
    }
    last = p;
  }
  if (last) out.push(last);
  return out;
}
function fmtNum(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(v % 1e6 === 0 ? 0 : 1) + 'M';
  if (v >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k';
  return String(v);
}

// monotone-x cubic path (d3 curveMonotoneX equivalent)
function monotonePath(pts) {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return 'M' + pts[0].px + ',' + pts[0].py;
  if (n === 2) return 'M' + pts[0].px + ',' + pts[0].py + 'L' + pts[1].px + ',' + pts[1].py;
  // slopes
  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1].px - pts[i].px; dy[i] = pts[i + 1].py - pts[i].py; m[i] = dy[i] / (dx[i] || 1e-6); }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0;
    else {
      const w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1];
      t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
  }
  t[n - 1] = m[n - 2];
  let d = 'M' + pts[0].px + ',' + pts[0].py;
  for (let i = 0; i < n - 1; i++) {
    const x0 = pts[i].px, y0 = pts[i].py, x1 = pts[i + 1].px, y1 = pts[i + 1].py;
    const h = dx[i] / 3;
    d += 'C' + (x0 + h) + ',' + (y0 + t[i] * h) + ' ' + (x1 - h) + ',' + (y1 - t[i + 1] * h) + ' ' + x1 + ',' + y1;
  }
  return d;
}

function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

// ---------- render ----------
function render() {
  if (!svg) return;
  const pal = palette();
  repos.forEach(function (r, i) { r.color = pal[i % pal.length]; });
  renderChips();
  renderStats();
  const has = repos.length > 0;
  showBox(has);
  if (!has) { svg.innerHTML = ''; return; }

  const W = svg.clientWidth || 800;
  const H = svg.clientHeight || 420;
  const short0 = W < 560;
  // right margin must fit the last x label ("Sep 25, 2026" ~ 80px) + slack
  const m = { top: 30, right: short0 ? 12 : 78, bottom: 40, left: short0 ? 44 : 56 };
  const x0 = m.left, x1 = W - m.right, y0 = m.top, y1 = H - m.bottom;
  const pw = Math.max(10, x1 - x0), ph = Math.max(10, y1 - y0);

  // domains
  let dmin = Infinity, dmax = -Infinity, ymax = 0;
  repos.forEach(function (r) { r.points.forEach(function (p) { if (p.x < dmin) dmin = p.x; if (p.x > dmax) dmax = p.x; if (p.y > ymax) ymax = p.y; }); });
  if (dmax > Date.now()) dmax = Date.now();
  if (ymax <= 0) ymax = 1;
  const xSpan = Math.max(864e5, dmax - dmin);
  const sx = function (t) { return x0 + (t - dmin) / xSpan * pw; };
  const sy = function (v) { return y1 - v / ymax * ph; };

  // 5 y ticks (star-history uses 5)
  const yTicks = 5;
  let step = Math.pow(10, Math.floor(Math.log10(ymax / yTicks)));
  if (ymax / step < 2) step *= 1; else if (ymax / step < 5) step *= 2; else step *= 5;
  const yTop = Math.ceil(ymax / step) * step;

  // 5 x ticks
  const xTicks = 5;
  const xTickVals = [];
  for (let i = 0; i < xTicks; i++) xTickVals.push(dmin + (dmax - dmin) * i / (xTicks - 1));

  // read the design tokens so the chart can never drift from the page palette
  const tok = (name, fb) => {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v || '').trim() || fb;
    } catch (e) { return fb; }
  };
  const stroke = tok('--text', '#1f2328');
  const muted = tok('--muted', '#57606a');
  const grid = tok('--divider', '#d0d7de');
  const track = tok('--chart-track', '#eaeef2');
  const short = short0;

  // smooth the drawn series (full-resolution data is kept for the tooltip)
  const drawn = repos.map(function (r) { return bucketPoints(r.points, pw); });

  let out = '<defs><filter id="' + filterId + '" filterUnits="userSpaceOnUse" x="-5" y="-5" width="100%" height="100%">' +
    '<feTurbulence type="fractalNoise" baseFrequency="0.05" result="noise"/>' +
    '<feDisplacementMap scale="4" xChannelSelector="R" yChannelSelector="G" in="SourceGraphic" in2="noise"/>' +
    '</filter></defs>';

  // grid + y labels
  for (let v = 0; v <= yTop + 1e-9; v += step) {
    const py = sy(v);
    out += '<line x1="' + x0 + '" y1="' + py.toFixed(1) + '" x2="' + x1 + '" y2="' + py.toFixed(1) + '" stroke="' + grid + '" stroke-width="1"/>';
    out += '<text x="' + (x0 - 8) + '" y="' + (py + 4).toFixed(1) + '" text-anchor="end" font-size="12" fill="' + muted + '">' + fmtNum(v) + '</text>';
  }
  // x labels (first/last anchor inward so they never clip)
  xTickVals.forEach(function (t, i) {
    const px = sx(t);
    out += '<line x1="' + px.toFixed(1) + '" y1="' + y0 + '" x2="' + px.toFixed(1) + '" y2="' + y1 + '" stroke="' + grid + '" stroke-width="1"/>';
    let anchor = 'middle';
    if (i === 0) anchor = 'start';
    else if (i === xTickVals.length - 1) anchor = 'end';
    out += '<text x="' + px.toFixed(1) + '" y="' + (y1 + 22) + '" text-anchor="' + anchor + '" font-size="12" fill="' + muted + '">' + esc(fmtDate(t, short)) + '</text>';
  });
  // axis titles
  out += '<text x="' + (x0 + pw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="12" fill="' + muted + '">Date</text>';
  out += '<text x="12" y="' + (y0 + ph / 2).toFixed(1) + '" text-anchor="middle" font-size="12" fill="' + muted + '" transform="rotate(-90 12 ' + (y0 + ph / 2).toFixed(1) + ')">Stars</text>';

  // hover guide (hidden by default)
  out += '<line id="hoverLine" x1="0" y1="' + y0 + '" x2="0" y2="' + y1 + '" stroke="' + muted + '" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>';

  // series (drawn = smoothed/bucketed, r.points = full res for tooltip)
  repos.forEach(function (r, si) {
    const pts = drawn[si].map(function (p) { return { px: sx(p.x), py: sy(p.y), x: p.x, y: p.y }; });
    const d = monotonePath(pts);
    out += '<g filter="url(#' + filterId + ')">';
    out += '<path d="' + d + '" fill="none" stroke="' + r.color + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
    pts.forEach(function (p) {
      out += '<circle cx="' + p.px.toFixed(1) + '" cy="' + p.py.toFixed(1) + '" r="3" fill="' + r.color + '"/>';
    });
    out += '</g>';
  });

  // legend (top-left, like star-history)
  let lx = x0 + 4, ly = y0 + 4;
  repos.forEach(function (r) {
    const label = r.label;
    const wpx = label.length * 6.2 + 26;
    if (lx + wpx > x1) { lx = x0 + 4; ly += 20; }
    out += '<circle cx="' + (lx + 6) + '" cy="' + (ly + 10) + '" r="6" fill="' + r.color + '"/>';
    out += '<text x="' + (lx + 18) + '" y="' + (ly + 15) + '" font-size="13" fill="' + stroke + '">' + esc(label) + '</text>';
    lx += wpx;
  });

  // invisible hit area for touch/hover interpolation
  out += '<rect id="hitArea" x="' + x0 + '" y="' + y0 + '" width="' + pw + '" height="' + ph + '" fill="transparent" style="touch-action:none;cursor:crosshair"/>';

  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.innerHTML = out;
  lastGeom = { x0, x1, y0, y1, pw, ph, dmin, dmax, xSpan, sx, sy, ymax };
  wireHover();
}

function nearestPoint(clientX) {
  if (!lastGeom) return null;
  const r = svg.getBoundingClientRect();
  const vb = (svg.getAttribute('viewBox') || '0 0 ' + r.width + ' ' + r.height).split(' ').map(Number);
  const px = (clientX - r.left) / r.width * vb[2];
  const t = lastGeom.dmin + (px - lastGeom.x0) / lastGeom.pw * lastGeom.xSpan;
  let best = null;
  repos.forEach(function (repo, si) {
    let bp = null, bd = Infinity;
    repo.points.forEach(function (p) { const d = Math.abs(p.x - t); if (d < bd) { bd = d; bp = p; } });
    if (bp && (!best || bd < best.dist)) best = { repo, si, p: bp, dist: bd };
  });
  return best;
}

function wireHover() {
  const hit = $('hitArea');
  const hl = $('hoverLine');
  if (!hit || !lastGeom) return;
  function move(ev) {
    let cx = ev.clientX;
    if (ev.touches && ev.touches.length) cx = ev.touches[0].clientX;
    const b = nearestPoint(cx);
    if (!b || !lastGeom) { hideTip(); return; }
    const g = lastGeom;
    const hx = g.sx(b.p.x);
    if (hl) { hl.setAttribute('x1', hx.toFixed(1)); hl.setAttribute('x2', hx.toFixed(1)); hl.setAttribute('opacity', '0.6'); }
    showTip(b, hx);
  }
  hit.addEventListener('mousemove', move);
  hit.addEventListener('mouseleave', hideTip);
  hit.addEventListener('touchstart', move, { passive: true });
  hit.addEventListener('touchmove', function (e) { e.preventDefault(); move(e); }, { passive: false });
  hit.addEventListener('touchend', function () { setTimeout(hideTip, 1400); });
}

function showTip(b, hx) {
  if (!tip) return;
  const g = lastGeom;
  const hy = g.sy(b.p.y);
  const r = svg.getBoundingClientRect();
  const vb = (svg.getAttribute('viewBox') || '0 0 ' + r.width + ' ' + r.height).split(' ').map(Number);
  const scale = r.width / vb[2];
  // position in px (flip near right edge)
  const left = hx * scale;
  const top = hy * scale;
  tip.innerHTML = '<div class="tipTitle">' + esc(fmtDate(b.p.x, false)) + '</div>' +
    '<div class="tipRow"><i style="background:' + b.repo.color + '"></i><span>' + esc(b.repo.label) + ': ' + b.p.y.toLocaleString() + ' ★</span></div>';
  tip.style.display = 'block';
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = Math.max(4, Math.min(r.width - tw - 4, left + 12)) + 'px';
  tip.style.top = Math.max(4, top - th - 10) + 'px';
}

function hideTip() {
  if (tip) tip.style.display = 'none';
  const hl = $('hoverLine');
  if (hl) hl.setAttribute('opacity', '0');
}

// ---------- chips / stats ----------
function showBox(on) {
  const box = $('chartBox'); if (box) box.style.display = on ? 'block' : 'none';
  const empty = $('chartEmpty'); if (empty) empty.style.display = on ? 'none' : 'block';
}

function renderChips() {
  const el = $('repoChips');
  if (!el) return;
  el.innerHTML = '';
  repos.forEach(function (r, i) {
    const chip = document.createElement('span');
    chip.className = 'repoChip';
    const dot = document.createElement('span');
    dot.className = 'dot'; dot.style.background = r.color || '#888';
    const name = document.createElement('span'); name.className = 'chipName'; name.textContent = r.slug;
    const total = document.createElement('span'); total.className = 'chipTotal';
    total.textContent = r.points[r.points.length - 1].y.toLocaleString();
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕';
    x.setAttribute('aria-label', 'remove ' + r.label);
    x.addEventListener('click', function () { repos.splice(i, 1); syncUrl(); render(); });
    chip.appendChild(dot); chip.appendChild(name); chip.appendChild(total); chip.appendChild(x);
    el.appendChild(chip);
  });
}

function valueAt(points, ts) {
  let v = null;
  for (const p of points) { if (p.x <= ts) v = p.y; else break; }
  return v;
}

function renderStats() {
  const el = $('statsTable');
  if (!el) return;
  if (!repos.length) { el.innerHTML = ''; return; }
  const now = Date.now();
  const head = '<div class="statsHead"><span>Repository</span><span>Stars</span><span>+7d</span><span>+30d</span><span>+1y</span></div>';
  let body = '';
  repos.forEach(function (r) {
    const total = r.points[r.points.length - 1].y;
    const d = function (days) {
      const v = valueAt(r.points, now - days * 864e5);
      if (v == null) return '<span class="na">—</span>';
      const diff = total - v;
      const cls = diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat');
      return '<span class="' + cls + '">' + (diff >= 0 ? '+' : '') + diff.toLocaleString() + '</span>';
    };
    body += '<div class="statsRow">' +
      '<span class="sName"><i class="dot" style="background:' + r.color + '"></i>' + esc(r.label) + '</span>' +
      '<span class="sTotal">' + total.toLocaleString() + '</span>' +
      '<span>' + d(7) + '</span><span>' + d(30) + '</span><span>' + d(365) + '</span></div>';
  });
  el.innerHTML = '<div class="statsBox">' + head + body + '</div>';
}

function syncUrl() {
  try {
    const qp = new URLSearchParams();
    repos.forEach(function (r) { qp.append(r.key.slice(0, 2) === '02' ? 'gitlab' : 'github', r.slug); });
    window.history.replaceState(null, '', window.location.pathname + (repos.length ? '?' + qp.toString() : ''));
  } catch (e) { /* ignore */ }
}

// ---------- actions ----------
function copyLink() {
  const url = window.location.href;
  const done = function () { showMsg('Link copied ✓'); setTimeout(clearMsg, 1500); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url, done); });
  else fallbackCopy(url, done);
}
function fallbackCopy(text, done) {
  try {
    const ta = document.createElement('textarea'); ta.value = text;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();
  } catch (e) { showMsg('Copy the URL manually'); }
}

function downloadCsv() {
  if (!repos.length) { showMsg('Add a repo first'); return; }
  try {
    let csv = 'repo,date,stars\n';
    repos.forEach(function (r) { r.points.forEach(function (p) { csv += '"' + r.label + '",' + new Date(p.x).toISOString().slice(0, 10) + ',' + p.y + '\n'; }); });
    saveFile(new Blob([csv], { type: 'text/csv' }), 'star-history.csv', null, 'CSV saved ✓');
  } catch (e) { showMsg('CSV failed in this browser'); }
}

function downloadPng() {
  if (!repos.length) { showMsg('Add a repo first'); return; }
  try {
    const xml = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    const scale = 2;
    const vb = (svg.getAttribute('viewBox') || '0 0 800 420').split(' ').map(Number);
    const w = vb[2], h = vb[3];
    const bg = isDark() ? '#0d1117' : '#ffffff';
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    img.onload = function () {
      const c = document.createElement('canvas');
      c.width = w * scale; c.height = h * scale;
      const cx = c.getContext('2d');
      cx.fillStyle = bg; cx.fillRect(0, 0, c.width, c.height);
      cx.drawImage(img, 0, 0, c.width, c.height);
      if (c.toBlob) c.toBlob(function (b) { if (b) saveFile(b, 'star-history.png', null, 'PNG saved ✓'); }, 'image/png');
      else saveFile(c.toDataURL('image/png'), 'star-history.png', null, 'PNG saved ✓');
    };
    img.onerror = function () { showMsg('PNG failed in this browser'); };
    img.src = url;
  } catch (e) { showMsg('PNG failed in this browser'); }
}

function saveFile(data, name, mime, okMsg) {
  let url, isBlob = false;
  if (typeof data === 'string') url = data;
  else { try { url = URL.createObjectURL(data); isBlob = true; } catch (e) { showMsg('Save failed'); return; } }
  const cleanup = function () { if (isBlob) { try { URL.revokeObjectURL(url); } catch (e) {} } };
  try {
    const a = document.createElement('a'); a.href = url; a.rel = 'noopener';
    const supported = typeof a.download !== 'undefined';
    if (supported) a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    if (supported) { showMsg(okMsg); setTimeout(clearMsg, 1500); }
    else { try { window.open(url, '_blank'); } catch (e) {} showMsg('New tab — long-press the file to save'); }
  } catch (e) { try { window.open(url, '_blank'); showMsg('New tab — long-press the file to save'); } catch (e2) { showMsg('Save failed'); } }
  setTimeout(cleanup, 10000);
}

// ---------- misc ----------
function hideLoader() { const l = document.getElementsByClassName('loader')[0]; if (l) { l.style.visibility = 'hidden'; l.style.display = 'none'; } }
function showLoader() { const l = document.getElementsByClassName('loader')[0]; if (l) { l.style.visibility = 'visible'; l.style.display = 'block'; } }
function showMsg(m) { hideLoader(); const el = $('inlineMsg'); if (el) { el.textContent = m; el.style.display = 'block'; } }
function clearMsg() { const el = $('inlineMsg'); if (el) { el.style.display = 'none'; el.textContent = ''; } }

function ajax(url, onOk, onErr) {
  const xhr = new XMLHttpRequest();
  xhr.timeout = 90000;
  xhr.ontimeout = function () { onErr('Slow network — try again'); };
  xhr.onerror = function () { onErr('Network error'); };
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return;
    if (xhr.status === 200) { try { onOk(JSON.parse(xhr.responseText)); } catch (e) { onErr('Bad server reply'); } }
    else if (xhr.status === 429) onErr('Too fast — wait a few seconds');
    else { try { const j = JSON.parse(xhr.responseText); onErr((j && j.Error) || ('Failed (' + xhr.status + ')')); } catch (e) { onErr('Failed (' + (xhr.status || 'network') + ')'); } }
  };
  xhr.open('GET', url);
  xhr.send();
}

export { init };
