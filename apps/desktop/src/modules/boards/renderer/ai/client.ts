import { useCallback, useEffect, useRef } from "react";
import AiWorker from "./ai.worker?worker";
import type { AiMoveAnswer, AiMoveRequest } from "./protocol.js";

/**
 * The page's side of the AI worker: one promise per request, keyed by id.
 *
 * **Why the worker is built on first use.** A page opened to look at the lobby —
 * or to play a second person at the same machine — never runs a search, and
 * spawning a worker on mount would make every visit pay for a thread it does not
 * use. `ask` is what creates it, once, and `dispose` (on unmount) terminates it.
 *
 * **Why one promise per request rather than a queue.** Two searches cannot be in
 * flight from this page — the board is not interactive while the computer is
 * thinking — but the client does not rely on that: the answer carries the id it
 * was asked with, so a stray late answer resolves nothing rather than the wrong
 * move. That is the shape that survives a search being started twice.
 */
export interface AiClient {
  ask(request: Omit<AiMoveRequest, "id">): Promise<AiMoveAnswer>;
  dispose(): void;
}

export function createAiClient(): AiClient {
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, (answer: AiMoveAnswer) => void>();

  function ensure(): Worker {
    if (worker !== null) return worker;
    const created = new AiWorker();
    created.onmessage = (event: MessageEvent<AiMoveAnswer>) => {
      const answer = event.data;
      const resolve = pending.get(answer.id);
      if (resolve === undefined) return;
      pending.delete(answer.id);
      resolve(answer);
    };
    // A worker that cannot start at all — a chunk that did not load, a thread the
    // platform refused — must not leave a request hanging forever: every waiting
    // request is answered with a refusal the page already knows how to report, and
    // the next call builds a fresh worker rather than talking to a dead one.
    created.onerror = () => {
      const waiting = [...pending.entries()];
      pending.clear();
      worker = null;
      for (const [id, resolve] of waiting) resolve({ id, ok: false, problem: "invalid-request" });
    };
    worker = created;
    return created;
  }

  return {
    ask(request) {
      const id = nextId;
      nextId += 1;
      return new Promise<AiMoveAnswer>((resolve) => {
        pending.set(id, resolve);
        ensure().postMessage({ ...request, id });
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}

/**
 * The hook a page uses: a stable `ask` that builds the client the first time it
 * is called and disposes it when the page goes away.
 */
export function useAiClient(): (request: Omit<AiMoveRequest, "id">) => Promise<AiMoveAnswer> {
  const client = useRef<AiClient | null>(null);
  useEffect(
    () => () => {
      client.current?.dispose();
      client.current = null;
    },
    [],
  );
  return useCallback((request) => {
    client.current ??= createAiClient();
    return client.current.ask(request);
  }, []);
}
