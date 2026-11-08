#!/usr/bin/env node
// Converts the books in content/ into static reader pages.
//
//   node scripts/convert.mjs                 convert new and changed books
//   node scripts/convert.mjs --force         convert everything again
//   node scripts/convert.mjs --only=<text>   only books whose category or file name contains <text>
//
// Writes public/books/<category>/<NN>/ (index.json + one HTML fragment per page) and
// public/catalog.json. The rules for reading these files are explained in CLAUDE.md.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mammoth from "mammoth";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT), "..");
const CONTENT_DIR = path.join(ROOT, "content");
const BOOKS_DIR = path.join(ROOT, "public", "books");
const CATALOG_FILE = path.join(ROOT, "public", "catalog.json");
const SLUGS_FILE = path.join(ROOT, "slugs.json");
const CACHE_FILE = path.join(ROOT, "convert-cache.json");

const PAGE_LIMIT = 100_000; // characters; roughly 300 KB of Burmese text
const HEADING_MAX = 90; // longest paragraph that can count as a heading
const CHAPTER_TITLE_MAX = 150; // longest chapter title after rejoining its lines
const FRONT_MAX = 120; // longest line in the opening title block
const FRONT_PLAIN_LINES = 6; // how far into a book a short non-bold line (the author) is still title block
const SMALL_PRELUDE = 2_000; // opening text this short joins the first chapter
const MATIKA_MAX_SHARE = 0.25; // never remove more than this as a printed contents list
const SUPPORTED = new Set([".docx", ".txt"]);

const collator = new Intl.Collator("my", { numeric: true });
const nfc = (s) => s.normalize("NFC");
const NUM = "[၀-၉ဝ0-9]+";

// ---------------------------------------------------------------- text helpers

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescapeHtml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const plainText = (html) => unescapeHtml(html.replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "")).trim();

