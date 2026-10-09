import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import {
  ANCHOR_GAP,
  computePlacement,
  EDGE_MARGIN,
  PANEL_MAX_HEIGHT,
  type Placement,
  type PlacementAlign,
  type PlacementSide,
  type Rect,
} from "./anchoredPlacement.js";

/**
 * The DOM half of anchored positioning: measuring, following, portalling and
 * dismissing. `anchoredPlacement.ts` decides WHERE the panel goes; this decides
 * when to ask, what to measure, and where the element lives while it is open.
 *
 * It exists because the renderer had four separate answers to the same
 * question — the shared "⋯" popover, the profile switcher riding on it, the
 * caret menus („/“ and „[[“) and the calendar's foreign-origin popover, the
 * last of which had copied the first one's arithmetic AND its two dismiss
 * listeners verbatim. One copy of a rule can be fixed; four cannot be kept
 * fixed.
 *
 * Deliberately hand-rolled, with no floating-ui / popper / tippy: the renderer
 * refuses those on purpose (see the header of `notePopover.tsx`), and what is
 * actually needed here — flip, clamp, shrink, follow — is the file above plus
 * the effects below.
 */

/**
 * Where the anchor rectangle comes from. Three shapes, because the three call
 * sites genuinely have three:
 *
 * - a **ref** to the trigger element (the "⋯" popover),
 * - a **live getter** (`props.clientRect` from `@tiptap/suggestion`), which
 *   must be re-invoked rather than snapshotted — the caret moves and the editor
 *   pane scrolls under it,
 * - a **plain rect** captured at click time (the calendar's foreign chip, which
 *   has no element to hold on to).
 *
 * All three are normalised to a getter below, so re-measurement is always
 * possible and no caller gets a placement that silently stopped updating.
 */
export type AnchorSource = RefObject<HTMLElement | null> | (() => DOMRect | null) | DOMRect;

export interface AnchoredPositionOptions {
  /** While false the hook measures nothing and listens to nothing. */
  readonly open: boolean;
  readonly anchor: AnchorSource;
  /** Side to try first; the resolved side can differ and is published as `data-side`. */
  readonly side?: PlacementSide;
  readonly align?: PlacementAlign;
  readonly gap?: number;
  /** The panel's preferred ceiling; `UNBOUNDED_PANEL_HEIGHT` leaves the room the window has left as its only limit. */
  readonly preferredMaxHeight?: number;
  /**
   * The control the panel belongs to. The panel is portalled to `<body>`, so it
   * is no longer a DOM descendant of this element and the outside-click test
   * has to name both; focus also returns here when the panel closes.
   */
  readonly trigger?: RefObject<HTMLElement | null>;
  /**
   * Provided ⇒ the hook owns dismissal: outside pointer-down, Escape, and the
   * focus return. Omitted ⇒ it owns positioning only, which is what the caret
   * menus need — `@tiptap/suggestion` already owns their Escape and their
   * lifetime.
   */
  readonly onClose?: () => void;
}

export interface AnchoredPanel {
  /**
   * The panel element itself, for the rare caller that needs to reach into it —
   * the suggestion menus scroll their own keyboard-active row into view. Stable
   * across renders, so naming it in an effect's dependency list costs nothing.
   */
  readonly panelRef: RefObject<HTMLDivElement | null>;
  /** Spread onto the panel element: the measured ref, the resolved position, the resolved side. */
  readonly panelProps: {
    readonly ref: RefObject<HTMLDivElement | null>;
    readonly style: CSSProperties;
    readonly "data-side": PlacementSide;
  };
  /**
   * Wraps the panel in the portal to `<body>`.
   *
   * `position: fixed` alone only escapes ancestor clipping while no ancestor
   * grows a `transform`, `filter`, `perspective`, `contain` or
   * `backdrop-filter` — any of which makes that ancestor the containing block.
   * `app.css` documents that invariant as load-bearing, which means somebody
   * has to keep re-verifying it. Portalling makes it structural instead.
   */
  readonly portal: (panel: ReactNode) => ReactNode;
}

