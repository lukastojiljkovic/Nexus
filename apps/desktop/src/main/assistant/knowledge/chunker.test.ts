import { describe, expect, it } from "vitest";
import { CHUNK_TARGET_TOKENS, chunkDocument, estimateTokens, locatorOf } from "./chunker.js";

describe("estimateTokens", () => {
  it("is characters over four, rounded up", () => {
    // 4 characters per token is the stated estimate (CHARS_PER_TOKEN), so these
    // are the arithmetic the thresholds below are read against.
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("locatorOf", () => {
  it("joins a heading path and answers null when there is none", () => {
    expect(locatorOf([])).toBeNull();
    expect(locatorOf(["Alpha"])).toBe("Alpha");
    expect(locatorOf(["Alpha", "Beta"])).toBe("Alpha > Beta");
  });
});

describe("chunkDocument", () => {
  it("closes a passage at the target and never crosses a heading", () => {
    // target 2 tokens = 8 characters; overlap 1 token = 4; max 4 tokens = 16.
    const text = ["# Alpha", "aaaa", "", "bbbb", "", "# Beta", "cccc"].join("\n");
    const chunks = chunkDocument(text, { targetTokens: 2, overlapTokens: 1, maxTokens: 4 });

    // "aaaa" costs 4 characters (4 < 8, so the passage stays open); "bbbb" adds
    // its 4 plus the 2-character separator, taking the passage to 10 >= 8, so it
    // closes - and Beta's heading is a hard boundary with nothing carried over.
    expect(chunks).toEqual([
      { text: "aaaa\n\nbbbb", locator: "Alpha" },
      { text: "cccc", locator: "Beta" },
    ]);
  });

  it("carries the overlap budget into the next passage of the same section", () => {
    // target 2 tokens (8 chars); overlap 2 tokens (8 chars) - enough for one
    // 4-character unit plus its 2-character separator, so exactly one is carried.
    const text = ["# Alpha", "aaaa", "", "bbbb", "", "cccc"].join("\n");
    const chunks = chunkDocument(text, { targetTokens: 2, overlapTokens: 2, maxTokens: 4 });

    expect(chunks).toEqual([
      { text: "aaaa\n\nbbbb", locator: "Alpha" },
      { text: "bbbb\n\ncccc", locator: "Alpha" },
      { text: "cccc", locator: "Alpha" },
    ]);
  });

  it("splits one paragraph longer than the ceiling at whitespace and loses no word", () => {
    const words = Array.from({ length: 40 }, (_unused, index) => `w${String(index)}`);
    const text = words.join(" ");
    // max 10 tokens = 40 characters, so a 40-word (roughly 170-character)
    // paragraph cannot be one passage.
    const chunks = chunkDocument(text, { targetTokens: 10, overlapTokens: 0, maxTokens: 10 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(10);
      // A piece ends where a word does: the next chunk's first word is a whole word.
      expect(chunk.text).toBe(chunk.text.trim());
    }
    // Joined back up, the words are all there and in order - the split moved no
    // text out of the document.
    expect(chunks.map((chunk) => chunk.text).join(" ").split(/\s+/)).toEqual(words);
  });

  it("produces nothing for a document with no text and a document with only headings", () => {
    expect(chunkDocument("")).toEqual([]);
    expect(chunkDocument("\n\n   \n")).toEqual([]);
    expect(chunkDocument("# Naslov\n\n## Podnaslov")).toEqual([]);
  });

  it("is deterministic - the same text produces the same passages at the same ordinals", () => {
    const text = ["# A", "prva", "", "druga", "", "treca", "", "## B", "cetvrta"].join("\n");
    expect(chunkDocument(text)).toEqual(chunkDocument(text));
  });

  it("uses the documented defaults when no options are given", () => {
    // The target is the constant, so a document of exactly the target's
    // characters is one passage and one more character starts a second.
    const one = "a".repeat(CHUNK_TARGET_TOKENS * 4);
    expect(chunkDocument(one)).toEqual([{ text: one, locator: null }]);
  });
});
