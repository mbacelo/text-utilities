import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { computeLineDiff } from '../tools/text-comparison/diff-engine.js';
import { escapeHtml, renderDiff } from '../tools/text-comparison/diff-render.js';
import { opts, series } from './helpers.js';

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
    test('markup in the input cannot reach the panels as live HTML', () => {
        // The panels are filled with innerHTML, so this is the boundary that
        // keeps user input from becoming executable markup.
        const payload = '<img src=x onerror=alert(1)>';
        const parts = computeLineDiff(payload, 'safe', opts());
        const html = renderDiff(parts, opts());

        assert.ok(!html.text1.includes('<img'), 'raw tag survived into the output');
        assert.ok(html.text1.includes('&lt;img'), 'the tag was not escaped');
    });

    test('unchanged lines render on both sides', () => {
        const parts = computeLineDiff('same', 'same', opts());
        const html = renderDiff(parts, opts());

        assert.ok(html.text1.includes('class="unchanged"'));
        assert.ok(html.text2.includes('class="unchanged"'));
    });

    test('a deleted line renders only on the left, an inserted one only on the right', () => {
        const html = renderDiff(computeLineDiff('a\nb\nc', 'a\nc', opts()), opts());

        assert.ok(html.text1.includes('class="line-removed"'), 'no removal on the left');
        assert.ok(!html.text2.includes('class="line-removed"'), 'removal leaked to the right');
    });

    test('a partially changed line renders word-level spans', () => {
        const html = renderDiff(computeLineDiff('the quick fox', 'the slow fox', opts()), opts());

        assert.ok(html.text1.includes('class="removed"'), 'no word-level removal');
        assert.ok(html.text2.includes('class="added"'), 'no word-level addition');
        // A word-level change must not also paint the whole line
        assert.ok(!html.text1.includes('line-removed'), 'line-level class on an inline change');
    });

    test('a large single-line pair renders end to end, not just diffs', () => {
        // computeLineDiff stops at a "changed" part; the token-level
        // allocation only happens once that part is rendered, so this has to
        // go all the way through renderDiff to exercise it.
        const words = series(6000, 'w');
        const line1 = words.join(' ');
        const line2 = [...words.slice(0, 3000), 'DIFFERENT', ...words.slice(3001)].join(' ');

        const html = renderDiff(computeLineDiff(line1, line2, opts()), opts());

        assert.ok(html.text1.length > 0 && html.text2.length > 0, 'nothing rendered');
        assert.ok(html.text2.includes('DIFFERENT'), 'the changed word is missing');
    });

    test('two large unrelated single lines degrade instead of throwing', () => {
        const line1 = series(6000, 'a').join(' ');
        const line2 = series(6000, 'b').join(' ');

        const parts = computeLineDiff(line1, line2, opts());
        const html = renderDiff(parts, opts());

        assert.ok(parts.length > 0, 'no diff parts produced');
        assert.ok(html.text1.length > 0, 'nothing rendered');
    });
});
