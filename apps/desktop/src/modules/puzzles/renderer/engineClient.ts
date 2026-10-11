import { useEffect, useMemo, useRef } from "react";
import type {
  EngineClientMessage,
  EngineRequest,
  EngineResponse,
  EngineStage,
  EngineWorkerMessage,
} from "./engine.js";

/**
 * The page's side of the worker (ADR-090): one request in flight at a time per
 * call, one answer each, and a lifetime tied to the page that asked.
 *
 * **Why the worker is a value and not a module-level singleton.** The page that
 * opens a puzzle is the page that pays for the worker, and a worker left running
 * after the page is gone is a thread nobody can see holding the engine's whole
 * bundle. `useEngine` starts one on mount and terminates it on unmount, which is
 * the same rule the kit's lazy page chunk follows one level up.
 *
 * **Why the caller passes a stage callback.** Generation is not instant, and the
 * product asks for progress rather than a frozen page. The stage is a CODE
 * (`EngineStage`), never a sentence: the worker has no copy table and no locale,
 * so the page is the only place a stage can become words.
 */

export interface EngineClient {
  request(request: EngineRequest, onStage?: (stage: EngineStage) => void): Promise<EngineResponse>;
  dispose(): void;
}

interface Pending {
  readonly resolve: (response: EngineResponse) => void;
  readonly reject: (error: Error) => void;
  readonly onStage?: ((stage: EngineStage) => void) | undefined;
}

/**
 * Starts a worker and returns the client that talks to it.
 *
 * `new Worker(new URL(...))` is the one spelling Vite recognises as a worker
 * entry: it bundles the file as its own chunk, with its own module graph, which
 * is why the engine's heavy code does not ride in the page's chunk.
 *
 * **No `{ type: "module" }`, deliberately.** A module worker is fetched as a
 * module script, and a module script is subject to a CORS check that a classic
 * script is not — a question about `file://` policy in the packaged app that
 * nothing in this run can test that app to answer (`main/index.ts` loads the
 * built renderer with `loadFile`). A classic worker is fetched as a classic
 * script and needs no such check, so it is the shape that works in development
 * and in the installer alike; Vite bundles this file with its imports inlined,
 * which is what makes the worker one script with no imports of its own.
 *
 * A worker that fails to LOAD answers every pending request with a sentence
 * rather than leaving the page waiting: the `error` event carries no id, so the
 * honest thing is to fail everything in flight and let the page show its own
 * error state.
 */
export function createEngineClient(): EngineClient {
  const worker = new Worker(new URL("./engine.worker.ts", import.meta.url));
  const pending = new Map<number, Pending>();
  let nextId = 1;

  worker.addEventListener("message", (event: MessageEvent<EngineWorkerMessage>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    if (message.type === "stage") {
      entry.onStage?.(message.stage);
      return;
    }
    pending.delete(message.id);
    if (message.type === "result") entry.resolve(message.response);
    else entry.reject(new Error(message.message));
  });

  worker.addEventListener("error", (event: ErrorEvent) => {
    const failure = new Error(event.message === "" ? "the puzzle worker failed" : event.message);
    for (const [, entry] of pending) entry.reject(failure);
    pending.clear();
  });

  return {
    request(request, onStage) {
      const id = nextId;
      nextId += 1;
      return new Promise<EngineResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject, onStage });
        const message: EngineClientMessage = { type: "request", id, request };
        worker.postMessage(message);
      });
    },
    dispose() {
      worker.terminate();
      pending.clear();
    },
  };
}

/**
 * One client for the page's lifetime: created when the first request needs it,
 * terminated when the page goes.
 *
 * **Why the worker is created on the first request rather than on mount.** The
 * app renders under `StrictMode`, whose development double-invocation mounts an
 * effect, runs its cleanup and mounts it again. A client built eagerly would be
 * terminated by that first cleanup and then handed to the page anyway — a worker
 * that silently answers nothing, which is the worst failure shape there is. Built
 * here, the cleanup empties the ref and the next request starts a fresh worker,
 * so both the strict pass and an unmount are the same, safe thing.
 */
export function useEngine(): EngineClient {
  const held = useRef<EngineClient | null>(null);
  const client = useMemo<EngineClient>(
    () => ({
      request: (request, onStage) => {
        if (held.current === null) held.current = createEngineClient();
        return held.current.request(request, onStage);
      },
      dispose: () => {
        held.current?.dispose();
        held.current = null;
      },
    }),
    [],
  );
  useEffect(() => () => client.dispose(), [client]);
  return client;
}
