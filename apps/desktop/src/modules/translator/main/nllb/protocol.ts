/**
 * What crosses the gap between the main process and the translator's worker.
 *
 * The voice worker's rule (`main/assistant/voice/protocol.ts`), for the same
 * reason: every message is checked on arrival against the shape declared here,
 * in both directions, so a malformed one is refused by name rather than failing
 * deep inside ONNX. The folder is named on the request that uses it, and it is
 * one main resolved from an installed, signature-verified pack.
 *
 * **A translation answers sentence by sentence.** One `translate` request
 * carries the sentences main cut the text into, and the worker replies with a
 * `sentence` for each as it is done, then `translated`. A `cancel` names the
 * request it stops; the worker reads it at once rather than after the queue,
 * and stops before the next sentence. The sentence being decoded finishes,
 * because `onnxruntime` has no point inside a run at which it can stop. There
 * is no `dispose`: the host gives the memory back by ending the process.
 */

import type { TranslationFailure } from "../../shared/ipc.js";

/** An NLLB-200 language code, `xxx_Ssss`. Which codes exist is main's table; this is only their shape. */
const NLLB_CODE = /^[a-z]{3}_[A-Z][a-z]{3}$/;

export type NllbRequest =
  | { readonly id: number; readonly type: "load"; readonly directory: string }
  | {
      readonly id: number;
      readonly type: "translate";
      readonly directory: string;
      readonly sentences: readonly string[];
      readonly source: string;
      readonly target: string;
    }
  | { readonly id: number; readonly type: "cancel"; readonly request: number };

export type NllbFailureCode = TranslationFailure;

const FAILURE_CODES: readonly string[] = [
  "bad-request",
  "load-failed",
  "translate-failed",
  "aborted",
  "no-worker",
] satisfies readonly NllbFailureCode[];

export type NllbReply =
  | { readonly id: number; readonly type: "loaded" }
  | { readonly id: number; readonly type: "sentence"; readonly index: number; readonly text: string }
  | { readonly id: number; readonly type: "translated" }
  | { readonly id: number; readonly type: "failed"; readonly code: NllbFailureCode; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** Why `value` is not a request the worker may run, or `null` when it is. */
export function requestProblem(value: unknown): string | null {
  if (!isRecord(value)) return "a request must be an object.";
  if (!isId(value["id"])) return '"id" must be a positive whole number.';
  switch (value["type"]) {
    case "load":
      return typeof value["directory"] === "string" && value["directory"] !== ""
        ? null
        : '"directory" must be a non-empty path.';
    case "translate": {
      if (typeof value["directory"] !== "string" || value["directory"] === "") {
        return '"directory" must be a non-empty path.';
      }
      const sentences = value["sentences"];
      if (!Array.isArray(sentences) || sentences.length === 0) return '"sentences" must be a non-empty list.';
      if (!sentences.every((sentence) => typeof sentence === "string" && sentence.trim() !== "")) {
        return '"sentences" must hold only non-blank strings.';
      }
      for (const field of ["source", "target"] as const) {
        const code = value[field];
        if (typeof code !== "string" || !NLLB_CODE.test(code)) return `"${field}" must be an NLLB code.`;
      }
      return null;
    }
    case "cancel":
      return isId(value["request"]) ? null : '"request" must be a positive whole number.';
    default:
      return `unknown request type ${JSON.stringify(value["type"])}.`;
  }
}

/** Why `value` is not a reply main may act on, or `null` when it is. */
export function replyProblem(value: unknown): string | null {
  if (!isRecord(value)) return "a reply must be an object.";
  if (!isId(value["id"])) return '"id" must be a positive whole number.';
  switch (value["type"]) {
    case "loaded":
      return null;
    case "sentence": {
      const index = value["index"];
      if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) {
        return '"index" must be a whole number from 0.';
      }
      return typeof value["text"] === "string" ? null : '"text" must be a string.';
    }
    case "translated":
      return null;
    case "failed": {
      if (!FAILURE_CODES.includes(value["code"] as string)) {
        return `unknown failure code ${JSON.stringify(value["code"])}.`;
      }
      return typeof value["message"] === "string" ? null : '"message" must be a string.';
    }
    default:
      return `unknown reply type ${JSON.stringify(value["type"])}.`;
  }
}

/** The request a message names, for a reply to a request that is not usable. */
export function requestId(value: unknown): number | null {
  return isRecord(value) && isId(value["id"]) ? value["id"] : null;
}
