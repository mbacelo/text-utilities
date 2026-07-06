/**
 * Markdown Editor & Previewer
 * Left pane is a plain-text Markdown editor; right pane renders a live,
 * sanitized preview (marked + DOMPurify). Scrolling either pane keeps the
 * other aligned to the corresponding section.
 *
 * The conversion also works in reverse: the preview is contenteditable, so
 * typing in it or pasting rich text (HTML) updates it directly, and every
 * edit is converted back to Markdown (via Turndown) into the editor. When
 * the preview loses focus its HTML is re-rendered from the Markdown so it
 * snaps back to the canonical presentation.
 *
 * Scroll sync works with anchor points instead of a plain percentage:
 * every top-level Markdown block knows its source line, a hidden "mirror"
 * element measures the pixel position of each source line inside the
 * textarea (accounting for soft-wrapped lines), and scrolling interpolates
 * between the surrounding anchors.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'markdown-editor-content';

    const SAMPLE = `# Markdown Editor

Type on the left, see the result on the right. **Bold**, *italic*,
\`inline code\` and [links](https://example.com) all work.

## Lists

1. Ordered item
2. Another item
   - Nested bullet
   - One more

- [x] Task list too
- [ ] Still pending

## Table

| Feature | Supported |
| ------- | :-------: |
| Headings | yes |
| Tables | yes |
| Code blocks | yes |

## Code

\`\`\`js
function greet(name) {
    return \`Hello, \${name}!\`;
}
\`\`\`

> Blockquotes are handy for callouts.

---

That's it — clear this and start writing.
`;

    const els = {};
    const ids = [
        'editor', 'preview', 'editorMeta', 'copyStatus',
        'clearBtn', 'copyMdBtn', 'copyHtmlBtn'
    ];

    // Scroll-sync state
    let mirror = null;           // hidden div replicating the textarea's layout
    let lineTops = [];           // pixel offset of each source line inside the editor
    let anchors = [];            // [{ed, pv}] matching pixel offsets in both panes
    let activePane = null;       // which pane the user is driving: 'editor' | 'preview'
    let renderQueued = false;
    let turndown = null;         // lazily created HTML -> Markdown converter
    let previewDirty = false;    // preview was hand-edited; re-render on blur

    function cacheElements() {
        ids.forEach(id => { els[id] = document.getElementById(id); });
    }

    /* =====================
       Rendering
       ===================== */

    /**
     * Render the Markdown into the preview. Each top-level block is wrapped
     * in a div carrying its source line number so the scroll sync can build
     * anchor points.
     */
    function render() {
        const text = els.editor.value;

        if (text.trim() === '') {
            // Leave the pane truly empty so the CSS :empty placeholder shows
            // and typing starts from a clean slate.
            els.preview.innerHTML = '';
            updateMeta(text);
            rebuildSyncMap();
            return;
        }

        const tokens = marked.lexer(text);
        let line = 0;
        let html = '';

        for (const token of tokens) {
            const lineCount = token.raw.split('\n').length - 1;
            if (token.type !== 'space') {
                const blockTokens = [token];
                blockTokens.links = tokens.links;
                html += `<div class="md-block" data-line="${line}">` +
                    marked.parser(blockTokens) + '</div>';
            }
            line += lineCount;
        }

        els.preview.innerHTML = DOMPurify.sanitize(html);
        updateMeta(text);
        rebuildSyncMap();
        // Keep the preview aligned with wherever the editor currently is.
        syncFromEditor();
    }

    function scheduleRender() {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
            renderQueued = false;
            render();
        });
    }

    function updateMeta(text) {
        const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
        els.editorMeta.textContent =
            `${words} word${words === 1 ? '' : 's'} · ${text.length} characters`;
    }

    /* =====================
       Scroll sync
       ===================== */

    /** Create the hidden mirror element used to measure line positions. */
    function createMirror() {
        mirror = document.createElement('div');
        mirror.className = 'editor-mirror';
        mirror.setAttribute('aria-hidden', 'true');
        els.editor.parentElement.style.position = 'relative';
        els.editor.parentElement.appendChild(mirror);
    }

    /** Match the mirror's typography and box to the textarea so each logical
        line wraps identically and offsetTop values line up with scrollTop. */
    function syncMirrorStyles() {
        const cs = getComputedStyle(els.editor);
        ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
            'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
            'boxSizing', 'tabSize'].forEach(prop => {
            mirror.style[prop] = cs[prop];
        });
        // clientWidth excludes the border but includes padding, matching
        // the area the textarea actually wraps text in.
        mirror.style.width = els.editor.clientWidth + 'px';
    }

    /**
     * Measure the pixel offset of every source line inside the editor.
     * Each logical line becomes its own block in the mirror, which
     * reproduces the textarea's soft wrapping, so offsetTop is accurate
     * even for long wrapped lines.
     */
    function measureLines() {
        syncMirrorStyles();
        const lines = els.editor.value.split('\n');
        const frag = document.createDocumentFragment();
        for (const lineText of lines) {
            const div = document.createElement('div');
            div.textContent = lineText === '' ? '​' : lineText;
            frag.appendChild(div);
        }
        mirror.replaceChildren(frag);

        lineTops = [];
        for (const child of mirror.children) {
            lineTops.push(child.offsetTop);
        }
    }

    /** Build the anchor map pairing editor pixel offsets with preview ones. */
    function rebuildSyncMap() {
        measureLines();
        anchors = [{ ed: 0, pv: 0 }];
        els.preview.querySelectorAll('.md-block').forEach(block => {
            const line = Number(block.dataset.line);
            if (line < lineTops.length) {
                anchors.push({ ed: lineTops[line], pv: block.offsetTop });
            }
        });
        anchors.push({ ed: els.editor.scrollHeight, pv: els.preview.scrollHeight });
    }

    /**
     * Translate a scroll offset from one pane into the other by linear
     * interpolation between the two surrounding anchors.
     * @param {number} pos scrollTop in the source pane
     * @param {'ed'|'pv'} from key of the source pane in the anchor map
     * @param {'ed'|'pv'} to key of the target pane
     * @returns {number}
     */
    function translateScroll(pos, from, to) {
        let lower = anchors[0];
        let upper = anchors[anchors.length - 1];
        for (let i = 0; i < anchors.length - 1; i++) {
            if (anchors[i][from] <= pos && pos <= anchors[i + 1][from]) {
                lower = anchors[i];
                upper = anchors[i + 1];
                break;
            }
        }
        const span = upper[from] - lower[from];
        const ratio = span === 0 ? 0 : (pos - lower[from]) / span;
        return lower[to] + ratio * (upper[to] - lower[to]);
    }

    /** @param {HTMLElement} el @returns {boolean} scrolled to the bottom */
    function atBottom(el) {
        return el.scrollTop >= el.scrollHeight - el.clientHeight - 2;
    }

    function syncFromEditor() {
        els.preview.scrollTop = atBottom(els.editor)
            ? els.preview.scrollHeight
            : translateScroll(els.editor.scrollTop, 'ed', 'pv');
    }

    function syncFromPreview() {
        els.editor.scrollTop = atBottom(els.preview)
            ? els.editor.scrollHeight
            : translateScroll(els.preview.scrollTop, 'pv', 'ed');
    }

    /* =====================
       Rich text -> Markdown (paste into the preview)
       ===================== */

    function isStyledBold(node) {
        const weight = node.style.fontWeight;
        return weight === 'bold' || parseInt(weight, 10) >= 600;
    }

    function isStyledItalic(node) {
        return node.style.fontStyle === 'italic';
    }

    /** Wrap content in emphasis markers, keeping surrounding whitespace
        outside the markers (Markdown requires `**text**`, not `** text**`). */
    function wrapEmphasis(content, markers) {
        const match = content.match(/^(\s*)([\s\S]*?)(\s*)$/);
        if (match[2] === '') return content;
        return match[1] + markers + match[2] + markers + match[3];
    }

    function getTurndown() {
        if (!turndown) {
            turndown = new TurndownService({
                headingStyle: 'atx',
                codeBlockStyle: 'fenced',
                bulletListMarker: '-',
                emDelimiter: '*'
            });
            turndown.use(turndownPluginGfm.gfm);

            // Google Docs wraps the whole clipboard payload in a <b> tag
            // with font-weight normal; unwrap it instead of bolding everything.
            turndown.addRule('docsBoldWrapper', {
                filter: node => node.nodeName === 'B' &&
                    /^normal$/i.test(node.style.fontWeight),
                replacement: content => content
            });

            // Word and Google Docs express bold/italic as styled <span>s
            // rather than <b>/<i> tags.
            turndown.addRule('styledSpanEmphasis', {
                filter: node => node.nodeName === 'SPAN' &&
                    (isStyledBold(node) || isStyledItalic(node)),
                replacement: (content, node) => {
                    if (isStyledItalic(node)) content = wrapEmphasis(content, '*');
                    if (isStyledBold(node)) content = wrapEmphasis(content, '**');
                    return content;
                }
            });
        }
        return turndown;
    }

    /**
     * The preview is contenteditable: every edit (typing, deleting, pasting,
     * undo) converts the current preview HTML back to Markdown and pushes it
     * into the editor. The preview DOM itself is left alone so the caret
     * stays where the user put it; it is re-rendered from the Markdown once
     * the pane loses focus.
     */
    function handlePreviewInput() {
        // Deleting everything can leave empty structural tags behind
        // (e.g. an empty <h1> after select-all + delete), which Turndown
        // would turn into stray markers like "#". If there is no visible
        // content at all, the document is empty.
        const isEmpty = els.preview.textContent.trim() === '' &&
            !els.preview.querySelector('img, hr, input');
        const md = isEmpty ? '' :
            getTurndown().turndown(els.preview.innerHTML).trim();
        els.editor.value = md;
        updateMeta(md);
        persist();
        previewDirty = true;
        rebuildSyncMap();
    }

    /**
     * Pasting into the preview inserts the clipboard's rich text (sanitized)
     * at the caret; plain-text pastes are inserted as text. The `input`
     * handler above then regenerates the Markdown.
     * @param {ClipboardEvent} e
     */
    function handlePreviewPaste(e) {
        e.preventDefault();
        const html = e.clipboardData.getData('text/html');
        const plain = e.clipboardData.getData('text/plain');

        if (html) {
            // Sanitize first: clipboard HTML from Word/Docs/web pages is
            // full of styles, comments and metadata that must not land in
            // the live DOM.
            document.execCommand('insertHTML', false, DOMPurify.sanitize(html));
            flashStatus('Converted to Markdown!');
        } else if (plain) {
            document.execCommand('insertText', false, plain);
        } else {
            flashStatus('Clipboard has no text');
        }
    }

    /** Re-render the preview from the Markdown once editing there is done,
        normalizing the HTML and restoring the block/line sync anchors. */
    function handlePreviewBlur() {
        if (previewDirty) {
            previewDirty = false;
            render();
        }
    }

    /* =====================
       Actions
       ===================== */

    function flashStatus(message) {
        els.copyStatus.textContent = message;
        clearTimeout(flashStatus.timer);
        flashStatus.timer = setTimeout(() => {
            els.copyStatus.textContent = '';
        }, 2000);
    }

    async function copyText(text, label) {
        if (!text) {
            flashStatus('Nothing to copy');
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            flashStatus(`${label} copied!`);
        } catch (err) {
            flashStatus('Copy failed');
        }
    }

    function copyHtml() {
        const text = els.editor.value;
        if (text.trim() === '') {
            flashStatus('Nothing to copy');
            return;
        }
        // Re-render without the data-line wrappers so the copied HTML is clean.
        copyText(DOMPurify.sanitize(marked.parse(text)), 'HTML');
    }

    function clearEditor() {
        els.editor.value = '';
        localStorage.setItem(STORAGE_KEY, '');
        render();
        els.editor.focus();
    }

    function persist() {
        clearTimeout(persist.timer);
        persist.timer = setTimeout(() => {
            try {
                localStorage.setItem(STORAGE_KEY, els.editor.value);
            } catch (err) {
                // Storage full or unavailable — persistence is best-effort.
            }
        }, 300);
    }

    /* =====================
       Wiring
       ===================== */

    function bindEvents() {
        els.editor.addEventListener('input', () => {
            persist();
            scheduleRender();
        });

        // Only the pane the user is actually driving pushes scroll updates,
        // so the programmatic scroll on the other pane can't echo back.
        els.editor.addEventListener('pointerenter', () => { activePane = 'editor'; });
        els.editor.addEventListener('focus', () => { activePane = 'editor'; });
        els.preview.addEventListener('pointerenter', () => { activePane = 'preview'; });
        els.preview.addEventListener('focus', () => { activePane = 'preview'; });

        // Editing the preview directly (typing, deleting, pasting rich text)
        els.preview.addEventListener('input', handlePreviewInput);
        els.preview.addEventListener('paste', handlePreviewPaste);
        els.preview.addEventListener('blur', handlePreviewBlur);

        els.editor.addEventListener('scroll', () => {
            if (activePane === 'editor') syncFromEditor();
        });
        els.preview.addEventListener('scroll', () => {
            if (activePane === 'preview') syncFromPreview();
        });

        els.clearBtn.addEventListener('click', clearEditor);
        els.copyMdBtn.addEventListener('click', () =>
            copyText(els.editor.value.trim() === '' ? '' : els.editor.value, 'Markdown'));
        els.copyHtmlBtn.addEventListener('click', copyHtml);

        // Re-measure when the editor is resized (wrapping changes).
        new ResizeObserver(() => rebuildSyncMap()).observe(els.editor);
    }

    function init() {
        cacheElements();
        createMirror();
        bindEvents();

        const saved = localStorage.getItem(STORAGE_KEY);
        els.editor.value = saved === null ? SAMPLE : saved;
        render();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
