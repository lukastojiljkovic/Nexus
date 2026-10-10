import type { ReactNode } from "react";

/**
 * The two shapes every card on the LAB page is built from.
 *
 * **Why they are shared rather than per card.** Each card puts a row of controls
 * under a row of readouts, four times over, and a row that wrapped differently
 * in each card would read as four surfaces rather than one instrument drawer.
 * The kit's rule is that a module brings its own page and its own copy; it does
 * not say a module must spell its own flex row four times.
 */

/** One labelled figure: an eyebrow and a value, which is what every readout here is. */
export function LabFigure({ label, value }: { label: string; value: string }) {
  return (
    <span className="lab__figure">
      <span className="nx-eyebrow">{label}</span>
      <span className="lab__value">{value}</span>
    </span>
  );
}

/** A wrapping row of controls. The class carries the layout; the children carry the controls. */
export function LabRow({ children }: { children: ReactNode }) {
  return <div className="lab__row">{children}</div>;
}
