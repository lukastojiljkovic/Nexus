import { describe, expect, it } from "vitest";
import {
  CANVAS_SCENE_TYPE,
  MAX_CANVAS_SCENE_LENGTH,
  emptyCanvasScene,
  parseCanvasScene,
  serializeCanvasScene,
  validateCanvasScene,
} from "./canvasScene.js";

/** A plausible `serializeAsJSON` envelope; the element is deliberately NOT a real one — nothing here validates elements. */
function scene(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements: [{ id: "a", type: "rectangle" }],
    appState: { gridSize: null, objectsSnapModeEnabled: true },
    files: {},
    ...overrides,
  };
}

describe("validateCanvasScene", () => {
  it("accepts a well-formed envelope and answers a canonical copy of it", () => {
    const raw = scene();
    const parsed = validateCanvasScene(raw);
    expect(parsed).toEqual({
      type: CANVAS_SCENE_TYPE,
      version: 2,
      source: "https://excalidraw.com",
      elements: [{ id: "a", type: "rectangle" }],
      appState: { gridSize: null, objectsSnapModeEnabled: true },
      files: {},
    });
    // A COPY: a caller mutating what it handed in must not reach into a scene
    // this function already vouched for.
    (raw.elements as unknown[]).push({ id: "b" });
    expect(parsed?.elements).toHaveLength(1);
  });

  it("keeps every appState key it is given — a preference we dropped is one the user set and lost", () => {
    const parsed = validateCanvasScene(
      scene({ appState: { gridSize: 20, gridStep: 5, objectsSnapModeEnabled: false } }),
    );
    expect(parsed?.appState).toEqual({ gridSize: 20, gridStep: 5, objectsSnapModeEnabled: false });
  });

  it("carries embedded files through untouched — the images ARE the drawing", () => {
    const files = { "file-1": { mimeType: "image/png", dataURL: "data:image/png;base64,AAA" } };
    expect(validateCanvasScene(scene({ files }))?.files).toEqual(files);
  });

  it.each([
    ["a non-object", 42],
    ["null", null],
    ["an array", [] as unknown],
    ["the wrong type tag", scene({ type: "excalidraw-library" })],
    ["a missing type tag", scene({ type: undefined })],
    ["a fractional version", scene({ version: 2.5 })],
    ["a zero version", scene({ version: 0 })],
    ["a string version", scene({ version: "2" })],
    ["a non-string source", scene({ source: 7 })],
    ["elements that are not an array", scene({ elements: {} })],
    ["an appState that is an array", scene({ appState: [] })],
    ["a null appState", scene({ appState: null })],
    ["files that are not an object", scene({ files: "none" })],
  ])("refuses %s", (_label, value) => {
    expect(validateCanvasScene(value)).toBeNull();
  });
});

describe("serializeCanvasScene", () => {
  it("fixes the key order, so the same scene always produces the same bytes", () => {
    const first = validateCanvasScene(scene());
    // The very same document with its keys written in a different order.
    const second = validateCanvasScene({
      files: {},
      appState: { gridSize: null, objectsSnapModeEnabled: true },
      elements: [{ id: "a", type: "rectangle" }],
      source: "https://excalidraw.com",
      version: 2,
      type: "excalidraw",
    });
    expect(first).not.toBeNull();
    expect(serializeCanvasScene(first!)).toBe(serializeCanvasScene(second!));
    expect(serializeCanvasScene(first!).startsWith(`{"type":"excalidraw","version":2`)).toBe(true);
  });

  it("round-trips through parseCanvasScene", () => {
    const parsed = validateCanvasScene(scene());
    expect(parseCanvasScene(serializeCanvasScene(parsed!))).toEqual(parsed);
  });
});

describe("parseCanvasScene", () => {
  it("answers null for text that is not JSON at all", () => {
    expect(parseCanvasScene("not json")).toBeNull();
    expect(parseCanvasScene("")).toBeNull();
  });

  it("answers null for JSON of the wrong shape, exactly as for broken JSON", () => {
    expect(parseCanvasScene(JSON.stringify({ hello: "world" }))).toBeNull();
  });

  it("refuses a document past the size ceiling WITHOUT parsing it", () => {
    // Longer than the bound and not valid JSON either: a null here proves the
    // length gate ran first, since parsing would have thrown on this input.
    const oversized = "x".repeat(MAX_CANVAS_SCENE_LENGTH + 1);
    expect(parseCanvasScene(oversized)).toBeNull();
  });

  it("accepts a document right at the ceiling", () => {
    const base = validateCanvasScene(scene({ elements: [], appState: {}, files: {} }));
    const text = serializeCanvasScene(base!);
    expect(text.length).toBeLessThan(MAX_CANVAS_SCENE_LENGTH);
    expect(parseCanvasScene(text)).toEqual(base);
  });
});

describe("emptyCanvasScene", () => {
  it("is a valid scene with nothing on it", () => {
    const empty = emptyCanvasScene();
    expect(validateCanvasScene(empty)).toEqual(empty);
    expect(empty.elements).toEqual([]);
  });

  it("hands back a FRESH document each time — one board's first stroke is not every board's", () => {
    const first = emptyCanvasScene();
    const second = emptyCanvasScene();
    expect(first).not.toBe(second);
    first.elements.push({ id: "a" });
    expect(second.elements).toEqual([]);
  });
});
