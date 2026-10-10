import { describe, expect, it } from "vitest";

import {
  availableDirections,
  DIRECTIONS,
  directionOfPackId,
  missingPackId,
  MODEL_FILES,
  nxPackUrl,
  packIdOf,
  pairOf,
  resolveModelUrls,
} from "./models.js";

/**
 * The pack → URL resolver. What it must never do is hand the worker a URL for a
 * pack that is not installed or is not a model pack, and what it must always do
 * is name the same pack id the builder writes — so both halves are pinned here,
 * the URL shape character for character and the id table entry by entry.
 */

const MODEL_PACK = { id: "translate-sr-en", kind: "model" };

describe("the direction table", () => {
  it("maps every direction to one pack id and back", () => {
    expect(DIRECTIONS.map(packIdOf)).toEqual([
      "translate-sr-en",
      "translate-en-sr",
      "translate-hr-en",
      "translate-en-hr",
      "translate-bs-en",
      "translate-en-bs",
    ]);
    for (const direction of DIRECTIONS) {
      expect(directionOfPackId(packIdOf(direction))).toBe(direction);
    }
  });

  it("answers null for a pack id that is not a translation pack", () => {
    expect(directionOfPackId("wikipedia-sr")).toBeNull();
    expect(directionOfPackId("translate-sr")).toBeNull();
    expect(directionOfPackId("translate-de-en")).toBeNull();
  });

  it("reads the two languages out of the direction", () => {
    expect(pairOf("sr-en")).toEqual({ from: "sr", to: "en" });
    expect(pairOf("en-bs")).toEqual({ from: "en", to: "bs" });
    expect(pairOf("hr-en")).toEqual({ from: "hr", to: "en" });
  });
});

describe("nxPackUrl", () => {
  it("builds the scheme's shape exactly", () => {
    expect(nxPackUrl("translate-sr-en", "model.bin")).toBe(
      "nx-pack://translate-sr-en/model.bin",
    );
    expect(nxPackUrl("translate-en-sr", "a/b.spm")).toBe("nx-pack://translate-en-sr/a/b.spm");
  });

  it("refuses an id or a path a pack could not have", () => {
    expect(() => nxPackUrl("Translate_SR", "model.bin")).toThrow();
    expect(() => nxPackUrl("", "model.bin")).toThrow();
    expect(() => nxPackUrl("translate-sr-en", "/model.bin")).toThrow();
    expect(() => nxPackUrl("translate-sr-en", "../model.bin")).toThrow();
    expect(() => nxPackUrl("translate-sr-en", "a//b")).toThrow();
    expect(() => nxPackUrl("translate-sr-en", "model.bin?x=1")).toThrow();
    expect(() => nxPackUrl("translate-sr-en", "a\\b")).toThrow();
  });
});

describe("resolveModelUrls", () => {
  it("answers the three fixed file URLs of the installed direction", () => {
    expect(resolveModelUrls("sr-en", [MODEL_PACK])).toEqual({
      direction: "sr-en",
      packId: "translate-sr-en",
      model: `nx-pack://translate-sr-en/${MODEL_FILES.model}`,
      shortlist: `nx-pack://translate-sr-en/${MODEL_FILES.shortlist}`,
      vocab: `nx-pack://translate-sr-en/${MODEL_FILES.vocab}`,
    });
  });

  it("answers null when the pack is absent, and when the id is there but is another kind", () => {
    expect(resolveModelUrls("sr-en", [])).toBeNull();
    expect(resolveModelUrls("sr-en", [{ id: "translate-sr-en", kind: "content" }])).toBeNull();
    expect(resolveModelUrls("en-sr", [MODEL_PACK])).toBeNull();
  });
});

describe("missingPackId and availableDirections", () => {
  it("names the pack to install, and only while it is absent", () => {
    expect(missingPackId("en-hr", [])).toBe("translate-en-hr");
    expect(missingPackId("en-hr", [{ id: "translate-en-hr", kind: "model" }])).toBeNull();
  });

  it("lists exactly the installed directions, in the table's order", () => {
    expect(availableDirections([])).toEqual([]);
    expect(
      availableDirections([
        { id: "translate-en-sr", kind: "model" },
        { id: "translate-sr-en", kind: "model" },
        { id: "wikipedia-sr", kind: "zim" },
        { id: "translate-en-hr", kind: "content" },
      ]),
    ).toEqual(["sr-en", "en-sr"]);
  });
});
