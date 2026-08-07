import type { AnchorHTMLAttributes, ReactNode } from "react";

export interface NavItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Selection is typographic (gold + weight) plus the ✦ brand-glyph marker —
   * side bars and background fills are banned as selection indicators
   * (founder decision, design direction brief). */
  active?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}

export function NavItem({ active, badge, children, className, ...rest }: NavItemProps) {
  const classes = ["nx-nav-item"];
  if (active) classes.push("nx-nav-item--active");
  if (className) classes.push(className);
  return (
    <a
      className={classes.join(" ")}
      aria-current={active ? "page" : undefined}
      {...rest}
    >
      <span className="nx-nav-item__label">{children}</span>
      {badge != null && !active && <span className="nx-nav-item__badge">{badge}</span>}
    </a>
  );
}