/** Comparison form of a line: printed lists and headings differ in spacing and punctuation. */
const lineKey = (s) => s.replace(/[\s\-–—.,:;၊။“”"'()=]/g, "");

function toInt(digits) {
  const ascii = digits.replace(/ဝ/g, "၀").replace(/[၀-၉]/g, (d) => String(d.charCodeAt(0) - 0x1040));
  return Number.parseInt(ascii, 10);
}

const toBurmeseDigits = (n) => String(n).replace(/[0-9]/g, (d) => String.fromCharCode(0x1040 + Number(d)));

/** The number starting a file name. `၆.၂ ယမကပါဠိ` is a volume, so it stays part of the title. */
const LEADING_NUMBER = /^\s*([0-9၀-၉]+)(?![.][0-9၀-၉])[\s.\-_]+/;

function displayTitle(fileName) {
  return nfc(path.parse(fileName).name)
    .replace(LEADING_NUMBER, "")
    .replace(/\bunicode\b|\brev-?\d+\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s\-–—]+$/, "")
    .trim();
}

function leadingNumber(fileName) {
  const m = nfc(fileName).match(LEADING_NUMBER);
  return m ? toInt(m[1]) : null;
}

// ---------------------------------------------------------------- line classification

const MARKER = "(?:အ\\s*ခန်း|အ\\s*ခဏ်း?)\\s*[-–—:.]?\\s*\\(?\\s*"; // sources also have အ ခဏ်း and အခဏ်
const CHAPTER_NUMBER = new RegExp(`^[\\s“”"'(]*${MARKER}(${NUM})`);
const CHAPTER_MARKER_ONLY = new RegExp(`^[\\s“”"'(]*${MARKER}${NUM}\\s*[)၊။”"'\\s]*$`);
const NOT_CHAPTER = /စာမျက်နှာ|နောက်ဆက်တွဲ|ပြီး၏?[။၊]?[\s”"]*$/;
const PART_ORDINAL = /^[\s“”"(]*(?:ပဌမ|ပထမ|ဒုတိယ|တတိယ|စတုတ္ထ|ပဉ္စမ|ဆဋ္ဌမ|သတ္တမ|အဋ္ဌမ|နဝမ|ဒသမ)\s*ပိုင်း[\s”")]*$/;
const PART_NUMBER = new RegExp(`အပိုင်း\\s*[-–(]?\\s*${NUM}\\s*\\)?[\\s”"]*$`);
const NAMED_DIVISION = /ခဏ်း[\s”"]*$/;
const VOLUME_LINE = /^[\s(“"]*\S*တွဲ[\s)”"]*(?:\(.*\))?[\s”"]*$/;
const SENTENCE_END = /[၊။][\s”"']*$/;
const ENUMERATED = new RegExp(`^[\\s“"]*\\((?:${NUM}|[က-အ])\\)`);
const MATIKA_TITLE = /^(?:အသေးစိတ်\s*)?မာတိကာ\s*$/;
const MATIKA_CLOSE = /မာတိကာ.{0,20}(?:ပြီး|နိဋ္ဌိတာ)/;
const NUMBERED_ENTRY = new RegExp(`^[\\s(]*${NUM}\\s*[။.)]`);
const HOMAGE = /^နမော\s+တဿ/;

const NOISE_TAG = /^[#[(]?\s*unicode\s*[\])]?$/i;
const NOISE_RULE = /^[\s.…▬ஜ۩۞•·_\-–—=*~]+$/;
const isNoise = (text) => !text || NOISE_TAG.test(text) || NOISE_RULE.test(text);

function chapterNumber(text) {
  if (text.length > HEADING_MAX || NOT_CHAPTER.test(text)) return null;
  const m = text.match(CHAPTER_NUMBER);
  return m ? toInt(m[1]) : null;
}

/** Part titles and named divisions only act as chapters in books without numbered chapters. */
const isNamedDivision = (text) =>
  text.length <= HEADING_MAX &&
  !NOT_CHAPTER.test(text) &&
  (PART_ORDINAL.test(text) || PART_NUMBER.test(text) || NAMED_DIVISION.test(text));

const stripQuotes = (s) => s.replace(/^[\s“”"'‘’]+|[\s“”"'‘’]+$/g, "").replace(/\s+/g, " ");

/** Zawgyi uses code points and letter orders that correct Burmese Unicode text never does. */
function looksZawgyi(text) {
  const myanmar = (text.match(/[က-႟]/g) || []).length;
  if (!myanmar) return false;
  const strong =
    (text.match(/[ၠ-႗]/g) || []).length + (text.match(/္(?![က-အ])/g) || []).length;
  const weak = (text.match(/(?:^|\s)ေ/g) || []).length;
  // One stray mark is a typing slip in Unicode text (ရန္ ရမ္ပိ), so it takes at least two.
  return strong + weak >= 2 && (strong + weak) / myanmar >= 0.03;
}

// ---------------------------------------------------------------- reading source files

/** Splits mammoth's flat HTML into its top-level blocks, keeping tables and lists whole. */
function topLevelBlocks(html) {
  const blocks = [];
  let pos = 0;
  while (pos < html.length) {
    const open = /<([a-z0-9]+)[^>]*>/g;
    open.lastIndex = pos;
    const first = open.exec(html);
    if (!first) break;
    const tag = first[1];
    const inner = new RegExp(`<(/?)${tag}(?:\\s[^>]*)?>`, "g");
    inner.lastIndex = first.index;
    let depth = 0;
    let end = html.length;
    for (let m = inner.exec(html); m; m = inner.exec(html)) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) {
        end = m.index + m[0].length;
        break;
      }
    }
    blocks.push({ tag, html: html.slice(first.index, end) });
    pos = end;
  }
  return blocks;
}

function boldShare(html, text) {
  if (!text) return 0;
  let bold = 0;
  for (const m of html.matchAll(/<strong>(.*?)<\/strong>/gs)) bold += plainText(m[1]).length;
  return bold / text.length;
}

async function readDocx(file, warnings) {
  let images = 0;
  const result = await mammoth.convertToHtml(
    { path: file },
    {
      convertImage: mammoth.images.imgElement(async () => {
        images += 1;
        return { src: "" };
      }),
    },
  );
  if (images) warnings.push(`${images} image(s) left out`);

  const items = [];
  for (const block of topLevelBlocks(result.value)) {
    const html = block.html
      .replace(/<img[^>]*>/g, "")
      .replace(/<a\b[^>]*>/g, "")
      .replace(/<\/a>/g, "");
    if (html.includes('id="footnote-')) warnings.push("footnotes present; check them by hand");
    const text = plainText(html);
    const styled = block.tag.match(/^h([1-6])$/); // a real Word heading, as OCR exports have
    if (styled) items.push({ html, text, bold: true, headingLevel: Number(styled[1]) });
    else items.push({ html, text, bold: block.tag === "p" && boldShare(html, text) > 0.8 });
  }
  return items;
}

function decodeText(file, warnings) {
  const bytes = fs.readFileSync(file);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  const text = bytes.toString("utf8").replace(/^﻿/, "");
  if (text.includes("�")) warnings.push("not valid UTF-8; some characters are damaged");
  return text;
}

/** In .txt files `# Title` marks a chapter and `## Title` a section; marker lines are also found. */
function readTxt(file, warnings) {
  const items = [];
  for (const raw of decodeText(file, warnings).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const marked = line.match(/^(#{1,2})\s+(.+)$/);
    if (marked) {
      items.push({ text: marked[2].trim(), html: "", bold: true, forced: marked[1].length === 1 ? "chapter" : "section" });
    } else {
      items.push({ text: line, html: `<p>${escapeHtml(line)}</p>`, bold: false });
    }
  }
  return items;
}

// ---------------------------------------------------------------- understanding the book

/** Removes the printed မာတိကာ, which the generated table of contents replaces. */
function removeMatika(items, warnings) {
  const start = items.findIndex((it, i) => i < items.length / 3 && MATIKA_TITLE.test(it.text));
  if (start < 0 || start + 1 >= items.length) return { items, matikaChapters: null };

  const firstKey = lineKey(items[start + 1].text);
  const firstNumber = chapterNumber(items[start + 1].text);
  let end = -1;
  for (let j = start + 2; j < items.length; j += 1) {
    if (lineKey(items[j].text) === firstKey || (firstNumber !== null && chapterNumber(items[j].text) === firstNumber)) {
      end = j;
      break;
    }
  }
  // Most books close the list themselves (… မာတိကာ ပြီး၏။), and everything after that line is text.
  const searchEnd = end < 0 ? Math.floor(items.length / 3) : end;
  let closing = -1;
  for (let i = start + 1; i < searchEnd; i += 1) {
    if (items[i].text.length <= HEADING_MAX && MATIKA_CLOSE.test(items[i].text)) closing = i;
  }

  if (closing < 0 && end < 0) end = items.findIndex((it, i) => i > start && it.text.length > 200);
  if (closing < 0 && end < 0) {
    warnings.push("printed contents list found but its end is unclear; left in place");
    return { items, matikaChapters: null };
  }

  let cut = closing + 1;
  if (closing < 0) {
    // The body's opening homage sits just before the first chapter; it is text, not contents.
    cut = end;
    for (let i = end - 1; i > start && i >= end - 8; i -= 1) {
      if (HOMAGE.test(items[i].text)) {
        cut = i;
        break;
      }
    }

    // Contents entries are short, so a long paragraph here is body text, along with its bold title.
    const longAt = items.findIndex((it, i) => i > start && i < cut && it.text.length > 200);
    if (longAt > 0) cut = longAt - 1 > start && items[longAt - 1].bold ? longAt - 1 : longAt;

    // When unsure, keep it: a line that never reappears and is not a numbered entry may be text.
    const later = new Set(items.slice(cut).map((it) => lineKey(it.text)));
    while (cut - 1 > start) {
      const { text } = items[cut - 1];
      if (later.has(lineKey(text)) || NUMBERED_ENTRY.test(text) || chapterNumber(text) !== null || isNamedDivision(text)) break;
      cut -= 1;
    }
  }

  const total = items.reduce((n, it) => n + it.text.length, 0);
  const removed = items.slice(start, cut);
  if (removed.reduce((n, it) => n + it.text.length, 0) > total * MATIKA_MAX_SHARE) {
    warnings.push("printed contents list looks too long to be one; left in place");
    return { items, matikaChapters: null };
  }
  const numbers = new Set(removed.map((it) => chapterNumber(it.text)).filter((n) => n !== null));
  const matikaChapters = numbers.size || new Set(removed.filter((it) => isNamedDivision(it.text)).map((it) => lineKey(it.text))).size;
  return { items: [...items.slice(0, start), ...items.slice(cut)], matikaChapters };
}

function classify(items, bookTitle) {
  const titleKey = lineKey(bookTitle.replace(/[\s0-9.]+$/, ""));
  const canBeHeading = (item) => item.bold || item.plain;
  const numberedBook = items.some((item) => canBeHeading(item) && chapterNumber(item.text) !== null);
  // Word heading levels only say what is a chapter when a book uses more than one level.
  const levels = items.filter((item) => item.headingLevel).map((item) => item.headingLevel);
  const chapterLevel = new Set(levels).size > 1 ? Math.min(...levels) : null;
  for (const item of items) {
    const { text } = item;
    const isChapter = chapterNumber(text) !== null || (!numberedBook && isNamedDivision(text));
    if (item.forced) item.role = item.forced;
    else if (isChapter && canBeHeading(item)) item.role = "chapter";
    else if (item.headingLevel) item.role = item.headingLevel === chapterLevel ? "chapter" : "section";
    else if (!item.bold || text.length > HEADING_MAX || SENTENCE_END.test(text)) item.role = "body";
    else if (VOLUME_LINE.test(text) || (titleKey.length >= 4 && lineKey(text).includes(titleKey))) item.role = "front";
    else item.role = "section";
  }

  // The opening title block is display text, not part of the table of contents.
  for (const [i, item] of items.entries()) {
    if (item.role === "chapter" || item.text.length > FRONT_MAX) break;
    if (item.role === "section" || (item.role === "body" && i < FRONT_PLAIN_LINES)) item.role = "front";
  }
}

/** Rejoins headings the source broke over two lines, such as a chapter number and its title. */
function joinHeadings(items) {
  const joined = [];
  for (const item of items) {
    const prev = joined[joined.length - 1];
    const continues =
      prev && item.bold && !item.afterGap && !item.forced && !prev.forced &&
      item.text.length <= HEADING_MAX && !ENUMERATED.test(item.text);
    if (continues) {
      const part = stripQuotes(item.text);
      const hasMarker = prev.titled || CHAPTER_MARKER_ONLY.test(prev.text);
      if (
        prev.role === "chapter" && hasMarker && (item.role === "section" || item.role === "body") &&
        prev.text.length + part.length <= CHAPTER_TITLE_MAX
      ) {
        prev.text = prev.titled ? `${prev.text} ${part}` : `${stripQuotes(prev.text).replace(/[\s၊။]+$/, "")} — ${part}`;
        prev.titled = true;
        continue;
      }
      const splitLine = prev.role === "section" && item.role === "section" && !item.headingLevel;
      if (splitLine && prev.text.length + part.length + 1 <= HEADING_MAX) {
        prev.text = `${prev.text} ${part}`;
        continue;
      }
    }
    joined.push(item);
  }
  for (const item of joined) {
    if (item.role === "chapter" || item.role === "section") {
      item.text = stripQuotes(item.text);
      if (item.role === "chapter") item.text = item.text.replace(/[\s၊။]+$/, "");
    }
  }
  return joined;
}

const sizeOf = (blocks) => blocks.reduce((n, b) => n + b.text.length, 0);

/** Fits one chapter into pages of at most PAGE_LIMIT, preferring to break at section headings. */
function paginate(blocks) {
  const runs = [];
  for (const block of blocks) {
    if (block.role === "section" || runs.length === 0) runs.push([]);
    runs[runs.length - 1].push(block);
  }

  const pages = [];
  let current = [];
  const flush = () => {
    if (current.length) pages.push(current);
    current = [];
  };
  for (const run of runs) {
    if (sizeOf(run) > PAGE_LIMIT) {
      flush();
      for (const block of run) {
        if (current.length && sizeOf(current) + block.text.length > PAGE_LIMIT) flush();
        current.push(block);
      }
      flush();
    } else {
      if (current.length && sizeOf(current) + sizeOf(run) > PAGE_LIMIT) flush();
      current.push(...run);
    }
  }
  flush();
  return pages;
}

function buildPages(items, bookTitle) {
  const chapters = [];
  for (const item of items) {
    if (item.role === "chapter" || chapters.length === 0) chapters.push({ blocks: [] });
    chapters[chapters.length - 1].blocks.push(item);
  }
  if (chapters.length > 1 && chapters[0].blocks[0].role !== "chapter" && sizeOf(chapters[0].blocks) < SMALL_PRELUDE) {
    chapters[1].blocks.unshift(...chapters[0].blocks);
    chapters.shift();
  }

  const pages = [];
  const toc = [];
  let anchor = 0;
  for (const chapter of chapters) {
    const heading = chapter.blocks.find((b) => b.role === "chapter") ?? chapter.blocks.find((b) => b.role === "section");
    const chapterTitle = heading ? heading.text : bookTitle;
    paginate(chapter.blocks).forEach((blocks, i, all) => {
      const pageNumber = pages.length + 1;
      const html = [];
      for (const block of blocks) {
        if (block.role === "chapter" || block.role === "section") {
          anchor += 1;
          const level = block.role === "chapter" ? 2 : 3;
          toc.push({ level, title: block.text, page: pageNumber, id: `s${anchor}` });
          html.push(`<h${level} id="s${anchor}">${escapeHtml(block.text)}</h${level}>`);
        } else if (block.role === "front") {
          html.push(`<p class="front">${escapeHtml(block.text)}</p>`);
        } else {
          html.push(block.html);
        }
      }
      pages.push({
        file: `${String(pageNumber).padStart(3, "0")}.html`,
        title: all.length > 1 ? `${chapterTitle} (${toBurmeseDigits(i + 1)})` : chapterTitle,
        chars: sizeOf(blocks),
        html: `${html.join("\n")}\n`,
      });
    });
  }
  return { pages, toc };
}

async function convertBook(book) {
  const warnings = [];
  const read = book.ext === ".docx" ? await readDocx(book.file, warnings) : readTxt(book.file, warnings);

  const items = [];
  const zawgyiLines = [];
  let afterGap = false;
  for (const item of read) {
    if (isNoise(item.text)) {
      afterGap = true; // a rule or blank line ends a heading that runs over several lines
      continue;
    }
    if (looksZawgyi(item.text)) {
      zawgyiLines.push(item.text);
      continue;
    }
    items.push({ ...item, plain: book.ext === ".txt", afterGap });
    afterGap = false;
  }
  if (zawgyiLines.length > items.length) {
    return { skipped: "looks like Zawgyi, not Unicode", warnings };
  }
  for (const line of zawgyiLines) warnings.push(`Zawgyi line left out: ${line.slice(0, 50)}`);
  if (!items.length) return { skipped: "no text found", warnings };

  const { items: body, matikaChapters } = removeMatika(items, warnings);
  classify(body, book.title);
  const { pages, toc } = buildPages(joinHeadings(body), book.title);

  const chapters = toc.filter((t) => t.level === 2).length;
  if (matikaChapters && matikaChapters !== chapters) {
    warnings.push(`printed contents list has ${matikaChapters} chapters, found ${chapters}`);
  }
  return { pages, toc, chapters, warnings };
}

// ---------------------------------------------------------------- slugs, cache, output

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const fingerprint = (data) => createHash("sha256").update(data).digest("hex");

function scanContent(report) {
  const categories = [];
  for (const dir of fs.readdirSync(CONTENT_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const folder = nfc(dir.name);
    const books = [];
    for (const entry of fs.readdirSync(path.join(CONTENT_DIR, dir.name), { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith("~$")) continue;
      const ext = path.extname(entry.name).toLowerCase();
      const key = `${folder}/${nfc(entry.name)}`;
      if (!SUPPORTED.has(ext)) {
        report.skipped.push(`${key} (unsupported file type)`);
        continue;
      }
      books.push({ key, ext, fileName: entry.name, file: path.join(CONTENT_DIR, dir.name, entry.name), title: displayTitle(entry.name) });
    }
    categories.push({ folder, books });
  }
  return categories.sort((a, b) => collator.compare(a.folder, b.folder));
}

function assignCategorySlug(folder, slugs) {
  if (slugs.categories[folder]) return slugs.categories[folder];
  const used = new Set(Object.values(slugs.categories));
  let n = 1;
  while (used.has(`cat-${n}`)) n += 1;
  slugs.categories[folder] = `cat-${n}`;
  return slugs.categories[folder];
}

/** Numbers are stored once and never reused for another book, so URLs stay stable. */
function assignBookNumbers(category, slugs, report) {
  const prefix = `${category.folder}/`;
  const present = new Set(category.books.map((b) => b.key));
  const owner = new Map();
  for (const [key, number] of Object.entries(slugs.books)) {
    if (key.startsWith(prefix)) owner.set(number, key);
  }
  const claim = (book, number) => {
    owner.set(number, book.key);
    slugs.books[book.key] = number;
  };

  const unnumbered = [];
  for (const book of category.books) {
    if (slugs.books[book.key] !== undefined) continue;
    const wanted = leadingNumber(book.fileName);
    if (wanted === null) unnumbered.push(book);
    else if (owner.has(wanted) && present.has(owner.get(wanted))) {
      report.problems.push(`${book.key}: number ${wanted} is already used in this folder; gave it a new one`);
      unnumbered.push(book);
    } else claim(book, wanted);
  }

  unnumbered.sort((a, b) => collator.compare(a.title, b.title));
  for (const book of unnumbered) claim(book, Math.max(0, ...owner.keys()) + 1);
  for (const book of category.books) book.number = slugs.books[book.key];
  category.books.sort((a, b) => a.number - b.number);
}

function writeBook(book, category, result) {
  const dir = path.join(BOOKS_DIR, category.slug, book.numberText);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const page of result.pages) fs.writeFileSync(path.join(dir, page.file), page.html, "utf8");
  writeJson(path.join(dir, "index.json"), {
    slug: book.slug,
    title: book.title,
    category: category.folder,
    pages: result.pages.map(({ file, title, chars }) => ({ file, title, chars })),
    toc: result.toc,
  });
}

function printReport(report) {
  console.log("");
  for (const [label, list] of [
    ["New", report.added],
    ["Changed", report.changed],
    ["Removed", report.removed],
    ["Skipped", report.skipped],
    ["Problems", report.problems],
  ]) {
    console.log(`${label}: ${list.length}`);
    for (const line of list) console.log(`  ${line}`);
  }
  console.log(`Unchanged: ${report.unchanged}`);
}

async function main() {
  const force = process.argv.includes("--force");
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
  const version = fingerprint(fs.readFileSync(SCRIPT));

  const slugs = { categories: {}, books: {}, ...readJson(SLUGS_FILE, {}) };
  const cache = readJson(CACHE_FILE, { version: "", books: {} });
  const report = { added: [], changed: [], removed: [], skipped: [], problems: [], unchanged: 0 };
  const categories = scanContent(report);

  for (const category of categories) {
    category.slug = assignCategorySlug(category.folder, slugs);
    assignBookNumbers(category, slugs, report);
  }

  const onDisk = new Set(categories.flatMap((c) => c.books.map((b) => b.key)));
  for (const [key, entry] of Object.entries(cache.books)) {
    if (onDisk.has(key)) continue;
    fs.rmSync(path.join(BOOKS_DIR, entry.slug), { recursive: true, force: true });
    delete cache.books[key];
    report.removed.push(key);
  }

  for (const category of categories) {
    for (const book of category.books) {
      if (only && !book.key.includes(nfc(only))) {
        if (cache.books[book.key]) report.unchanged += 1;
        continue;
      }
      book.numberText = String(book.number).padStart(2, "0");
      book.slug = `${category.slug}/${book.numberText}`;
      const hash = fingerprint(fs.readFileSync(book.file));
      const cached = cache.books[book.key];
      if (!force && cached?.hash === hash && cache.version === version) {
        report.unchanged += 1;
        continue;
      }

      try {
        const result = await convertBook(book);
        if (result.skipped) {
          report.skipped.push(`${book.key} (${result.skipped})`);
          continue;
        }
        writeBook(book, category, result);
        cache.books[book.key] = {
          hash,
          slug: book.slug,
          number: book.number,
          title: book.title,
          category: category.folder,
          format: book.ext.slice(1),
          chapters: result.chapters,
          pages: result.pages.length,
          chars: result.pages.reduce((n, p) => n + p.chars, 0),
        };
        const largest = Math.max(...result.pages.map((p) => p.chars));
        const line = `${book.slug}  ${book.title}: ${result.chapters} chapters, ${result.toc.length} headings, ${result.pages.length} pages, largest ${largest} chars`;
        (cached ? report.changed : report.added).push(line);
        for (const warning of result.warnings) report.problems.push(`${book.slug} ${book.title}: ${warning}`);
      } catch (error) {
        report.problems.push(`${book.key}: failed: ${error.message}`);
      }
    }
  }

  cache.version = only ? cache.version : version;
  const catalog = {
    categories: categories
      .map((category) => ({
        slug: category.slug,
        title: category.folder,
        books: category.books
          .filter((b) => cache.books[b.key])
          .map((b) => {
            const { slug, number, title, format, chapters, pages, chars } = cache.books[b.key];
            return { slug, number, title, format, chapters, pages, chars };
          }),
      }))
      .filter((c) => c.books.length)
      .map((c) => ({ ...c, count: c.books.length })),
  };

  fs.mkdirSync(path.dirname(CATALOG_FILE), { recursive: true });
  writeJson(CATALOG_FILE, catalog);
  writeJson(SLUGS_FILE, slugs);
  writeJson(CACHE_FILE, cache);

  printReport(report);
  if (report.problems.some((p) => p.includes(": failed:"))) process.exitCode = 1;
}

await main();