function toRect(box: DOMRect | null): Rect | null {
  if (box === null) return null;
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

function readAnchorRect(anchor: AnchorSource): Rect | null {
  if (typeof anchor === "function") return toRect(anchor());
  if ("current" in anchor) return toRect(anchor.current?.getBoundingClientRect() ?? null);
  return toRect(anchor);
}

function samePlacement(a: Placement, b: Placement): boolean {
  return a.top === b.top && a.left === b.left && a.maxHeight === b.maxHeight && a.side === b.side;
}

/**
 * The inline `max-height` for one preferred cap.
 *
 * `UNBOUNDED_PANEL_HEIGHT` is `Infinity`, and `` `${Infinity}px` `` is not a
 * length: the browser drops it, the measurement then runs against whatever the
 * stylesheet caps the panel at, and the panel is placed from a height it does
 * not have. `none` is the declaration that means „no ceiling", which is exactly
 * what the unbounded cap asks for.
 */
function maxHeightDeclaration(preferredMaxHeight: number): string {
  return Number.isFinite(preferredMaxHeight) ? `${preferredMaxHeight}px` : "none";
}

export function useAnchoredPosition({
  open,
  anchor,
  side = "bottom",
  align = "end",
  gap = ANCHOR_GAP,
  preferredMaxHeight = PANEL_MAX_HEIGHT,
  trigger,
  onClose,
}: AnchoredPositionOptions): AnchoredPanel {
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  /**
   * One measurement pass. The panel is rendered `visibility: hidden` at 0,0
   * until it has one, so this always runs against a laid-out element and the
   * real coordinates are committed in the same frame — nothing flashes.
   */
  function reposition(): void {
    const panel = panelRef.current;
    const anchorRect = readAnchorRect(anchor);
    if (panel === null || anchorRect === null) return;
    // Measured with the clamp lifted, then put straight back. Reading the box
    // of an element that a previous pass already shrank would feed each answer
    // into the next question — the panel could then flip on every frame — so
    // what is measured is always the panel's NATURAL height. The two writes
    // bracket exactly one forced reflow.
    //
    // `left` is lifted for the same reason. These panels have no set width, so
    // a `position: fixed` box with `left: L` shrinks to fit `viewport − L`:
    // measuring one that a previous pass already pushed rightwards would report
    // the width it is stuck at rather than the width it wants, and a panel
    // whose content grew while it was open could never grow back.
    const committed = { maxHeight: panel.style.maxHeight, left: panel.style.left };
    panel.style.maxHeight = maxHeightDeclaration(preferredMaxHeight);
    panel.style.left = "0px";
    const box = panel.getBoundingClientRect();
    panel.style.maxHeight = committed.maxHeight;
    panel.style.left = committed.left;
    const next = computePlacement({
      anchor: anchorRect,
      panel: { width: box.width, height: box.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      side,
      align,
      gap,
      margin: EDGE_MARGIN,
      preferredMaxHeight,
    });
    setPlacement((prev) => (prev !== null && samePlacement(prev, next) ? prev : next));
  }

  // The latest closures, for the listeners below to reach without re-subscribing
  // on every render.
  const repositionRef = useRef(reposition);
  const onCloseRef = useRef(onClose);

  // Re-measured on every render, with no dependency array on purpose: an action
  // inside the panel can reflow the trigger's own row — attaching a note's
  // first tag adds a chip line under it — and the panel has to follow. Handing
  // back the previous placement unchanged is what keeps this from looping.
  useLayoutEffect(() => {
    repositionRef.current = reposition;
    onCloseRef.current = onClose;
    if (open) reposition();
  });

  useEffect(() => {
    if (!open) return;
    const follow = (): void => repositionRef.current();
    // `capture: true` because scroll does not bubble: every row-level trigger
    // sits inside a scroller of its own (`.app__main`, `.note__editor-pane`, a
    // calendar grid), and only the capture phase sees those.
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    // The panel's own content changes while it is open — a tag toggle grows a
    // row, a menu swaps into a form — and a taller panel is a different
    // placement question, which no render of the OWNER would announce.
    const observer = new ResizeObserver(follow);
    const panel = panelRef.current;
    if (panel !== null) observer.observe(panel);
    return () => {
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      observer.disconnect();
    };
  }, [open]);

  // Whether the panel currently holds focus — the one thing that decides if
  // closing should hand focus back to the trigger.
  const focusInPanelRef = useRef(false);
  const dismissible = onClose !== undefined;

  useEffect(() => {
    if (!open || !dismissible) return;
    focusInPanelRef.current = false;
    // Read once, here: the control that opened the panel is the control focus
    // goes back to, and it cannot change while the panel is open. Reading
    // `trigger.current` in the cleanup instead would ask for it after the tree
    // has already moved on.
    const triggerElement = trigger?.current ?? null;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) === true) return;
      // The trigger is not inside the portalled panel any more, so it has to be
      // named separately — otherwise clicking it would close and immediately
      // reopen the panel.
      if (triggerElement?.contains(target) === true) return;
      // An outside click has already given focus to whatever was clicked;
      // pulling it back to the trigger afterwards would fight the user.
      focusInPanelRef.current = false;
      onCloseRef.current?.();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCloseRef.current?.();
    };
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target) === true) {
        focusInPanelRef.current = true;
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      // Closing returns focus to the control that opened the panel — but only
      // when the panel was holding it. Choosing a menu item and pressing
      // Escape both qualify; an outside click cleared the flag above and does
      // not.
      if (focusInPanelRef.current) {
        focusInPanelRef.current = false;
        triggerElement?.focus();
      }
    };
  }, [open, dismissible, trigger]);

  const resolvedSide = placement?.side ?? side;
  const style: CSSProperties =
    placement === null
      ? // The measuring pass: laid out (so it has a box) but not painted.
        {
          position: "fixed",
          top: 0,
          left: 0,
          maxHeight: Number.isFinite(preferredMaxHeight) ? preferredMaxHeight : undefined,
          visibility: "hidden",
        }
      : {
          position: "fixed",
          top: placement.top,
          left: placement.left,
          maxHeight: placement.maxHeight,
        };

  return {
    panelRef,
    panelProps: { ref: panelRef, style, "data-side": resolvedSide },
    portal: (panel) => createPortal(panel, document.body),
  };
}
