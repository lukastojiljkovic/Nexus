import { AnalysisEngine, type AnalysisJob, type AnalysisReply } from "./analysis.js";

/**
 * The analysis worker: one `AnalysisEngine` and a `postMessage` around it.
 *
 * **Why this file is this thin.** The reading itself lives in `analysis.ts`, so
 * the page's fallback path and this thread run the same code (see that file's
 * header). All that is left for a worker to own is its own instance of the
 * engine — which is what lets the equivalent level accumulate — and the message
 * plumbing below.
 *
 * **Why the global is cast rather than referenced as `self`.** This module
 * compiles in the renderer's program, whose `lib` is the DOM: `self` there is a
 * `Window`, whose `postMessage` has a different signature from a dedicated
 * worker's. The project has no WebWorker lib on purpose (adding it would
 * redeclare half of the DOM program-wide), so the two-line cast is where those
 * two worlds are reconciled, and it is checked by nothing less than the fact
 * that a wrong `postMessage` here throws the first time a frame arrives.
 */
const worker = self as unknown as {
  onmessage: ((event: MessageEvent<AnalysisJob>) => void) | null;
  postMessage(message: AnalysisReply): void;
};

const engine = new AnalysisEngine();

worker.onmessage = (event) => {
  worker.postMessage(engine.run(event.data));
};
