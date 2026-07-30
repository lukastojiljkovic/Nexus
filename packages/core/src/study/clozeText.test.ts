import { describe, expect, it } from "vitest";
import {
  CLOZE_MASK,
  findClozeRuns,
  renderClozeCard,
  renderClozeSide,
  splitClozeSegments,
} from "./clozeText.js";

describe("findClozeRuns", () => {
  it("finds every non-overlapping run, left to right, with its offsets and inner text", () => {
    const text = "Glavni grad je {{Beograd}}, a reka je {{Sava}}.";
    expect(findClozeRuns(text)).toEqual([
      { start: 15, end: 26, inner: "Beograd" },
      { start: 38, end: 46, inner: "Sava" },
    ]);
  });

  it("ignores a run whose inner text is empty or whitespace-only", () => {
    expect(findClozeRuns("a {{}} b {{   }} c")).toEqual([]);
  });

  it("returns nothing for text with no run at all", () => {
    expect(findClozeRuns("obična rečenica")).toEqual([]);
  });

  it("does not nest: `[^{}]*` refuses the outer pair and the INNER run is the deletion", () => {
    // The outer `{{` cannot reach a `}}` without crossing a brace, so the scan
    // moves on and matches `{{b}}`. Nesting is not a feature — this pins which
    // of the two candidate runs a stray nested pair actually yields.
    expect(findClozeRuns("{{a{{b}}c}}").map((run) => run.inner)).toEqual(["b"]);
  });
});

describe("renderClozeSide", () => {
  const text = "Glavni grad je {{Beograd}}, a reka je {{Sava}}.";
  const runs = findClozeRuns(text);

  it("masks the target run and unwraps every other one", () => {
    expect(renderClozeSide(text, runs, 0)).toBe(
      `Glavni grad je ${CLOZE_MASK}, a reka je Sava.`,
    );
    expect(renderClozeSide(text, runs, 1)).toBe(
      `Glavni grad je Beograd, a reka je ${CLOZE_MASK}.`,
    );
  });

  it("unwraps every run when the target is null — the shared back", () => {
    expect(renderClozeSide(text, runs, null)).toBe("Glavni grad je Beograd, a reka je Sava.");
  });

  it("renders the mask as `[…]`, the form derived text has always used", () => {
    expect(CLOZE_MASK).toBe("[…]");
  });
});

describe("renderClozeCard", () => {
  it("returns the masked front and fully-unwrapped back of one deletion, trimmed", () => {
    expect(renderClozeCard("  {{Ana}} voli {{čaj}}  ", 1)).toEqual({
      front: `Ana voli ${CLOZE_MASK}`,
      back: "Ana voli čaj",
    });
  });

  it("returns null when the ordinal names no run in this text", () => {
    expect(renderClozeCard("{{Ana}} voli čaj", 1)).toBeNull();
    expect(renderClozeCard("bez praznina", 0)).toBeNull();
  });

  it("returns null for a negative or non-integer ordinal rather than guessing", () => {
    expect(renderClozeCard("{{Ana}} voli čaj", -1)).toBeNull();
    expect(renderClozeCard("{{Ana}} voli čaj", 0.5)).toBeNull();
  });

  it("agrees with `renderClozeSide` — one grammar, two entry points", () => {
    const text = "{{a}} i {{b}} i {{c}}";
    const runs = findClozeRuns(text);
    for (let ordinal = 0; ordinal < runs.length; ordinal += 1) {
      expect(renderClozeCard(text, ordinal)).toEqual({
        front: renderClozeSide(text, runs, ordinal).trim(),
        back: renderClozeSide(text, runs, null).trim(),
      });
    }
  });
});

describe("splitClozeSegments", () => {
  it("splits into plain text around one target segment carrying the answer", () => {
    expect(splitClozeSegments("Glavni grad je {{Beograd}}, a reka je {{Sava}}.", 0)).toEqual([
      { kind: "text", value: "Glavni grad je " },
      { kind: "target", value: "Beograd" },
      { kind: "text", value: ", a reka je Sava." },
    ]);
  });

  it("unwraps every non-target run in place, so the context never leaves the line", () => {
    expect(splitClozeSegments("{{a}} i {{b}} i {{c}}", 1)).toEqual([
      { kind: "text", value: "a i " },
      { kind: "target", value: "b" },
      { kind: "text", value: " i c" },
    ]);
  });

  it("drops empty leading/trailing text segments instead of emitting blanks", () => {
    expect(splitClozeSegments("{{sam}}", 0)).toEqual([{ kind: "target", value: "sam" }]);
  });

  it("returns null when the ordinal names no run — the caller falls back", () => {
    expect(splitClozeSegments("bez praznina", 0)).toBeNull();
  });
});
