import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { ACCENT_IDS, accents, themes } from "@nexus/tokens";
import { describe, expect, it } from "vitest";

import {
  CANVAS_BACKGROUND,
  CANVAS_CARD_FILL,
  CANVAS_CARD_STROKE,
  CANVAS_DARK_FILTER,
  CANVAS_INK,
  canvasAppState,
  canvasSwatchColour,
  migrateElementColours,
  toCanvasPalette,
} from "./canvasPalette.js";
import { CANVAS_INK_ID, CANVAS_SWATCHES } from "./canvasTools.js";

/**
 * The rule under test is one sentence: every colour handed to Excalidraw is a
 * DAN colour, in both themes, because Excalidraw inverts the whole canvas
 * itself under its dark theme. Feeding it Noć's palette meant inverting twice.
 */

describe("canvasPalette — everything handed to the editor is a Dan value", () => {
  it("draws its four fixed colours from the Dan theme", () => {
    expect(CANVAS_INK).toBe(themes.dan.text);
    expect(CANVAS_BACKGROUND).toBe(themes.dan.bg);
    expect(CANVAS_CARD_STROKE).toBe(themes.dan.border);
    expect(CANVAS_CARD_FILL).toBe(themes.dan.surface);
  });

  it("never returns a Noć colour for any swatch", () => {
    const nocValues = new Set<string>([
      themes.noc.text,
      themes.noc.bg,
      themes.noc.border,
      themes.noc.surface,
      ...ACCENT_IDS.map((id) => accents.noc[id].accent),
    ]);
    for (const id of CANVAS_SWATCHES) {
      expect(nocValues.has(canvasSwatchColour(id))).toBe(false);
    }
  });

  it("gives every swatch the matching Dan accent, and the ink swatch the ink", () => {
    expect(canvasSwatchColour(CANVAS_INK_ID)).toBe(themes.dan.text);
    for (const id of ACCENT_IDS) {
      expect(canvasSwatchColour(id)).toBe(accents.dan[id].accent);
    }
  });

  it("offers one swatch per accent plus the ink, and no duplicates", () => {
    expect(CANVAS_SWATCHES).toHaveLength(ACCENT_IDS.length + 1);
    expect(new Set(CANVAS_SWATCHES.map(canvasSwatchColour)).size).toBe(CANVAS_SWATCHES.length);
  });
});

describe("canvasPalette — boards drawn before the rule existed", () => {
  it("rewrites every Noć value this app could have written", () => {
    expect(toCanvasPalette(themes.noc.text)).toBe(themes.dan.text);
    expect(toCanvasPalette(themes.noc.bg)).toBe(themes.dan.bg);
    expect(toCanvasPalette(themes.noc.border)).toBe(themes.dan.border);
    expect(toCanvasPalette(themes.noc.surface)).toBe(themes.dan.surface);
    for (const id of ACCENT_IDS) {
      expect(toCanvasPalette(accents.noc[id].accent)).toBe(accents.dan[id].accent);
    }
  });

  it("matches the way the toolbar compares colours — trimmed and case-insensitive", () => {
    expect(toCanvasPalette(`  ${themes.noc.text.toUpperCase()} `)).toBe(themes.dan.text);
  });

  it("leaves a colour it does not recognise exactly as it found it", () => {
    // "transparent" is a CSS keyword and Excalidraw's own default fill; an
    // eyedropped or pasted colour is equally none of our business.
    //
    // The unrecognised one is written WITHOUT its `#`, the way
    // `canvasTools.test.ts` writes its own: what is under test is a map lookup
    // over strings, and a real colour literal anywhere in this repo's source is
    // exactly what the raw-colour gate forbids.
    expect(toCanvasPalette("transparent")).toBe("transparent");
    expect(toCanvasPalette("AABBCC")).toBe("AABBCC");
  });

  it("returns the SAME element object when nothing needed correcting", () => {
    // Identity, not equality: a new object per element would bump the scene
    // version and re-save every board that was already correct.
    const element = { strokeColor: themes.dan.text, backgroundColor: "transparent", x: 1 };
    expect(migrateElementColours(element)).toBe(element);
  });

  it("corrects both colour fields and touches nothing else", () => {
    const element = {
      strokeColor: themes.noc.text,
      backgroundColor: accents.noc.bordo.accent,
      x: 12,
      seed: 7,
    };
    expect(migrateElementColours(element)).toEqual({
      strokeColor: themes.dan.text,
      backgroundColor: accents.dan.bordo.accent,
      x: 12,
      seed: 7,
    });
  });

  it("ignores a colour field that is not a string", () => {
    const element = { strokeColor: null, backgroundColor: 42 };
    expect(migrateElementColours(element)).toBe(element);
  });
});

