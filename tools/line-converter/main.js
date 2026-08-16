/**
 * Line Break Converter - page wiring.
 * Conversion itself lives in convert.js; this module only moves values
 * between the form and that function.
 */

import { SEPARATORS, convert } from './convert.js';

const ELEMENT_IDS = [
    'findSep', 'findCustom', 'replaceSep', 'replaceCustom', 'template',
    'trimItems', 'removeEmpty', 'input', 'output', 'inputMeta',
    'convertBtn', 'copyBtn', 'clearBtn', 'copyStatus'
];

const els = Object.fromEntries(
    ELEMENT_IDS.map(id => [id, document.getElementById(id)])
);

/**
 * Resolve the effective separator from a <select> plus its custom <input>.
 * @param {HTMLSelectElement} select
 * @param {HTMLInputElement} customInput
 * @returns {string}
 */
function resolveSeparator(select, customInput) {
    return select.value === 'custom'
        ? customInput.value
        : SEPARATORS[select.value] ?? '';
}

function runConversion() {
    const { items, output } = convert({
        text: els.input.value,
        splitOn: resolveSeparator(els.findSep, els.findCustom),
        joinWith: resolveSeparator(els.replaceSep, els.replaceCustom),
        template: els.template.value,
        trim: els.trimItems.checked,
        removeEmpty: els.removeEmpty.checked
    });

    els.output.value = output;
    els.inputMeta.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
    // Any stale copy confirmation no longer describes what is on screen
    els.copyStatus.textContent = '';
}

/** Show or hide each custom-separator input based on its select. */
function syncCustomVisibility() {
    els.findCustom.hidden = els.findSep.value !== 'custom';
    els.replaceCustom.hidden = els.replaceSep.value !== 'custom';
}

async function copyOutput() {
    if (!els.output.value) {
        els.copyStatus.textContent = 'Nothing to copy';
        return;
    }
    try {
        await navigator.clipboard.writeText(els.output.value);
        els.copyStatus.textContent = 'Copied!';
    } catch (error) {
        els.copyStatus.textContent = 'Copy failed';
    }
}

function clearInput() {
    els.input.value = '';
    els.output.value = '';
    els.inputMeta.textContent = '0 items';
    els.copyStatus.textContent = '';
    els.input.focus();
}

// Conversion only runs on an explicit Convert; changing a separator just
// shows or hides its custom input.
els.convertBtn.addEventListener('click', runConversion);
els.findSep.addEventListener('change', syncCustomVisibility);
els.replaceSep.addEventListener('change', syncCustomVisibility);
els.copyBtn.addEventListener('click', copyOutput);
els.clearBtn.addEventListener('click', clearInput);

syncCustomVisibility();
