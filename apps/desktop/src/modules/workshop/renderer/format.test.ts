import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../../../renderer/src/strings.js";
import { boundsText, countText, durationText, millimetreCubeText, millimetreText, pathParts } from "./format.js";

/**
 * The module's figures, in both languages. Every expected string here is what
 * `Intl` produces for that locale - the Serbian grouping character and decimal
 * mark are the ones `@nexus/core`'s calculator tests pin as well („1.234.567"
 * and „,"), so these assertions are the same fact stated where this module reads
 * it rather than a second opinion about Serbian.
 */

afterEach(() => {
  applyLocale("sr");
});

describe("numbers in the active locale", () => {
  it("groups and separates the way each language does", () => {
    applyLocale("sr");
    expect(countText(1234567)).toBe("1.234.567");
    expect(millimetreText(12.34)).toBe("12,3 mm");
    expect(millimetreCubeText(1000)).toBe("1.000 mm³");

    applyLocale("en");
    expect(countText(1234567)).toBe("1,234,567");
    expect(millimetreText(12.34)).toBe("12.3 mm");
    expect(millimetreCubeText(1000)).toBe("1,000 mm³");
  });

  it("never leaves a length without its unit, or a bound without its two companions", () => {
    applyLocale("sr");
    expect(millimetreText(0)).toBe("0,0 mm");
    expect(boundsText([10, 10, 10])).toBe("10,0 × 10,0 × 10,0 mm");

    applyLocale("en");
    expect(boundsText([30, 0.5, 2.25])).toBe("30.0 × 0.5 × 2.3 mm");
  });
});

describe("durationText", () => {
  it("reads in the reader's own units, largest first", () => {
    applyLocale("sr");
    // 2 h 35 min 7 s: an hour to show, so the seconds are dropped.
    expect(durationText(2 * 3600 + 35 * 60 + 7)).toBe("2 č 35 min");
    expect(durationText(35 * 60)).toBe("35 min");
    expect(durationText(48)).toBe("48 s");
    // Under a minute the seconds are the whole answer: "0 min" would say nothing.
    expect(durationText(0)).toBe("0 s");

    applyLocale("en");
    expect(durationText(2 * 3600 + 35 * 60)).toBe("2 h 35 min");
    // 90 seconds is one minute and a half, and the seconds are dropped once
    // there is a minute to read: the figure is an estimate, not a stopwatch.
    expect(durationText(90)).toBe("1 min");
  });

  it("refuses to print a negative or a broken duration as anything but zero", () => {
    applyLocale("sr");
    expect(durationText(-5)).toBe("0 s");
    expect(durationText(Number.NaN)).toBe("0 s");
  });
});

describe("pathParts", () => {
  it("splits a path on either separator, and a bare name has no directory", () => {
    expect(pathParts("C:\\models\\cube.stl")).toEqual({
      name: "cube.stl",
      directory: "C:\\models\\",
    });
    expect(pathParts("/home/luka/cube.stl")).toEqual({
      name: "cube.stl",
      directory: "/home/luka/",
    });
    expect(pathParts("cube.stl")).toEqual({ name: "cube.stl", directory: "" });
  });
});
