import type { ChartTone } from "./CellMatrix.js";
import { ChartFrame } from "./ChartFrame.js";
import { scaleLinear } from "@nexus/core";

/**
 * One discrete slot in a BANDED domain — a day, a week, a category. Compare
 * `SeriesPlot`'s continuous `x`: there, absence is a gap in a path; here,
 * absence is a missing band. The two are separate components rather than one
 * configurable chart, because merging them is exactly how someone eventually
 * feeds gappy daily numbers to a line and gets an interpolation claiming a
 * measurement that never happened. A banded domain cannot make that mistake:
 * a slot with no value simply has no bar.
 */
export interface ColumnPlotSlot {
  key: string;
  label: string;
}

export interface ColumnPlotSeries {
  key: string;
  tone: ChartTone;
  /**
   * One entry per slot, same length and order as `slots`. `null` draws NO
   * column for that slot — not a zero-height one. A day with nothing logged
   * is not a 0 day.
   */
  values: readonly (number | null)[];
}

export interface ColumnPlotProps {
  title: string;
  description: string;
  caption?: string;
  empty: { reason: string } | null;
  slots: readonly ColumnPlotSlot[];
  series: readonly ColumnPlotSeries[];
  /**
   * "zero" stacks every series upward from 0 — ordinary counts. "signed"
   * hinges each slot's stack at 0, positive segments rising and negative
   * segments falling from the same shared baseline — diverging data (net
   * calories, mood delta). There is no drawn zero-axis beyond this: the
   * shared start point every bar stacks from already reads as the baseline,
   * and a labelled one is available via `rule` when the chart needs it named.
   */
  baseline?: "zero" | "signed";
  /** The one allowed reference line — a goal, a cap, a threshold. */
  rule?: { value: number; label: string; tone: ChartTone };
  /** Caller-supplied ceiling for the value axis. Computed from the data when omitted. */
  max?: number;
  /** 320 (card) or 720 (panel). */
  width?: 320 | 720;
  height?: number;
}

const GAP = 8;
const BAR_RADIUS = 2;
const LABEL_ROW = 16;

export function ColumnPlot({
  title,
  description,
  caption,
  empty,
  slots,
  series,
  baseline = "zero",
  rule,
  max,
  width = 320,
  height = 160,
}: ColumnPlotProps) {
  const plotHeight = Math.max(1, height - LABEL_ROW);
  const bandStep = slots.length > 0 ? width / slots.length : width;
  const barWidth = Math.max(1, bandStep - GAP);

  // The value domain. Each slot's positive and negative stacks are summed
  // independently so "signed" data — gains one day, losses the next — never
  // lets one direction dwarf the other's scale on the same chart.
  let computedMax = 0;
  for (let i = 0; i < slots.length; i += 1) {
    let pos = 0;
    let neg = 0;
    for (const s of series) {
      const v = s.values[i];
      if (v == null) continue;
      if (v >= 0) pos += v;
      else neg += v;
    }
    computedMax = Math.max(computedMax, pos, baseline === "signed" ? -neg : 0);
  }
  const domainMax = max ?? (computedMax > 0 ? computedMax : 1);
  const domain: [number, number] = baseline === "signed" ? [-domainMax, domainMax] : [0, domainMax];
  const yScale = scaleLinear(domain, [plotHeight, 0]);

  return (
    <ChartFrame
      title={title}
      description={description}
      {...(caption === undefined ? {} : { caption })}
      empty={empty}
      viewBox={[width, height]}
      height={height}
    >
      {/* A signed chart draws its zero, and this is NOT the one allowed
          reference rule — it is the AXIS. The distinction matters: a reference
          rule is a claim laid over the data (a goal, a cap), while zero is
          where a diverging chart's data is measured FROM. Without it a reader
          can only infer the hinge from slots that happen to carry both
          directions, and a run of all-positive columns reads as an ordinary
          bar chart with a strange top. `rule` remains available and remains
          singular. */}
      {baseline === "signed" && (
        <line
          className="nx-columnplot__zero"
          x1={0}
          x2={width}
          y1={yScale(0)}
          y2={yScale(0)}
          aria-hidden="true"
        />
      )}
      {slots.map((slot, i) => {
        let posCum = 0;
        let negCum = 0;
        const x = i * bandStep + (bandStep - barWidth) / 2;
        return (
          <g key={slot.key}>
            {series.map((s) => {
              const v = s.values[i];
              if (v == null) return null;
              const from = v >= 0 ? posCum : negCum;
              const to = from + v;
              if (v >= 0) posCum = to;
              else negCum = to;
              const yFrom = yScale(from);
              const yTo = yScale(to);
              return (
                <rect
                  key={s.key}
                  className={`nx-columnplot__bar nx-tone--${s.tone}`}
                  x={x}
                  y={Math.min(yFrom, yTo)}
                  width={barWidth}
                  height={Math.max(0, Math.abs(yFrom - yTo))}
                  rx={BAR_RADIUS}
                  aria-hidden="true"
                />
              );
            })}
            <text
              className="nx-columnplot__label"
              x={i * bandStep + bandStep / 2}
              y={height - 4}
              textAnchor="middle"
            >
              {slot.label}
            </text>
          </g>
        );
      })}
      {rule !== undefined && (
        <g aria-hidden="true">
          <line className="nx-chart-rule" x1={0} x2={width} y1={yScale(rule.value)} y2={yScale(rule.value)} />
          <text
            className={`nx-chart-rule__label nx-chart-rule__label--${rule.tone}`}
            x={width}
            y={yScale(rule.value) - 3}
            textAnchor="end"
          >
            {rule.label}
          </text>
        </g>
      )}
    </ChartFrame>
  );
}
