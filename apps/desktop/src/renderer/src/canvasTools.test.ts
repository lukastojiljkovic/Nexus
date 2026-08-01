import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { ACCENT_IDS } from "@nexus/tokens";
import {
  CANVAS_INK_ID,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  CANVAS_STROKE_WIDTHS,
  CANVAS_STYLE_CHANNELS,
  CANVAS_SWATCHES,
  CANVAS_TOOLS,
  CANVAS_ZOOM_STEP,
  activeCanvasTool,
  activeStrokeWidth,
  canvasStyleTargets,
  canvasSwatchToken,
  canvasToolbarStateOf,
  carriesStrokeColour,
  formatZoomPercent,
  normalizeCanvasZoom,
  sameCanvasColour,
  sameCanvasToolbarState,
  zoomAboutViewportCentre,
  type CanvasToolbarAppState,
  type StyleableElement,
} from "./canvasTools.js";

/**
 * `dist/prod`, always — never whatever the package's `exports` conditions
 * happen to pick. `require.resolve` answers `dist/dev/index.js` under a test
 * runner while the packaged app bundles `dist/prod`; these assertions are about
 * what SHIPS. See `excalidrawSurface.test.ts` for the full note.
 */
const require = createRequire(import.meta.url);

function distProd(): string {
  return join(require.resolve("@excalidraw/excalidraw"), "..", "..", "prod");
}

function typesFile(name: string): string {
  return readFileSync(join(distProd(), "..", "types", "excalidraw", name), "utf8");
}

describe("the tool table", () => {
  /**
   * The point of the whole suite: a rename upstream must fail a TEST, not
   * produce a button that silently does nothing.
   *
   * `setActiveTool` refuses any type outside `ToolType` — `isToolSupported`
   * lets it through but the editor then has no shape for it — so every id this
   * toolbar can emit is checked against the union the installed package
   * declares.
   */
  it("emits only tool ids the installed editor declares in `ToolType`", () => {
    const declared = typesFile("types.d.ts");
    const line = declared.split("\n").find((text) => text.startsWith("export type ToolType ="));
    expect(line, "the ToolType declaration").toBeDefined();
    for (const tool of CANVAS_TOOLS) {
      expect(line, `${tool.id} is a real tool`).toContain(`"${tool.id}"`);
    }
  });

  it("agrees with the editor's own `TOOL_TYPE` map, which is what its shortcuts key off", () => {
    const constants = typesFile("constants.d.ts");
    for (const tool of CANVAS_TOOLS) {
      expect(constants).toContain(`readonly ${tool.id}: "${tool.id}"`);
    }
  });

  it("names each tool once, and names a shortcut for each", () => {
    const ids = CANVAS_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tool of CANVAS_TOOLS) expect(tool.shortcut).not.toBe("");
  });

  it("leaves out the four tools this product has no story for", () => {
    const ids = new Set<string>(CANVAS_TOOLS.map((tool) => tool.id));
    for (const absent of ["frame", "magicframe", "embeddable", "laser"]) {
      expect(ids.has(absent), `${absent} is deliberately not offered`).toBe(false);
    }
  });
});

describe("activeCanvasTool", () => {
  it("reads the editor's own state, which is what makes the keyboard move our highlight", () => {
    expect(activeCanvasTool({ type: "rectangle" })).toBe("rectangle");
    expect(activeCanvasTool({ type: "freedraw" })).toBe("freedraw");
  });

  it("answers null for a tool we do not draw, rather than falling back to „Izbor“", () => {
    // Reachable from the editor's own keyboard handling; a highlight sitting on
    // „Izbor" while the canvas is in frame mode would be a lie.
    expect(activeCanvasTool({ type: "frame" })).toBeNull();
    expect(activeCanvasTool({ type: "laser" })).toBeNull();
    expect(activeCanvasTool({ type: "custom" })).toBeNull();
  });
});

describe("the palette", () => {
  it("is the ink colour plus the eight Nexus accents, in „Izgled“'s order", () => {
    expect(CANVAS_SWATCHES).toEqual([CANVAS_INK_ID, ...ACCENT_IDS]);
    expect(ACCENT_IDS).toHaveLength(8);
  });

  it("resolves every swatch to an `--nx-*` token and never to a literal", () => {
    for (const id of CANVAS_SWATCHES) {
      expect(canvasSwatchToken(id)).toMatch(/^--nx-/);
    }
    expect(canvasSwatchToken(CANVAS_INK_ID)).toBe("--nx-text");
    expect(canvasSwatchToken("bordo")).toBe("--nx-swatch-bordo");
  });

  it("compares colours case-insensitively, so one colour never lights two dots", () => {
    // Opaque values on purpose: what is under test is a string comparison, and
    // a real colour literal anywhere in this repo's own source is exactly what
    // the raw-colour gate forbids.
    expect(sameCanvasColour("AABBCC", "aabbcc")).toBe(true);
    expect(sameCanvasColour(" transparent ", "transparent")).toBe(true);
    expect(sameCanvasColour("AABBCC", "AABBCD")).toBe(false);
  });
});

