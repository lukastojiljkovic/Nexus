import { describe, expect, it } from "vitest";

import { textureCredits } from "./credit.js";
import type { PlanetTextures } from "./textures.js";

/**
 * The attribution line the solar view draws.
 *
 * The licence's whole requirement is that the credit is shown WITH the images,
 * so what is pinned here is that the line is the pack's own words, that a
 * sentence several bodies share is printed once, and that the order is the
 * contract's body order rather than whatever order a layout happened to be
 * written in — a line that reshuffled itself between openings reads as a
 * different line.
 */

describe("textureCredits", () => {
  it("collapses the pack's per-body lines into the distinct ones, in body order", () => {
    const layout: PlanetTextures = {
      layout: 1,
      bodies: {
        mars: { day: "images/mars.webp", credit: "Solar System Scope (INOVE) — CC BY 4.0" },
        earth: { day: "images/earth.webp", credit: "NASA Earth Observatory" },
        saturn: { day: "images/saturn.webp", credit: "Solar System Scope (INOVE) — CC BY 4.0" },
      },
    };
    // Earth comes before Mars in `BODY_ORDER`, and the two Solar System Scope
    // bodies share one sentence between them.
    expect(textureCredits(layout)).toEqual([
      "NASA Earth Observatory",
      "Solar System Scope (INOVE) — CC BY 4.0",
    ]);
  });

  it("answers nothing for no pack, and skips an empty line rather than printing it", () => {
    expect(textureCredits(null)).toEqual([]);
    expect(
      textureCredits({ layout: 1, bodies: { venus: { day: "images/venus.webp", credit: "   " } } }),
    ).toEqual([]);
    expect(textureCredits({ layout: 1, bodies: {} })).toEqual([]);
  });
});
