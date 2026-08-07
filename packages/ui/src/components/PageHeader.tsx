import type { ReactNode } from "react";

export interface PageHeaderProps {
  /** The page's name. Rendered as the page's only `h1`. */
  title: string;
  /**
   * One line under the title: what this page is for, or what it is currently
   * showing. Optional, but a page with nothing to say here usually means the
   * title is not carrying its weight either.
   */
  subtitle?: string;
  /** The page's own top-level controls, right-aligned on the title's row. */
  actions?: ReactNode;
  /**
   * Extra class on the wrapper, for a page that needs to place the header in
   * its own grid or override its bottom spacing. Never for retyping the title.
   */
  className?: string;
}

/**
 * The anchor every page opens with (STATUS §5 C item 12: nine of fifteen pages
 * had no title at all, and the six that did used three different sizes).
 *
 * It is one component rather than a convention so that the page title cannot
 * drift again: the size, the weight, the leading and the tracking are stated
 * here once, and a page supplies only words. The actions slot exists for the
 * same reason — page-level controls that had been scattered into the body now
 * have one declared place to sit.
 */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header className={className == null ? "nx-page-header" : `nx-page-header ${className}`}>
      <div className="nx-page-header__text">
        <h1 className="nx-page-header__title">{title}</h1>
        {subtitle != null && <p className="nx-page-header__subtitle">{subtitle}</p>}
      </div>
      {actions != null && <div className="nx-page-header__actions">{actions}</div>}
    </header>
  );
}
