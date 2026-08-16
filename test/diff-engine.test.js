import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    MAX_LCS_CELLS,
    computeLCSLength,
    computeLCSPairs,
    computeLineDiff,
    computeWordDiff,
    isLCSFeasible,
    shouldShowInlineDiff,
    tokenizeText,
    trimmedSpan
} from '../tools/text-comparison/diff-engine.js';

import {
    ALL, isEqualDiff, opts, reconstruct, series, SPEC_V1, SPEC_V2, textOf, types
} from './helpers.js';

describe('equality verdict', () => {
    test('identical texts are all-equal', () => {
        const parts = computeLineDiff('hello\nworld', 'hello\nworld', opts());
        assert.ok(isEqualDiff(parts), `expected every part equal, got: ${types(parts)}`);
    });

    test('empty inputs are all-equal', () => {
        assert.ok(isEqualDiff(computeLineDiff('', '', opts())));
    });

    test('REGRESSION: "a\\nb" vs "ab" is different under default options', () => {
        // A whole-text transform used to strip line feeds and report "exactly
        // the same" while the panels painted every line as changed. The
        // verdict now comes from the diff, so the two cannot disagree.
        const parts = computeLineDiff('a\nb', 'ab', ALL);
        assert.ok(!isEqualDiff(parts), `verdict says equal but diff shows: ${types(parts)}`);
    });

    test('REGRESSION: line-feed-only difference is reported as different', () => {
        assert.ok(!isEqualDiff(computeLineDiff('one\ntwo\nthree', 'onetwothree', ALL)));
    });

    test('text differing only by a trailing newline is different', () => {
        assert.ok(!isEqualDiff(computeLineDiff('abc', 'abc\n', opts())));
    });
});

describe('ignore options', () => {
    test('ignoreCase off: case difference is a difference', () => {
        assert.ok(!isEqualDiff(computeLineDiff('Hello', 'hello', opts())));
    });

    test('ignoreCase on: case difference is equal', () => {
        assert.ok(isEqualDiff(computeLineDiff('Hello', 'hello', opts({ ignoreCase: true }))));
    });

    test('ignoreCase preserves each side original casing in the output', () => {
        const parts = computeLineDiff('Hello', 'hello', opts({ ignoreCase: true }));
        assert.equal(textOf(parts, 1, 'equal'), 'Hello', 'left side lost its casing');
        assert.equal(textOf(parts, 2, 'equal'), 'hello', 'right side lost its casing');
    });

    test('ignoreSpaces off: inner spaces matter', () => {
        assert.ok(!isEqualDiff(computeLineDiff('a b', 'ab', opts())));
    });

    test('ignoreSpaces on: inner spaces are equal', () => {
        assert.ok(isEqualDiff(computeLineDiff('a b', 'ab', opts({ ignoreSpaces: true }))));
    });

    test('ignoreSpaces does not collapse line feeds', () => {
        const parts = computeLineDiff('a\nb', 'ab', opts({ ignoreSpaces: true }));
        assert.ok(!isEqualDiff(parts), 'line feeds must be governed by ignoreLineFeeds only');
    });

    test('ignoreLineFeeds on: a blank line on one side only is equal', () => {
        assert.ok(isEqualDiff(computeLineDiff('a\n\nb', 'a\nb', opts({ ignoreLineFeeds: true }))));
    });

    test('ignoreLineFeeds off: a blank line on one side only is a difference', () => {
        assert.ok(!isEqualDiff(computeLineDiff('a\n\nb', 'a\nb', opts())));
    });

    test('ignoreEscapeSequences on: literal \\n sequences are stripped', () => {
        assert.ok(isEqualDiff(
            computeLineDiff('a\\nb', 'ab', opts({ ignoreEscapeSequences: true }))));
    });

    test('ignoreEscapeSequences off: literal \\n sequences matter', () => {
        assert.ok(!isEqualDiff(computeLineDiff('a\\nb', 'ab', opts())));
    });

    test('REGRESSION: whitespace-only lines are not equal to blank ones', () => {
        // Normalization used to collapse any line that trimmed to empty, so
        // with "ignore spaces" OFF these reported as identical.
        const parts = computeLineDiff('a\n\nb', 'a\n\t \nb', opts({ ignoreLineFeeds: true }));
        assert.ok(!isEqualDiff(parts),
            'a tab-and-space line was treated as blank while ignoreSpaces was off');
    });

    test('whitespace-only lines ARE equal to blank ones when spaces are ignored', () => {
        assert.ok(isEqualDiff(computeLineDiff('a\n\nb', 'a\n\t \nb',
            opts({ ignoreLineFeeds: true, ignoreSpaces: true }))));
    });
});

