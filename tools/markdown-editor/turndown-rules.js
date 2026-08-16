/**
 * HTML -> Markdown conversion, configured for the clipboard payloads real
 * word processors produce.
 *
 * `TurndownService` and `turndownPluginGfm` are globals from the vendored
 * classic scripts in vendor/. Reference them inside functions only, never at
 * import time: the Node tests import this module for wrapEmphasis, and
 * hoisting a global to the top level would make it throw on load.
 */

/* global TurndownService, turndownPluginGfm */

function isStyledBold(node) {
    const weight = node.style.fontWeight;
    return weight === 'bold' || parseInt(weight, 10) >= 600;
}

function isStyledItalic(node) {
    return node.style.fontStyle === 'italic';
}

/**
 * Wrap content in emphasis markers, keeping surrounding whitespace outside
 * the markers - Markdown requires `**text**`, not `** text**`.
 * @param {string} content
 * @param {string} markers - e.g. '*' or '**'
 * @returns {string}
 */
export function wrapEmphasis(content, markers) {
    const [, leading, body, trailing] = content.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (body === '') return content;
    return leading + markers + body + markers + trailing;
}

/**
 * Build a Turndown instance with the rules this editor needs.
 * @returns {Object} Configured TurndownService
 */
export function createTurndown() {
    const turndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
        emDelimiter: '*'
    });

    turndown.use(turndownPluginGfm.gfm);

    // Google Docs wraps the whole clipboard payload in a <b> tag with
    // font-weight normal; unwrap it instead of bolding everything.
    turndown.addRule('docsBoldWrapper', {
        filter: node => node.nodeName === 'B' && /^normal$/i.test(node.style.fontWeight),
        replacement: content => content
    });

    // Word and Google Docs express bold/italic as styled <span>s rather
    // than <b>/<i> tags.
    turndown.addRule('styledSpanEmphasis', {
        filter: node => node.nodeName === 'SPAN' &&
            (isStyledBold(node) || isStyledItalic(node)),
        replacement: (content, node) => {
            let result = content;
            if (isStyledItalic(node)) result = wrapEmphasis(result, '*');
            if (isStyledBold(node)) result = wrapEmphasis(result, '**');
            return result;
        }
    });

    return turndown;
}
