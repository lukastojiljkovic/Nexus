import { describe, expect, it } from "vitest";

import { ACCENT_IDS, accents, themes } from "@nexus/tokens";
import { boardPalette } from "./palette.js";

/**
 * The board palette (ADR-090): every colour is a token's own value for the theme
 * on screen, and nothing is invented here.
 *
 * The assertions are equalities against `@nexus/tokens` rather than against
 * strings, which is the whole rule: a board that spelled a colour would fail the
 * colour gate, and a board that resolved the wrong theme's token would fail the
 * first test below.
 */

describe("boardPalette", () => {
  it("reads each role out of the theme it was asked for", () => {
    const dan = boardPalette("dan", "zlato");
    const noc = boardPalette("noc", "zlato");

    expect(dan.ground).toBe(themes.dan.surfaceSunken);
    expect(dan.grid).toBe(themes.dan.borderSubtle);
    expect(dan.frame).toBe(themes.dan.border);
    expect(dan.ink).toBe(themes.dan.text);
    expect(dan.muted).toBe(themes.dan.textMuted);
    expect(dan.data).toBe(themes.dan.data);
    expect(dan.dataSoft).toBe(themes.dan.dataSoft);
    expect(dan.danger).toBe(themes.dan.danger);
    expect(dan.surface).toBe(themes.dan.surface);
    expect(dan.surfaceAlt).toBe(themes.dan.surfaceAlt);

    // The other theme is a different set of values, which is what makes a
    // repaint on a theme switch visible at all.
    expect(noc.ground).toBe(themes.noc.surfaceSunken);
    expect(noc.ink).toBe(themes.noc.text);
    expect(noc.ground).not.toBe(dan.ground);
    expect(noc.ink).not.toBe(dan.ink);
  });

  it("takes the three accent slots from the active accent", () => {
    for (const accent of ACCENT_IDS) {
      const palette = boardPalette("dan", accent);
      expect(palette.accent, accent).toBe(accents.dan[accent].accent);
      expect(palette.accentSoft, accent).toBe(accents.dan[accent].accentSoft);
      expect(palette.accentStrong, accent).toBe(accents.dan[accent].accentStrong);
      expect(boardPalette("noc", accent).accent, accent).toBe(accents.noc[accent].accent);
    }
  });

  it("gives the seven piece colours from the accent palette, distinguishable and theme-correct", () => {
    const palette = boardPalette("dan", "bordo");
    expect(palette.pieces).toHaveLength(7);
    expect(palette.pieces).toEqual(
      ACCENT_IDS.slice(0, 7).map((id) => accents.dan[id].accent),
    );
    // Seven shapes on one board have to be told apart, so no two may be one
    // value - and the active accent cannot change them, or a piece would move
    // with a settings row.
    expect(new Set(palette.pieces).size).toBe(7);
    expect(boardPalette("dan", "maslina").pieces).toEqual(palette.pieces);
  });

  it("answers every role with something a canvas can paint", () => {
    for (const theme of ["dan", "noc"] as const) {
      const palette = boardPalette(theme, "zlato");
      for (const value of Object.values(palette)) {
        // The seven piece colours are checked above; every other role is one
        // value a `fillStyle` takes.
        if (Array.isArray(value)) continue;
        expect(value, theme).toMatch(/^#|^rgb/);
      }
    }
  });
});
