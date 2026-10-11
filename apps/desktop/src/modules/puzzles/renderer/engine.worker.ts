import { runEngineRequest, stageOf, type EngineClientMessage } from "./engine.js";

/**
 * The module's worker entry point (ADR-090): the one file that touches the
 * worker's global scope.
 *
 * **It does nothing but carry a message across.** The work is `runEngineRequest`,
 * which is a pure function of its request and is therefore readable, testable and
 * free of globals; this file's whole job is that a worker has no `document`, no
 * React and no copy table, so anything more here would be logic in the one place
 * nothing can look at.
 *
 * **Why the global is typed by hand.** Vite compiles this file inside the
 * renderer's own project, where `self` is a `Window` whose `postMessage` takes a
 * target origin — neither of which is true in a worker. Rather than pull a second
 * lib into a project that also has the DOM (the two declare the same names and
 * disagree), the two members this file uses are named here, which is also the
 * statement of how little of the scope it touches.
 */

interface WorkerScope {
  addEventListener(type: "message", listener: (event: { data: EngineClientMessage }) => void): void;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type !== "request") return;
  try {
    // The stage goes first, and it is a code rather than a sentence: the page is
    // what knows the language, and a worker that built a message would be a
    // second copy table that no locale switch reaches.
    scope.postMessage({ type: "stage", id: message.id, stage: stageOf(message.request) });
    scope.postMessage({
      type: "result",
      id: message.id,
      response: runEngineRequest(message.request),
    });
  } catch (error) {
    scope.postMessage({
      type: "error",
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
