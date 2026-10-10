import { describe, expect, it } from "vitest";

import type { CalculatorFormatOptions } from "./display.js";
import {
  BIG_NUMBER_PRECISION,
  createCalculatorEngine,
  type CalculatorAngleMode,
  type CalculatorEvaluateOptions,
  type CalculatorFailure,
  type CalculatorPrecision,
  type CalculatorSuccess,
} from "./engine.js";
import type { CalculatorSession } from "./session.js";

const FLOAT = createCalculatorEngine("float");
const BIG = createCalculatorEngine("bignumber");

/** Every row reads in English, so an expected string is a number rather than a locale's punctuation. */
const EN: Partial<CalculatorFormatOptions> = { locale: "en" };

interface Row {
  readonly expression: string;
  /** The exact string the reader sees. Derived below in the comment beside each group. */
  readonly display: string;
  readonly mode?: CalculatorPrecision;
  readonly angle?: CalculatorAngleMode;
  readonly format?: Partial<CalculatorFormatOptions>;
}

/**
 * THE FEATURE TABLE. Every feature the module promises, with the exact display
 * it produces.
 *
 * **Where the expected strings come from.** Each is the value's own digits under
 * the two rules `display.ts` states: fifteen significant digits in the float
 * mode (so `0.1 + 0.2` reads as `0.3`, and `sqrt(2)` as `1.4142135623731`), the
 * value's every digit in the bignumber mode, and the notation switching to
 * scientific outside `[1e-6, 1e16)`. The digits themselves were cross-checked
 * against an independent oracle (`Number.prototype.toPrecision(15)` for the
 * float rows, mathjs's own `BigNumber` text for the bignumber ones), and the
 * rows whose arithmetic is worth stating are derived in the comments.
 */
