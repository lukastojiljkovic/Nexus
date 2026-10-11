import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GGUF_LIMITS,
  GgufError,
  ggufFacts,
  ggufLicence,
  readGgufHeader,
  readGgufHeaderFromFile,
} from "./gguf.js";
import { buildGgufHeader, embeddingHeader, modelHeader, projectorHeader } from "./fixtures.js";

let directory: string;
let fixturePath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "nexus-gguf-"));
  fixturePath = join(directory, "fixture.gguf");
  writeFileSync(fixturePath, modelHeader());
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/**
 * The GGUF reader, on headers this test builds.
 *
 * The expectations that matter are the ones no real file can show on demand: a
 * file whose magic is wrong, a version this build does not read, a buffer that
 * ends in the middle of the metadata, and an array bigger than the reader keeps
 * (every real file has a 248 000-entry tokenizer array in front of the keys this
 * app wants, which is the case the skipping rule exists for).
 */
describe("readGgufHeader", () => {
  it("reads the magic, the version and the metadata a model declares", () => {
    const header = readGgufHeader(modelHeader());
    expect(header.version).toBe(3);
    expect(header.tensorCount).toBe(0);
    expect(header.metadataCount).toBe(10);
    expect(header.complete).toBe(true);
    expect(header.values.get("general.architecture")).toBe("qwen3");
    expect(header.values.get("qwen3.context_length")).toBe(32768);
  });

  it("refuses a file that is not a GGUF, and one this build cannot read", () => {
    expect(() => readGgufHeader(buildGgufHeader([], { magic: 0x12345678 }))).toThrow(GgufError);
    expect(() => readGgufHeader(modelHeader(), 8)).toThrow(/shorter than a GGUF header/);
    const v1 = buildGgufHeader([{ key: "general.architecture", value: "qwen3" }], { version: 1 });
    expect(() => readGgufHeader(v1)).toThrow(/version 1 is not a version/);
  });

  it("answers what it read when the buffer ends inside the metadata, and says so", () => {
    const whole = modelHeader();
    // One byte short of the last key's value: the keys before it are still true,
    // and `complete: false` is what tells the caller the difference between "the
    // file does not say" and "this read did not get that far".
    const cut = readGgufHeader(whole.subarray(0, whole.byteLength - 6));
    expect(cut.complete).toBe(false);
    expect(cut.values.get("general.architecture")).toBe("qwen3");
    expect(cut.values.get("tokenizer.chat_template")).toBeUndefined();
  });

  it("steps over an array too large to keep, and still reads the keys after it", () => {
    const tokens = Array.from({ length: 1000 }, (_unused, index) => `token-${String(index)}`);
    const header = readGgufHeader(
      buildGgufHeader([
        { key: "tokenizer.ggml.tokens", value: tokens },
        { key: "qwen3.context_length", value: 40960 },
      ]),
    );
    expect(header.complete).toBe(true);
    // Skipped, not materialised: a 260 000-entry array is megabytes of strings.
    expect(header.values.get("tokenizer.ggml.tokens")).toEqual([]);
    expect(header.values.get("qwen3.context_length")).toBe(40960);
  });

  it("keeps a small array whole, because one of them is a fact", () => {
    const header = readGgufHeader(modelHeader({ tags: ["unsloth", "image-text-to-text"] }));
    expect(header.values.get("general.tags")).toEqual(["unsloth", "image-text-to-text"]);
  });

  it("reads a file from disk with a bounded read", async () => {
    const header = await readGgufHeaderFromFile(fixturePath);
    expect(header.values.get("qwen3.context_length")).toBe(32768);
    expect(GGUF_LIMITS.headerBytes).toBe(32 * 1024 * 1024);
  });
});

/**
 * What the reader's facts mean, on the three shapes a user can pick: a chat
 * model, a vision projector, an embedding model.
 *
 * The vision answers are signals from the file itself (`general.tags`,
 * `general.type`, the `clip.*` keys) rather than a guess from the file's name,
 * and the signals are returned alongside the verdict so a reader can see which
 * key produced it.
 */
describe("ggufFacts", () => {
  it("reads a chat model's context length, template and licence", () => {
    const header = readGgufHeader(modelHeader());
    const facts = ggufFacts(header);
    expect(facts.architecture).toBe("qwen3");
    expect(facts.contextTokens).toBe(32768);
    expect(facts.chatTemplate).toContain("if tools");
    expect(facts.projector).toBe(false);
    expect(facts.vision).toBe(false);
    expect(facts.embedding).toBe(false);
    expect(ggufLicence(header)).toEqual({ name: "apache-2.0", url: "https://example.org/licence" });
  });

  it("recognises the projector beside a vision model, and never calls it a model", () => {
    const facts = ggufFacts(readGgufHeader(projectorHeader()));
    expect(facts.projector).toBe(true);
    expect(facts.architecture).toBe("clip");
    expect(facts.signals).toContain("general.type=mmproj");
    expect(facts.signals).toContain("general.architecture=clip");
  });

  it("marks a model that declares image input as needing a projector", () => {
    const facts = ggufFacts(readGgufHeader(modelHeader({ tags: ["image-text-to-text"] })));
    expect(facts.vision).toBe(true);
    expect(facts.projector).toBe(false);
    expect(facts.signals).toContain("general.tags=image-text-to-text");
  });

  it("marks an embedding model by its pooling key", () => {
    const facts = ggufFacts(readGgufHeader(embeddingHeader()));
    expect(facts.embedding).toBe(true);
    expect(facts.signals.join(" ")).toContain("pooling");
  });

  it("answers nulls for a file that declares nothing", () => {
    const facts = ggufFacts(readGgufHeader(buildGgufHeader([])));
    expect(facts.architecture).toBeNull();
    expect(facts.contextTokens).toBeNull();
    expect(facts.chatTemplate).toBeNull();
  });

  it("falls back to any architecture's context length when the prefix is unknown", () => {
    const header = readGgufHeader(
      buildGgufHeader([
        { key: "general.architecture", value: "some-future-arch" },
        { key: "some-future-arch.context_length", value: 65536 },
      ]),
    );
    expect(ggufFacts(header).contextTokens).toBe(65536);
  });
});
