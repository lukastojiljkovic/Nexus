import { afterEach, describe, expect, it, vi } from "vitest";
import { cryptoRandomBelow, randomId } from "./entropy.js";

/**
 * The module's randomness (mini-apps): the engine's `RandomBelow` contract,
 * implemented on the platform's cryptographic source without modulo bias.
 *
 * The two interesting cases are scripted rather than sampled: a statistical
 * test of "is it uniform" would be slow and still weak, while a source that
 * answers the top 32-bit value first proves the rejection rule exactly - that
 * value is 3 in `% 6` and must never be the answer.
 */
describe("cryptoRandomBelow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers a whole number inside the bound the engine asked for", () => {
    for (const bound of [1, 2, 6, 20, 1000]) {
      for (let draw = 0; draw < 50; draw += 1) {
        const value = cryptoRandomBelow(bound);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(bound);
      }
    }
  });

  it("refuses a bound that is not a positive whole number", () => {
    expect(() => cryptoRandomBelow(0)).toThrow(RangeError);
    expect(() => cryptoRandomBelow(-3)).toThrow(RangeError);
    expect(() => cryptoRandomBelow(2.5)).toThrow(RangeError);
  });

  it("redraws a value that would bias the low remainders instead of taking it modulo", () => {
    // The largest multiple of 6 below 2^32 is 4294967292, so 4294967293..4294967295
    // are drawn again. 0xffffffff would answer 3 under `% 6`; the scripted source
    // refuses it and answers 7 next, which is 1.
    const draws = [0xffffffff, 7];
    vi.stubGlobal("crypto", {
      getRandomValues: (buffer: Uint32Array): Uint32Array => {
        buffer[0] = draws.shift() ?? 0;
        return buffer;
      },
    });

    expect(cryptoRandomBelow(6)).toBe(1);
    expect(draws).toEqual([]);
  });

  it("gives up rather than hanging on a source that only ever refuses", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (buffer: Uint32Array): Uint32Array => {
        buffer[0] = 0xffffffff;
        return buffer;
      },
    });

    expect(() => cryptoRandomBelow(6)).toThrow(/not answering/);
  });
});

describe("randomId", () => {
  it("mints a fixed-width hex id that the wire and the store both accept", () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomId()));

    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});
