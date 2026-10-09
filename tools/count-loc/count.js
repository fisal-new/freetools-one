/* Count LOC — zero-dependency UI.
   - lightweight SVG donut (no Chart.js: 174KB saved)
   - language table, extension breakdown, collapsible file explorer
   - every JS error is surfaced on the page instead of failing silently */

// ---------- tiny helpers ----------
const $ = (id) => document.getElementById(id);
const LANGS = [
  "ActionScript","AppleScript","Arduino","Assembly","Bash","C","C#","C++","CSS","Clojure","CoffeeScript",
  "Crystal","D","Dart","Dockerfile","Elixir","Elm","Erlang","F#","Fish","Fortran","Go","Groovy","Haskell",
  "HTML","Haxe","Java","JavaScript","JSON","Julia","Kotlin","LESS","Lua","Makefile","Markdown","Nim",
  "Objective-C","OCaml","PHP","Perl","PowerShell","Python","R","Ruby","Rust","SCSS","Scala","Shell",
  "SQL","Swift","TOML","TypeScript","Vim Script","Vue","XML","YAML","Zig"
];

const LANG_COLOR = {
  Rust:"#dea584", Go:"#00ADD8", Python:"#3572A5", JavaScript:"#f1e05a", TypeScript:"#3178c6",
  TypeScript:"#3178c6", Java:"#b07219", "C++":"#f34b7d", C:"#555555", "C#":"#178600", Ruby:"#701516",
  PHP:"#4F5D95", Swift:"#F05138", Kotlin:"#A97BFF", Dart:"#00B4AB", Scala:"#c22d40", Haskell:"#5e5086",
  Elixir:"#6e4a7e", Lua:"#000080", Perl:"#0298c3", R:"#198CE7", Shell:"#89e051", HTML:"#e34c26",
  CSS:"#563d7c", SCSS:"#c6538c", Vue:"#41b883", JSON:"#292929", XML:"#0060ac", YAML:"#cb171e",
  TOML:"#9c4221", Markdown:"#083fa1", Makefile:"#427819", Dockerfile:"#384d54", SQL:"#e38c00",
  PowerShell:"#012456", VimScript:"#199f4b", Nim:"#ffc200", Zig:"#ec915c", OCaml:"#3be133",
  FSharp:"#b845fc", Erlang:"#B83998", Clojure:"#db5855", "CoffeeScript":"#244776", Groovy:"#4298b8",
  Crystal:"#000100", Julia:"#a270ba", Fish:"#4aae47", Fortran:"#4d41b1", Elm:"#60B5CC", "Objective-C":"#438eff",
  ActionScript:"#882B0F", AppleScript:"#101F1F", Arduino:"#00979D", Assembly:"#6E4C13", Less:"#1d365d",
  Haxe:"#df7900", Arduino:"#00979D", Batchfile:"#C1F12E", Prolog:"#74283c", Scheme:"#1e4aec",
  Smalltalk:"#596706", Verilog:"#b2b7f8", Vhdl:"#adb2cb", TeX:"#3D6117", Pug:"#a86454"
};
const FALLBACK = ["#0969da","#8250df","#1a7f37","#cf222e","#9a6700","#0550ae","#bf3989","#116329",
                  "#953800","#0a3069","#6639ba","#4ac26b","#e5534b","#1f883d","#8250df"];

function langColor(name) {
  if (LANG_COLOR[name]) return LANG_COLOR[name];
  let h = 0;
  const s = String(name);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}
function fmt(n) { return (n || 0).toLocaleString(); }
function bytes(n) {
  if (!n) return "0 B";
  const u = ["B","KB","MB","GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)) + " " + u[i];
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let repo = "";
let addComments = false;
let data = null;        // { languages, extensions, files }
let chart = null;
let hidden = new Set();
let sortKey = "linesOfCode";
let sortDir = -1;
let showAllFiles = false;

// ---------- init ----------
function init() {
  $("addRepo").addEventListener("click", () => addRepo());
  $("toggle").addEventListener("click", toggle);
  $("toggle").style.display = "none";
  document.querySelector(".pie").style.display = "none";
  const tabs = $("tabs");
  if (tabs) {
    tabs.addEventListener("click", (e) => {
      const b = e.target.closest(".tab");
      if (b) showTab(b.dataset.tab);
    });
  }
  hideLoader();
  try {
    const qp = new URLSearchParams(location.search);
    const gh = (qp.get("github") || qp.get("gitlab") || "").trim();
    if (gh) {
      const sel = document.getElementsByName("source")[0];
      const want = qp.get("gitlab") ? "gitlab" : "github";
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === want) sel.selectedIndex = i;
      }
      $("repoName").value = gh;
      if (qp.get("branch")) $("branch").value = qp.get("branch");
      if (qp.get("ignored")) $("ignored").value = qp.get("ignored");
      addRepo();
    }
  } catch (e) { /* bad query */ }
}

