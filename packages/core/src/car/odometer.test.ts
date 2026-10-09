import { describe, expect, it } from "vitest";

import {
  checkOdometerReading,
  currentSegment,
  estimateOdometerForDate,
  segmentForDate,
  type OdometerPoint,
} from "./odometer.js";

/** One reading, spelled short. Segment 1 unless a test says otherwise. */
function point(date: string, reading: number, segment = 1): OdometerPoint {
  return { date, reading, segment };
}

describe("currentSegment", () => {
  it("is 1 for a vehicle nothing has been recorded on", () => {
    expect(currentSegment([])).toBe(1);
  });

  it("is the highest segment the vehicle carries, not the last one listed", () => {
    expect(currentSegment([point("2026-06-01", 200, 2), point("2026-01-01", 100_000, 1)])).toBe(2);
  });
});

describe("segmentForDate", () => {
  const REPLACED = [point("2026-01-10", 100_000, 1), point("2026-06-05", 120, 2)];

  it("puts a reading dated after the replacement in the new segment", () => {
    expect(segmentForDate(REPLACED, "2026-06-05")).toBe(2);
    expect(segmentForDate(REPLACED, "2026-07-01")).toBe(2);
  });

  it("puts a reading caught up late back in the segment it happened in", () => {
    expect(segmentForDate(REPLACED, "2026-03-01")).toBe(1);
  });

  it("puts a reading dated before everything in the first segment", () => {
    expect(segmentForDate(REPLACED, "2025-12-31")).toBe(1);
    expect(segmentForDate([], "2026-03-01")).toBe(1);
  });
});

describe("checkOdometerReading", () => {
  const READINGS = [point("2026-01-01", 10_000), point("2026-02-01", 11_000)];

  it("is fine when the odometer only ever went forward", () => {
    expect(checkOdometerReading(READINGS, { date: "2026-03-01", reading: 12_000 })).toEqual({
      ok: true,
      segment: 1,
    });
    expect(checkOdometerReading(READINGS, { date: "2026-03-01", reading: 11_000 })).toEqual({
      ok: true,
      segment: 1,
    });
  });

  it("refuses a decrease and names the reading it fell below", () => {
    expect(checkOdometerReading(READINGS, { date: "2026-03-01", reading: 10_500 })).toEqual({
      ok: false,
      reason: "decreases",
      against: point("2026-02-01", 11_000),
    });
  });

  it("refuses a reading caught up late that falls below the one after it", () => {
    // 2026-01-15 sits between the two readings: 9 500 is below the 10 000 of
    // 2026-01-01, and 10 500 would break the 11 000 that follows it.
    expect(checkOdometerReading(READINGS, { date: "2026-01-15", reading: 9_500 })).toEqual({
      ok: false,
      reason: "decreases",
      against: point("2026-01-01", 10_000),
    });
    expect(checkOdometerReading(READINGS, { date: "2026-01-15", reading: 10_500 })).toEqual({
      ok: true,
      segment: 1,
    });
    expect(checkOdometerReading(READINGS, { date: "2026-01-15", reading: 11_500 })).toEqual({
      ok: false,
      reason: "decreases",
      against: point("2026-02-01", 11_000),
    });
  });

  it("lets two readings of one day differ, because a day is not an instant", () => {
    expect(checkOdometerReading(READINGS, { date: "2026-02-01", reading: 11_400 })).toEqual({
      ok: true,
      segment: 1,
    });
  });

  it("accepts a lower reading only when it opens a new segment", () => {
    const verdict = checkOdometerReading(READINGS, {
      date: "2026-03-01",
      reading: 40,
      startsNewSegment: true,
    });
    expect(verdict).toEqual({ ok: true, segment: 2 });
  });

  it("refuses a replaced odometer recorded behind a reading that is already there", () => {
    expect(
      checkOdometerReading(READINGS, {
        date: "2026-01-15",
        reading: 40,
        startsNewSegment: true,
      }),
    ).toEqual({ ok: false, reason: "not-newest" });
  });

  it("checks a late-caught-up reading against its OWN segment, not the newest one", () => {
    const replaced = [
      point("2026-01-01", 10_000, 1),
      point("2026-02-01", 11_000, 1),
      point("2026-06-01", 200, 2),
    ];
    // A reading caught up into March belongs to segment 1, so it is measured
    // against segment 1's 11 000 rather than against the 200 the odometer shows
    // today: 10 500 is refused although it is far above 200, and 11 200 is
    // taken although it is far below anything segment 2 will ever read.
    expect(checkOdometerReading(replaced, { date: "2026-03-01", reading: 10_500 })).toEqual({
      ok: false,
      reason: "decreases",
      against: point("2026-02-01", 11_000),
    });
    expect(checkOdometerReading(replaced, { date: "2026-03-01", reading: 11_200 })).toEqual({
      ok: true,
      segment: 1,
    });
  });

  it("does not compare across a segment break", () => {
    const replaced = [point("2026-01-01", 100_000, 1), point("2026-06-01", 300, 2)];
    expect(checkOdometerReading(replaced, { date: "2026-07-01", reading: 800 })).toEqual({
      ok: true,
      segment: 2,
    });
  });
});

