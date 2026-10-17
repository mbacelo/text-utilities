# Utility Pages

A small collection of free, browser-based tools for text and codes. Everything runs client-side —
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

- Results are aligned row by row, so every line sits next to its counterpart however either
  side wraps; a line that exists on one side only faces an empty filler.
- Ignore options: case, spaces, line feeds, and escape sequences (`\n`, `\"`, `\t`). When no
  differences remain, the verdict names the options that were ignored.
- Step through the changes (each run of consecutive changed lines is one stop) with the
  buttons, or <kbd>↑</kbd> / <kbd>↓</kbd> when the result panel has focus.
- The diff runs in a [Web Worker](tools/text-comparison/diff-worker.js), so the page stays
  responsive on large inputs and a superseded comparison is cancelled outright.
- Diffing uses an LCS dynamic-programming table. Because the DP is O(m·n) in time and memory,
  the table is capped at `MAX_LCS_CELLS` ([diff-engine.js:15](tools/text-comparison/diff-engine.js#L15));
  regions past the cap are split and diffed piecewise rather than exhausting the tab.

[test/diff-behavior.txt](test/diff-behavior.txt) documents the expected diff output for a
worked example.

### [Line Break Converter](tools/line-converter/index.html)

Splits input on one separator and joins it with another — line breaks to commas by default,
but any direction works.

- Built-in separators (line break, comma, semicolon, space, tab) plus custom strings for both
  split and join.
- Optional per-item template using `{text}` as the placeholder, e.g. `'{text}'` to quote items.
- Toggles to trim each item and drop empty ones; one-click copy.
- The output and item count update as you type or change any option.

### [Markdown Editor](tools/markdown-editor/index.html)

Markdown source on the left, live styled preview on the right, with synchronized scrolling.

- Paste rich text (Word, Google Docs, a web page) into the preview with
  <kbd>Ctrl</kbd>+<kbd>V</kbd> (<kbd>⌘</kbd><kbd>V</kbd> on a Mac): just the pasted fragment is
  converted to Markdown and inserted at the editor's cursor, as an ordinary undoable edit. The
  source is never regenerated from the preview, so nothing you wrote gets reformatted. The
  preview is read-only, so browsers offer no right-click or touch "Paste" there - use the
  keyboard shortcut.
- Copy Markdown or copy rendered HTML; content is persisted in `localStorage`.
- Rendering uses vendored copies of [marked](tools/markdown-editor/vendor/marked.min.js),
  [DOMPurify](tools/markdown-editor/vendor/purify.min.js) for sanitising, and
  [Turndown](tools/markdown-editor/vendor/turndown.min.js) (+ the GFM plugin) for the
  HTML→Markdown direction. All are checked in, so there is nothing to install and no CDN
  to depend on.
- To refresh them, re-download the UMD builds into
  [tools/markdown-editor/vendor/](tools/markdown-editor/vendor/); each publishes the global
  the page expects. Note that marked ships its browser build as `lib/marked.umd.js` — the
  `marked.min.js` entry point was dropped in v16.

  ```bash
  cd tools/markdown-editor/vendor
  curl -sSL -o marked.min.js   https://cdn.jsdelivr.net/npm/marked@18/lib/marked.umd.js
  curl -sSL -o purify.min.js   https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js
  curl -sSL -o turndown.min.js https://cdn.jsdelivr.net/npm/turndown@7/dist/turndown.min.js
  ```

### [Barcode Scanner](tools/barcode-scanner/index.html)

Reads barcodes and QR codes from the camera or from an image, shows the value and copies it.

- On a phone the page leads with one **Scan barcode** button that opens the back camera. Once
  camera access has been granted, opening the page starts scanning straight away. Point the
  camera at a code inside the frame: it stops, vibrates and shows the value.
- On a desktop the page leads with a drop zone: paste a screenshot (<kbd>Ctrl</kbd>+<kbd>V</kbd>
  anywhere on the page), drop an image, or click to choose one. The webcam is a secondary button.
  Uploading also works on phones, where the browser offers to take a photo.
- The value is copied automatically when one code is found. Safari and Firefox only allow
  clipboard writes straight after a click, so there the status says *Tap Copy to copy it*
  and the Copy button does it. An image with several codes lists each with its own Copy button.
- The camera needs a secure context: `https://`, or `localhost` while developing. Over plain
  `http` on another host the camera button is hidden and images still work. To try it on a phone
  during development: with an Android phone on USB, use desktop Chrome's `chrome://inspect` →
  *Port forwarding* (`8000` → `localhost:8000`) and open `localhost:8000` on the phone; on an
  iPhone, deploy to an HTTPS host or expose the local server through an HTTPS tunnel.
- Decoding uses a vendored copy of [zxing-wasm](tools/barcode-scanner/vendor/) (the reader
  build, ZXing-C++ compiled to WebAssembly), so it behaves the same in every browser rather than
  depending on the patchily supported `BarcodeDetector`. The library fetches its `.wasm` from
  jsDelivr by default; [decoder.js](tools/barcode-scanner/decoder.js) points it at the vendored
  copy, so nothing is loaded from elsewhere.
- Images are decoded by the browser (so any format it displays works, with EXIF rotation),
  painted onto white with a margin, and scaled down to 2400 px on the long edge. Camera frames
  are cropped to the viewfinder, and a reading is accepted once two frames agree.
- To refresh the vendored files, download the IIFE script and the matching `.wasm` **from the
  same version**:

  ```bash
  cd tools/barcode-scanner/vendor
  curl -sSL -o zxing-reader.js   https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.4/dist/iife/reader/index.js
  curl -sSL -o zxing_reader.wasm https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.4/dist/reader/zxing_reader.wasm
  ```

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
