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

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function ProportionBar({
  label,
  value,
  segments,
  target,
  unmeasured = false,
  describedAs,
}: ProportionBarProps) {
  // Segments lay end to end; each one's offset is the sum of those before it.
  let offset = 0;
  const laid = segments.map((segment) => {
    const start = offset;
    const width = clamp01(segment.fraction);
    offset += width;
    return { ...segment, start, width };
  });

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
