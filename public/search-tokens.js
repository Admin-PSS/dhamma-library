/* How text is broken up for search. The site and scripts/build-search.mjs both use this file,
   so a query is always cut up the same way as the books were. */
var SEARCH_SHARDS = 1024;

/** Burmese spacing is inconsistent, so only letters and digits count, and look-alikes are merged. */
function searchClean(text) {
  return String(text).normalize("NFC").toLowerCase()
    .replace(/၀/g, "ဝ")
    .replace(/သြ/g, "ဩ")
    .replace(/[^က-၉၌-႟a-z0-9]/g, "");
}

/** Cuts text into syllables (Burmese has no spaces between words) and whole Latin or number runs. */
function searchTokens(text) {
  return searchClean(text)
    .replace(/(?<!္)([က-အ])(?![်္])|([ဣ-ဪဿ၌-၏၀-၉])|([a-z0-9]+)/g, "\u0001$&")
    .split("\u0001")
    .filter(Boolean);
}

/** A syllable without its ending, so ဗုဒ္ဓ also finds the inflected ဗုဒ္ဓေါ, ဗုဒ္ဓံ and သံဃာ့. */
function searchStem(token) {
  return token.replace(/(?:[ါာ]်|[ါ-ဲံ-း])+$/, "") || token;
}

/** The index entries that must all exist on a page holding the query. */
function searchKeys(query) {
  var words = searchTokens(query);
  if (words.length < 2) return words.map(searchStem);
  var keys = [];
  for (var i = 1; i < words.length; i++) {
    keys.push(words[i - 1] + (i === words.length - 1 ? searchStem(words[i]) : words[i]));
  }
  return keys.filter(function (key, i) { return keys.indexOf(key) === i; });
}

/** Which index file holds a token. */
function searchShard(token) {
  var hash = 2166136261;
  for (var i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % SEARCH_SHARDS;
}
