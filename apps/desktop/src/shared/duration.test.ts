import { describe, expect, it } from "vitest";
import { clockText } from "./duration.js";

describe("clockText", () => {
  it("reads as whole minutes and zero-padded seconds", () => {
    expect(clockText(90)).toBe("1:30");
    expect(clockText(60)).toBe("1:00");
    expect(clockText(600)).toBe("10:00");
  });

  it("keeps the same shape under a minute", () => {
    expect(clockText(45)).toBe("0:45");
    expect(clockText(5)).toBe("0:05");
    expect(clockText(0)).toBe("0:00");
  });

  it("treats anything past the end, or unreadable, as over", () => {
    expect(clockText(-5)).toBe("0:00");
    expect(clockText(Number.NaN)).toBe("0:00");
    expect(clockText(Number.POSITIVE_INFINITY)).toBe("0:00");
  });

  it("floors a fraction rather than rounding a second that has not passed", () => {
    expect(clockText(90.9)).toBe("1:30");
  });
});
