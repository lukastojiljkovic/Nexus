import ParseWorker from "./parse.worker.ts?worker";
import type { ParseResponse } from "./parseProtocol.js";

/**
 * The page's side of the parse worker: one worker per open page, a promise per
 * request, and a `dispose` that stops it.
 *
 * **Why one worker per page rather than a shared pool.** The work is a person
 * opening one file and then looking at it; a pool would be machinery for a
 * concurrency this module never has, and a worker that outlived the page would
 * be memory held for a module nobody has open.
 *
 * **Why the client never rejects for a refusal.** A malformed file is an ANSWER
 * (`ok: false` with a code) rather than an exception, because the page's job is
 * to say what is wrong with the file in the reader's language, and an exception
 * would push that decision into a `catch`.
 */

export interface ParseClient {
  /** Reads one file, answering its result or the code that refused it. */
  parse(request: {
    kind: "model" | "toolpath";
    name: string;
    bytes: ArrayBuffer;
  }): Promise<ParseResponse>;
  /** Stops the worker. Called when the page unmounts. */
  dispose(): void;
}

export function createParseClient(): ParseClient {
  const worker = new ParseWorker();
  const waiting = new Map<number, (response: ParseResponse) => void>();
  let nextId = 1;
  let disposed = false;

  worker.onmessage = (event: MessageEvent<ParseResponse>) => {
    const resolve = waiting.get(event.data.id);
    if (resolve === undefined) return;
    waiting.delete(event.data.id);
    resolve(event.data);
  };

  /** An answer the worker cannot give - it crashed - so nobody waits forever. */
  worker.onerror = () => {
    for (const [, resolve] of waiting) resolve({ id: 0, ok: false, problem: "failed" });
    waiting.clear();
  };

  return {
    parse({ kind, name, bytes }) {
      if (disposed) return Promise.resolve({ id: 0, ok: false, problem: "failed" } as const);
      const id = nextId;
      nextId += 1;
      return new Promise<ParseResponse>((resolve) => {
        waiting.set(id, resolve);
        // The buffer is transferred: this page has no further use for the file's
        // bytes once they have been read, and a copy of 32 MiB is not free.
        worker.postMessage({ id, kind, name, bytes }, [bytes]);
      });
    },
    dispose() {
      disposed = true;
      waiting.clear();
      worker.terminate();
    },
  };
}
