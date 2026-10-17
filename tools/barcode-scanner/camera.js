/**
 * Barcode Scanner - camera.
 *
 * Owns the MediaStream and the scan loop. Each pass grabs just the
 * viewfinder part of the current frame and decodes it; the next pass is
 * only scheduled once that decode has finished, so slow devices never
 * build up a queue of frames.
 */

import { createConfirmer, viewfinderCrop } from './scan-logic.js';

/** Pause between decodes; plenty for a hand-held scan, easy on the battery. */
const SCAN_INTERVAL_MS = 80;

/** Back camera on phones, the default webcam elsewhere; 1D codes need pixels. */
const BASE_CONSTRAINTS = {
    width: { ideal: 1920 },
    height: { ideal: 1080 }
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
        const newStream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });

        if (current !== session) {
            // Stopped (or restarted) while the permission prompt was open
            newStream.getTracks().forEach(track => track.stop());
            return;
        }

        stream = newStream;
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

    function stop() {
        session++;
        confirmer.reset();
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
        video.srcObject = null;
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

        const currentId = stream?.getVideoTracks()[0]?.getSettings().deviceId;
        const index = cameras.findIndex(camera => camera.deviceId === currentId);
        await start(cameras[(index + 1) % cameras.length].deviceId);
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
            box);

        canvas.width = crop.width;
        canvas.height = crop.height;
        context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
        return context.getImageData(0, 0, crop.width, crop.height);
    }

    return {
        start,
        stop,
        switchCamera,
        listCameras,
        get active() { return stream !== null; }
    };
}
