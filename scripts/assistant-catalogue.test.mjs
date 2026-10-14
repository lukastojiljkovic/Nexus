import { describe, expect, it } from "vitest";

import {
  activeParametersOf,
  CATALOGUE_PATH,
  FIT_CONTEXT_TOKENS,
  languagesFromCard,
  measuredFromTree,
  parseArgs,
  refresh,
  serializeCatalogue,
  treeUrl,
} from "./assistant-catalogue.mjs";

/**
 * The catalogue refresher, on a fixture of the Hub's own reply shape.
 *
 * The tool's whole job is to copy a file's SHA-256 and size out of that reply,
 * so the two properties worth pinning are the ones that decide whether the
 * copied number is trustworthy: a file whose digest the Hub does not publish
 * (a gated repository answers with asterisks) must be a REFUSAL rather than a
 * written entry, and the projector is measured by the same rule as the model.
 *
 * `refresh` is exercised through its own seam — the `fetchJson` the CLI supplies
 * with a real request — so the tool's decisions (which fields are human, what is
 * refused before a request is made, what a refresh leaves alone) are pinned
 * without depending on a repository someone may edit tomorrow. The arithmetic
 * itself is in the app's own tests (`runtime/catalogue.test.ts`), which is where
 * a wrong number would surface.
 */
const TREE = [
  { type: "file", path: "README.md", size: 100 },
  {
    type: "file",
    path: "gemma-4-E2B_q4_0-it.gguf",
    size: 3_349_516_256,
    lfs: {
      oid: "fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634",
      size: 3_349_516_256,
    },
  },
  {
    type: "file",
    path: "gemma-4-E2B-it-mmproj.gguf",
    size: 986_833_664,
    lfs: {
      oid: "021059cce659fe7f9170d5599761d7bbaf644b798dab9503aca30dc43e6beb14",
      size: 986_833_664,
    },
  },
];

const ENTRY = {
  id: "gemma-4-e2b-it-q4-0",
  repo: "google/gemma-4-E2B-it-qat-q4_0-gguf",
  file: "gemma-4-E2B_q4_0-it.gguf",
  projectorFile: "gemma-4-E2B-it-mmproj.gguf",
};

describe("measuredFromTree", () => {
  it("copies the digest and the size the Hub publishes, and the projector's too", () => {
    expect(measuredFromTree(ENTRY, TREE)).toEqual({
      sha256: "fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634",
      sizeBytes: 3_349_516_256,
      projector: {
        file: "gemma-4-E2B-it-mmproj.gguf",
        sha256: "021059cce659fe7f9170d5599761d7bbaf644b798dab9503aca30dc43e6beb14",
        sizeBytes: 986_833_664,
      },
    });
  });

  it("refuses a file the listing does not carry", () => {
    expect(() => measuredFromTree({ ...ENTRY, file: "nothing.gguf" }, TREE)).toThrow(/is not in/);
    expect(() => measuredFromTree({ ...ENTRY, projectorFile: "nothing.gguf" }, TREE)).toThrow(/projector/);
  });

  it("refuses a masked digest rather than writing a hash nobody can verify", () => {
    // This is what a gated repository answers with: 64 asterisks where the
    // SHA-256 belongs. An entry written from that would be a download this app
    // could never verify, which is the one thing the download service refuses.
    const masked = TREE.map((file) =>
      file.path === ENTRY.file ? { ...file, lfs: { oid: "*".repeat(64), size: 3_349_516_256 } } : file,
    );
    expect(() => measuredFromTree(ENTRY, masked)).toThrow(/no SHA-256/);
  });

  it("refuses a listing that is not a list, and a file with no usable size", () => {
    expect(() => measuredFromTree(ENTRY, { files: [] })).toThrow(/not an array/);
    // No LFS size and no plain size: a `.gguf` is always an LFS object, so a
    // listing without either is a reply this tool will not write from.
    const sizeless = TREE.map((file) =>
      file.path === ENTRY.file ? { type: "file", path: file.path, lfs: { oid: "a".repeat(64) } } : file,
    );
    expect(() => measuredFromTree(ENTRY, sizeless)).toThrow(/no usable size/);
  });
});

