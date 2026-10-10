import { describe, expect, it } from "vitest";
import { evaluateBroj } from "@nexus/core";
import type { BrojExpression } from "@nexus/core";
import { MAX_EXPRESSION_LENGTH, checkSubmitted, parseExpression } from "./broj.js";

/**
 * Broj's expression reader.
 *
 * Every tree below is written out in full rather than compared by value, because
 * what precedence and associativity DO is the shape of the tree and not the
 * number it works out to: „2 + 3 × 4" and „(2 + 3) × 4" differ by ten, and only
 * one of the two parses is the arithmetic everybody learned.
 */

function number(value: number): BrojExpression {
  return { kind: "number", value };
}

function operation(
  op: "+" | "-" | "*" | "/",
  left: BrojExpression,
  right: BrojExpression,
): BrojExpression {
  return { kind: "operation", operation: op, left, right };
}

function parsed(text: string): BrojExpression {
  const result = parseExpression(text);
  if (!result.ok) throw new Error(`"${text}" did not parse`);
  return result.expression;
}

describe("parseExpression", () => {
  it("reads a single number, and a sum, left to right", () => {
    expect(parsed("12")).toEqual(number(12));
    expect(parsed("1+2")).toEqual(operation("+", number(1), number(2)));
    // Left-associative: 10 - 3 - 2 is (10 - 3) - 2, which is 5 and not 9.
    expect(parsed("10-3-2")).toEqual(
      operation("-", operation("-", number(10), number(3)), number(2)),
    );
  });

  it("binds multiplication and division tighter than addition", () => {
    // 2 + 3 × 4 = 14, so the product is the right-hand operand of the sum.
    expect(parsed("2+3*4")).toEqual(
      operation("+", number(2), operation("*", number(3), number(4))),
    );
    // 8 ÷ 4 - 1 = 1, not 8 ÷ 3.
    expect(parsed("8/4-1")).toEqual(
      operation("-", operation("/", number(8), number(4)), number(1)),
    );
  });

  it("reads brackets as their own factor", () => {
    expect(parsed("(2+3)*4")).toEqual(
      operation("*", operation("+", number(2), number(3)), number(4)),
    );
    expect(parsed("2*(3+(4-1))")).toEqual(
      operation(
        "*",
        number(2),
        operation("+", number(3), operation("-", number(4), number(1))),
      ),
    );
  });

  it("accepts the keyboard's own multiply, divide and minus beside the ASCII ones", () => {
    expect(parsed("2 × 3 + 1")).toEqual(parsed("2 * 3 + 1"));
    expect(parsed("8 ÷ 4")).toEqual(parsed("8 / 4"));
    expect(parsed("7 − 2")).toEqual(parsed("7 - 2"));
  });

  it("ignores spaces wherever they fall", () => {
    expect(parsed("  2 +   3 * 4 ")).toEqual(parsed("2+3*4"));
  });

  it("refuses anything that is not one whole expression", () => {
    for (const text of [
      "",
      "   ",
      "3+",
      "+3",
      "3+4)",
      "(3+4",
      "(3+4))",
      "3 4",
      "3+4 junk",
      "2,5",
      "5.",
      "3.5+1",
      "-3+5",
      "3**4",
      "()",
    ]) {
      expect(parseExpression(text), text).toEqual({ ok: false, refusal: "syntax" });
    }
  });

  it("refuses a line too long to read rather than recursing through it", () => {
    const long = "1+".repeat(MAX_EXPRESSION_LENGTH) + "1";
    expect(long.length).toBeGreaterThan(MAX_EXPRESSION_LENGTH);
    expect(parseExpression(long)).toEqual({ ok: false, refusal: "syntax" });
    // Nested brackets past the depth bound are refused too, and the bound is far
    // past anything six numbers can need (five operations).
    expect(parseExpression("(".repeat(20) + "1" + ")".repeat(20))).toEqual({
      ok: false,
      refusal: "syntax",
    });
  });

  it("runs a three-number expression through the engine's own arithmetic", () => {
    // 8 × 3 + 25 = 49: hand-checked against `evaluateBroj`, which is the engine
    // the value's own definition lives in.
    expect(evaluateBroj(parsed("8*3+25"))).toBe(49);
    expect(evaluateBroj(parsed("2 × (3 + 4)"))).toBe(14);
  });
});

describe("checkSubmitted", () => {
  /** A pool of six, and a target of 100: exactly the shape the game deals. */
  const POOL: readonly number[] = [25, 3, 7, 2, 10, 5];
  const TARGET = 100;

  it("reads a value the six numbers can make, and its distance", () => {
    // 3 × 25 = 75, 2 × 10 = 20, plus 5 — every one of the six used once.
    expect(checkSubmitted(POOL, TARGET, "3*25+2*10+5")).toEqual({
      kind: "value",
      expression: parsed("3*25+2*10+5"),
      value: 100,
      distance: 0,
      exact: true,
    });
    // (25 + 3) × 7 ÷ 2 = 98, which is two away and not exact. The division comes
    // out whole (196 ÷ 2), which is why the engine allows the step at all.
    expect(checkSubmitted(POOL, TARGET, "(25+3)*7/2")).toEqual({
      kind: "value",
      expression: parsed("(25+3)*7/2"),
      value: 98,
      distance: 2,
      exact: false,
    });
  });

  it("refuses a number the pool does not hold, and counts the copies it does", () => {
    // 1 is not one of the six.
    expect(checkSubmitted(POOL, TARGET, "25+3+7+2+10+5+1")).toEqual({
      kind: "refusal",
      refusal: "unknown-number",
    });
    // And a 3 used twice is a 3 the pool does not have: the six are dealt once.
    expect(checkSubmitted(POOL, TARGET, "3+3+3+3+3+3+3")).toEqual({
      kind: "refusal",
      refusal: "unknown-number",
    });
  });

  it("refuses a division that does not come out whole", () => {
    expect(checkSubmitted(POOL, TARGET, "25/2")).toEqual({
      kind: "refusal",
      refusal: "inexact-division",
    });
  });

  it("refuses unreadable text before it asks the engine anything", () => {
    expect(checkSubmitted(POOL, TARGET, "abc")).toEqual({
      kind: "refusal",
      refusal: "syntax",
    });
    expect(checkSubmitted(POOL, TARGET, "3+")).toEqual({
      kind: "refusal",
      refusal: "syntax",
    });
  });
});
