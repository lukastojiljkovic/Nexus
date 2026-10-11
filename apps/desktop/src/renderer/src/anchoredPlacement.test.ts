import { describe, expect, it } from "vitest";

import {
  ANCHOR_GAP,
  computePlacement,
  EDGE_MARGIN,
  PANEL_MAX_HEIGHT,
  UNBOUNDED_PANEL_HEIGHT,
  type Placement,
  type PlacementInput,
  type Rect,
} from "./anchoredPlacement.js";

/**
 * `anchoredPlacement.ts` is the arithmetic every floating panel in the renderer
 * now runs before it paints, and it is pure by construction: the viewport, the
 * anchor and the panel's own measured box all arrive as plain numbers rather
 * than being read off `window` and `getBoundingClientRect`. That is what makes
 * it testable at all here — Vitest runs in a Node environment with no DOM, so a
 * placement rule that measured anything itself could not be pinned by a test.
 *
 * The numbers are not decorative. `SHIPPED_VIEWPORT` is the inner viewport of
 * the shipped 1120×720 window, and the profile-switcher case at the bottom
 * reproduces the defect the founder reported: a menu opening below the screen
 * edge, unreachable because `.app` sets `overflow: hidden` so nothing can be
 * scrolled to it.
 */

/** `window.innerHeight` of the shipped 1120×720 window — 720 less the OS frame. */
const SHIPPED_VIEWPORT = { width: 1120, height: 681 };

const BASE: PlacementInput = {
  anchor: { top: 100, left: 400, width: 24, height: 24 },
  panel: { width: 200, height: 180 },
  viewport: SHIPPED_VIEWPORT,
  side: "bottom",
  align: "end",
  gap: ANCHOR_GAP,
  margin: EDGE_MARGIN,
  preferredMaxHeight: PANEL_MAX_HEIGHT,
};

function place(overrides: Partial<PlacementInput> = {}): Placement {
  return computePlacement({ ...BASE, ...overrides });
}

/** The trigger row of the sidebar's „Profil: …“ switcher at the shipped size. */
const PROFILE_TRIGGER: Rect = { top: 599, left: 12, width: 196, height: 28 };

describe("computePlacement — vertical side", () => {
  it("places the panel below the anchor, at the preferred max height, when there is room", () => {
    const placement = place();
    expect(placement.side).toBe("bottom");
    // 100 + 24 (anchor bottom) + 2 (gap).
    expect(placement.top).toBe(126);
    expect(placement.maxHeight).toBe(PANEL_MAX_HEIGHT);
  });

  it("flips above the anchor when the space below cannot hold the panel", () => {
    const placement = place({ anchor: PROFILE_TRIGGER, panel: { width: 200, height: 120 } });
    expect(placement.side).toBe("top");
    // 599 (anchor top) − 2 (gap) − 120 (panel height), i.e. the panel's BOTTOM
    // edge lands one gap above the anchor's top edge.
    expect(placement.top).toBe(477);
    expect(placement.maxHeight).toBe(PANEL_MAX_HEIGHT);
  });

  it("honours a requested top side when it fits, without flipping it back down", () => {
    const placement = place({
      side: "top",
      anchor: { top: 400, left: 400, width: 24, height: 24 },
      panel: { width: 200, height: 120 },
    });
    expect(placement.side).toBe("top");
    expect(placement.top).toBe(278);
  });

  it("flips a top-side request downward when there is no room above", () => {
    const placement = place({
      side: "top",
      anchor: { top: 20, left: 400, width: 24, height: 24 },
      panel: { width: 200, height: 200 },
    });
    expect(placement.side).toBe("bottom");
    expect(placement.top).toBe(46);
  });

  it("caps the max height at the space actually available even when the panel fits", () => {
    // 500 − 324 (anchor bottom) − 2 (gap) = 174 of room; the 100px panel fits,
    // but the clamp it is given must describe the room, not the wish — the
    // panel's content can grow while it is open.
    const placement = place({
      viewport: { width: 1120, height: 500 },
      anchor: { top: 300, left: 400, width: 24, height: 24 },
      panel: { width: 200, height: 100 },
    });
    expect(placement.side).toBe("bottom");
    expect(placement.maxHeight).toBe(166);
  });
});

/**
 * The app menu behind the title bar's mark — the one panel that asks for
 * `UNBOUNDED_PANEL_HEIGHT`, because a list of commands has no business being
 * capped at a note popover's scroll window.
 *
 * The three numbers are the layout's own. The trigger is the 26px mark button
 * centred in the 38px strip (`--app-titlebar-h` in `shell.css`), so its box is
 * 6…32; the menu is 435px tall — eleven 28px rows (four shell commands, four
 * „Prikaz“ rows, three „Prozor“ rows), two eyebrows of 8 + 4 padding over an
 * 11px line at the app's 1.35 leading, two 1px separators with 8px of margin,
 * the 1px gaps between them, the panel's own 4px padding and the build line at
 * the foot — and the viewport is the shipped 1120×720 window's 681px inner.
 */
