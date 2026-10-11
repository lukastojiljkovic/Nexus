import { isOwnOrigin } from "../../../../shared/workerOrigin.js";
import { answerMoveRequest } from "./protocol.js";

/**
 * The cards AI worker (ADR-090 stage 2): the shell around `answerMoveRequest`.
 *
 * Three lines, because everything that could be wrong is in the protocol file —
 * what a request is, what it answers, what it refuses — and a worker's own
 * `onmessage` is the one part of this module that cannot be tested without a worker.
 *
 * **`isOwnOrigin` is the first statement, and it is the whole app's rule.** A
 * dedicated worker has exactly one client, so a message that did not come from this
 * document's origin is not this app's and is dropped rather than answered — the
 * shared check `modules/boards/renderer/ai/ai.worker.ts` established after a CodeQL
 * run, and every worker in the tree starts with it now.
 *
 * **Why the scope is declared by hand.** `self` in a TypeScript file compiled with
 * the DOM library is a `Window`, and the renderer's tsconfig has no `WebWorker`
 * library: rather than widen that project's `lib` for one file, the worker's own
 * shape is stated here — a `postMessage` and an `onmessage`, which is the whole of
 * what a dedicated worker's global scope is used for.
 */
interface WorkerScope {
  onmessage: ((event: { readonly data: unknown; readonly origin: string }) => void) | null;
  postMessage(message: unknown): void;
  readonly location: { readonly origin: string };
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  if (!isOwnOrigin(event.origin, scope.location.origin)) return;
  scope.postMessage(answerMoveRequest(event.data));
};
