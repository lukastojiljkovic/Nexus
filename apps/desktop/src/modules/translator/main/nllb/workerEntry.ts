/**
 * The translator worker's bundle path, as electron-vite resolves a `?modulePath`
 * import (`main/assistant/voice/workerEntry.ts` explains the arrangement). Kept
 * in a file of its own because nothing under Vitest resolves the suffix.
 */

import workerMainPath from "./workerMain.js?modulePath";

export const NLLB_WORKER_ENTRY: string = workerMainPath;
