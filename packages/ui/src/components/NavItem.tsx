import type { AnchorHTMLAttributes, ReactNode } from "react";

export interface NavItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Selection is typographic (gold + weight) plus the ✦ brand-glyph marker —
   * side bars and background fills are banned as selection indicators
   * (founder decision, design direction brief). */
  active?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}

export function NavItem({ active, badge, children, className, onKeyDown, ...rest }: NavItemProps) {
  const classes = ["nx-nav-item"];
  if (active) classes.push("nx-nav-item--active");
  if (className) classes.push(className);
  return (
    <a
      className={classes.join(" ")}
      aria-current={active ? "page" : undefined}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        // Anchors answer Enter (the browser's own rule for `<a>`) but not
        // Space — every sidebar row, and the profile/search rows sharing
        // this component, silently ignored it. `.click()` re-fires the SAME
        // click the row already answers to (and Enter already triggers), so
        // the fix holds at every call site without becoming a `<button>`.
        if (!event.defaultPrevented && event.key === " ") {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
      {...rest}
    >
      <span className="nx-nav-item__label">{children}</span>
      {badge != null && !active && <span className="nx-nav-item__badge">{badge}</span>}
    </a>
  );
}
