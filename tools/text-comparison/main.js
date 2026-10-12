/**
 * Text Comparison Tool - page wiring.
 *
 * All diff work happens in a worker (diff-client.js), so this module only
 * reads the form, hands the texts over, and paints what comes back.
 */

import { createDiffClient, SupersededError } from './diff-client.js';
import { createDiffNavigator } from './diff-navigator.js';

// Each ignore option's checkbox id, with how the verdict names it
const IGNORE_OPTIONS = {
    ignoreCase: 'case',
    ignoreSpaces: 'spaces',
    ignoreLineFeeds: 'line feeds',
    ignoreEscapeSequences: 'escape sequences'
};

const ELEMENT_IDS = [
    ...Object.keys(IGNORE_OPTIONS),
    'comparisonForm',
    'text1',
    'text2',
    'loadingSpinner',
    'resultsSection',
    'statusMessage',
    'result',
    'compareBtn',
    'prevDiffBtn',
    'nextDiffBtn',
    'diffCounter'
];

/**
 * Look up every element the page depends on, failing loudly if the markup
 * and this module have drifted apart.
 * @returns {Object<string, HTMLElement>}
 * @throws {Error} If a required element is missing
 */
function findElements() {
    return Object.fromEntries(ELEMENT_IDS.map(id => {
        const element = document.getElementById(id);
        if (!element) throw new Error(`Required element with id "${id}" not found`);
        return [id, element];
    }));
}

/**
 * "No differences" only ever means "none once the ignored ones are set
 * aside", so say which ones were - otherwise "Hello" and "hello" would be
 * announced as identical.
 * @param {Object} options - The options the comparison ran with
 * @returns {string}
 */
function describeNoDifferences(options) {
    const ignored = Object.keys(IGNORE_OPTIONS)
        .filter(key => options[key])
        .map(key => IGNORE_OPTIONS[key]);

    return ignored.length === 0
        ? 'No differences found.'
        : `No differences found, ignoring ${new Intl.ListFormat('en').format(ignored)}.`;
}

function init() {
    const elements = findElements();
    const client = createDiffClient();

    const diffNavigator = createDiffNavigator({
        panel: elements.result,
        previousButton: elements.prevDiffBtn,
        nextButton: elements.nextDiffBtn,
        counter: elements.diffCounter
    });

    function readOptions() {
        return Object.fromEntries(
            Object.keys(IGNORE_OPTIONS).map(key => [key, elements[key].checked])
        );
    }

    function setBusy(isBusy) {
        elements.loadingSpinner.classList.toggle('visible', isBusy);
        elements.resultsSection.classList.toggle('visible', !isBusy);
        elements.compareBtn.disabled = isBusy;
    }

    function showStatus(message, kind) {
        elements.statusMessage.textContent = message;
        elements.statusMessage.className = `status-message ${kind}`;
    }

    /** Paint the panel and re-point the navigator at the new content. */
    function showResult({ equal, html }, options) {
        showStatus(
            equal ? describeNoDifferences(options) : 'Texts are different!',
            equal ? 'same' : 'different'
        );

        // Safe: every value was escaped by diff-render before it got here.
        elements.result.innerHTML = html;

        setBusy(false);
        diffNavigator.refresh();
    }

    function showFailure(error) {
        console.error('Error during comparison:', error);
        setBusy(false);
        showStatus(
            'An error occurred while comparing texts. The texts may be too large or complex.',
            'different'
        );
        // Clear any stale results rather than leaving them under a failure
        elements.result.innerHTML = '';
        diffNavigator.refresh();
        elements.resultsSection.classList.add('visible');
    }

    async function compareTexts(event) {
        event.preventDefault();
        setBusy(true);

        // Read once: the verdict has to describe the options this run used,
        // even if a checkbox is toggled while it is in flight.
        const options = readOptions();

        try {
            showResult(await client.run({
                text1: elements.text1.value,
                text2: elements.text2.value,
                options
            }), options);
        } catch (error) {
            // A newer comparison is already in flight and owns the UI
            if (error instanceof SupersededError) return;
            showFailure(error);
        }
    }

    /**
     * Arrow keys step through the differences. Scoped to the result panel
     * rather than the document: bound globally it swallowed every
     * ArrowUp/ArrowDown once results were visible, which killed keyboard
     * page scrolling for the rest of the session.
     * @param {KeyboardEvent} event
     */
    function handleKeyboardNavigation(event) {
        // Modified arrow keys belong to the browser (word jumps, selection,
        // history), never to us
        if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;

        // With nothing to navigate to, leave the key alone so the page can
        // still be scrolled with the keyboard.
        if (diffNavigator.isEmpty) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            diffNavigator.next();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            diffNavigator.previous();
        }
    }

    elements.comparisonForm.addEventListener('submit', compareTexts);
    elements.result.addEventListener('keydown', handleKeyboardNavigation);
}

try {
    init();
} catch (error) {
    console.error('Failed to initialize application:', error);
    alert('Failed to initialize the application. Please refresh the page.');
}
