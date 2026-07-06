import type { ReactNode } from "react";

export interface ListRowProps {
  leading?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  /** Mutes the row content (e.g. secondary / completed). */
  muted?: boolean;
}

export function ListRow({ leading, children, trailing, muted }: ListRowProps) {
  const classes = ["nx-list-row"];
  if (muted) classes.push("nx-list-row--muted");
  return (
    <div className={classes.join(" ")}>
      {leading != null && <span className="nx-list-row__leading">{leading}</span>}
      <span className="nx-list-row__content">{children}</span>
      {trailing != null && <span className="nx-list-row__trailing">{trailing}</span>}
    </div>
  );
}
