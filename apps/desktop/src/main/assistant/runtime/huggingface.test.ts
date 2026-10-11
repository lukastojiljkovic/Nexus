import { describe, expect, it } from "vitest";

import { RuntimeError } from "./errors.js";
import { entriesFromTree, repositoriesFromSearch, searchHuggingFace } from "./huggingface.js";

/**
 * The Hugging Face search, against fixtures shaped like the Hub's own replies.
 *
 * The fixture files below are the SHAPES the API answered on 2026-10-10 —
 * `…/tree/main?recursive=true` listing `{type, path, size, lfs:{oid,size}}`, and
 * the model endpoint's `{cardData:{license, license_link, language}}` — so the
 * parser is pinned to what the Hub actually sends rather than to what a tidy
 * version of it would send.
 */
const TREE = [
  { type: "file", path: ".gitattributes", size: 3060, lfs: undefined },
  { type: "file", path: "mmproj-F16.gguf", size: 927607040, lfs: { oid: "1".repeat(64), size: 927607040 } },
  {
    type: "file",
    path: "Qwen3.5-27B-BF16-00001-of-00002.gguf",
    size: 49954637280,
    lfs: { oid: "2".repeat(64), size: 49954637280 },
  },
  {
    type: "file",
    path: "Qwen3.5-27B-BF16-00002-of-00002.gguf",
    size: 3853644192,
    lfs: { oid: "3".repeat(64), size: 3853644192 },
  },
  {
    type: "file",
    path: "Qwen3.5-27B-Q4_K_M.gguf",
    size: 16740812704,
    lfs: { oid: "4".repeat(64), size: 16740812704 },
  },
  // A gated repository answers with asterisks where the digest belongs.
  { type: "file", path: "Gated-Q4_K_M.gguf", size: 100, lfs: { oid: "*".repeat(64), size: 100 } },
  // A subdirectory is listed too, and a `.gguf` inside one is still a file.
  { type: "file", path: "IQ4/Part-IQ4_XS.gguf", size: 2048, lfs: { oid: "5".repeat(64), size: 2048 } },
];

const CARD = {
  id: "Qwen/Qwen3.5-27B-GGUF",
  cardData: {
    license: "apache-2.0",
    license_link: "https://huggingface.co/Qwen/Qwen3.5-27B/blob/main/LICENSE",
    language: ["sr", "en", "Some Language"],
  },
};

describe("repositoriesFromSearch", () => {
  it("keeps owner/name pairs and nothing else", () => {
    expect(
      repositoriesFromSearch([
        { id: "unsloth/Qwen3.5-4B-GGUF" },
        { id: "unsloth/Qwen3.5-4B-GGUF" }, // the Hub repeats repos across pages
        { id: "Qwen/Qwen3-VL-4B-Instruct-GGUF" },
        { id: "not a repo" },
        { id: "../../etc/passwd" },
        { id: "https://evil.example/repo" },
        { id: 42 },
        null,
      ]),
    ).toEqual(["unsloth/Qwen3.5-4B-GGUF", "Qwen/Qwen3-VL-4B-Instruct-GGUF"]);
  });

  it("refuses a reply that is not a list", () => {
    expect(() => repositoriesFromSearch({ models: [] })).toThrow(RuntimeError);
  });
});

