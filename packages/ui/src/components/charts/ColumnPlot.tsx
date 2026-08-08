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
  /**
   * How two or more series share a slot.
   *
   * "stacked" (the default) puts them end to end, which STATES THAT THEY ADD
   * UP — the bar's full height is a real total. "grouped" stands them side by
   * side inside the band, for series that are two measurements of the same
   * thing rather than two parts of it.
   *
   * This is not a styling preference. Stacking „nastalo" on „zatvoreno", or
   * „planirano" on „izmereno", draws a column whose height is a number that
   * does not exist — twenty tasks created and twenty closed would tower over a
   * week where nothing happened at all, and a reader would have no way to know
   * the total was meaningless. One series behaves identically either way.
   */
  layout?: "stacked" | "grouped";
  /** The one allowed reference line — a goal, a cap, a threshold. */
  rule?: { value: number; label: string; tone: ChartTone };
  /** Caller-supplied ceiling for the value axis. Computed from the data when omitted. */
  max?: number;
  /**
   * 320 (a dashboard card), 720 (a page panel), or 1180 (the full reading
   * measure, `--nx-layout-measure`).
   *
   * A closed set rather than a number, and it stays closed: three widths mean
   * the whole product's figures line up with each other and with the text
   * beside them, while an open number means every surface picks its own and
   * nothing ever agrees. 1180 was added when „Trake pažnje" and „Rokovi" ended
   * up drawn at 720 inside a 1180 pane — a figure floating in the middle of the
   * column it belongs to, which is the maroon-in-whitespace failure at the
   * scale of one chart.
   */
  width?: 320 | 720 | 1180;
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
  layout = "stacked",
  rule,
  max,
  width = 320,
  height = 160,
}: ColumnPlotProps) {
  const plotHeight = Math.max(1, height - LABEL_ROW);
  const bandStep = slots.length > 0 ? width / slots.length : width;
  const bandWidth = Math.max(1, bandStep - GAP);
  const grouped = layout === "grouped" && series.length > 1;
  // A grouped band is split between the series, with a hairline between them
  // so two adjacent bars of the same height never read as one wide bar.
  const barWidth = grouped ? Math.max(1, (bandWidth - (series.length - 1)) / series.length) : bandWidth;

  // The value domain. Each slot's positive and negative stacks are summed
  // independently so "signed" data — gains one day, losses the next — never
  // lets one direction dwarf the other's scale on the same chart. Grouped
  // series do NOT sum: they stand side by side, so the tallest single bar sets
  // the ceiling and summing them would leave the axis with headroom nothing
  // ever reaches.
  let computedMax = 0;
  for (let i = 0; i < slots.length; i += 1) {
    let pos = 0;
    let neg = 0;
    for (const s of series) {
      const v = s.values[i];
      if (v == null) continue;
      if (grouped) {
        pos = Math.max(pos, v);
        neg = Math.min(neg, v);
      } else if (v >= 0) {
        pos += v;
      } else {
        neg += v;
      }
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
        const bandX = i * bandStep + (bandStep - bandWidth) / 2;
        return (
          <g key={slot.key}>
            {series.map((s, seriesIndex) => {
              const v = s.values[i];
              if (v == null) return null;
              // Grouped bars each start from the baseline; stacked ones start
              // where the previous series left off.
              const from = grouped ? 0 : v >= 0 ? posCum : negCum;
              const to = from + v;
              if (!grouped) {
                if (v >= 0) posCum = to;
                else negCum = to;
              }
              const yFrom = yScale(from);
              const yTo = yScale(to);
              return (
                <rect
                  key={s.key}
                  className={`nx-columnplot__bar nx-tone--${s.tone}`}
                  x={grouped ? bandX + seriesIndex * (barWidth + 1) : bandX}
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
