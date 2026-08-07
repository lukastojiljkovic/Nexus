export interface LoadingStateProps {
  /** What assistive technology hears. The bars themselves are decorative and say nothing. */
  label: string;
  /**
   * How many placeholder rows to draw. Match the density of what is coming:
   * three for a card, six or eight for a list. A skeleton that is much shorter
   * than its page reads as a page that finished loading almost empty.
   */
  rows?: number;
  className?: string;
}

/**
 * What a surface shows while it is reading.
 *
 * Before this existed, fourteen pages rendered one line of grey „Učitavanje…"
 * in the top-left corner of an otherwise blank pane, the canvas rendered
 * literally nothing for its whole initial load, and exactly two surfaces —
 * Datoteke and the dashboard — had a real skeleton, in two byte-identical
 * copies of the same six CSS rules.
 *
 * A skeleton beats a word for a reason that is not decorative: it says how much
 * is coming and roughly what shape it has, so the page does not appear to jump
 * from empty to full. A single line of text says only that something is
 * happening somewhere.
 *
 * **Deliberately still — no shimmer, no pulse.** A moving gradient would be the
 * loudest thing on a page whose whole point is calm, and it would have to be
 * exempted from the reduced-motion policy to keep moving at all. The bars are
 * the surface-alt fill and nothing else.
 */
export function LoadingState({ label, rows = 3, className }: LoadingStateProps) {
  const count = Math.max(1, Math.min(rows, 12));
  return (
    <div
      className={className == null ? "nx-skeleton" : `nx-skeleton ${className}`}
      role="status"
      aria-label={label}
    >
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className="nx-skeleton__line" aria-hidden="true" />
      ))}
    </div>
  );
}
