import { describe, expect, it } from "vitest";
import {
  moveOrderEntry,
  normalizeRotation,
  pageNumberText,
  pageOrder,
  QUARTER_TURN_DEGREES,
  removeOrderEntry,
} from "./pageOps.js";

/**
 * The PDF tools' arithmetic, pinned value by value.
 *
 * `normalizeRotation`'s expectations are `/Rotate`'s own domain (PDF 32000-1
 * §7.7.3.3: clockwise, a multiple of 90), so the sums below are modular
 * arithmetic written out rather than a restatement of the implementation.
 */

describe("normalizeRotation", () => {
  it("reduces a quarter turn count to 0, 90, 180 or 270", () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(QUARTER_TURN_DEGREES)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(270)).toBe(270);
  });

  it("wraps a full turn and beyond", () => {
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(720)).toBe(0);
  });

  it("reads a negative angle as a counter-clockwise turn", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-180)).toBe(180);
    expect(normalizeRotation(-360)).toBe(0);
    expect(normalizeRotation(-450)).toBe(270);
  });

  it("refuses an angle /Rotate cannot hold", () => {
    expect(() => normalizeRotation(45)).toThrow(RangeError);
    expect(() => normalizeRotation(90.5)).toThrow(RangeError);
    expect(() => normalizeRotation(Number.NaN)).toThrow(RangeError);
  });
});

describe("pageNumberText", () => {
  it("writes the page alone, or the page and the document", () => {
    expect(pageNumberText("plain", 7, 12)).toBe("7");
    expect(pageNumberText("of-total", 7, 12)).toBe("7 / 12");
    expect(pageNumberText("of-total", 1, 1)).toBe("1 / 1");
  });
});

describe("pageOrder", () => {
  it("counts from zero, once per page", () => {
    expect(pageOrder(4)).toEqual([0, 1, 2, 3]);
    expect(pageOrder(0)).toEqual([]);
    expect(pageOrder(-3)).toEqual([]);
  });
});

describe("moveOrderEntry", () => {
  it("moves an entry forward and backward", () => {
    expect(moveOrderEntry([0, 1, 2], 0, 2)).toEqual([1, 2, 0]);
    expect(moveOrderEntry([0, 1, 2], 2, 0)).toEqual([2, 0, 1]);
  });

  it("answers the same order when nothing moved", () => {
    expect(moveOrderEntry([0, 1, 2], 1, 1)).toEqual([0, 1, 2]);
  });

  it("clamps a drop past the last tile to the end", () => {
    expect(moveOrderEntry([0, 1, 2], 0, 3)).toEqual([1, 2, 0]);
    expect(moveOrderEntry([0, 1, 2], 0, 99)).toEqual([1, 2, 0]);
  });

  it("answers the order unchanged for an index that is not in it", () => {
    expect(moveOrderEntry([0, 1, 2], 3, 0)).toEqual([0, 1, 2]);
    expect(moveOrderEntry([0, 1, 2], -1, 0)).toEqual([0, 1, 2]);
  });

  it("answers a new array, so a React state update cannot be missed", () => {
    const order = [0, 1, 2];
    expect(moveOrderEntry(order, 5, 0)).not.toBe(order);
  });
});

describe("removeOrderEntry", () => {
  it("drops the entry at the index", () => {
    expect(removeOrderEntry([0, 1, 2, 3], 1)).toEqual([0, 2, 3]);
    expect(removeOrderEntry([3, 1, 0], 2)).toEqual([3, 1]);
  });

  it("keeps the last page: a PDF with no pages cannot be saved", () => {
    expect(removeOrderEntry([7], 0)).toEqual([7]);
  });

  it("answers the order unchanged for an index that is not in it", () => {
    expect(removeOrderEntry([0, 1], 5)).toEqual([0, 1]);
    expect(removeOrderEntry([0, 1], -1)).toEqual([0, 1]);
  });
});
