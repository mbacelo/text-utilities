/**
 * Line Break Converter - page wiring.
 * Conversion itself lives in convert.js; this module only moves values
 * between the form and that function.
 */

import { SEPARATORS, convert } from './convert.js';

const ELEMENT_IDS = [
    'converter', 'findSep', 'findCustom', 'replaceSep', 'replaceCustom', 'template',
    'trimItems', 'removeEmpty', 'input', 'output', 'inputMeta',
    'copyBtn', 'clearBtn', 'copyStatus'
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

/** Show or hide each custom-separator input based on its select. */
function syncCustomVisibility() {
    els.findCustom.hidden = els.findSep.value !== 'custom';
    els.replaceCustom.hidden = els.replaceSep.value !== 'custom';
}

function runConversion() {
    syncCustomVisibility();

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

async function copyOutput() {
    if (!els.output.value) {
        els.copyStatus.textContent = 'Nothing to copy';
        return;
    }
    try {
        await navigator.clipboard.writeText(els.output.value);
        els.copyStatus.textContent = 'Copied!';
    } catch {
        els.copyStatus.textContent = 'Copy failed';
    }
}

function clearInput() {
    els.input.value = '';
    runConversion();
    els.input.focus();
}

// Conversion is cheap, so every edit to any control re-runs it: the output
// and item count can never describe stale input. Text fields, selects and
// checkboxes all fire `input`, and it bubbles up to the converter.
els.converter.addEventListener('input', runConversion);
els.copyBtn.addEventListener('click', copyOutput);
els.clearBtn.addEventListener('click', clearInput);

// Also picks up any values the browser restored on back/forward navigation
runConversion();
