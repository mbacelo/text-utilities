/**
 * Diff worker.
 *
 * Comparing two large texts is O(m*n) and can take seconds. Running it here
 * keeps the page responsive: the spinner animates, the form stays usable,
 * and a superseded comparison can be cancelled outright by terminating the
 * worker (see diff-client.js) rather than being left to finish.
 *
 * Rendering happens here too - it is pure string building, and returning
 * finished HTML means the main thread only has to assign innerHTML.
 */

import { computeLineDiff } from './diff-engine.js';
import { renderDiff } from './diff-render.js';

self.addEventListener('message', ({ data }) => {
    const { text1, text2, options } = data;

    try {
        const parts = computeLineDiff(text1, text2, options);
        const html = renderDiff(parts, options);

        self.postMessage({
            ok: true,
            // Derived from the very parts that were rendered, so the verdict
            // can never contradict the panels below it.
            equal: parts.every(part => part.type === 'equal'),
            html1: html.text1,
            html2: html.text2
        });
    } catch (error) {
        self.postMessage({ ok: false, message: error.message });
    }
});
