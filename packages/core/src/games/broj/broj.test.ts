import { describe, expect, it } from "vitest";

import {
  BROJ_FIFTH_CHOICES,
  BROJ_SIXTH_CHOICES,
  brojNumbersOf,
  checkBrojExpression,
  createBrojPuzzle,
  evaluateBroj,
  formatBroj,
  solveBroj,
} from "./broj.js";
import type { BrojExpression } from "./broj.js";

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

/**
 * Every value a pool of numbers can be made to have, by exhaustive enumeration
 * with no value pruning at all. Written out again here on purpose: the engine's
 * search is pruned and memoised, and this is what its answers are held against.
 */
function reachableValues(numbers: readonly number[]): Set<number> {
  const found = new Set<number>();
  const seen = new Set<string>();
  const walk = (values: readonly number[]): void => {
    for (const value of values) found.add(value);
    if (values.length === 1) return;
    const key = [...values].sort((left, right) => left - right).join(",");
    if (seen.has(key)) return;
    seen.add(key);
    for (let left = 0; left < values.length; left += 1) {
      for (let right = left + 1; right < values.length; right += 1) {
        const a = values[left] as number;
        const b = values[right] as number;
        const rest = values.filter((_, index) => index !== left && index !== right);
        const next = [a + b, a * b, a - b, b - a];
        if (b !== 0 && a % b === 0) next.push(a / b);
        if (a !== 0 && b % a === 0) next.push(b / a);
        for (const value of next) {
          if (!Number.isSafeInteger(value)) continue;
          walk([...rest, value]);
        }
      }
    }
  };
  walk([...numbers]);
  return found;
}

/** The smallest distance from `target` to anything in `values`. */
function bestDistance(values: ReadonlySet<number>, target: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const value of values) best = Math.min(best, Math.abs(value - target));
  return best;
}

describe("evaluateBroj", () => {
  it("works out a tree with the four operations", () => {
    // (2 + 3) x 4 = 20
    expect(evaluateBroj(operation("*", operation("+", number(2), number(3)), number(4)))).toBe(20);
    // 100 - (25 + 5) = 70
    expect(
      evaluateBroj(operation("-", number(100), operation("+", number(25), number(5)))),
    ).toBe(70);
    // (5 - 9) x 2 = -8: a negative partial value is a step the game allows.
    expect(evaluateBroj(operation("*", operation("-", number(5), number(9)), number(2)))).toBe(-8);
  });

  it("refuses a division that does not come out whole", () => {
    expect(evaluateBroj(operation("/", number(10), number(4)))).toBeNull();
    expect(evaluateBroj(operation("/", number(10), number(5)))).toBe(2);
    expect(evaluateBroj(operation("+", number(1), operation("/", number(7), number(2))))).toBeNull();
    expect(evaluateBroj(operation("/", number(5), number(0)))).toBeNull();
  });
});

describe("brojNumbersOf and formatBroj", () => {
  it("lists every number a tree uses, repeats kept", () => {
    const tree = operation("+", number(5), operation("*", number(5), number(2)));
    expect(brojNumbersOf(tree)).toEqual([5, 5, 2]);
    expect(formatBroj(tree)).toBe("(5 + (5 x 2))");
  });
});

describe("createBrojPuzzle", () => {
  it("deals the show's six numbers and a three-digit target", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const puzzle = createBrojPuzzle(seed);
      expect(puzzle.numbers).toHaveLength(6);
      for (const small of puzzle.numbers.slice(0, 4)) {
        expect(Number.isInteger(small)).toBe(true);
        expect(small).toBeGreaterThanOrEqual(1);
        expect(small).toBeLessThanOrEqual(9);
      }
      expect(BROJ_FIFTH_CHOICES).toContain(puzzle.numbers[4]);
      expect(BROJ_SIXTH_CHOICES).toContain(puzzle.numbers[5]);
      expect(puzzle.target).toBeGreaterThanOrEqual(100);
      expect(puzzle.target).toBeLessThanOrEqual(999);
    }
  });

  it("is stable for a seed", () => {
    expect(createBrojPuzzle(3)).toEqual(createBrojPuzzle(3));
    expect(createBrojPuzzle(3).numbers).not.toEqual(createBrojPuzzle(4).numbers);
  });
});

