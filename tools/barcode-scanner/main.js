/**
 * Barcode Scanner - page wiring.
 *
 * Three ways in, one way out: the camera, an uploaded or dropped file, and
 * a pasted image all end in showResults(). Decoding lives in decoder.js,
 * the camera and its scan loop in camera.js.
 */

import { createScanner, hasCameraPermission, isCameraSupported } from './camera.js';
import { ImageOpenError, decodeImageData, decodeImageFile, ready } from './decoder.js';
import { pickImageFile } from './scan-logic.js';

/** The aiming box, as fractions of the camera view. Also sizes the overlay. */
const VIEWFINDER = { width: 0.8, height: 0.5 };

const VIBRATE_MS = 80;

const ELEMENT_IDS = [
    'resultPanel', 'resultList', 'copyStatus', 'message',
    'cameraPanel', 'video', 'viewfinder', 'switchBtn', 'stopBtn',
    'startPanel', 'scanBtn', 'dropZone', 'fileInput', 'cameraNote'
];

const els = Object.fromEntries(
    ELEMENT_IDS.map(id => [id, document.getElementById(id)])
);

const scanner = createScanner({
    video: els.video,
    box: VIEWFINDER,
    // One code is enough from a camera, and stopping at it is faster
    decode: frame => decodeImageData(frame, { maxSymbols: 1 }),
    onResult(results) {
        navigator.vibrate?.(VIBRATE_MS);
        showCamera(false);
        showResults(results);
    }
});

// Bumped by every new input, so a slow image decode that finishes after
// the user has moved on is dropped instead of overwriting the newer result
let inputRun = 0;

/**
 * @param {string} text - Empty hides the message
 * @param {'error'|'info'} [kind]
 */
function setMessage(text, kind = 'error') {
    els.message.textContent = text;
    els.message.hidden = !text;
    els.message.classList.toggle('is-info', kind === 'info');
}

/** The camera view replaces the start buttons while it is open. */
function showCamera(visible) {
    els.cameraPanel.hidden = !visible;
    els.startPanel.hidden = visible;
}

function clearResults() {
    els.resultPanel.hidden = true;
    els.resultList.replaceChildren();
    els.copyStatus.textContent = '';
}

// =====================
// Results & clipboard
// =====================

function showResults(results) {
    setMessage('');
    els.resultList.replaceChildren(...results.map(renderResult));
    els.resultPanel.hidden = false;

    if (results.length === 1) {
        copyText(results[0].text, { automatic: true });
    } else {
        els.copyStatus.textContent = `${results.length} codes found`;
    }
}

function renderResult({ text, label }) {
    const item = document.createElement('li');
    item.className = 'result-item';

    const format = document.createElement('span');
    format.className = 'result-format';
    format.textContent = label;

    const value = document.createElement('p');
    value.className = 'result-text';
    value.textContent = text;

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'text-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => copyText(text));

    item.append(format, value, copyBtn);
    return item;
}

/**
 * @param {string} text
 * @param {Object} [options]
 * @param {boolean} [options.automatic] - Not triggered by a click. Some
 *   browsers (Safari, Firefox) only allow clipboard writes straight after
 *   one, so a refusal here is expected and the user is pointed at Copy.
 */
async function copyText(text, { automatic = false } = {}) {
    try {
        await navigator.clipboard.writeText(text);
        els.copyStatus.textContent = 'Copied to clipboard';
    } catch {
        els.copyStatus.textContent = automatic ? 'Tap Copy to copy it' : 'Copy failed';
    }
}

// =====================
// Camera
// =====================

function cameraErrorMessage(error) {
    switch (error?.name) {
        case 'NotAllowedError':
        case 'SecurityError':
            return 'Camera access was blocked. Allow it in your browser’s site settings, or upload a photo instead.';
        case 'NotFoundError':
        case 'OverconstrainedError':
            return 'No camera was found. You can upload a photo instead.';
        case 'NotReadableError':
            return 'The camera is being used by another app.';
        default:
            return 'The camera could not be started.';
    }
}

