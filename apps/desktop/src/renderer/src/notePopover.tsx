import { useId, useRef, useState, type ReactNode } from "react";

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
}: NotePopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The panel is portalled, so it is no longer the trigger's DOM neighbour and
  // assistive technology has nothing to infer the relationship from. `aria-
  // controls` states it, and only while there is something to point at.
  const panelId = useId();
  // `align: "end"` keeps the panel hanging back under the glyph it was opened
  // from — today's right-aligned look, now with the clamp it never had.
  const { panelProps, portal } = useAnchoredPosition({
    open,
    anchor: triggerRef,
    trigger: triggerRef,
    align: "end",
    onClose: () => setOpen(false),
  });

  return (
    <div className="note__menu">
      <button
        ref={triggerRef}
        type="button"
        className={`note__menu-trigger${triggerClassName ? ` ${triggerClassName}` : ""}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {triggerContent}
      </button>
      {open &&
        portal(
          <div id={panelId} className="note__menu-panel" role="menu" {...panelProps}>
            {children(() => setOpen(false))}
          </div>,
        )}
    </div>
  );
}
