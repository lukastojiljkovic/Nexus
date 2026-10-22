import { describe, expect, it } from "vitest";

import {
  describeVoicePack,
  engineMatchesConfig,
  parseVoiceDescriptor,
  pickSttPack,
  pickTtsPack,
  speaksLanguage,
  voiceDescriptorProblem,
  voicePackDirectoryProblem,
  type VoicePack,
} from "./packs.js";

/** A descriptor as this repository's builder writes it for one Whisper size. */
function whisperDescriptor(): Record<string, unknown> {
  return {
    format: 1,
    kind: "stt",
    engine: "whisper",
    languages: ["sr", "en"],
    sampleRate: 16_000,
    upstream: { repo: "Xenova/whisper-base", revision: "main" },
  };
}

function vitsDescriptor(languages: readonly string[], repo: string): Record<string, unknown> {
  return {
    format: 1,
    kind: "tts",
    engine: "vits",
    languages: [...languages],
    sampleRate: 16_000,
    upstream: { repo, revision: "main" },
  };
}

/** A pack with no file behind it: these tests are about the descriptor, not the folder. */
function pack(id: string, descriptor: Record<string, unknown>): VoicePack {
  return { id, version: "1.0.0", directory: `/packs/${id}/1.0.0`, descriptor: parseVoiceDescriptor(descriptor) };
}

describe("voiceDescriptorProblem", () => {
  it("accepts the two descriptors the builder writes", () => {
    expect(voiceDescriptorProblem(whisperDescriptor())).toBeNull();
    expect(voiceDescriptorProblem(vitsDescriptor(["sr"], "rhasspy/piper-voices"))).toBeNull();
  });

  it("refuses anything that is not an object", () => {
    expect(voiceDescriptorProblem(null)).toMatch(/JSON object/);
    expect(voiceDescriptorProblem([])).toMatch(/JSON object/);
    expect(voiceDescriptorProblem("nope")).toMatch(/JSON object/);
  });

  it("refuses a missing field and an unknown one", () => {
    const missing = whisperDescriptor();
    delete missing["engine"];
    expect(voiceDescriptorProblem(missing)).toBe('voice.json is missing "engine".');
    expect(voiceDescriptorProblem({ ...whisperDescriptor(), quantized: true })).toBe(
      'voice.json has an unknown field "quantized".',
    );
    const brokenUpstream = whisperDescriptor();
    brokenUpstream["upstream"] = { repo: "Xenova/whisper-base", revision: "main", revison: "main" };
    expect(voiceDescriptorProblem(brokenUpstream)).toBe('"upstream" has an unknown field "revison".');
  });

  it("reads format 1 only", () => {
    expect(voiceDescriptorProblem({ ...whisperDescriptor(), format: 2 })).toBe(
      "voice.json: this build reads format 1 only.",
    );
  });

  it("keeps each engine to the kind it can do", () => {
    expect(voiceDescriptorProblem({ ...whisperDescriptor(), kind: "tts" })).toBe(
      '"engine" "whisper" is never a "tts" pack.',
    );
  });

  it("refuses a language the assistant does not speak, and a repeated one", () => {
    expect(voiceDescriptorProblem({ ...whisperDescriptor(), languages: ["de"] })).toMatch(/not a language/);
    expect(voiceDescriptorProblem({ ...whisperDescriptor(), languages: ["sr", "sr"] })).toMatch(/twice/);
    expect(voiceDescriptorProblem({ ...whisperDescriptor(), languages: [] })).toMatch(/non-empty array/);
  });

  it("bounds the sample rate", () => {
    expect(voiceDescriptorProblem({ ...whisperDescriptor(), sampleRate: 7_999 })).toMatch(/whole number/);
    expect(voiceDescriptorProblem({ ...whisperDescriptor(), sampleRate: 22_050 })).toBeNull();
    expect(voiceDescriptorProblem({ ...whisperDescriptor(), sampleRate: "16000" })).toMatch(/whole number/);
  });

  it("requires both halves of the provenance", () => {
    const noRevision = whisperDescriptor();
    noRevision["upstream"] = { repo: "Xenova/whisper-base", revision: "  " };
    expect(voiceDescriptorProblem(noRevision)).toBe('"upstream.revision" must be a non-empty string.');
  });
});

