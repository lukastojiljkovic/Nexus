import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { checkMeta } from "../../pack-sign.mjs";
import {
  assemble,
  cacheDirectory,
  descriptorFor,
  fileUrl,
  harvest,
  loadSources,
  metadataFor,
  packDirectory,
  parseArgs,
  sourcesWithMeasured,
  voiceById,
  VOICE_DESCRIPTOR_FILE,
} from "./build.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The real upstream `config.json` of each voice, cut to a few kilobytes and committed. */
function fixtureConfig(id) {
  return JSON.parse(readFileSync(join(HERE, "fixtures", id, "config.json"), "utf8"));
}

const sources = loadSources();
/** A scratch tree for the download half, removed when the file is done. */
const scratch = mkdtempSync(join(tmpdir(), "nexus-voice-build-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Writes a voice's files into a cache directory, with `config.json` from the real fixture. */
function fillCache(voice, id) {
  const cacheDir = join(scratch, "cache", id);
  for (const path of voice.paths) {
    const file = join(cacheDir, ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, path === "config.json" ? readFileSync(join(HERE, "fixtures", id, "config.json")) : `not really ${path}\n`);
  }
  return cacheDir;
}

describe("sources.json", () => {
  it("loads, and every voice in it is buildable", () => {
    expect(sources.voices.length).toBeGreaterThanOrEqual(4);
    expect(sources.voices.map((voice) => voice.id)).toEqual([
      "whisper-tiny",
      "whisper-base",
      "whisper-small",
      "mms-tts-eng",
    ]);
  });

  it("states which Whisper sizes are speech models and which voice is a voice", () => {
    const kinds = sources.voices.map((voice) => [voice.id, voice.kind, voice.engine]);
    expect(kinds).toEqual([
      ["whisper-tiny", "stt", "whisper"],
      ["whisper-base", "stt", "whisper"],
      ["whisper-small", "stt", "whisper"],
      ["mms-tts-eng", "tts", "vits"],
    ]);
  });

  it("carries the licence evidence for every source, with a URL and a quoted sentence", () => {
    for (const voice of sources.voices) {
      expect(voice.evidence.length).toBeGreaterThan(0);
      for (const evidence of voice.evidence) {
        expect(evidence.url).toMatch(/^https:\/\//);
        expect(evidence.sentence.trim()).not.toBe("");
      }
      expect(voice.licence.attribution.trim()).not.toBe("");
    }
  });

  it("quotes the licence the two real sources actually state", () => {
    const whisper = sources.voices.find((voice) => voice.id === "whisper-base");
    expect(whisper?.licence.spdx).toBe("Apache-2.0");
    expect(whisper?.evidence[0].sentence).toContain("license: apache-2.0");
    const voice = sources.voices.find((entry) => entry.id === "mms-tts-eng");
    expect(voice?.licence.spdx).toBe("CC-BY-NC-4.0");
    expect(voice?.evidence[0].sentence).toBe("license: cc-by-nc-4.0");
  });

  it("names the file that is not the model's own, and every file it copies", () => {
    const voice = voiceById(sources, "mms-tts-eng");
    expect(voice.paths).toContain("onnx/model_quantized.onnx");
    // The descriptor the builder adds is NOT in `paths`: the builder writes it,
    // so listing it would mean copying a file that is not in the cache.
    expect(voice.paths).not.toContain(VOICE_DESCRIPTOR_FILE);
  });
});

describe("descriptorFor", () => {
  it("builds the descriptor this app's packs.ts accepts, from the real configs", () => {
    // The two fixtures are the upstream `config.json` files themselves, so this
    // is the real model_type and the real sampling_rate.
    expect(descriptorFor(voiceById(sources, "whisper-base"), fixtureConfig("whisper-base"))).toEqual({
      format: 1,
      kind: "stt",
      engine: "whisper",
      languages: ["sr", "en"],
      sampleRate: 16_000,
      upstream: { repo: "Xenova/whisper-base", revision: "main" },
    });
    expect(descriptorFor(voiceById(sources, "mms-tts-eng"), fixtureConfig("mms-tts-eng"))).toEqual({
      format: 1,
      kind: "tts",
      engine: "vits",
      languages: ["en"],
      sampleRate: 16_000,
      upstream: { repo: "Xenova/mms-tts-eng", revision: "main" },
    });
  });

  it("refuses a config whose model_type is not the engine the entry declares", () => {
    expect(() => descriptorFor(voiceById(sources, "whisper-base"), fixtureConfig("mms-tts-eng"))).toThrow(
      /descriptor says "whisper" but config.json says "vits"/,
    );
    expect(() => descriptorFor(voiceById(sources, "mms-tts-eng"), { model_type: "vits", sampling_rate: 22_050 })).toThrow(
      /descriptor says 16000 Hz but config.json says 22050/,
    );
  });
});

describe("metadataFor", () => {
  it("is metadata pack-sign.mjs signs without complaint", () => {
    for (const voice of sources.voices) {
      const metadata = metadataFor(voice);
      expect(() => checkMeta(metadata)).not.toThrow();
      expect(metadata.kind).toBe("model");
      expect(metadata.title.sr).not.toBe(metadata.title.en);
      expect(metadata.files).toBeUndefined();
    }
  });

  it("does not mutate the voice entry it was given", () => {
    const voice = voiceById(sources, "whisper-base");
    const before = JSON.stringify(voice);
    metadataFor(voice);
    expect(JSON.stringify(voice)).toBe(before);
  });
});

describe("fileUrl", () => {
  it("is an https URL under the declared host, never a local path", () => {
    const url = fileUrl(sources, voiceById(sources, "whisper-base"), "onnx/encoder_model_quantized.onnx");
    expect(url).toBe("https://huggingface.co/Xenova/whisper-base/resolve/main/onnx/encoder_model_quantized.onnx");
    expect(url.startsWith(`${sources.host}/`)).toBe(true);
  });
});

describe("harvest", () => {
  // The voice as it is on the day it is first built: declared, with no recorded
  // hashes yet. `sources.json` is a committed file that fills up as packs are
  // built, so a test that asserted against the current document would start
  // failing the day somebody ran the builder.
  const voice = { ...voiceById(sources, "whisper-tiny"), files: {}, harvestedAt: null };
  const unbuilt = { ...sources, voices: sources.voices.map((entry) => (entry.id === voice.id ? voice : entry)) };

  it("fetches what is not cached, records its hash, and reuses it next time", async () => {
    const cacheDir = join(scratch, "harvest", "whisper-tiny");
    const fetched = [];
    const fetchImpl = (url) => {
      fetched.push(url);
      return Promise.resolve(new Response(Buffer.from(`body of ${url}\n`)));
    };
    const first = await harvest({ sources: unbuilt, voice, cacheDir, fetchImpl });
    expect(first.length).toBe(voice.paths.length);
    expect(fetched.length).toBe(voice.paths.length);
    expect(first[0].sha256).toMatch(/^[0-9a-f]{64}$/);

    // The second pass has the recorded hashes, so nothing is fetched again.
    const withHashes = sourcesWithMeasured(unbuilt, "whisper-tiny", first, "2026-10-10");
    const second = await harvest({ sources: withHashes, voice: voiceById(withHashes, "whisper-tiny"), cacheDir, fetchImpl });
    expect(fetched.length).toBe(voice.paths.length);
    expect(second).toEqual(first);
  });

  it("refuses a cache file whose bytes do not match the recorded hash", async () => {
    const cacheDir = join(scratch, "harvest-mismatch");
    const withHashes = sourcesWithMeasured(sources, "whisper-tiny", [{ path: "config.json", bytes: 1, sha256: "0".repeat(64) }], "2026-10-10");
    const broken = voiceById(withHashes, "whisper-tiny");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "config.json"), "not the file the hash names\n");
    await expect(
      harvest({
        sources: withHashes,
        voice: broken,
        cacheDir,
        fetchImpl: () => Promise.resolve(new Response(Buffer.from("different again\n"))),
      }),
    ).rejects.toThrow(/hashes .*, and sources.json says 0{64}/);
  });
});

describe("assemble", () => {
  const packsRoot = join(scratch, "packs");

  it("writes the model's files plus voice.json, and the descriptor in it is the one packs.ts reads", () => {
    const voice = voiceById(sources, "mms-tts-eng");
    const cacheDir = fillCache(voice, "mms-tts-eng");
    const packDir = packDirectory("mms-tts-eng", packsRoot);
    const assembled = assemble({ voice, cacheDir, packDir, packsRoot });

    const written = JSON.parse(readFileSync(join(packDir, VOICE_DESCRIPTOR_FILE), "utf8"));
    expect(written).toEqual(assembled.descriptor);
    expect(written.kind).toBe("tts");
    expect(written.engine).toBe("vits");
    // The descriptor is NOT copied from the cache; it is written here.
    expect(assembled.bytes).toBeGreaterThan(assembled.descriptorBytes.byteLength);
    for (const path of voice.paths) {
      expect(() => readFileSync(join(packDir, ...path.split("/")))).not.toThrow();
    }
  });

  it("refuses to write outside the packs folder", () => {
    const voice = voiceById(sources, "mms-tts-eng");
    const cacheDir = fillCache(voice, "mms-tts-eng");
    expect(() =>
      assemble({ voice, cacheDir, packDir: join(scratch, "elsewhere"), packsRoot }),
    ).toThrow(/refusing to write outside/);
  });
});

describe("sourcesWithMeasured", () => {
  it("changes only the one entry's files and harvest date", () => {
    const updated = sourcesWithMeasured(sources, "whisper-base", [{ path: "config.json", bytes: 3, sha256: "a".repeat(64) }], "2026-10-10");
    expect(updated.voices[1].files).toEqual({ "config.json": "a".repeat(64) });
    expect(updated.voices[1].harvestedAt).toBe("2026-10-10");
    expect(updated.voices[1].licence).toEqual(sources.voices[1].licence);
    expect(updated.voices[0]).toEqual(sources.voices[0]);
    // The original is not modified in place.
    expect(sources.voices[1].files).not.toEqual({ "config.json": "a".repeat(64) });
  });

  it("accumulates across voices, so a second build does not drop the first voice's hashes", () => {
    // `main` records one voice at a time, and the bug this pins was real: the
    // loop wrote a fresh document built from a snapshot taken before the first
    // voice, so a multi-voice build left only the LAST voice's file list in
    // sources.json and the file that exists to be checked against was wrong.
    const once = sourcesWithMeasured(sources, "whisper-tiny", [{ path: "config.json", bytes: 3, sha256: "b".repeat(64) }], "2026-10-10");
    const twice = sourcesWithMeasured(once, "mms-tts-eng", [{ path: "vocab.json", bytes: 4, sha256: "c".repeat(64) }], "2026-10-10");
    expect(twice.voices[0].files).toEqual({ "config.json": "b".repeat(64) });
    expect(twice.voices[3].files).toEqual({ "vocab.json": "c".repeat(64) });
  });
});

describe("parseArgs", () => {
  it("reads the two forms the CLI takes", () => {
    expect(parseArgs(["--voice", "a,b"])).toMatchObject({ voices: ["a", "b"], updateSources: false });
    expect(parseArgs(["--all"])).toMatchObject({ voices: null });
    expect(parseArgs(["--voice", "a", "--update-sources"])).toMatchObject({ voices: ["a"], updateSources: true });
  });

  it("refuses an argument it does not know, and a flag with no value", () => {
    expect(() => parseArgs(["--voices", "a"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--voice"])).toThrow(/needs a value/);
    expect(() => parseArgs([])).toThrow(/pass --voice/);
  });
});

describe("cacheDirectory", () => {
  it("puts every voice under one root, so a re-run reuses the cache", () => {
    expect(cacheDirectory("whisper-base", "C:\\cache")).toBe(join("C:\\cache", "whisper-base"));
    expect(packDirectory("whisper-base", "C:\\packs")).toBe(join("C:\\packs", "whisper-base"));
  });
});

describe("loadSources", () => {
  it("refuses a source entry with no licence evidence", () => {
    const file = join(scratch, "no-evidence.json");
    const broken = JSON.parse(JSON.stringify(sources));
    broken.voices[0].evidence = [];
    writeFileSync(file, JSON.stringify(broken));
    expect(() => loadSources(file)).toThrow(/evidence/);
  });

  it("refuses an unpinned revision and an engine that cannot do the kind", () => {
    const file = join(scratch, "bad-entry.json");
    const floating = JSON.parse(JSON.stringify(sources));
    floating.voices[0].revision = "some-branch";
    writeFileSync(file, JSON.stringify(floating));
    expect(() => loadSources(file)).toThrow(/revision/);

    const wrongEngine = JSON.parse(JSON.stringify(sources));
    wrongEngine.voices[0].engine = "vits";
    writeFileSync(file, JSON.stringify(wrongEngine));
    expect(() => loadSources(file)).toThrow(/is never a "stt" pack/);
  });
});