const TABLE: readonly Row[] = [
  // --- arithmetic, precedence and parentheses ---------------------------------
  { expression: "2 + 3 * 4", display: "14" },
  { expression: "(2 + 3) * 4", display: "20" },
  { expression: "10 - 4 - 3", display: "3" },
  { expression: "7 / 2", display: "3.5" },
  { expression: "2^10", display: "1,024" },
  { expression: "2^0.5", display: "1.4142135623731" },
  { expression: "9^0.5", display: "3" },
  // 2^64 is exactly representable as a double: 18446744073709551616, whose
  // leading fifteen digits and a rounding 5 make 1.84467440737096e+19.
  { expression: "2^64", display: "1.84467440737096e+19" },
  { expression: "3!", display: "6" },
  { expression: "50%", display: "0.5" },
  { expression: "200 * 10%", display: "20" },
  // Implicit multiplication, as mathjs writes it: `2(3 + 4)` is 2 × 7.
  { expression: "2(3 + 4)", display: "14" },
  { expression: "6/2(1+2)", display: "9" },
  // --- trigonometry, in all three angle modes ---------------------------------
  // 30 degrees is 0.5235987755982988 radians, and the sine of that double
  // rounds to 0.49999999999999994, which fifteen significant digits make 0.5.
  { expression: "sin(30)", display: "0.5" },
  { expression: "cos(60)", display: "0.5" },
  { expression: "tan(45)", display: "1" },
  { expression: "asin(0.5)", display: "30" },
  { expression: "acos(0)", display: "90" },
  { expression: "atan(1)", display: "45" },
  { expression: "sin(pi/2)", display: "1", angle: "rad" },
  { expression: "sin(30)", display: "-0.988031624092862", angle: "rad" },
  { expression: "atan(1)", display: "0.785398163397448", angle: "rad" },
  { expression: "tan(50)", display: "1", angle: "grad" },
  { expression: "atan(1)", display: "50", angle: "grad" },
  { expression: "sin(30)", display: "0.453990499739547", angle: "grad" },
  // An angle UNIT is not the angle mode: 30 grad is 30 grad in every mode.
  { expression: "sin(30 grad)", display: "0.453990499739547" },
  { expression: "sin(30 deg)", display: "0.5" },
  { expression: "cos(200 grad)", display: "-1" },
  // --- hyperbolic, logarithms, roots and rounding ------------------------------
  { expression: "sinh(1)", display: "1.1752011936438" },
  { expression: "cosh(0)", display: "1" },
  { expression: "tanh(1)", display: "0.761594155955765" },
  { expression: "ln(e)", display: "1" },
  { expression: "ln(10)", display: "2.30258509299405" },
  { expression: "log10(1000)", display: "3" },
  { expression: "log10(0.001)", display: "-3" },
  { expression: "log(8, 2)", display: "3" },
  { expression: "log2(8)", display: "3" },
  { expression: "log(100)", display: "4.60517018598809" },
  { expression: "sqrt(16)", display: "4" },
  { expression: "sqrt(2)", display: "1.4142135623731" },
  { expression: "cbrt(27)", display: "3" },
  { expression: "cbrt(-8)", display: "-2" },
  { expression: "nthRoot(8, 3)", display: "2" },
  { expression: "abs(-7)", display: "7" },
  { expression: "abs(3 + 4i)", display: "5" },
  { expression: "round(2.5)", display: "3" },
  { expression: "round(2.345, 2)", display: "2.35" },
  { expression: "ceil(2.1)", display: "3" },
  { expression: "floor(2.9)", display: "2" },
  { expression: "fix(-2.9)", display: "-2" },
  { expression: "round(pi, 5)", display: "3.14159" },
  // --- combinatorics and number theory ----------------------------------------
  { expression: "factorial(5)", display: "120" },
  { expression: "5!", display: "120" },
  { expression: "combinations(5, 2)", display: "10" },
  { expression: "nCr(5, 2)", display: "10" },
  { expression: "permutations(5, 2)", display: "20" },
  { expression: "nPr(5, 2)", display: "20" },
  { expression: "gcd(12, 18)", display: "6" },
  { expression: "lcm(4, 6)", display: "12" },
  { expression: "mod(17, 5)", display: "2" },
  { expression: "17 % 5", display: "2" },
  { expression: "10 mod 3", display: "1" },
  // --- constants, complex results and programmer input ------------------------
  { expression: "pi", display: "3.14159265358979" },
  { expression: "e", display: "2.71828182845905" },
  // `phi`'s shortest decimal text ends exactly in a 5, and `display.ts` rounds
  // the text it was handed, half away from zero: ...95 to fifteen digits is
  // ...990, whose trailing zero is not shown. (An exact rounding of the binary
  // double gives 1.61803398874989 instead — a one-in-the-last-digit difference
  // that only this class of value can have, and the rule is stated there.)
  { expression: "phi", display: "1.6180339887499" },
  { expression: "i", display: "i" },
  { expression: "sqrt(-4)", display: "2i" },
  { expression: "(1 + 2i) * (3 - 1i)", display: "5 + 5i" },
  { expression: "2 + 3i", display: "2 + 3i" },
  { expression: "0x1F", display: "31" },
  { expression: "0o17", display: "15" },
  { expression: "0b101", display: "5" },
  { expression: "0x1F + 0b101 + 0o17", display: "51" },
  // --- units ------------------------------------------------------------------
  { expression: "5 km to mi", display: "3.10685596118667 mi" },
  { expression: "100 km/h to m/s", display: "27.7777777777778 m / s" },
  { expression: "20 degC to degF", display: "68 degF" },
  { expression: "1 m + 50 cm", display: "1.5 m" },
  { expression: "2 kg * 3", display: "6 kg" },
  { expression: "10 m / 2 s", display: "5 m / s" },
  // --- the display's own rules, end to end ------------------------------------
  { expression: "0.1 + 0.2", display: "0.3" },
  { expression: "1 - 0.9", display: "0.1" },
  { expression: "1/3", display: "0.333333333333333" },
  { expression: "2/3", display: "0.666666666666667" },
  { expression: "1/3 + 1/6", display: "0.5" },
  { expression: "1234567.891", display: "1,234,567.891" },
  { expression: "1234567.891", display: "1.234.567,891", format: { locale: "sr" } },
  { expression: "1234567.891", display: "1234567.891", format: { grouping: false } },
  { expression: "1234567.891 / 2", display: "617,283.9455" },
  { expression: "1e21", display: "1e+21" },
  { expression: "1e-7", display: "1e-7" },
  // --- booleans and assignments -------------------------------------------------
  { expression: "1 < 2", display: "true" },
  { expression: "true and false", display: "false" },
  { expression: "x = 5", display: "5" },
  { expression: "f(x) = x^2 + 1", display: "f(x)" },
  // --- the same features in the bignumber mode ---------------------------------
  { expression: "0.1 + 0.2", display: "0.3", mode: "bignumber" },
  { expression: "0.1 + 0.2 + 0.3", display: "0.6", mode: "bignumber" },
  { expression: "1 - 0.9", display: "0.1", mode: "bignumber" },
  {
    expression: "1/3",
    display: `0.${"3".repeat(64)}`,
    mode: "bignumber",
  },
  {
    expression: "1/7",
    display: "0.1428571428571428571428571428571428571428571428571428571428571429",
    mode: "bignumber",
  },
  {
    expression: "sqrt(2)",
    display: "1.414213562373095048801688724209698078569671875376948073176679738",
    mode: "bignumber",
  },
  { expression: "2^0.5", display: "1.414213562373095048801688724209698078569671875376948073176679738", mode: "bignumber" },
  { expression: "2^10", display: "1,024", mode: "bignumber" },
  { expression: "2^64", display: "1.8446744073709551616e+19", mode: "bignumber" },
  { expression: "3!", display: "6", mode: "bignumber" },
  { expression: "factorial(5)", display: "120", mode: "bignumber" },
  { expression: "gcd(12, 18)", display: "6", mode: "bignumber" },
  { expression: "round(2.345, 2)", display: "2.35", mode: "bignumber" },
  { expression: "sin(30)", display: "0.5", mode: "bignumber" },
  { expression: "sin(30 deg)", display: "0.5", mode: "bignumber" },
  // 0.7853981… × (200 / π) is 50.000…001 at sixty-four digits, and the caller's
  // thirty-digit display is what turns the last-digit noise back into 50.
  { expression: "atan(1)", display: "50", mode: "bignumber", angle: "grad", format: { precision: 30 } },
  { expression: "ln(e)", display: "1", mode: "bignumber" },
  { expression: "1e400", display: "1e+400", mode: "bignumber" },
  { expression: "10^10^10", display: "1e+10000000000", mode: "bignumber" },
  { expression: "20 degC to degF", display: "68 degF", mode: "bignumber" },
  { expression: "1234567.891", display: "1,234,567.891", mode: "bignumber" },
  { expression: "1e21", display: "1e+21", mode: "bignumber" },
  {
    expression: "5 km to mi",
    display: "3.106855961186669848087170921816591107929690606855961186669848087 mi",
    mode: "bignumber",
  },
];

