// The gate, tested — because a gate nobody has watched fail is indistinguishable
// from a gate that cannot fail.
//
// Half of these cases are the OPPOSITE assertion: the same literal `1e-9` that
// makes rule 2 fire inside a `Math.ceil` must leave a tolerance and a unit
// conversion alone. That half matters more than the other, because a gate that
// objects to correct code is one somebody switches off, and a switched-off gate
// reads as coverage while enforcing nothing.

import { describe, expect, it } from "vitest";

import { KIT_NAMES, auditAll, auditFile, roundingArguments, topLevelFunctions } from "./check-pro-math.mjs";

const FILE = "packages/core/src/pro/example.ts";
const rules = (text) => auditFile(FILE, text).map((f) => f.rule);

describe("roundingArguments — balanced parentheses, not a regex", () => {
  it("reads the whole argument of a call that contains its own parentheses", () => {
    const [call] = roundingArguments("const n = Math.ceil((a + b) / c - 1e-9);");
    expect(call.rounder).toBe("Math.ceil");
    expect(call.args).toBe("(a + b) / c - 1e-9");
  });

  it("finds every rounding call on one line, not only the first", () => {
    const found = roundingArguments("return { wide: Math.ceil(x / y), high: Math.floor(p / q) };");
    expect(found.map((c) => c.rounder)).toEqual(["Math.floor", "Math.ceil"]);
  });

  it("reads to the end of a call that wraps, rather than giving up on it", () => {
    const [call] = roundingArguments("  const bays = Math.ceil(");
    expect(call.args).toBe("");
  });

  it("returns nothing for a line with no rounding at all", () => {
    expect(roundingArguments("const ratio = a / b;")).toEqual([]);
  });
});

describe("topLevelFunctions", () => {
  it("separates two functions and keeps the line each one opens on", () => {
    const text = ["function a() {", "  return 1;", "}", "", "export function b() {", "  return 2;", "}"].join("\n");
    expect(topLevelFunctions(text).map((f) => [f.name, f.from])).toEqual([
      ["a", 1],
      ["b", 5],
    ]);
  });

  it("does not end a function at a nested closing brace", () => {
    const text = ["function a() {", "  if (x) {", "    return 1;", "  }", "  return 2;", "}"].join("\n");
    expect(topLevelFunctions(text)).toHaveLength(1);
    expect(topLevelFunctions(text)[0].lines).toHaveLength(6);
  });
});

describe("rule 1 — no private copy of a shared helper", () => {
  it("fires on a hand-written rounding helper, in each spelling that shipped", () => {
    expect(rules("function roundHalfUp(value, digits) {\n  return value;\n}")).toEqual(["private-kit-copy"]);
    expect(rules("function roundTo(value, decimals) {\n  return value;\n}")).toEqual(["private-kit-copy"]);
    expect(rules("function round9(value) {\n  return value;\n}")).toEqual(["private-kit-copy"]);
    expect(rules("const quotient = (a, b) => a / b;")).toEqual(["private-kit-copy"]);
    expect(rules("export function snap(value) {\n  return value;\n}")).toEqual(["private-kit-copy"]);
  });

  it("fires on the two names a pack reached for when the kit could not narrow", () => {
    expect(rules("function positive(value) {\n  return value > 0;\n}")).toEqual(["private-kit-copy"]);
    expect(rules("function nonNegative(value) {\n  return value >= 0;\n}")).toEqual(["private-kit-copy"]);
  });

  it("says nothing about IMPORTING the helper, which is the whole point", () => {
    expect(rules('import { quotient, roundHalfUp, snap } from "./result.js";')).toEqual([]);
    expect(rules("  const rounded = roundHalfUp(value, 2);")).toEqual([]);
  });

  it("does not fire on a longer name that merely contains one", () => {
    expect(rules("function roundHalfUpToStep(value, step) {\n  return value;\n}")).toEqual([]);
    expect(rules("function snapshotOf(x) {\n  return x;\n}")).toEqual([]);
    expect(rules("const isPositiveInteger = (n) => n > 0;")).toEqual([]);
  });

  it("names every helper the kit owns, so the list cannot silently shrink", () => {
    for (const name of ["quotient", "snap", "floorSnapped", "ceilSnapped", "roundHalfUp"]) {
      expect(KIT_NAMES).toContain(name);
    }
  });
});

describe("rule 2 — no absolute epsilon inside a rounding call", () => {
  it("fires on the nudge in both directions", () => {
    expect(rules("  const packs = Math.ceil(exact - 1e-9);")).toEqual(["absolute-nudge"]);
    expect(rules("  const whole = Math.floor(value + 1e-9);")).toEqual(["absolute-nudge"]);
    expect(rules("  const cents = Math.round(value * 100 + 1e-9) / 100;")).toEqual(["absolute-nudge"]);
  });

  it("fires on the epsilon written as a machine constant rather than a literal", () => {
    expect(rules("  const n = Math.round(scaled + scaled * Number.EPSILON * 4);")).toEqual(["absolute-nudge"]);
  });

  it("leaves a TOLERANCE alone — the same literal, deciding whether two lengths agree", () => {
    expect(rules("  if (Math.abs(coarse - pitch) < 1e-9) source = \"coarse\";")).toEqual([]);
    expect(rules("  if (Math.abs(value) < 1e-9) break;")).toEqual([]);
    expect(rules("  const eps = maxAbs * 1e-9;")).toEqual([]);
  });

  it("leaves a UNIT CONVERSION alone — 1e-9 is cubic metres per cubic millimetre", () => {
    expect(rules("  const massKg = volumeMm3 * 1e-9 * densityKgM3;")).toEqual([]);
  });

  it("says nothing about an ordinary rounding call with no epsilon in it", () => {
    expect(rules("  const rows = Math.ceil(total / perRow);")).toEqual([]);
    expect(rules("  const riser = Math.round(rise / step) * step;")).toEqual([]);
  });

  it("ignores an exponent too large to be a nudge — 1e-3 is a milli-anything", () => {
    expect(rules("  const mm = Math.round(metres * 1e-3);")).toEqual([]);
  });
});

describe("rule 3 — no division by an unguarded input field", () => {
  const fn = (body) => `export function tool(input) {\n${body}\n}`;

  it("fires when the divisor was never checked", () => {
    expect(rules(fn("  const rate = input.mass / input.area;"))).toEqual(["unguarded-divisor"]);
  });

  it("is silent once the field passes any of the guards", () => {
    expect(rules(fn('  if (!isPositive(input.area)) return fail("area");\n  const r = input.mass / input.area;'))).toEqual([]);
    expect(rules(fn('  if (!isInRange(input.area, 1, 9)) return fail("area");\n  const r = input.mass / input.area;'))).toEqual([]);
    expect(rules(fn("  const r = quotient(input.mass, input.area);"))).toEqual([]);
  });

  it("does not confuse a guard on one field with a guard on another", () => {
    expect(rules(fn('  if (!isPositive(input.mass)) return fail("mass");\n  const r = input.mass / input.area;'))).toEqual([
      "unguarded-divisor",
    ]);
  });
});

describe("the real repository", () => {
  it("has no private helper copy, no absolute nudge and no unguarded divisor", () => {
    const { findings, moduleCount } = auditAll();
    expect(findings, JSON.stringify(findings, null, 1)).toEqual([]);
    expect(moduleCount).toBeGreaterThanOrEqual(17);
  });
});