describe('sentinel collisions', () => {
    // The markers lead with a NUL, which a textarea cannot contain, so user
    // text can never be mistaken for one.

    test('user text "__IGNORED_EMPTY_LINE__" does not equal a blank line', () => {
        const parts = computeLineDiff('__IGNORED_EMPTY_LINE__', '', opts({ ignoreLineFeeds: true }));
        assert.ok(!isEqualDiff(parts), 'sentinel leaked into user-text comparison');
    });

    // The space and line-feed markers only exist inside computeWordDiff, so
    // they have to be probed there - a computeLineDiff test passes either way
    // and would guard nothing.
    test('user text "__IGNORED_SPACE__" is not treated as an ignored space', () => {
        const parts = computeWordDiff('a__IGNORED_SPACE__b', 'ab', opts({ ignoreSpaces: true }));
        assert.ok(parts.some(part => part.type !== 'equal'),
            'literal sentinel text was swallowed as an ignored space');
    });

    test('user text "__IGNORED_LINEFEED__" is not treated as an ignored line feed', () => {
        const parts = computeWordDiff('a__IGNORED_LINEFEED__b', 'ab', opts({ ignoreLineFeeds: true }));
        assert.ok(parts.some(part => part.type !== 'equal'),
            'literal sentinel text was swallowed as an ignored line feed');
    });

    test('a literal sentinel compares equal to itself', () => {
        assert.ok(isEqualDiff(
            computeLineDiff('__IGNORED_LINEFEED__', '__IGNORED_LINEFEED__', ALL)));
    });

    test('an ignored space really is ignored (the marker still works)', () => {
        // A space and a tab are the same separator under ignoreSpaces
        const parts = computeWordDiff('a b', 'a\tb', opts({ ignoreSpaces: true }));
        assert.ok(parts.every(part => part.type === 'equal'),
            `ignoreSpaces stopped working: ${types(parts)}`);
    });

    test('without ignoreSpaces a space and a tab stay different', () => {
        const parts = computeWordDiff('a b', 'a\tb', opts());
        assert.ok(parts.some(part => part.type !== 'equal'),
            'separators were treated as equal with the option off');
    });
});

describe('diff shape (the spec in "diff behavior.txt")', () => {
    test('the sample versions are reported as different', () => {
        assert.ok(!isEqualDiff(computeLineDiff(SPEC_V1, SPEC_V2, opts())));
    });

    test('"jumped" -> "leaps" is an inline change, not a whole-line swap', () => {
        const parts = computeLineDiff(SPEC_V1, SPEC_V2, opts());
        assert.ok(parts.some(part => part.type === 'changed' && part.value1.includes('jumped')),
            `line 1 should be a "changed" part, got: ${types(parts)}`);
    });

    test('the bird line is removed outright', () => {
        const parts = computeLineDiff(SPEC_V1, SPEC_V2, opts());
        assert.ok(textOf(parts, 1, 'delete').includes('A small bird'));
    });

    test('the rabbit line is added outright', () => {
        const parts = computeLineDiff(SPEC_V1, SPEC_V2, opts());
        assert.ok(textOf(parts, 2, 'insert').includes('A rabbit watched'));
    });

    test('every original line survives into the left-hand output', () => {
        const parts = computeLineDiff(SPEC_V1, SPEC_V2, opts());
        assert.equal(reconstruct(parts, 1), SPEC_V1, 'left-hand reconstruction lost text');
    });

    test('every revised line survives into the right-hand output', () => {
        const parts = computeLineDiff(SPEC_V1, SPEC_V2, opts());
        assert.equal(reconstruct(parts, 2), SPEC_V2, 'right-hand reconstruction lost text');
    });

    test('a pure insertion in the middle keeps the surrounding lines equal', () => {
        assert.equal(types(computeLineDiff('a\nc', 'a\nb\nc', opts())), 'equal,insert,equal');
    });

    test('a pure deletion in the middle keeps the surrounding lines equal', () => {
        assert.equal(types(computeLineDiff('a\nb\nc', 'a\nc', opts())), 'equal,delete,equal');
    });
});

describe('tokenizer and word diff', () => {
    test('tokenizeText round-trips the original string', () => {
        const input = 'Hello, world! (test)\tend';
        assert.equal(tokenizeText(input).map(token => token.value).join(''), input,
            'tokenizer is lossy');
    });

    test('tokenizeText classifies words and separators', () => {
        const tokens = tokenizeText('ab c');
        assert.deepEqual(tokens.map(token => token.type), ['word', 'separator', 'word']);
    });

    test('computeWordDiff round-trips both sides', () => {
        const parts = computeWordDiff('the quick fox', 'the slow fox', opts());
        assert.equal(reconstruct(parts, 1), 'the quick fox');
        assert.equal(reconstruct(parts, 2), 'the slow fox');
    });

    test('computeWordDiff marks only the differing word', () => {
        const parts = computeWordDiff('the quick fox', 'the slow fox', opts());
        assert.equal(textOf(parts, 1, 'delete'), 'quick');
    });
});

