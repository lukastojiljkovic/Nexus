import { describe, expect, it } from "vitest";
import { isWithinQuietHours } from "./quietHours.js";

describe("isWithinQuietHours", () => {
  it("is never within quiet hours when both bounds are null", () => {
    expect(isWithinQuietHours("23:30", null, null)).toBe(false);
    expect(isWithinQuietHours("00:00", null, null)).toBe(false);
    expect(isWithinQuietHours("12:00", null, null)).toBe(false);
  });

  describe("a plain same-day window (quietFrom < quietTo)", () => {
    it("is within an hour strictly inside the window", () => {
      expect(isWithinQuietHours("13:00", "12:00", "14:00")).toBe(true);
    });

    it("is within at the inclusive start boundary", () => {
      expect(isWithinQuietHours("12:00", "12:00", "14:00")).toBe(true);
    });

    it("is not within at the exclusive end boundary", () => {
      expect(isWithinQuietHours("14:00", "12:00", "14:00")).toBe(false);
    });

    it("is not within before the window starts", () => {
      expect(isWithinQuietHours("11:59", "12:00", "14:00")).toBe(false);
    });

    it("is not within after the window ends", () => {
      expect(isWithinQuietHours("14:01", "12:00", "14:00")).toBe(false);
    });
  });

  describe("an overnight window (quietFrom > quietTo)", () => {
    it("is within late in the evening, at/after quietFrom", () => {
      expect(isWithinQuietHours("23:00", "22:00", "07:00")).toBe(true);
      expect(isWithinQuietHours("22:00", "22:00", "07:00")).toBe(true);
    });

    it("is within past midnight, strictly before quietTo", () => {
      expect(isWithinQuietHours("03:00", "22:00", "07:00")).toBe(true);
      expect(isWithinQuietHours("00:00", "22:00", "07:00")).toBe(true);
    });

    it("is not within at the exclusive end boundary after midnight", () => {
      expect(isWithinQuietHours("07:00", "22:00", "07:00")).toBe(false);
    });

    it("is not within during the midday gap between quietTo and quietFrom", () => {
      expect(isWithinQuietHours("12:00", "22:00", "07:00")).toBe(false);
      expect(isWithinQuietHours("07:01", "22:00", "07:00")).toBe(false);
      expect(isWithinQuietHours("21:59", "22:00", "07:00")).toBe(false);
    });
  });

  it("treats an equal quietFrom/quietTo as a zero-length window, never a 24-hour one", () => {
    expect(isWithinQuietHours("00:00", "12:00", "12:00")).toBe(false);
    expect(isWithinQuietHours("12:00", "12:00", "12:00")).toBe(false);
    expect(isWithinQuietHours("23:59", "12:00", "12:00")).toBe(false);
  });
});
