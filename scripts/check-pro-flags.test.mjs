// The gate, tested — because a gate nobody has watched fail is indistinguishable
// from a gate that cannot fail.
//
// Most of these cases are the OPPOSITE assertion: the shapes that must NOT
// fire. An input's boolean, an unexported interface's boolean, a `boolean[]`,
// a field whose name merely contains a flagged one. That half matters more,
// because a gate that objects to correct code is one somebody switches off, and
// a switched-off gate reads as coverage while enforcing nothing.

import { describe, expect, it } from "vitest";

import { auditAll, resultBooleans, surfaceNames } from "./check-pro-flags.mjs";

const names = (text) => resultBooleans(text).map((f) => `${f.owner}.${f.name}`);

describe("resultBooleans — what counts as a claim the tool makes", () => {
  it("finds a boolean on an exported result interface", () => {
    expect(names("export interface FooResult {\n  readonly passes: boolean;\n}")).toEqual([
      "FooResult.passes",
    ]);
  });

  it("finds an optional boolean, in both spellings", () => {
    expect(names("export interface R {\n  readonly a?: boolean;\n  readonly b: boolean | undefined;\n}")).toEqual([
      "R.a",
      "R.b",
    ]);
  });

  it("keeps the declaration line, so a finding points at the field and not the file", () => {
    const text = ["export interface R {", "  readonly x: number;", "  readonly flag: boolean;", "}"].join("\n");
    expect(resultBooleans(text)[0]?.line).toBe(3);
  });

  it("ignores an INPUT's boolean — a caller's parameter is not a claim", () => {
    expect(names("export interface FooInput {\n  readonly strict: boolean;\n}")).toEqual([]);
  });

  it("ignores an OPTIONS bag for the same reason", () => {
    expect(names("export interface FormatOptions {\n  readonly compact: boolean;\n}")).toEqual([]);
  });

  it("ignores an UNEXPORTED interface — a lookup table's booleans are working, not output", () => {
    expect(names("interface Scale {\n  readonly feminine: boolean;\n}")).toEqual([]);
  });

  it("attributes a field to the interface it is IN, not to the last exported one above it", () => {
    // The bug this replaces: requiring `export` on the walk-back did not skip
    // an internal table's boolean, it blamed the exported interface above it.
    const text = [
      "export interface Result {",
      "  readonly ok: boolean;",
      "}",
      "",
      "interface Table {",
      "  readonly internal: boolean;",
      "}",
    ].join("\n");
    expect(names(text)).toEqual(["Result.ok"]);
  });

  it("does not read a boolean ARRAY or a function returning one as a flag", () => {
    const text = [
      "export interface R {",
      "  readonly flags: readonly boolean[];",
      "  readonly test: (x: number) => boolean;",
      "}",
    ].join("\n");
    expect(names(text)).toEqual([]);
  });
});

describe("surfaceNames — whole words only", () => {
  it("finds the field where the surface reads it", () => {
    expect(surfaceNames("{result.degenerate && <p/>}", "degenerate")).toBe(true);
  });

  it("does not accept a longer name that merely contains it", () => {
    expect(surfaceNames("{result.degenerateQuartiles}", "degenerate")).toBe(false);
  });

  it("accepts a name reached through a group, since that is still reading it", () => {
    expect(surfaceNames("{result.quartiles.degenerate && <p/>}", "degenerate")).toBe(true);
  });

  it("is false for a surface that never mentions it", () => {
    expect(surfaceNames("{result.q1}\n{result.q3}", "degenerate")).toBe(false);
  });
});

describe("the real repository", () => {
  it("has no result flag its surface never names", () => {
    const { findings, packCount, flagCount } = auditAll();
    expect(findings, JSON.stringify(findings, null, 1)).toEqual([]);
    expect(packCount).toBeGreaterThanOrEqual(17);
    // A count this low would mean the walk stopped finding fields, which is how
    // a gate goes quiet without going green-for-the-right-reason.
    expect(flagCount).toBeGreaterThanOrEqual(50);
  });
});
