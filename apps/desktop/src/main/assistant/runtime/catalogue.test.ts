import { describe, expect, it } from "vitest";

import { activeParametersOf, bundledCatalogue, fitOf, parseCatalogue, parseEntry } from "./catalogue.js";
import { CHAT_CONTEXT_TOKENS } from "./recommend.js";
import raw from "./catalogue.json";

/**
 * The catalogue that ships inside the app.
 *
 * It is written by `scripts/assistant-catalogue.mjs` and covered by the app's own
 * release signature (ADR-096), so the assertions here are about DRIFT rather than
 * about trust: the file must still parse into the shape the runtime acts on, the
 * numbers in it must still be plausible for a real model file, and the context
 * every fit was measured at must still be the context the runtime loads. A
 * refresh that breaks one of these is a refresh that changed a promise.
 */
describe("the bundled catalogue", () => {
  it("parses, and names the eight models this run curated", () => {
    const entries = bundledCatalogue();
    expect(entries).toHaveLength(8);
    expect(entries.map((entry) => entry.id)).toEqual([
      "qwen3.5-4b-q4-k-m",
      "qwen3.5-9b-q4-k-m",
      "qwen3.5-27b-q4-k-m",
      "gemma-4-e2b-it-q4-0",
      "gemma-4-e4b-it-q4-0",
      "gemma-4-12b-it-q4-0",
      "slava-qwen3-14b-serbian-q4-k-m",
      "qwen3-embedding-0.6b-q8-0",
    ]);
  });

  it("carries a real hash, a real size and a licence a user can read", () => {
    for (const entry of bundledCatalogue()) {
      expect(entry.sha256, entry.id).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.sizeBytes, entry.id).toBeGreaterThan(0);
      expect(entry.quantization, entry.id).not.toBe("");
      expect(entry.contextTokens, entry.id).toBeGreaterThan(0);
      expect(entry.licence.name, entry.id).not.toBe("");
      expect(entry.licence.url, entry.id).toMatch(/^https:\/\//);
    }
  });

  it("states the active parameters the tiers are ordered by, and the pair the rule exists for", () => {
    // ADR-113: a whole number the model's own card states, positive on every
    // entry — the chooser has nothing to rank an entry without one, which is why
    // this file's reader refuses one.
    for (const entry of bundledCatalogue()) {
      expect(activeParametersOf(entry), entry.id).toBeGreaterThan(0);
    }
    // Gemma 4's E-models carry per-layer embedding tables, which are lookups
    // rather than matrix work: E2B's file is BIGGER than Qwen3.5 4B's while its
    // card states the smaller count. This pair is why file size no longer orders
    // the tiers: a size-ordered list makes Qwen3.5 4B `speed` and E2B the tier
    // above it, which is backwards on any machine that fits both.
    const e2b = bundledCatalogue().find((entry) => entry.id === "gemma-4-e2b-it-q4-0");
    const qwen4b = bundledCatalogue().find((entry) => entry.id === "qwen3.5-4b-q4-k-m");
    if (e2b === undefined || qwen4b === undefined) throw new Error("the pair this test is about is not in the list");
    expect(e2b.sizeBytes).toBeGreaterThan(qwen4b.sizeBytes);
    expect(activeParametersOf(e2b) ?? 0).toBeLessThan(activeParametersOf(qwen4b) ?? 0);
  });

  it("measures every chat entry, at the context the runtime loads", () => {
    for (const entry of bundledCatalogue()) {
      const fit = fitOf(entry);
      expect(fit, entry.id).not.toBeNull();
      // The size the estimator attributed to the card is within a few percent of
      // the file's own size — the estimator pads and aligns, so equality is not
      // the property; "the same order of magnitude and not a different model" is.
      expect(fit?.vramBytes ?? 0, entry.id).toBeGreaterThan(entry.sizeBytes * 0.5);
      expect(fit?.vramBytes ?? 0, entry.id).toBeLessThan(entry.sizeBytes * 3);
      // The two placements are padded slightly differently by the estimator (the
      // card's copy of the weights is aligned, the host's is not), so the CPU
      // total can be a few hundred bytes SMALLER than the card total for the same
      // model. A one-percent band is what "the same model either way" means.
      expect(fit?.cpuRamBytes ?? 0, entry.id).toBeGreaterThan((fit?.vramBytes ?? 0) * 0.99);
      expect(fit?.cpuRamBytes ?? 0, entry.id).toBeGreaterThan(entry.sizeBytes);
      if (entry.capabilities.includes("chat")) {
        expect(fit?.contextTokens, entry.id).toBe(CHAT_CONTEXT_TOKENS);
      }
    }
  });

  it("offers the vision projector of a model that declares one, and never claims vision", () => {
    const visionCapable = bundledCatalogue().filter((entry) => entry.projector !== undefined);
    expect(visionCapable.map((entry) => entry.id).sort()).toEqual([
      "gemma-4-12b-it-q4-0",
      "gemma-4-e2b-it-q4-0",
      "gemma-4-e4b-it-q4-0",
      "qwen3.5-27b-q4-k-m",
      "qwen3.5-4b-q4-k-m",
      "qwen3.5-9b-q4-k-m",
    ]);
    for (const entry of visionCapable) {
      expect(entry.projector?.sha256, entry.id).toMatch(/^[0-9a-f]{64}$/);
      // node-llama-cpp 3.22.1 has no multimodal path, so NO entry claims `vision`
      // (ADR-096): the projector is recorded so the day the runtime can use one
      // the entry is complete, and nothing offers an image before then.
      expect(entry.capabilities, entry.id).not.toContain("vision");
    }
    for (const entry of bundledCatalogue()) {
      expect(entry.capabilities, entry.id).not.toContain("vision");
    }
  });

  it("names the one Serbian entry, and the one with a use-restricted licence", () => {
    const serbian = bundledCatalogue().find((entry) => entry.id.startsWith("slava-"));
    expect(serbian?.languages).toEqual(["sr"]);
    expect(serbian?.licence.name).toBe("CC-BY-NC-SA-4.0");
    // Everything else declares no language code at all — which is what the Hub
    // says, and the fact a Serbian reader most needs to see.
    for (const entry of bundledCatalogue()) {
      if (entry.id.startsWith("slava-")) continue;
      expect(entry.languages, entry.id).toEqual([]);
    }
  });

  it("keeps the catalogue's own format under the reader's control", () => {
    // The file is ours, so an id read twice or an entry without a licence is a
    // mistake in the list rather than a fact about a model.
    const base = {
      format: 1,
      checked: "2026-10-10",
      models: [raw.models[0]],
    };
    expect(parseCatalogue(base)).toHaveLength(1);
    expect(() => parseCatalogue({ ...base, format: 2 })).toThrow(/format/);
    expect(() => parseCatalogue({ format: 1, models: [raw.models[0], raw.models[0]] })).toThrow(/twice/);
    expect(() =>
      parseCatalogue({
        format: 1,
        models: [{ ...raw.models[0], licence: { name: "", url: "" } }],
      }),
    ).toThrow(/licence/);
    expect(() =>
      parseCatalogue({ format: 1, models: [{ ...raw.models[0], surprise: true }] }),
    ).toThrow(/unknown field/);
    expect(() =>
      parseCatalogue({ format: 1, models: [{ ...raw.models[0], sha256: "not-a-hash" }] }),
    ).toThrow(/SHA-256/);
    expect(() =>
      parseCatalogue({ format: 1, models: [{ ...raw.models[0], origin: "torrent" }] }),
    ).toThrow(/origin/);
    expect(() =>
      parseCatalogue({ format: 1, models: [{ ...raw.models[0], capabilities: ["telepathy"] }] }),
    ).toThrow(/capability/);
    expect(() =>
      parseCatalogue({ format: 1, models: [{ ...raw.models[0], id: "Bad Id" }] }),
    ).toThrow(/not an id/);
    // The count the tiers are ordered by is the list's, not a search result's:
    // an entry without one has nothing the chooser could rank it by.
    const first = raw.models[0];
    if (first === undefined) throw new Error("the catalogue has no first entry to copy");
    const { activeParameters: _drop, ...withoutCount } = first;
    expect(() => parseCatalogue({ format: 1, models: [withoutCount] })).toThrow(/active parameter/);
    expect(() =>
      parseCatalogue({ format: 1, models: [{ ...raw.models[0], activeParameters: 0 }] }),
    ).toThrow(/activeParameters/);
  });

  it("accepts an imported file's entry, whose licence may be unstated", () => {
    const imported = parseEntry(
      {
        id: "imported-qwen3-4b-1a2b3c4d",
        origin: "file",
        title: "Qwen3-4B-Q4_K_M",
        family: "qwen3",
        repo: "",
        file: "Qwen3-4B-Q4_K_M.gguf",
        sha256: "b".repeat(64),
        sizeBytes: 1024,
        contextTokens: 32768,
        capabilities: ["chat"],
        languages: [],
        licence: { name: "", url: "" },
        path: "D:\\models\\Qwen3-4B-Q4_K_M.gguf",
      },
      "the installed registry",
    );
    expect(imported.origin).toBe("file");
    expect(imported.path).toBe("D:\\models\\Qwen3-4B-Q4_K_M.gguf");
    expect(imported.quantization).toBe("Q4_K_M");
    // No fit: nobody measured this file, so the chooser skips it rather than
    // assuming it fits.
    expect(fitOf(imported)).toBeNull();
  });

  it("reads the per-model policy an entry states, and refuses the values the runtime cannot act on", () => {
    const entry = {
      id: "policy-model-1a2b3c4d",
      origin: "file",
      title: "Policy model",
      family: "policy",
      repo: "",
      file: "policy.gguf",
      sha256: "c".repeat(64),
      sizeBytes: 1024,
      contextTokens: 32768,
      capabilities: ["chat"],
      languages: [],
      licence: { name: "", url: "" },
      path: "D:\\models\\policy.gguf",
    };
    const stated = {
      contextCap: 16384,
      thoughtTokens: 1024,
      sampling: { temperature: 0.6, topP: 0.95, topK: 20, repeatPenalty: 1.05 },
    };
    expect(parseEntry({ ...entry, ...stated }, "the installed registry")).toMatchObject(stated);
    // An empty block is accepted: it states nothing, so the library's defaults stand.
    expect(parseEntry({ ...entry, sampling: {} }, "the installed registry").sampling).toEqual({});

    expect(() => parseEntry({ ...entry, contextCap: 0 }, "the registry")).toThrow(/contextCap/);
    expect(() => parseEntry({ ...entry, contextCap: 1.5 }, "the registry")).toThrow(/contextCap/);
    expect(() => parseEntry({ ...entry, thoughtTokens: 0 }, "the registry")).toThrow(/thoughtTokens/);
    expect(() => parseEntry({ ...entry, sampling: { temperature: 9 } }, "the registry")).toThrow(/temperature/);
    expect(() => parseEntry({ ...entry, sampling: { topP: 1.5 } }, "the registry")).toThrow(/topP/);
    expect(() => parseEntry({ ...entry, sampling: { topK: -1 } }, "the registry")).toThrow(/topK/);
    expect(() => parseEntry({ ...entry, sampling: { repeatPenalty: 0.5 } }, "the registry")).toThrow(/repeatPenalty/);
    expect(() => parseEntry({ ...entry, sampling: { mirostat: 2 } }, "the registry")).toThrow(/unknown field/);
  });
});
