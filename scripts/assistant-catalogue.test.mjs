import { describe, expect, it } from "vitest";

import {
  CATALOGUE_PATH,
  FIT_CONTEXT_TOKENS,
  languagesFromCard,
  measuredFromTree,
  parseArgs,
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
 * The network half (`refresh`) is not tested here: it reads a live repository,
 * and a test that did that would be a test that fails when someone edits a
 * README. Its arithmetic is in the app's own tests instead
 * (`runtime/catalogue.test.ts`), which is where a wrong number would surface.
 */
const TREE = [
  { type: "file", path: "README.md", size: 100 },
  {
    type: "file",
    path: "Qwen3.5-2B-Q4_K_M.gguf",
    size: 1_280_835_840,
    lfs: { oid: "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223", size: 1_280_835_840 },
  },
  {
    type: "file",
    path: "mmproj-F16.gguf",
    size: 668_227_264,
    lfs: { oid: "7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7", size: 668_227_264 },
  },
];

const ENTRY = {
  id: "qwen3.5-2b-q4-k-m",
  repo: "unsloth/Qwen3.5-2B-GGUF",
  file: "Qwen3.5-2B-Q4_K_M.gguf",
  projectorFile: "mmproj-F16.gguf",
};

describe("measuredFromTree", () => {
  it("copies the digest and the size the Hub publishes, and the projector's too", () => {
    expect(measuredFromTree(ENTRY, TREE)).toEqual({
      sha256: "aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223",
      sizeBytes: 1_280_835_840,
      projector: {
        file: "mmproj-F16.gguf",
        sha256: "7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7",
        sizeBytes: 668_227_264,
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
      file.path === ENTRY.file ? { ...file, lfs: { oid: "*".repeat(64), size: 1_280_835_840 } } : file,
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
    expect(treeUrl("unsloth/Qwen3.5-2B-GGUF")).toBe(
      "https://huggingface.co/api/models/unsloth/Qwen3.5-2B-GGUF/tree/main?recursive=true",
    );
  });

  it("states the context it makes its estimates at", () => {
    // The app's `CHAT_CONTEXT_TOKENS` is 8192 and `catalogue.test.ts` holds the
    // two together; this is the same number from the tool's side.
    expect(FIT_CONTEXT_TOKENS).toBe(8192);
  });
});
