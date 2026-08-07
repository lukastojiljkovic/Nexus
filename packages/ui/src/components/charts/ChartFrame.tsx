import type { ReactNode } from "react";

/**
 * The wrapper every drawn graphic in the product sits inside.
 *
 * It exists to make three house rules impossible to break rather than merely
 * written down somewhere:
 *
 * 1. A CHART WITH NOTHING TO SAY IS ABSENT, NOT EMPTY. `empty` is not a
 *    boolean — it carries the SENTENCE explaining why there is nothing. So a
 *    call site cannot render an axis with no data on it, a row of zero-height
 *    bars, or a grey silhouette waiting to be filled: when `empty` is set no
 *    `<svg>` is emitted at all, only the reason.
 *
 * 2. EVERY CHART CAN BE READ ALOUD. `description` has no default and is not
 *    optional, so a chart nobody can describe does not compile. It must be a
 *    SENTENCE STATING THE FINDING — „51 zadatak na vreme, 33 sa zakašnjenjem,
 *    najduže 19 dana" — never a data dump; a label that reads out every value
 *    is a table read badly, and the table is already on the page.
 *
 * 3. THE PICTURE IS THE SHORTCUT, THE ROWS ARE THE TRUTH. Nothing may exist
 *    only inside a chart. Every page that draws one already lists the records
 *    it draws from, reachable by the same keyboard route.
 *
 * The sentence must be produced by the same derivation that produces the
 * drawing. Hand-writing it per call site guarantees it drifts from the picture
 * — at which point it is a fabricated statistic wearing an accessibility badge.
 */
export interface ChartFrameProps {
  /** Shown above the graphic. Serbian, from `strings.ts`. */
  title: string;
  /**
   * One sentence stating what the graphic shows and what it found. Becomes the
   * `aria-label`, and is the only thing a screen reader gets.
   */
  description: string;
  /** The SVG user-space box. Width is 320 (card) or 720 (panel) — never a third. */
  viewBox: readonly [number, number];
  /** Rendered height in CSS px. Defaults to the viewBox height. */
  height?: number;
  /** Optional line under the graphic — the axis caveat, the window, the cap. */
  caption?: string;
  /**
   * Why there is nothing to draw, or null when there is. Set means NO `<svg>`
   * is produced.
   */
  empty: { reason: string } | null;
  children: ReactNode;
}

export function ChartFrame({
  title,
  description,
  viewBox,
  height,
  caption,
  empty,
  children,
}: ChartFrameProps) {
  const [width, boxHeight] = viewBox;
  return (
    <figure className="nx-chart">
      <figcaption className="nx-chart__title">{title}</figcaption>
      {empty === null ? (
        <svg
          className="nx-chart__svg"
          role="img"
          aria-label={description}
          viewBox={`0 0 ${String(width)} ${String(boxHeight)}`}
          width="100%"
          height={height ?? boxHeight}
          /* Deliberately NOT `preserveAspectRatio="none"`. Stretching the user
             space to the container turns every circle into an ellipse and every
             round cap into a lozenge, scaled by `containerWidth / viewBoxWidth`
             — which is exactly the defect this frame was written to retire. A
             chart that wants to fill its width does it by being re-derived at
             the new width, not by being distorted to fit. */
        >
          {children}
        </svg>
      ) : (
        <p className="nx-chart__empty">{empty.reason}</p>
      )}
      {caption !== undefined && empty === null && (
        <p className="nx-chart__caption">{caption}</p>
      )}
    </figure>
  );
}
