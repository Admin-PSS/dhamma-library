/* ဓမ္မစာကြည့်တိုက် — read Dhamma books in the browser. Built the same way as တရားနာယူ.
   Data comes from scripts/convert.mjs: catalog.json (all books), books/<slug>/index.json
   (one book's pages and contents) and books/<slug>/NNN.html (one page of text).
   Links: #/  ·  #/<category>  ·  #/<category>/<NN>  ·  #/<category>/<NN>/<page>[/<heading id>] */
"use strict";

const APP_TITLE = "ဓမ္မစာကြည့်တိုက်";
const SOURCE_URL = "https://www.dhammadownload.com/";
const FONT_SIZES = [15, 16.5, 18, 20, 22, 25, 28];  // px
const FLAT_CONTENTS_MAX = 30;                       // longer lists of plain headings fold by page

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const MMD = "၀၁၂၃၄၅၆၇၈၉";
const mm = x => String(x).replace(/\d/g, d => MMD[d]);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const store = {
  get(k, def) { try { const v = localStorage.getItem("dl." + k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem("dl." + k, JSON.stringify(v)); } catch { /* private mode / full */ } },
};

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(url + " " + r.status);
  return r.json();
}

/* ---------- settings: font size and light/dark, remembered per browser ---------- */
const settings = Object.assign({ theme: "auto", fontStep: 2 }, store.get("settings", {}));
const saveSettings = () => store.set("settings", settings);
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const isDark = () => settings.theme === "auto" ? darkQuery.matches : settings.theme === "dark";

