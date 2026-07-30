import type { ReactNode } from "react";

export interface ListRowProps {
  leading?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  /** Mutes the row content (e.g. secondary / completed). */
  muted?: boolean;
  /** Extra class on the row itself — the way a page states a row-wide state (e.g. picked in a batch selection) without wrapping the row and breaking its `:last-child` separator rule. */
  className?: string | undefined;
  /** Makes the whole row a click target. A row is not a control, so the caller must also provide a real focusable affordance inside it — whose activation click bubbles here. */
  onClick?: (() => void) | undefined;
}

export function ListRow({ leading, children, trailing, muted, className, onClick }: ListRowProps) {
  const classes = ["nx-list-row"];
  if (muted) classes.push("nx-list-row--muted");
  if (className) classes.push(className);
  return (
    <div className={classes.join(" ")} onClick={onClick}>
      {leading != null && <span className="nx-list-row__leading">{leading}</span>}
      <span className="nx-list-row__content">{children}</span>
      {trailing != null && <span className="nx-list-row__trailing">{trailing}</span>}
    </div>
  );
}
