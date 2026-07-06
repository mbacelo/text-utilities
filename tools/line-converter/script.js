/**
 * Line Break Converter
 * Splits the input on a chosen separator, optionally wraps each item with a
 * template, and joins the items with another separator. Conversion runs when
 * the Convert button is pressed.
 */
(function () {
    'use strict';

    // Map separator keys to their actual string value.
    // `newline` splits on any line-ending style (\r\n, \r, \n) when used for
    // splitting; for joining it produces a plain \n.
    const SEPARATORS = {
        'newline': '\n',
        'comma': ',',
        'semicolon': ';',
        'space': ' ',
        'tab': '\t'
    };

    const els = {};
    const ids = [
        'findSep', 'findCustom', 'replaceSep', 'replaceCustom', 'template',
        'trimItems', 'removeEmpty', 'input', 'output', 'inputMeta',
        'convertBtn', 'copyBtn', 'clearBtn', 'copyStatus'
    ];

    function cacheElements() {
        ids.forEach(id => { els[id] = document.getElementById(id); });
    }

    /**
     * Resolve the effective separator string from a <select> + custom <input>.
     * @param {HTMLSelectElement} select
     * @param {HTMLInputElement} customInput
     * @returns {string}
     */
    function resolveSeparator(select, customInput) {
        if (select.value === 'custom') {
            return customInput.value;
        }
        return SEPARATORS[select.value] ?? '';
    }

    /**
     * Split the text on the given separator. An empty separator means
     * "split into characters", which is rarely useful, so we treat it as
     * "no split" (whole text as one item).
     * @param {string} text
     * @param {string} separator
     * @returns {string[]}
     */
    function splitInput(text, separator) {
        if (separator === '\n') {
            // Normalize all line-ending styles before splitting.
            return text.replace(/\r\n?/g, '\n').split('\n');
        }
        if (separator === '') {
            return [text];
        }
        return text.split(separator);
    }

    /**
     * Apply the per-item template. `{text}` is replaced with the item value.
     * An empty template is treated as a passthrough.
     * @param {string} item
     * @param {string} template
     * @returns {string}
     */
    function applyTemplate(item, template) {
        if (template === '') {
            return item;
        }
        return template.split('{text}').join(item);
    }

    function convert() {
        const findSeparator = resolveSeparator(els.findSep, els.findCustom);
        const joinSeparator = resolveSeparator(els.replaceSep, els.replaceCustom);
        const template = els.template.value;
        const trim = els.trimItems.checked;
        const removeEmpty = els.removeEmpty.checked;

        let items = splitInput(els.input.value, findSeparator);

        if (trim) {
            items = items.map(item => item.trim());
        }
        if (removeEmpty) {
            items = items.filter(item => item.length > 0);
        }

        els.inputMeta.textContent =
            `${items.length} item${items.length === 1 ? '' : 's'}`;

        const transformed = items.map(item => applyTemplate(item, template));
        els.output.value = transformed.join(joinSeparator);

        // Clear any stale copy confirmation once the output changes.
        els.copyStatus.textContent = '';
    }

    /** Show/hide the custom-separator input based on the select value. */
    function syncCustomVisibility() {
        els.findCustom.hidden = els.findSep.value !== 'custom';
        els.replaceCustom.hidden = els.replaceSep.value !== 'custom';
    }

    async function copyOutput() {
        const text = els.output.value;
        if (!text) {
            els.copyStatus.textContent = 'Nothing to copy';
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            els.copyStatus.textContent = 'Copied!';
        } catch (err) {
            // Fallback for browsers without the async clipboard API.
            els.output.select();
            const ok = document.execCommand('copy');
            els.copyStatus.textContent = ok ? 'Copied!' : 'Copy failed';
            window.getSelection().removeAllRanges();
        }
    }

    function clearInput() {
        els.input.value = '';
        els.output.value = '';
        els.inputMeta.textContent = '0 items';
        els.copyStatus.textContent = '';
        els.input.focus();
    }

    function bindEvents() {
        // Conversion is only triggered explicitly via the Convert button.
        els.convertBtn.addEventListener('click', convert);

        // Toggling a custom separator just shows/hides its input; it does not
        // re-run the conversion.
        ['findSep', 'replaceSep'].forEach(id => {
            els[id].addEventListener('change', syncCustomVisibility);
        });

        els.copyBtn.addEventListener('click', copyOutput);
        els.clearBtn.addEventListener('click', clearInput);
    }

    function init() {
        cacheElements();
        bindEvents();
        syncCustomVisibility();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
