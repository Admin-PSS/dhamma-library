# ဓမ္မစာကြည့်တိုက် (Dhamma Library)

A free web reader for Burmese Dhamma books. Open it on a phone, pick a category and a book, and read, with no sign-in and no downloads.

**Read it here: https://admin-pss.github.io/dhamma-library/**

## Features

- Books grouped by category, with a contents list for each book
- Full-text search across every book, built for Burmese, which has no spaces between words
- Adjustable text size and dark mode, remembered in your browser
- Made for phones and slow connections: long books are split into small pages
- Installable as an app, and pages you have already read still open offline
- No ads, no account, and no personal data collected

## Thanks

- The Unicode book files come from the [မြတ်ဗုဒ္ဓသာသနာ](https://myatbuddha-sasana.blogspot.com/) blog. Thank you to everyone who prepared and shared them.
- The original PDF books are at [Dhammadownload.com](https://www.dhammadownload.com/).
- Deep gratitude to the Sayadaws and everyone who has given the gift of the Dhamma.

This site is not the official site of either source. To listen to Dhamma talks, see the sister app [တရားနာယူ](https://admin-pss.github.io/tayarnaryu/).

**Please note:** the books were converted from the original PDFs and may contain mistakes. Check important passages against the original PDF.

## Adding or changing books

1. Copy the files into `content/<category folder>/`. A new folder becomes a new category, and its name is what readers see.
2. Double-click `Update Library.bat`. It converts only what is new or changed and shows a report.
3. Type `Y` to publish. The site updates a few minutes later.

Books can be `.docx` or UTF-8 `.txt`. Name new files `NN Title.docx`, for example `04 အဘိဓမ္မာ မြတ်ဒေသနာ.docx`. The number sets the order and the book's address. In `.txt` files, start a line with `# ` for a chapter or `## ` for a section.

The report lists anything to look at: files that were skipped, lines left out because they look like Zawgyi, and books whose printed contents differ from the chapters found.

## How it works

The site is plain HTML, CSS and JavaScript with no build step and no server. A script on the PC turns the books into small static pages.

| Path | What it is |
|---|---|
| `content/` | The master copy of the books, one folder per category |
| `scripts/convert.mjs` | Converts books into reader pages and `catalog.json` |
| `scripts/publish.mjs` | The steps behind `Update Library.bat` |
| `scripts/build-search.mjs` | Builds the search index; GitHub runs this at publish time |
| `public/` | The website, published as it is |
| `slugs.json` | Permanent web addresses and book numbers |
| `convert-cache.json` | Records which books are already converted |
| `.github/workflows/deploy.yml` | Builds the search index and publishes to GitHub Pages |

Most source files have no real Word headings, so the converter finds chapters from short bold lines and markers such as `အခန်း` and `အခဏ်း`. It replaces each printed `မာတိကာ` with a clickable contents list, and splits anything over about 100,000 characters into separate pages.

Search breaks text into syllables and stores which pages hold each pair of syllables, split across 1,024 small files. A search downloads only the few files it needs, and each result is confirmed against the page's real text when it appears on screen.

## Run it locally

Needs Node.js and Python.

```sh
npm install
npm run convert   # turn new or changed books into pages
npm run search    # build the search index
npm run serve     # open http://localhost:8765
```
