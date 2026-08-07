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
  /** 320 (card) or 720 (panel). The ring is always square — never stretched. */
  size?: 320 | 720;
}

function slotCount(period: RadialPeriod): number {
  if (period.kind === "day") return 24;
  if (period.kind === "week") return 7;
  return 12;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// Slot 0 sits at twelve o'clock, running clockwise — the orientation a clock
// face or a compass already trained every reader to expect.
function angleFor(at: number, n: number): number {
  return (at / n) * Math.PI * 2 - Math.PI / 2;
}

// Room outside the dial for a mark's dot and label, so neither is clipped
// against the frame edge.
const PAD = 30;

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
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - PAD;
  const absentSet = new Set(absent);

  const dialSlots = Array.from({ length: n }, (_, i) => i).filter((i) => !absentSet.has(i));
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
        const anchor = cos > 0.2 ? "start" : cos < -0.2 ? "end" : "middle";
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
