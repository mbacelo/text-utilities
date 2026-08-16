/**
 * Markdown Editor - page wiring.
 *
 * Left pane is the Markdown source, right pane a live preview. The preview
 * is contenteditable, so the conversion runs both ways: editing or pasting
 * rich text there regenerates the Markdown. While the preview has focus its
 * DOM is left alone so the caret stays put; it is re-rendered from the
 * Markdown on blur, snapping back to the canonical presentation.
 */

import { renderBlocks, renderHtml, sanitizeHtml, countWords } from './markdown.js';
import { createTurndown } from './turndown-rules.js';
import { createScrollSync } from './scroll-sync.js';
import { createStorage } from './storage.js';
import { SAMPLE } from './sample.js';

const STORAGE_KEY = 'markdown-editor-content';
const STATUS_TIMEOUT_MS = 2000;

const ELEMENT_IDS = [
    'editor', 'preview', 'editorMeta', 'copyStatus',
    'clearBtn', 'copyMdBtn', 'copyHtmlBtn'
];

const els = Object.fromEntries(
    ELEMENT_IDS.map(id => [id, document.getElementById(id)])
);

const storage = createStorage(STORAGE_KEY);
const scrollSync = createScrollSync({ editor: els.editor, preview: els.preview });

let turndown = null;        // built on first use; not needed to just render
let activePane = null;      // 'editor' | 'preview' - who is driving the scroll
let renderQueued = false;
let previewDirty = false;   // preview was hand-edited; re-render on blur
let statusTimer = null;

/* =====================
   Rendering
   ===================== */

function updateMeta(text) {
    const words = countWords(text);
    els.editorMeta.textContent =
        `${words} word${words === 1 ? '' : 's'} · ${text.length} characters`;
}

function render() {
    const text = els.editor.value;
    const isEmpty = text.trim() === '';

    // Leave the pane truly empty so the CSS :empty placeholder shows and
    // typing starts from a clean slate.
    els.preview.innerHTML = isEmpty ? '' : renderBlocks(text);

    updateMeta(text);
    scrollSync.rebuild();

    if (!isEmpty) {
        // Keep the preview aligned with wherever the editor currently is
        scrollSync.fromEditor();
    }
}

function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
        renderQueued = false;
        render();
    });
}

/* =====================
   Preview editing
   ===================== */

/**
 * Every edit in the preview (typing, deleting, pasting, undo) converts the
 * current preview HTML back to Markdown and pushes it into the editor.
 */
function handlePreviewInput() {
    // Deleting everything can leave empty structural tags behind (e.g. an
    // empty <h1> after select-all + delete), which Turndown would turn into
    // stray markers like "#". If there is no visible content at all, the
    // document is empty.
    const isEmpty = els.preview.textContent.trim() === '' &&
        !els.preview.querySelector('img, hr, input');

    turndown ??= createTurndown();
    const markdown = isEmpty ? '' : turndown.turndown(els.preview.innerHTML).trim();

    els.editor.value = markdown;
    updateMeta(markdown);
    storage.writeDebounced(markdown);
    previewDirty = true;
    scrollSync.rebuild();
}

/**
 * Paste rich text as sanitized HTML at the caret; the input handler above
 * then regenerates the Markdown.
 * @param {ClipboardEvent} event
 */
function handlePreviewPaste(event) {
    event.preventDefault();

    const html = event.clipboardData.getData('text/html');
    const plain = event.clipboardData.getData('text/plain');

    // execCommand is deprecated but still the only way to insert at the
    // caret in a contenteditable while keeping the browser's native undo
    // stack intact. Nothing in the platform replaces it yet.
    if (html) {
        // Sanitize first: clipboard HTML from Word/Docs/web pages is full of
        // styles, comments and metadata that must not land in the live DOM.
        document.execCommand('insertHTML', false, sanitizeHtml(html));
        flashStatus('Converted to Markdown!');
    } else if (plain) {
        document.execCommand('insertText', false, plain);
    } else {
        flashStatus('Clipboard has no text');
    }
}

function handlePreviewBlur() {
    if (!previewDirty) return;
    previewDirty = false;
    render();
}

/* =====================
   Actions
   ===================== */

function flashStatus(message) {
    els.copyStatus.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
        els.copyStatus.textContent = '';
    }, STATUS_TIMEOUT_MS);
}

async function copyText(text, label) {
    if (!text) {
        flashStatus('Nothing to copy');
        return;
    }
    try {
        await navigator.clipboard.writeText(text);
        flashStatus(`${label} copied!`);
    } catch (error) {
        flashStatus('Copy failed');
    }
}

function copyMarkdown() {
    const text = els.editor.value;
    copyText(text.trim() === '' ? '' : text, 'Markdown');
}

function copyHtml() {
    const text = els.editor.value;
    if (text.trim() === '') {
        flashStatus('Nothing to copy');
        return;
    }
    // Rendered without the data-line wrappers, so the copied HTML is clean
    copyText(renderHtml(text), 'HTML');
}

function clearEditor() {
    els.editor.value = '';
    storage.write('');
    render();
    els.editor.focus();
}

/* =====================
   Wiring
   ===================== */

els.editor.addEventListener('input', () => {
    storage.writeDebounced(els.editor.value);
    scheduleRender();
});

// Only the pane the user is actually driving pushes scroll updates, so the
// programmatic scroll on the other pane cannot echo back.
els.editor.addEventListener('pointerenter', () => { activePane = 'editor'; });
els.editor.addEventListener('focus', () => { activePane = 'editor'; });
els.preview.addEventListener('pointerenter', () => { activePane = 'preview'; });
els.preview.addEventListener('focus', () => { activePane = 'preview'; });

els.editor.addEventListener('scroll', () => {
    if (activePane === 'editor') scrollSync.fromEditor();
});
els.preview.addEventListener('scroll', () => {
    if (activePane === 'preview') scrollSync.fromPreview();
});

els.preview.addEventListener('input', handlePreviewInput);
els.preview.addEventListener('paste', handlePreviewPaste);
els.preview.addEventListener('blur', handlePreviewBlur);

els.clearBtn.addEventListener('click', clearEditor);
els.copyMdBtn.addEventListener('click', copyMarkdown);
els.copyHtmlBtn.addEventListener('click', copyHtml);

// Resizing the editor changes where lines wrap, invalidating the anchors
new ResizeObserver(() => scrollSync.rebuild()).observe(els.editor);

const saved = storage.read();
els.editor.value = saved === null ? SAMPLE : saved;
render();
