import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../../../renderer/src/strings.js";
import { formatBestTime, formatCount, formatElapsed } from "./format.js";

/**
 * The arcade's figures (ADR-090), in both languages the app serves. The Serbian
 * expectations are the point rather than a copy of the code: they are what this
 * product's language actually does with a thousands separator and a decimal
 * mark, and `Intl` is the only thing that may decide them.
 */

afterEach(() => {
  applyLocale("sr");
});

describe("formatBestTime", () => {
  it("reads under a minute as seconds and tenths, truncated rather than rounded", () => {
    expect(formatBestTime(0)).toBe("0,0 s");
    expect(formatBestTime(1_000)).toBe("1,0 s");
    expect(formatBestTime(41_500)).toBe("41,5 s");
    // 1 234 ms is 1,234 s: the tenth is truncated, so it is 1,2 and not 1,3.
    expect(formatBestTime(1_234)).toBe("1,2 s");
    expect(formatBestTime(12_349)).toBe("12,3 s");
    expect(formatBestTime(59_960)).toBe("59,9 s");
  });

  it("reads a minute and up as m:ss min, with the seconds padded", () => {
    expect(formatBestTime(60_000)).toBe("1:00 min");
    expect(formatBestTime(119_400)).toBe("1:59 min");
    expect(formatBestTime(300_000)).toBe("5:00 min");
    expect(formatBestTime(3_661_000)).toBe("61:01 min");
  });

  it("follows the interface language", () => {
    applyLocale("en");
    expect(formatBestTime(41_500)).toBe("41.5 s");
    expect(formatBestTime(60_000)).toBe("1:00 min");
  });
});

describe("formatElapsed", () => {
  it("is a whole-second clock that never runs backwards", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(999)).toBe("0:00");
    expect(formatElapsed(1_000)).toBe("0:01");
    expect(formatElapsed(41_500)).toBe("0:41");
    expect(formatElapsed(600_000)).toBe("10:00");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("formatCount", () => {
  it("groups thousands the way the language does", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1_000)).toBe("1.000");
    expect(formatCount(1_234_567)).toBe("1.234.567");
  });

  it("switches separator with the language", () => {
    applyLocale("en");
    expect(formatCount(1_000)).toBe("1,000");
  });
});
