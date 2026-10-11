import { describe, expect, it } from "vitest";

import { parseQuantization, parseSplitPart } from "./quantization.js";

/**
 * The quantization parser, against the file names Hugging Face actually lists.
 *
 * Every expected value below is a name taken from a repository listing read on
 * 2026-10-10 (`/api/models/<repo>/tree/main`), so the parser is pinned to the
 * names the quantisers write rather than to names invented to fit it. The two
 * cases that matter most are the PREFIX trap (`Q4_K` is a prefix of `Q4_K_M`, and
 * both are real files in the same repository) and unsloth's `UD-` marker, which
 * is the difference between two files of equal quality claims.
 */
describe("parseQuantization", () => {
  it("reads the token the quantisers actually write", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["Qwen3.5-4B-Q4_K_M.gguf", "Q4_K_M"],
      ["Qwen3.5-4B-Q4_K_S.gguf", "Q4_K_S"],
      ["Qwen3.5-4B-IQ4_XS.gguf", "IQ4_XS"],
      ["Qwen3.5-4B-IQ4_NL.gguf", "IQ4_NL"],
      ["Qwen3.5-4B-Q8_0.gguf", "Q8_0"],
      ["Qwen3.5-4B-BF16.gguf", "BF16"],
      ["Qwen3.5-4B-Q3_K_S.gguf", "Q3_K_S"],
      ["Qwen3.5-27B-UD-IQ2_XXS.gguf", "UD-IQ2_XXS"],
      ["Qwen3.5-27B-UD-Q3_K_XL.gguf", "UD-Q3_K_XL"],
      ["Qwen3VL-4B-Instruct-Q4_K_M.gguf", "Q4_K_M"],
      // Lower case, and an underscore where a dash usually sits: gemma's QAT quants.
      ["gemma-4-E4B_q4_0-it.gguf", "Q4_0"],
      ["gemma-4-12b-it-qat-q4_0.gguf", "Q4_0"],
      // A dot separates the stem from the quant in mradermacher's static quants.
      ["Slava-Qwen3-14B-Serbian.Q4_K_M.gguf", "Q4_K_M"],
      ["Qwen3-Embedding-0.6B-Q8_0.gguf", "Q8_0"],
      // llama.cpp writes the projector's own quantisation the same way.
      ["mmproj-model-f16-4B.gguf", "F16"],
      ["Qwen3.5-27B-BF16-00001-of-00002.gguf", "BF16"],
    ];
    for (const [file, expected] of cases) {
      expect(parseQuantization(file), file).toBe(expected);
    }
  });

  it("prefers the longest token, so Q4_K is never read out of Q4_K_M", () => {
    expect(parseQuantization("m-Q4_K_M.gguf")).toBe("Q4_K_M");
    expect(parseQuantization("m-Q4_K_XL.gguf")).toBe("Q4_K_XL");
    // ...and the legacy mixed K-quant is still read when it is the whole token.
    expect(parseQuantization("m-Q4_K.gguf")).toBe("Q4_K");
  });

  it("keeps UD- only when it modifies the quantisation", () => {
    expect(parseQuantization("Qwen3.5-4B-UD-Q4_K_XL.gguf")).toBe("UD-Q4_K_XL");
    // "MUD" is a name, not a dynamic-quant marker.
    expect(parseQuantization("MUD-Q4_K_M.gguf")).toBe("Q4_K_M");
  });

  it("answers null for a name that states nothing, rather than guessing", () => {
    expect(parseQuantization("model.gguf")).toBeNull();
    expect(parseQuantization("llama-3-8b-instruct.gguf")).toBeNull();
    // `Q4` alone is not a quantisation any quantiser writes.
    expect(parseQuantization("m-Q4.gguf")).toBeNull();
  });
});

/**
 * Split models. llama.cpp lists a model larger than a repository's per-file limit
 * as `…-00001-of-0000N.gguf` parts, and grouping them is what keeps a search from
 * offering four downloads of one model — three of which cannot be loaded alone.
 */
describe("parseSplitPart", () => {
  it("reads the part number and the count", () => {
    expect(parseSplitPart("Qwen3.5-27B-BF16-00001-of-00002.gguf")).toEqual({
      stem: "Qwen3.5-27B-BF16",
      part: 1,
      of: 2,
    });
    expect(parseSplitPart("Qwen3.5-27B-BF16-00002-of-00002.gguf")).toEqual({
      stem: "Qwen3.5-27B-BF16",
      part: 2,
      of: 2,
    });
  });

  it("refuses a name that is not a split part", () => {
    for (const file of [
      "Qwen3.5-4B-Q4_K_M.gguf",
      "x-00001-of-00001.gguf", // one part is not a split
      "x-00003-of-00002.gguf", // the last part cannot be past the count
      "x-1-of-2.gguf", // the parts llama.cpp writes are five digits
      "-00001-of-00002.gguf", // and the stem has to be something
    ]) {
      expect(parseSplitPart(file), file).toBeNull();
    }
  });
});