describe("parseVoiceDescriptor", () => {
  it("returns a frozen copy of the languages rather than the array it was given", () => {
    const source = whisperDescriptor();
    const descriptor = parseVoiceDescriptor(source);
    expect(descriptor.languages).toEqual(["sr", "en"]);
    expect(descriptor.languages).not.toBe(source["languages"]);
  });
});

describe("engineMatchesConfig", () => {
  it("agrees with the two real configs, by their model_type", () => {
    // Xenova/whisper-base/config.json: "model_type": "whisper".
    expect(engineMatchesConfig("whisper", { model_type: "whisper", architectures: ["WhisperForConditionalGeneration"] })).toBe(true);
    // Xenova/mms-tts-eng/config.json: "model_type": "vits".
    expect(engineMatchesConfig("vits", { model_type: "vits", architectures: ["VitsModel"] })).toBe(true);
  });

  it("refuses a config that says something else, or nothing at all", () => {
    expect(engineMatchesConfig("vits", { model_type: "whisper" })).toBe(false);
    expect(engineMatchesConfig("whisper", {})).toBe(false);
    expect(engineMatchesConfig("whisper", null)).toBe(false);
  });
});

describe("describeVoicePack", () => {
  it("builds a pack from the text main read out of the folder", () => {
    const described = describeVoicePack({
      id: "whisper-base",
      version: "1.0.0",
      directory: "C:\\packs\\whisper-base\\1.0.0",
      descriptorText: JSON.stringify(whisperDescriptor()),
    });
    expect(described?.id).toBe("whisper-base");
    expect(described?.descriptor.engine).toBe("whisper");
  });

  it("returns null rather than throwing for a folder that is not a voice pack", () => {
    expect(
      describeVoicePack({ id: "x", version: "1", directory: "/x", descriptorText: "not json" }),
    ).toBeNull();
    expect(
      describeVoicePack({ id: "x", version: "1", directory: "/x", descriptorText: '{"format":1}' }),
    ).toBeNull();
  });
});

describe("picking a pack", () => {
  const english = pack("mms-tts-eng", vitsDescriptor(["en"], "Xenova/mms-tts-eng"));
  const multilingual = pack("whisper-base", whisperDescriptor());
  const englishOnly = pack("whisper-tiny-en", {
    ...whisperDescriptor(),
    languages: ["en"],
    upstream: { repo: "Xenova/whisper-tiny.en", revision: "main" },
  });

  it("takes the caller's first pack for an automatic language", () => {
    expect(pickSttPack([englishOnly, multilingual], "auto")?.id).toBe("whisper-tiny-en");
    expect(pickSttPack([multilingual, englishOnly], "auto")?.id).toBe("whisper-base");
  });

  it("never falls back to a pack that does not declare the language", () => {
    expect(pickSttPack([englishOnly], "sr")).toBeNull();
    expect(pickSttPack([englishOnly, multilingual], "sr")?.id).toBe("whisper-base");
    expect(pickTtsPack([english], "sr")).toBeNull();
    expect(pickTtsPack([english], "en")?.id).toBe("mms-tts-eng");
  });

  it("ignores a pack of the other kind", () => {
    expect(pickSttPack([english], "auto")).toBeNull();
    expect(pickTtsPack([multilingual], "sr")).toBeNull();
  });

  it("answers whether a language can be spoken at all", () => {
    expect(speaksLanguage([english], "sr")).toBe(false);
    expect(speaksLanguage([english], "en")).toBe(true);
    expect(speaksLanguage([], "sr")).toBe(false);
  });

  it("accepts the absolute folders an installed pack lives in", () => {
    expect(voicePackDirectoryProblem("C:\\Users\\luka\\Nexus\\packs\\whisper-base\\1.0.0")).toBeNull();
    expect(voicePackDirectoryProblem("/home/luka/.config/Nexus/packs/whisper-base/1.0.0")).toBeNull();
    expect(voicePackDirectoryProblem("\\\\server\\share\\packs\\whisper-base")).toBeNull();
  });

  it("refuses a repository id and a URL, which the model loader would treat as something to fetch", () => {
    expect(voicePackDirectoryProblem("Xenova/whisper-base")).toMatch(/not an absolute path/);
    expect(voicePackDirectoryProblem("https://huggingface.co/Xenova/whisper-base")).toMatch(/is a URL/);
    expect(voicePackDirectoryProblem("file:///tmp/pack")).toMatch(/is a URL/);
    expect(voicePackDirectoryProblem("")).toMatch(/empty/);
  });
});
