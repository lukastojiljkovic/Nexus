import { describe, expect, it } from "vitest";
import { culturePlaylistTotalMs, formatCultureDuration } from "./format.js";

describe("formatCultureDuration", () => {
  it.each([
    [0, "0:00"],
    [999, "0:00"],
    [1_000, "0:01"],
    [1_999, "0:01"],
    [7_000, "0:07"],
    [65_000, "1:05"],
    [187_000, "3:07"],
    [214_000, "3:34"],
    [3_599_999, "59:59"],
    [3_600_000, "1:00:00"],
    [3_600_999, "1:00:00"],
    [3_723_000, "1:02:03"],
    [7_384_000, "2:03:04"],
  ])("reads %i ms as %s", (ms, expected) => {
    expect(formatCultureDuration(ms)).toBe(expected);
  });

  it("floors to the second, the way a player's clock does", () => {
    // 3:34.9 is a track the player calls 3:34: the number shown is the time
    // that has ACTUALLY elapsed, never a second the listener has not heard yet.
    expect(formatCultureDuration(214_900)).toBe("3:34");
  });

  it.each([[-1], [1.5], [NaN], [Infinity], [-Infinity]])("refuses %p", (ms) => {
    expect(() => formatCultureDuration(ms)).toThrow(RangeError);
  });
});

describe("culturePlaylistTotalMs", () => {
  it("adds a playlist up", () => {
    expect(culturePlaylistTotalMs([{ durationMs: 180_000 }, { durationMs: 200_000 }])).toBe(
      380_000,
    );
  });

  it("counts a track twice when the playlist holds it twice", () => {
    const track = { durationMs: 214_000 };
    expect(culturePlaylistTotalMs([track, { durationMs: 60_000 }, track])).toBe(488_000);
  });

  it("is zero for an empty playlist", () => {
    expect(culturePlaylistTotalMs([])).toBe(0);
  });

  it("is the sum the formatter reads, hours and all", () => {
    expect(formatCultureDuration(culturePlaylistTotalMs([{ durationMs: 3_600_000 }, { durationMs: 1_000 }]))).toBe(
      "1:00:01",
    );
  });

  it("refuses a negative duration rather than subtracting it", () => {
    expect(() => culturePlaylistTotalMs([{ durationMs: 1_000 }, { durationMs: -1 }])).toThrow(
      RangeError,
    );
  });
});
