import { describe, expect, it, vi } from "vitest";

import type { VoiceHost } from "./host.js";
import { createVoiceService, VoiceUnavailableError } from "./index.js";
import { parseVoiceDescriptor, type VoicePack } from "./packs.js";
import type { VoiceReply, VoiceRequest } from "./protocol.js";

/** A pack as main would build it: the descriptor parsed out of the folder's `voice.json`. */
function pack(id: string, version: string, descriptor: Record<string, unknown>): VoicePack {
  return { id, version, directory: `/packs/${id}/${version}`, descriptor: parseVoiceDescriptor(descriptor) };
}

const MULTILINGUAL = pack("whisper-base", "1.0.0", {
  format: 1,
  kind: "stt",
  engine: "whisper",
  languages: ["sr", "en"],
  sampleRate: 16_000,
  upstream: { repo: "Xenova/whisper-base", revision: "main" },
});

const ENGLISH_ONLY = pack("whisper-tiny-en", "1.0.0", {
  format: 1,
  kind: "stt",
  engine: "whisper",
  languages: ["en"],
  sampleRate: 16_000,
  upstream: { repo: "Xenova/whisper-tiny.en", revision: "main" },
});

const ENGLISH_VOICE = pack("mms-tts-eng", "1.0.0", {
  format: 1,
  kind: "tts",
  engine: "vits",
  languages: ["en"],
  sampleRate: 16_000,
  upstream: { repo: "Xenova/mms-tts-eng", revision: "main" },
});

/** A host that records every request and answers from a table of canned replies. */
function fakeHost(answer: (request: VoiceRequest) => VoiceReply): {
  host: VoiceHost;
  requests: VoiceRequest[];
} {
  const requests: VoiceRequest[] = [];
  return {
    requests,
    host: {
      run: (request) => {
        requests.push(request);
        return Promise.resolve(answer(request));
      },
      dispose: () => Promise.resolve(),
    },
  };
}

/** The ordinary host: loads succeed, a transcription answers "hello", a voice answers 8 samples. */
function workingHost(): { host: VoiceHost; requests: VoiceRequest[] } {
  return fakeHost((request) => {
    switch (request.type) {
      case "load":
        return { id: request.id, type: "ready" };
      case "transcribe":
        return { id: request.id, type: "transcript", text: "hello" };
      case "speak":
        return { id: request.id, type: "audio", pcm: new Float32Array(8), sampleRate: 16_000 };
      case "dispose":
        return { id: request.id, type: "disposed" };
    }
  });
}

const PCM = new Float32Array(16);
const SIGNAL = new AbortController().signal;

