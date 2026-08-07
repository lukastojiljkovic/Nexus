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
  /** 320 (card) or 720 (panel). */
  width?: 320 | 720;
  height?: number;
}

const PAD_Y = 6;
const TICK_MARGIN = 30;
const DOT_R = 3;
const MAX_DOTS = 60;

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
  const leftMargin = compact ? 0 : TICK_MARGIN;

  const allY = series.flatMap((s) => s.points.filter(isPoint).map((p) => p.y));
  if (rule !== undefined) allY.push(rule.value);
  const dataExtent = extent(allY) ?? [0, 1];
  const yDomain = y?.domain ?? dataExtent;
  const yTicks = compact ? [] : niceTicks(yDomain[0], yDomain[1], Math.min(5, y?.ticks ?? 5));
  const format = y?.format ?? ((n: number) => String(n));

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
            x={leftMargin - 6}
            y={yScale(t)}
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