function applyTheme() {
  if (settings.theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = settings.theme;
  $("#themeBtn").classList.toggle("is-dark", isDark());
}

function applyFontSize() {
  settings.fontStep = Math.min(FONT_SIZES.length - 1, Math.max(0, Number(settings.fontStep) || 0));
  document.documentElement.style.setProperty("--read-size", FONT_SIZES[settings.fontStep] + "px");
  $("#fontDown").disabled = settings.fontStep === 0;
  $("#fontUp").disabled = settings.fontStep === FONT_SIZES.length - 1;
}

function changeFontSize(delta) {
  const page = document.documentElement;
  const ratio = window.scrollY / Math.max(1, page.scrollHeight);  // keep the reader's place
  settings.fontStep += delta;
  applyFontSize();
  saveSettings();
  window.scrollTo(0, ratio * page.scrollHeight);
}

/* ---------- data ---------- */
let CAT = null;
const categories = new Map();
const books = new Map();         // slug -> book entry from the catalog
const bookIndexes = new Map();   // slug -> index.json, kept once loaded

async function loadCatalog() {
  CAT = await getJSON("catalog.json");
  for (const c of CAT.categories) {
    categories.set(c.slug, c);
    for (const b of c.books) books.set(b.slug, { ...b, category: c });
  }
}

async function loadBook(slug) {
  if (!bookIndexes.has(slug)) bookIndexes.set(slug, await getJSON(`books/${slug}/index.json`));
  return bookIndexes.get(slug);
}

async function loadPage(slug, file) {
  const r = await fetch(`books/${slug}/${file}`);
  if (!r.ok) throw new Error(file + " " + r.status);
  return r.text();
}

/* ---------- views ---------- */
function setHeader(title, back, reading = false) {
  $("#viewTitle").textContent = title;
  document.title = title === APP_TITLE ? APP_TITLE : `${title} · ${APP_TITLE}`;
  $("#backBtn").hidden = !back;
  if (back) $("#backBtn").href = back;
  $("#homeBtn").hidden = !back || back === "#/";  // back already goes home from a category
  $("#readTools").hidden = !reading;
  $("#searchBtn").hidden = !back || reading || location.hash.startsWith("#/search");  // home has its own box
}

const spinner = () => `<p class="loading">ဖွင့်နေသည်…</p>`;

const notice = (subject = "ဤစာအုပ်") => `<p class="notice">${subject}ကို <a href="${SOURCE_URL}" target="_blank" rel="noopener">Dhammadownload.com</a> ရှိ
  မူရင်း PDF မှ ပြောင်းလဲထားခြင်းဖြစ်၍ အမှားအယွင်း ပါဝင်နိုင်ပါသည်။ မူရင်း PDF နှင့် တိုက်ဆိုင်စစ်ဆေးပါရန်။</p>`;

function viewNotFound() {
  setHeader(APP_TITLE, "#/");
  return `<div class="card empty">စာမျက်နှာ မတွေ့ပါ</div>`;
}

function viewError() {
  return `<div class="card empty">ဖွင့်၍ မရပါ။ အင်တာနက် ချိတ်ဆက်မှုကို စစ်ဆေးပြီး ပြန်ကြိုးစားပါ။<br><br>
    <button class="btn" data-action="retry">ပြန်ကြိုးစားရန်</button></div>`;
}

function viewHome() {
  setHeader(APP_TITLE, null);
  const cards = CAT.categories.map(c => `<a class="card cat" href="#/${esc(c.slug)}">
      <strong>${esc(c.title)}</strong><span>စာအုပ် ${mm(c.count)} အုပ်</span></a>`).join("");
  return `${searchForm()}<h2 class="section-title">စာအုပ်အမျိုးအစားများ</h2><div class="cats">${cards}</div>${notice("ဤစာအုပ်များ")}
    <p class="credit"><a href="#/about">ⓘ ဤစာကြည့်တိုက်အကြောင်း</a></p>`;
}

function viewAbout() {
  setHeader("ဤစာကြည့်တိုက်အကြောင်း", "#/");
  const link = (url, text) => `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
  const blog = link("https://myatbuddha-sasana.blogspot.com/", "မြတ်ဗုဒ္ဓသာသနာ");
  const source = link(SOURCE_URL, "Dhammadownload.com");
  const bookCount = CAT.categories.reduce((n, c) => n + c.count, 0);
  return `<div class="about">
    <div class="about-hero">
      <img src="icons/icon-192.png" alt="" width="84" height="84">
      <h2>${APP_TITLE}</h2>
      <p class="muted">ဓမ္မစာအုပ်များကို အွန်လိုင်းမှ တိုက်ရိုက် ဖတ်ရှုနိုင်ရန်</p>
    </div>

    <div class="card about-card">
      <h3>🙏 ကျေးဇူးတင်လွှာ</h3>
      <p>ဤစာကြည့်တိုက်ရှိ Unicode စာအုပ်ဖိုင်များကို ${blog} ဘလော့ဂ်မှ ရယူထားခြင်း ဖြစ်ပါသည်။
        စေတနာဖြင့် ပြုစု မျှဝေပေးကြသူများကို ကျေးဇူးအထူး တင်ရှိပါသည်။</p>
      <p>မူရင်း PDF စာအုပ်များကို ${source} တွင် ဖတ်ရှုနိုင်ပါသည်။</p>
      <p>ဓမ္မဒါန ပြုတော်မူကြသော ဆရာတော်ဘုရားများနှင့် ပုဂ္ဂိုလ်အားလုံးကို ကျေးဇူးတင်ရှိပါသည်။</p>
    </div>

    <div class="card about-card">
      <h3>📖 ဖတ်ရှုရာတွင် သတိပြုရန်</h3>
      <p>စာအုပ်များကို မူရင်း PDF မှ ပြောင်းလဲထားခြင်းဖြစ်၍ အမှားအယွင်း ပါဝင်နိုင်ပါသည်။ မူရင်း PDF နှင့် တိုက်ဆိုင်စစ်ဆေးပါရန်။</p>
    </div>

    <div class="card about-card">
      <h3>ℹ ဤစာကြည့်တိုက်အကြောင်း</h3>
      <ul>
        <li>စာအုပ် ${mm(bookCount)} အုပ်ကို ဒေါင်းလုဒ်မလုပ်ဘဲ တိုက်ရိုက် ဖတ်ရှု၊ ရှာဖွေနိုင်ပါသည်။</li>
        <li>ကြော်ငြာ မရှိပါ။ အကောင့်ဖွင့်ရန် မလိုပါ။ အခမဲ့ ဖြစ်ပါသည်။</li>
        <li>စာလုံးအရွယ်အစားနှင့် အလင်း၊ အမှောင် ရွေးချယ်မှုကို သင့်ဖုန်းထဲတွင်သာ သိမ်းပါသည်။ ကိုယ်ရေးအချက်အလက် စုဆောင်းခြင်း မရှိပါ။</li>
      </ul>
    </div>

    <p class="credit">ဤစာကြည့်တိုက်သည် ${blog} ဘလော့ဂ် သို့မဟုတ် ${source} ၏ တရားဝင်စာမျက်နှာ မဟုတ်ပါ။
      စာဖတ်သူများ အဆင်ပြေစေရန် စေတနာဖြင့် ပြုလုပ်ထားခြင်း ဖြစ်ပါသည်။<br><br>သာဓု သာဓု သာဓု 🙏</p>
  </div>`;
}

/* ---------- search ---------- */
const RESULTS_STEP = 30;
const shards = new Map();         // index file number -> its tokens
const foundPages = new Map();     // query -> page numbers from the index
const snippets = new Map();       // "query|page" -> what the page really holds, or null
const resultsShown = new Map();   // query -> how many rows were open
let pageList = null;              // page number -> {book, page}
let highlight = null;             // set when a result is tapped
let afterRender = null;

const searchForm = (q = "") => `<form class="search" role="search">
    <input name="q" type="search" lang="my" value="${esc(q)}" placeholder="စာအုပ်အားလုံးတွင် ရှာဖွေရန်" aria-label="ရှာဖွေရန်" autocomplete="off">
    <button class="btn">ရှာရန်</button></form>`;

function allPages() {
  if (!pageList) {
    pageList = CAT.categories.flatMap(c => c.books.flatMap(b => Array.from({ length: b.pages }, (_, i) => ({ book: b, page: i + 1 }))));
  }
  return pageList;
}

async function loadShard(n) {
  if (!shards.has(n)) shards.set(n, await getJSON(`search/${String(n).padStart(4, "0")}.json`));
  return shards.get(n);
}

/* Pages holding every syllable pair of the query. These are candidates: each is confirmed against
   the page's real text when its row comes into view. */
async function findPages(q) {
  if (foundPages.has(q)) return foundPages.get(q);
  const keys = searchKeys(q);
  const lists = await Promise.all(keys.map(async key => (await loadShard(searchShard(key)))[key] || []));
  let result = [];
  if (lists.length && lists.every(list => list.length)) {
    const decoded = lists.map(list => { let at = 0; return list.map((gap, i) => (at = i ? at + gap : gap)); });
    decoded.sort((a, b) => a.length - b.length);
    const others = decoded.slice(1).map(list => new Set(list));
    result = decoded[0].filter(page => others.every(set => set.has(page)));
  }
  foundPages.set(q, result);
  return result;
}

/* Finds the query in real text, ignoring differences in spacing and punctuation. */
function searchPattern(q) {
  const gap = "[\\s\\u200b-\\u200d၊။,.\\-–—]*";
  const parts = [...searchClean(q)].map(c => c === "ဝ" ? "[ဝ၀]" : c === "ဩ" ? "(?:ဩ|သြ)" : c);
  return new RegExp(parts.join(gap), "gi");
}

const pageText = html => {
  const box = document.createElement("template");
  box.innerHTML = html.replace(/<\/(p|h\d|li|td|th)>/g, "\n");
  return box.content.textContent;
};

function hitRow(q, number) {
  const { book, page } = allPages()[number];
  return `<li data-page="${number}"><a class="row-main" data-q="${esc(q)}" href="#/${book.slug}/${page}">
      <span class="row-title">${esc(book.title)}</span>
      <span class="row-meta">စာမျက်နှာ ${mm(page)}</span>
      <span class="snippet"></span></a></li>`;
}

function paintRow(row, info) {
  if (!info) { row.remove(); return; }
  const meta = $(".row-meta", row);
  meta.textContent = `${info.title} · ${mm(info.count)} ကြိမ်`;
  $(".snippet", row).innerHTML = `${esc(info.before)}<mark>${esc(info.match)}</mark>${esc(info.after)}`;
}

async function confirmRow(row, q) {
  const number = Number(row.dataset.page);
  const key = `${q}|${number}`;
  if (!snippets.has(key)) {
    const { book, page } = allPages()[number];
    const index = await loadBook(book.slug);
    const text = pageText(await loadPage(book.slug, index.pages[page - 1].file));
    const hits = [...text.matchAll(searchPattern(q))];
    const first = hits[0];
    snippets.set(key, first ? {
      title: index.pages[page - 1].title, count: hits.length, match: first[0],
      before: "…" + text.slice(Math.max(0, first.index - 40), first.index).replace(/^[ါ-ှ]+/, "").replace(/\s+/g, " "),
      after: text.slice(first.index + first[0].length, first.index + first[0].length + 60).replace(/\s+/g, " ") + "…",
    } : null);
  }
  paintRow(row, snippets.get(key));
}

/* Only rows on screen fetch their page, two at a time, to go easy on slow connections. */
let rowObserver = null;
let rowQueue = [];
let rowsBusy = 0;

function pumpRows() {
  while (rowsBusy < 2 && rowQueue.length) {
    const { row, q } = rowQueue.shift();  // each row keeps its own query, in case a new search has started
    if (!row.isConnected) continue;
    rowsBusy += 1;
    confirmRow(row, q).catch(() => {}).finally(() => {
      rowsBusy -= 1;
      const list = $("#textHits");
      if (list && !list.children.length && $("[data-action='more']").hidden) $("#textStatus").textContent = "မတွေ့ပါ";
      pumpRows();
    });
  }
}

function addRows(q, numbers, list, from, to) {
  list.insertAdjacentHTML("beforeend", numbers.slice(from, to).map(n => hitRow(q, n)).join(""));
  for (const row of [...list.children].slice(from)) {
    const known = snippets.get(`${q}|${row.dataset.page}`);
    if (known !== undefined) paintRow(row, known);
    else rowObserver.observe(row);
  }
  resultsShown.set(q, to);
  const more = $("[data-action='more']");
  if (more) more.hidden = to >= numbers.length;
}

function viewSearch(q = "") {
  setHeader("ရှာဖွေရန်", "#/");
  if (searchClean(q).length < 2) {
    afterRender = () => $(".search input").focus();
    return `${searchForm(q)}<div class="card empty">ရှာလိုသော စကားလုံးကို ရိုက်ထည့်ပါ</div>`;
  }
  const key = searchClean(q);
  const titleHits = [...books.values()].filter(b => searchClean(b.title).includes(key));
  const titleRows = titleHits.map(b => `<li><a class="row-main" href="#/${b.slug}">
      <span class="row-title">${esc(b.title)}</span><span class="row-meta">${esc(b.category.title)}</span></a></li>`).join("");
  afterRender = () => runTextSearch(q);
  return `${searchForm(q)}
    ${titleRows ? `<h2 class="section-title">စာအုပ်အမည်</h2><div class="card"><ul class="list">${titleRows}</ul></div>` : ""}
    <h2 class="section-title">စာအုပ်အတွင်း</h2>
    <p id="textStatus" class="status">ရှာဖွေနေသည်…</p>
    <div class="card" id="textCard" hidden><ul class="list" id="textHits"></ul></div>
    <button class="btn more" data-action="more" hidden>နောက်ထပ်</button>`;
}

async function runTextSearch(q) {
  const seq = routeSeq;
  let numbers;
  try {
    numbers = await findPages(q);
  } catch {
    if (seq === routeSeq) $("#textStatus").textContent = "ဖွင့်၍ မရပါ။ အင်တာနက် ချိတ်ဆက်မှုကို စစ်ဆေးပါ။";
    return;
  }
  if (seq !== routeSeq) return;
  $("#textStatus").textContent = numbers.length ? `စာမျက်နှာ ${mm(numbers.length)} ခုခန့်တွင် တွေ့ရှိပါသည်` : "မတွေ့ပါ";
  if (!numbers.length) return;

  const list = $("#textHits");
  $("#textCard").hidden = false;
  rowQueue = [];
  rowObserver?.disconnect();
  rowObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      rowObserver.unobserve(entry.target);
      rowQueue.push({ row: entry.target, q });
    }
    pumpRows();
  }, { rootMargin: "200px" });

  addRows(q, numbers, list, 0, Math.max(RESULTS_STEP, resultsShown.get(q) || 0));
  $("[data-action='more']").onclick = () => {
    const shown = list.children.length;
    addRows(q, numbers, list, shown, shown + RESULTS_STEP);
  };
  window.scrollTo(0, scrollMemo.get(location.hash) || 0);
}

/* Marks the query on the page a result opened, and offers a way to step through the matches. */
function markMatches(q) {
  const article = $(".reader");
  const pattern = searchPattern(q);
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const matches = [...node.data.matchAll(pattern)];
    for (const m of matches.reverse()) {
      const target = node.splitText(m.index);
      target.splitText(m[0].length);
      const mark = document.createElement("mark");
      target.replaceWith(mark);
      mark.append(target);
    }
  }
  let hits = [...article.querySelectorAll("mark")];
  if (!hits.length) {  // the words cross bold and plain text, so mark the whole paragraph
    hits = [...article.children].filter(el => { pattern.lastIndex = 0; return pattern.test(el.textContent); });
    hits.forEach(el => el.classList.add("hit-block"));
  }
  if (!hits.length) return false;

  let at = 0;
  const show = () => {
    hits[at].scrollIntoView({ block: "center" });
    hits.forEach((el, i) => el.classList.toggle("current", i === at));
    const label = $("#hitCount");
    if (label) label.textContent = `${mm(at + 1)} / ${mm(hits.length)}`;
  };
  if (hits.length > 1) {
    $("#view").insertAdjacentHTML("beforeend", `<div class="hit-nav"><span id="hitCount"></span>
      <button class="btn" id="hitNext">နောက်တစ်ခု</button></div>`);
    $("#hitNext").onclick = () => { at = (at + 1) % hits.length; show(); };
  }
  show();
  return true;
}

function viewCategory(slug) {
  const c = categories.get(slug);
  if (!c) return viewNotFound();
  setHeader(c.title, "#/");
  const rows = c.books.map(b => `<li><a class="row-main" href="#/${esc(b.slug)}">
      <span class="row-title">${esc(b.title)}</span>
      <span class="row-meta">စာမျက်နှာ ${mm(b.pages)}${b.chapters ? ` · အခန်း ${mm(b.chapters)}` : ""}</span></a></li>`).join("");
  return `<div class="card"><ul class="list">${rows}</ul></div>`;
}

function contentsRow(row) {
  const subs = row.subs.map(s => `<li><a href="${s.href}">${esc(s.title)}</a></li>`).join("");
  const hint = row.hint ? `<span class="row-meta">${esc(row.hint)}</span>` : "";
  const toggle = subs ? `<button class="icon-btn toggle" data-action="toggle" aria-expanded="false" aria-label="ခေါင်းစဉ်ငယ်များ">⌄</button>` : "";
  return `<li><div class="row"><a class="row-main" href="${row.href}"><span class="row-title">${esc(row.title)}</span>${hint}</a>${toggle}</div>
    ${subs ? `<ul class="sub" hidden>${subs}</ul>` : ""}</li>`;
}

/* Sections fold under their chapter. Headings before the first chapter (or in a book with no
   chapters) stay flat when there are few, and fold into one row per page when there are many. */
function contentsList(slug, index) {
  const heading = t => ({ title: t.title, href: `#/${slug}/${t.page}/${t.id}`, subs: [] });
  const firstChapter = index.toc.findIndex(t => t.level === 2);
  const loose = firstChapter < 0 ? index.toc : index.toc.slice(0, firstChapter);

  let rows = loose.map(heading);
  if (loose.length > FLAT_CONTENTS_MAX) {
    rows = [];
    for (let page = loose[0].page; page <= loose[loose.length - 1].page; page++) {
      const subs = loose.filter(t => t.page === page);
      rows.push({
        title: `စာမျက်နှာ ${mm(page)}`, hint: subs.length ? subs[0].title : index.pages[page - 1].title,
        href: `#/${slug}/${page}`, subs: subs.map(heading),
      });
    }
  }
  if (firstChapter >= 0) {
    for (const t of index.toc.slice(firstChapter)) {
      if (t.level === 2) rows.push(heading(t));
      else rows[rows.length - 1].subs.push(heading(t));
    }
  }
  if (!rows.length) {  // no headings at all: list the pages
    rows = index.pages.map((p, i) => ({ title: `စာမျက်နှာ ${mm(i + 1)}`, href: `#/${slug}/${i + 1}`, subs: [] }));
  }
  return rows.map(contentsRow).join("");
}

async function viewBook(slug) {
  const b = books.get(slug);
  if (!b) return viewNotFound();
  setHeader(b.title, `#/${b.category.slug}`);
  $("#view").innerHTML = spinner();
  const index = await loadBook(slug);
  return `<div class="card book-head">
      <h2>${esc(b.title)}</h2>
      <p>${esc(b.category.title)} · စာမျက်နှာ ${mm(b.pages)}${b.chapters ? ` · အခန်း ${mm(b.chapters)}` : ""}</p>
      <a class="btn" href="#/${slug}/1">ဖတ်ရှုရန်</a>
    </div>${notice()}
    <h2 class="section-title">မာတိကာ</h2>
    <div class="card"><ul class="list">${contentsList(slug, index)}</ul></div>`;
}

async function viewReader(slug, pageText) {
  const b = books.get(slug);
  const n = Number(pageText);
  if (!b || !Number.isInteger(n) || n < 1) return viewNotFound();
  setHeader(b.title, `#/${slug}`, true);
  $("#view").innerHTML = spinner();
  const index = await loadBook(slug);
  const page = index.pages[n - 1];
  if (!page) return viewNotFound();
  const text = await loadPage(slug, page.file);

  const prev = index.pages[n - 2], next = index.pages[n];
  const pagerLink = (target, number, cls, label) => target
    ? `<a class="${cls}" data-fresh href="#/${slug}/${number}">${label}<small>${esc(target.title)}</small></a>`
    : `<span class="gap"></span>`;
  const heading = text.includes("<h2") ? "" : `<p class="page-title">${esc(page.title)}</p>`;  // continuation pages
  return `${heading}<article class="reader" lang="my">${text}</article>
    <p class="position">စာမျက်နှာ ${mm(n)} / ${mm(index.pages.length)}</p>
    <nav class="pager" aria-label="စာမျက်နှာများ">
      ${pagerLink(prev, n - 1, "prev", "‹ ယခင်")}
      ${pagerLink(next, n + 1, "next", "နောက် ›")}
    </nav>${notice()}`;
}

/* ---------- router ---------- */
let routeSeq = 0;
const scrollMemo = new Map();

async function route() {
  const seq = ++routeSeq;
  const [category, number, page, anchor] = (location.hash.slice(1) || "/").split("/").filter(Boolean).map(decodeURIComponent);
  let html;
  try {
    afterRender = null;
    if (!category) html = viewHome();
    else if (category === "search") html = viewSearch(number);
    else if (category === "about") html = viewAbout();
    else if (!number) html = viewCategory(category);
    else if (!page) html = await viewBook(`${category}/${number}`);
    else html = await viewReader(`${category}/${number}`, page);
  } catch {
    html = viewError();
  }
  if (seq !== routeSeq) return;  // the reader has already moved on
  $("#view").innerHTML = html;
  const marked = highlight?.hash === location.hash && $(".reader") && markMatches(highlight.q);
  highlight = null;
  const target = anchor && document.getElementById(anchor);
  if (target) target.scrollIntoView();
  else if (!marked) window.scrollTo(0, scrollMemo.get(location.hash) || 0);
  afterRender?.();
}

let lastHash = location.hash;
window.addEventListener("hashchange", () => {
  scrollMemo.set(lastHash, window.scrollY);
  lastHash = location.hash;
  route();
});

/* ---------- events ---------- */
document.addEventListener("click", ev => {
  const fresh = ev.target.closest("[data-fresh]");
  if (fresh) scrollMemo.delete(fresh.getAttribute("href"));  // next/previous always start at the top
  const result = ev.target.closest("[data-q]");
  if (result) highlight = { hash: result.getAttribute("href"), q: result.dataset.q };

  const button = ev.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "retry") {
    bookIndexes.clear();
    start();
  } else if (button.dataset.action === "toggle") {
    const list = button.closest("li").querySelector("ul.sub");
    list.hidden = !list.hidden;
    button.setAttribute("aria-expanded", String(!list.hidden));
  }
});

document.addEventListener("submit", ev => {
  ev.preventDefault();
  const q = ev.target.elements.q.value.trim();
  if (q) location.hash = `#/search/${encodeURIComponent(q)}`;
});

$("#fontDown").onclick = () => changeFontSize(-1);
$("#fontUp").onclick = () => changeFontSize(1);
$("#themeBtn").onclick = () => {
  settings.theme = isDark() ? "light" : "dark";
  applyTheme();
  saveSettings();
};
darkQuery.addEventListener("change", applyTheme);

/* ---------- start ---------- */
async function start() {
  try {
    if (!CAT) await loadCatalog();
  } catch {
    $("#view").innerHTML = viewError();
    return;
  }
  route();
}

applyTheme();
applyFontSize();
start();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
