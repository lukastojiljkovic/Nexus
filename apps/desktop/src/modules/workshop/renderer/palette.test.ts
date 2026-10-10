import { describe, expect, it } from "vitest";

import { GERBER_ROLES } from "@nexus/core";
import { ACCENT_IDS, accents, themes } from "@nexus/tokens";
import { layerColour, withLayerColour } from "./palette.js";

/**
 * The colours this module puts on a workbench. There is no raw value to assert
 * here - every one of them is read from `@nexus/tokens`, which is the point of
 * the file - so what is pinned is the PROPERTIES the palette has to have: every
 * role has a colour, the top and the bottom of one function are never the same
 * colour, and the SVG edit adds exactly one attribute.
 */

describe("layerColour", () => {
  it("answers the accent palette's own value for every role the union has", () => {
    // The mapping itself, stated against the tokens rather than against a copy
    // of their values: copper is the first accent, and every role is one of the
    // eight, in the order `GERBER_ROLES` declares.
    const palette = ACCENT_IDS.map((id) => accents.dan[id].accent);
    expect(layerColour("copper-top", "dan")).toBe(palette[0]);
    expect(layerColour("copper-bottom", "dan")).toBe(palette[1]);
    for (const role of GERBER_ROLES) {
      expect(palette, role).toContain(layerColour(role, "dan"));
    }
  });

  it("follows the theme, so a layer reads on the surface it is drawn on", () => {
    // Noć's accents are the LIGHT ends of the ramps, for the dark background,
    // and Dan's are the dark ends: the same role is a different value in each.
    expect(layerColour("copper-top", "noc")).toBe(accents.noc.zlato.accent);
    expect(layerColour("copper-top", "dan")).not.toBe(layerColour("copper-top", "noc"));
  });

  it("never gives the top and the bottom of one function the same colour", () => {
    // The pair a viewer is most often asked to tell apart.
    for (const [top, bottom] of [
      ["copper-top", "copper-bottom"],
      ["mask-top", "mask-bottom"],
      ["silk-top", "silk-bottom"],
      ["paste-top", "paste-bottom"],
    ] as const) {
      for (const theme of ["dan", "noc"] as const) {
        expect(layerColour(top, theme), `${theme}:${top}`).not.toBe(layerColour(bottom, theme));
      }
    }
  });
});

describe("withLayerColour", () => {
  it("adds one style attribute to the root element", () => {
    const colour = themes.dan.data;
    const svg = '<svg version="1.1" width="3mm"><g fill="currentColor"></g></svg>';
    expect(withLayerColour(svg, colour)).toBe(
      `<svg version="1.1" width="3mm" style="color: ${colour}"><g fill="currentColor"></g></svg>`,
    );
  });

  it("answers anything that is not an SVG element unchanged", () => {
    const colour = themes.dan.data;
    expect(withLayerColour("", colour)).toBe("");
    expect(withLayerColour("not markup at all", colour)).toBe("not markup at all");
    expect(withLayerColour("<svg", colour)).toBe("<svg");
  });
});