function evaluate(
  engine: ReturnType<typeof createCalculatorEngine>,
  expression: string,
  options?: CalculatorEvaluateOptions,
): CalculatorSuccess {
  const outcome = engine.evaluate(expression, options);
  if (!outcome.ok) {
    throw new Error(`expected "${expression}" to evaluate, but it was refused with ${outcome.code}`);
  }
  return outcome;
}

function refuse(
  engine: ReturnType<typeof createCalculatorEngine>,
  expression: string,
  options?: CalculatorEvaluateOptions,
): CalculatorFailure {
  const outcome = engine.evaluate(expression, options);
  if (outcome.ok) {
    throw new Error(`expected "${expression}" to be refused, but it displayed ${outcome.display}`);
  }
  return outcome;
}

describe("the feature table", () => {
  it("carries at least eighty expressions", () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(80);
  });

  for (const row of TABLE) {
    const engine = row.mode === "bignumber" ? BIG : FLOAT;
    it(`${row.mode ?? "float"} ${row.angle ?? "deg"} ${row.expression} => ${row.display}`, () => {
      const outcome = evaluate(engine, row.expression, {
        angleMode: row.angle ?? "deg",
        format: { ...EN, ...row.format },
      });
      expect(outcome.display).toBe(row.display);
    });
  }
});

