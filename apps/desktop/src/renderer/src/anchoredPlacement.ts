/**
 * Where an anchored floating panel goes — the whole answer, as arithmetic over
 * plain rectangles.
 *
 * Every floating surface in this renderer used to place itself the same way:
 * `top = anchor.bottom + 2`, and a `right` offset measured from the window's
 * width. Three things are wrong with that, and all three shipped:
 *
 * 1. **Downward only.** A trigger near the bottom of the window opens a menu
 *    below the screen edge. `.app` sets `overflow: hidden` (see `app.css`), so
 *    there is nothing to scroll and the menu is simply unreachable — which is
 *    exactly what the founder hit on „Profil: …“ at the foot of the sidebar.
 * 2. **No knowledge of the panel's own size.** A rule that never asks how tall
 *    the panel is cannot decide to flip it, and cannot decide how far to shrink
 *    it. So it did neither.
 * 3. **Right-anchoring.** `right: window.innerWidth − anchor.right` puts the
 *    panel's left edge at `anchor.right − intrinsicWidth`, a number nobody
 *    computes and therefore nobody clamps. For the sidebar (`anchor.right ≈
 *    208`) any panel wider than 208px hung off the LEFT edge, silently.
 *
 * So this module emits **left/top only**, always knows the panel's measured
 * box, and is pure: the viewport, the anchor and the panel arrive as numbers.
 * Purity is not decoration here — Vitest runs with no DOM in this repo, so the
 * placement rule is testable exactly to the extent that it measures nothing.
 *
 * `useAnchoredPosition.ts` is the only caller: it owns the DOM half (measuring,
 * scroll/resize/resize-observer, portalling, dismissal) and hands the numbers
 * down here.
 */

/** Minimum distance kept between the panel and any edge of the viewport. */
export const EDGE_MARGIN = 8;

/** Distance between a menu and the control it hangs off. */
export const ANCHOR_GAP = 2;

/**
 * The same distance for the two caret-anchored menus („/“ and „[[“). Wider,
 * because the anchor there is a text caret rather than a button: 2px would put
 * the panel on top of the descenders of the line being typed.
 */
export const CARET_GAP = 4;

/**
 * How tall a panel is allowed to get when the viewport is not the constraint —
 * the scroll window `.note__menu-panel` and `.note__slash` are drawn for. The
 * CSS carries the same number as its own `max-height`, which is what the panel
 * is measured against before it is placed; the value computed here then wins as
 * an inline style.
 */
export const PANEL_MAX_HEIGHT = 320;

/**
 * The preferred cap of a panel the WINDOW is the only limit on — today the app
 * menu behind the title bar's mark, which must show every one of its rows
 * whenever the window is tall enough for them.
 *
 * Not a number, and that is the point rather than a shortcut:
 * `computePlacement` answers with `min(space − margin, preferredMaxHeight)`, so
 * a cap of `Infinity` makes the room the window has left the only answer. `320`
 * was this menu's cap by inheritance — `NotePopover` defaulted to
 * `PANEL_MAX_HEIGHT`, which is a note popover's scroll window rather than this
 * menu's — and the menu drew a scrollbar on a window with room to spare.
 */
export const UNBOUNDED_PANEL_HEIGHT = Number.POSITIVE_INFINITY;

/** A viewport-relative box, in the same coordinates `getBoundingClientRect` reports. */
export interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** Which side of the anchor the panel sits on. */
export type PlacementSide = "bottom" | "top";

/**
 * Which edges are lined up: `start` puts the panel's left edge on the anchor's
 * left edge (the caret menus, which read left-to-right from the typing point),
 * `end` puts its right edge on the anchor's right edge (the "⋯" menus, which
 * hang back under the glyph they were opened from).
 */
export type PlacementAlign = "start" | "end";

