import { describe, expect, it } from "vitest";

import { mulberry32, SKY_WORLD, starField } from "./material.js";

/**
 * These are not "does the PRNG look random" tests — nobody cares whether the
 * sky's distribution passes a chi-squared. The entire contract of this module
 * is BIT-IDENTICAL DETERMINISM: the same seed must produce the same sequence
 * on every engine, every platform and every relaunch, because the sky is
 * chrome and a constellation that rearranges itself on resize is a bug.
 *
 * So the values below are PINNED, not derived. If a future edit reaches for
 * `Math.random`, for a `Math.sin`-based hash, or for floating-point arithmetic
 * anywhere in the generator, these numbers change and the test says so — which
 * is the only way that class of regression is ever visible, since a differently
 * arranged sky still looks exactly like a sky.
 */
describe("mulberry32", () => {
  it("produces a pinned sequence for a given seed", () => {
    const rand = mulberry32(0);
    expect([rand(), rand(), rand(), rand(), rand()]).toEqual([
      0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111,
      0.46732782293111086,
    ]);
  });

  it("produces the same pinned sequence for the sky's own seed", () => {
    // 0x76657370 is `starField`'s default — the one seed whose output a user
    // has actually looked at.
    const rand = mulberry32(0x76657370);
    expect([rand(), rand(), rand()]).toEqual([
      0.7880560879129916, 0.640124561265111, 0.20000257366336882,
    ]);
  });

  it("replays identically from a fresh generator — relaunch draws the same sky", () => {
    const first = Array.from({ length: 64 }, mulberry32(0x76657370));
    const second = Array.from({ length: 64 }, mulberry32(0x76657370));
    expect(second).toEqual(first);
  });

  it("diverges immediately for two different seeds", () => {
    // Adjacent seeds are the interesting case: a weak hash correlates them and
    // two "different" skies come out looking like the same one shifted.
    const a = Array.from({ length: 8 }, mulberry32(1));
    const b = Array.from({ length: 8 }, mulberry32(2));
    expect(a[0]).toBe(0.6270739405881613);
    expect(b[0]).not.toBe(a[0]);
    expect(a.some((value, i) => value === b[i])).toBe(false);
  });

  it("stays inside [0, 1)", () => {
    const rand = mulberry32(0x51ee7);
    for (let i = 0; i < 4096; i += 1) {
      const value = rand();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("coerces the seed to a uint32, so -1 and 2^32-1 are the same sky", () => {
    // `seed >>> 0` is load-bearing: it is what makes the generator pure integer
    // arithmetic. Pinning the coercion keeps a future signature widening
    // ("just take a string hash") from silently changing every existing seed.
    expect(mulberry32(-1)()).toBe(mulberry32(4294967295)());
    expect(mulberry32(7.9)()).toBe(mulberry32(7)());
  });
});

describe("starField", () => {
  it("places stars in the fixed world box, not in the viewport", () => {
    // World coordinates are what make a resize REVEAL sky instead of moving
    // the stars that were already on screen.
    for (const star of starField()) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThan(SKY_WORLD.width);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThan(SKY_WORLD.height);
    }
  });

  it("returns the pinned canonical field — the same sky on every launch", () => {
    const field = starField();
    expect(field).toHaveLength(420);
    expect(field[0]).toEqual({
      x: 2458.078315258026,
      y: 432.00555911287665,
      r: 0.9242493628878428,
      brightness: 0.38568123898894796,
    });
    expect(field[419]).toEqual({
      x: 2706.4915850758553,
      y: 1886.2926644459367,
      r: 0.5431423658160077,
      brightness: 0.03922033256000699,
    });
  });

  it("draws every star from the same stream, so count changes the field's LENGTH only", () => {
    // Three `rand()` calls per star, in a fixed order. A prefix relationship is
    // what lets `density` be turned up without redrawing the sky underneath it.
    const few = starField(2, 42, { width: 100, height: 50 });
    const many = starField(5, 42, { width: 100, height: 50 });
    expect(many.slice(0, 2)).toEqual(few);
    expect(few[0]).toEqual({
      x: 44.82905589975417,
      y: 42.62328967452049,
      r: 0.6436119039819581,
      brightness: 0.13055627634723463,
    });
  });

  it("skews brightness hard toward the faint end", () => {
    // The fourth power is the difference between a sky and a scatter of dots:
    // mostly very faint, a few carriers. `bright > 0.62` is the threshold
    // `StarField` paints in the accent instead of the text colour, so the count
    // here is literally „how many gold stars are in the rail".
    const field = starField();
    expect(field.filter((s) => s.brightness < 0.25)).toHaveLength(304);
    expect(field.filter((s) => s.brightness > 0.62)).toHaveLength(42);
  });

  it("ties radius to brightness, so a faint star is never a fat grey blob", () => {
    for (const star of starField()) {
      expect(star.r).toBeCloseTo(0.5 + star.brightness * 1.1, 12);
      expect(star.r).toBeGreaterThanOrEqual(0.5);
      expect(star.r).toBeLessThanOrEqual(1.6);
    }
  });

  it("returns nothing for a count of zero rather than falling back to a default", () => {
    expect(starField(0)).toEqual([]);
  });
});
