/**
 * What crosses the gap between the main process and the voice worker.
 *
 * Inference runs in another process (see `docs/architecture/adr/105-voice.md`
 * for why), and everything sent across that line is checked on arrival against
 * the shape declared here, in both directions. That is not ceremony: the
 * worker's job is to run a signed model over bytes, and a message that arrived
 * with a `pcm` that is not a `Float32Array` or a `language` that is not a
 * language would otherwise reach the model loader as `undefined` and fail
 * somewhere deep inside ONNX with a stack that names none of this.
 *
 * The shapes are deliberately flat and small. There is no generic command, no
 * channel name and no path a caller may name: the worker loads exactly the
 * folder it is told to load, and the folder is one main resolved from an
 * installed, signature-verified pack.
 */

import type { AssistantLocale } from "@nexus/core";

import type { VoiceKind } from "./packs.js";

/** The languages a transcription request may name, plus the model's own detection. */
export type TranscriptionLanguage = AssistantLocale | "auto";

/**
 * What main sends. `id` pairs a reply with its request; replies may arrive out
 * of order.
 *
 * The folder is named on the request that USES it rather than being held from
 * an earlier `load`, and the redundancy is deliberate: a worker that remembered
 * which pack it had been told to load would answer a request built for a
 * different one with the previous model's output, and the failure would look
 * like a transcription of the wrong language rather than like a bug.
 */
export type VoiceRequest =
  | { readonly id: number; readonly type: "load"; readonly directory: string; readonly kind: VoiceKind }
  | {
      readonly id: number;
      readonly type: "transcribe";
      readonly directory: string;
      readonly pcm: Float32Array;
      readonly sampleRate: number;
      readonly language: TranscriptionLanguage;
    }
  | {
      readonly id: number;
      readonly type: "speak";
      readonly directory: string;
      readonly text: string;
      readonly language: AssistantLocale;
    }
  | { readonly id: number; readonly type: "dispose" };

/** Why a request or a reply is not usable. Machine codes, as everywhere else in this app. */
export type VoiceFailureCode =
  | "bad-request"
  | "load-failed"
  | "transcribe-failed"
  | "speak-failed"
  | "aborted"
  | "no-worker";

/** What the worker sends back. */
export type VoiceReply =
  | { readonly id: number; readonly type: "ready" }
  | { readonly id: number; readonly type: "disposed" }
  | { readonly id: number; readonly type: "transcript"; readonly text: string }
  | { readonly id: number; readonly type: "audio"; readonly pcm: Float32Array; readonly sampleRate: number }
  | { readonly id: number; readonly type: "failed"; readonly code: VoiceFailureCode; readonly message: string };

const LOCALES: readonly string[] = ["sr", "en"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A request id: a positive whole number, or one more than the last reply main has seen. */
function idProblem(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return '"id" must be a positive whole number.';
  }
  return null;
}

/** Why `value` is not a request the worker may run, or `null` when it is. */
export function requestProblem(value: unknown): string | null {
  if (!isRecord(value)) return "a request must be an object.";
  const id = idProblem(value["id"]);
  if (id !== null) return id;

  switch (value["type"]) {
    case "load": {
      if (typeof value["directory"] !== "string" || value["directory"] === "") {
        return '"directory" must be a non-empty path.';
      }
      if (value["kind"] !== "stt" && value["kind"] !== "tts") return '"kind" must be "stt" or "tts".';
      return null;
    }
    case "transcribe": {
      if (typeof value["directory"] !== "string" || value["directory"] === "") {
        return '"directory" must be a non-empty path.';
      }
      if (!(value["pcm"] instanceof Float32Array)) return '"pcm" must be a Float32Array.';
      const sampleRate = value["sampleRate"];
      if (typeof sampleRate !== "number" || !Number.isFinite(sampleRate) || sampleRate <= 0) {
        return '"sampleRate" must be a positive number of hertz.';
      }
      const language = value["language"];
      if (language !== "auto" && !LOCALES.includes(language as string)) {
        return '"language" must be "sr", "en" or "auto".';
      }
      return null;
    }
    case "speak": {
      if (typeof value["directory"] !== "string" || value["directory"] === "") {
        return '"directory" must be a non-empty path.';
      }
      const text = value["text"];
      if (typeof text !== "string" || text.trim() === "") return '"text" must be a non-empty string.';
      if (!LOCALES.includes(value["language"] as string)) return '"language" must be "sr" or "en".';
      return null;
    }
    case "dispose":
      return null;
    default:
      return `unknown request type ${JSON.stringify(value["type"])}.`;
  }
}

/** Why `value` is not a reply main may act on, or `null` when it is. */
export function replyProblem(value: unknown): string | null {
  if (!isRecord(value)) return "a reply must be an object.";
  const id = idProblem(value["id"]);
  if (id !== null) return id;

  switch (value["type"]) {
    case "ready":
    case "disposed":
      return null;
    case "transcript": {
      if (typeof value["text"] !== "string") return '"text" must be a string.';
      return null;
    }
    case "audio": {
      if (!(value["pcm"] instanceof Float32Array)) return '"pcm" must be a Float32Array.';
      const sampleRate = value["sampleRate"];
      if (typeof sampleRate !== "number" || !Number.isFinite(sampleRate) || sampleRate <= 0) {
        return '"sampleRate" must be a positive number of hertz.';
      }
      return null;
    }
    case "failed": {
      const code = value["code"];
      if (
        code !== "bad-request" &&
        code !== "load-failed" &&
        code !== "transcribe-failed" &&
        code !== "speak-failed" &&
        code !== "aborted" &&
        code !== "no-worker"
      ) {
        return `unknown failure code ${JSON.stringify(code)}.`;
      }
      if (typeof value["message"] !== "string") return '"message" must be a string.';
      return null;
    }
    default:
      return `unknown reply type ${JSON.stringify(value["type"])}.`;
  }
}

/** The request a reply answers, for a caller that has to find its promise. */
export function replyId(value: unknown): number | null {
  return isRecord(value) && typeof value["id"] === "number" ? value["id"] : null;
}

/** The condition the worker reports as a failure that is really a cancellation. */
export function isAborted(reply: VoiceReply): boolean {
  return reply.type === "failed" && reply.code === "aborted";
}
