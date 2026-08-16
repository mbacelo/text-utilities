/**
 * Text comparison engine.
 *
 * Pure, DOM-free diff logic: line-level and token-level LCS, the ignore
 * options, and the heuristic deciding when two lines are similar enough to
 * diff word by word. Nothing here touches the document or any global, so the
 * same code runs in the page, inside the diff worker, and under `node --test`.
 */

// Largest LCS table we are willing to build, in cells. The DP is O(m*n) in
// both time and memory, so pathological input (two long lines with no
// newlines) must be refused rather than allowed to exhaust the tab. At 4
// bytes per cell this caps the table at ~100 MB; beyond it we fall back to
// a coarser diff instead of throwing.
export const MAX_LCS_CELLS = 25000000;

// Markers used to make ignored content compare equal. They are compared
// against normalized user text, so they lead with a NUL character, which a
// textarea cannot contain - otherwise a user literally typing
// "__IGNORED_SPACE__" would collide with the marker and diff incorrectly.
const NUL = String.fromCharCode(0);
const IGNORED_EMPTY_LINE = NUL + 'IGNORED_EMPTY_LINE';
const IGNORED_LINEFEED = NUL + 'IGNORED_LINEFEED';
const IGNORED_SPACE = NUL + 'IGNORED_SPACE';

/**
 * Normalize a line for comparison based on options
 * @param {string} line - Input line
 * @param {Object} options - Comparison options
 * @returns {string} Normalized line
 */