describe("solveBroj", () => {
  it("finds a hand-checked exact expression", () => {
    // 50 / 25 + 5 = 7, with two numbers left unused.
    const solution = solveBroj([5, 50, 25, 1, 2, 3], 7);
    expect(solution.exact).toBe(true);
    expect(solution.value).toBe(7);
    expect(solution.distance).toBe(0);
    expect(evaluateBroj(solution.expression)).toBe(7);
    // Every number the expression uses was dealt, however many it used: this
    // pool also reaches 7 with all six (50/25 + 5 + 3 - 2 - 1), and either
    // answer is the right one.
    const dealt = sortNumbers([5, 50, 25, 1, 2, 3]);
    const remaining = [...dealt];
    for (const used of solution.used) {
      const at = remaining.indexOf(used);
      expect(at).toBeGreaterThanOrEqual(0);
      remaining.splice(at, 1);
    }
  });

  it("hits a target that only one route reaches", () => {
    // (10 + 10) / (1 + 1 + 1 + 1) = 5: every number is used, and nothing else
    // in that pool divides to 5.
    const solution = solveBroj([1, 1, 1, 1, 10, 10], 5);
    expect(solution.value).toBe(5);
    expect(solution.exact).toBe(true);
    expect(evaluateBroj(solution.expression)).toBe(5);
    expect(sortNumbers(solution.used)).toEqual([1, 1, 1, 1, 10, 10]);
  });

  it("takes the closest value when the target cannot be made", () => {
    // Six ones cannot reach past 9: the largest thing to make of them is
    // (1+1+1) x (1+1+1), since any other grouping is a sum at most 6 or a
    // product of smaller factors. A target of 100 is therefore missed by 91, and
    // the enumeration below is asked for the same answer.
    const numbers = [1, 1, 1, 1, 1, 1];
    const target = 100;
    const solution = solveBroj(numbers, target);
    const oracle = reachableValues(numbers);
    expect(Math.max(...oracle)).toBe(9);
    expect(oracle.has(target)).toBe(false);
    expect(bestDistance(oracle, target)).toBe(91);
    expect(solution.distance).toBe(91);
    expect(solution.value).toBe(9);
    expect(solution.exact).toBe(false);
    expect(evaluateBroj(solution.expression)).toBe(solution.value);
  });

  it("matches an independent enumeration of every reachable value", { timeout: 300_000 }, () => {
    for (let seed = 0; seed < 10; seed += 1) {
      const puzzle = createBrojPuzzle(seed * 7 + 1);
      const oracle = reachableValues(puzzle.numbers);
      const solution = solveBroj(puzzle.numbers, puzzle.target);
      expect(solution.distance).toBe(bestDistance(oracle, puzzle.target));
      expect(evaluateBroj(solution.expression)).toBe(solution.value);
      expect(solution.distance).toBe(Math.abs(solution.value - puzzle.target));
      expect(solution.exact).toBe(solution.value === puzzle.target);
    }
  });

  it("returns an expression that evaluates to the value it claims, over a hundred puzzles", { timeout: 300_000 }, () => {
    let worstNodes = 0;
    for (let seed = 0; seed < 100; seed += 1) {
      const puzzle = createBrojPuzzle(seed);
      const solution = solveBroj(puzzle.numbers, puzzle.target);
      expect(evaluateBroj(solution.expression)).toBe(solution.value);
      expect(solution.distance).toBe(Math.abs(solution.value - puzzle.target));
      expect(solution.exact).toBe(solution.value === puzzle.target);
      // Each number of the pool is used at most as often as it was dealt.
      const pool = new Map<number, number>();
      for (const dealt of puzzle.numbers) pool.set(dealt, (pool.get(dealt) ?? 0) + 1);
      for (const used of solution.used) {
        const left = pool.get(used) ?? 0;
        expect(left).toBeGreaterThan(0);
        pool.set(used, left - 1);
      }
      worstNodes = Math.max(worstNodes, solution.nodes);
    }
    // Recorded for the header's claim about the memo: the worst of a hundred.
    expect(worstNodes).toBeLessThan(1_000_000);
  });

  it("refuses a pool with nothing in it and a number that is not a positive whole", () => {
    expect(() => solveBroj([], 100)).toThrow(RangeError);
    expect(() => solveBroj([5, 0], 5)).toThrow(RangeError);
    expect(() => solveBroj([5, 2.5], 5)).toThrow(RangeError);
  });
});

describe("checkBrojExpression", () => {
  const numbers = [5, 50, 25, 1, 2, 3];

  it("accepts a good expression and reports what it is worth", () => {
    const check = checkBrojExpression(numbers, 7, operation("+", operation("/", number(50), number(25)), number(5)));
    expect(check.valid).toBe(true);
    expect(check.refusal).toBeNull();
    expect(check.value).toBe(7);
    expect(check.distance).toBe(0);
    expect(check.exact).toBe(true);
  });

  it("refuses a number used twice when it was dealt once", () => {
    const check = checkBrojExpression(numbers, 10, operation("+", number(5), number(5)));
    expect(check.valid).toBe(false);
    expect(check.refusal).toBe("unknown-number");
    expect(check.value).toBeNull();
  });

  it("refuses a number the puzzle never dealt", () => {
    const check = checkBrojExpression(numbers, 7, operation("+", number(7), number(0)));
    expect(check.valid).toBe(false);
    expect(check.refusal).toBe("unknown-number");
  });

  it("refuses an inexact division", () => {
    const check = checkBrojExpression(numbers, 10, operation("/", number(25), number(2)));
    expect(check.valid).toBe(false);
    expect(check.refusal).toBe("inexact-division");
    expect(check.value).toBeNull();
  });

  it("reports a value that misses the target", () => {
    const check = checkBrojExpression(numbers, 100, operation("+", number(50), number(25)));
    expect(check.valid).toBe(true);
    expect(check.value).toBe(75);
    expect(check.distance).toBe(25);
    expect(check.exact).toBe(false);
  });
});

function sortNumbers(values: readonly number[]): number[] {
  return [...values].sort((left, right) => left - right);
}
