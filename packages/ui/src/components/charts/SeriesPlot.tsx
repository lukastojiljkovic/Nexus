import type { ChartTone } from "./CellMatrix.js";
import { ChartFrame } from "./ChartFrame.js";
import { areaPath, extent, linePath, niceTicks, scaleLinear, type Point } from "@nexus/core";

/**
 * A CONTINUOUS domain — x is a real position (a timestamp, a weight), not a
 * slot key. This is what makes `null` mean something different here than it
 * does in `ColumnPlot`: there, `null` is a missing band; here, it is a break
 * in the path. Merging the two components was tried in the design and
 * rejected on purpose — a banded domain says absence is a missing slot, a
 * continuous one says absence is a gap, and collapsing that distinction is
 * exactly how gappy daily data ends up feeding a line that interpolates a
 * measurement which never happened.
 */
export interface SeriesPlotSeries {
  key: string;
  tone: ChartTone;
  shape: "line" | "step" | "area";
  /**
   * One entry per sample. `null` is a GAP — a day nobody logged — and breaks
   * the path there rather than being interpolated across.
   */
  points: readonly (Point | null)[];
  /** Draw a dot at every real point. Stops past 60 points — only the line remains. */
  dots?: boolean;
}

export interface SeriesPlotProps {
  title: string;
  description: string;
  caption?: string;
  empty: { reason: string } | null;
  series: readonly SeriesPlotSeries[];
  x: { domain: [number, number] };
  y?: { domain?: [number, number]; ticks?: number; format?: (n: number) => string };
  /** The one allowed reference line — a goal, a cap, a threshold. */
  rule?: { value: number; label: string; tone: ChartTone };
  /**
   * A series with exactly two real points is a claim about a RATE, and two
   * readings cannot support one. Off by default: two points draw as two
   * isolated marks, connected by nothing. Set this only when the x axis is
   * genuinely calendar-continuous — there really was an unbroken interval
   * between the two readings, not just two dots that happen to share an axis.
   */
  connectPairs?: boolean;
  /** Sparkline mode: no axis, no ticks, the full width goes to the drawing. */
  compact?: boolean;
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

const PAD_Y = 6;
const DOT_R = 3;
const MAX_DOTS = 60;

/**
 * The gutter the y-axis tick labels are written in, and why it is DERIVED
 * rather than the fixed 30 it used to be.
 *
 * A tick is right-anchored at `leftMargin - TICK_GAP`, so a label wider than
 * the gutter runs off the left edge of the `<svg>` — where the root element's
 * own `overflow: hidden` cuts it in half. That is not hypothetical: FIN draws
 * money, „120.000" at caption size is about forty pixels wide, and the sweep
 * measured it escaping the plot by 10.4px on four surfaces.
 *
 * There is no way to measure text without a DOM, and this component is drawn
 * from data alone. What CAN be measured is the string: the tick face is
 * `font-variant-numeric: tabular-nums` at caption size, so every digit is the
 * same width and the estimate below is exact for digits and generous for the
 * separators and the minus sign that are the only other characters a formatter
 * emits. The cap keeps a pathological formatter from eating the plot it is
 * supposed to label.
 */
const TICK_CHAR_W = 7.2;
const TICK_GAP = 6;
const TICK_MARGIN_MIN = 30;
const TICK_MARGIN_MAX = 96;

/**
 * Half a tick label's line box, in user units.
 *
 * The labels are `dominantBaseline="middle"`, so the topmost and bottommost
 * ticks — which sit at `PAD_Y` and `height - PAD_Y` — each hang half a line
 * outside the box at a `PAD_Y` of 6. The bottom one landed on top of
 * `.nx-chart__caption`, which is how the sweep found it. Clamping the LABEL
 * rather than growing `PAD_Y` keeps the plot's own geometry exactly where it
 * was: the tick moves by three pixels and the data does not move at all.
 */
const TICK_HALF_LINE = 9;

function isPoint(p: Point | null): p is Point {
  return p !== null;
}

/** Splits a points array on its `null`s into the contiguous runs a path may connect. */
function splitRuns(points: readonly (Point | null)[]): Point[][] {
  const runs: Point[][] = [];
  let current: Point[] = [];
  for (const p of points) {
    if (p === null) {
      if (current.length > 0) runs.push(current);
      current = [];
    } else {
      current.push(p);
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/** Step-after expansion: hold the previous y until the new x, then rise — the staircase a `linePath` alone cannot draw. */
function stepExpand(points: readonly Point[]): Point[] {
  if (points.length < 2) return points.slice();
  const head = points[0];
  if (head === undefined) return [];
  const out: Point[] = [head];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    if (prev === undefined || cur === undefined) continue;
    out.push({ x: cur.x, y: prev.y });
    out.push(cur);
  }
  return out;
}

export function SeriesPlot({
  title,
  description,
  caption,
  empty,
  series,
  x,
  y,
  rule,
  connectPairs = false,
  compact = false,
  width = 320,
  height = 160,
}: SeriesPlotProps) {
  const allY = series.flatMap((s) => s.points.filter(isPoint).map((p) => p.y));
  if (rule !== undefined) allY.push(rule.value);
  const dataExtent = extent(allY) ?? [0, 1];
  const yDomain = y?.domain ?? dataExtent;
  const yTicks = compact ? [] : niceTicks(yDomain[0], yDomain[1], Math.min(5, y?.ticks ?? 5));
  const format = y?.format ?? ((n: number) => String(n));

  // The gutter is sized to the labels that will actually be written in it —
  // see `TICK_CHAR_W`. Computed before the scales, because the plot begins
  // where the gutter ends.
  const widestTick = yTicks.reduce((widest, tick) => Math.max(widest, format(tick).length), 0);
  const leftMargin = compact
    ? 0
    : Math.min(TICK_MARGIN_MAX, Math.max(TICK_MARGIN_MIN, widestTick * TICK_CHAR_W + TICK_GAP * 2));

  const xScale = scaleLinear(x.domain, [leftMargin, width]);
  const yScale = scaleLinear(yDomain, [height - PAD_Y, PAD_Y]);
  const baselineY = height - PAD_Y;

  return (
    <ChartFrame
      title={title}
      description={description}
      {...(caption === undefined ? {} : { caption })}
      empty={empty}
      viewBox={[width, height]}
      height={height}
    >
      {!compact &&
        yTicks.map((t) => (
          <text
            key={t}
            className="nx-seriesplot__tick"
            x={leftMargin - TICK_GAP}
            // Clamped inside the box — see `TICK_HALF_LINE`. The extreme ticks
            // are the only two this can move, and it moves them by three
            // pixels rather than letting them hang out of the drawing.
            y={Math.min(height - TICK_HALF_LINE, Math.max(TICK_HALF_LINE, yScale(t)))}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {format(t)}
          </text>
        ))}
      {series.map((s) => {
        const real = s.points.filter(isPoint);
        const total = real.length;
        if (total === 0) return null;

        // n = 1: one mark, no line — a single reading cannot be a trend.
        if (total === 1) {
          const p = real[0];
          if (p === undefined) return null;
          return (
            <circle
              key={s.key}
              className={`nx-seriesplot__dot nx-tone--${s.tone}`}
              cx={xScale(p.x)}
              cy={yScale(p.y)}
              r={DOT_R}
              aria-hidden="true"
            />
          );
        }

        // n = 2: two marks; a line between them only when the caller has
        // said the axis is calendar-continuous. Two readings cannot support
        // a rate, so the connection is opt-in, not inferred from the data.
        if (total === 2) {
          const [a, b] = real;
          if (a === undefined || b === undefined) return null;
          const pa = { x: xScale(a.x), y: yScale(a.y) };
          const pb = { x: xScale(b.x), y: yScale(b.y) };
          return (
            <g key={s.key}>
              {connectPairs && (
                <path
                  className={`nx-seriesplot__line nx-tone--${s.tone}`}
                  d={linePath([pa, pb])}
                  aria-hidden="true"
                />
              )}
              <circle className={`nx-seriesplot__dot nx-tone--${s.tone}`} cx={pa.x} cy={pa.y} r={DOT_R} aria-hidden="true" />
              <circle className={`nx-seriesplot__dot nx-tone--${s.tone}`} cx={pb.x} cy={pb.y} r={DOT_R} aria-hidden="true" />
            </g>
          );
        }

        const runs = splitRuns(s.points);
        const showDots = s.dots === true && total <= MAX_DOTS;
        return (
          <g key={s.key}>
            {runs.map((run, ri) => {
              const scaled = run.map((p) => ({ x: xScale(p.x), y: yScale(p.y) }));
              const drawn = s.shape === "step" ? stepExpand(scaled) : scaled;
              return (
                <g key={ri}>
                  {s.shape === "area" && (
                    <path
                      className={`nx-seriesplot__area nx-tone--${s.tone}`}
                      d={areaPath(drawn, baselineY)}
                      aria-hidden="true"
                    />
                  )}
                  <path className={`nx-seriesplot__line nx-tone--${s.tone}`} d={linePath(drawn)} aria-hidden="true" />
                  {showDots &&
                    scaled.map((p, pi) => (
                      <circle
                        key={pi}
                        className={`nx-seriesplot__dot nx-tone--${s.tone}`}
                        cx={p.x}
                        cy={p.y}
                        r={DOT_R}
                        aria-hidden="true"
                      />
                    ))}
                </g>
              );
            })}
          </g>
        );
      })}
      {rule !== undefined && (
        <g aria-hidden="true">
          <line
            className="nx-chart-rule"
            x1={leftMargin}
            x2={width}
            y1={yScale(rule.value)}
            y2={yScale(rule.value)}
          />
          <text
            className={`nx-chart-rule__label nx-chart-rule__label--${rule.tone}`}
            x={width}
            // Above the rule normally, below it when the rule is high enough
            // that „above" would be outside the drawing. A reference label
            // clipped by the top edge names nothing.
            y={
              yScale(rule.value) - 3 < TICK_HALF_LINE
                ? yScale(rule.value) + TICK_HALF_LINE + 3
                : yScale(rule.value) - 3
            }
            textAnchor="end"
          >
            {rule.label}
          </text>
        </g>
      )}
    </ChartFrame>
  );
}
