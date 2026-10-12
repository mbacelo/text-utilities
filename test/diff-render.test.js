import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { computeLineDiff } from '../tools/text-comparison/diff-engine.js';
import { escapeHtml, renderDiff } from '../tools/text-comparison/diff-render.js';
import { opts, series } from './helpers.js';

/** Number of non-overlapping occurrences of `needle` in `haystack`. */
function count(haystack, needle) {
    return haystack.split(needle).length - 1;
}

describe('escapeHtml', () => {
    test('escapes every character that could open a tag or attribute', () => {
        assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#039;');
    });

    test('leaves ordinary text untouched', () => {
        assert.equal(escapeHtml('plain text 123'), 'plain text 123');
    });

    test('escapes the ampersand first, so entities are not double-decoded', () => {
        assert.equal(escapeHtml('&lt;'), '&amp;lt;');
    });
});

describe('renderDiff', () => {
    test('markup in the input cannot reach the panel as live HTML', () => {
        // The panel is filled with innerHTML, so this is the boundary that
        // keeps user input from becoming executable markup.
        const payload = '<img src=x onerror=alert(1)>';
        const html = renderDiff(computeLineDiff(payload, 'safe', opts()), opts());

        assert.ok(!html.includes('<img'), 'raw tag survived into the output');
        assert.ok(html.includes('&lt;img'), 'the tag was not escaped');
    });

    test('every part becomes one row with a cell per side', () => {
        // One row per part is what keeps the two sides aligned
        const parts = computeLineDiff('a\nb\nc', 'a\nc\nd', opts());
        const html = renderDiff(parts, opts());

        assert.equal(count(html, 'class="diff-row"'), parts.length);
        assert.equal(count(html, 'class="diff-cell'), parts.length * 2);
    });

    test('a deleted line is paired with a filler on the right', () => {
        const html = renderDiff(computeLineDiff('a\nb\nc', 'a\nc', opts()), opts());

        assert.ok(
            html.includes('<div class="diff-cell line-removed">b</div><div class="diff-cell filler"></div>'),
            html
        );
    });

    test('an inserted line is paired with a filler on the left', () => {
        const html = renderDiff(computeLineDiff('a\nc', 'a\nb\nc', opts()), opts());

        assert.ok(
            html.includes('<div class="diff-cell filler"></div><div class="diff-cell line-added">b</div>'),
            html
        );
    });

    test('unchanged lines render as plain text on both sides', () => {
        const html = renderDiff(computeLineDiff('same', 'same', opts()), opts());

        assert.equal(html, '<div class="diff-row"><div class="diff-cell">same</div><div class="diff-cell">same</div></div>');
    });

    test('line breaks stay out of the rows', () => {
        // Each row already is a line; a kept break would add a blank one
        const html = renderDiff(computeLineDiff('a\nb\nc', 'a\nx\nc', opts()), opts());
        assert.ok(!html.includes('\n'), 'a line break was rendered');
    });

    test('a partially changed line renders word-level spans', () => {
        const html = renderDiff(computeLineDiff('the quick fox', 'the slow fox', opts()), opts());

        assert.ok(html.includes('<span class="removed">quick</span>'), 'no word-level removal');
        assert.ok(html.includes('<span class="added">slow</span>'), 'no word-level addition');
        // A word-level change must not also paint the whole line
        assert.ok(!html.includes('line-removed'), 'line-level class on an inline change');
    });

    test('consecutive changes share one hunk, and an unchanged line ends it', () => {
        // x and y are removed together, z on its own after the unchanged b
        const html = renderDiff(computeLineDiff('a\nx\ny\nb\nz', 'a\nb', opts()), opts());

        assert.equal(count(html, 'class="diff-hunk"'), 2);
        assert.equal(count(html, '<div'), count(html, '</div>'), 'unbalanced markup');
    });

    test('identical texts render no hunks', () => {
        const html = renderDiff(computeLineDiff('a\nb', 'a\nb', opts()), opts());
        assert.equal(count(html, 'diff-hunk'), 0);
    });

    test('a large single-line pair renders end to end, not just diffs', () => {
        // computeLineDiff stops at a "changed" part; the token-level
        // allocation only happens once that part is rendered, so this has to
        // go all the way through renderDiff to exercise it.
        const words = series(6000, 'w');
        const line1 = words.join(' ');
        const line2 = [...words.slice(0, 3000), 'DIFFERENT', ...words.slice(3001)].join(' ');

        const html = renderDiff(computeLineDiff(line1, line2, opts()), opts());

        assert.ok(html.includes('<span class="added">DIFFERENT</span>'), 'the changed word is missing');
    });

    test('two large unrelated single lines degrade instead of throwing', () => {
        const line1 = series(6000, 'a').join(' ');
        const line2 = series(6000, 'b').join(' ');

        const parts = computeLineDiff(line1, line2, opts());
        const html = renderDiff(parts, opts());

        assert.ok(parts.length > 0, 'no diff parts produced');
        assert.ok(html.length > 0, 'nothing rendered');
    });
});