describe("languagesFromCard", () => {
  it("keeps codes and refuses a language NAME rather than guessing a code", () => {
    expect(languagesFromCard(ENTRY, { cardData: { language: ["sr", "en", "sr"] } })).toEqual(["en", "sr"]);
    expect(languagesFromCard(ENTRY, { cardData: {} })).toEqual([]);
    expect(languagesFromCard(ENTRY, {})).toEqual([]);
    // A card that says "serbian" is a card this tool refuses to interpret: the
    // fix belongs in the card, and a wrong code in a signed file cannot be fixed.
    expect(() => languagesFromCard(ENTRY, { cardData: { language: "serbian" } })).toThrow(/not a code/);
  });
});

/** `ENTRY` with the two human fields `refresh` verifies but never writes. */
const OFFERED = {
  ...ENTRY,
  activeParameters: 2_300_000_000,
  licence: { name: "Apache-2.0", url: "https://example.org/licence" },
};

describe("activeParametersOf", () => {
  it("keeps the plain integer a model's card states", () => {
    expect(activeParametersOf(OFFERED)).toBe(2_300_000_000);
  });

  it("refuses an entry that states no positive whole count", () => {
    // A human field with three ways to be wrong: absent, zero, and a card's
    // decimal written through. Each is an entry the chooser cannot rank.
    expect(() => activeParametersOf(ENTRY)).toThrow(/active parameter/);
    expect(() => activeParametersOf({ ...ENTRY, activeParameters: 0 })).toThrow(/active parameter/);
    expect(() => activeParametersOf({ ...ENTRY, activeParameters: 2.3 })).toThrow(/active parameter/);
  });
});

describe("refresh", () => {
  const card = { cardData: { language: [] } };

  it("leaves the human fields where they were, the count included", async () => {
    const catalogue = { format: 1, checked: "2026-10-10", models: [OFFERED] };
    const fetchJson = (url) => Promise.resolve(url.includes("/tree/") ? TREE : card);
    const next = await refresh(catalogue, { fit: false, check: false, fetchJson, llamaCpp: undefined });
    expect(next.models[0]).toMatchObject({
      id: ENTRY.id,
      repo: ENTRY.repo,
      file: ENTRY.file,
      activeParameters: 2_300_000_000,
      licence: OFFERED.licence,
      projectorFile: ENTRY.projectorFile,
      sha256: "fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634",
      sizeBytes: 3_349_516_256,
    });
  });

  it("refuses an entry without a count before it asks the Hub anything", async () => {
    let asked = 0;
    const fetchJson = () => {
      asked += 1;
      return Promise.resolve([]);
    };
    const catalogue = {
      format: 1,
      models: [{ ...ENTRY, licence: OFFERED.licence }],
    };
    await expect(refresh(catalogue, { fit: false, check: false, fetchJson, llamaCpp: undefined })).rejects.toThrow(
      /active parameter/,
    );
    expect(asked).toBe(0);
  });
});

describe("the tool's own edges", () => {
  it("takes only the two flags it knows", () => {
    expect(parseArgs([])).toEqual({ fit: false, check: false });
    expect(parseArgs(["--fit", "--check"])).toEqual({ fit: true, check: true });
    expect(() => parseArgs(["--force"])).toThrow(/unknown argument/);
  });

  it("writes the file with one stable layout", () => {
    const once = serializeCatalogue({ format: 1, models: [] });
    expect(once.endsWith("\n")).toBe(true);
    expect(serializeCatalogue(JSON.parse(once))).toBe(once);
  });

  it("names the file and the endpoint it writes", () => {
    expect(CATALOGUE_PATH.endsWith("catalogue.json")).toBe(true);
    expect(treeUrl("google/gemma-4-E2B-it-qat-q4_0-gguf")).toBe(
      "https://huggingface.co/api/models/google/gemma-4-E2B-it-qat-q4_0-gguf/tree/main?recursive=true",
    );
  });

  it("states the context it makes its estimates at", () => {
    // The app's `CHAT_CONTEXT_TOKENS` is 8192 and `catalogue.test.ts` holds the
    // two together; this is the same number from the tool's side.
    expect(FIT_CONTEXT_TOKENS).toBe(8192);
  });
});
