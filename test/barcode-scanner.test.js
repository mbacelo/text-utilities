import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    createConfirmer, fitWithin, normalizeResults, pickImageFile, viewfinderCrop
} from '../tools/barcode-scanner/scan-logic.js';

const EAN = { text: '5901234123457', format: 'EAN13' };
const QR = { text: 'https://example.com', format: 'QRCode' };

describe('normalizeResults', () => {
    test('keeps text and format and adds a label', () => {
        const labels = { EAN13: 'EAN-13' };
        assert.deepEqual(
            normalizeResults([{ ...EAN, isValid: true, symbology: 'EANUPC' }], f => labels[f]),
            [{ text: '5901234123457', format: 'EAN13', label: 'EAN-13' }]);
    });

    test('falls back to the format when there is no label', () => {
        assert.equal(normalizeResults([QR], () => '')[0].label, 'QRCode');
        assert.equal(normalizeResults([QR], () => { throw new Error('unknown'); })[0].label, 'QRCode');
    });

    test('drops empty and invalid results', () => {
        const raw = [{ text: '', format: 'QRCode' }, { ...EAN, isValid: false }, QR];
        assert.deepEqual(normalizeResults(raw).map(r => r.text), [QR.text]);
    });

    test('drops duplicates but keeps the same text in different formats', () => {
        const raw = [EAN, QR, EAN, { text: EAN.text, format: 'Code128' }];
        assert.deepEqual(normalizeResults(raw).map(r => r.format), ['EAN13', 'QRCode', 'Code128']);
    });

    test('nothing in, nothing out', () => {
        assert.deepEqual(normalizeResults([]), []);
        assert.deepEqual(normalizeResults(undefined), []);
    });
});

describe('pickImageFile', () => {
    test('returns the first image', () => {
        const png = { type: 'image/png' };
        assert.equal(pickImageFile([{ type: 'text/plain' }, png, { type: 'image/jpeg' }]), png);
    });

    test('returns null when there is no image', () => {
        assert.equal(pickImageFile([{ type: 'text/html' }]), null);
        assert.equal(pickImageFile([]), null);
        assert.equal(pickImageFile(null), null);
    });

    test('tolerates files without a type', () => {
        assert.equal(pickImageFile([{}]), null);
    });
});

describe('fitWithin', () => {
    test('leaves small images alone', () => {
        assert.deepEqual(fitWithin(800, 600, 2400), { width: 800, height: 600 });
        assert.deepEqual(fitWithin(2400, 100, 2400), { width: 2400, height: 100 });
    });

    test('scales the longer edge down, keeping the aspect ratio', () => {
        assert.deepEqual(fitWithin(4032, 3024, 2400), { width: 2400, height: 1800 });
        assert.deepEqual(fitWithin(3024, 4032, 2400), { width: 1800, height: 2400 });
    });

    test('never rounds a side down to zero', () => {
        assert.deepEqual(fitWithin(10000, 1, 100), { width: 100, height: 1 });
    });
});

describe('viewfinderCrop', () => {
    const box = { width: 0.8, height: 0.5 };

    test('same aspect ratio: the box maps straight onto the frame', () => {
        assert.deepEqual(viewfinderCrop(1600, 1200, 400, 300, box),
            { x: 160, y: 300, width: 1280, height: 600 });
    });

    test('a wide frame in a 4:3 view crops the hidden sides away', () => {
        // 1920x1080 under cover in 400x300: visible part is 1440x1080
        assert.deepEqual(viewfinderCrop(1920, 1080, 400, 300, box),
            { x: 384, y: 270, width: 1152, height: 540 });
    });

    test('a tall phone frame in a 3:4 view crops top and bottom', () => {
        // 1080x1920 under cover in 300x400: visible part is 1080x1440
        assert.deepEqual(viewfinderCrop(1080, 1920, 300, 400, box),
            { x: 108, y: 600, width: 864, height: 720 });
    });

    test('the crop stays inside the frame', () => {
        const crop = viewfinderCrop(640, 480, 1000, 200, { width: 1, height: 1 });
        assert.ok(crop.x >= 0 && crop.y >= 0);
        assert.ok(crop.x + crop.width <= 640 && crop.y + crop.height <= 480);
    });
});

describe('createConfirmer', () => {
    test('needs the same reading twice', () => {
        const confirmer = createConfirmer();
        assert.equal(confirmer.push([EAN]), null);
        assert.deepEqual(confirmer.push([EAN]), [EAN]);
    });

    test('a different reading starts the count again', () => {
        const confirmer = createConfirmer();
        confirmer.push([EAN]);
        assert.equal(confirmer.push([QR]), null);
        assert.deepEqual(confirmer.push([QR]), [QR]);
    });

    test('empty frames in between do not reset the count', () => {
        const confirmer = createConfirmer();
        confirmer.push([EAN]);
        assert.equal(confirmer.push([]), null);
        assert.deepEqual(confirmer.push([EAN]), [EAN]);
    });

    test('reset forgets the previous reading', () => {
        const confirmer = createConfirmer();
        confirmer.push([EAN]);
        confirmer.reset();
        assert.equal(confirmer.push([EAN]), null);
    });

    test('required = 1 accepts the first reading', () => {
        assert.deepEqual(createConfirmer(1).push([QR]), [QR]);
    });
});
