import type { ChartTone } from "./CellMatrix.js";
import { ChartFrame } from "./ChartFrame.js";
import { scaleLinear } from "@nexus/core";

export interface SpanLanesSpan {
  from: number;
  /**
   * `"open"` runs off the frame and draws NO terminus — an interval that has
   * not ended yet must not be given a false edge just because the chart's
   * canvas has one.
   */
  to: number | "open";
  tone?: ChartTone;
  label: string;
}

export interface SpanLanesMark {
  at: number;
  kind: "tick" | "terminus";
  label: string;
}

export interface SpanLanesLane {
  key: string;
  label: string;
  tone: ChartTone;
  spans: readonly SpanLanesSpan[];
  marks: readonly SpanLanesMark[];
}

export interface SpanLanesProps {
  title: string;
  description: string;
  caption?: string;
  empty: { reason: string } | null;
  domain: [number, number];
  lanes: readonly SpanLanesLane[];
  /** The one allowed reference line — "now", a deadline, a cutover. */
  rule?: { at: number; label: string; tone: ChartTone };
  /** 320 (card) or 720 (panel). */
  width?: 320 | 720;
  /** Row height per lane, px. The house size is 26. */
  laneHeight?: number;
}

const LEFT_MARGIN = 84;
const TRACK_H = 10;
// Lane rows are never shrunk to fit — past this many, the frame scrolls
// instead. A row squeezed below its readable height is worse than a
// scrollbar; twelve is the most that fits a card without either.
const VISIBLE_CAP = 12;
// Rough allowance for the title + caption rows ChartFrame draws around the
// svg, so the scroll cap lines up with "twelve lane rows are visible", not
// "twelve lane rows plus whatever chrome happens to be attached".
const SCROLL_CHROME = 44;

export function SpanLanes({
  title,
  description,
  caption,
  empty,
  domain,
  lanes,
  rule,
  width = 320,
  laneHeight = 26,
}: SpanLanesProps) {
  const height = Math.max(1, lanes.length * laneHeight);
  const xScale = scaleLinear(domain, [LEFT_MARGIN, width]);

  const chart = (
    <ChartFrame
      title={title}
      description={description}
      {...(caption === undefined ? {} : { caption })}
      empty={empty}
      viewBox={[width, height]}
      height={height}
    >
      {lanes.map((lane, li) => {
        const rowY = li * laneHeight;
        const trackY = rowY + (laneHeight - TRACK_H) / 2;
        const trackMid = trackY + TRACK_H / 2;
        return (
          <g key={lane.key}>
            <text className="nx-spanlanes__label" x={4} y={rowY + laneHeight / 2} dominantBaseline="middle">
              {lane.label}
            </text>
            {lane.spans.map((span, si) => {
              const x1 = xScale(span.from);
              const x2 = span.to === "open" ? width : xScale(span.to);
              const open = span.to === "open";
              return (
                <rect
                  key={si}
                  className={`nx-spanlanes__span nx-tone--${span.tone ?? lane.tone}`}
                  x={x1}
                  y={trackY}
                  width={Math.max(1, x2 - x1)}
                  height={TRACK_H}
                  rx={open ? 0 : TRACK_H / 2}
                  aria-hidden="true"
                >
                  <title>{span.label}</title>
                </rect>
              );
            })}
            {lane.marks.map((mark, mi) => {
              const mx = xScale(mark.at);
              if (mark.kind === "terminus") {
                return (
                  <circle
                    key={mi}
                    className={`nx-spanlanes__mark-terminus nx-tone--${lane.tone}`}
                    cx={mx}
                    cy={trackMid}
                    r={4}
                    aria-hidden="true"
                  >
                    <title>{mark.label}</title>
                  </circle>
                );
              }
              return (
                <line
                  key={mi}
                  className={`nx-spanlanes__mark-tick nx-tone--${lane.tone}`}
                  x1={mx}
                  x2={mx}
                  y1={trackY - 3}
                  y2={trackY + TRACK_H + 3}
                  aria-hidden="true"
                >
                  <title>{mark.label}</title>
                </line>
              );
            })}
          </g>
        );
      })}
      {rule !== undefined && (
        <g aria-hidden="true">
          <line className="nx-chart-rule" x1={xScale(rule.at)} x2={xScale(rule.at)} y1={0} y2={height} />
          <text
            className={`nx-chart-rule__label nx-chart-rule__label--${rule.tone}`}
            x={xScale(rule.at) + 3}
            y={10}
          >
            {rule.label}
          </text>
        </g>
      )}
    </ChartFrame>
  );

  if (lanes.length <= VISIBLE_CAP) return chart;

  return (
    <div className="nx-spanlanes__scroll" style={{ maxHeight: VISIBLE_CAP * laneHeight + SCROLL_CHROME }}>
      {chart}
    </div>
  );
}