describe("estimateOdometerForDate", () => {
  it("answers null with fewer than two readings in the current segment", () => {
    expect(estimateOdometerForDate([], "2026-03-01")).toBeNull();
    expect(estimateOdometerForDate([point("2026-01-01", 10_000)], "2026-03-01")).toBeNull();
  });

  it("fits a straight line through two readings and reads it forward", () => {
    // 10 000 at 2026-01-01 and 10 500 at 2026-01-11: 500 km over 10 days is
    // 50 km a day, and 2026-01-21 is ten days further on — 10 000 + 50 × 20.
    const readings = [point("2026-01-01", 10_000), point("2026-01-11", 10_500)];
    expect(estimateOdometerForDate(readings, "2026-01-21")).toBeCloseTo(11_000, 9);
    expect(estimateOdometerForDate(readings, "2026-01-01")).toBeCloseTo(10_000, 9);
  });

  /**
   * Least squares over three unevenly spaced readings — the case where the fit
   * and the endpoint-to-endpoint slope disagree, and the fit is the one asked
   * for. x is the day offset (0, 3, 15), y the odometer (10 000; 10 200; 11 100).
   * x̄ = 6, ȳ = 31 300/3. Σ(x−x̄)(y−ȳ) = (−6)(−1300/3) + (−3)(−700/3) + 9(2000/3)
   * = 2600 + 700 + 6000 = 9300; Σ(x−x̄)² = 36 + 9 + 81 = 126; slope = 9300/126
   * = 1550/21. Intercept = 31 300/3 − (1550/21)·6 = 209 800/21. At x = 20
   * (2026-01-21): 209 800/21 + 31 000/21 = 240 800/21 ≈ 11 466.67.
   */
  it("fits by least squares rather than by the two endpoints", () => {
    const readings = [
      point("2026-01-01", 10_000),
      point("2026-01-04", 10_200),
      point("2026-01-16", 11_100),
    ];
    expect(estimateOdometerForDate(readings, "2026-01-21")).toBeCloseTo(240_800 / 21, 6);
  });

  it("never extrapolates backwards before the first reading", () => {
    const readings = [point("2026-01-01", 10_000), point("2026-01-11", 10_500)];
    expect(estimateOdometerForDate(readings, "2025-12-31")).toBeNull();
  });

  it("falls back to the highest reading when every reading is of one day", () => {
    // The fit's denominator is zero, so there is no slope to read: the odometer
    // only goes up, which makes the largest same-day reading the honest answer.
    const readings = [point("2026-01-01", 10_000), point("2026-01-01", 10_230)];
    expect(estimateOdometerForDate(readings, "2026-02-01")).toBe(10_230);
  });

  it("fits only the CURRENT segment — the old odometer is another odometer", () => {
    const readings = [
      point("2026-01-01", 100_000, 1),
      point("2026-02-01", 101_000, 1),
      point("2026-06-01", 200, 2),
      point("2026-06-11", 700, 2),
    ];
    // 500 over 10 days is 50 a day, so 2026-06-21 reads 200 + 50 × 20.
    expect(estimateOdometerForDate(readings, "2026-06-21")).toBeCloseTo(1_200, 9);
    // And there is no answer for a date before the segment that is current: the
    // fit describes the odometer that is in the car now.
    expect(estimateOdometerForDate(readings, "2026-05-25")).toBeNull();
  });
});
