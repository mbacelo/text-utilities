/**
 * Barcode Scanner - page wiring.
 *
 * Three ways in, one way out: the camera, an uploaded or dropped file, and
 * a pasted image all end in showResults(). Decoding lives in decoder.js,
 * the camera and its scan loop in camera.js.
 */

import { createStorage } from '../../shared/storage.js';
import { createScanner, hasCameraPermission, isCameraSupported } from './camera.js';
import { ImageOpenError, decodeImageData, decodeImageFile, ready } from './decoder.js';
import { pickImageFile, preferredCamera, telephotoCamera } from './scan-logic.js';

/** The aiming box, as fractions of the camera view. Also sizes the overlay. */
const VIEWFINDER = { width: 0.8, height: 0.5 };

const VIBRATE_MS = 80;

/** How long a Copy button says "Copied" before going back to "Copy". */
const COPIED_MS = 2000;

const ELEMENT_IDS = [
    'resultPanel', 'resultList', 'resultTemplate', 'copyStatus', 'message',
    'cameraPanel', 'video', 'viewfinder', 'zoomBar', 'switchBtn', 'stopBtn',
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

// The last camera and zoom used, so the next visit starts where this one
// left off (a phone's best lens, a zoom that suits the user's barcodes)
const cameraStore = createStorage('barcode-scanner-camera');
const zoomStore = createStorage('barcode-scanner-zoom');

// Bumped by every new input, so a slow image decode that finishes after
// the user has moved on is dropped instead of overwriting the newer result
let inputRun = 0;

// Video inputs, refreshed whenever the camera starts (labels need permission)
let cameras = [];
// The camera to go back to when leaving the telephoto lens
let mainCameraId = null;

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
    setCopyStatus('');
}

// =====================
// Results & clipboard
// =====================

function showResults(results) {
    setMessage('');
    els.resultList.replaceChildren(...results.map(renderResult));
    els.resultPanel.hidden = false;

    if (results.length === 1) {
        const copyBtn = els.resultList.querySelector('.copy-btn');
        copyText(results[0].text, copyBtn, { automatic: true });
    } else {
        setCopyStatus(`${results.length} codes found`);
    }
}

function renderResult({ text, label }) {
    const item = els.resultTemplate.content.firstElementChild.cloneNode(true);
    item.querySelector('.result-text').textContent = text;
    item.querySelector('.result-format').textContent = label;

    const copyBtn = item.querySelector('.copy-btn');
    copyBtn.setAttribute('aria-label', `Copy ${text}`);
    copyBtn.addEventListener('click', () => copyText(text, copyBtn));
    return item;
}

/**
 * @param {string} text
 * @param {HTMLButtonElement} button - Shows "Copied" for a moment on success
 * @param {Object} [options]
 * @param {boolean} [options.automatic] - Not triggered by a click. Some
 *   browsers (Safari, Firefox) only allow clipboard writes straight after
 *   one, so a refusal here is expected and the user is pointed at Copy.
 */
async function copyText(text, button, { automatic = false } = {}) {
    try {
        await navigator.clipboard.writeText(text);
        // The button already says "Copied"; the status is for screen readers
        setCopyStatus('Copied to clipboard', { visible: false });
        showCopied(button);
    } catch {
        setCopyStatus(automatic ? 'Tap Copy to copy it' : 'Copy failed');
    }
}

function setCopyStatus(text, { visible = true } = {}) {
    els.copyStatus.textContent = text;
    els.copyStatus.classList.toggle('sr-only', !visible);
}

