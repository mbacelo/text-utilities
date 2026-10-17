/**
 * Markdown Editor - page wiring.
 *
 * Left pane is the Markdown source, right pane a live, read-only preview.
 * The source is the only thing ever edited. Rich text pasted into the
 * preview is converted on its own and inserted at the editor's caret;
 * nothing re-derives the whole document from rendered HTML, because that
 * round trip is lossy (raw HTML, reference links and the author's own
 * formatting choices do not survive it).
 */

import { renderBlocks, renderHtml, sanitizeHtml, countWords } from './markdown.js';
import { createTurndown } from './turndown-rules.js';
import { createScrollSync } from './scroll-sync.js';
import { createStorage } from '../../shared/storage.js';
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
   Editing
   ===================== */

/**
 * Replace the editor's selection with `text` as if the user had typed it,
 * so the change lands on the native undo stack and fires the usual input
 * event (which saves and re-renders).
 * @param {string} text
 */
function replaceSelection(text) {
    els.editor.focus();
    // execCommand is deprecated but still the only way to edit a textarea
    // programmatically without wiping its undo history. Nothing in the
    // platform replaces it yet; fall back to a plain (non-undoable) edit if
    // a browser ever drops it.
    if (!document.execCommand('insertText', false, text)) {
        els.editor.setRangeText(text, els.editor.selectionStart, els.editor.selectionEnd, 'end');
        els.editor.dispatchEvent(new Event('input'));
    }
}

/**
 * Convert what was pasted into the preview and insert it at the editor's
 * caret. Only the pasted fragment goes through Turndown.
 * @param {ClipboardEvent} event
 */
function handlePreviewPaste(event) {
    event.preventDefault();

    const html = event.clipboardData.getData('text/html');
    const plain = event.clipboardData.getData('text/plain');

    if (html) {
        // Sanitize first: clipboard HTML from Word/Docs/web pages is full of
        // styles, comments and metadata that have no place in the Markdown.
        turndown ??= createTurndown();
        replaceSelection(turndown.turndown(sanitizeHtml(html)).trim());
        flashStatus('Converted to Markdown!');
    } else if (plain) {
        replaceSelection(plain);
    } else {
        flashStatus('Clipboard has no text');
    }
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
    } catch {
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

/** Empty the editor as an ordinary edit, so Ctrl+Z brings the text back. */
function clearEditor() {
    els.editor.select();
    replaceSelection('');
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

els.preview.addEventListener('paste', handlePreviewPaste);

// Clicking the preview is how you aim a paste at it, so a click that lands
// on a rendered link must not navigate away from the editor.
els.preview.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    window.open(link.href, '_blank', 'noopener');
});

els.clearBtn.addEventListener('click', clearEditor);
els.copyMdBtn.addEventListener('click', copyMarkdown);
els.copyHtmlBtn.addEventListener('click', copyHtml);

// Resizing the editor changes where lines wrap, invalidating the anchors
new ResizeObserver(() => scrollSync.rebuild()).observe(els.editor);

const saved = storage.read();
els.editor.value = saved === null ? SAMPLE : saved;
render();
