/**
 * Turns diff parts into the HTML the result panel displays.
 *
 * Every part becomes one row with a cell per side, so the two texts stay
 * aligned line for line however either side wraps; a line that exists on
 * one side only is paired with an empty filler cell. Consecutive changed
 * rows are grouped into a hunk, which is what the navigator steps through.
 *
 * Pure string work with no DOM access, so it runs inside the worker and
 * under `node --test` alongside the engine. Every value that reaches the
 * output goes through escapeHtml first - the panel is filled with
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
 * Parts keep their trailing line break so they reconstruct the original
 * text exactly. A row already is a line, so the break is dropped for display.
 * @param {string} value
 * @returns {string}
 */
function stripBreak(value) {
    return value.endsWith('\n') ? value.slice(0, -1) : value;
}

/**
 * @param {string} html - Already-escaped cell content
 * @param {string} [modifier] - Extra class for the cell
 * @returns {string}
 */
function cell(html, modifier) {
    return `<div class="diff-cell${modifier ? ` ${modifier}` : ''}">${html}</div>`;
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
            html1.push(escapeHtml(part.value1));
            html2.push(escapeHtml(part.value2));
        } else if (part.type === 'delete') {
            html1.push(`<span class="removed">${escapeHtml(part.value)}</span>`);
        } else {
            html2.push(`<span class="added">${escapeHtml(part.value)}</span>`);
        }
    }

    return { text1: html1.join(''), text2: html2.join('') };
}

/**
 * Both cells of the row for one diff part.
 * @param {Object} part - Diff part from computeLineDiff
 * @param {Object} options - Comparison options
 * @returns {string}
 */
function renderCells(part, options) {
    if (part.type === 'equal') {
        return cell(escapeHtml(stripBreak(part.value1))) +
            cell(escapeHtml(stripBreak(part.value2)));
    }
    if (part.type === 'delete') {
        return cell(escapeHtml(stripBreak(part.value)), 'line-removed') + cell('', 'filler');
    }
    if (part.type === 'insert') {
        return cell('', 'filler') + cell(escapeHtml(stripBreak(part.value)), 'line-added');
    }
    const inline = computeInlineDiff(stripBreak(part.value1), stripBreak(part.value2), options);
    return cell(inline.text1) + cell(inline.text2);
}

/**
 * Render computed diff parts as aligned rows, grouping runs of changes
 * into hunks.
 * @param {Array<Object>} parts - Diff parts from computeLineDiff
 * @param {Object} options - Comparison options
 * @returns {string} HTML for the result panel
 */
export function renderDiff(parts, options) {
    // An array rather than string concatenation: large diffs build tens of
    // thousands of fragments.
    const html = [];
    let inHunk = false;

    for (const part of parts) {
        const isChange = part.type !== 'equal';
        if (isChange !== inHunk) {
            html.push(isChange ? '<div class="diff-hunk">' : '</div>');
            inHunk = isChange;
        }
        html.push(`<div class="diff-row">${renderCells(part, options)}</div>`);
    }
    if (inHunk) html.push('</div>');

    return html.join('');
}
