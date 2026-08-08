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
  /** Row height per lane, px. The house size is 26. */
  laneHeight?: number;
}

const LEFT_MARGIN = 84;

/**
 * How many glyphs fit in `LEFT_MARGIN` at the caption size, and the component's
 * own answer to what happens past it.
 *
 * SVG `<text>` does not wrap, does not ellipsise, and — because `.nx-chart__svg`
 * is `overflow: visible` so marks may sit outside the plot — does not even clip.
 * A lane called „Zdravstvena knjižica" therefore painted straight across the
 * bars and off the right edge of the figure, which is what the sweep found on
 * the documents deadline chart.
 *
 * The truncation lives HERE rather than at the call site because every caller
 * would otherwise reinvent it, and the first one already had: `DocDeadlines`
 * had grown a private `fitLaneLabel` before this existed. The component owns
 * `LEFT_MARGIN`, so the component owns what fits in it.
 *
 * `Array.from` rather than `slice`, so a label is never cut through the middle
 * of a surrogate pair; and the untruncated string stays reachable as a `<title>`
 * on the same element, which is the only honest way to shorten text — the
 * reader is told there is more, and can get it.
 */
const LABEL_GLYPHS = 14;

export function fitLabel(label: string): string {
  const glyphs = Array.from(label);
  return glyphs.length <= LABEL_GLYPHS ? label : `${glyphs.slice(0, LABEL_GLYPHS - 1).join("")}…`;
}
const TRACK_H = 10;
// Lane rows are never shrunk to fit — past this many, the frame scrolls
// instead. A row squeezed below its readable height is worse than a
// scrollbar; twelve is the most that fits a card without either.
const VISIBLE_CAP = 12;
// Rough allowance for the title + caption rows ChartFrame draws around the
// svg, so the scroll cap lines up with "twelve lane rows are visible", not
// "twelve lane rows plus whatever chrome happens to be attached".
const SCROLL_CHROME = 44;

/** Where one lane's row sits, and where its track sits inside that row. */
export interface LaneRow {
  /** Top of the whole row. */
  rowY: number;
  /** Top of the drawn track — the row's remaining height split evenly above and below. */
  trackY: number;
  /** The track's centre line: where a terminus dot's `cy` goes. */
  trackMid: number;
}

/**
 * A lane's vertical geometry.
 *
 * The track is CENTRED in its row rather than sitting at its top, which is
 * what lets `laneHeight` be raised for a roomier chart without the marks
 * drifting away from the bars they annotate — every one of them is derived
 * from `trackY`, so they move together or not at all.
 */
export function laneRow(index: number, laneHeight: number): LaneRow {
  const rowY = index * laneHeight;
  const trackY = rowY + (laneHeight - TRACK_H) / 2;
  return { rowY, trackY, trackMid: trackY + TRACK_H / 2 };
}

/**
 * A span's horizontal extent, and the one case that is not arithmetic.
 *
 * `"open"` runs to the right edge and is NOT scaled: an interval that has not
 * ended has no end to map, and putting `xScale(domain[1])` there would be the
 * same pixel with a false claim behind it. The caller reads `open` back to
 * decide the terminus, so „ends at the frame" and „ends at the domain's last
 * day" stay distinguishable.
 *
 * The width floor of 1 is what makes a same-day span visible at all: a
 * zero-width `<rect>` draws nothing, so a one-day holiday would silently
 * vanish from the chart that exists to show it.
 */
export function spanExtent(
  from: number,
  to: number | "open",
  xScale: (value: number) => number,
  right: number,
): { x: number; width: number; open: boolean } {
  const x = xScale(from);
  const x2 = to === "open" ? right : xScale(to);
  return { x, width: Math.max(1, x2 - x), open: to === "open" };
}

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
        const { rowY, trackY, trackMid } = laneRow(li, laneHeight);
        return (
          <g key={lane.key}>
            <text className="nx-spanlanes__label" x={4} y={rowY + laneHeight / 2} dominantBaseline="middle">
              {/* The full name, for anything that hovers or reads the figure —
                  a shortened label with no way back to the whole one is the
                  clipped-text defect wearing an ellipsis. */}
              <title>{lane.label}</title>
              {fitLabel(lane.label)}
            </text>
            {lane.spans.map((span, si) => {
              const extent = spanExtent(span.from, span.to, xScale, width);
              return (
                <rect
                  key={si}
                  className={`nx-spanlanes__span nx-tone--${span.tone ?? lane.tone}`}
                  x={extent.x}
                  y={trackY}
                  width={extent.width}
                  height={TRACK_H}
                  rx={extent.open ? 0 : TRACK_H / 2}
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
