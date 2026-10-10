import type { Point } from "@nexus/core";
import type { LabSampleView } from "../shared/ipc.js";

/**
 * The LAB page's pure helpers: what a number becomes on screen, which series a
 * chart draws, and how a log's lines are shown.
 *
 * **Why these are here rather than inline in the page.** Every one of them is a
 * decision with an answer a test can pin — a coordinate's decimals, the scale a
 * chart is drawn against, the point at which a log's tail is what you are looking
 * at — and a page that inlined them would be a page whose arithmetic nobody could
 * check without a running canvas. `timers/renderer/timing.ts` is the same file
 * for the same reason.
 *
 * **Everything read by a person goes through `Intl`.** A latitude is a number in
 * the active locale (`48,118` in Serbian, `48.118` in English) and an instant is
 * a date and a time in that locale's own shape; SQLite's `2026-10-10T08:00:00.000Z`
 * is a storage format and never a display one.
 *
 * **A chart is drawn against the READING INDEX, and that is not a compromise.**
 * A device prints when it has something to say, so its own spacing is uneven: an
 * x axis in milliseconds would draw a straight line through readings that
 * arrived seconds apart and imply a rate the sketch never promised. The index is
 * what the list under the chart is scrolled through, and the caption says how
 * many readings are on screen.
 */

/**
 * The fix quality an NMEA `GGA` reports, as one of the nine codes the standard
 * defines (0–8).
 *
 * A code rather than a sentence because the sentence is user-facing copy and
 * belongs in this module's own table; what belongs HERE is the mapping, which is
 * the part a test can pin. An unknown code is `"none"` rather than a guess: a
 * receiver that sends 9 is a receiver this parser does not know how to describe.
 */
export type FixQualityCode =
  | "none"
  | "gps"
  | "dgps"
  | "pps"
  | "rtk"
  | "floatRtk"
  | "estimated"
  | "manual"
  | "simulation";

const FIX_QUALITY: readonly FixQualityCode[] = [
  "none",
  "gps",
  "dgps",
  "pps",
  "rtk",
  "floatRtk",
  "estimated",
  "manual",
  "simulation",
];

/** The code for one reported quality, or `"none"` for anything the standard does not define. */
export function fixQualityCode(quality: number | null): FixQualityCode {
  if (quality === null || !Number.isInteger(quality)) return "none";
  return FIX_QUALITY[quality] ?? "none";
}

/** A latitude or a longitude, at the six decimals a consumer GPS actually resolves — more would be digits the receiver invented. */
export function formatCoordinate(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
    useGrouping: false,
  }).format(value);
}

/** One measured value, at the number of decimals its own unit deserves. */
export function formatMeasure(value: number, decimals: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** A ratio as a percentage — health, a depth of discharge — with one decimal. */
export function formatPercent(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ratio);
}

/** An instant as the reader's own date and time, or the raw value when it is not one. */
export function formatInstant(iso: string, locale: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(at);
}

/**
 * A duration in milliseconds as the two largest units it needs — hours and
 * minutes, minutes and seconds, or seconds — through `Intl`, so each unit
 * carries the locale's own abbreviation.
 */
export function formatDurationMs(ms: number, locale: string): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const unit = (value: number, which: "hour" | "minute" | "second"): string =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit: which,
      unitDisplay: "narrow",
    }).format(value);
  if (hours > 0) return `${unit(hours, "hour")} ${unit(minutes, "minute")}`;
  if (minutes > 0) return `${unit(minutes, "minute")} ${unit(seconds, "second")}`;
  return unit(seconds, "second");
}

/** What a chart needs: one series' points and the x range they are drawn against. */
export interface ReadingSeries {
  readonly points: readonly Point[];
  readonly domain: readonly [number, number];
}

/**
 * The points for one column of a log's readings.
 *
 * `window` takes the NEWEST readings, which is what a live chart is: the tail of
 * a stream rather than its first second. Fewer than two readings is `null`
 * rather than one point or an empty series — a chart answers a question about a
 * change, and one reading is not a change. The x axis is the reading's own index
 * within the window (see the file header), and the y domain is left to the
 * chart, which rounds it outward to whole ticks.
 */
export function readingSeries(
  samples: readonly LabSampleView[],
  column: number,
  window: number,
): ReadingSeries | null {
  if (!Number.isInteger(column) || column < 0) return null;
  const tail = samples.length > window ? samples.slice(samples.length - window) : samples;
  const values: number[] = [];
  for (const sample of tail) {
    const value = sample.values[column];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    values.push(value);
  }
  if (values.length < 2) return null;
  return {
    points: values.map((value, index) => ({ x: index, y: value })),
    domain: [0, values.length - 1],
  };
}

/**
 * The tail of a terminal's lines, as the view shows them.
 *
 * A terminal that has been open for an hour holds tens of thousands of lines and
 * a page that rendered all of them would be a page that hangs: the newest
 * `limit` are what is on screen, and the count that was dropped is stated beside
 * them rather than hidden — a log that quietly loses its beginning is the bug
 * this function exists to make visible.
 */
export function visibleLines(lines: readonly string[], limit: number): readonly string[] {
  if (limit <= 0) return [];
  return lines.length > limit ? lines.slice(lines.length - limit) : lines;
}

/** The number of lines a view of `lines` does not show. */
export function hiddenLineCount(lines: readonly string[], limit: number): number {
  return Math.max(0, lines.length - limit);
}
