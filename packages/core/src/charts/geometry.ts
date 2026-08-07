/**
 * Chart geometry — the arithmetic every drawn graphic in the product shares.
 *
 * Lives in `@nexus/core` rather than beside the components because it is pure
 * maths over numbers and ISO date strings: no React, no DOM, no Node. That is
 * also what makes it testable, and these are exactly the functions that fail
 * silently when they are wrong — a NaN reaching a scale does not throw, it
 * makes the chart quietly disappear.
 */

import type { WeekStart } from "../calendar/calendarGrid.js";

export interface Point {
  x: number;
  y: number;
}

/**
 * The bounds of a series, or null when there is nothing to bound.
 *
 * Non-finite values are skipped rather than propagated. A single NaN in a
 * series — a division by zero in an average, a malformed row — would otherwise
 * turn the domain into [NaN, NaN], every coordinate into NaN, and the whole
 * chart into an empty box with no error anywhere.
 */
export function extent(values: readonly number[]): [number, number] | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    seen = true;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return seen ? [min, max] : null;
}

/**
 * Round a rough step up to the nearest "nice" one — the 1 / 2 / 5 ladder at
 * whatever magnitude the data sits at. Axis labels a person can read are
 * multiples of these and of nothing else.
 */
export function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const stepped = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return stepped * magnitude;
}

/**
 * Tick values spanning `[min, max]` on round numbers, aiming for roughly
 * `target` of them.
 *
 * A flat series returns the single value it has. That is a real case — a
 * balance that did not move, one measurement taken — and inventing a range
 * around it would draw movement that never happened.
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const step = niceStep((hi - lo) / Math.max(1, target));
  // Both ends are rounded OUTWARD to a multiple of the step, so the axis always
  // contains the data. Deriving the stop from `hi` directly instead — looping
  // while `value <= hi` — leaves the top of the range off the axis whenever the
  // step does not divide it: -30…45 at a step of 20 stopped at 40, and the
  // largest point in the series sat above the highest gridline.
  const start = Math.floor(lo / step) * step;
  const stop = Math.ceil(hi / step) * step;
  // The count is an integer by construction; `round` only absorbs the float
  // error in the division. Counting steps rather than accumulating by repeated
  // addition also keeps 0.1 + 0.1 + … from drifting off the ladder.
  const count = Math.min(64, Math.round((stop - start) / step));
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const ticks: number[] = [];
  for (let i = 0; i <= count; i += 1) {
    ticks.push(Number((start + i * step).toFixed(decimals)));
  }
  return ticks;
}

/**
 * A linear mapping from a data domain onto a pixel range. Invert the range to
 * get an SVG y axis, whose origin is at the top.
 *
 * A zero-width domain maps to the middle of the range instead of dividing by
 * zero. Every value being equal is ordinary data, and a flat line drawn
 * halfway up is the honest picture of it.
 */
export function scaleLinear(
  domain: readonly [number, number],
  range: readonly [number, number],
): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0) {
    const middle = (r0 + r1) / 2;
    return () => middle;
  }
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

/** Two decimals is below the resolution of any screen this renders on, and it
 *  keeps a 400-point path from carrying a kilobyte of meaningless digits. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * An SVG `d` for a polyline through `points`.
 *
 * A single point becomes a zero-length segment rather than nothing: one
 * measurement is data, and with `stroke-linecap: round` it renders as a dot.
 * Dropping it would tell someone they have no data when they have some.
 */
export function linePath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  const head = points[0];
  if (head === undefined) return "";
  let d = `M${round(head.x)} ${round(head.y)}`;
  for (const p of points.length === 1 ? [head] : points.slice(1)) {
    d += `L${round(p.x)} ${round(p.y)}`;
  }
  return d;
}

/** The same line, closed down to `baselineY` and back — a filled area. */
export function areaPath(points: readonly Point[], baselineY: number): string {
  if (points.length === 0) return "";
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return "";
  return (
    `${linePath(points)}L${round(last.x)} ${round(baselineY)}` +
    `L${round(first.x)} ${round(baselineY)}Z`
  );
}

const DAY_MS = 86_400_000;

function parseIsoUtc(iso: string): number {
  // Explicit UTC midnight. `new Date("2026-03-29")` is already UTC by spec, but
  // stating it here is what keeps a future refactor from reaching for a local
  // constructor and silently reintroducing the DST bug the tests pin.
  const [y, m, d] = iso.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return Number.NaN;
  return Date.UTC(y, m - 1, d);
}

function isoFromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * A year (or any range) laid out as heatmap columns: one column per week, seven
 * rows, top row = `weekStartsOn`.
 *
 * Leading and trailing cells are `null` rather than being filled with
 * neighbouring dates, and that is the whole correctness question here. Packing
 * the days in sequence and letting the grid wrap looks right at a glance and
 * puts every day of the year on the wrong weekday row — the classic
 * contribution-graph bug. Padding keeps the promise the graphic makes: a cell's
 * ROW is its weekday.
 *
 * All arithmetic is UTC. Stepping a local-time date by 24 hours across a
 * spring-forward boundary lands on the same calendar day twice, which silently
 * drops a day from the year.
 */
export function heatmapWeeks(
  startIso: string,
  endIso: string,
  weekStartsOn: WeekStart = 1,
): (string | null)[][] {
  const start = parseIsoUtc(startIso);
  const end = parseIsoUtc(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];

  const weeks: (string | null)[][] = [];
  let column: (string | null)[] = [];

  // Blank cells before the first real day, so it lands on its own weekday row.
  const leading = (new Date(start).getUTCDay() - weekStartsOn + 7) % 7;
  for (let i = 0; i < leading; i += 1) column.push(null);

  for (let ms = start; ms <= end; ms += DAY_MS) {
    column.push(isoFromUtc(ms));
    if (column.length === 7) {
      weeks.push(column);
      column = [];
    }
  }
  if (column.length > 0) {
    while (column.length < 7) column.push(null);
    weeks.push(column);
  }
  return weeks;
}