async function startCamera() {
    inputRun++;
    setMessage('');
    clearResults();
    els.switchBtn.hidden = true;
    showCamera(true);

    try {
        await scanner.start();
        if (!scanner.active) return;
        const cameras = await scanner.listCameras();
        els.switchBtn.hidden = cameras.length < 2;
    } catch (error) {
        showCamera(false);
        setMessage(cameraErrorMessage(error));
    }
}

function stopCamera() {
    scanner.stop();
    showCamera(false);
}

async function switchCamera() {
    try {
        await scanner.switchCamera();
    } catch (error) {
        stopCamera();
        setMessage(cameraErrorMessage(error));
    }
}

// =====================
// Images
// =====================

async function readImage(file) {
    const run = ++inputRun;
    stopCamera();
    clearResults();
    setMessage('Reading image…', 'info');

    try {
        const results = await decodeImageFile(file);
        if (run !== inputRun) return;

        if (results.length) {
            showResults(results);
        } else {
            setMessage('No barcode found in this image. Try a sharper photo, closer to the code.');
        }
    } catch (error) {
        if (run !== inputRun) return;

        if (error instanceof ImageOpenError) {
            setMessage('This image could not be opened. Try a PNG or JPEG.');
        } else {
            console.error(error);
            setMessage('Something went wrong while reading the image.');
        }
    }
}

function onFileChosen() {
    const file = els.fileInput.files[0];
    // Reset, so choosing the same file again still fires `change`
    els.fileInput.value = '';
    if (file) readImage(file);
}

function onPaste(event) {
    const file = pickImageFile(event.clipboardData?.files);
    if (!file) {
        setMessage('There is no image on the clipboard. Copy a screenshot or picture, then paste again.');
        return;
    }
    event.preventDefault();
    readImage(file);
}

// Drops are accepted anywhere on the page: a near miss of the drop zone
// would otherwise make the browser navigate away to the image
function onDragOver(event) {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    els.dropZone.classList.add('is-dragging');
}

function onDragLeave(event) {
    // relatedTarget is null once the pointer has left the window
    if (event.relatedTarget === null) {
        els.dropZone.classList.remove('is-dragging');
    }
}

function onDrop(event) {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    els.dropZone.classList.remove('is-dragging');

    const file = pickImageFile(event.dataTransfer.files);
    if (file) {
        readImage(file);
    } else {
        setMessage('That is not an image. Drop a PNG, JPEG or other picture.');
    }
}

// =====================
// Setup
// =====================

els.viewfinder.style.width = `${VIEWFINDER.width * 100}%`;
els.viewfinder.style.height = `${VIEWFINDER.height * 100}%`;

els.scanBtn.addEventListener('click', startCamera);
els.stopBtn.addEventListener('click', stopCamera);
els.switchBtn.addEventListener('click', switchCamera);
els.fileInput.addEventListener('change', onFileChosen);

document.addEventListener('paste', onPaste);
document.addEventListener('dragover', onDragOver);
document.addEventListener('dragleave', onDragLeave);
document.addEventListener('drop', onDrop);

// Release the camera when the page is hidden; leaving it on drains the
// battery and keeps the camera light on
document.addEventListener('visibilitychange', () => {
    if (document.hidden && !els.cameraPanel.hidden) stopCamera();
});
window.addEventListener('pagehide', () => scanner.stop());

ready.catch(error => {
    console.error('Loading the barcode reader failed', error);
    setMessage('The barcode reader failed to load. Reload the page to try again.');
});

if (!isCameraSupported()) {
    els.scanBtn.hidden = true;
    els.cameraNote.hidden = false;
    els.cameraNote.textContent = window.isSecureContext
        ? 'This browser has no camera access. You can still read barcodes from images.'
        : 'The camera needs a secure connection (https:// or localhost). You can still read barcodes from images.';
} else if (matchMedia('(pointer: coarse)').matches && await hasCameraPermission()) {
    // On a phone that already allowed the camera, opening the page is
    // enough: go straight to scanning
    startCamera();
}
