/**
 * Barcode Scanner - decoding.
 *
 * Wraps the vendored zxing-wasm reader (global `ZXingWASM`, loaded by a
 * classic <script> before this module). Every input ends up as ImageData
 * and goes through the same readBarcodes() call: camera frames directly,
 * image files after the browser has decoded them onto a canvas.
 */

import { fitWithin, normalizeResults } from './scan-logic.js';

const ZXing = globalThis.ZXingWASM;

/** Longest edge an image is decoded at; phone photos are scaled down to it. */
const MAX_IMAGE_EDGE = 2400;

/**
 * White border added around images, as a fraction of the longer edge.
 * Barcodes need a light "quiet zone" around them, and a tightly cropped
 * screenshot often has none.
 */
const QUIET_ZONE = 0.05;

/** Raised when the browser cannot open an image file (e.g. HEIC on desktop). */
export class ImageOpenError extends Error {}

/**
 * Starts fetching and compiling the wasm right away, from vendor/ rather
 * than the CDN the library defaults to, so nothing leaves the site.
 */
export const ready = ZXing.prepareZXingModule({
    overrides: {
        locateFile: (path, prefix) => path.endsWith('.wasm')
            ? new URL('vendor/zxing_reader.wasm', import.meta.url).href
            : prefix + path
    },
    fireImmediately: true
});

/**
 * @param {ImageData} imageData
 * @param {Object} [options]
 * @param {number} [options.maxSymbols] - Stop after this many codes
 * @returns {Promise<Array<{text: string, format: string, label: string}>>}
 */
export async function decodeImageData(imageData, { maxSymbols = 8 } = {}) {
    await ready;
    const raw = await ZXing.readBarcodes(imageData, { maxNumberOfSymbols: maxSymbols });
    return normalizeResults(raw, ZXing.formatToLabel);
}

/**
 * Decode every barcode in an image file.
 * @param {Blob} file
 * @returns {Promise<Array<{text: string, format: string, label: string}>>}
 * @throws {ImageOpenError} When the browser cannot open the image
 */
export async function decodeImageFile(file) {
    const bitmap = await openImage(file);
    try {
        return await decodeImageData(rasterize(bitmap));
    } finally {
        bitmap.close();
    }
}

/**
 * Let the browser decode the file: it handles every format it can display
 * and applies EXIF rotation, which matters for phone photos.
 * @param {Blob} file
 * @returns {Promise<ImageBitmap>}
 * @throws {ImageOpenError}
 */
async function openImage(file) {
    try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        // Engines that predate the 'from-image' value reject the option
        // itself; they still decode the image without it
    }
    try {
        return await createImageBitmap(file);
    } catch (error) {
        throw new ImageOpenError('Could not open the image', { cause: error });
    }
}

/**
 * Draw the bitmap onto white with a quiet zone around it. White matters:
 * transparent pixels read back as black, which hides black-on-transparent
 * barcodes entirely.
 * @param {ImageBitmap} bitmap
 * @returns {ImageData}
 */
function rasterize(bitmap) {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_EDGE);
    const margin = Math.round(Math.max(width, height) * QUIET_ZONE);

    const canvas = document.createElement('canvas');
    canvas.width = width + margin * 2;
    canvas.height = height + margin * 2;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, margin, margin, width, height);
    return context.getImageData(0, 0, canvas.width, canvas.height);
}
