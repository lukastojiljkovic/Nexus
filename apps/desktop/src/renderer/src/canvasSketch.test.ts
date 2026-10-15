import { describe, expect, it } from "vitest";
import { CANVAS_SKETCH_TONES, parseCanvasSketch } from "@nexus/core";
import { CANVAS_INK, canvasSwatchColour } from "./canvasPalette.js";
import { CANVAS_SWATCHES } from "./canvasTools.js";
import { freeSpaceOrigin, sketchSkeleton } from "./canvasSketch.js";

const sketch = parseCanvasSketch({
  title: "Order",
  layout: "column",
  nodes: [
    { id: "cart", label: "Cart" },
    { id: "pay", label: "Pay", shape: "diamond", tone: "ruza" },
    { id: "note", label: "Only text", shape: "text" },
  ],
  edges: [
    { from: "cart", to: "pay", label: "submit" },
    { from: "pay", to: "note" },
  ],
});

describe("sketchSkeleton", () => {
  const skeleton = sketchSkeleton(sketch, { x: 500, y: 40 });

  it("puts the title above the diagram and the boxes below it, offset by the origin", () => {
    expect(skeleton[0]).toEqual({ type: "text", x: 500, y: 40, text: "Order", fontSize: 28 });
    const cart = skeleton.find((element) => element.id === "box:cart");
    expect(cart).toMatchObject({ type: "rectangle", x: 500, y: 100, width: 200, height: 80 });
    expect(cart).toMatchObject({ label: { text: "Cart" } });
  });

  it("draws a diamond in the tone it names and a plain box in the ink", () => {
    const pay = skeleton.find((element) => element.id === "box:pay");
    expect(pay).toMatchObject({ type: "diamond", strokeColor: canvasSwatchColour("ruza") });
    const cart = skeleton.find((element) => element.id === "box:cart");
    expect(cart).toMatchObject({ strokeColor: CANVAS_INK, backgroundColor: "transparent" });
  });

  it("binds an arrow to the boxes it joins, and leaves a text box unbound", () => {
    const arrows = skeleton.filter((element) => element.type === "arrow");
    expect(arrows).toHaveLength(2);
    expect(arrows[0]).toMatchObject({ start: { id: "box:cart" }, end: { id: "box:pay" }, label: { text: "submit" } });
    expect(arrows[1]).not.toHaveProperty("end");
    expect(arrows[1]).toMatchObject({ start: { id: "box:pay" } });
  });

  it("gives a text box no border and keeps every id unique", () => {
    const label = skeleton.find((element) => element.id === "box:note");
    expect(label).toMatchObject({ type: "text", text: "Only text" });
    const ids = skeleton.map((element) => element.id).filter((id) => id !== undefined);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("freeSpaceOrigin", () => {
  const element = (x: number, y: number, width: number, height: number, isDeleted = false) => ({
    x,
    y,
    width,
    height,
    isDeleted,
  });

  it("starts at the origin on an empty board", () => {
    expect(freeSpaceOrigin([])).toEqual({ x: 0, y: 0 });
  });

  it("sits to the right of the furthest live element, level with the highest one", () => {
    expect(freeSpaceOrigin([element(0, 50, 200, 100), element(300, 20, 100, 40)])).toEqual({
      x: 520,
      y: 20,
    });
  });

  it("ignores deleted elements, so they do not push a sketch away", () => {
    expect(freeSpaceOrigin([element(900, 0, 200, 100, true)])).toEqual({ x: 0, y: 0 });
  });
});

describe("the sketch's colours", () => {
  it("are the board's own palette, id for id", () => {
    expect([...CANVAS_SKETCH_TONES]).toEqual([...CANVAS_SWATCHES]);
  });
});