describe("canvasAppState — what a stored board is allowed to keep", () => {
  it("always imposes the theme's background, whatever the board remembered", () => {
    expect(canvasAppState({ viewBackgroundColor: themes.noc.bg }).viewBackgroundColor).toBe(
      CANVAS_BACKGROUND,
    );
    // Even a colour from neither palette (written without its `#` — see the
    // note on the unrecognised-colour test above): nothing could have set it,
    // so it is not a preference being overruled.
    expect(canvasAppState({ viewBackgroundColor: "AABBCC" }).viewBackgroundColor).toBe(
      CANVAS_BACKGROUND,
    );
  });

  it("keeps the user's live colour pick, corrected rather than reset", () => {
    const state = canvasAppState({
      currentItemStrokeColor: accents.noc.suma.accent,
      currentItemBackgroundColor: themes.noc.surface,
    });
    expect(state.currentItemStrokeColor).toBe(accents.dan.suma.accent);
    expect(state.currentItemBackgroundColor).toBe(themes.dan.surface);
  });

  it("falls back to ink and no fill when a board predates those fields", () => {
    const state = canvasAppState({});
    expect(state.currentItemStrokeColor).toBe(CANVAS_INK);
    expect(state.currentItemBackgroundColor).toBe("transparent");
  });

  it("passes every non-colour field through untouched", () => {
    const state = canvasAppState({ zoom: { value: 2 }, scrollX: -40, gridSize: null });
    expect(state.zoom).toEqual({ value: 2 });
    expect(state.scrollX).toBe(-40);
    expect(state.gridSize).toBeNull();
  });
});

describe("canvasPalette — the assumption this whole module rests on", () => {
  /**
   * `CANVAS_DARK_FILTER` is a copy of a value that lives inside a dependency.
   * If an Excalidraw upgrade changes it, our swatch dots and the canvas quietly
   * stop agreeing — the exact defect this module exists to close — and nothing
   * else in the repo would notice. So the value is read back out of the
   * stylesheet the app actually ships.
   */
  it("still matches the filter @excalidraw/excalidraw applies to a dark canvas", () => {
    // The package root is reached through the entry rather than by naming a
    // path, because the stylesheet's own export (`./index.css`) is declared
    // only under the development/production conditions and Node's resolver
    // supplies neither.
    //
    // `dist/prod` specifically, and not because it is more convenient: the
    // `dev` stylesheet does not define `--theme-filter` at all, so dark theming
    // is a property of the production build — which is the one electron-vite
    // resolves and the one that ships.
    const require = createRequire(import.meta.url);
    const css = readFileSync(
      join(dirname(dirname(require.resolve("@excalidraw/excalidraw"))), "prod/index.css"),
      "utf8",
    );
    // Whitespace and a rule's trailing semicolon are not what is being
    // asserted, and both sides of every comparison go through this.
    const compact = (text: string): string => text.replace(/\s+/g, "").replace(/;\}/g, "}");

    expect(compact(css)).toContain(compact(`--theme-filter: ${CANVAS_DARK_FILTER}`));
    expect(compact(css)).toContain(compact(".excalidraw.theme--dark canvas { filter: var(--theme-filter) }"));
  });
});