describe("entriesFromTree", () => {
  it("offers one entry per downloadable file, with the Hub's hash and size", () => {
    const entries = entriesFromTree("Qwen/Qwen3.5-27B-GGUF", TREE, CARD);
    // Three of the seven files are offered: the single-file model, the gated one
    // is dropped for having no readable digest, the split pair is recognised and
    // skipped (a split model cannot be downloaded by this runtime — its
    // `ModelEntry` describes ONE file), and the projector is not a model.
    expect(entries.map((entry) => entry.file)).toEqual(["Qwen3.5-27B-Q4_K_M.gguf", "IQ4/Part-IQ4_XS.gguf"]);
    const main = entries[0];
    expect(main?.sha256).toBe("4".repeat(64));
    expect(main?.sizeBytes).toBe(16740812704);
    expect(main?.quantization).toBe("Q4_K_M");
    expect(main?.origin).toBe("huggingface");
    expect(main?.repo).toBe("Qwen/Qwen3.5-27B-GGUF");
    // Nobody has read this file's header yet, so the context is 0 = "not known",
    // never a made-up number.
    expect(main?.contextTokens).toBe(0);
    // A listing cannot prove tool calling, so a search result claims nothing.
    expect(main?.capabilities).toEqual(["chat"]);
    // Codes only, in order: "Some Language" is not a code and is refused rather
    // than guessed at.
    expect(main?.languages).toEqual(["en", "sr"]);
    expect(main?.licence).toEqual({
      name: "apache-2.0",
      url: "https://huggingface.co/Qwen/Qwen3.5-27B/blob/main/LICENSE",
    });
    expect(main?.id).toBe("qwen-qwen3-5-27b-gguf-qwen3-5-27b-q4-k-m");
  });

  it("falls back to the model page when the card names no licence URL", () => {
    const entries = entriesFromTree("someone/repo", TREE, { cardData: { license: ["apache-2.0", "mit"] } });
    expect(entries[0]?.licence).toEqual({ name: "apache-2.0, mit", url: "https://huggingface.co/someone/repo" });
  });

  it("refuses a listing that is not a list, rather than answering nothing", () => {
    expect(() => entriesFromTree("someone/repo", { files: [] }, CARD)).toThrow(RuntimeError);
  });
});

describe("searchHuggingFace", () => {
  const mode = (value: "offline" | "downloads") => () => value;
  const allowAll = () => true;

  it("refuses outside the downloads mode, before a URL is built", async () => {
    let asked = 0;
    await expect(
      searchHuggingFace(
        { mode: mode("offline"), isAllowedUrl: allowAll, httpJson: () => {
          asked += 1;
          return Promise.resolve([]);
        } },
        "qwen",
        new AbortController().signal,
      ),
    ).rejects.toThrow(/downloads network mode/);
    expect(asked).toBe(0);
  });

  it("refuses a URL the launch's allowlist does not admit", async () => {
    await expect(
      searchHuggingFace(
        { mode: mode("downloads"), isAllowedUrl: () => false, httpJson: () => Promise.resolve([]) },
        "qwen",
        new AbortController().signal,
      ),
    ).rejects.toThrow(/not one this launch may reach/);
  });

  it("answers an empty query with nothing and no request", async () => {
    let asked = 0;
    const entries = await searchHuggingFace(
      {
        mode: mode("downloads"),
        isAllowedUrl: allowAll,
        httpJson: () => {
          asked += 1;
          return Promise.resolve([]);
        },
      },
      "   ",
      new AbortController().signal,
    );
    expect(entries).toEqual([]);
    expect(asked).toBe(0);
  });

  it("skips a repository it cannot read and keeps the ones it can", async () => {
    const responses = new Map<string, unknown>([
      ["https://huggingface.co/api/models?search=qwen&filter=gguf&limit=6&sort=downloads&direction=-1", [
        { id: "gated/repo" },
        { id: "open/repo" },
      ]],
      ["https://huggingface.co/api/models/gated/repo/tree/main?recursive=true", null],
      ["https://huggingface.co/api/models/open/repo/tree/main?recursive=true", TREE],
      ["https://huggingface.co/api/models/open/repo", CARD],
    ]);
    const entries = await searchHuggingFace(
      {
        mode: mode("downloads"),
        isAllowedUrl: allowAll,
        httpJson: (url) => (responses.has(url) ? Promise.resolve(responses.get(url)) : Promise.reject(new Error("404"))),
      },
      "qwen",
      new AbortController().signal,
    );
    expect(entries.map((entry) => entry.repo)).toEqual(["open/repo", "open/repo"]);
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      searchHuggingFace(
        { mode: mode("downloads"), isAllowedUrl: allowAll, httpJson: () => Promise.resolve([]) },
        "qwen",
        controller.signal,
      ),
    ).rejects.toThrow(/aborted/);
  });
});
