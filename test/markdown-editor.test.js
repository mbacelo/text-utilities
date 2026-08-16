/**
 * Only the DOM-free parts of the editor are covered here. The modules under
 * test reach for browser globals (marked, DOMPurify, TurndownService) inside
 * their functions but never at import time, so importing them in Node is safe.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { countWords } from '../tools/markdown-editor/markdown.js';
import { wrapEmphasis } from '../tools/markdown-editor/turndown-rules.js';
import { translateScroll } from '../tools/markdown-editor/scroll-sync.js';

describe('countWords', () => {
    test('counts whitespace-separated words', () => {
        assert.equal(countWords('one two three'), 3);
    });

    test('collapses runs of whitespace', () => {
        assert.equal(countWords('one   two\n\nthree\t four'), 4);
    });

    test('empty and whitespace-only text count zero', () => {
        assert.equal(countWords(''), 0);
        assert.equal(countWords('   \n\t '), 0);
    });
});

describe('wrapEmphasis', () => {
    test('wraps the content in the given markers', () => {
        assert.equal(wrapEmphasis('bold', '**'), '**bold**');
    });

    test('keeps surrounding whitespace outside the markers', () => {
        // Markdown requires `**text**`, not `** text**`
        assert.equal(wrapEmphasis(' bold ', '**'), ' **bold** ');
        assert.equal(wrapEmphasis('\nbold\n', '*'), '\n*bold*\n');
    });

    test('whitespace-only content is left alone', () => {
        assert.equal(wrapEmphasis('   ', '**'), '   ');
        assert.equal(wrapEmphasis('', '**'), '');
    });

    test('inner whitespace is preserved', () => {
        assert.equal(wrapEmphasis(' two words ', '*'), ' *two words* ');
    });
});

describe('translateScroll', () => {
    const anchors = [
        { ed: 0, pv: 0 },
        { ed: 100, pv: 200 },
        { ed: 200, pv: 260 }
    ];

    test('maps the anchor points exactly', () => {
        assert.equal(translateScroll(anchors, 0, 'ed', 'pv'), 0);
        assert.equal(translateScroll(anchors, 100, 'ed', 'pv'), 200);
        assert.equal(translateScroll(anchors, 200, 'ed', 'pv'), 260);
    });

    test('interpolates between two anchors', () => {
        // Half way through a segment that maps 100px of editor to 200px of preview
        assert.equal(translateScroll(anchors, 50, 'ed', 'pv'), 100);
        // The next segment is compressed, not stretched
        assert.equal(translateScroll(anchors, 150, 'ed', 'pv'), 230);
    });

    test('translates in the reverse direction too', () => {
        assert.equal(translateScroll(anchors, 200, 'pv', 'ed'), 100);
        assert.equal(translateScroll(anchors, 100, 'pv', 'ed'), 50);
    });

    test('a position past the last anchor falls back to the outer segment', () => {
        // Never NaN, never a throw - the pane just lands at an extreme
        const result = translateScroll(anchors, 10000, 'ed', 'pv');
        assert.ok(Number.isFinite(result), `expected a finite offset, got ${result}`);
    });

    test('a zero-height segment does not divide by zero', () => {
        const degenerate = [{ ed: 0, pv: 0 }, { ed: 0, pv: 50 }];
        assert.equal(translateScroll(degenerate, 0, 'ed', 'pv'), 0);
    });
});
