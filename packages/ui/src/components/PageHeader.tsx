import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.js";

export interface PageHeaderProps {
  /** The page's name. Rendered as the page's only `h1`. */
  title: string;
  /**
   * The module's own mark, bled off the top-right corner of the header as a
   * watermark.
   *
   * This is where a module's IDENTITY lives, and it is a shape rather than a
   * colour on purpose. The palette bans purple, blue and orange, which removes
   * 203° of the hue wheel; what is left collapses into three perceptual
   * families — the two reds are 4° apart, the two greens 4° apart — so colour
   * can carry three or four identities here, not fourteen. Geometry can carry
   * fourteen, and the app already has fourteen marks drawn to one vocabulary.
   *
   * The same mark appears at four scales: 16px in the title strip, 18px in the
   * sidebar, 48px in an empty state, and this. Nothing new is drawn for it.
   */
  sigil?: IconName;
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
export function PageHeader({ title, subtitle, sigil, actions, className }: PageHeaderProps) {
  // The modifier is what keeps the actions clear of the mark — see the rule in
  // `styles.css`. Set from `sigil` rather than from a prop, so a page cannot
  // supply one and forget the other.
  const classes = ["nx-page-header"];
  if (sigil != null) classes.push("nx-page-header--sigil");
  if (className != null) classes.push(className);

  return (
    <header className={classes.join(" ")}>
      {sigil != null && (
        // Behind the header only, never behind body content, and never over
        // anything a reader has to hit: it is `aria-hidden` and takes no
        // pointer events.
        //
        // It is NOT clipped, and must not need to be. The header states
        // `min-height: 72px` and the mark is drawn at exactly 72 at the corner,
        // so it fits by construction — a mark that had to be clipped would be a
        // mark that is partly missing, which is what the first attempt shipped
        // (a 132px sigil bled off a 50px header showed a 26px slice and read as
        // a rendering fault). If this ever grows, the header grows with it —
        // `styles.css` names the same 72 once, as
        // `--nx-page-header-sigil-size`, and both the header's floor and the
        // column the actions keep clear of the mark are written from it.
        <span className="nx-page-header__sigil" aria-hidden="true">
          <Icon name={sigil} size={72} />
        </span>
      )}
      <div className="nx-page-header__text">
        <h1 className="nx-page-header__title">{title}</h1>
        {subtitle != null && <p className="nx-page-header__subtitle">{subtitle}</p>}
      </div>
      {actions != null && <div className="nx-page-header__actions">{actions}</div>}
    </header>
  );
}
