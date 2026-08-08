import type { WeekStart } from "@nexus/core";
import type { ChartTone } from "./CellMatrix.js";
import { ChartFrame } from "./ChartFrame.js";

/**
 * The period a ring stands for. A ring is only ever a PERIOD or a single
 * fraction — never categories walked around a circle, which is a pie chart
 * wearing a different shape. `weekStartsOn` reuses the calendar module's own
 * type rather than a second `0 | 1`, so a week ring and a week grid can never
 * silently disagree about which day is first.
 */
export type RadialPeriod = { kind: "day" } | { kind: "week"; weekStartsOn: WeekStart } | { kind: "year" };

export interface RadialSpoke {
  /** Slot index within the period: hour (0-23), weekday (0-6) or month (0-11). */
  at: number;
  /** 0…1 of the ring's radius. Clamped for DRAWING but not for state. */
  value: number;
  tone: ChartTone;
}

export interface RadialMark {
  at: number;
  label: string;
  tone: ChartTone;
}

export interface RadialCycleProps {
  title: string;
  description: string;
  caption?: string;
  empty: { reason: string } | null;
  period: RadialPeriod;
  spokes?: readonly RadialSpoke[];
  marks?: readonly RadialMark[];
  hand?: { at: number } | null;
  /**
   * Slot indices that were never asked of the user — no dial tick, no spoke,
   * ever, not even a zero-length one. Different from a slot that simply has
   * no `spokes` entry: that slot still gets its dial tick, because it WAS in
   * scope and happened to record nothing. `absent` says the position itself
   * was out of scope — the habit is not tracked on weekends, the day has not
   * reached that hour yet.
   */
  absent?: readonly number[];
  /**
   * 320 (a dashboard card) or 720 (a page panel). The ring is always square —
   * never stretched.
   *
   * Deliberately NOT offered at the 1180 reading measure the other primitives
   * gained: a dial is square, so a third size would be a 1180×1180 object, and
   * nothing in this app has a screen tall enough for one. A ring that needs
   * more presence gets it from where it sits on the page, not from its radius.
   */
  size?: 320 | 720;
}

/** How many positions the ring has. A day is 24 hours, a week 7 days, a year 12 months. */
export function slotCount(period: RadialPeriod): number {
  if (period.kind === "day") return 24;
  if (period.kind === "week") return 7;
  return 12;
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Slot 0 sits at twelve o'clock, running clockwise — the orientation a clock
 * face or a compass already trained every reader to expect. That is the whole
 * reason for the `- π/2`: SVG's angle zero points RIGHT, so without it every
 * ring in the product would be rotated a quarter turn and „ponedeljak" would
 * be where three o'clock is.
 */
export function angleFor(at: number, n: number): number {
  return (at / n) * Math.PI * 2 - Math.PI / 2;
}

// Room outside the dial for a mark's dot and label, so neither is clipped
// against the frame edge.
const PAD = 30;

/**
 * The ring's centre and radius inside a square box.
 *
 * The radius is the half-box minus `PAD`, and `PAD` is not padding in the
 * layout sense — it is the room the marks live in. Marks are drawn at `r + 6`
 * (the dot) and `r + 14` (the label), so a radius taken as `size / 2` would
 * put every mark outside the `viewBox`.
 */
export function ringGeometry(size: number): { cx: number; cy: number; r: number } {
  return { cx: size / 2, cy: size / 2, r: size / 2 - PAD };
}

/**
 * Which end of a mark's label is anchored, from the cosine of its angle.
 *
 * A label at three o'clock must run outward to the right, one at nine o'clock
 * outward to the left, and one at the top or bottom is centred. Anchoring them
 * all the same way is how the left half of a ring ends up written over the
 * ring itself. The 0.2 dead band is what keeps the two labels nearest the
 * vertical from flipping side on a one-slot difference.
 */
export function markAnchor(cos: number): "start" | "middle" | "end" {
  return cos > 0.2 ? "start" : cos < -0.2 ? "end" : "middle";
}

/**
 * The slots that get a dial tick: every position in the period except the ones
 * the caller says were never asked of the user.
 *
 * Different from a slot that simply has no `spokes` entry — that slot still
 * gets its tick, because it WAS in scope and happened to record nothing.
 */
export function dialSlotsFor(period: RadialPeriod, absent: readonly number[]): number[] {
  const absentSet = new Set(absent);
  return Array.from({ length: slotCount(period) }, (_, i) => i).filter((i) => !absentSet.has(i));
}

export function RadialCycle({
  title,
  description,
  caption,
  empty,
  period,
  spokes = [],
  marks = [],
  hand = null,
  absent = [],
  size = 320,
}: RadialCycleProps) {
  const n = slotCount(period);
  const { cx, cy, r } = ringGeometry(size);
  const absentSet = new Set(absent);

  const dialSlots = dialSlotsFor(period, absent);
  const visibleSpokes = spokes.filter((s) => !absentSet.has(s.at));
  const handTip =
    hand === null
      ? null
      : (() => {
          const a = angleFor(hand.at, n);
          return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
        })();

  return (
    <ChartFrame
      title={title}
      description={description}
      {...(caption === undefined ? {} : { caption })}
      empty={empty}
      viewBox={[size, size]}
      height={size}
    >
      {dialSlots.map((i) => {
        const a = angleFor(i, n);
        return (
          <line
            key={i}
            className="nx-radialcycle__dial-tick"
            x1={cx + Math.cos(a) * r * 0.92}
            y1={cy + Math.sin(a) * r * 0.92}
            x2={cx + Math.cos(a) * r}
            y2={cy + Math.sin(a) * r}
            aria-hidden="true"
          />
        );
      })}
      {visibleSpokes.map((s, i) => {
        const a = angleFor(s.at, n);
        const len = r * clamp01(s.value);
        return (
          <line
            key={i}
            className={`nx-radialcycle__spoke nx-tone--${s.tone}`}
            x1={cx}
            y1={cy}
            x2={cx + Math.cos(a) * len}
            y2={cy + Math.sin(a) * len}
            aria-hidden="true"
          />
        );
      })}
      {marks.map((m, i) => {
        const a = angleFor(m.at, n);
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const anchor = markAnchor(cos);
        return (
          <g key={i} className={`nx-tone--${m.tone}`} aria-hidden="true">
            <circle className="nx-radialcycle__mark-dot" cx={cx + cos * (r + 6)} cy={cy + sin * (r + 6)} r={2.5}>
              <title>{m.label}</title>
            </circle>
            <text
              className="nx-radialcycle__mark-label"
              x={cx + cos * (r + 14)}
              y={cy + sin * (r + 14)}
              textAnchor={anchor}
              dominantBaseline="middle"
            >
              {m.label}
            </text>
          </g>
        );
      })}
      {handTip !== null && (
        <g aria-hidden="true">
          <line className="nx-radialcycle__hand" x1={cx} y1={cy} x2={handTip.x} y2={handTip.y} />
          <circle className="nx-radialcycle__hand-tip" cx={handTip.x} cy={handTip.y} r={2.5} />
        </g>
      )}
    </ChartFrame>
  );
}
