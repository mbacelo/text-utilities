# Utility Pages

A small collection of free, browser-based text tools. Everything runs client-side —
no build step, no server, no sign-up, and nothing leaves the browser.

## Running it

Open [index.html](index.html) directly in a browser, or serve the folder over HTTP if you
prefer (some browsers restrict `file://` behaviour):

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Tools

### [Text Comparison](tools/text-comparison/index.html)

Compares two texts side by side and highlights every difference: line-level additions and
removals, plus word-level highlighting inside lines that only changed a little.

- Ignore options: case, spaces, line feeds, and escape sequences (`\n`, `\"`, `\t`).
- Per-panel navigation between differences, with <kbd>↑</kbd> / <kbd>↓</kbd> keyboard support
  when a result panel has focus.
- Diffing uses an LCS dynamic-programming table. Because the DP is O(m·n) in time and memory,
  the table is capped at `MAX_LCS_CELLS` ([script.js:20](tools/text-comparison/script.js#L20));
  regions past the cap fall back to a coarser diff instead of exhausting the tab.

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
  HTML→Markdown direction. All are checked in, so the page works offline.

## Tests

The text comparison tool has a browser test page — open
[tools/text-comparison/tests.html](tools/text-comparison/tests.html) and the results render on
load, green when everything passes.

## Layout

```
index.html                  catalog of tools
shared/styles.css           shared design tokens and base styles
tools/<tool>/index.html     tool page
tools/<tool>/script.js      tool logic (plain ES5/ES6, IIFE, no modules)
tools/<tool>/styles.css     tool-specific styles
```

Adding a tool means creating a folder under [tools/](tools/) with those three files and
adding a card to the grid in [index.html](index.html).
