/**
 * Broj — the number game after the Serbian quiz's "Moj broj": six numbers and a
 * target, combined with the four operations into an exact expression or the
 * closest one.
 *
 * **The rules are the show's, and they are cited.** The Wikipedia article on
 * "ТВ слагалица" (the quiz's article, `sr.wikipedia.org`, section „Игре“, under
 * „Мој број“) states: the player is given six numbers and a drawn target from 1
 * to 999; the first four numbers are single-digit; the fifth may be 10, 15 or
 * 20, and the sixth 25, 50, 75 or 100; the target is expressed with the four
 * elementary operations. The article does not say how the four single-digit
 * numbers are drawn, so `createBrojPuzzle` draws each of them from 1 to 9
 * independently and says so here rather than pretending to a deck composition
 * the source does not give.
 *
 * **A number is used at most once, and a number may go unused.** The article
 * says the target is expressed with the six numbers, not that all six must
 * appear, so the search treats every partial combination as a candidate. The
 * expression tree records which numbers it used, so a caller can show that too.
 *
 * **Division is exact or not at all.** An intermediate result that is not a
 * whole number is not a step the show allows, so the search simply does not take
 * it — there is no rounding anywhere in this module, and no epsilon.
 *
 * **The search is exhaustive over the numbers, pruned over their values.** Every
 * pair of the pool is combined with every operation, both ways round for
 * subtraction and division, and the recursion stops when the pool has one
 * number left. The one thing thrown away is a partial value beyond
 * `BROJ_VALUE_LIMIT` in magnitude, and that IS a real cut -- six numbers up to a
 * hundred reach 100^6 -- so the test does not take it on trust: it recomputes
 * every reachable value from the same pool with no value limit at all and
 * asserts the two agree on the answer.
 *
 * **And memoised on the pool.** Two orders of the same combinations reach the
 * same multiset of partial values, and from there the same everything; without
 * that memo the six-number search visits tens of millions of leaves, and with it
 * the engine and the test's oracle agree within a few thousand states.
 */

import { createPuzzleRandom, randomBelow } from "../puzzles-shared/random.js";

export type BrojOperation = "+" | "-" | "*" | "/";

export type BrojExpression =
  | { readonly kind: "number"; readonly value: number }
  | {
      readonly kind: "operation";
      readonly operation: BrojOperation;
      readonly left: BrojExpression;
      readonly right: BrojExpression;
    };

/** The two halves of the show's draw: four single digits, then two round numbers. */
export const BROJ_SMALL_MIN = 1;
export const BROJ_SMALL_MAX = 9;
export const BROJ_FIFTH_CHOICES: readonly number[] = [10, 15, 20];
export const BROJ_SIXTH_CHOICES: readonly number[] = [25, 50, 75, 100];

/**
 * How large a partial value may grow before the search drops it. Six numbers at
 * most 100 make 100^6 at the extreme, so this is a pruning knob and not a
 * correctness one: with the numbers this game deals, no dropped branch could
 * have come back to a target under a thousand.
 */
export const BROJ_VALUE_LIMIT = 1_000_000;

/**
 * The target is drawn from 100 to 999. The article's own range is 1 to 999; the
 * narrower default is a deliberate choice — a one-digit target is reached by a
 * single number almost every time, and the show's target is read off a
 * three-digit display.
 */
export const BROJ_TARGET_MIN = 100;
export const BROJ_TARGET_MAX = 999;

export interface BrojPuzzle {
  readonly numbers: readonly number[];
  readonly target: number;
  readonly seed: number;
}

/** A fresh puzzle: four digits from 1 to 9, then the show's fifth and sixth. */
export function createBrojPuzzle(seed: number): BrojPuzzle {
  const random = createPuzzleRandom(seed);
  const numbers: number[] = [];
  for (let drawn = 0; drawn < 4; drawn += 1) {
    numbers.push(BROJ_SMALL_MIN + randomBelow(random, BROJ_SMALL_MAX - BROJ_SMALL_MIN + 1));
  }
  numbers.push(BROJ_FIFTH_CHOICES[randomBelow(random, BROJ_FIFTH_CHOICES.length)] as number);
  numbers.push(BROJ_SIXTH_CHOICES[randomBelow(random, BROJ_SIXTH_CHOICES.length)] as number);
  const target =
    BROJ_TARGET_MIN + randomBelow(random, BROJ_TARGET_MAX - BROJ_TARGET_MIN + 1);
  return { numbers, target, seed };
}

/**
 * The value of an expression, or `null` when it takes a step the game does not
 * allow: a division that does not come out whole.
 */
export function evaluateBroj(expression: BrojExpression): number | null {
  if (expression.kind === "number") return expression.value;
  const left = evaluateBroj(expression.left);
  if (left === null) return null;
  const right = evaluateBroj(expression.right);
  if (right === null) return null;
  switch (expression.operation) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      if (right === 0 || left % right !== 0) return null;
      return left / right;
  }
}

/** Every number the expression uses, in the order they appear, repeats kept. */
export function brojNumbersOf(expression: BrojExpression): number[] {
  if (expression.kind === "number") return [expression.value];
  return [...brojNumbersOf(expression.left), ...brojNumbersOf(expression.right)];
}

/** The expression as text, fully parenthesised so it reads as the tree it is. */
export function formatBroj(expression: BrojExpression): string {
  if (expression.kind === "number") return String(expression.value);
  const symbol = expression.operation === "*" ? "x" : expression.operation;
  return `(${formatBroj(expression.left)} ${symbol} ${formatBroj(expression.right)})`;
}

export interface BrojSolution {
  readonly expression: BrojExpression;
  /** What the expression is worth; always the value it was chosen for. */
  readonly value: number;
  /** `abs(value - target)`, and zero when the target was hit. */
  readonly distance: number;
  readonly exact: boolean;
  /** The numbers of the pool the expression uses. */
  readonly used: readonly number[];
  /** How many partial combinations the search looked at, for the report. */
  readonly nodes: number;
}

