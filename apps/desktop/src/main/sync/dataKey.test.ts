import { describe, expect, it } from "vitest";

import { dataKeyBytes } from "./dataKey.js";

/**
 * Three cases, and the two refusals are the point.
 *
 * A parser that did its best would return thirty-two bytes for a key it could
 * not read, and both callers wrap the account's master key with the result — so
 * the only observable consequence would be a wrap that does not open, later, on
 * a different machine.
 */
describe("dataKeyBytes", () => {
  it("reads sixty-four hex characters, in either case", () => {
    expect([...dataKeyBytes(`${"ab".repeat(31)}CD`)]).toEqual([
      ...Array<number>(31).fill(0xab),
      0xcd,
    ]);
  });

  it("refuses a key of the wrong length rather than padding it", () => {
    expect(() => dataKeyBytes("ab".repeat(31))).toThrow(TypeError);
    expect(() => dataKeyBytes("ab".repeat(33))).toThrow(TypeError);
    expect(() => dataKeyBytes("")).toThrow(TypeError);
  });

  it("refuses a non-hex character rather than storing the NaN it would parse to", () => {
    // Sixty-four characters, one of them not hex. `parseInt("zb", 16)` is NaN
    // and a `Uint8Array` stores NaN as 0, so a best-effort parser answers a
    // full-length key here — which is the whole failure this guard exists for.
    expect(() => dataKeyBytes(`zb${"ab".repeat(31)}`)).toThrow(TypeError);
  });
});
