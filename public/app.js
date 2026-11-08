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
  return `<h2 class="section-title">စာအုပ်အမျိုးအစားများ</h2><div class="cats">${cards}</div>${notice("ဤစာအုပ်များ")}`;
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
    if (!category) html = viewHome();
    else if (!number) html = viewCategory(category);
    else if (!page) html = await viewBook(`${category}/${number}`);
    else html = await viewReader(`${category}/${number}`, page);
  } catch {
    html = viewError();
  }
  if (seq !== routeSeq) return;  // the reader has already moved on
  $("#view").innerHTML = html;
  const target = anchor && document.getElementById(anchor);
  if (target) target.scrollIntoView();
  else window.scrollTo(0, scrollMemo.get(location.hash) || 0);
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
