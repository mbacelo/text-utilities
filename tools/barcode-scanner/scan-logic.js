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
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function viewfinderCrop(videoWidth, videoHeight, viewWidth, viewHeight, box) {
    const scale = Math.max(viewWidth / videoWidth, viewHeight / videoHeight);
    const visibleWidth = Math.min(videoWidth, viewWidth / scale);
    const visibleHeight = Math.min(videoHeight, viewHeight / scale);

    const width = visibleWidth * box.width;
    const height = visibleHeight * box.height;

    return {
        x: Math.round((videoWidth - width) / 2),
        y: Math.round((videoHeight - height) / 2),
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height))
    };
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
