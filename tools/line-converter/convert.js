/**
 * Line Break Converter - conversion logic.
 *
 * Pure and DOM-free: the page reads the form, calls convert(), and writes
 * the result back. Tested directly under `node --test`.
 */

/**
 * Built-in separators by key. `newline` is '\n' here; splitInput treats it
 * as "any line ending", while joining always produces a plain '\n'.
 */
export const SEPARATORS = {
    newline: '\n',
    comma: ',',
    semicolon: ';',
    space: ' ',
    tab: '\t'
};

/**
 * Split the text on the given separator. An empty separator would mean
 * "split into characters", which is rarely what anyone wants, so it is
 * treated as "no split" - the whole text as a single item.
 * @param {string} text
 * @param {string} separator
 * @returns {string[]}
 */
export function splitInput(text, separator) {
    if (separator === '\n') {
        // Normalize all line-ending styles before splitting
        return text.replace(/\r\n?/g, '\n').split('\n');
    }
    if (separator === '') {
        return [text];
    }
    return text.split(separator);
}

/**
 * Apply the per-item template. `{text}` is replaced with the item value.
 * An empty template is a passthrough.
 * @param {string} item
 * @param {string} template
 * @returns {string}
 */
export function applyTemplate(item, template) {
    if (template === '') {
        return item;
    }
    return template.split('{text}').join(item);
}

/**
 * Split, filter and rejoin the input.
 * @param {Object} request
 * @param {string} request.text - Raw input
 * @param {string} request.splitOn - Separator to split the input on
 * @param {string} request.joinWith - Separator to join the items with
 * @param {string} [request.template] - Per-item template using `{text}`
 * @param {boolean} [request.trim] - Trim whitespace around each item
 * @param {boolean} [request.removeEmpty] - Drop items that end up empty
 * @returns {{items: string[], output: string}} The surviving items and the
 *   joined result. `items` is what the count in the UI reports.
 */
export function convert({ text, splitOn, joinWith, template = '', trim = false, removeEmpty = false }) {
    let items = splitInput(text, splitOn);

    if (trim) {
        items = items.map(item => item.trim());
    }
    if (removeEmpty) {
        items = items.filter(item => item.length > 0);
    }

    return {
        items,
        output: items.map(item => applyTemplate(item, template)).join(joinWith)
    };
}
