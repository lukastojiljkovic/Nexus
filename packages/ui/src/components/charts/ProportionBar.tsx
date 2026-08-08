import type { ReactNode } from "react";
import type { ChartTone } from "./CellMatrix.js";

/**
 * One part-of-whole strip: a label, a track, and the figure.
 *
 * THIS IS A DEFECT FIX BEFORE IT IS A COMPONENT. `.fin__bar-track` and
 * `.fit__bar-track` were byte-identical; so were `-fill`, `-label` and
 * `-value`, and `.fin__bar-limit` / `.fit__bar-goal` differed only in name.
 * Five pairs of hand-copied rules across two modules, with the dashboard
 * borrowing a third module's classes on top. One helper and three adoptions,
 * not five patches.
 *
 * It is also the house's ONLY part-of-whole form. Pie and donut charts are
 * banned at any slice count: angle is the worst comparison channel there is,
 * and the module with the most part-of-whole data in the product already reads
 * better as a strip than it ever did as a wheel.
 *
 * Deliberately DOM and not SVG. A strip is a box with a box in it; drawing it
 * in SVG would cost a viewBox, a scale and a text-measurement problem, and
 * would buy nothing.
 */
export interface ProportionSegment {
  key: string;
  /** 0…1 of the track. Values beyond 1 are clamped for DRAWING but not for state. */
  fraction: number;
  tone: ChartTone;
  /** Read aloud for this segment. */
  label: string;
}

export interface ProportionBarProps {
  /** The row's name. Truncates with an ellipsis at the grid's first column. */
  label: ReactNode;
  /**
   * The figure at the end of the row, ALREADY FORMATTED by the module that owns
   * the unit — money by `money.ts`, energy by the fitness formatter. A chart
   * never formats a number itself: the thousands separator, the currency and
   * the rounding are facts about the domain, not about the drawing.
   */
  value?: ReactNode;
  segments: readonly ProportionSegment[];
  /**
   * A single reference mark on the track — the budget, the goal, the limit.
   * There is at most one: a track with a ladder of thresholds is a chart doing
   * two jobs.
   */
  target?: { fraction: number; label: string };
  /**
   * No measurement behind this row, as distinct from a measured zero. A macro
   * with no goal set is not a goal of zero, and it must not draw as a full-width
   * empty track pretending to be one.
   */
  unmeasured?: boolean;
  /**
   * One sentence naming the row and its finding — „Hrana: 12 400 od 15 000 RSD,
   * prekoračeno".
   *
   * When present the whole row becomes a single `role="img"` and its inner text
   * turns presentational. That is deliberate: the row's STATE — over budget,
   * goal reached — is carried by colour and by a font weight, and neither
   * reaches a screen reader. Without this the row reads out its numbers and
   * silently omits the one thing it was drawn to say.
   *
   * It is a prop rather than something each page wraps for itself, because
   * every call site wrapping the component in its own `role="img"` div is the
   * same rule applied in two places instead of held in one — and the third
   * adoption is the one that forgets.
   */
  describedAs?: string;
}

/**
 * A fraction of the track, with the two ways a caller can hand over nonsense
 * closed off. Non-finite is 0 rather than propagated: a `0 / 0` from an empty
 * denominator would otherwise reach the style attribute as `NaN%`, which CSS
 * discards silently — the fill simply never appears and nothing says why.
 */
export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** A segment with its place on the track worked out. */
export type LaidSegment = ProportionSegment & { start: number; width: number };

/**
 * Segments lay end to end; each one's offset is the sum of those before it.
 *
 * THE CLAMP IS CUMULATIVE, and that is the correctness question here. Clamping
 * each segment on its own — which is what this did — bounds every individual
 * fill to the track's width but not the RUNNING TOTAL, so two segments of 0.7
 * produced `left: 70%; width: 70%` and the second fill painted 40% of a track's
 * width past the end of its track. `.nx-proportion__track` has no `overflow:
 * hidden` (it must not: the target mark and the rounded ends depend on that),
 * so nothing downstream catches it — the strip simply runs into whatever sits
 * beside it, which on a macro row is the figure.
 *
 * Giving each segment only the room that is actually left makes the class
 * unrepresentable rather than merely unlikely: a laid-out strip is bounded by
 * construction, whatever fractions arrive. A segment that starts past the end
 * gets width 0 and draws nothing, which is the honest picture of "there is no
 * room left for this".
 *
 * Over-budget data is NOT what this protects against — that case is expressed
 * by the caller normalising against the larger total (180/210 + 30/210), which
 * is how the drawing manages to show both the goal and the overshoot. This is
 * for the caller who has not.
 */
export function layOutSegments(segments: readonly ProportionSegment[]): LaidSegment[] {
  let offset = 0;
  return segments.map((segment) => {
    const start = offset;
    // The `max(0, …)` is not defensive noise: `start + (1 - start)` is not
    // guaranteed to land exactly on 1 in binary floating point, so a full
    // track can leave a remainder of about -1e-17 — and a negative `width:`
    // percentage is a value CSS drops silently, which is the disappearance
    // failure this file already documents once.
    const width = Math.min(clamp01(segment.fraction), Math.max(0, 1 - start));
    offset += width;
    return { ...segment, start, width };
  });
}

export function ProportionBar({
  label,
  value,
  segments,
  target,
  unmeasured = false,
  describedAs,
}: ProportionBarProps) {
  const laid = layOutSegments(segments);

  return (
    <div
      className="nx-proportion"
      {...(describedAs === undefined ? {} : { role: "img", "aria-label": describedAs })}
    >
      <span className="nx-proportion__label">{label}</span>
      <span
        className={`nx-proportion__track${unmeasured ? " nx-proportion__track--unmeasured" : ""}`}
      >
        {laid.map((segment) => (
          <span
            key={segment.key}
            className={`nx-proportion__fill nx-proportion__fill--${segment.tone}`}
            style={{ left: `${String(segment.start * 100)}%`, width: `${String(segment.width * 100)}%` }}
            aria-hidden="true"
          />
        ))}
        {target !== undefined && (
          <span
            className="nx-proportion__target"
            style={{ left: `${String(clamp01(target.fraction) * 100)}%` }}
            aria-hidden="true"
          />
        )}
      </span>
      {value !== undefined && <span className="nx-proportion__value">{value}</span>}
    </div>
  );
}
