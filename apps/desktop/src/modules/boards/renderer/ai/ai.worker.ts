import { answerMoveRequest } from "./protocol.js";

/**
 * The AI worker (ADR-090 stage 2): the shell around `answerMoveRequest`.
 *
 * Three lines, because everything that could be wrong is in the protocol file —
 * what a request is, what it answers, what it refuses — and a worker's own
 * `onmessage` is the one part of this module that cannot be tested without a
 * worker. What is left here is the two globals and nothing else.
 *
 * **Why the scope is declared by hand.** `self` in a TypeScript file compiled
 * with the DOM library is a `Window`, and the renderer's tsconfig has no
 * `WebWorker` library: rather than widen that project's `lib` for one file, the
 * worker's own shape is stated here — a `postMessage` and an `onmessage`, which
 * is the whole of what a dedicated worker's global scope is used for.
 */
interface WorkerScope {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  scope.postMessage(answerMoveRequest(event.data));
};