describe("computePlacement — the app menu's unbounded ceiling", () => {
  const TRIGGER: Rect = { top: 6, left: 4, width: 200, height: 26 };
  const MENU = { width: 268, height: 435 };

  function placeMenu(viewportHeight: number): Placement {
    return place({
      anchor: TRIGGER,
      panel: MENU,
      viewport: { width: SHIPPED_VIEWPORT.width, height: viewportHeight },
      preferredMaxHeight: UNBOUNDED_PANEL_HEIGHT,
    });
  }

  it("takes every pixel the window has left, so the whole menu shows without a scrollbar", () => {
    const placement = placeMenu(SHIPPED_VIEWPORT.height);
    expect(placement.side).toBe("bottom");
    // 681 − 32 (anchor bottom) − 2 (gap) − 8 (edge margin).
    expect(placement.maxHeight).toBe(639);
    expect(placement.top).toBe(34);
    // Taller than the menu needs: the ceiling is the room, not the wish.
    expect(placement.maxHeight).toBeGreaterThan(MENU.height);
  });

  it("still fits at the app's own minimum window — 600px outer is about 561px of viewport", () => {
    // The frame is the same measurement in reverse: the shipped 720px window
    // reports 681, so a 600px one reports about 561.
    const placement = placeMenu(561);
    expect(placement.side).toBe("bottom");
    // Only then is the panel's height the constraint, and 435 + 8 fits in 527.
    expect(placement.maxHeight).toBe(519);
    expect(placement.maxHeight).toBeGreaterThanOrEqual(MENU.height);
  });

  it("scrolls the rows, below its anchor, once the window really is too short", () => {
    const placement = placeMenu(400);
    // Flipping above is not an option — the strip is at the top of the window —
    // so it stays below and shrinks: 400 − 34 (anchor bottom + gap) − 8.
    expect(placement.side).toBe("bottom");
    expect(placement.maxHeight).toBe(358);
    expect(placement.top).toBe(34);
  });
});

describe("computePlacement — shrinking when neither side fits", () => {
  it("stays on the roomier side and shrinks rather than flipping off-screen", () => {
    // 300px tall viewport, a 280px panel: 118 below, 158 above, neither enough.
    const placement = place({
      viewport: { width: 1120, height: 300 },
      anchor: { top: 160, left: 400, width: 24, height: 20 },
      panel: { width: 200, height: 280 },
    });
    expect(placement.side).toBe("top");
    expect(placement.maxHeight).toBe(150);
    // Shrunk AND still glued to the anchor: bottom edge + gap === anchor top.
    expect(placement.top + placement.maxHeight + ANCHOR_GAP).toBe(160);
    expect(placement.top).toBe(EDGE_MARGIN);
  });

  it("shrinks downward when below is the roomier side", () => {
    const placement = place({
      viewport: { width: 1120, height: 300 },
      anchor: { top: 60, left: 400, width: 24, height: 20 },
      panel: { width: 200, height: 280 },
    });
    expect(placement.side).toBe("bottom");
    expect(placement.top).toBe(82);
    expect(placement.maxHeight).toBe(210);
  });

  it("never reports a negative max height", () => {
    const placement = place({
      viewport: { width: 1120, height: 10 },
      anchor: { top: 0, left: 400, width: 24, height: 20 },
      panel: { width: 200, height: 280 },
    });
    expect(placement.maxHeight).toBe(0);
  });

  it("never reports a max height above the preferred one", () => {
    const placement = place({
      viewport: { width: 1120, height: 4000 },
      panel: { width: 200, height: 3000 },
    });
    expect(placement.maxHeight).toBe(PANEL_MAX_HEIGHT);
  });
});

describe("computePlacement — horizontal alignment and clamping", () => {
  it("aligns the panel's left edge to the anchor's left edge with align: start", () => {
    expect(place({ align: "start" }).left).toBe(400);
  });

  it("aligns the panel's right edge to the anchor's right edge with align: end", () => {
    // 400 + 24 (anchor right) − 200 (panel width).
    expect(place({ align: "end" }).left).toBe(224);
  });

  it("clamps a right overflow back inside the viewport", () => {
    const placement = place({
      align: "start",
      anchor: { top: 100, left: 1000, width: 24, height: 24 },
      panel: { width: 240, height: 100 },
    });
    // 1120 − 240 − 8, not the 1000 the anchor asked for.
    expect(placement.left).toBe(872);
  });

  it("clamps the sidebar's left overflow — a 240px panel end-aligned at x=208", () => {
    const placement = place({
      align: "end",
      anchor: PROFILE_TRIGGER,
      panel: { width: 240, height: 100 },
    });
    // Right-anchoring would have put this at −32, off the left edge, silently.
    expect(placement.left).toBe(EDGE_MARGIN);
  });

  it("clamps to the margin rather than inverting when the panel is wider than the viewport", () => {
    const placement = place({
      viewport: { width: 200, height: 681 },
      panel: { width: 240, height: 100 },
    });
    expect(placement.left).toBe(EDGE_MARGIN);
  });

  it("emits left/top only — a right-anchored panel is what hides a left overflow", () => {
    expect(Object.keys(place()).sort()).toEqual(["left", "maxHeight", "side", "top"]);
  });
});

describe("computePlacement — the reported defect", () => {
  /**
   * „Profil: Luka“ at the foot of the sidebar, single account, shipped window.
   * The trigger's bottom edge lands at 627 against a 681px viewport, so the old
   * arithmetic (`top: rect.bottom + 2`, no height, no flip) put a ~104px panel
   * at 629–733 — its „Napravi poslovni profil…“ row entirely below the edge.
   */
  it("opens the shipped profile switcher upward, fully inside the viewport", () => {
    const panel = { width: 240, height: 104 };
    const placement = place({ anchor: PROFILE_TRIGGER, panel });
    expect(placement.side).toBe("top");
    expect(placement.top).toBe(493);
    expect(placement.top + panel.height).toBeLessThanOrEqual(SHIPPED_VIEWPORT.height);
    // And the same call fixes the second fault: a 240px panel right-anchored to
    // an element ending at x=208 used to hang 32px off the LEFT edge too.
    expect(placement.left).toBe(EDGE_MARGIN);
  });
});
