/**
 * The translator's worker: NLLB in a process of its own.
 *
 * Its own process rather than the voice worker's, because the voice worker
 * holds one model at a time and a translation read aloud needs both: swapping
 * a gigabyte translator out for every spoken sentence would cost a load each
 * time. Requests run one at a time, in order; a `cancel` is read the moment it
 * arrives and stops its request before the next sentence.
 */

import { loadTranslator, type Translator } from "./inference.js";
import { requestId, requestProblem, type NllbReply, type NllbRequest } from "./protocol.js";

let loaded: { readonly directory: string; readonly model: Translator } | null = null;
const cancelled = new Set<number>();

function send(reply: NllbReply): void {
  process.parentPort.postMessage(reply);
}

async function resident(directory: string): Promise<Translator> {
  if (loaded?.directory !== directory) {
    // The old model goes before the new one loads, so two are never held at once.
    loaded = null;
    loaded = { directory, model: await loadTranslator(directory) };
  }
  return loaded.model;
}

async function translate(request: Extract<NllbRequest, { type: "translate" }>): Promise<void> {
  let model: Translator;
  try {
    model = await resident(request.directory);
  } catch (error) {
    send({ id: request.id, type: "failed", code: "load-failed", message: messageOf(error) });
    return;
  }
  for (const [index, sentence] of request.sentences.entries()) {
    if (cancelled.has(request.id)) {
      send({ id: request.id, type: "failed", code: "aborted", message: "cancelled." });
      return;
    }
    try {
      const text = await model.translate(sentence, request.source, request.target);
      send({ id: request.id, type: "sentence", index, text });
    } catch (error) {
      send({ id: request.id, type: "failed", code: "translate-failed", message: messageOf(error) });
      return;
    }
  }
  send({ id: request.id, type: "translated" });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let queue: Promise<void> = Promise.resolve();

/** The worker's entry point, called by `workerMain.ts` in the worker's process. */
export function startNllbWorker(): void {
  process.parentPort.on("message", (event) => {
    const message: unknown = (event as { data: unknown }).data;
    const problem = requestProblem(message);
    if (problem !== null) {
      const id = requestId(message);
      if (id !== null) send({ id, type: "failed", code: "bad-request", message: problem });
      return;
    }
    const request = message as NllbRequest;
    if (request.type === "cancel") {
      cancelled.add(request.request);
      return;
    }
    queue = queue.then(async () => {
      await translate(request);
      cancelled.delete(request.id);
    });
  });
}
