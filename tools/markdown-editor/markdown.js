/**
 * Markdown -> HTML rendering.
 *
 * `marked` and `DOMPurify` are globals published by the vendored classic
 * scripts in vendor/, which the page loads before this module. Everything
 * that leaves this file has been through DOMPurify.
 *
 * Reference those globals inside functions only, never at import time: the
 * Node tests import this module for its pure exports, and hoisting a global
 * to the top level would make it throw the moment it is loaded.
 */

/* global marked, DOMPurify */

/**
 * Render for the preview pane: each top-level block is wrapped in a div
 * carrying the source line it starts on, which is what the scroll sync
 * builds its anchor points from.
 * @param {string} text - Markdown source
 * @returns {string} Sanitized HTML
 */
export function renderBlocks(text) {
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

    return DOMPurify.sanitize(html);
}

/**
 * Render without the data-line wrappers, for copying to the clipboard.
 * @param {string} text - Markdown source
 * @returns {string} Sanitized HTML
 */
export function renderHtml(text) {
    return DOMPurify.sanitize(marked.parse(text));
}

/**
 * Strip anything unsafe from externally-sourced HTML (a clipboard payload
 * from Word, Google Docs or a web page) before it reaches the live DOM.
 * @param {string} html - Untrusted HTML
 * @returns {string} Sanitized HTML
 */
export function sanitizeHtml(html) {
    return DOMPurify.sanitize(html);
}

/**
 * @param {string} text
 * @returns {number} Whitespace-separated word count
 */
export function countWords(text) {
    const trimmed = text.trim();
    return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