describe("createCalculatorEngine", () => {
  it("builds an instance per precision, and the two do not share a session", () => {
    expect(FLOAT.precision).toBe("float");
    expect(BIG.precision).toBe("bignumber");
    expect(BIG_NUMBER_PRECISION).toBe(64);
  });
});

describe("the session", () => {
  it("remembers a variable and answers with it in a later expression", () => {
    const assigned = evaluate(FLOAT, "x = 5", { format: EN });
    expect(assigned.session.variables).toEqual({ x: "5" });

    const used = evaluate(FLOAT, "x * 3", { session: assigned.session, format: EN });
    expect(used.display).toBe("15");
  });

  it("stores a variable's VALUE, not the text that produced it", () => {
    // The case that decides the storage shape: replaying `x = x + 1` as source
    // text against a restored scope would read whatever `x` was, while the
    // value it produced is 6 in this session and 6 in any later one.
    const first = evaluate(FLOAT, "x = 5", { format: EN });
    const second = evaluate(FLOAT, "x = x + 1", { session: first.session, format: EN });
    expect(second.display).toBe("6");
    expect(second.session.variables).toEqual({ x: "6" });

    const third = evaluate(FLOAT, "x", { session: second.session, format: EN });
    expect(third.display).toBe("6");
  });

  it("keeps a unit's value with its unit", () => {
    const assigned = evaluate(FLOAT, "v = 100 km/h", { format: EN });
    expect(assigned.session.variables).toEqual({ v: "100 km / h" });
    expect(evaluate(FLOAT, "v to m/s", { session: assigned.session, format: EN }).display).toBe(
      "27.7777777777778 m / s",
    );
  });

  it("carries ans from one expression to the next", () => {
    const first = evaluate(FLOAT, "2 + 3", { format: EN });
    expect(first.session.ans).toBe("5");
    expect(evaluate(FLOAT, "ans * 2", { session: first.session, format: EN }).display).toBe("10");
    expect(evaluate(FLOAT, "y = ans + 1", { session: first.session, format: EN }).display).toBe("6");
  });

  it("has no ans before the first result, and says so rather than guessing zero", () => {
    expect(refuse(FLOAT, "ans + 1", { format: EN }).code).toBe("unknown-symbol");
  });

  it("records a user function as a signature and a body, and calls it later", () => {
    const defined = evaluate(FLOAT, "f(x) = x^2 + 1", { format: EN });
    expect(defined.session.functions).toEqual({ f: { params: ["x"], body: "x ^ 2 + 1" } });
    expect(evaluate(FLOAT, "f(3)", { session: defined.session, format: EN }).display).toBe("10");
  });

  it("takes a function with two parameters, and one that reads a variable", () => {
    const defined = evaluate(FLOAT, "g(a, b) = a * b", { format: EN });
    expect(defined.session.functions).toEqual({ g: { params: ["a", "b"], body: "a * b" } });
    expect(evaluate(FLOAT, "g(3, 4)", { session: defined.session, format: EN }).display).toBe("12");

    const withVariable = evaluate(FLOAT, "x = 2", { format: EN });
    const scaled = evaluate(FLOAT, "h(y) = y * x", { session: withVariable.session, format: EN });
    const both = evaluate(FLOAT, "h(3)", { session: scaled.session, format: EN });
    expect(both.display).toBe("6");
  });

  it("survives the JSON round trip the store puts it through", () => {
    const defined = evaluate(FLOAT, "f(x) = x^2 + 1", { format: EN });
    const assigned = evaluate(FLOAT, "x = 3", { session: defined.session, format: EN });
    const stored = JSON.parse(JSON.stringify(assigned.session)) as CalculatorSession;

    const first = evaluate(FLOAT, "f(x)", { session: stored, format: EN });
    expect(first.display).toBe("10");
    // The stored variables and functions came back as they were, and the answer
    // does not depend on how many times the same session is asked (only `ans`
    // moves, which is what the row below pins).
    expect(first.session.variables).toEqual(stored.variables);
    expect(first.session.functions).toEqual(stored.functions);
    const second = evaluate(FLOAT, "f(x)", { session: stored, format: EN });
    expect(second.session).toEqual(first.session);
  });

  it("skips an entry it cannot read rather than refusing the whole expression", () => {
    // Corruption in a column must not make the calculator unusable for
    // everything else, and the entry is dropped from the session it returns.
    const session: CalculatorSession = {
      version: 1,
      variables: { x: "5", broken: "(((" },
      functions: { f: { params: ["x"], body: "x" } },
      ans: null,
    };
    const outcome = evaluate(FLOAT, "x + f(1)", { session, format: EN });
    expect(outcome.display).toBe("6");
    expect(outcome.session.variables).toEqual({ x: "5" });
  });

  it("does not keep a value whose name holds a function", () => {
    // `g = f` aliases a function; a function is not a value the session stores
    // (`session.ts` says why), so the alias lives for one evaluation only.
    const defined = evaluate(FLOAT, "f(x) = x^2 + 1", { format: EN });
    const aliased = evaluate(FLOAT, "g = f", { session: defined.session, format: EN });
    expect(aliased.display).toBe("f(x)");
    expect(aliased.session.variables).toEqual({});
    expect(aliased.session.functions).toEqual(defined.session.functions);
  });

  it("counts on the caller passing the session back, not on carrying state", () => {
    // The engine is a function of its arguments: the same call twice, with the
    // same session, answers the same thing, and an expression that assigns
    // nothing leaves the session it was given untouched.
    const session: CalculatorSession = { version: 1, variables: { x: "5" }, functions: {}, ans: null };
    const first = evaluate(FLOAT, "x * 2", { session, format: EN });
    const second = evaluate(FLOAT, "x * 2", { session, format: EN });
    expect(first.display).toBe("10");
    expect(second.display).toBe("10");
    expect(session.variables).toEqual({ x: "5" });
  });
});

