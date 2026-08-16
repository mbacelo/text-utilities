/**
 * Best-effort localStorage wrapper.
 *
 * Storage access throws outright in some contexts (Safari lockdown mode,
 * blocked cookies, private windows with a full quota), and the editor has
 * to keep working when it does - losing persistence is acceptable, losing
 * the editor is not.
 */

const WRITE_DEBOUNCE_MS = 300;

/**
 * @param {string} key - localStorage key to own
 * @returns {Object} Reader/writer for that key
 */
export function createStorage(key) {
    let timer = null;

    function write(value) {
        try {
            localStorage.setItem(key, value);
        } catch (error) {
            // Storage full or unavailable - nothing to do
        }
    }

    return {
        /** @returns {string|null} Stored value, or null if absent/unreadable */
        read() {
            try {
                return localStorage.getItem(key);
            } catch (error) {
                return null;
            }
        },

        write,

        /** Coalesce bursts of keystrokes into a single write. */
        writeDebounced(value) {
            clearTimeout(timer);
            timer = setTimeout(() => write(value), WRITE_DEBOUNCE_MS);
        }
    };
}