export interface BrojOptions {
  readonly limit?: number;
}

/**
 * The exact expression for `target`, or the closest one the numbers can make.
 * Never `null` for a non-empty pool: the last remaining number is itself a
 * candidate, so there is always something to return.
 */
export function solveBroj(
  numbers: readonly number[],
  target: number,
  options: BrojOptions = {},
): BrojSolution {
  if (numbers.length === 0) throw new RangeError("solveBroj: a pool of no numbers has no value");
  if (!Number.isFinite(target)) throw new RangeError(`solveBroj: target must be a number, got ${target}`);
  const limit = options.limit ?? BROJ_VALUE_LIMIT;
  let nodes = 0;
  let best: { expression: BrojExpression; value: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const visited = new Set<string>();

  const poolKey = (values: readonly number[]): string =>
    [...values].sort((left, right) => left - right).join(",");

  const consider = (expression: BrojExpression, value: number): void => {
    const distance = Math.abs(value - target);
    if (distance >= bestDistance) return;
    bestDistance = distance;
    best = { expression, value };
  };

  const combine = (values: readonly number[], expressions: readonly BrojExpression[]): void => {
    for (let left = 0; left < values.length; left += 1) {
      for (let right = left + 1; right < values.length; right += 1) {
        const a = values[left] as number;
        const b = values[right] as number;
        const expressionA = expressions[left] as BrojExpression;
        const expressionB = expressions[right] as BrojExpression;
        const restValues = values.filter((_, index) => index !== left && index !== right);
        const restExpressions = expressions.filter((_, index) => index !== left && index !== right);
        const operation = (kind: BrojOperation, first: BrojExpression, second: BrojExpression): BrojExpression => ({
          kind: "operation",
          operation: kind,
          left: first,
          right: second,
        });
        const candidates: { readonly value: number; readonly expression: BrojExpression }[] = [
          { value: a + b, expression: operation("+", expressionA, expressionB) },
          { value: a * b, expression: operation("*", expressionA, expressionB) },
          { value: a - b, expression: operation("-", expressionA, expressionB) },
          { value: b - a, expression: operation("-", expressionB, expressionA) },
        ];
        // Division is offered only when it comes out whole, in both directions:
        // `a / b` and `b / a` are different steps and either may be the one that
        // reaches the target.
        if (b !== 0 && a % b === 0) {
          candidates.push({ value: a / b, expression: operation("/", expressionA, expressionB) });
        }
        if (a !== 0 && b % a === 0) {
          candidates.push({ value: b / a, expression: operation("/", expressionB, expressionA) });
        }
        for (const candidate of candidates) {
          nodes += 1;
          if (!Number.isSafeInteger(candidate.value)) continue;
          if (Math.abs(candidate.value) > limit) continue;
          consider(candidate.expression, candidate.value);
          descend([...restValues, candidate.value], [...restExpressions, candidate.expression]);
        }
      }
    }
  };

  const descend = (values: readonly number[], expressions: readonly BrojExpression[]): void => {
    if (values.length === 1) return;
    const key = poolKey(values);
    if (visited.has(key)) return;
    visited.add(key);
    combine(values, expressions);
  };

  const values = numbers.map((value) => {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(`solveBroj: every number must be a positive whole number, got ${value}`);
    }
    return value;
  });
  const expressions: BrojExpression[] = values.map((value) => ({ kind: "number", value }));
  for (let index = 0; index < values.length; index += 1) {
    consider(expressions[index] as BrojExpression, values[index] as number);
  }
  descend(values, expressions);

  const chosen = best as { expression: BrojExpression; value: number } | null;
  if (chosen === null) throw new Error("solveBroj: the search considered nothing at all");
  return {
    expression: chosen.expression,
    value: chosen.value,
    distance: Math.abs(chosen.value - target),
    exact: chosen.value === target,
    used: brojNumbersOf(chosen.expression),
    nodes,
  };
}

/**
 * Why an expression was refused. A CODE and not a sentence: the copy a player
 * reads is Serbian and English and lives in the strings table, and a diagnostic
 * string built here would be the one piece of the answer that could never be
 * translated.
 */
export type BrojRefusal = "unknown-number" | "inexact-division";

export interface BrojCheck {
  readonly valid: boolean;
  /** Why the expression was refused, when it was. */
  readonly refusal: BrojRefusal | null;
  /** The value it works out to, or `null` when it takes an illegal step. */
  readonly value: number | null;
  readonly distance: number | null;
  readonly exact: boolean;
}

/**
 * Read a player's expression against the puzzle: every number it uses has to be
 * one of the six (with its copies counted — using the only 5 twice is exactly
 * the mistake this catches), no division may be inexact, and the value is what
 * it is.
 */
export function checkBrojExpression(
  numbers: readonly number[],
  target: number,
  expression: BrojExpression,
): BrojCheck {
  const pool = new Map<number, number>();
  for (const number of numbers) pool.set(number, (pool.get(number) ?? 0) + 1);
  for (const used of brojNumbersOf(expression)) {
    const left = pool.get(used) ?? 0;
    if (left === 0) {
      return {
        valid: false,
        refusal: "unknown-number",
        value: null,
        distance: null,
        exact: false,
      };
    }
    pool.set(used, left - 1);
  }
  const value = evaluateBroj(expression);
  if (value === null) {
    return {
      valid: false,
      refusal: "inexact-division",
      value: null,
      distance: null,
      exact: false,
    };
  }
  return {
    valid: true,
    refusal: null,
    value,
    distance: Math.abs(value - target),
    exact: value === target,
  };
}