export interface PlacementInput {
  readonly anchor: Rect;
  /** The panel's measured box, taken with the preferred max height applied and nothing else. */
  readonly panel: { readonly width: number; readonly height: number };
  readonly viewport: { readonly width: number; readonly height: number };
  /** The side to try first; the result may differ. */
  readonly side: PlacementSide;
  readonly align: PlacementAlign;
  readonly gap: number;
  readonly margin: number;
  /**
   * The tallest the panel would like to be. `UNBOUNDED_PANEL_HEIGHT` says the
   * window is the panel's only limit, and the room it has left decides alone.
   */
  readonly preferredMaxHeight: number;
}

export interface Placement {
  readonly top: number;
  readonly left: number;
  /** What the panel may grow to here — never negative, never above the preferred value. */
  readonly maxHeight: number;
  /** The side actually resolved, after flipping. Published to the DOM as `data-side`. */
  readonly side: PlacementSide;
}

/**
 * How much room there is on one side of the anchor: from the anchor's edge to
 * the viewport's, minus the gap the panel will not occupy. The edge margin is
 * NOT subtracted here — it is subtracted once, later, from whichever side wins,
 * so that "does it fit" and "how tall may it be" ask the same question.
 */
function spaceOn(side: PlacementSide, input: PlacementInput): number {
  return side === "bottom"
    ? input.viewport.height - (input.anchor.top + input.anchor.height) - input.gap
    : input.anchor.top - input.gap;
}

/**
 * The panel's left edge, aligned as asked and then clamped inside the viewport.
 *
 * The `max < min` guard is the case where the panel is simply wider than the
 * viewport: the clamp window has inverted, and a naive `min(max(x, min), max)`
 * would return the negative `max` and push the panel off the left edge — the
 * very failure this module exists to stop. Pinning to `min` instead keeps the
 * panel's left edge visible and lets its right edge overflow, which is the
 * readable half.
 */
function clampedLeft(input: PlacementInput): number {
  const raw =
    input.align === "start"
      ? input.anchor.left
      : input.anchor.left + input.anchor.width - input.panel.width;
  const min = input.margin;
  const max = input.viewport.width - input.panel.width - input.margin;
  return max < min ? min : Math.min(Math.max(raw, min), max);
}

/**
 * Resolve one placement.
 *
 * The vertical rule, in order:
 *
 * - The requested side if the panel fits there.
 * - Otherwise the opposite side if it fits there.
 * - Otherwise neither fits, so: stay on whichever side has more room and SHRINK
 *   to it. Flipping to a side that is also too small only moves the clipping.
 *
 * "Fits" is measured against the panel's wanted height plus the edge margin, so
 * a panel that would land exactly on the viewport edge counts as not fitting —
 * the margin is part of the contract, not slack.
 *
 * The height used to position an upward panel is the SHRUNK height, never the
 * measured one. That is what keeps a clamped panel's bottom edge glued to the
 * anchor instead of leaving a gap the size of everything that was cut.
 *
 * An UNBOUNDED `preferredMaxHeight` (the app menu) does not change any of that:
 * it only removes the fixed ceiling, so "fits" is asked of the room the window
 * has rather than of a number somebody picked for a different panel.
 */
export function computePlacement(input: PlacementInput): Placement {
  const wanted = Math.min(input.panel.height, input.preferredMaxHeight);
  const needed = wanted + input.margin;

  const spaceBelow = spaceOn("bottom", input);
  const spaceAbove = spaceOn("top", input);
  const opposite: PlacementSide = input.side === "bottom" ? "top" : "bottom";
  const spaceRequested = input.side === "bottom" ? spaceBelow : spaceAbove;
  const spaceOpposite = input.side === "bottom" ? spaceAbove : spaceBelow;

  let side = input.side;
  if (spaceRequested < needed) {
    side = spaceOpposite >= needed || spaceOpposite > spaceRequested ? opposite : input.side;
  }

  const space = side === "bottom" ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(0, Math.min(space - input.margin, input.preferredMaxHeight));
  const height = Math.min(wanted, maxHeight);

  return {
    top:
      side === "bottom"
        ? input.anchor.top + input.anchor.height + input.gap
        : input.anchor.top - input.gap - height,
    left: clampedLeft(input),
    maxHeight,
    side,
  };
}
