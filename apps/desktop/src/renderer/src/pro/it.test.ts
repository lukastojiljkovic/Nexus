import { describe, expect, it } from "vitest";

import { strings } from "../strings.js";
import { hostCountsFromText } from "./it.js";

/**
 * The one free-text vocabulary this pack reads out of a field.
 *
 * `pro/kuhinja.test.ts` pins the same contract for its four word parsers: the
 * hint above the field names the separators, so the parser must accept exactly
 * those. A separator the hint promises and the parser ignores is invisible —
 * the list still parses, one subnet is simply not there.
 */
describe("hostCountsFromText", () => {
  const s = strings.pro.it["vlsm-split"];

  it("accepts every separator the hint names", () => {
    expect(hostCountsFromText("100, 50 20;30")).toEqual([100, 50, 20, 30]);
    expect(hostCountsFromText("100")).toEqual([100]);
    expect(hostCountsFromText("  8 , 8 ; 8  8 ")).toEqual([8, 8, 8, 8]);
  });

  it("keeps the order as typed — the allocation sorts, the list does not", () => {
    expect(hostCountsFromText("20,100,50")).toEqual([20, 100, 50]);
  });

  it("reads a comma as the separator and never as a decimal mark", () => {
    // The field takes WHOLE numbers, so a comma cannot be part of a value and
    // its only job is to separate two. „2,0" is therefore two counts and the
    // core then refuses the zero by name — a loud answer, not a quiet
    // misallocation. This is why the hint says the comma is a separator.
    expect(hostCountsFromText("2,0")).toEqual([2, 0]);
  });

  it("refuses a part it cannot read instead of dropping it", () => {
    // NaN reaches the core, which fails the whole list by name — a silently
    // skipped subnet would be a plan that does not fit what was asked for.
    const counts = hostCountsFromText("100, abc");
    expect(counts).toHaveLength(2);
    expect(Number.isNaN(counts[1] ?? 0)).toBe(true);
  });

  it("answers an empty field with an empty list, not a zero-sized subnet", () => {
    expect(hostCountsFromText("")).toEqual([]);
    expect(hostCountsFromText("   ")).toEqual([]);
  });

  it("agrees with the separator its own hint announces", () => {
    // The hint is the only place the rule is told to the user; this is what
    // says the two have not drifted apart.
    for (const separator of ["zarezom", "tačkom i zarezom", "razmakom"]) {
      expect(s.hostCountsHint, separator).toContain(separator);
    }
    expect(s.hostCountsHint).toContain("ceo broj");
  });
});
