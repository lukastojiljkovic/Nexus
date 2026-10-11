import CalculatorWorker from "./engine.worker?worker";
import type { EnginePort, EngineReply, EngineRequest } from "./engineClient.js";

/**
 * The ten lines that make a real worker, and the ONE file in this module that
 * names Vite's `?worker` import.
 *
 * **Why `?worker` rather than `new Worker(new URL("./engine.worker.ts",
 * import.meta.url))`.** Both are Vite idioms and they differ in what the built
 * app gets: the `new URL` form emits a module worker, and a module worker is
 * fetched with a module script request that a packaged `file://` page refuses by
 * origin. The `?worker` suffix emits the classic form this build's
 * `worker.format` names, which is the one an Electron renderer loading from disk
 * can actually start - and the app is loaded from disk in every shipped build.
 *
 * **Why the adapter rather than a raw `Worker` cast.** `engineClient.ts` is
 * tested against a `EnginePort` it is handed; this file is the only place that
 * knows the DOM's event shape, so the policy stays testable and the DOM stays
 * here.
 */
export function spawnCalculatorWorker(): EnginePort {
  const worker = new CalculatorWorker();
  return {
    postMessage(message: EngineRequest): void {
      worker.postMessage(message);
    },
    terminate(): void {
      worker.terminate();
    },
    onMessage(handler: (reply: EngineReply) => void): void {
      worker.onmessage = (event: MessageEvent<EngineReply>): void => {
        handler(event.data);
      };
    },
    onError(handler: (error: unknown) => void): void {
      // Assigned rather than added: the client sets both handlers exactly once
      // per worker it spawns, and a worker is never reused after a stop.
      worker.onerror = (event: ErrorEvent): void => {
        handler(event);
      };
    },
  };
}