describe("the programmer view", () => {
  it("gives an integer result in all three bases", () => {
    const outcome = evaluate(FLOAT, "0x1F + 0b101 + 0o17", { format: EN });
    expect(outcome.display).toBe("51");
    expect(outcome.programmer).toEqual({ hex: "0x33", octal: "0o63", binary: "0b110011" });
  });

  it("keeps the sign for a negative integer, as mathjs writes one", () => {
    expect(evaluate(FLOAT, "0 - 255", { format: EN }).programmer).toEqual({
      hex: "-0xff",
      octal: "-0o377",
      binary: "-0b11111111",
    });
  });

  it("answers null for anything that is not an integer in one machine word", () => {
    expect(evaluate(FLOAT, "7 / 2", { format: EN }).programmer).toBeNull();
    // 2^64 needs sixty-five bits, so there is no word to show it in.
    expect(evaluate(FLOAT, "2^64", { format: EN }).programmer).toBeNull();
    expect(evaluate(FLOAT, "1 m", { format: EN }).programmer).toBeNull();
  });

  it("gives the same view in the bignumber mode, where 255 is a BigNumber", () => {
    expect(evaluate(BIG, "0x1F + 0xE0", { format: EN }).programmer).toEqual({
      hex: "0xff",
      octal: "0o377",
      binary: "0b11111111",
    });
    // The same edge as the float mode's: 2^64 in EITHER mode is one bit too
    // wide, which is only true if both bounds are exactly 2^64.
    expect(evaluate(BIG, "2^64", { format: EN }).programmer).toBeNull();
    expect(evaluate(BIG, "2^64 - 1", { format: EN }).programmer).toEqual({
      hex: "0xffffffffffffffff",
      octal: "0o1777777777777777777777",
      binary: "0b" + "1".repeat(64),
    });
  });
});
