/**
 * Text Comparison Tool - page wiring.
 *
 * All diff work happens in a worker (diff-client.js), so this module only
 * reads the form, hands the texts over, and paints what comes back.
 */

import { createDiffClient, SupersededError } from './diff-client.js';
import { createDiffNavigator } from './diff-navigator.js';

const ELEMENT_IDS = [
    'comparisonForm',
    'text1',
    'text2',
    'ignoreCase',
    'ignoreSpaces',
    'ignoreLineFeeds',
    'ignoreEscapeSequences',
    'loadingSpinner',
    'resultsSection',
    'statusMessage',
    'result1',
    'result2',
    'compareBtn',
    'prevDiffBtn1',
    'nextDiffBtn1',
    'diffCounter1',
    'prevDiffBtn2',
    'nextDiffBtn2',
    'diffCounter2'
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

function init() {
    const elements = findElements();
    const client = createDiffClient();

    const navigators = [
        createDiffNavigator({
            panel: elements.result1,
            previousButton: elements.prevDiffBtn1,
            nextButton: elements.nextDiffBtn1,
            counter: elements.diffCounter1
        }),
        createDiffNavigator({
            panel: elements.result2,
            previousButton: elements.prevDiffBtn2,
            nextButton: elements.nextDiffBtn2,
            counter: elements.diffCounter2
        })
    ];

    function readOptions() {
        return {
            ignoreCase: elements.ignoreCase.checked,
            ignoreSpaces: elements.ignoreSpaces.checked,
            ignoreLineFeeds: elements.ignoreLineFeeds.checked,
            ignoreEscapeSequences: elements.ignoreEscapeSequences.checked
        };
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

    /** Paint both panels and re-point the navigators at the new content. */
    function showResult({ equal, html1, html2 }) {
        showStatus(
            equal ? 'Texts are exactly the same!' : 'Texts are different!',
            equal ? 'same' : 'different'
        );

        // Safe: every value was escaped by diff-render before it got here.
        elements.result1.innerHTML = html1;
        elements.result2.innerHTML = html2;

        setBusy(false);
        navigators.forEach(navigator => navigator.refresh());
    }

    function showFailure(error) {
        console.error('Error during comparison:', error);
        setBusy(false);
        showStatus(
            'An error occurred while comparing texts. The texts may be too large or complex.',
            'different'
        );
        // Clear any stale results rather than leaving them under a failure
        elements.result1.innerHTML = '';
        elements.result2.innerHTML = '';
        navigators.forEach(navigator => navigator.refresh());
        elements.resultsSection.classList.add('visible');
    }

    async function compareTexts(event) {
        event.preventDefault();
        setBusy(true);

        try {
            showResult(await client.run({
                text1: elements.text1.value,
                text2: elements.text2.value,
                options: readOptions()
            }));
        } catch (error) {
            // A newer comparison is already in flight and owns the UI
            if (error instanceof SupersededError) return;
            showFailure(error);
        }
    }

    /**
     * Arrow keys step both panels together. Scoped to the result panels
     * rather than the document: bound globally it swallowed every
     * ArrowUp/ArrowDown once results were visible, which killed keyboard
     * page scrolling for the rest of the session.
     * @param {KeyboardEvent} event
     */
    function handleKeyboardNavigation(event) {
        // Modified arrow keys belong to the browser (word jumps, selection,
        // history), never to us
        if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;

        // Never steal keys from anything the user can type into
        const { target } = event;
        if (target.isContentEditable ||
            ['TEXTAREA', 'INPUT', 'SELECT'].includes(target.tagName)) {
            return;
        }

        // With nothing to navigate to, leave the key alone so the panel can
        // still be scrolled with the keyboard.
        if (navigators.every(navigator => navigator.isEmpty)) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            navigators.forEach(navigator => navigator.next());
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            navigators.forEach(navigator => navigator.previous());
        }
    }

    elements.comparisonForm.addEventListener('submit', compareTexts);
    elements.result1.addEventListener('keydown', handleKeyboardNavigation);
    elements.result2.addEventListener('keydown', handleKeyboardNavigation);
}

try {
    init();
} catch (error) {
    console.error('Failed to initialize application:', error);
    alert('Failed to initialize the application. Please refresh the page.');
}
