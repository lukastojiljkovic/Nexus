/**
 * The two browser adapters the page needs: a real `Worker` behind the
 * `Transport` seam, and the wall clock behind `IdleClock`.
 *
 * **Why the worker is created from a Vite import.** `?worker` is what makes the
 * bundler compile `bergamot.worker.ts` as a worker entry and hand back a
 * constructor; a hand-written `new Worker(new URL("…"))` would leave the engine's
 * `importScripts` and its wasm asset un-emitted. The worker is classic (Vite's
 * default format), which is what the engine harness needs.
 *
 * **Every message is validated before it is believed.** A worker's `message`
 * event carries `unknown`; `isWorkerReply` is the one place that decides what a
 * reply may be, exactly as `main`'s IPC handlers validate the renderer.
 */

import BergamotWorker from "./bergamot.worker?worker";
import { isWorkerReply } from "./protocol.js";
import type { Transport } from "./client.js";
import type { IdleClock } from "./idle.js";

/** A worker created from the bundled engine harness, behind the client's `Transport`. */
export function workerTransport(): Transport {
  const worker = new BergamotWorker({ name: "nexus-translator" });
  let listeners: Parameters<Transport["subscribe"]>[0] | null = null;

  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (isWorkerReply(event.data)) listeners?.reply(event.data);
  });
  const failed = (message: string): void => {
    listeners?.failed(message);
  };
  // Two failure channels, because a worker that dies before it can answer posts
  // nothing at all: `error` is a script that threw, `messageerror` a message that
  // could not be deserialized. Either way the page must stop waiting.
  worker.addEventListener("error", (event: ErrorEvent) => {
    failed(event.message === "" ? "the translation worker failed" : event.message);
  });
  worker.addEventListener("messageerror", () => {
    failed("the translation worker sent a message this page could not read");
  });

  return {
    post: (request) => worker.postMessage(request),
    subscribe: (handlers) => {
      listeners = handlers;
    },
    terminate: () => worker.terminate(),
  };
}

/** The browser's clock and timers, in the shape the idle rule and main both use. */
export function browserClock(): IdleClock {
  return {
    now: () => Date.now(),
    setTimer: (atMs, run) => {
      const handle = setTimeout(run, Math.max(0, atMs - Date.now()));
      return () => clearTimeout(handle);
    },
  };
}