describe('LCS primitive', () => {
    test('identical sequences pair everything', () => {
        assert.deepEqual(computeLCSPairs(['a', 'b', 'c'], ['a', 'b', 'c']),
            [{ i: 0, j: 0 }, { i: 1, j: 1 }, { i: 2, j: 2 }]);
    });

    test('disjoint sequences pair nothing', () => {
        assert.equal(computeLCSPairs(['a', 'b'], ['c', 'd']).length, 0);
    });

    test('empty sequences are handled', () => {
        assert.equal(computeLCSPairs([], ['a']).length, 0);
        assert.equal(computeLCSPairs(['a'], []).length, 0);
    });

    test('finds the classic ABCBDAB / BDCABA subsequence', () => {
        assert.equal(computeLCSPairs('ABCBDAB'.split(''), 'BDCABA'.split('')).length, 4);
    });

    test('returns strictly increasing indices on both sides', () => {
        const a = 'the quick brown fox jumps'.split(' ');
        const b = 'the slow brown fox walks fast'.split(' ');
        const pairs = computeLCSPairs(a, b);

        for (let k = 1; k < pairs.length; k++) {
            assert.ok(pairs[k].i > pairs[k - 1].i, 'left indices not increasing');
            assert.ok(pairs[k].j > pairs[k - 1].j, 'right indices not increasing');
        }
        for (const pair of pairs) {
            assert.equal(a[pair.i], b[pair.j], 'paired elements are not equal');
        }
    });

    test('a shared prefix and suffix are paired', () => {
        // Exercises the trimming fast path and its index re-offset
        const pairs = computeLCSPairs(['x', 'x', 'a', 'y', 'y'], ['x', 'x', 'b', 'y', 'y']);
        assert.deepEqual(pairs,
            [{ i: 0, j: 0 }, { i: 1, j: 1 }, { i: 3, j: 3 }, { i: 4, j: 4 }]);
    });

    test('one side being a prefix of the other', () => {
        assert.equal(computeLCSPairs(['a', 'b'], ['a', 'b', 'c']).length, 2);
    });

    test('computeLCSLength trims but still returns the exact length', () => {
        assert.equal(computeLCSLength(['a', 'b', 'c'], ['a', 'b', 'c']), 3);
        assert.equal(computeLCSLength(['a', 'x', 'c'], ['a', 'y', 'c']), 2);
        assert.equal(computeLCSLength(['a', 'b'], ['c', 'd']), 0);
        assert.equal(computeLCSLength([], ['a']), 0);
        assert.equal(computeLCSLength('ABCBDAB'.split(''), 'BDCABA'.split('')), 4);
    });

    test('computeLCSLength agrees with computeLCSPairs on generated input', () => {
        const alphabet = 'abc';
        for (let t = 0; t < 400; t++) {
            const a = Array.from({ length: t % 7 }, (_, k) => alphabet[(t + k) % 3]);
            const b = Array.from({ length: (t * 3) % 7 }, (_, k) => alphabet[(t * 2 + k) % 3]);
            assert.equal(computeLCSLength(a, b), computeLCSPairs(a, b).length,
                `disagreement on ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
        }
    });

    test('a single-element side is handled exactly', () => {
        // Guards the shape behind the non-terminating split: a one-element
        // side cannot be halved. This exercises the DP path, not the
        // over-budget branch - reaching that needs a >25M-element sequence,
        // so the branch itself stays untested here by necessity.
        const size = Math.ceil(Math.sqrt(MAX_LCS_CELLS)) + 1000;
        const long = series(size, 'x');
        const middle = Math.floor(size / 2);
        const target = long[middle];

        assert.deepEqual(computeLCSPairs([target], long), [{ i: 0, j: middle }]);
        assert.deepEqual(computeLCSPairs(long, [target]), [{ i: middle, j: 0 }]);
    });

    test('over the cap, prefix and suffix matches are kept', () => {
        // Over budget the middle is skipped, but the trimmed ends are still
        // real matches - the result must remain a valid common subsequence.
        const size = Math.ceil(Math.sqrt(MAX_LCS_CELLS)) + 500;
        const a = ['same-head', ...series(size, 'a'), 'same-tail'];
        const b = ['same-head', ...series(size, 'b'), 'same-tail'];
        const pairs = computeLCSPairs(a, b);

        assert.ok(pairs.length >= 2, 'prefix and suffix matches were lost');
        for (const pair of pairs) {
            assert.equal(a[pair.i], b[pair.j], 'returned a pair whose elements are not equal');
        }
        for (let k = 1; k < pairs.length; k++) {
            assert.ok(pairs[k].i > pairs[k - 1].i && pairs[k].j > pairs[k - 1].j,
                'indices not strictly increasing');
        }
    });
});

describe('large inputs degrade instead of hanging', () => {
    test('a 5k-token single-line pair completes', () => {
        const words = series(5000, 'w');
        const line1 = words.join(' ');
        const line2 = [...words.slice(0, 2500), 'DIFFERENT', ...words.slice(2501)].join(' ');

        const parts = computeLineDiff(line1, line2, opts());
        assert.ok(parts.length > 0, 'no diff parts produced');
        assert.ok(!isEqualDiff(parts), 'expected a difference');
    });

    test('the inline-diff gate budgets against all tokens, not just words', () => {
        // Two long lines with nothing in common: the trim cannot shrink them,
        // so the real table is token-sized and must be refused. Word counts
        // alone would have cleared the budget and let it through.
        const line1 = series(4900, 'a').join(' ');
        const line2 = series(4900, 'b').join(' ');

        assert.ok(isLCSFeasible(4900, 4900), 'precondition: word counts alone fit the budget');
        const span = trimmedSpan(
            tokenizeText(line1).map(token => token.value),
            tokenizeText(line2).map(token => token.value)
        );
        assert.ok(!isLCSFeasible(span.m, span.n),
            'precondition: the real token span should exceed the budget');

        assert.equal(shouldShowInlineDiff(line1, line2, opts()), false,
            'gate passed a line pair whose token-level table exceeds MAX_LCS_CELLS');
    });

    test('REGRESSION: large identical inputs are still reported as identical', () => {
        // The feasibility check used to run on untrimmed line counts, so two
        // byte-identical files over ~5000 lines were reported as different.
        const text = series(6000).join('\n');
        assert.ok(isEqualDiff(computeLineDiff(text, text, opts())),
            'identical text reported as different at 6000 lines');
    });

    test('REGRESSION: a small edit in a large file stays a small diff', () => {
        const a = series(6000);
        const b = a.slice();
        b.splice(3000, 3);

        const parts = computeLineDiff(a.join('\n'), b.join('\n'), opts());
        assert.equal(parts.filter(part => part.type === 'delete').length, 3);
        assert.equal(parts.filter(part => part.type === 'insert').length, 0);
    });

    test('REGRESSION: a long near-identical paragraph still gets an inline diff', () => {
        // The gate used to budget untrimmed token counts while the LCS
        // budgeted the trimmed middle, so long-but-similar lines were
        // needlessly demoted to a whole-line delete + insert.
        const words = series(3000, 'word');
        const line1 = words.join(' ');
        const line2 = [...words.slice(0, 1500), 'CHANGED', ...words.slice(1501)].join(' ');

        assert.equal(shouldShowInlineDiff(line1, line2, opts()), true,
            'gate refused a cheap, nearly identical pair of long lines');
        assert.equal(types(computeLineDiff(line1, line2, opts())), 'changed');
    });

    test('REGRESSION: over the cap the diff degrades gradually, not totally', () => {
        // Differing first and last lines defeat the prefix/suffix trim and
        // push the middle over the budget. The region used to be abandoned
        // wholesale, turning a 3-line edit into thousands of changed lines.
        const shared = series(5100);
        const a = ['HEAD-A', ...shared, 'TAIL-A'];
        const trimmedShared = shared.slice();
        trimmedShared.splice(2550, 3);
        const b = ['HEAD-B', ...trimmedShared, 'TAIL-B'];

        const parts = computeLineDiff(a.join('\n'), b.join('\n'), opts());
        const equals = parts.filter(part => part.type === 'equal').length;
        // Nearly everything is shared; a wholesale abandon would leave ~0
        assert.ok(equals > 4000, `expected most lines to still match, only ${equals} did`);
    });

    test('REGRESSION: a huge single line with one word changed stays fast', () => {
        // computeLCSLength used to run untrimmed, so this took tens of seconds
        // despite the change being a single word.
        const words = series(40000, 'word');
        const line1 = words.join(' ');
        const line2 = [...words.slice(0, 20000), 'CHANGED', ...words.slice(20001)].join(' ');

        const started = performance.now();
        computeLineDiff(line1, line2, opts());
        const elapsed = performance.now() - started;

        assert.ok(elapsed < 3000, `took ${Math.round(elapsed)} ms; expected well under 3000`);
    });

    test('many-line inputs complete', () => {
        const a = series(2000);
        const b = a.map((line, index) => (index === 1000 ? 'line CHANGED' : line));
        assert.ok(!isEqualDiff(computeLineDiff(a.join('\n'), b.join('\n'), opts())));
    });
});
