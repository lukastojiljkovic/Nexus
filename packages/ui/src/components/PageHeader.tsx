import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "./Button.js";
import { Icon, type IconName } from "./Icon.js";

/**
 * The ARIA of the header's overflow trigger — the disclosure that holds the
 * page's secondary controls when the window is too narrow to show them inline.
 *
 * It is a DISCLOSURE and not a menu, which is why there is no `aria-haspopup`
 * here: the panel holds the page's own buttons, not a list of commands over
 * which focus roves with the arrow keys, and claiming a menu would promise
 * exactly that keyboard model and then not have it.
 */
export function overflowTriggerProps(
  open: boolean,
  panelId: string,
): { "aria-expanded": boolean; "aria-controls": string } {
  return { "aria-expanded": open, "aria-controls": panelId };
}

interface PageHeaderBaseProps {
  /** The page's name. Rendered as the page's only `h1`. */
  title: string;
  /**
   * An `id` for the rendered `<h1>`, so a control below it can name itself BY
   * REFERENCE to the title the user is already reading.
   *
   * PRETRAGA's own search box is the case it was added for: the field's name IS
   * the page's name, and an `aria-label` carrying the same string is a copy of
   * it that drifts the day either one is reworded — with the screen and the
   * screen reader then disagreeing about what the field is called. The heading
   * is already on screen; this is what lets it be the name.
   */
  titleId?: string;
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
  /**
   * The page's ONE primary action — the filled button. It leads the cluster,
   * and unlike `secondaryActions` it survives the narrow window: the header
   * never folds away the thing the page is for.
   */
  primaryAction?: ReactNode;
  /**
   * The page's own top-level controls, right-aligned on the title's row. Use
   * this when the page's controls are peers with no primary among them (a
   * segmented page switcher, a view toggle); otherwise prefer the pair above
   * and below.
   */
  actions?: ReactNode;
  /**
   * The page-level filter row: the controls that narrow what the page is
   * showing. It takes a line of its own under the title, wrapped out of the
   * header's flex line rather than crowded onto it, and it stacks when the
   * window is narrow.
   */
  filters?: ReactNode;
  /**
   * Extra class on the wrapper, for a page that needs to place the header in
   * its own grid or override its bottom spacing. Never for retyping the title.
   */
  className?: string;
}

/**
 * The secondary half of the contract, as a union so that a foldable cluster
 * cannot be written without the name its trigger needs.
 *
 * Below 900px the secondary actions move behind an icon-only trigger, and an
 * icon-only control with no `aria-label` is a control with no name at all. The
 * two arms make that state unrepresentable rather than leaving it to review.
 */
type PageHeaderOverflowProps =
  | {
      secondaryActions?: undefined;
      overflowLabel?: string;
    }
  | {
      /**
       * The page's controls that are not its primary: the settings gear, the
       * view toggle, the import button. They ride with the actions while there
       * is room and fold into the ⋯ trigger when there is not.
       */
      secondaryActions: readonly ReactNode[];
      /** The overflow trigger's own name — it is an icon and nothing else. */
      overflowLabel: string;
    };

export type PageHeaderProps = PageHeaderBaseProps & PageHeaderOverflowProps;

/**
 * The anchor every page opens with (STATUS §5 C item 12: nine of fifteen pages
 * had no title at all, and the six that did used three different sizes).
 *
 * It is one component rather than a convention so that the page title cannot
 * drift again: the size, the weight, the leading and the tracking are stated
 * here once, and a page supplies only words. The actions slot exists for the
 * same reason — page-level controls that had been scattered into the body now
 * have one declared place to sit.
 *
 * WHAT IT GREW FOR, 2026-10-10. The UX overhaul's shared patterns arrived
 * before the pages that adopt them, and this header is where four of them meet:
 * the page's primary action, its secondary actions (which fold into an overflow
 * below 900px rather than pushing the title off the line), the filter row that
 * belongs to the page rather than to the body, and the collapse that keeps all
 * of it legible at the 900px window minimum this app enforces.
 */
export function PageHeader({
  title,
  titleId,
  subtitle,
  sigil,
  primaryAction,
  actions,
  secondaryActions,
  overflowLabel,
  filters,
  className,
}: PageHeaderProps) {
  const panelId = useId();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  // The overflow is dismissed the way every popover in the product is: Escape
  // or a press outside it. The trigger is inside `moreRef` too, so the press
  // that closes the panel is never the press that re-opens it.
  useEffect(() => {
    if (!overflowOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOverflowOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const box = moreRef.current;
      if (box !== null && event.target instanceof Node && !box.contains(event.target)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [overflowOpen]);

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
        <h1 className="nx-page-header__title" id={titleId}>
          {title}
        </h1>
        {subtitle != null && <p className="nx-hint nx-page-header__subtitle">{subtitle}</p>}
      </div>
      {(primaryAction != null || actions != null || secondaryActions != null) && (
        <div className="nx-page-header__actions">
          {primaryAction}
          {actions}
          {secondaryActions != null && (
            <div className="nx-page-header__more" ref={moreRef}>
              <Button
                className="nx-page-header__more-trigger"
                aria-label={overflowLabel}
                title={overflowLabel}
                {...overflowTriggerProps(overflowOpen, panelId)}
                onClick={() => setOverflowOpen((open) => !open)}
              >
                <Icon name="more" size={16} />
              </Button>
              <div
                id={panelId}
                className={
                  overflowOpen
                    ? "nx-page-header__secondary nx-page-header__secondary--open"
                    : "nx-page-header__secondary"
                }
              >
                {secondaryActions.map((action, index) => (
                  <Fragment key={index}>{action}</Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {filters != null && <div className="nx-page-header__filters">{filters}</div>}
    </header>
  );
}