describe("stroke widths", () => {
  it("are Excalidraw's own three, by value", () => {
    expect(CANVAS_STROKE_WIDTHS.map((width) => width.value)).toEqual([1, 2, 4]);
    const constants = typesFile("constants.d.ts");
    expect(constants).toMatch(
      /STROKE_WIDTH:\s*\{\s*readonly thin:\s*1;\s*readonly bold:\s*2;\s*readonly extraBold:\s*4;/,
    );
  });

  it("marks the matching button, and nothing when the editor is on some other width", () => {
    expect(activeStrokeWidth(1)).toBe("tanko");
    expect(activeStrokeWidth(2)).toBe("srednje");
    expect(activeStrokeWidth(4)).toBe("debelo");
    expect(activeStrokeWidth(3)).toBeNull();
  });
});

describe("carriesStrokeColour", () => {
  it("is the editor's `hasStrokeColor`, restated", () => {
    for (const type of ["rectangle", "ellipse", "arrow", "line", "text", "freedraw", "diamond"]) {
      expect(carriesStrokeColour(type)).toBe(true);
    }
    for (const type of ["image", "frame", "magicframe"]) {
      expect(carriesStrokeColour(type)).toBe(false);
    }
  });

  it("still matches the predicate inside the installed build", () => {
    const bundle = readFileSync(join(distProd(), "index.js"), "utf8");
    // Minified, so the parameter name is not stable — the three excluded types
    // and their order are.
    expect(bundle).toMatch(/!=="image"&&\w+!=="frame"&&\w+!=="magicframe"/);
  });
});

describe("canvasStyleTargets", () => {
  const rect = (id: string, extra: Partial<StyleableElement> = {}): StyleableElement => ({
    id,
    type: "rectangle",
    ...extra,
  });

  it("is empty with nothing selected — choosing a colour must not repaint the drawing", () => {
    const scene = [rect("a"), rect("b")];
    expect(canvasStyleTargets(scene, {}, "stroke").size).toBe(0);
  });

  it("takes exactly what is selected", () => {
    const scene = [rect("a"), rect("b"), rect("c")];
    expect([...canvasStyleTargets(scene, { a: true, c: true }, "background")].sort()).toEqual([
      "a",
      "c",
    ]);
  });

  it("skips a deleted element even when the selection still names it", () => {
    const scene = [rect("a", { isDeleted: true }), rect("b")];
    expect([...canvasStyleTargets(scene, { a: true, b: true }, "background")]).toEqual(["b"]);
  });

  it("carries a stroke change into a container's bound label, as the editor's own action does", () => {
    const scene: StyleableElement[] = [
      rect("box", { boundElements: [{ id: "label", type: "text" }] }),
      { id: "label", type: "text" },
    ];
    expect([...canvasStyleTargets(scene, { box: true }, "stroke")].sort()).toEqual(["box", "label"]);
  });

  it("does NOT carry a fill or a width there — the same distinction upstream draws", () => {
    const scene: StyleableElement[] = [
      rect("box", { boundElements: [{ id: "label", type: "text" }] }),
      { id: "label", type: "text" },
    ];
    expect([...canvasStyleTargets(scene, { box: true }, "background")]).toEqual(["box"]);
    expect([...canvasStyleTargets(scene, { box: true }, "strokeWidth")]).toEqual(["box"]);
    expect(CANVAS_STYLE_CHANNELS.stroke.includeBoundText).toBe(true);
    expect(CANVAS_STYLE_CHANNELS.background.includeBoundText).toBe(false);
    expect(CANVAS_STYLE_CHANNELS.strokeWidth.includeBoundText).toBe(false);
  });

  it("ignores a bound ARROW, which is not a label", () => {
    const scene: StyleableElement[] = [
      rect("box", { boundElements: [{ id: "edge", type: "arrow" }] }),
      { id: "edge", type: "arrow" },
    ];
    expect([...canvasStyleTargets(scene, { box: true }, "stroke")]).toEqual(["box"]);
  });

  it("leaves an image out of a STROKE change only — it has no stroke to change", () => {
    const scene: StyleableElement[] = [{ id: "pic", type: "image" }, rect("box")];
    expect([...canvasStyleTargets(scene, { pic: true, box: true }, "stroke")]).toEqual(["box"]);
    // Upstream's fill and width actions carry no such guard, and neither do we
    // — a property an element ignores is a no-op there too.
    expect([...canvasStyleTargets(scene, { pic: true, box: true }, "strokeWidth")].sort()).toEqual([
      "box",
      "pic",
    ]);
  });
});

describe("zoom", () => {
  it("uses the editor's own bounds and step", () => {
    const constants = typesFile("constants.d.ts");
    expect(constants).toContain(`export declare const ZOOM_STEP = ${CANVAS_ZOOM_STEP}`);
    expect(constants).toContain(`export declare const MIN_ZOOM = ${CANVAS_MIN_ZOOM}`);
    expect(constants).toContain(`export declare const MAX_ZOOM = ${CANVAS_MAX_ZOOM}`);
  });

  it("clamps and rounds exactly as `getNormalizedZoom` does", () => {
    expect(normalizeCanvasZoom(0.05)).toBe(CANVAS_MIN_ZOOM);
    expect(normalizeCanvasZoom(1000)).toBe(CANVAS_MAX_ZOOM);
    expect(normalizeCanvasZoom(1.23456789)).toBe(1.234568);
  });

  it("reads out whole percent", () => {
    expect(formatZoomPercent(1)).toBe("100%");
    expect(formatZoomPercent(0.1)).toBe("10%");
    expect(formatZoomPercent(1.256)).toBe("126%");
  });

  /**
   * The scroll half is the whole point: `zoomCanvas` is not on the imperative
   * API, so zoom is written through `updateScene`, and zoom alone would pin the
   * top-left corner instead of the middle.
   */
  it("keeps the middle of the canvas still", () => {
    const view = { zoom: 1, scrollX: 0, scrollY: 0, width: 800, height: 600 };
    const next = zoomAboutViewportCentre(view, 2);
    expect(next.zoom).toBe(2);
    // Upstream's `getStateForZoom` anchored on the centre reduces to
    // `scroll + (size / 2) * (1 / next - 1 / current)`.
    expect(next.scrollX).toBeCloseTo(400 * (1 / 2 - 1), 10);
    expect(next.scrollY).toBeCloseTo(300 * (1 / 2 - 1), 10);
  });

  it("is its own inverse across a zoom in and back out", () => {
    const view = { zoom: 1, scrollX: 17, scrollY: -3, width: 800, height: 600 };
    const inZoom = zoomAboutViewportCentre(view, 2);
    const back = zoomAboutViewportCentre({ ...view, ...inZoom }, 1);
    expect(back.scrollX).toBeCloseTo(view.scrollX, 10);
    expect(back.scrollY).toBeCloseTo(view.scrollY, 10);
  });

  it("clamps the step rather than running past the editor's own ceiling", () => {
    const view = { zoom: CANVAS_MAX_ZOOM, scrollX: 0, scrollY: 0, width: 800, height: 600 };
    expect(zoomAboutViewportCentre(view, CANVAS_MAX_ZOOM + 5).zoom).toBe(CANVAS_MAX_ZOOM);
  });
});

describe("the toolbar snapshot", () => {
  // Opaque colour values, for the reason the palette suite states: the snapshot
  // only ever carries these strings around, and a literal would trip the gate.
  const appState = (patch: Partial<CanvasToolbarAppState> = {}): CanvasToolbarAppState => ({
    activeTool: { type: "rectangle" },
    currentItemStrokeColor: "stroke-a",
    currentItemBackgroundColor: "transparent",
    currentItemStrokeWidth: 2,
    zoom: { value: 1 },
    ...patch,
  });

  it("carries only what the bar draws", () => {
    expect(canvasToolbarStateOf(appState())).toEqual({
      tool: "rectangle",
      stroke: "stroke-a",
      background: "transparent",
      strokeWidth: 2,
      zoom: 1,
    });
  });

  /**
   * `onChange` fires on every pointer move, so the bar re-renders only when the
   * snapshot genuinely differs — the same cheap-guard-in-front-of-expensive-work
   * shape the autosave's `getSceneVersion` check has.
   */
  it("is unchanged by everything a stroke does, and changed by everything the bar shows", () => {
    const base = canvasToolbarStateOf(appState());
    expect(sameCanvasToolbarState(base, canvasToolbarStateOf(appState()))).toBe(true);

    for (const patch of [
      { activeTool: { type: "ellipse" } },
      { currentItemStrokeColor: "stroke-b" },
      { currentItemBackgroundColor: "fill-b" },
      { currentItemStrokeWidth: 4 },
      { zoom: { value: 1.1 } },
    ] satisfies Partial<CanvasToolbarAppState>[]) {
      expect(sameCanvasToolbarState(base, canvasToolbarStateOf(appState(patch)))).toBe(false);
    }
  });
});
