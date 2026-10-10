import { describe, expect, it } from "vitest";
import { createSeededRandom, randomBelow, shuffle, type RandomSource } from "./shuffle.js";

/**
 * A source with a written-down answer for every draw, so a shuffle's result is
 * a HAND CALCULATION rather than an output the implementation reported about
 * itself. `calls` counts the draws, which is how the rejection in `randomBelow`
 * is observed rather than assumed.
 */
function scripted(values: readonly number[]): RandomSource & { calls: number } {
  let index = 0;
  const source = {
    calls: 0,
    nextUint32(): number {
      const value = values[index] ?? 0;
      index += 1;
      source.calls += 1;
      return value;
    },
  };
  return source;
}

describe("createSeededRandom", () => {
  /**
   * The exact words xorshift32 produces for seed 1, derived by hand in the
   * comment on `stepXorshift` — `0x42021` below is `1 ^ (1 << 13)`, which is the
   * first step's whole arithmetic. A generator asserted only on its shape would
   * pass with any of these numbers changed; these are the numbers.
   */
  it("produces the documented sequence for seed 1", () => {
    const random = createSeededRandom(1);
    expect([random.nextUint32(), random.nextUint32(), random.nextUint32()]).toEqual([
      0x00042021, 0x04080601, 0x9dcca8c5,
    ]);
  });

  it("never yields zero and never repeats a 32-draw run", () => {
    // xorshift32's one fixed point is zero, so a seed of zero would be a
    // generator that returns nothing at all; the constructor folds it away.
    const zero = createSeededRandom(0);
    const drawn = Array.from({ length: 32 }, () => zero.nextUint32());
    expect(drawn.every((value) => value !== 0)).toBe(true);
    expect(new Set(drawn).size).toBe(32);
  });

  it("is a function of the seed alone", () => {
    const first = createSeededRandom(20261009);
    const second = createSeededRandom(20261009);
    const other = createSeededRandom(20261010);
    expect(second.nextUint32()).toBe(first.nextUint32());
    expect(other.nextUint32()).not.toBe(first.nextUint32());
  });
});

describe("randomBelow", () => {
  it("rejects a draw outside the largest multiple of the bound, then takes the next", () => {
    // bound 3 over a 32-bit range: 2^32 is 1 more than a multiple of 3, so the
    // single value 0xFFFFFFFF has to be thrown away or 0 comes up twice as
    // often as 1 and 2.
    const source = scripted([0xffffffff, 5]);
    const value = randomBelow(source, 3);
    expect({ value, calls: source.calls }).toEqual({ value: 2, calls: 2 });
  });

  it("needs no rejection when the bound divides the range", () => {
    const source = scripted([0xffffffff]);
    expect({ value: randomBelow(source, 4), calls: source.calls }).toEqual({
      value: 3,
      calls: 1,
    });
  });

  it("refuses a bound that is not a positive whole number", () => {
    for (const bound of [0, -1, 2.5, Number.NaN, 0x1_0000_0001]) {
      expect(() => randomBelow(scripted([1]), bound)).toThrow(/bound/);
    }
  });
});

describe("shuffle", () => {
  /**
   * Fisher–Yates from the top down over `[A, B, C, D]` with the draws
   * `[2, 0, 1]`: swap indices 3 and 2 → `[A, B, D, C]`; swap 2 and 0 →
   * `[D, B, A, C]`; swap 1 and 1 → unchanged. Nothing was rejected because every
   * draw is inside the largest multiple of its bound.
   */
  it("deals the exact order a written-down draw sequence produces", () => {
    const source = scripted([2, 0, 1]);
    expect(shuffle(["A", "B", "C", "D"], source)).toEqual(["D", "B", "A", "C"]);
    expect(source.calls).toBe(3);
  });

  it("is a permutation of its input and leaves the input alone", () => {
    const input = Array.from({ length: 52 }, (_, index) => index);
    const out = shuffle(input, createSeededRandom(7));
    expect(out).toHaveLength(52);
    expect([...out].sort((left, right) => left - right)).toEqual(input);
    expect(input[0]).toBe(0);
    expect(out).not.toEqual(input);
  });

  it("returns the same order for the same seed and a different one for another", () => {
    const input = Array.from({ length: 52 }, (_, index) => index);
    const first = shuffle(input, createSeededRandom(1));
    expect(shuffle(input, createSeededRandom(1))).toEqual(first);
    expect(shuffle(input, createSeededRandom(2))).not.toEqual(first);
  });
});