// ---------- request ----------
function addRepo() {
  repo = $("repoName").value.trim().replace(/\s+/g, "-");
  const source = document.getElementsByName("source")[0].value;
  const branch = $("branch").value.trim();
  const ignored = $("ignored").value.trim();
  if (!repo) return showError("user/repo cannot be empty");
  if (repo.length > 160 || repo.includes("..") || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/.test(repo)) {
    return showError("Wrong format. Use: user/repo");
  }
  if (chart) { chart.innerHTML = ""; chart = null; }
  $("totalResume").innerHTML = "";
  $("fileExplorer").innerHTML = "";
  $("extList").innerHTML = "";
  hidden = new Set();
  showLoader();

  const qs = new URLSearchParams();
  qs.set(source, repo);
  qs.set("detail", "1");              // powers the file explorer + extensions
  if (branch) qs.set("branch", branch);
  if (ignored) qs.set("ignored", ignored);
  t0 = now();
  ajax("/v1/loc/?" + qs.toString(), onData);
}
let t0 = 0;
function now() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }

function onData(res) {
  hideLoader();
  if (!res || !Array.isArray(res.languages) || !res.languages.length) {
    return showError("Empty response from server");
  }
  const total = res.languages[res.languages.length - 1];
  if (total && total.language === "Total" && !total.linesOfCode) {
    return showError("No countable code in this repo (docs, media or unsupported files only?)");
  }
  data = res;
  render();
}

function render() {
  if (!data) return;
  const langs = visibleLanguages();
  const values = langs.map((l) => (addComments ? l.linesOfCode + l.comments : l.linesOfCode));
  const labels = langs.map((l) => l.language);
  drawDonut(values, labels);
  renderTable();
  const tabs = $("tabs");
  if (tabs) tabs.style.display = "flex";
  renderExts();
  renderFiles();
  renderTiming();
}

// tabs keep the page short: one view visible at a time
function showTab(name) {
  document.querySelectorAll(".tab").forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".tabpane").forEach((p) => {
    p.classList.toggle("active", p.id === "pane-" + name);
  });
}

function visibleLanguages() {
  return data.languages.filter((l) => l.language !== "Total" && !hidden.has(l.language));
}

function toggle() {
  addComments = !addComments;
  $("toggle").textContent = addComments
    ? "Exclude comments from chart"
    : "Include comments in chart";
  render();
}

