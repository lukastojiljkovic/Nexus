import type { ReactNode } from "react";

/**
 * The ARIA of a row of page-level controls.
 *
 * A `group`, and deliberately not a `toolbar`: `toolbar` promises the arrow-key
 * roving focus that the WAI-ARIA pattern describes, and this row holds ordinary
 * buttons and switchers that a keyboard user reaches with Tab. Claiming the
 * toolbar role without that behaviour would tell a screen reader user to press
 * arrow keys that do nothing.
 */
export function toolbarAria(label: string): { role: "group"; "aria-label": string } {
  return { role: "group", "aria-label": label };
}

export interface ToolbarProps {
  /** The row's name, read before its controls. Required, because an unnamed row reads as loose buttons. */
  label: string;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * The controls that act on the whole page, drawn as one row under the header.
 *
 * Pages had put this row in the header's `actions` slot on some surfaces and in
 * the body on others, so the same kind of control moved between two places. The
 * rule the header states is that page-wide controls belong to the header; this
 * row is for the ones that are a view of the page's content (a view switcher, a
 * filter), which belong beneath the title with the content they change.
 */
export function Toolbar({ label, className, children }: ToolbarProps) {
  const classes = ["nx-toolbar"];
  if (className != null) classes.push(className);
  return (
    <div className={classes.join(" ")} {...toolbarAria(label)}>
      {children}
    </div>
  );
}