export function normalizeForComparison(line, options) {
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
 * Tokenize text into words and separators (spaces, punctuation)
 * @param {string} text - Input text
 * @returns {Array<Object>} Array of tokens with type and value
 */
export function tokenizeText(text) {
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

/**
 * Normalize tokens for comparison.
 * Separators that the options say to ignore become shared markers, so they
 * always compare equal while still being displayed as the user typed them.
 * @param {Array<Object>} tokens - Tokens from tokenizeText
 * @param {Object} options - Comparison options
 * @returns {Array<string>} Normalized values, parallel to `tokens`
 */
export function normalizeTokens(tokens, options) {
    return tokens.map(token => {
        if (token.type === 'separator') {
            if (/\r|\n/.test(token.value) && options.ignoreLineFeeds) {
                return IGNORED_LINEFEED;
            }
            // Spaces, but not line feeds - those are governed above
            if (/\s/.test(token.value) && !/\r|\n/.test(token.value) && options.ignoreSpaces) {
                return IGNORED_SPACE;
            }
            return token.value;
        }
        return normalizeForComparison(token.value, options);
    });
}

/**
 * Whether an LCS table for these sizes is small enough to build.
 * Guards the token-level path, where a single very long line (minified
 * JSON, a CSV row, a log line) would otherwise allocate gigabytes.
 * @param {number} m - Length of the first sequence
 * @param {number} n - Length of the second sequence
 * @returns {boolean} True if the comparison should be attempted
 */
export function isLCSFeasible(m, n) {
    return m * n <= MAX_LCS_CELLS;
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
export function trimmedSpan(seq1, seq2) {
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

    return { start, end, m: m - start - end, n: n - start - end };
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
export function computeLCSLength(seq1, seq2) {
    if (seq1.length === 0 || seq2.length === 0) return 0;

    const span = trimmedSpan(seq1, seq2);
    const trimmed = span.start + span.end; // matched outright, one each

    if (span.m === 0 || span.n === 0) return trimmed;

    // Whatever is left is genuinely different on both sides. If it is too
    // big to price exactly, treat the middle as sharing nothing: that
    // understates similarity, so the caller falls back to a whole-line
    // delete plus insert rather than hanging.
    if (!isLCSFeasible(span.m, span.n)) return trimmed;

    const { start, m, n } = span;

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
 * The table is a single flat Uint32Array rather than nested arrays, which
 * costs 4 bytes per cell instead of ~8 plus per-row object overhead.
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
                        out.push({ i: lo1, j });
                        break;
                    }
                }
            } else {
                for (let i = lo1; i < hi1; i++) {
                    if (seq1[i] === seq2[lo2]) {
                        out.push({ i, j: lo2 });
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
 * Compute the Longest Common Subsequence of two sequences as index pairs.
 * Used for both line-level and token-level diffing.
 *
 * Self-limiting: see collectLCSPairs. Over the cap the result is still a
 * valid common subsequence, just not the longest one, so the diff stays
 * correct and merely gets coarser in the region we gave up on.
 *
 * @param {Array<string>} seq1 - First sequence of normalized values
 * @param {Array<string>} seq2 - Second sequence of normalized values
 * @returns {Array<Object>} LCS as array of {i, j} position pairs, ascending
 */
export function computeLCSPairs(seq1, seq2) {
    if (seq1.length === 0 || seq2.length === 0) return [];

    const lcs = [];
    collectLCSPairs(seq1, 0, seq1.length, seq2, 0, seq2.length, lcs);
    return lcs;
}

/**
 * Determine if inline diff should be used for two lines
 * Considers both similarity and the ratio of changed content
 * @param {string} line1 - First line
 * @param {string} line2 - Second line
 * @param {Object} options - Comparison options
 * @returns {boolean} True if inline diff should be used
 */
export function shouldShowInlineDiff(line1, line2, options) {
    const tokens1 = tokenizeText(line1);
    const tokens2 = tokenizeText(line2);

    // Only word tokens drive the similarity score
    const words1 = tokens1.filter(token => token.type === 'word');
    const words2 = tokens2.filter(token => token.type === 'word');

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

    const normalizedWords1 = words1.map(token => normalizeForComparison(token.value, options));
    const normalizedWords2 = words2.map(token => normalizeForComparison(token.value, options));

    const lcsLength = computeLCSLength(normalizedWords1, normalizedWords2);

    const similarity = lcsLength / Math.max(words1.length, words2.length);
    // How much of the smaller side survives unchanged
    const unchangedRatio = lcsLength / Math.min(words1.length, words2.length);

    // Show an inline diff only for lines with moderate changes; completely
    // different lines are better rendered as a deletion plus an insertion.
    const SIMILARITY_THRESHOLD = 0.4;
    const UNCHANGED_THRESHOLD = 0.3;

    return similarity >= SIMILARITY_THRESHOLD && unchangedRatio >= UNCHANGED_THRESHOLD;
}

/**
 * Compute word-level differences between two strings
 * @param {string} text1 - First text
 * @param {string} text2 - Second text
 * @param {Object} options - Comparison options
 * @returns {Array<Object>} Array of diff parts with type and value
 */
export function computeWordDiff(text1, text2, options) {
    const tokens1 = tokenizeText(text1);
    const tokens2 = tokenizeText(text2);

    const tokenLCS = computeLCSPairs(
        normalizeTokens(tokens1, options),
        normalizeTokens(tokens2, options)
    );

    const matched1 = new Set(tokenLCS.map(pair => pair.i));
    const result = [];
    let i = 0, j = 0, lcsIdx = 0;

    while (i < tokens1.length || j < tokens2.length) {
        if (lcsIdx < tokenLCS.length && tokenLCS[lcsIdx].i === i && tokenLCS[lcsIdx].j === j) {
            // Both original values are kept so each side renders as typed
            result.push({ type: 'equal', value1: tokens1[i].value, value2: tokens2[j].value });
            i++;
            j++;
            lcsIdx++;
        } else if (i >= tokens1.length) {
            result.push({ type: 'insert', value: tokens2[j].value });
            j++;
        } else if (j >= tokens2.length || !matched1.has(i)) {
            result.push({ type: 'delete', value: tokens1[i].value });
            i++;
        } else {
            result.push({ type: 'insert', value: tokens2[j].value });
            j++;
        }
    }

    return result;
}

/**
 * Compute line-based differences between two texts
 * @param {string} text1 - First text
 * @param {string} text2 - Second text
 * @param {Object} options - Comparison options
 * @returns {Array<Object>} Array of diff parts with type and value
 */
export function computeLineDiff(text1, text2, options) {
    const lines1 = text1.split(/\r?\n/);
    const lines2 = text2.split(/\r?\n/);

    // Line-level LCS. computeLCSPairs caps its own table, so very large
    // inputs degrade to a coarser diff rather than being refused.
    const lineLCS = computeLCSPairs(
        lines1.map(line => normalizeForComparison(line, options)),
        lines2.map(line => normalizeForComparison(line, options))
    );

    const matched1 = new Set(lineLCS.map(pair => pair.i));
    const matched2 = new Set(lineLCS.map(pair => pair.j));

    const result = [];
    let i = 0, j = 0, lcsIdx = 0;

    // Every line but the last carries its trailing break into the part, so
    // concatenating one side's parts reproduces that side's text exactly.
    const lineAt = (lines, index) => lines[index] + (index < lines.length - 1 ? '\n' : '');

    // A line counts as empty exactly when normalization says so, so this
    // and the LCS above can never disagree about what "blank" means.
    const isEmptyLine = (line) => normalizeForComparison(line, options) === IGNORED_EMPTY_LINE;

    // A blank line that only exists on one side is not a difference when
    // line feeds are ignored - it is emitted as an equal part with nothing
    // on the other side, so the panels stay aligned.
    const emitDeletion = () => {
        const value = lineAt(lines1, i);
        result.push(options.ignoreLineFeeds && isEmptyLine(lines1[i])
            ? { type: 'equal', value1: value, value2: '' }
            : { type: 'delete', value });
        i++;
    };

    const emitInsertion = () => {
        const value = lineAt(lines2, j);
        result.push(options.ignoreLineFeeds && isEmptyLine(lines2[j])
            ? { type: 'equal', value1: '', value2: value }
            : { type: 'insert', value });
        j++;
    };

    while (i < lines1.length || j < lines2.length) {
        const atMatchedPair = lcsIdx < lineLCS.length &&
            lineLCS[lcsIdx].i === i &&
            lineLCS[lcsIdx].j === j;

        if (atMatchedPair) {
            result.push({ type: 'equal', value1: lineAt(lines1, i), value2: lineAt(lines2, j) });
            i++;
            j++;
            lcsIdx++;
        } else if (i >= lines1.length) {
            emitInsertion();
        } else if (j >= lines2.length) {
            emitDeletion();
        } else if (!matched1.has(i) && !matched2.has(j)) {
            if (shouldShowInlineDiff(lines1[i], lines2[j], options)) {
                // Similar enough to highlight word by word
                result.push({ type: 'changed', value1: lineAt(lines1, i), value2: lineAt(lines2, j) });
                i++;
                j++;
            } else {
                // Too different to pair. Look one line ahead on each side: if
                // the current line pairs better with the other text's next
                // line, emit a pure deletion/insertion so the similar pair
                // stays aligned instead of being split into delete + insert.
                const pairsWithNext1 = i + 1 < lines1.length && !matched1.has(i + 1) &&
                    shouldShowInlineDiff(lines1[i + 1], lines2[j], options);
                const pairsWithNext2 = j + 1 < lines2.length && !matched2.has(j + 1) &&
                    shouldShowInlineDiff(lines1[i], lines2[j + 1], options);

                if (pairsWithNext1 && !pairsWithNext2) {
                    emitDeletion();
                } else if (pairsWithNext2 && !pairsWithNext1) {
                    emitInsertion();
                } else {
                    emitDeletion();
                    emitInsertion();
                }
            }
        } else if (!matched1.has(i)) {
            emitDeletion();
        } else {
            emitInsertion();
        }
    }

    return result;
}
