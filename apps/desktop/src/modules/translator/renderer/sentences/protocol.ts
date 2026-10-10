/**
 * The message vocabulary between the page and the translation worker.
 *
 * **Why a typed protocol instead of an options object on a Worker.** A worker's
 * `postMessage` is untyped on the receiving side, and a reply that is not the
 * shape the sender hoped for is a `TypeError` in a promise nobody awaits. The
 * two shapes are declared once here, the worker answers with `WorkerReply` and
 * nothing else, and the client checks every incoming message with
 * `isWorkerReply` before it touches a field — the same discipline the IPC
 * boundary in main applies to the renderer, for the same reason: a message is
 * input from the other side of a boundary, and this boundary is a real one.
 *
 * One reply per request, keyed by the request's `id`, because a batch is
 * asynchronous and two requests may be in flight between the two files. There is
 * no streaming message: progress is counted in the page, sentence by sentence,
 * from the batches it asked for.
 */

import type { Direction, ModelUrls } from "./models.js";

/** Load (or replace) the model for one direction. Answers nothing but the id. */
export interface LoadRequest {
  readonly kind: "load";
  readonly direction: Direction;
  readonly urls: ModelUrls;
}

/** Translate sentences that have already been split, in order. */
export interface TranslateRequest {
  readonly kind: "translate";
  readonly direction: Direction;
  readonly sentences: readonly string[];
}

/** Release the loaded model's memory. */
export interface UnloadRequest {
  readonly kind: "unload";
}

/** One request, carrying the id its reply will name. */
export type WorkerRequestPayload = LoadRequest | TranslateRequest | UnloadRequest;

/** One request as it is posted: the payload plus the id its reply will name. */
export type WorkerRequest = { readonly id: number } & WorkerRequestPayload;

/** A successful `translate`: one translation per sentence, in the same order. */
export interface TranslateReply {
  readonly kind: "translated";
  readonly sentences: readonly string[];
}

/** A successful `load` or `unload`. */
export interface AckReply {
  readonly kind: "ack";
}

/** A failure. The message is the worker's own words and is shown to the reader. */
export interface ErrorReply {
  readonly kind: "error";
  readonly message: string;
}

/** One reply, carrying the id of the request it answers. */
export type WorkerReply = { readonly id: number } & (TranslateReply | AckReply | ErrorReply);

/** True for a value this protocol accepts as a reply. */
export function isWorkerReply(value: unknown): value is WorkerReply {
  if (typeof value !== "object" || value === null) return false;
  const reply = value as { id?: unknown; kind?: unknown; message?: unknown; sentences?: unknown };
  if (!Number.isSafeInteger(reply.id)) return false;
  if (reply.kind === "ack") return true;
  if (reply.kind === "error") return typeof reply.message === "string";
  if (reply.kind === "translated") {
    return Array.isArray(reply.sentences) && reply.sentences.every((one) => typeof one === "string");
  }
  return false;
}
