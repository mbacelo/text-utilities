/**
 * Text Comparison Tool
 * A web application for comparing two texts with configurable ignore options
 * and visual diff highlighting using Longest Common Subsequence (LCS) algorithm.
 */

(function () {
    'use strict';

    // ==================
    // Constants
    // ==================
    const PROCESSING_DELAY = 100; // ms delay to allow UI update before heavy processing

    // Largest LCS table we are willing to build, in cells. The DP is O(m*n) in
    // both time and memory, so pathological input (two long lines with no
    // newlines) must be refused rather than allowed to exhaust the tab. At 4
    // bytes per cell this caps the table at ~100 MB; beyond it we fall back to
    // a coarser diff instead of throwing.
    const MAX_LCS_CELLS = 25000000;

    // Markers used to make ignored content compare equal. They are compared
    // against normalized user text, so they lead with a NUL character, which a
    // textarea cannot contain - otherwise a user literally typing
    // "__IGNORED_SPACE__" would collide with the marker and diff incorrectly.
    const NUL = String.fromCharCode(0);
    const IGNORED_EMPTY_LINE = NUL + 'IGNORED_EMPTY_LINE';
    const IGNORED_LINEFEED = NUL + 'IGNORED_LINEFEED';
    const IGNORED_SPACE = NUL + 'IGNORED_SPACE';

    // ==================
    // DOM Elements Cache
    // ==================
    let elements = {};

    // ==================
    // Diff Navigation State
    // ==================
    let diffElements1 = [];
    let diffElements2 = [];
    let currentDiffIndex1 = -1;
    let currentDiffIndex2 = -1;

    /**
     * Initialize and cache DOM element references
     * @throws {Error} If required DOM elements are not found
     */
    function initializeElements() {
        const requiredIds = [
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
            'diffNavigation1',
            'diffNavigation2',
            'prevDiffBtn1',
            'nextDiffBtn1',
            'diffCounter1',
            'prevDiffBtn2',
            'nextDiffBtn2',
            'diffCounter2'
        ];

        requiredIds.forEach(id => {
            const element = document.getElementById(id);
            if (!element) {
                throw new Error(`Required element with id "${id}" not found`);
            }
            elements[id] = element;
        });
    }

    // ==================
    // Main Comparison Logic
    // ==================

    /**
     * Main function to compare two texts with specified options
     * Shows loading spinner and handles errors gracefully
     * @param {Event} event - Form submit event
     */
    function compareTexts(event) {
        event.preventDefault();

        // Show loading spinner and hide previous results
        toggleLoadingState(true);

        // Use setTimeout to allow UI to update before heavy processing
        setTimeout(() => {
            try {
                performComparison();
            } catch (error) {
                handleComparisonError(error);
            }
        }, PROCESSING_DELAY);
    }

    /**
     * Toggle loading state (spinner and button disabled state)
     * @param {boolean} isLoading - Whether app is in loading state
     */
    function toggleLoadingState(isLoading) {
        elements.loadingSpinner.classList.toggle('visible', isLoading);
        elements.resultsSection.classList.toggle('visible', !isLoading);
        elements.compareBtn.disabled = isLoading;
    }

    /**
     * Perform the actual text comparison
     */
    function performComparison() {
        // Get input texts
        const text1 = elements.text1.value;
        const text2 = elements.text2.value;

        // Get comparison options
        const options = {
            ignoreCase: elements.ignoreCase.checked,
            ignoreSpaces: elements.ignoreSpaces.checked,
            ignoreLineFeeds: elements.ignoreLineFeeds.checked,
            ignoreEscapeSequences: elements.ignoreEscapeSequences.checked
        };

        // Compute the diff once, then derive the verdict from it. Deriving
        // equality separately (from a whole-text transform) let the status
        // message contradict the panels it sits above.
        const parts = computeLineDiff(text1, text2, options);

        displayStatus(parts.every(part => part.type === 'equal'));

        // Render the same parts the verdict was based on
        const diff = renderDiff(parts, options);
        elements.result1.innerHTML = diff.text1;
        elements.result2.innerHTML = diff.text2;

        // Hide spinner and show results
        toggleLoadingState(false);

        // Initialize diff navigation
        initializeDiffNavigation();
    }

    /**
     * Display comparison status message
     * @param {boolean} areEqual - Whether texts are equal
     */
    function displayStatus(areEqual) {
        if (areEqual) {
            elements.statusMessage.textContent = 'Texts are exactly the same!';
            elements.statusMessage.className = 'status-message same';
        } else {
            elements.statusMessage.textContent = 'Texts are different!';
            elements.statusMessage.className = 'status-message different';
        }
    }

    /**
     * Handle errors during comparison
     * @param {Error} error - The error that occurred
     */
    function handleComparisonError(error) {
        console.error('Error during comparison:', error);
        toggleLoadingState(false);

        // Display user-friendly error message and clear any stale results
        elements.statusMessage.textContent = 'An error occurred while comparing texts. The texts may be too large or complex.';
        elements.statusMessage.className = 'status-message different';
        elements.result1.innerHTML = '';
        elements.result2.innerHTML = '';
        initializeDiffNavigation();
        elements.resultsSection.classList.add('visible');
    }

    // ==================
    // Diff Generation
    // ==================

    /**
     * Render computed diff parts as HTML for both panels
     * @param {Array<Object>} parts - Diff parts from computeLineDiff
     * @param {Object} options - Comparison options
     * @returns {Object} Object with text1 and text2 HTML strings
     */
    function renderDiff(parts, options) {
        // Use arrays for better performance with large texts
        const html1Parts = [];
        const html2Parts = [];

        parts.forEach(part => {
            if (part.type === 'equal') {
                // Use original values from both sides to preserve casing
                const escapedText1 = escapeHtml(part.value1);
                const escapedText2 = escapeHtml(part.value2);
                html1Parts.push(`<span class="unchanged">${escapedText1}</span>`);
                html2Parts.push(`<span class="unchanged">${escapedText2}</span>`);
            } else if (part.type === 'delete') {
                const escapedText = escapeHtml(part.value);
                // Use line-removed class for full line deletions
                html1Parts.push(`<span class="line-removed">${escapedText}</span>`);
            } else if (part.type === 'insert') {
                const escapedText = escapeHtml(part.value);
                // Use line-added class for full line insertions
                html2Parts.push(`<span class="line-added">${escapedText}</span>`);
            } else if (part.type === 'changed') {
                // For changed lines, do inline word-level diff
                const inlineDiff = computeInlineDiff(part.value1, part.value2, options);
                html1Parts.push(inlineDiff.text1);
                html2Parts.push(inlineDiff.text2);
            }
        });

        return {
            text1: html1Parts.join(''),
            text2: html2Parts.join('')
        };
    }

    /**
     * Compute line-based differences between two texts
     * @param {string} text1 - First text
     * @param {string} text2 - Second text
     * @param {Object} options - Comparison options
     * @returns {Array<Object>} Array of diff parts with type and value
     */
    function computeLineDiff(text1, text2, options) {
        // Split texts into lines
        const lines1 = text1.split(/\r?\n/);
        const lines2 = text2.split(/\r?\n/);

        // Normalize lines for comparison
        const normalizedLines1 = lines1.map(line => normalizeForComparison(line, options));
        const normalizedLines2 = lines2.map(line => normalizeForComparison(line, options));

        // Compute line-level LCS. computeLCSPairs caps its own table, so very
        // large inputs degrade to a coarser diff rather than being refused.
        const lineLCS = computeLCSPairs(normalizedLines1, normalizedLines2);

        // Build matched sets
        const matched1 = new Set(lineLCS.map(m => m.i));
        const matched2 = new Set(lineLCS.map(m => m.j));

        const result = [];
        let i = 0, j = 0, lcsIdx = 0;

        // A line counts as empty exactly when normalization says so, so this
        // and the LCS above can never disagree about what "blank" means.
        const isEmptyLine = (line) =>
            normalizeForComparison(line, options) === IGNORED_EMPTY_LINE;

        while (i < lines1.length || j < lines2.length) {
            // Check if we're at a matched line pair
            if (lcsIdx < lineLCS.length &&
                lineLCS[lcsIdx].i === i &&
                lineLCS[lcsIdx].j === j) {
                // Lines match - output as equal with both original values
                result.push({
                    type: 'equal',
                    value1: lines1[i] + (i < lines1.length - 1 ? '\n' : ''),
                    value2: lines2[j] + (j < lines2.length - 1 ? '\n' : '')
                });
                i++;
                j++;
                lcsIdx++;
            } else if (i >= lines1.length) {
                // Only lines2 has remaining lines
                // If ignoreLineFeeds is enabled and it's an empty line, treat as equal
                if (options.ignoreLineFeeds && isEmptyLine(lines2[j])) {
                    result.push({
                        type: 'equal',
                        value1: '',
                        value2: lines2[j] + (j < lines2.length - 1 ? '\n' : '')
                    });
                } else {
                    result.push({
                        type: 'insert',
                        value: lines2[j] + (j < lines2.length - 1 ? '\n' : '')
                    });
                }
                j++;
            } else if (j >= lines2.length) {
                // Only lines1 has remaining lines
                // If ignoreLineFeeds is enabled and it's an empty line, treat as equal
                if (options.ignoreLineFeeds && isEmptyLine(lines1[i])) {
                    result.push({
                        type: 'equal',
                        value1: lines1[i] + (i < lines1.length - 1 ? '\n' : ''),
                        value2: ''
                    });
                } else {
                    result.push({
                        type: 'delete',
                        value: lines1[i] + (i < lines1.length - 1 ? '\n' : '')
                    });
                }
                i++;
            } else if (!matched1.has(i) && !matched2.has(j)) {
                // Both lines exist but don't match - check if they're similar enough for inline diff
                const shouldUseInlineDiff = shouldShowInlineDiff(lines1[i], lines2[j], options);

                if (shouldUseInlineDiff) {
                    // Lines are similar enough - show inline diff
                    result.push({
                        type: 'changed',
                        value1: lines1[i] + (i < lines1.length - 1 ? '\n' : ''),
                        value2: lines2[j] + (j < lines2.length - 1 ? '\n' : '')
                    });
                    i++;
                    j++;
                } else {
                    // Lines are too different to pair. Look one line ahead on each
                    // side: if the current line pairs better with the other text's
                    // next line, emit a pure deletion/insertion so the similar pair
                    // stays aligned instead of being split into delete + insert.
                    const pairsWithNext1 = i + 1 < lines1.length && !matched1.has(i + 1) &&
                        shouldShowInlineDiff(lines1[i + 1], lines2[j], options);
                    const pairsWithNext2 = j + 1 < lines2.length && !matched2.has(j + 1) &&
                        shouldShowInlineDiff(lines1[i], lines2[j + 1], options);

                    if (pairsWithNext1 && !pairsWithNext2) {
                        // lines2[j] belongs with the next line1 - delete lines1[i] only
                        if (options.ignoreLineFeeds && isEmptyLine(lines1[i])) {
                            result.push({
                                type: 'equal',
                                value1: lines1[i] + (i < lines1.length - 1 ? '\n' : ''),
                                value2: ''
                            });
                        } else {
                            result.push({
                                type: 'delete',
                                value: lines1[i] + (i < lines1.length - 1 ? '\n' : '')
                            });
                        }
                        i++;
                    } else if (pairsWithNext2 && !pairsWithNext1) {
                        // lines1[i] belongs with the next line2 - insert lines2[j] only
                        if (options.ignoreLineFeeds && isEmptyLine(lines2[j])) {
                            result.push({
                                type: 'equal',
                                value1: '',
                                value2: lines2[j] + (j < lines2.length - 1 ? '\n' : '')
                            });
                        } else {
                            result.push({
                                type: 'insert',
                                value: lines2[j] + (j < lines2.length - 1 ? '\n' : '')
                            });
                        }
                        j++;
                    } else {
                        // Treat as separate delete and insert
                        // If ignoreLineFeeds is enabled and they're empty lines, treat as equal
                        if (options.ignoreLineFeeds && isEmptyLine(lines1[i])) {
                            result.push({
                                type: 'equal',
                                value1: lines1[i] + (i < lines1.length - 1 ? '\n' : ''),
                                value2: ''
                            });
                        } else {
                            result.push({
                                type: 'delete',
                                value: lines1[i] + (i < lines1.length - 1 ? '\n' : '')
                            });
                        }
                        if (options.ignoreLineFeeds && isEmptyLine(lines2[j])) {
                            result.push({
                                type: 'equal',
                                value1: '',
                                value2: lines2[j] + (j < lines2.length - 1 ? '\n' : '')
                            });
                        } else {
                            result.push({
                                type: 'insert',
                                value: lines2[j] + (j < lines2.length - 1 ? '\n' : '')
                            });
                        }
                        i++;
                        j++;
                    }
                }
            } else if (!matched1.has(i)) {
                // Line only in text1
                // If ignoreLineFeeds is enabled and it's an empty line, treat as equal
                if (options.ignoreLineFeeds && isEmptyLine(lines1[i])) {
                    result.push({
                        type: 'equal',
                        value1: lines1[i] + (i < lines1.length - 1 ? '\n' : ''),
                        value2: ''
                    });
                } else {
                    result.push({
                        type: 'delete',
                        value: lines1[i] + (i < lines1.length - 1 ? '\n' : '')
                    });
                }
                i++;
            } else {
                // Line only in text2
                // If ignoreLineFeeds is enabled and it's an empty line, treat as equal
                if (options.ignoreLineFeeds && isEmptyLine(lines2[j])) {
                    result.push({
                        type: 'equal',
                        value1: '',
                        value2: lines2[j] + (j < lines2.length - 1 ? '\n' : '')
                    });
                } else {
                    result.push({
                        type: 'insert',
                        value: lines2[j] + (j < lines2.length - 1 ? '\n' : '')
                    });
                }
                j++;
            }
        }

        return result;
    }

    /**
     * Determine if inline diff should be used for two lines
     * Considers both similarity and the ratio of changed content
     * @param {string} line1 - First line
     * @param {string} line2 - Second line
     * @param {Object} options - Comparison options
     * @returns {boolean} True if inline diff should be used
     */
    function shouldShowInlineDiff(line1, line2, options) {
        // Tokenize both lines
        const tokens1 = tokenizeText(line1);
        const tokens2 = tokenizeText(line2);

        // Filter to only word tokens for comparison
        const words1 = tokens1.filter(t => t.type === 'word');
        const words2 = tokens2.filter(t => t.type === 'word');

        if (words1.length === 0 && words2.length === 0) return true;
        if (words1.length === 0 || words2.length === 0) return false;

        // Refuse the inline path for lines too long to diff word-by-word. The
        // caller then renders them as a plain deletion plus insertion, which is
        // coarser but always finishes. Budget against exactly what the inline
        // diff will allocate: all tokens, not just words (separators are diffed
        // too), and after the same prefix/suffix trim - otherwise two long but
        // nearly identical paragraphs get refused despite being cheap.
        const inlineSpan = trimmedSpan(
            normalizeTokens(tokens1, options),
            normalizeTokens(tokens2, options)
        );
        if (!isLCSFeasible(inlineSpan.m, inlineSpan.n)) return false;

        // Normalize words for comparison
        const normalizedWords1 = words1.map(t => normalizeForComparison(t.value, options));
        const normalizedWords2 = words2.map(t => normalizeForComparison(t.value, options));

        // Compute LCS length
        const lcsLength = computeLCSLength(normalizedWords1, normalizedWords2);

        // Calculate metrics
        const maxLength = Math.max(words1.length, words2.length);
        const minLength = Math.min(words1.length, words2.length);
        const similarity = lcsLength / maxLength;

        // Calculate what percentage of the smaller text would change
        const unchangedRatio = lcsLength / minLength;

        // Use inline diff only if:
        // 1. At least 40% of words are similar (based on max length) AND
        // 2. At least 30% of the smaller text remains unchanged
        // This allows showing inline diffs for lines with moderate changes
        // while still treating completely different lines as separate
        const SIMILARITY_THRESHOLD = 0.4;
        const UNCHANGED_THRESHOLD = 0.3;

        return similarity >= SIMILARITY_THRESHOLD && unchangedRatio >= UNCHANGED_THRESHOLD;
    }

    /**
     * Compute the length of the Longest Common Subsequence.
     * Memory is already linear, but the loop is O(m*n) in time, so the common
     * prefix and suffix are trimmed first - each trimmed element contributes
     * exactly one to the result. Without that, a single very long line with one
     * word changed would spin for tens of seconds on the main thread.
     * @param {Array<string>} seq1 - First sequence
     * @param {Array<string>} seq2 - Second sequence
     * @returns {number} Length of LCS
     */
    function computeLCSLength(seq1, seq2) {
        if (seq1.length === 0 || seq2.length === 0) return 0;

        const span = trimmedSpan(seq1, seq2);
        const trimmed = span.start + span.end; // matched outright, one each

        if (span.m === 0 || span.n === 0) return trimmed;

        // Whatever is left is genuinely different on both sides. If it is too
        // big to price exactly, treat the middle as sharing nothing: that
        // understates similarity, so the caller falls back to a whole-line
        // delete plus insert rather than hanging.
        if (!isLCSFeasible(span.m, span.n)) return trimmed;

        const start = span.start;
        const m = span.m;
        const n = span.n;

        // Use space-optimized DP (only need current and previous row)
        let prev = Array(n + 1).fill(0);
        let curr = Array(n + 1).fill(0);

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (seq1[start + i - 1] === seq2[start + j - 1]) {
                    curr[j] = prev[j - 1] + 1;
                } else {
                    curr[j] = Math.max(prev[j], curr[j - 1]);
                }
            }
            [prev, curr] = [curr, prev];
        }

        return trimmed + prev[n];
    }

    /**
     * Normalize a line for comparison based on options
     * @param {string} line - Input line
     * @param {Object} options - Comparison options
     * @returns {string} Normalized line
     */
    function normalizeForComparison(line, options) {
        let result = line;

        if (options.ignoreCase) {
            result = result.toLowerCase();
        }

        if (options.ignoreSpaces) {
            // Whitespace except line feeds, which are governed by ignoreLineFeeds
            result = result.replace(/[^\S\r\n]/g, '');
        }

        if (options.ignoreEscapeSequences) {
            result = result.replace(/\\[ntr"'\\bfv]/g, '');
        }

        // If ignoreLineFeeds is enabled and the line is empty (or became empty
        // after normalization), treat all empty lines as equivalent.
        // Deliberately '' and not .trim() === '': with "Ignore spaces" off, a
        // line of tabs and spaces is content the user asked us to respect, and
        // collapsing it here would report differing texts as exactly the same.
        // When "Ignore spaces" is on, such a line has already become ''.
        if (options.ignoreLineFeeds && result === '') {
            return IGNORED_EMPTY_LINE;
        }

        return result;
    }

    /**
     * Compute the Longest Common Subsequence of two sequences as index pairs.
     *
     * Used for both line-level and token-level diffing. The DP table is the
     * memory bottleneck, so two things keep it in check:
     *   - Common prefixes and suffixes are matched directly and excluded from
     *     the table. For the common case of two mostly-identical texts this
     *     shrinks the problem dramatically.
     *   - The remaining table is a single flat Uint32Array rather than nested
     *     arrays, which costs 4 bytes per cell instead of ~8 plus per-row
     *     object overhead.
     *
     * Self-limiting: if the trimmed middle would still exceed MAX_LCS_CELLS the
     * middle is skipped and only the prefix and suffix matches are returned.
     * That is a valid common subsequence, just not the longest one, so the
     * diff stays correct and merely gets coarser in the region we gave up on.
     *
     * @param {Array<string>} seq1 - First sequence of normalized values
     * @param {Array<string>} seq2 - Second sequence of normalized values
     * @returns {Array<Object>} LCS as array of {i, j} position pairs, ascending
     */
    function computeLCSPairs(seq1, seq2) {
        if (seq1.length === 0 || seq2.length === 0) return [];

        const lcs = [];
        collectLCSPairs(seq1, 0, seq1.length, seq2, 0, seq2.length, lcs);
        return lcs;
    }

    /**
     * Append LCS pairs for seq1[lo1, hi1) against seq2[lo2, hi2) to `out`,
     * in ascending index order.
     *
     * Common prefixes and suffixes are matched directly and excluded from the
     * table, which for two mostly-identical texts shrinks the problem
     * dramatically. If what remains still exceeds MAX_LCS_CELLS, the region is
     * split in half and each half handled separately: every split quarters the
     * area, so this terminates, and the only matches lost are those spanning a
     * split point. That degrades gradually with size instead of dropping the
     * whole region at once.
     *
     * @param {Array<string>} seq1 - First sequence
     * @param {number} lo1 - Start index in seq1, inclusive
     * @param {number} hi1 - End index in seq1, exclusive
     * @param {Array<string>} seq2 - Second sequence
     * @param {number} lo2 - Start index in seq2, inclusive
     * @param {number} hi2 - End index in seq2, exclusive
     * @param {Array<Object>} out - Array to append {i, j} pairs to
     */
    function collectLCSPairs(seq1, lo1, hi1, seq2, lo2, hi2, out) {
        // Common prefix: these pairs are already in ascending order
        while (lo1 < hi1 && lo2 < hi2 && seq1[lo1] === seq2[lo2]) {
            out.push({ i: lo1, j: lo2 });
            lo1++;
            lo2++;
        }

        // Common suffix: held back until the middle has been emitted
        const suffix = [];
        while (hi1 > lo1 && hi2 > lo2 && seq1[hi1 - 1] === seq2[hi2 - 1]) {
            hi1--;
            hi2--;
            suffix.push({ i: hi1, j: hi2 });
        }

        const m = hi1 - lo1;
        const n = hi2 - lo2;

        if (m > 0 && n > 0) {
            if (isLCSFeasible(m, n)) {
                const width = n + 1;
                const dp = new Uint32Array((m + 1) * width);

                for (let i = 1; i <= m; i++) {
                    const row = i * width;
                    const prevRow = row - width;
                    const value1 = seq1[lo1 + i - 1];
                    for (let j = 1; j <= n; j++) {
                        if (value1 === seq2[lo2 + j - 1]) {
                            dp[row + j] = dp[prevRow + j - 1] + 1;
                        } else {
                            const up = dp[prevRow + j];
                            const left = dp[row + j - 1];
                            dp[row + j] = up > left ? up : left;
                        }
                    }
                }

                // Backtrack, collecting pairs in reverse then flipping once
                const middle = [];
                let i = m;
                let j = n;

                while (i > 0 && j > 0) {
                    if (seq1[lo1 + i - 1] === seq2[lo2 + j - 1]) {
                        middle.push({ i: lo1 + i - 1, j: lo2 + j - 1 });
                        i--;
                        j--;
                    } else if (dp[(i - 1) * width + j] > dp[i * width + j - 1]) {
                        i--;
                    } else {
                        j--;
                    }
                }

                for (let k = middle.length - 1; k >= 0; k--) {
                    out.push(middle[k]);
                }
            } else if (m === 1 || n === 1) {
                // Splitting cannot shrink a single-element side, so handle it
                // directly - with one row the LCS is just the first match, if
                // there is one. Exact, linear, and guarantees termination.
                if (m === 1) {
                    for (let j = lo2; j < hi2; j++) {
                        if (seq2[j] === seq1[lo1]) {
                            out.push({ i: lo1, j: j });
                            break;
                        }
                    }
                } else {
                    for (let i = lo1; i < hi1; i++) {
                        if (seq1[i] === seq2[lo2]) {
                            out.push({ i: i, j: lo2 });
                            break;
                        }
                    }
                }
            } else {
                // Halve the first side and cut the second proportionally, so
                // the two halves stay roughly aligned with each other. With
                // m >= 2 the split point is strictly inside the range, so both
                // recursive calls are smaller and this terminates.
                const mid1 = lo1 + (m >> 1);
                const mid2 = lo2 + Math.round(n * ((mid1 - lo1) / m));
                collectLCSPairs(seq1, lo1, mid1, seq2, lo2, mid2, out);
                collectLCSPairs(seq1, mid1, hi1, seq2, mid2, hi2, out);
            }
        }

        for (let k = suffix.length - 1; k >= 0; k--) {
            out.push(suffix[k]);
        }
    }

    /**
     * Whether an LCS table for these sizes is small enough to build.
     * Guards the token-level path, where a single very long line (minified
     * JSON, a CSV row, a log line) would otherwise allocate gigabytes.
     * @param {number} m - Length of the first sequence
     * @param {number} n - Length of the second sequence
     * @returns {boolean} True if the comparison should be attempted
     */
    function isLCSFeasible(m, n) {
        return m * n <= MAX_LCS_CELLS;
    }

    /**
     * Compute inline word-level diff for two lines
     * @param {string} line1 - First line
     * @param {string} line2 - Second line
     * @param {Object} options - Comparison options
     * @returns {Object} Object with text1 and text2 HTML strings
     */
    function computeInlineDiff(line1, line2, options) {
        const diff = computeWordDiff(line1, line2, options);

        const html1Parts = [];
        const html2Parts = [];

        diff.forEach(part => {
            if (part.type === 'equal') {
                // Use original values from both sides to preserve casing
                const escapedText1 = escapeHtml(part.value1);
                const escapedText2 = escapeHtml(part.value2);
                html1Parts.push(`<span class="unchanged">${escapedText1}</span>`);
                html2Parts.push(`<span class="unchanged">${escapedText2}</span>`);
            } else if (part.type === 'delete') {
                const escapedText = escapeHtml(part.value);
                html1Parts.push(`<span class="removed">${escapedText}</span>`);
            } else if (part.type === 'insert') {
                const escapedText = escapeHtml(part.value);
                html2Parts.push(`<span class="added">${escapedText}</span>`);
            }
        });

        return {
            text1: html1Parts.join(''),
            text2: html2Parts.join('')
        };
    }

    /**
     * Normalize tokens for comparison.
     * Separators that the options say to ignore become shared markers, so they
     * always compare equal while still being displayed as the user typed them.
     * @param {Array<Object>} tokens - Tokens from tokenizeText
     * @param {Object} options - Comparison options
     * @returns {Array<string>} Normalized values, parallel to `tokens`
     */
    function normalizeTokens(tokens, options) {
        return tokens.map(t => {
            if (t.type === 'separator') {
                if (/\r|\n/.test(t.value) && options.ignoreLineFeeds) {
                    return IGNORED_LINEFEED;
                }
                // Spaces, but not line feeds - those are governed above
                if (/\s/.test(t.value) && !/\r|\n/.test(t.value) && options.ignoreSpaces) {
                    return IGNORED_SPACE;
                }
                return t.value;
            }
            return normalizeForComparison(t.value, options);
        });
    }

    /**
     * Size of the region two sequences actually need a DP table for, once
     * their common prefix and suffix are trimmed. Lets a caller budget against
     * the same quantity computeLCSPairs will allocate for.
     * @param {Array<string>} seq1 - First sequence
     * @param {Array<string>} seq2 - Second sequence
     * @returns {Object} {start, end, m, n} - trimmed element counts and the
     *   sizes of the middle that remains
     */
    function trimmedSpan(seq1, seq2) {
        const m = seq1.length;
        const n = seq2.length;

        let start = 0;
        while (start < m && start < n && seq1[start] === seq2[start]) {
            start++;
        }

        let end = 0;
        while (end < m - start && end < n - start &&
            seq1[m - 1 - end] === seq2[n - 1 - end]) {
            end++;
        }

        return { start: start, end: end, m: m - start - end, n: n - start - end };
    }

    /**
     * Compute word-level differences between two strings
     * @param {string} text1 - First text
     * @param {string} text2 - Second text
     * @param {Object} options - Comparison options
     * @returns {Array<Object>} Array of diff parts with type and value
     */
    function computeWordDiff(text1, text2, options) {
        // Tokenize into words and separators
        let tokens1 = tokenizeText(text1);
        let tokens2 = tokenizeText(text2);

        const normalizedTokens1 = normalizeTokens(tokens1, options);
        const normalizedTokens2 = normalizeTokens(tokens2, options);

        // Compute token-level LCS
        const tokenLCS = computeLCSPairs(normalizedTokens1, normalizedTokens2);

        // Build matched sets
        const matched1 = new Set(tokenLCS.map(m => m.i));
        const matched2 = new Set(tokenLCS.map(m => m.j));

        const result = [];
        let i = 0, j = 0, lcsIdx = 0;

        while (i < tokens1.length || j < tokens2.length) {
            // Check if we're at a matched token pair
            if (lcsIdx < tokenLCS.length &&
                tokenLCS[lcsIdx].i === i &&
                tokenLCS[lcsIdx].j === j) {
                // Tokens match - output as equal with both original values
                result.push({
                    type: 'equal',
                    value1: tokens1[i].value,
                    value2: tokens2[j].value
                });
                i++;
                j++;
                lcsIdx++;
            } else if (i >= tokens1.length) {
                // Only tokens2 has remaining tokens
                result.push({
                    type: 'insert',
                    value: tokens2[j].value
                });
                j++;
            } else if (j >= tokens2.length) {
                // Only tokens1 has remaining tokens
                result.push({
                    type: 'delete',
                    value: tokens1[i].value
                });
                i++;
            } else if (!matched1.has(i)) {
                // Token only in text1
                result.push({
                    type: 'delete',
                    value: tokens1[i].value
                });
                i++;
            } else {
                // Token only in text2
                result.push({
                    type: 'insert',
                    value: tokens2[j].value
                });
                j++;
            }
        }

        return result;
    }

    /**
     * Tokenize text into words and separators (spaces, punctuation)
     * @param {string} text - Input text
     * @returns {Array<Object>} Array of tokens with type and value
     */
    function tokenizeText(text) {
        const tokens = [];
        // Match runs of word characters, or any single other character
        const regex = /\w+|[^\w]/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            const value = match[0];
            const type = /\w/.test(value) ? 'word' : 'separator';
            tokens.push({ type, value });
        }

        return tokens;
    }

    // ==================
    // Diff Navigation Functions
    // ==================

    /**
     * Initialize diff navigation after comparison is complete
     */
    function initializeDiffNavigation() {
        // Find diff elements in each panel separately
        diffElements1 = Array.from(
            elements.result1.querySelectorAll('.added, .removed, .line-added, .line-removed')
        );
        diffElements2 = Array.from(
            elements.result2.querySelectorAll('.added, .removed, .line-added, .line-removed')
        );

        // Reset current indices
        currentDiffIndex1 = -1;
        currentDiffIndex2 = -1;

        // Update UI for both panels
        updateDiffCounter(1);
        updateDiffCounter(2);
        updateNavigationButtons(1);
        updateNavigationButtons(2);
    }

    /**
     * Navigate to the previous diff in a specific panel
     * @param {number} panelNum - Panel number (1 or 2)
     */
    function navigateToPreviousDiff(panelNum) {
        const diffElements = panelNum === 1 ? diffElements1 : diffElements2;
        let currentIndex = panelNum === 1 ? currentDiffIndex1 : currentDiffIndex2;

        if (diffElements.length === 0) return;

        // Remove highlight from current diff
        if (currentIndex >= 0 && currentIndex < diffElements.length) {
            diffElements[currentIndex].classList.remove('current-diff');
        }

        // Move to previous diff (wrap around if at the beginning)
        currentIndex = currentIndex <= 0 ? diffElements.length - 1 : currentIndex - 1;

        // Update the state
        if (panelNum === 1) {
            currentDiffIndex1 = currentIndex;
        } else {
            currentDiffIndex2 = currentIndex;
        }

        // Highlight and scroll to the new diff
        scrollToDiff(panelNum, currentIndex);
        updateDiffCounter(panelNum);
    }

    /**
     * Navigate to the next diff in a specific panel
     * @param {number} panelNum - Panel number (1 or 2)
     */
    function navigateToNextDiff(panelNum) {
        const diffElements = panelNum === 1 ? diffElements1 : diffElements2;
        let currentIndex = panelNum === 1 ? currentDiffIndex1 : currentDiffIndex2;

        if (diffElements.length === 0) return;

        // Remove highlight from current diff
        if (currentIndex >= 0 && currentIndex < diffElements.length) {
            diffElements[currentIndex].classList.remove('current-diff');
        }

        // Move to next diff (wrap around if at the end)
        currentIndex = currentIndex >= diffElements.length - 1 ? 0 : currentIndex + 1;

        // Update the state
        if (panelNum === 1) {
            currentDiffIndex1 = currentIndex;
        } else {
            currentDiffIndex2 = currentIndex;
        }

        // Highlight and scroll to the new diff
        scrollToDiff(panelNum, currentIndex);
        updateDiffCounter(panelNum);
    }

    /**
     * Scroll to and highlight a specific diff in a panel
     * @param {number} panelNum - Panel number (1 or 2)
     * @param {number} index - Index of the diff to scroll to
     */
    function scrollToDiff(panelNum, index) {
        const diffElements = panelNum === 1 ? diffElements1 : diffElements2;

        if (index < 0 || index >= diffElements.length) return;

        const element = diffElements[index];
        element.classList.add('current-diff');

        // Scroll the element into view with smooth animation
        element.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest'
        });
    }

    /**
     * Update the diff counter display for a panel
     * @param {number} panelNum - Panel number (1 or 2)
     */
    function updateDiffCounter(panelNum) {
        const diffElements = panelNum === 1 ? diffElements1 : diffElements2;
        const currentIndex = panelNum === 1 ? currentDiffIndex1 : currentDiffIndex2;
        const counterElement = panelNum === 1 ? elements.diffCounter1 : elements.diffCounter2;

        if (diffElements.length === 0) {
            counterElement.textContent = '-';
        } else {
            counterElement.textContent = `${currentIndex + 1}/${diffElements.length}`;
        }
    }

    /**
     * Update the state of navigation buttons for a panel
     * @param {number} panelNum - Panel number (1 or 2)
     */
    function updateNavigationButtons(panelNum) {
        const diffElements = panelNum === 1 ? diffElements1 : diffElements2;
        const prevBtn = panelNum === 1 ? elements.prevDiffBtn1 : elements.prevDiffBtn2;
        const nextBtn = panelNum === 1 ? elements.nextDiffBtn1 : elements.nextDiffBtn2;

        const hasNoDiffs = diffElements.length === 0;
        prevBtn.disabled = hasNoDiffs;
        nextBtn.disabled = hasNoDiffs;
    }

    // ==================
    // Utility Functions
    // ==================

    /**
     * Escape HTML special characters to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    function escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, char => map[char]);
    }

    // ==================
    // Initialization
    // ==================

    /**
     * Initialize the application
     */
    function init() {
        try {
            initializeElements();

            // Attach event listener to form
            elements.comparisonForm.addEventListener('submit', compareTexts);

            // Attach event listeners to navigation buttons for panel 1
            elements.prevDiffBtn1.addEventListener('click', () => navigateToPreviousDiff(1));
            elements.nextDiffBtn1.addEventListener('click', () => navigateToNextDiff(1));

            // Attach event listeners to navigation buttons for panel 2
            elements.prevDiffBtn2.addEventListener('click', () => navigateToPreviousDiff(2));
            elements.nextDiffBtn2.addEventListener('click', () => navigateToNextDiff(2));

            // Arrow-key navigation is scoped to the result panels. Binding it to
            // the document meant swallowing every ArrowUp/ArrowDown once results
            // were visible, which killed keyboard page scrolling for the rest of
            // the session.
            elements.result1.addEventListener('keydown', handleKeyboardNavigation);
            elements.result2.addEventListener('keydown', handleKeyboardNavigation);
        } catch (error) {
            console.error('Failed to initialize application:', error);
            alert('Failed to initialize the application. Please refresh the page.');
        }
    }

    /**
     * Handle keyboard shortcuts for diff navigation
     * @param {KeyboardEvent} event - Keyboard event
     */
    function handleKeyboardNavigation(event) {
        // Modified arrow keys belong to the browser (word jumps, selection,
        // history), never to us
        if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
            return;
        }

        // Never steal keys from anything the user can type into
        if (event.target.isContentEditable ||
            event.target.tagName === 'TEXTAREA' ||
            event.target.tagName === 'INPUT' ||
            event.target.tagName === 'SELECT') {
            return;
        }

        // With nothing to navigate to, leave the key alone so the panel can
        // still be scrolled with the keyboard.
        if (diffElements1.length === 0 && diffElements2.length === 0) {
            return;
        }

        // Handle arrow keys - navigate both panels simultaneously
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (diffElements1.length > 0) navigateToNextDiff(1);
            if (diffElements2.length > 0) navigateToNextDiff(2);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (diffElements1.length > 0) navigateToPreviousDiff(1);
            if (diffElements2.length > 0) navigateToPreviousDiff(2);
        }
    }

    // Expose internals to the test page (tests.html), which sets window.__TEST__
    // before loading this script. Never set in normal use.
    if (window.__TEST__) {
        window.__diff = {
            computeLineDiff,
            computeLCSPairs,
            computeWordDiff,
            computeInlineDiff,
            renderDiff,
            shouldShowInlineDiff,
            isLCSFeasible,
            trimmedSpan,
            normalizeTokens,
            computeLCSLength,
            tokenizeText,
            normalizeForComparison,
            escapeHtml,
            MAX_LCS_CELLS
        };
        return;
    }

    // Wait for DOM to be fully loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
