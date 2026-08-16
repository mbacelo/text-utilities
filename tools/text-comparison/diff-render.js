/**
 * Turns diff parts into the HTML the result panels display.
 *
 * Pure string work with no DOM access, so it runs inside the worker and
 * under `node --test` alongside the engine. Every value that reaches the
 * output goes through escapeHtml first - the panels are filled with
 * innerHTML, so this module is the only thing standing between user input
 * and executable markup.
 */

import { computeWordDiff } from './diff-engine.js';

const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
};

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapeHtml(text) {
    return text.replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
}

/**
 * Render a word-level diff of two lines that changed only partially
 * @param {string} line1 - First line
 * @param {string} line2 - Second line
 * @param {Object} options - Comparison options
 * @returns {Object} Object with text1 and text2 HTML strings
 */
export function computeInlineDiff(line1, line2, options) {
    const html1 = [];
    const html2 = [];

    for (const part of computeWordDiff(line1, line2, options)) {
        if (part.type === 'equal') {
            // Each side keeps its own value, so ignored case survives display
            html1.push(`<span class="unchanged">${escapeHtml(part.value1)}</span>`);
            html2.push(`<span class="unchanged">${escapeHtml(part.value2)}</span>`);
        } else if (part.type === 'delete') {
            html1.push(`<span class="removed">${escapeHtml(part.value)}</span>`);
        } else {
            html2.push(`<span class="added">${escapeHtml(part.value)}</span>`);
        }
    }

    return { text1: html1.join(''), text2: html2.join('') };
}

/**
 * Render computed diff parts as HTML for both panels
 * @param {Array<Object>} parts - Diff parts from computeLineDiff
 * @param {Object} options - Comparison options
 * @returns {Object} Object with text1 and text2 HTML strings
 */
export function renderDiff(parts, options) {
    // Arrays rather than string concatenation: large diffs build tens of
    // thousands of fragments.
    const html1 = [];
    const html2 = [];

    for (const part of parts) {
        if (part.type === 'equal') {
            html1.push(`<span class="unchanged">${escapeHtml(part.value1)}</span>`);
            html2.push(`<span class="unchanged">${escapeHtml(part.value2)}</span>`);
        } else if (part.type === 'delete') {
            html1.push(`<span class="line-removed">${escapeHtml(part.value)}</span>`);
        } else if (part.type === 'insert') {
            html2.push(`<span class="line-added">${escapeHtml(part.value)}</span>`);
        } else {
            const inline = computeInlineDiff(part.value1, part.value2, options);
            html1.push(inline.text1);
            html2.push(inline.text2);
        }
    }

    return { text1: html1.join(''), text2: html2.join('') };
}
