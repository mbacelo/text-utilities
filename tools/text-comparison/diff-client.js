/**
 * Main-thread half of the diff worker: one comparison in flight at a time,
 * exposed as a promise.
 */

/** Raised on the pending comparison when a newer one takes its place. */
export class SupersededError extends Error {
    constructor() {
        super('Comparison superseded by a newer one');
        this.name = 'SupersededError';
    }
}

/**
 * Create a diff runner backed by a worker.
 * @returns {{run: (request: Object) => Promise<Object>, dispose: () => void}}
 */
export function createDiffClient() {
    let worker = null;
    let pending = null;

    /** Hand the outstanding promise to `settle`, then clear it. */
    function resolvePending(settle) {
        const current = pending;
        pending = null;
        if (current) settle(current);
    }

    /** Drop the worker entirely; the next run spawns a fresh one. */
    function discardWorker() {
        if (worker) {
            worker.terminate();
            worker = null;
        }
    }

    function spawn() {
        // import.meta.url keeps this correct no matter where the site is
        // mounted, so the tool works from a subdirectory on any static host.
        const spawned = new Worker(new URL('./diff-worker.js', import.meta.url), { type: 'module' });

        spawned.addEventListener('message', ({ data }) => {
            resolvePending(({ resolve, reject }) => {
                if (data.ok) {
                    resolve(data);
                } else {
                    reject(new Error(data.message));
                }
            });
        });

        spawned.addEventListener('error', event => {
            // Without this the failure also surfaces as an unhandled error
            event.preventDefault();
            // A worker that failed to load or crashed cannot be reused
            discardWorker();
            resolvePending(({ reject }) =>
                reject(new Error('The comparison worker failed to start.')));
        });

        return spawned;
    }

    return {
        run(request) {
            // Terminating is the only thing that actually stops a comparison
            // already burning CPU; ignoring its result would not.
            if (pending) {
                discardWorker();
                resolvePending(({ reject }) => reject(new SupersededError()));
            }

            if (!worker) worker = spawn();

            return new Promise((resolve, reject) => {
                pending = { resolve, reject };
                worker.postMessage(request);
            });
        },

        dispose() {
            discardWorker();
            resolvePending(({ reject }) => reject(new SupersededError()));
        }
    };
}
