/**
 * Step-through-the-differences control for a single result panel.
 *
 * One instance per panel, so nothing here needs to know which side it is
 * driving.
 */

const DIFF_SELECTOR = '.added, .removed, .line-added, .line-removed';

/**
 * @param {Object} refs
 * @param {HTMLElement} refs.panel - Element holding the rendered diff
 * @param {HTMLButtonElement} refs.previousButton
 * @param {HTMLButtonElement} refs.nextButton
 * @param {HTMLElement} refs.counter - Displays "current/total"
 * @returns {Object} Navigator bound to that panel
 */
export function createDiffNavigator({ panel, previousButton, nextButton, counter }) {
    let diffs = [];
    let index = -1;

    function updateCounter() {
        counter.textContent = diffs.length === 0 ? '-' : `${index + 1}/${diffs.length}`;
    }

    function move(step) {
        if (diffs.length === 0) return;

        if (index >= 0 && index < diffs.length) {
            diffs[index].classList.remove('current-diff');
        }

        // Both directions wrap, and the first press from the initial -1
        // lands on whichever end the user is heading towards.
        if (step > 0) {
            index = index >= diffs.length - 1 ? 0 : index + 1;
        } else {
            index = index <= 0 ? diffs.length - 1 : index - 1;
        }

        const current = diffs[index];
        current.classList.add('current-diff');
        current.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

        updateCounter();
    }

    previousButton.addEventListener('click', () => move(-1));
    nextButton.addEventListener('click', () => move(1));

    return {
        /** Re-scan the panel after its contents change. */
        refresh() {
            diffs = Array.from(panel.querySelectorAll(DIFF_SELECTOR));
            index = -1;
            previousButton.disabled = diffs.length === 0;
            nextButton.disabled = diffs.length === 0;
            updateCounter();
        },

        get isEmpty() {
            return diffs.length === 0;
        },

        next: () => move(1),
        previous: () => move(-1)
    };
}
