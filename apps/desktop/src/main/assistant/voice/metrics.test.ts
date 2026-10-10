import { describe, expect, it } from "vitest";

import { formatRealTimeFactor, realTimeFactor } from "./metrics.js";

describe("realTimeFactor", () => {
  it("is one when the audio takes exactly as long as it is", () => {
    // 16 000 samples at 16 kHz is 1 s; 1 000 ms to do it is 1x.
    expect(realTimeFactor(16_000, 16_000, 1_000)).toBe(1);
  });

  it("is the ratio a hand calculation gives", () => {
    // 4 s of audio (64 000 samples at 16 kHz) in 1 250 ms: 4 / 1.25 = 3.2.
    expect(realTimeFactor(64_000, 16_000, 1_250)).toBeCloseTo(3.2, 10);
    // 30 s of audio in 45 000 ms: 30 / 45 = 0.666 7 — slower than real time.
    expect(realTimeFactor(480_000, 16_000, 45_000)).toBeCloseTo(0.666_67, 4);
  });

  it("refuses the inputs that would produce a meaningless number", () => {
    expect(() => realTimeFactor(-1, 16_000, 100)).toThrow(RangeError);
    expect(() => realTimeFactor(16_000, 0, 100)).toThrow(RangeError);
    expect(() => realTimeFactor(16_000, 16_000, 0)).toThrow(RangeError);
  });
});

describe("formatRealTimeFactor", () => {
  it("prints two decimals and the unit", () => {
    expect(formatRealTimeFactor(3.2)).toBe("3.20x real time");
    expect(formatRealTimeFactor(0.6667)).toBe("0.67x real time");
  });
});