function showCopied(button) {
    const label = button.querySelector('.copy-label');
    button.classList.add('is-copied');
    label.textContent = 'Copied';

    clearTimeout(button.copiedTimer);
    button.copiedTimer = setTimeout(() => {
        button.classList.remove('is-copied');
        label.textContent = 'Copy';
    }, COPIED_MS);
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
    els.zoomBar.hidden = true;
    showCamera(true);

    try {
        const savedId = cameraStore.read();
        await openCamera(savedId);
        if (!scanner.active) return;

        cameras = await scanner.listCameras();
        // First time on a phone with lens-switching virtual cameras: move
        // to the one that can focus close (see preferredCamera)
        const preferred = preferredCamera(cameras);
        if (!savedId && preferred && preferred.deviceId !== scanner.deviceId()) {
            await scanner.start(preferred.deviceId);
            if (!scanner.active) return;
        }

        mainCameraId = isTelephoto(scanner.deviceId()) ? preferred?.deviceId ?? null : scanner.deviceId();
        els.switchBtn.hidden = cameras.length < 2;
        rememberCamera();
        await restoreZoom();
        renderZoom();
    } catch (error) {
        showCamera(false);
        setMessage(cameraErrorMessage(error));
    }
}

/** Start a specific camera, falling back to the default one if it is gone. */
async function openCamera(deviceId) {
    if (!deviceId) {
        await scanner.start();
        return;
    }
    try {
        await scanner.start(deviceId);
    } catch (error) {
        if (error.name !== 'OverconstrainedError' && error.name !== 'NotFoundError') throw error;
        await scanner.start();
    }
}

function stopCamera() {
    scanner.stop();
    showCamera(false);
}

async function switchCamera() {
    try {
        await scanner.switchCamera();
        if (!isTelephoto(scanner.deviceId())) mainCameraId = scanner.deviceId();
        rememberCamera();
        renderZoom();
    } catch (error) {
        stopCamera();
        setMessage(cameraErrorMessage(error));
    }
}

function rememberCamera() {
    const id = scanner.deviceId();
    if (id) cameraStore.writeDebounced(id);
}

// =====================
// Zoom
// =====================

function isTelephoto(deviceId) {
    return Boolean(deviceId) && telephotoCamera(cameras)?.deviceId === deviceId;
}

/**
 * A separate telephoto lens is offered only where the camera cannot zoom
 * itself: where it can (Android), zooming in already switches lens.
 */
function offeredTelephoto() {
    return scanner.zoomInfo().hardware ? null : telephotoCamera(cameras);
}

function formatZoom(level) {
    return `${Number(level.toFixed(1))}×`;
}

function renderZoom() {
    const { levels, value } = scanner.zoomInfo();
    const telephoto = offeredTelephoto();
    const onTelephoto = isTelephoto(scanner.deviceId());

    const chips = levels.map(level => zoomChip(
        formatZoom(level), `Zoom ${formatZoom(level)}`,
        !onTelephoto && level === value, () => chooseZoom(level)));
    if (telephoto) {
        chips.push(zoomChip('Tele', 'Telephoto lens', onTelephoto, chooseTelephoto));
    }

    els.zoomBar.replaceChildren(...chips);
    els.zoomBar.hidden = chips.length < 2;
}

function zoomChip(text, label, pressed, onClick) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'zoom-chip';
    chip.textContent = text;
    chip.setAttribute('aria-label', label);
    chip.setAttribute('aria-pressed', String(pressed));
    chip.addEventListener('click', onClick);
    return chip;
}

async function chooseZoom(level) {
    try {
        if (isTelephoto(scanner.deviceId())) {
            await openCamera(mainCameraId);
            rememberCamera();
        }
        await scanner.setZoom(level);
        zoomStore.writeDebounced(String(level));
    } catch (error) {
        console.error('Changing the zoom failed', error);
    }
    renderZoom();
}

async function chooseTelephoto() {
    try {
        if (isTelephoto(scanner.deviceId())) {
            await openCamera(mainCameraId);
        } else {
            await scanner.start(telephotoCamera(cameras).deviceId);
        }
        rememberCamera();
    } catch (error) {
        stopCamera();
        setMessage(cameraErrorMessage(error));
        return;
    }
    renderZoom();
}

/** Go back to the zoom used last time, if this camera offers it. */
async function restoreZoom() {
    const saved = Number(zoomStore.read());
    if (!saved || !scanner.zoomInfo().levels.includes(saved)) return;
    try {
        await scanner.setZoom(saved);
    } catch (error) {
        console.error('Restoring the zoom failed', error);
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
