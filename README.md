# Utility Pages

A small collection of free, browser-based text tools. Everything runs client-side —
no backend, no sign-up, and nothing leaves the browser.

There is **no build step**. The pages are plain HTML, CSS and ES modules, so the
repository can be deployed to any static host exactly as it is.

## Running it

The pages use ES modules and a Web Worker, which browsers only load over `http(s)`,
so they need to be served rather than opened as files:

```bash
npm run serve      # python -m http.server 8000
# then open http://localhost:8000
```

Any static server works — `npx serve`, `php -S`, the Live Server extension. Deployment
is the same: upload the folder to GitHub Pages, Netlify, Cloudflare Pages or similar.
Nothing is compiled and nothing is installed at runtime.

## Tools

### [Text Comparison](tools/text-comparison/index.html)

Compares two texts side by side and highlights every difference: line-level additions and
removals, plus word-level highlighting inside lines that only changed a little.

- Ignore options: case, spaces, line feeds, and escape sequences (`\n`, `\"`, `\t`).
- Per-panel navigation between differences, with <kbd>↑</kbd> / <kbd>↓</kbd> keyboard support
  when a result panel has focus.
- The diff runs in a [Web Worker](tools/text-comparison/diff-worker.js), so the page stays
  responsive on large inputs and a superseded comparison is cancelled outright.
- Diffing uses an LCS dynamic-programming table. Because the DP is O(m·n) in time and memory,
  the table is capped at `MAX_LCS_CELLS` ([diff-engine.js:15](tools/text-comparison/diff-engine.js#L15));
  regions past the cap are split and diffed piecewise rather than exhausting the tab.

[diff behavior.txt](tools/text-comparison/diff%20behavior.txt) documents the expected diff
output for a worked example.

### [Line Break Converter](tools/line-converter/index.html)

Splits input on one separator and joins it with another — line breaks to commas by default,
but any direction works.

- Built-in separators (line break, comma, semicolon, space, tab) plus custom strings for both
  split and join.
- Optional per-item template using `{text}` as the placeholder, e.g. `'{text}'` to quote items.
- Toggles to trim each item and drop empty ones; live item count and one-click copy.

### [Markdown Editor](tools/markdown-editor/index.html)

Markdown source on the left, live styled preview on the right, with synchronized scrolling.

- The preview is `contenteditable`: type in it or paste rich text (Word, Google Docs, a web
  page) and the Markdown source updates to match.
- Copy Markdown or copy rendered HTML; content is persisted in `localStorage`.
- Rendering uses vendored copies of [marked](tools/markdown-editor/vendor/marked.min.js),
  [DOMPurify](tools/markdown-editor/vendor/purify.min.js) for sanitising, and
  [Turndown](tools/markdown-editor/vendor/turndown.min.js) (+ the GFM plugin) for the
  HTML→Markdown direction. All are checked in, so there is nothing to install and no CDN
  to depend on.

## Tests

The DOM-free logic of every tool is covered by the built-in Node test runner. There are no
dependencies to install:

```bash
npm test                                   # everything
npm run test:watch                         # re-run on change
node --test test/diff-engine.test.js       # one file
node --test --test-name-pattern="sentinel" # one test, or a group
```

`package.json` exists only for this; nothing in `test/` ships to users.

## Layout

```
index.html                  catalog of tools
shared/styles.css           shared design tokens and base styles
tools/<tool>/index.html     tool page
tools/<tool>/main.js        entry module — DOM wiring only
tools/<tool>/*.js           supporting modules, DOM-free where possible
tools/<tool>/styles.css     tool-specific styles
test/                       Node test suite (development only)
```

Adding a tool means creating a folder under [tools/](tools/) with a page, an entry module
and a stylesheet, then adding a card to the grid in [index.html](index.html). Keep the
logic in modules that do not touch the DOM so it can be tested directly.
