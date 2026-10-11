import { describe, expect, it } from "vitest";

import { createSeededRandom, randomBelow, rollDice, rollDie, shuffled } from "./random.js";

/**
 * The one test file for `games/random.ts`, the seeded source every game draws
 * from. The puzzle engines' own copy of these cases moved here when their private
 * generator was folded into this module, so a regression in the arithmetic is
 * named in one place rather than three.
 */

describe("createSeededRandom", () => {
  it("replays the same sequence for the same seed", () => {
    const a = createSeededRandom(12345);
    const b = createSeededRandom(12345);
    const left = [a.next(), a.next(), a.next(), a.next()];
    const right = [b.next(), b.next(), b.next(), b.next()];
    expect(left).toEqual(right);
  });

  it("pins the first three draws of seed 0 and seed 1", () => {
    // The values are a regression pin for this exact implementation of
    // mulberry32; a change to the arithmetic that shifts every downstream
    // board, puzzle and deal must be a deliberate edit here, not a silent one.
    const zero = createSeededRandom(0);
    expect([zero.next(), zero.next(), zero.next()]).toEqual([
      0.26642920868471265, 0.0003297457005828619, 0.2232720274478197,
    ]);
    const one = createSeededRandom(1);
    expect([one.next(), one.next(), one.next()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
  });

  it("separates different seeds", () => {
    expect(createSeededRandom(7).next()).not.toBe(createSeededRandom(8).next());
  });

  it("stays inside [0, 1) over a long run", () => {
    const random = createSeededRandom(2026);
    let lowest = 1;
    let highest = 0;
    for (let i = 0; i < 100_000; i += 1) {
      const value = random.next();
      lowest = Math.min(lowest, value);
      highest = Math.max(highest, value);
    }
    expect(lowest).toBeGreaterThanOrEqual(0);
    expect(highest).toBeLessThan(1);
  });

  it("carries its position as plain data, so a state can resume it", () => {
    const random = createSeededRandom(99);
    random.next();
    random.next();
    const resumed = createSeededRandom(random.state);
    expect(resumed.next()).toBe(random.next());
  });
});

describe("randomBelow", () => {
  it("gives every value of a small bound in a long run", () => {
    const random = createSeededRandom(4242);
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60_000; i += 1) {
      const drawn = randomBelow(random, 6);
      counts[drawn] = (counts[drawn] ?? 0) + 1;
    }
    // A uniform draw over 6 values lands within one percent of 10 000 each with
    // overwhelming probability; the band is wide enough to never flake and
    // narrow enough that a biased draw cannot pass.
    for (const count of counts) {
      expect(count).toBeGreaterThan(9_400);
      expect(count).toBeLessThan(10_600);
    }
  });

  it("refuses a bound that is not a positive whole number", () => {
    const random = createSeededRandom(1);
    expect(() => randomBelow(random, 0)).toThrow(RangeError);
    expect(() => randomBelow(random, -3)).toThrow(RangeError);
    expect(() => randomBelow(random, 2.5)).toThrow(RangeError);
  });
});

describe("shuffled", () => {
  it("keeps every element and leaves the input alone", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const frozen = [...input];
    const out = shuffled(input, createSeededRandom(11));
    expect([...out].sort((a, b) => a - b)).toEqual(frozen);
    expect(input).toEqual(frozen);
  });

  it("reorders a ten-element list for at least one seed in twenty", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let reordered = 0;
    for (let seed = 0; seed < 20; seed += 1) {
      const out = shuffled(input, createSeededRandom(seed));
      if (out.some((value, index) => value !== input[index])) reordered += 1;
    }
    expect(reordered).toBeGreaterThan(15);
  });
});

describe("rollDie and rollDice", () => {
  it("pins a die and a pair against the stream's own first draws", () => {
    // Hand calculation, from the seed-0 draws pinned above: floor(0.266429… × 6)
    // is 1 and floor(0.000329… × 6) is 0, so the two faces are 2 and 1.
    expect(rollDie(createSeededRandom(0), 6)).toBe(2);
    expect(rollDice(createSeededRandom(0), 2, 6)).toEqual([2, 1]);
  });

  it("gives every face of a six-sided die over a long run", () => {
    const random = createSeededRandom(0x5eed);
    const faces = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60_000; i += 1) {
      const face = rollDie(random, 6);
      expect(face).toBeGreaterThanOrEqual(1);
      expect(face).toBeLessThanOrEqual(6);
      faces[face - 1] = (faces[face - 1] ?? 0) + 1;
    }
    for (const count of faces) expect(count).toBeGreaterThan(9_400);
  });

  it("rolls as many dice as it was asked for, in order, and refuses a bad die", () => {
    const random = createSeededRandom(7);
    expect(rollDice(random, 3, 20)).toHaveLength(3);
    expect(rollDice(random, 0, 6)).toEqual([]);
    expect(() => rollDie(createSeededRandom(1), 0)).toThrow(RangeError);
  });
});
