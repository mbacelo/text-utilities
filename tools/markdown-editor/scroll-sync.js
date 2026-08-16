/**
 * Keeps the editor and preview panes aligned while either one scrolls.
 *
 * A plain scroll percentage drifts badly as soon as the two panes disagree
 * about how tall a block is (a code fence, a table, a wrapped paragraph).
 * Instead every top-level block contributes an anchor pairing its pixel
 * offset in the editor with its offset in the preview, and scrolling
 * interpolates between the two surrounding anchors.
 *
 * Measuring the editor side needs the pixel position of a given source
 * line inside a textarea, which the DOM will not report. A hidden mirror
 * element replicates the textarea's typography and width so each logical
 * line wraps identically and its offsetTop can be read directly.
 */

// Stands in for an empty line while measuring, so it occupies a full line
// box instead of collapsing to zero height. Spelled out rather than typed
// literally: an invisible character in the source is a trap for the next
// reader.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

/**
 * Interpolate a scroll offset from one pane into the other.
 * @param {Array<{ed: number, pv: number}>} anchors - Ascending anchor pairs
 * @param {number} position - scrollTop in the source pane
 * @param {'ed'|'pv'} from - Key of the source pane
 * @param {'ed'|'pv'} to - Key of the target pane
 * @returns {number} Equivalent scrollTop in the target pane
 */
export function translateScroll(anchors, position, from, to) {
    let lower = anchors[0];
    let upper = anchors[anchors.length - 1];

    for (let i = 0; i < anchors.length - 1; i++) {
        if (anchors[i][from] <= position && position <= anchors[i + 1][from]) {
            lower = anchors[i];
            upper = anchors[i + 1];
            break;
        }
    }

    const span = upper[from] - lower[from];
    const ratio = span === 0 ? 0 : (position - lower[from]) / span;
    return lower[to] + ratio * (upper[to] - lower[to]);
}

/** @param {HTMLElement} element @returns {boolean} scrolled to the bottom */
function isAtBottom(element) {
    return element.scrollTop >= element.scrollHeight - element.clientHeight - 2;
}

/**
 * @param {Object} panes
 * @param {HTMLTextAreaElement} panes.editor
 * @param {HTMLElement} panes.preview
 * @returns {Object} Sync controller for the pair
 */
export function createScrollSync({ editor, preview }) {
    const mirror = document.createElement('div');
    mirror.className = 'editor-mirror';
    mirror.setAttribute('aria-hidden', 'true');
    editor.parentElement.style.position = 'relative';
    editor.parentElement.appendChild(mirror);

    let anchors = [{ ed: 0, pv: 0 }];

    /** Match the mirror's typography and box to the textarea so that each
        logical line wraps identically and offsetTop lines up with scrollTop. */
    function syncMirrorStyles() {
        const computed = getComputedStyle(editor);
        for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
            'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom',
            'paddingLeft', 'boxSizing', 'tabSize']) {
            mirror.style[property] = computed[property];
        }
        // clientWidth excludes the border but includes padding, matching the
        // area the textarea actually wraps text in.
        mirror.style.width = `${editor.clientWidth}px`;
    }

    /**
     * Pixel offset of every source line inside the editor.
     * @returns {number[]} Offset per line, indexed by line number
     */
    function measureLines() {
        syncMirrorStyles();

        const fragment = document.createDocumentFragment();
        for (const line of editor.value.split('\n')) {
            const div = document.createElement('div');
            div.textContent = line === '' ? ZERO_WIDTH_SPACE : line;
            fragment.appendChild(div);
        }
        mirror.replaceChildren(fragment);

        return Array.from(mirror.children, child => child.offsetTop);
    }

    return {
        /** Re-measure both panes. Call after rendering or resizing. */
        rebuild() {
            const lineTops = measureLines();

            anchors = [{ ed: 0, pv: 0 }];
            for (const block of preview.querySelectorAll('.md-block')) {
                const line = Number(block.dataset.line);
                if (line < lineTops.length) {
                    anchors.push({ ed: lineTops[line], pv: block.offsetTop });
                }
            }
            anchors.push({ ed: editor.scrollHeight, pv: preview.scrollHeight });
        },

        fromEditor() {
            preview.scrollTop = isAtBottom(editor)
                ? preview.scrollHeight
                : translateScroll(anchors, editor.scrollTop, 'ed', 'pv');
        },

        fromPreview() {
            editor.scrollTop = isAtBottom(preview)
                ? editor.scrollHeight
                : translateScroll(anchors, preview.scrollTop, 'pv', 'ed');
        }
    };
}
