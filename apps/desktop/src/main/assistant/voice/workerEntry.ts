/**
 * The three lines that turn `worker.ts` into a file the app can start.
 *
 * electron-vite resolves an import ending in `?modulePath` into the path of a
 * separately emitted bundle for that module, which is the only way a
 * `utilityProcess` has something to run: the main bundle is one file and the
 * worker cannot be a function inside it. The import is kept in a module of its
 * own so that the build-time magic is one line away from everything that can be
 * tested — nothing under Vitest resolves `?modulePath`, and nothing needs to.
 */

import workerEntryPath from "./worker.js?modulePath";

/** The built voice worker's absolute path, as electron-vite resolved it. */
export const VOICE_WORKER_ENTRY: string = workerEntryPath;
