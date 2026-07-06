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

        // Apply transformations for comparison
        const compareText1 = applyTransformations(text1, options);
        const compareText2 = applyTransformations(text2, options);

        // Check if texts are the same
        const areEqual = compareText1 === compareText2;

        // Display status message
        displayStatus(areEqual);

        // Generate and display diff visualization
        const diff = generateDiff(text1, text2, options);
        elements.result1.innerHTML = diff.text1;
        elements.result2.innerHTML = diff.text2;

        // Hide spinner and show results
        toggleLoadingState(false);

        // Initialize diff navigation
        initializeDiffNavigation();
    }

    /**
     * Apply text transformations based on selected options
     * @param {string} text - Original text
     * @param {Object} options - Transformation options
     * @returns {string} Transformed text
     */
    function applyTransformations(text, options) {
        let result = text;

        if (options.ignoreCase) {
            result = result.toLowerCase();
        }

        if (options.ignoreSpaces) {
            // Whitespace except line feeds, which are governed by ignoreLineFeeds
            result = result.replace(/[^\S\r\n]/g, '');
        }

        if (options.ignoreLineFeeds) {
            result = result.replace(/\r\n|\r|\n/g, '');
        }

        if (options.ignoreEscapeSequences) {
            // Remove common escape sequences: \n, \t, \r, \", \', \\, \b, \f, \v
            result = result.replace(/\\[ntr"'\\bfv]/g, '');
        }

        return result;
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
     * Generate visual diff representation of two texts
     * @param {string} text1 - First text
     * @param {string} text2 - Second text
     * @param {Object} options - Comparison options
     * @returns {Object} Object with text1 and text2 HTML strings
     */
    function generateDiff(text1, text2, options) {
        const diff = computeLineDiff(text1, text2, options);

        // Use arrays for better performance with large texts
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

        // Compute line-level LCS
        const lineLCS = computeLineLCS(normalizedLines1, normalizedLines2);

        // Build matched sets
        const matched1 = new Set(lineLCS.map(m => m.i));
        const matched2 = new Set(lineLCS.map(m => m.j));

        const result = [];
        let i = 0, j = 0, lcsIdx = 0;

        // Helper function to check if a line is empty
        const isEmptyLine = (line) => line.trim() === '';

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
     * Compute the length of the Longest Common Subsequence
     * @param {Array<string>} seq1 - First sequence
     * @param {Array<string>} seq2 - Second sequence
     * @returns {number} Length of LCS
     */
    function computeLCSLength(seq1, seq2) {
        const m = seq1.length;
        const n = seq2.length;

        if (m === 0 || n === 0) return 0;

        // Use space-optimized DP (only need current and previous row)
        let prev = Array(n + 1).fill(0);
        let curr = Array(n + 1).fill(0);

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (seq1[i - 1] === seq2[j - 1]) {
                    curr[j] = prev[j - 1] + 1;
                } else {
                    curr[j] = Math.max(prev[j], curr[j - 1]);
                }
            }
            [prev, curr] = [curr, prev];
        }

        return prev[n];
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

        // If ignoreLineFeeds is enabled and the line is empty (or becomes empty after normalization),
        // treat all empty lines as equivalent by returning a special marker
        if (options.ignoreLineFeeds && result.trim() === '') {
            return '__IGNORED_EMPTY_LINE__';
        }

        return result;
    }

    /**
     * Compute LCS for arrays of lines
     * @param {Array<string>} lines1 - First array of normalized lines
     * @param {Array<string>} lines2 - Second array of normalized lines
     * @returns {Array<Object>} LCS as array of position pairs
     */
    function computeLineLCS(lines1, lines2) {
        const m = lines1.length;
        const n = lines2.length;

        if (m === 0 || n === 0) return [];

        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

        // Build LCS table
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (lines1[i - 1] === lines2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        // Backtrack to find LCS
        const lcs = [];
        let i = m, j = n;

        while (i > 0 && j > 0) {
            if (lines1[i - 1] === lines2[j - 1]) {
                lcs.unshift({ i: i - 1, j: j - 1 });
                i--;
                j--;
            } else if (dp[i - 1][j] > dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }

        return lcs;
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

        // Normalize tokens for comparison
        // For space/linefeed tokens: if ignoreSpaces/ignoreLineFeeds is enabled, mark them with special markers
        // so they're always treated as equal but still displayed
        const normalizedTokens1 = tokens1.map(t => {
            if (t.type === 'separator') {
                // Handle line feeds
                if (/\r|\n/.test(t.value) && options.ignoreLineFeeds) {
                    return '__IGNORED_LINEFEED__';
                }
                // Handle spaces (but not line feeds)
                if (/\s/.test(t.value) && !/\r|\n/.test(t.value) && options.ignoreSpaces) {
                    return '__IGNORED_SPACE__';
                }
            }
            return t.type === 'word' ? normalizeForComparison(t.value, options) : t.value;
        });
        const normalizedTokens2 = tokens2.map(t => {
            if (t.type === 'separator') {
                // Handle line feeds
                if (/\r|\n/.test(t.value) && options.ignoreLineFeeds) {
                    return '__IGNORED_LINEFEED__';
                }
                // Handle spaces (but not line feeds)
                if (/\s/.test(t.value) && !/\r|\n/.test(t.value) && options.ignoreSpaces) {
                    return '__IGNORED_SPACE__';
                }
            }
            return t.type === 'word' ? normalizeForComparison(t.value, options) : t.value;
        });

        // Compute token-level LCS
        const tokenLCS = computeTokenLCS(normalizedTokens1, normalizedTokens2);

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

    /**
     * Compute LCS for arrays of tokens
     * @param {Array<string>} tokens1 - First array of normalized tokens
     * @param {Array<string>} tokens2 - Second array of normalized tokens
     * @returns {Array<Object>} LCS as array of position pairs
     */
    function computeTokenLCS(tokens1, tokens2) {
        const m = tokens1.length;
        const n = tokens2.length;

        if (m === 0 || n === 0) return [];

        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

        // Build LCS table
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (tokens1[i - 1] === tokens2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        // Backtrack to find LCS
        const lcs = [];
        let i = m, j = n;

        while (i > 0 && j > 0) {
            if (tokens1[i - 1] === tokens2[j - 1]) {
                lcs.unshift({ i: i - 1, j: j - 1 });
                i--;
                j--;
            } else if (dp[i - 1][j] > dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }

        return lcs;
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

            // Add keyboard shortcuts for navigation
            document.addEventListener('keydown', handleKeyboardNavigation);

            console.log('Text Comparison Tool initialized successfully');
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
        // Only handle shortcuts if results are visible
        if (!elements.resultsSection.classList.contains('visible')) {
            return;
        }

        // Check if user is typing in a text field
        if (event.target.tagName === 'TEXTAREA' || event.target.tagName === 'INPUT') {
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

    // Wait for DOM to be fully loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
