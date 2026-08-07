import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { firstFocusableIndex, lastFocusableIndex, nextFocusableIndex } from "./focusOrder.js";
import { elementToFocusCandidate } from "./useFocusTrap.js";
import { useAnchoredPosition } from "./useAnchoredPosition.js";

export interface NotePopoverProps {
  /** Accessible label for the trigger button. */
  label: string;
  /** Extra class on the trigger, so callers can size/reveal it per context. */
  triggerClassName?: string;
  /**
   * What the trigger shows; defaults to the "⋯" every row-level menu uses. A
   * toolbar-level menu (the TASK page's „Šabloni“) names itself instead, because
   * a bare "⋯" beside the view toggle would say nothing about what it opens —
   * the glyph reads as "more actions on THIS row" only when it sits on a row.
   */
  triggerContent?: ReactNode;
  /** Panel content; `close` dismisses the popover after an action is chosen. */
  children: (close: () => void) => ReactNode;
  /**
   * False for a panel whose content is not exclusively `role="menuitem"`
   * children — a form, or a menuitem list with an extra non-menuitem control
   * riding along. `role="menu"` is a promise of ArrowUp/Down roving focus
   * over `menuitem`s (WAI-ARIA APG's menu-button pattern); a panel that does
   * not honour that contract is more honest carrying no menu role at all than
   * one it does not implement. CalendarPage's template pickers are the
   * callers that need this — see the comment at their call sites. Defaults
   * to `true`.
   */
  menu?: boolean;
}

/** The panel's real `role="menuitem"` children, read fresh every time — content is arbitrary, caller-supplied JSX, so nothing else tracks its shape. Module-level (not a closure) so effects that call it need not name it as a dependency: it has none of its own beyond the element handed in. */
function menuItems(panel: HTMLElement | null): HTMLElement[] {
  return Array.from(panel?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
}

/**
 * A small "⋯" actions popover (NOTE organizer, slice a3b): a trigger button
 * that reveals a token-styled panel, closing on an outside click or Escape.
 * Hand-rolled (no floating-ui) to keep the renderer dependency-light; the panel
 * is a real `role="menu"` region and every item inside is a focusable
 * `<button>`.
 *
 * Placement, following and dismissal all belong to `useAnchoredPosition`, which
 * this component was the original home of. What the move buys, beyond one copy
 * of the rule instead of four:
 *
 * - The panel FLIPS above the trigger when there is no room below. It used to
 *   be `top: rect.bottom + 2` and nothing else, so a trigger low in the window
 *   opened a menu below the screen edge — unreachable, because `.app` sets
 *   `overflow: hidden` and there is nothing to scroll.
 * - It is clamped inside both horizontal edges. The old `right:` anchoring left
 *   the panel's LEFT edge wherever its intrinsic width happened to put it,
 *   which for a 208px-wide sidebar meant off-screen.
 * - It follows scrolling and resizing, which no render announces and which the
 *   old `mousedown`-only dismissal did not even close on.
 * - It is portalled to `<body>`, so escaping the surrounding `overflow: auto`
 *   list/tree no longer depends on no ancestor ever growing a `transform`.
 */
export function NotePopover({
  label,
  triggerClassName,
  triggerContent = "⋯",
  children,
  menu = true,
}: NotePopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The panel is portalled, so it is no longer the trigger's DOM neighbour and
  // assistive technology has nothing to infer the relationship from. `aria-
  // controls` states it, and only while there is something to point at.
  const panelId = useId();
  // `align: "end"` keeps the panel hanging back under the glyph it was opened
  // from — today's right-aligned look, now with the clamp it never had.
  const { panelRef, panelProps, portal } = useAnchoredPosition({
    open,
    anchor: triggerRef,
    trigger: triggerRef,
    align: "end",
    onClose: () => setOpen(false),
  });

  // Focus moves onto the first item the instant the menu opens — the WAI-ARIA
  // APG menu-button rule, and previously missing outright: opening left focus
  // on the trigger, so the very first ArrowDown had nothing to move from.
  useEffect(() => {
    if (!menu || !open) return;
    const items = menuItems(panelRef.current);
    items.forEach((item, index) => {
      item.tabIndex = index === 0 ? 0 : -1;
    });
    items[0]?.focus();
  }, [open, menu, panelRef]);

  /**
   * Real roving focus (WAI-ARIA APG): ArrowUp/Down move between menu items
   * and wrap at both ends, Home/End jump to the first/last, and only the
   * current item sits in the tab order — `focusOrder.ts` is the shared index
   * math `useFocusTrap.ts`'s modal trap also runs on. Escape is NOT handled
   * here: `useAnchoredPosition`'s own document-level listener already closes
   * on it, from anywhere, whether or not the panel holds focus. Tab is —
   * closing the menu rather than trapping it, because a menu is not a modal.
   */
  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!menu) return;
    const items = menuItems(panelRef.current);
    if (items.length === 0) return;
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    const candidates = items.map(elementToFocusCandidate);
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    let nextIndex: number | null;
    switch (event.key) {
      case "ArrowDown":
        nextIndex = nextFocusableIndex(candidates, currentIndex, 1);
        break;
      case "ArrowUp":
        nextIndex = nextFocusableIndex(candidates, currentIndex, -1);
        break;
      case "Home":
        nextIndex = firstFocusableIndex(candidates);
        break;
      case "End":
        nextIndex = lastFocusableIndex(candidates);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (nextIndex === null) return;
    items.forEach((item, index) => {
      item.tabIndex = index === nextIndex ? 0 : -1;
    });
    items[nextIndex]?.focus();
  }

  return (
    <div className="note__menu">
      <button
        ref={triggerRef}
        type="button"
        className={`note__menu-trigger${triggerClassName ? ` ${triggerClassName}` : ""}`}
        aria-label={label}
        aria-haspopup={menu ? "menu" : "true"}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {triggerContent}
      </button>
      {open &&
        portal(
          <div
            id={panelId}
            className="note__menu-panel"
            role={menu ? "menu" : "group"}
            aria-label={menu ? undefined : label}
            onKeyDown={onPanelKeyDown}
            {...panelProps}
          >
            {children(() => setOpen(false))}
          </div>,
        )}
    </div>
  );
}
