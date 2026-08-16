import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { applyTemplate, convert, splitInput } from '../tools/line-converter/convert.js';

describe('splitInput', () => {
    test('splits on line breaks regardless of line-ending style', () => {
        assert.deepEqual(splitInput('a\nb\r\nc\rd', '\n'), ['a', 'b', 'c', 'd']);
    });

    test('splits on an arbitrary separator', () => {
        assert.deepEqual(splitInput('a, b, c', ', '), ['a', 'b', 'c']);
    });

    test('an empty separator yields the whole text, not every character', () => {
        assert.deepEqual(splitInput('abc', ''), ['abc']);
    });

    test('a separator that never occurs yields one item', () => {
        assert.deepEqual(splitInput('abc', ';'), ['abc']);
    });
});

describe('applyTemplate', () => {
    test('substitutes every placeholder', () => {
        assert.equal(applyTemplate('x', `'{text}'`), `'x'`);
        assert.equal(applyTemplate('x', '{text}-{text}'), 'x-x');
    });

    test('an empty template passes the item through', () => {
        assert.equal(applyTemplate('x', ''), 'x');
    });

    test('a template without the placeholder is a constant', () => {
        assert.equal(applyTemplate('x', 'fixed'), 'fixed');
    });

    test('an item containing the placeholder is not re-expanded', () => {
        // split/join, not replace: a literal "{text}" in the item must survive
        assert.equal(applyTemplate('{text}', '[{text}]'), '[{text}]');
    });
});

describe('convert', () => {
    test('turns lines into a comma-separated list', () => {
        const { output } = convert({ text: 'a\nb\nc', splitOn: '\n', joinWith: ',' });
        assert.equal(output, 'a,b,c');
    });

    test('converts back in the other direction', () => {
        const { output } = convert({ text: 'a,b,c', splitOn: ',', joinWith: '\n' });
        assert.equal(output, 'a\nb\nc');
    });

    test('trim strips whitespace around each item', () => {
        const { output } = convert({ text: ' a , b ', splitOn: ',', joinWith: ',', trim: true });
        assert.equal(output, 'a,b');
    });

    test('removeEmpty drops blank items', () => {
        const { items, output } = convert({
            text: 'a\n\nb\n', splitOn: '\n', joinWith: ',', removeEmpty: true
        });
        assert.deepEqual(items, ['a', 'b']);
        assert.equal(output, 'a,b');
    });

    test('trim runs before removeEmpty, so whitespace-only items are dropped', () => {
        const { items } = convert({
            text: 'a\n   \nb', splitOn: '\n', joinWith: ',', trim: true, removeEmpty: true
        });
        assert.deepEqual(items, ['a', 'b']);
    });

    test('without trim, a whitespace-only item survives removeEmpty', () => {
        const { items } = convert({
            text: 'a\n   \nb', splitOn: '\n', joinWith: ',', removeEmpty: true
        });
        assert.deepEqual(items, ['a', '   ', 'b']);
    });

    test('the template is applied to every item', () => {
        const { output } = convert({
            text: 'a\nb', splitOn: '\n', joinWith: ',', template: `'{text}'`
        });
        assert.equal(output, `'a','b'`);
    });

    test('reported item count matches what is joined', () => {
        const { items, output } = convert({
            text: 'a\nb\nc', splitOn: '\n', joinWith: ',', template: '<{text}>'
        });
        assert.equal(items.length, 3);
        assert.equal(output.split(',').length, items.length);
    });

    test('empty input is one empty item, or none when they are removed', () => {
        assert.deepEqual(convert({ text: '', splitOn: '\n', joinWith: ',' }).items, ['']);
        assert.deepEqual(
            convert({ text: '', splitOn: '\n', joinWith: ',', removeEmpty: true }).items, []);
    });
});