describe("createVoiceService", () => {
  it("returns null for both halves when nothing is installed", async () => {
    const service = createVoiceService({ packs: () => Promise.resolve([]), host: workingHost().host });
    expect(await service.speechToText()).toBeNull();
    expect(await service.textToSpeech()).toBeNull();
  });

  it("returns null for the half that has no pack, and a service for the half that has one", async () => {
    const service = createVoiceService({
      packs: () => Promise.resolve([ENGLISH_VOICE]),
      host: workingHost().host,
    });
    expect(await service.speechToText()).toBeNull();
    expect(await service.textToSpeech()).not.toBeNull();

    const other = createVoiceService({ packs: () => Promise.resolve([MULTILINGUAL]), host: workingHost().host });
    expect(await other.speechToText()).not.toBeNull();
    expect(await other.textToSpeech()).toBeNull();
  });

  it("loads the pack once and then transcribes through it", async () => {
    const { host, requests } = workingHost();
    const service = createVoiceService({ packs: () => Promise.resolve([MULTILINGUAL]), host });
    const speech = await service.speechToText();
    expect(speech).not.toBeNull();

    expect(await speech?.transcribe(PCM, 16_000, "sr", SIGNAL)).toBe("hello");
    expect(await speech?.transcribe(PCM, 16_000, "sr", SIGNAL)).toBe("hello");

    expect(requests).toEqual([
      { id: 1, type: "load", directory: MULTILINGUAL.directory, kind: "stt" },
      { id: 2, type: "transcribe", directory: MULTILINGUAL.directory, pcm: PCM, sampleRate: 16_000, language: "sr" },
      { id: 3, type: "transcribe", directory: MULTILINGUAL.directory, pcm: PCM, sampleRate: 16_000, language: "sr" },
    ]);
  });

  it("passes the language through, including auto", async () => {
    const { host, requests } = workingHost();
    const service = createVoiceService({ packs: () => Promise.resolve([MULTILINGUAL]), host });
    const speech = await service.speechToText();
    await speech?.transcribe(PCM, 48_000, "auto", SIGNAL);
    expect(requests[1]).toMatchObject({ type: "transcribe", language: "auto", sampleRate: 48_000 });
  });

  it("loads the other pack when a language needs one the loaded model cannot do", async () => {
    const { host, requests } = workingHost();
    const service = createVoiceService({ packs: () => Promise.resolve([ENGLISH_ONLY, MULTILINGUAL]), host });
    const speech = await service.speechToText();

    await speech?.transcribe(PCM, 16_000, "en", SIGNAL);
    // English is served by the caller's first choice, so no second load happens.
    await speech?.transcribe(PCM, 16_000, "sr", SIGNAL);

    expect(requests.filter((request) => request.type === "load")).toEqual([
      { id: 1, type: "load", directory: ENGLISH_ONLY.directory, kind: "stt" },
      { id: 3, type: "load", directory: MULTILINGUAL.directory, kind: "stt" },
    ]);
  });

  it("refuses a language no installed model declares, instead of answering in another one", async () => {
    const { host, requests } = workingHost();
    const service = createVoiceService({ packs: () => Promise.resolve([ENGLISH_ONLY]), host });
    const speech = await service.speechToText();
    await expect(speech?.transcribe(PCM, 16_000, "sr", SIGNAL)).rejects.toBeInstanceOf(VoiceUnavailableError);
    await expect(speech?.transcribe(PCM, 16_000, "sr", SIGNAL)).rejects.toMatchObject({ problem: "pack-missing" });
    // Nothing was loaded and nothing was sent: a refusal is not a request.
    expect(requests).toEqual([]);
  });

  it("speaks through the voice pack for the language", async () => {
    const { host, requests } = workingHost();
    const service = createVoiceService({ packs: () => Promise.resolve([ENGLISH_VOICE]), host });
    const voice = await service.textToSpeech();
    const audio = await voice?.speak("Hello there.", "en", SIGNAL);
    expect(audio?.sampleRate).toBe(16_000);
    expect(audio?.pcm.length).toBe(8);
    expect(requests[1]).toMatchObject({ type: "speak", text: "Hello there.", language: "en" });
  });

  it("refuses to speak a language no installed voice speaks", async () => {
    const { host } = workingHost();
    const service = createVoiceService({ packs: () => Promise.resolve([ENGLISH_VOICE]), host });
    const voice = await service.textToSpeech();
    await expect(voice?.speak("Zdravo.", "sr", SIGNAL)).rejects.toMatchObject({ problem: "pack-missing" });
  });

  it("surfaces a worker failure with its own code", async () => {
    const { host } = fakeHost(() => ({ id: 1, type: "failed", code: "load-failed", message: "directory is gone" }));
    const service = createVoiceService({ packs: () => Promise.resolve([MULTILINGUAL]), host });
    const speech = await service.speechToText();
    await expect(speech?.transcribe(PCM, 16_000, "auto", SIGNAL)).rejects.toMatchObject({
      problem: "load-failed",
      message: "directory is gone",
    });
  });

  it("surfaces a cancellation as an abort rather than as a failure", async () => {
    const { host } = fakeHost((request) =>
      request.type === "load"
        ? { id: request.id, type: "ready" }
        : { id: request.id, type: "failed", code: "aborted", message: "cancelled." },
    );
    const service = createVoiceService({ packs: () => Promise.resolve([MULTILINGUAL]), host });
    const speech = await service.speechToText();
    await expect(speech?.transcribe(PCM, 16_000, "auto", SIGNAL)).rejects.toMatchObject({ problem: "aborted" });
  });

  it("calls the worker once per load even when the pack list is re-read every time", async () => {
    const packs = vi.fn(() => Promise.resolve([MULTILINGUAL, ENGLISH_VOICE]));
    const { host, requests } = workingHost();
    const service = createVoiceService({ packs, host });
    const voice = await service.textToSpeech();
    await voice?.speak("one", "en", SIGNAL);
    await voice?.speak("two", "en", SIGNAL);
    expect(requests.filter((request) => request.type === "load").length).toBe(1);
    // The text-to-speech factory, then one read per speak: the pack list is
    // deliberately not cached.
    expect(packs).toHaveBeenCalledTimes(3);
  });

  it("says which languages there is a voice for, for a page that must not offer one it cannot honour", async () => {
    // `speaksLanguage` is the pure helper the page reads; the service does not
    // duplicate it, so this test pins that the two agree.
    const { speaksLanguage } = await import("./packs.js");
    const packs = [ENGLISH_VOICE];
    expect(speaksLanguage(packs, "en")).toBe(true);
    expect(speaksLanguage(packs, "sr")).toBe(false);
    const service = createVoiceService({ packs: () => Promise.resolve(packs), host: workingHost().host });
    expect(await service.textToSpeech()).not.toBeNull();
  });
});
