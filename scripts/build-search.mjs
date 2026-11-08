#!/usr/bin/env node
// Builds the search index in public/search/ from the pages the converter wrote.
// GitHub runs this at publish time, so the index never needs to be committed.
//
// Each token (a syllable, or two syllables together) lists the pages holding it. Pages are numbered
// in catalog order, and the index is split into small files so a search downloads only a few.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const OUT = path.join(PUBLIC, "search");

const shared = {};
vm.runInNewContext(fs.readFileSync(path.join(PUBLIC, "search-tokens.js"), "utf8"), shared);
const { searchTokens, searchStem, searchShard, SEARCH_SHARDS } = shared;

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/** Each paragraph is indexed on its own, so a phrase never matches across two paragraphs. */
function pageTokens(html) {
  const tokens = new Set();
  for (const block of html.split(/<\/(?:p|h[1-6]|li|td|th)>/)) {
    const words = searchTokens(decode(block.replace(/<[^>]+>/g, "")));
    words.forEach((word, i) => {
      const stem = searchStem(word);
      tokens.add(stem);
      if (i > 0) {
        tokens.add(words[i - 1] + word);
        tokens.add(words[i - 1] + stem);
      }
    });
  }
  return tokens;
}

const postings = new Map();
const catalog = JSON.parse(fs.readFileSync(path.join(PUBLIC, "catalog.json"), "utf8"));
let pageNumber = 0;
for (const category of catalog.categories) {
  for (const book of category.books) {
    const dir = path.join(PUBLIC, "books", book.slug);
    const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
    for (const page of index.pages) {
      for (const token of pageTokens(fs.readFileSync(path.join(dir, page.file), "utf8"))) {
        let list = postings.get(token);
        if (!list) postings.set(token, (list = []));
        list.push(pageNumber);
      }
      pageNumber += 1;
    }
  }
}

const shards = Array.from({ length: SEARCH_SHARDS }, () => ({}));
for (const [token, pages] of postings) {
  // Page numbers are stored as gaps between them, which keeps the files small.
  shards[searchShard(token)][token] = pages.map((page, i) => (i ? page - pages[i - 1] : page));
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let total = 0;
shards.forEach((shard, i) => {
  const text = JSON.stringify(shard);
  total += Buffer.byteLength(text);
  fs.writeFileSync(path.join(OUT, `${String(i).padStart(4, "0")}.json`), text, "utf8");
});
console.log(`Search index: ${pageNumber} pages, ${postings.size} tokens, ${Math.round(total / 1048576)} MB in ${SEARCH_SHARDS} files`);