// ---------- donut (pure SVG) ----------
function drawDonut(values, labels) {
  const el = $("donut");
  document.querySelector(".pie").style.display = "block";
  const total = values.reduce((a, b) => a + b, 0);
  if (!total || !values.length) { el.innerHTML = ""; return; }
  const S = 260, R = 100, r = 58, cx = S / 2, cy = S / 2;
  const C = 2 * Math.PI * R;
  let acc = 0;
  let paths = "";
  let legend = "";
  const shown = labels.map((l, i) => ({ l, v: values[i], c: langColor(l) }));
  shown.forEach((s, i) => {
    const frac = s.v / total;
    const len = frac * C;
    // tiny gap between slices, but never lose a 100% single slice
    const gap = shown.length > 1 ? Math.min(2, len * 0.15) : 0;
    paths += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${s.c}" stroke-width="${R - r}"
      stroke-dasharray="${Math.max(0.1, len - gap)} ${C - Math.max(0.1, len - gap)}"
      stroke-dashoffset="${-acc}" transform="rotate(-90 ${cx} ${cy})"><title>${esc(s.l)}: ${fmt(s.v)} (${(frac * 100).toFixed(1)}%)</title></circle>`;
    acc += len;
    legend += `<li><button class="lgItem" data-lg="${esc(s.l)}" title="Hide ${esc(s.l)}">
        <i style="background:${s.c}"></i><span>${esc(s.l)}</span>
        <b>${fmt(s.v)}</b><em>${(frac * 100).toFixed(1)}%</em></button></li>`;
  });
  const center = addComments
    ? { k: "code + comments", v: total }
    : { k: "lines of code", v: total };
  el.innerHTML = `
    <div class="donutWrap">
      <svg class="donutSvg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="Language distribution">
        <circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="var(--input-border)" stroke-width="${R - r}"/>
        ${paths}
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donutBig">${fmt(center.v)}</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="donutSub">${center.k}</text>
      </svg>
      <ul class="donutLegend">${legend}</ul>
    </div>`;
  el.querySelectorAll("[data-lg]").forEach((b) => {
    b.addEventListener("click", () => {
      const name = b.dataset.lg;
      if (hidden.has(name)) hidden.delete(name); else hidden.add(name);
      render();
    });
  });
}

// ---------- table ----------
function renderTable() {
  const rows = data.languages.filter((l) => l.language !== "Total" && !hidden.has(l.language));
  const t = rows.reduce((a, l) => ({
    files: a.files + l.files, lines: a.lines + l.lines,
    blanks: a.blanks + l.blanks, comments: a.comments + l.comments, loc: a.loc + l.linesOfCode
  }), { files: 0, lines: 0, blanks: 0, comments: 0, loc: 0 });
  let h = `<div class="locTableWrap"><table class="table"><thead><tr>
      <th>Language</th><th>Files</th><th>Code</th><th>Comments</th><th>Blanks</th><th>Total</th><th>Share</th>
    </tr></thead><tbody>`;
  rows.forEach((l) => {
    const pct = t.loc > 0 ? (100 * l.linesOfCode / t.loc).toFixed(1) + "%" : "—";
    h += `<tr><td><i class="swatch" style="background:${langColor(l.language)}"></i>${esc(l.language)}</td>
      <td>${fmt(l.files)}</td><td>${fmt(l.linesOfCode)}</td><td>${fmt(l.comments)}</td>
      <td>${fmt(l.blanks)}</td><td>${fmt(l.lines)}</td><td>${pct}</td></tr>`;
  });
  h += `<tr class="totRow"><td><strong>Total</strong></td><td>${fmt(t.files)}</td><td>${fmt(t.loc)}</td>
      <td>${fmt(t.comments)}</td><td>${fmt(t.blanks)}</td><td>${fmt(t.lines)}</td><td>100%</td></tr>
    </tbody></table></div>`;
  $("totalResume").innerHTML = h;
}

// ---------- extensions ----------
function renderExts() {
  const el = $("extList");
  if (!el || !data.extensions || !data.extensions.length) { if (el) el.innerHTML = ""; return; }
  let h = "";
  data.extensions.forEach((e) => {
    h += `<li><span class="extName">${esc(e.ext)}</span>
      <span class="extBar"><i style="width:${(100 * e.linesOfCode / data.extensions[0].linesOfCode).toFixed(1)}%"></i></span>
      <span class="extNum">${fmt(e.files)}f</span><span class="extNum">${fmt(e.linesOfCode)}</span></li>`;
  });
  el.innerHTML = h;
}

// ---------- file explorer ----------
function renderFiles() {
  const el = $("fileExplorer");
  if (!el || !data.files || !data.files.length) { if (el) el.innerHTML = ""; return; }
  const sorted = data.files.slice().sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (typeof x === "string") return sortDir * x.localeCompare(y);
    return sortDir * (x - y);
  });
  const CAP = 300;
  const view = showAllFiles ? sorted : sorted.slice(0, CAP);
  let h = `<div class="fxHead">
      <span>${fmt(data.files.length)} files</span>
      <button id="fxMore" class="action">${showAllFiles ? "Show top 300" : "Show all " + fmt(data.files.length)}</button>
    </div>
    <div class="fxScroll"><table class="fxTable"><thead><tr>
      <th data-sk="path">File</th><th data-sk="language">Language</th>
      <th data-sk="bytes">Size</th><th data-sk="lines">Lines</th>
      <th data-sk="linesOfCode">Code</th><th data-sk="comments">Comments</th>
    </tr></thead><tbody>`;
  view.forEach((f) => {
    h += `<tr>
      <td class="fxPath"><i class="swatch" style="background:${langColor(f.language)}"></i>${esc(f.path)}</td>
      <td>${esc(f.language)}</td><td>${bytes(f.bytes)}</td>
      <td>${fmt(f.lines)}</td><td>${fmt(f.linesOfCode)}</td><td>${fmt(f.comments)}</td></tr>`;
  });
  h += `</tbody></table></div>`;
  el.innerHTML = h;
  el.querySelectorAll("[data-sk]").forEach((th) => {
    th.addEventListener("click", () => {
      const k = th.dataset.sk;
      sortDir = (k === sortKey) ? -sortDir : (k === "path" || k === "language" ? 1 : -1);
      sortKey = k;
      renderFiles();
    });
  });
  const more = $("fxMore");
  if (more) more.addEventListener("click", () => { showAllFiles = !showAllFiles; renderFiles(); });
}

function renderTiming() {
  const el = $("locTiming");
  if (!el || !t0) return;
  const secs = ((now() - t0) / 1000).toFixed(2);
  const ext = data.extensions ? data.extensions.length : 0;
  el.textContent = `analysed in ${secs}s · ${fmt(data.files.length)} files · ${ext} extensions`;
}

// ---------- misc ----------
function hideLoader() { const l = document.querySelector(".loader"); if (l) l.style.display = "none"; }
function showLoader() { const l = document.querySelector(".loader"); if (l) l.style.display = "block"; }
function showError(msg) {
  hideLoader();
  const el = $("inlineMsg");
  if (!el) return alert(msg);
  el.innerHTML = '<strong>' + esc(msg) + "</strong>";
  el.style.display = "block";
}

function ajax(url, onOk) {
  const x = new XMLHttpRequest();
  x.timeout = 200000;
  x.ontimeout = () => showError("Timed out — repo too large or network too slow");
  x.onerror = () => showError("Network error");
  x.onreadystatechange = () => {
    if (x.readyState !== 4) return;
    if (x.status === 200) {
      try { onOk(JSON.parse(x.responseText)); }
      catch (e) { showError("Bad response from server"); }
    } else if (x.status === 429) {
      showError("Rate limit (30/min) — wait a few seconds");
    } else {
      let m = "Request failed (" + x.status + ")";
      try { const j = JSON.parse(x.responseText); if (j && j.Error) m = j.Error; } catch (e) {}
      showError(m);
    }
  };
  x.open("GET", url);
  x.send();
}

export { init };
