import { describe, expect, it } from "vitest";
import { isLayerVisible, layerColourCss, layerReducer, type LayerState } from "./layers.js";

/**
 * The layer state machine, and the one colour rule in the renderer.
 *
 * A drawing shows everything until the user hides something, so the state is a
 * record of what has been TURNED OFF - which is why the interesting cases here
 * are the two whole-list actions and the toggle that has to return to nothing.
 */

describe("layerReducer", () => {
  it("starts from nothing hidden and hides one layer at a time", () => {
    const first = layerReducer({}, { type: "toggle", name: "KONSTRUKCIJA" });
    expect(first).toEqual({ KONSTRUKCIJA: false });
    // A second layer joins the record rather than replacing it.
    const second = layerReducer(first, { type: "toggle", name: "0" });
    expect(second).toEqual({ KONSTRUKCIJA: false, "0": false });
  });

  it("toggling twice returns to the drawing as it arrived", () => {
    // Back to the EMPTY record, not to an explicit `KONSTRUKCIJA: true`: absent
    // is the state that means "as the file has it", and a record that kept
    // growing would make `showAll` unable to restore it.
    const on = layerReducer({}, { type: "toggle", name: "KONSTRUKCIJA" });
    expect(layerReducer(on, { type: "toggle", name: "KONSTRUKCIJA" })).toEqual({});
  });

  it("hides everything by name, and shows everything by forgetting", () => {
    const hidden = layerReducer({}, { type: "hideAll", names: ["0", "KONSTRUKCIJA"] });
    expect(hidden).toEqual({ "0": false, KONSTRUKCIJA: false });
    expect(layerReducer(hidden, { type: "showAll" })).toEqual({});
  });

  it("never mutates the state it was given", () => {
    const before: LayerState = { KONSTRUKCIJA: false };
    const after = layerReducer(before, { type: "toggle", name: "0" });
    expect(before).toEqual({ KONSTRUKCIJA: false });
    expect(after).not.toBe(before);
  });
});

describe("isLayerVisible", () => {
  it("draws a layer the state has never mentioned", () => {
    expect(isLayerVisible({}, "KONSTRUKCIJA")).toBe(true);
    expect(isLayerVisible({ KONSTRUKCIJA: false }, "KONSTRUKCIJA")).toBe(false);
    expect(isLayerVisible({ KONSTRUKCIJA: false }, "0")).toBe(true);
  });
});

describe("layerColourCss", () => {
  it("prints the drawing's own 24-bit colour, three digits at a time", () => {
    // 0x123456 -> r 18, g 52, b 86.
    expect(layerColourCss(0x123456)).toBe("rgb(18 52 86)");
    expect(layerColourCss(0xff0000)).toBe("rgb(255 0 0)");
    expect(layerColourCss(0x00ff00)).toBe("rgb(0 255 0)");
    expect(layerColourCss(0x0000ff)).toBe("rgb(0 0 255)");
    // What the library reports for a layer whose colour is AutoCAD's index 7.
    expect(layerColourCss(0xffffff)).toBe("rgb(255 255 255)");
  });
});
