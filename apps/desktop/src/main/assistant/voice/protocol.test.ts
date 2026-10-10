import { describe, expect, it } from "vitest";

import { isAborted, replyId, replyProblem, requestProblem } from "./protocol.js";

const PCM = new Float32Array(4);
const DIR = "C:\\packs\\whisper-base\\1.0.0";

describe("requestProblem", () => {
  it("accepts each request the service sends", () => {
    expect(requestProblem({ id: 1, type: "load", directory: DIR, kind: "stt" })).toBeNull();
    expect(requestProblem({ id: 2, type: "transcribe", directory: DIR, pcm: PCM, sampleRate: 16_000, language: "sr" })).toBeNull();
    expect(
      requestProblem({ id: 3, type: "transcribe", directory: DIR, pcm: PCM, sampleRate: 48_000, language: "auto" }),
    ).toBeNull();
    expect(requestProblem({ id: 4, type: "speak", directory: DIR, text: "Dobar dan.", language: "sr" })).toBeNull();
    expect(requestProblem({ id: 5, type: "dispose" })).toBeNull();
  });

  it("requires a usable id on every request", () => {
    expect(requestProblem({ type: "dispose" })).toBe('"id" must be a positive whole number.');
    expect(requestProblem({ id: 0, type: "dispose" })).toBe('"id" must be a positive whole number.');
    expect(requestProblem({ id: 1.5, type: "dispose" })).toBe('"id" must be a positive whole number.');
  });

  it("refuses a load with no folder", () => {
    expect(requestProblem({ id: 1, type: "load", directory: "", kind: "stt" })).toBe(
      '"directory" must be a non-empty path.',
    );
    expect(requestProblem({ id: 1, type: "load", directory: DIR, kind: "chat" })).toBe(
      '"kind" must be "stt" or "tts".',
    );
  });

  it("refuses a transcription whose audio is not audio", () => {
    const base = { id: 1, type: "transcribe", directory: DIR, pcm: PCM, sampleRate: 16_000, language: "auto" };
    expect(requestProblem({ ...base, pcm: [1, 2] })).toBe('"pcm" must be a Float32Array.');
    expect(requestProblem({ ...base, sampleRate: 0 })).toBe('"sampleRate" must be a positive number of hertz.');
    expect(requestProblem({ ...base, language: "de" })).toBe('"language" must be "sr", "en" or "auto".');
    expect(requestProblem({ ...base, directory: "" })).toBe('"directory" must be a non-empty path.');
  });

  it("refuses to speak nothing", () => {
    expect(requestProblem({ id: 1, type: "speak", directory: DIR, text: "   ", language: "en" })).toBe(
      '"text" must be a non-empty string.',
    );
    expect(requestProblem({ id: 1, type: "speak", directory: DIR, text: "hello", language: "fr" })).toBe(
      '"language" must be "sr" or "en".',
    );
    expect(requestProblem({ id: 1, type: "speak", directory: "", text: "hello", language: "en" })).toBe(
      '"directory" must be a non-empty path.',
    );
  });

  it("names an unknown type rather than treating it as a no-op", () => {
    expect(requestProblem({ id: 1, type: "embed" })).toBe('unknown request type "embed".');
    expect(requestProblem("nope")).toBe("a request must be an object.");
    expect(requestProblem(null)).toBe("a request must be an object.");
  });
});

describe("replyProblem", () => {
  it("accepts each reply the worker sends", () => {
    expect(replyProblem({ id: 1, type: "ready" })).toBeNull();
    expect(replyProblem({ id: 1, type: "disposed" })).toBeNull();
    expect(replyProblem({ id: 1, type: "transcript", text: "" })).toBeNull();
    expect(replyProblem({ id: 1, type: "audio", pcm: PCM, sampleRate: 16_000 })).toBeNull();
    expect(replyProblem({ id: 1, type: "failed", code: "aborted", message: "aborted" })).toBeNull();
  });

  it("refuses a reply with no usable id", () => {
    expect(replyProblem({ type: "ready" })).toBe('"id" must be a positive whole number.');
  });

  it("refuses a transcript that is not text, and audio that is not audio", () => {
    expect(replyProblem({ id: 1, type: "transcript", text: 7 })).toBe('"text" must be a string.');
    expect(replyProblem({ id: 1, type: "audio", pcm: new Int16Array(4), sampleRate: 16_000 })).toBe(
      '"pcm" must be a Float32Array.',
    );
    expect(replyProblem({ id: 1, type: "audio", pcm: PCM, sampleRate: -1 })).toBe(
      '"sampleRate" must be a positive number of hertz.',
    );
  });

  it("refuses a failure with a code this build does not know", () => {
    expect(replyProblem({ id: 1, type: "failed", code: "melted", message: "x" })).toBe(
      'unknown failure code "melted".',
    );
    expect(replyProblem({ id: 1, type: "failed", code: "aborted" })).toBe('"message" must be a string.');
    expect(replyProblem({ id: 1, type: "chunk" })).toBe('unknown reply type "chunk".');
  });
});

describe("replyId and isAborted", () => {
  it("reads the id out of a reply, and answers null when there is none", () => {
    expect(replyId({ id: 12, type: "ready" })).toBe(12);
    expect(replyId({ type: "ready" })).toBeNull();
    expect(replyId("nope")).toBeNull();
  });

  it("recognises the one failure that is a cancellation", () => {
    expect(isAborted({ id: 1, type: "failed", code: "aborted", message: "stopped" })).toBe(true);
    expect(isAborted({ id: 1, type: "failed", code: "speak-failed", message: "no" })).toBe(false);
    expect(isAborted({ id: 1, type: "transcript", text: "hi" })).toBe(false);
  });
});
