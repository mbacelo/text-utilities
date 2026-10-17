/**
 * Barcode Scanner - camera.
 *
 * Owns the MediaStream, zoom and the scan loop. Each pass grabs just the
 * viewfinder part of the current frame and decodes it; the next pass is
 * only scheduled once that decode has finished, so slow devices never
 * build up a queue of frames.
 *
 * Zoom is real where the browser exposes it (Chrome on Android, where the
 * phone may also switch to its telephoto lens) and digital elsewhere
 * (Safari, most webcams): the video is scaled up on screen and the
 * viewfinder crop shrinks with it. Digital zoom adds no detail of its own,
 * which is why a high resolution is requested: zoomed in, the crop is
 * still made of real camera pixels.
 */

import { createConfirmer, defaultZoom, fitWithin, viewfinderCrop, zoomLevels } from './scan-logic.js';

/** Pause between decodes; plenty for a hand-held scan, easy on the battery. */
const SCAN_INTERVAL_MS = 80;

/**
 * Viewfinder crops are scaled down to this before decoding, so a high
 * resolution stream at 1x zoom costs no more to decode than a small one.
 */
const MAX_FRAME_EDGE = 2048;

/** High resolution, for digital zoom; the browser picks the nearest it has. */
const BASE_CONSTRAINTS = {
    width: { ideal: 2560 },
    height: { ideal: 1440 }
};

/** True when this page is allowed to ask for the camera at all. */
export function isCameraSupported() {
    return window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * Whether camera access was already granted, so starting will not prompt.
 * Firefox does not know the "camera" permission name and throws.
 * @returns {Promise<boolean>}
 */
export async function hasCameraPermission() {
    try {
        const status = await navigator.permissions.query({ name: 'camera' });
        return status.state === 'granted';
    } catch {
        return false;
    }
}

/**
 * @param {Object} config
 * @param {HTMLVideoElement} config.video
 * @param {{width: number, height: number}} config.box - Viewfinder, as fractions of the video element
 * @param {(imageData: ImageData) => Promise<Array>} config.decode
 * @param {(results: Array) => void} config.onResult - Called once; the camera is already stopped
 */
export function createScanner({ video, box, decode, onResult }) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const confirmer = createConfirmer();

    let stream = null;
    let track = null;
    // The camera's own zoom range, or null when zoom is digital
    let hardwareZoom = null;
    let digitalZoom = 1;
    let zoom = 1;
    // Bumped by every start and stop, so a loop left over from an earlier
    // session notices and exits instead of reporting stale results
    let session = 0;

    /**
     * @param {string} [deviceId] - A specific camera; otherwise the back one
     */
    async function start(deviceId) {
        stop();
        const current = session;

        const constraints = deviceId
            ? { ...BASE_CONSTRAINTS, deviceId: { exact: deviceId } }
            : { ...BASE_CONSTRAINTS, facingMode: { ideal: 'environment' } };
        // Chrome only exposes zoom once it has been asked for up front
        if (navigator.mediaDevices.getSupportedConstraints?.().zoom) {
            constraints.zoom = true;
        }
        const newStream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });

        if (current !== session) {
            // Stopped (or restarted) while the permission prompt was open
            newStream.getTracks().forEach(t => t.stop());
            return;
        }

        stream = newStream;
        track = stream.getVideoTracks()[0];
        await setUpTrack();

        video.srcObject = stream;
        try {
            await video.play();
        } catch (error) {
            // A stop() while play() was pending interrupts it; that is not a failure
            if (current !== session) return;
            throw error;
        }
        scanLoop(current);
    }

    /** Read what the camera can do, and ask for continuous focus. */
    async function setUpTrack() {
        const capabilities = track.getCapabilities?.() ?? {};

        const range = capabilities.zoom;
        hardwareZoom = range && range.max > range.min ? { min: range.min, max: range.max } : null;
        zoom = hardwareZoom ? track.getSettings().zoom ?? defaultZoom(zoomLevels(hardwareZoom)) : 1;
        setDigitalZoom(1);

        if (capabilities.focusMode?.includes('continuous')) {
            try {
                await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
            } catch {
                // Not worth failing the camera over
            }
        }
    }

    function stop() {
        session++;
        confirmer.reset();
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
            track = null;
        }
        video.srcObject = null;
        setDigitalZoom(1);
    }

    /**
     * @param {number} level - One of zoomInfo().levels
     */
    async function setZoom(level) {
        if (!track) return;
        confirmer.reset();

        if (hardwareZoom) {
            await track.applyConstraints({ advanced: [{ zoom: level }] });
            zoom = level;
        } else {
            setDigitalZoom(level);
            zoom = level;
        }
    }

    function setDigitalZoom(level) {
        digitalZoom = level;
        video.style.transform = level === 1 ? '' : `scale(${level})`;
    }

    /** @returns {{levels: number[], value: number, hardware: boolean}} */
    function zoomInfo() {
        return { levels: zoomLevels(hardwareZoom), value: zoom, hardware: Boolean(hardwareZoom) };
    }

    /** Video inputs, labelled once permission has been granted. */
    async function listCameras() {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter(device => device.kind === 'videoinput');
    }

    /** Move on to the next camera in the list, wrapping around. */
    async function switchCamera() {
        const cameras = await listCameras();
        if (cameras.length < 2) return;

        const index = cameras.findIndex(camera => camera.deviceId === deviceId());
        await start(cameras[(index + 1) % cameras.length].deviceId);
    }

    function deviceId() {
        return track?.getSettings().deviceId ?? null;
    }

    async function scanLoop(current) {
        while (current === session) {
            if (video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth) {
                const frame = grabViewfinder();
                let results = [];
                try {
                    results = await decode(frame);
                } catch (error) {
                    console.error('Decoding a camera frame failed', error);
                }
                if (current !== session) return;

                const confirmed = confirmer.push(results);
                if (confirmed) {
                    stop();
                    onResult(confirmed);
                    return;
                }
            }
            await new Promise(resolve => setTimeout(resolve, SCAN_INTERVAL_MS));
        }
    }

    function grabViewfinder() {
        const crop = viewfinderCrop(
            video.videoWidth, video.videoHeight,
            video.clientWidth || video.videoWidth, video.clientHeight || video.videoHeight,
            box, digitalZoom);
        const { width, height } = fitWithin(crop.width, crop.height, MAX_FRAME_EDGE);

        canvas.width = width;
        canvas.height = height;
        context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
        return context.getImageData(0, 0, width, height);
    }

    return {
        start,
        stop,
        switchCamera,
        listCameras,
        setZoom,
        zoomInfo,
        deviceId,
        get active() { return stream !== null; }
    };
}
