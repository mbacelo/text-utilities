/**
 * Barcode Scanner - DOM-free helpers.
 *
 * Geometry, result clean-up and the "seen it twice" confirmation used by
 * the camera loop. Nothing here touches the DOM or the decoder, so it is
 * tested directly under `node --test`.
 */

/**
 * Turn the decoder's raw results into what the page shows: one entry per
 * distinct code, in the order found, with a readable format label.
 * @param {Array<{text: string, format: string, isValid?: boolean}>} raw
 * @param {(format: string) => string} [toLabel] - e.g. "EAN13" -> "EAN-13"
 * @returns {Array<{text: string, format: string, label: string}>}
 */
export function normalizeResults(raw, toLabel = format => format) {
    const seen = new Set();
    const results = [];

    for (const { text, format, isValid } of raw ?? []) {
        if (!text || isValid === false) continue;

        const key = `${format}\u0000${text}`;
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({ text, format, label: safeLabel(toLabel, format) });
    }
    return results;
}

function safeLabel(toLabel, format) {
    try {
        return toLabel(format) || format;
    } catch {
        return format;
    }
}

/**
 * The first image in a paste or drop, or null. Clipboards often carry the
 * same picture in several flavours alongside text; any image will do.
 * @param {FileList|Array<{type: string}>|null|undefined} files
 * @returns {File|null}
 */
export function pickImageFile(files) {
    return Array.from(files ?? []).find(file => file.type?.startsWith('image/')) ?? null;
}

/**
 * Scale (width, height) down so the longer edge is at most maxEdge,
 * keeping the aspect ratio. Never scales up.
 * @param {number} width
 * @param {number} height
 * @param {number} maxEdge
 * @returns {{width: number, height: number}}
 */
export function fitWithin(width, height, maxEdge) {
    const longest = Math.max(width, height);
    if (longest <= maxEdge) {
        return { width, height };
    }
    const scale = maxEdge / longest;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
}

/**
 * Map the on-screen viewfinder to a rectangle in video pixels.
 *
 * The video is shown with `object-fit: cover`, so only a centred part of
 * each frame is visible; the viewfinder is a centred box covering
 * `box.width` x `box.height` of the visible area. Decoding just that
 * rectangle is what the user is aiming at, and is much cheaper than
 * decoding the whole frame.
 * @param {number} videoWidth - Intrinsic frame size
 * @param {number} videoHeight
 * @param {number} viewWidth - Size of the element showing it
 * @param {number} viewHeight
 * @param {{width: number, height: number}} box - Fractions of the view (0-1)
 * @param {number} [zoom] - Digital zoom: the video is scaled up by this
 *   much around its centre, so only 1/zoom of the visible part shows
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function viewfinderCrop(videoWidth, videoHeight, viewWidth, viewHeight, box, zoom = 1) {
    const scale = Math.max(viewWidth / videoWidth, viewHeight / videoHeight);
    const visibleWidth = Math.min(videoWidth, viewWidth / scale) / zoom;
    const visibleHeight = Math.min(videoHeight, viewHeight / scale) / zoom;

    const width = visibleWidth * box.width;
    const height = visibleHeight * box.height;

    return {
        x: Math.round((videoWidth - width) / 2),
        y: Math.round((videoHeight - height) / 2),
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height))
    };
}

/** Zoom levels offered when the page can only enlarge the picture itself. */
export const DIGITAL_ZOOM_LEVELS = [1, 2, 3];

/**
 * Candidate levels when the camera zooms for real; trimmed to its range.
 * Past 3x a hand-held phone shakes too much to scan, and four buttons are
 * all that fit beside the close button on a narrow phone.
 */
const HARDWARE_ZOOM_STEPS = [1, 2, 3];

/**
 * The zoom buttons to offer.
 * @param {{min: number, max: number}|null} range - The camera's own zoom
 *   range, or null when it has none and zoom is done digitally
 * @returns {number[]} Ascending, starting with the camera's widest view.
 *   That can be below 1 (0.5 on phones with an ultra wide lens), which
 *   also helps: ultra wide lenses usually focus closest.
 */
export function zoomLevels(range) {
    if (!range || !(range.max > range.min)) {
        return DIGITAL_ZOOM_LEVELS;
    }
    const steps = HARDWARE_ZOOM_STEPS.filter(level => level > range.min && level <= range.max);
    return [range.min, ...steps];
}

/**
 * The level to start at: 1x when offered, else the widest.
 * @param {number[]} levels
 * @returns {number}
 */
export function defaultZoom(levels) {
    return levels.includes(1) ? 1 : levels[0];
}

/**
 * The back camera to scan with when the phone offers a choice.
 *
 * iPhones list "virtual" cameras (Triple, Dual Wide, Dual) that switch
 * lenses on their own, as the Camera app does. Pro models cannot focus
 * closer than about 15 cm with the plain wide lens, so a close-up barcode
 * stays blurred unless one of these is used: they switch to the macro
 * capable ultra wide lens instead. Other devices have no such labels.
 * @param {Array<{label: string, deviceId: string}>} cameras
 * @returns {{label: string, deviceId: string}|null}
 */
export function preferredCamera(cameras) {
    for (const pattern of [/back triple camera/i, /back dual wide camera/i, /back dual camera/i]) {
        const camera = cameras.find(({ label }) => pattern.test(label));
        if (camera) return camera;
    }
    return null;
}

/**
 * A separately listed telephoto lens (iPhone: "Back Telephoto Camera").
 * @param {Array<{label: string, deviceId: string}>} cameras
 * @returns {{label: string, deviceId: string}|null}
 */
export function telephotoCamera(cameras) {
    return cameras.find(({ label }) => /telephoto/i.test(label)) ?? null;
}

/**
 * Accept a camera reading only once the same codes have been read in
 * `required` frames, so a single misread frame (a blurred 1D barcode
 * without a checksum, say) never reaches the user. Frames where nothing
 * was found are ignored rather than resetting the count: a shaky hand
 * drops frames between good ones.
 * @param {number} [required]
 * @returns {{push(results: Array<{text: string, format: string}>): (Array|null), reset(): void}}
 */
export function createConfirmer(required = 2) {
    let lastKey = null;
    let count = 0;

    return {
        push(results) {
            if (!results.length) return null;

            const key = results.map(({ format, text }) => `${format}\u0000${text}`).join('\u0001');
            count = key === lastKey ? count + 1 : 1;
            lastKey = key;
            return count >= required ? results : null;
        },
        reset() {
            lastKey = null;
            count = 0;
        }
    };
}
