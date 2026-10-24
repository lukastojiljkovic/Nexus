/**
 * The main process's end of the translator's worker.
 *
 * The voice host's arrangement (`main/assistant/voice/host.ts`): nothing starts
 * until the first translation, and a worker that exited is started again on
 * the next one. Two differences, both from what a translation is: a request is
 * answered sentence by sentence, and an abort sends the worker a `cancel`, so
 * it stops before the next sentence instead of translating the rest for nobody.
 */

import { utilityProcess as electronUtilityProcess, type UtilityProcess } from "electron";

import type { UtilityProcessPort } from "../../../../main/assistant/voice/host.js";
import { replyProblem, type NllbFailureCode, type NllbReply } from "./protocol.js";

/** What one translation needs: an installed pack's folder, the sentences, and the two NLLB codes. */
export interface NllbJob {
  readonly directory: string;
  readonly sentences: readonly string[];
  readonly source: string;
  readonly target: string;
}

export class NllbError extends Error {
  constructor(
    readonly code: NllbFailureCode,
    message: string,
  ) {
    super(`translator: ${message}`);
    this.name = "NllbError";
  }
}

export interface NllbHost {
  /** Loads one model without translating; repeated loads of the same folder are idempotent. */
  load(job: { readonly directory: string }): Promise<void>;
  /** Resolves when every sentence was handed to `onSentence`; rejects with an `NllbError`. */
  translate(job: NllbJob, onSentence: (index: number, text: string) => void, signal: AbortSignal): Promise<void>;
  /** Ends the worker, and with it the memory the model holds. */
  dispose(): void;
}

interface Waiting {
  readonly onSentence: (index: number, text: string) => void;
  readonly resolve: () => void;
  readonly reject: (error: NllbError) => void;
}

export function createNllbHost(
  entryPath: string,
  start: UtilityProcessPort["start"] = (modulePath, args, options) =>
    electronUtilityProcess.fork(modulePath, [...args], options),
): NllbHost {
  let worker: UtilityProcess | null = null;
  let nextId = 1;
  const pending = new Map<number, Waiting>();

  function failAll(message: string): void {
    for (const waiting of pending.values()) waiting.reject(new NllbError("no-worker", message));
    pending.clear();
  }

  function ensureWorker(): UtilityProcess {
    if (worker !== null) return worker;
    const started = start(entryPath, [], { serviceName: "nexus-translator" });
    started.on("message", (message: unknown) => {
      if (replyProblem(message) !== null) return;
      const reply = message as NllbReply;
      const waiting = pending.get(reply.id);
      if (waiting === undefined) return;
      if (reply.type === "sentence") {
        waiting.onSentence(reply.index, reply.text);
        return;
      }
      pending.delete(reply.id);
      if (reply.type === "translated" || reply.type === "loaded") waiting.resolve();
      else waiting.reject(new NllbError(reply.code, reply.message));
    });
    started.on("exit", () => {
      if (worker === started) worker = null;
      failAll("the translator worker stopped.");
    });
    worker = started;
    return started;
  }

  return {
    load(job) {
      const running = ensureWorker();
      const id = nextId++;
      return new Promise<void>((resolve, reject) => {
        pending.set(id, { onSentence: () => undefined, resolve, reject });
        running.postMessage({ id, type: "load", directory: job.directory });
      });
    },
    translate(job, onSentence, signal) {
      if (signal.aborted) return Promise.reject(new NllbError("aborted", "cancelled before it started."));
      const running = ensureWorker();
      const id = nextId++;
      return new Promise<void>((resolve, reject) => {
        pending.set(id, { onSentence, resolve, reject });
        signal.addEventListener(
          "abort",
          () => {
            if (!pending.delete(id)) return;
            running.postMessage({ id: nextId++, type: "cancel", request: id });
            reject(new NllbError("aborted", "cancelled."));
          },
          { once: true },
        );
        running.postMessage({ id, type: "translate", ...job });
      });
    },

    dispose() {
      const running = worker;
      worker = null;
      failAll("the translator worker was stopped.");
      running?.kill();
    },
  };
}
