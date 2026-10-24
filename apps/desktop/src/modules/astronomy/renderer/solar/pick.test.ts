import { describe, expect, it } from "vitest";

import { MIN_PICK_RADIUS_PX, pickAnchor, type PickAnchor } from "./pick.js";

/**
 * Pointer hits on projected bodies, pinned by pixels.
 *
 * A body in true scale is a sphere of a pixel or less, so the hit disc is the
 * minimum radius, not the drawn one. The depth decides between overlapping discs:
 * the body nearer the camera is the one the user sees.
 */

const EARTH: PickAnchor<"earth"> = { id: "earth", x: 100, y: 100, radiusPx: 0.4, depth: 150 };

describe("pickAnchor", () => {
  it("hits a tiny body anywhere inside its minimum disc", () => {
    expect(pickAnchor([EARTH], 100 + MIN_PICK_RADIUS_PX - 1, 100, MIN_PICK_RADIUS_PX)).toBe("earth");
    expect(pickAnchor([EARTH], 100, 100 - MIN_PICK_RADIUS_PX + 1, MIN_PICK_RADIUS_PX)).toBe("earth");
  });

  it("misses outside every disc", () => {
    expect(pickAnchor([EARTH], 100 + MIN_PICK_RADIUS_PX + 1, 100, MIN_PICK_RADIUS_PX)).toBeNull();
  });

  it("uses the drawn radius when the body is larger than the minimum", () => {
    const sun: PickAnchor<"sun"> = { id: "sun", x: 0, y: 0, radiusPx: 40, depth: 1000 };
    expect(pickAnchor([sun], 35, 0, MIN_PICK_RADIUS_PX)).toBe("sun");
    expect(pickAnchor([sun], 45, 0, MIN_PICK_RADIUS_PX)).toBeNull();
  });

  it("gives a small planet in front of the Sun's disc to the planet", () => {
    const sun: PickAnchor<"sun"> = { id: "sun", x: 100, y: 100, radiusPx: 50, depth: 1000 };
    const mercury: PickAnchor<"mercury"> = { id: "mercury", x: 110, y: 100, radiusPx: 0.2, depth: 400 };
    expect(pickAnchor([sun, mercury], 110, 100, MIN_PICK_RADIUS_PX)).toBe("mercury");
  });

  it("gives the Sun to the Sun when the planet is behind it", () => {
    const sun: PickAnchor<"sun"> = { id: "sun", x: 100, y: 100, radiusPx: 50, depth: 1000 };
    const behind: PickAnchor<"earth"> = { id: "earth", x: 110, y: 100, radiusPx: 0.2, depth: 1500 };
    expect(pickAnchor([behind, sun], 110, 100, MIN_PICK_RADIUS_PX)).toBe("sun");
  });

  it("answers null for an empty list", () => {
    expect(pickAnchor([], 0, 0, MIN_PICK_RADIUS_PX)).toBeNull();
  });
});
