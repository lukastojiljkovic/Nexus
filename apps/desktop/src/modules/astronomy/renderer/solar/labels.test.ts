import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import type { BodyId } from "@nexus/core";

import {
  LABEL_GAP_PX,
  LABEL_HEIGHT_PX,
  LABEL_STACK_GAP_PX,
  placeLabels,
  type LabelAnchor,
  type LabelBox,
  type LabelPlacement,
  type LabelViewport,
} from "./labels.js";

/**
 * The label arithmetic, pinned by values.
 *
 * Two oracles. The first is the offset itself: a label beside a body sits at
 * `anchor.x + radius + LABEL_GAP_PX` and is centred on the body's height, so a
 * body at (100, 200) with a 10px disc puts its label's box at (118, 191). The
 * second is the push: an occupied box sends the next one down by exactly
 * `LABEL_HEIGHT_PX + LABEL_STACK_GAP_PX` = 22px.
 *
 * The property the brief names — a label never covers the body it names — is
 * asserted as a DISTANCE between the body's centre and the label's nearest
 * point, which is the only formulation that cannot be satisfied by accident.
 */

const VIEWPORT: LabelViewport = { width: 800, height: 600 };

function anchor(id: BodyId, x: number, y: number, radiusPx: number, widthPx: number): LabelAnchor {
  return { id, x, y, radiusPx, widthPx };
}

function boxOf(placement: LabelPlacement): LabelBox {
  return placement.box;
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The distance from a body's centre to the nearest point of the label's rectangle. */
function clearance(placement: LabelPlacement, source: LabelAnchor): number {
  const box = boxOf(placement);
  const x = Math.min(Math.max(source.x, box.x), box.x + box.width);
  const y = Math.min(Math.max(source.y, box.y), box.y + box.height);
  return Math.hypot(x - source.x, y - source.y);
}

describe("placeLabels", () => {
  it("puts a lone label beside its body, one gap clear of the disc, centred on it", () => {
    const source = anchor("earth", 100, 200, 10, 64);
    const [placement] = placeLabels([source], VIEWPORT);
    if (placement === undefined) throw new Error("no placement");
    expect(placement.box).toEqual({
      id: "earth",
      x: 100 + 10 + LABEL_GAP_PX,
      y: 200 - LABEL_HEIGHT_PX / 2,
      width: 64,
      height: LABEL_HEIGHT_PX,
    });
  });

  it("stacks labels that want the same place, 22px apart", () => {
    const placements = placeLabels(
      [
        anchor("earth", 100, 100, 10, 64),
        anchor("mars", 100, 100, 10, 64),
        anchor("venus", 100, 100, 10, 64),
      ],
      VIEWPORT,
    );
    const y = new Map(placements.map((placement) => [placement.id, placement.box.y]));
    const step = LABEL_HEIGHT_PX + LABEL_STACK_GAP_PX;
    // Ordered by id among bodies at the same height: earth, mars, venus.
    expect(y.get("earth")).toBe(100 - LABEL_HEIGHT_PX / 2);
    expect(y.get("mars")).toBe(100 - LABEL_HEIGHT_PX / 2 + step);
    expect(y.get("venus")).toBe(100 - LABEL_HEIGHT_PX / 2 + 2 * step);
    for (const placement of placements) expect(placement.box.x).toBe(100 + 10 + LABEL_GAP_PX);
  });

  it("flips to the body's other side rather than leaving the viewport", () => {
    const viewport: LabelViewport = { width: 200, height: 100 };
    const source = anchor("neptune", 190, 50, 5, 64);
    const [placement] = placeLabels([source], viewport);
    if (placement === undefined) throw new Error("no placement");
    // Right would end at 267px on a 200px screen; left ends at 177px.
    expect(placement.box.x).toBe(190 - 5 - LABEL_GAP_PX - 64);
    expect(placement.box.y).toBe(50 - LABEL_HEIGHT_PX / 2);
  });

  it("gives up on the viewport rather than on clearing the body", () => {
    // 100px of label in a 120px screen with a body in the middle: no side fits,
    // and the fallback is the first candidate unclamped — a label over the edge
    // is readable, a label over its own planet is not.
    const viewport: LabelViewport = { width: 120, height: 100 };
    const source = anchor("pluto", 10, 50, 3, 100);
    const [placement] = placeLabels([source], viewport);
    if (placement === undefined) throw new Error("no placement");
    expect(placement.box.x).toBe(10 + 3 + LABEL_GAP_PX);
    expect(clearance(placement, source)).toBeGreaterThan(source.radiusPx);
  });

  it("never covers a body, wherever the body is and however big it is", () => {
    const anchors = [
      anchor("sun", 400, 300, 90, 48),
      anchor("mercury", 5, 5, 3, 72),
      anchor("venus", 795, 300, 40, 60),
      anchor("earth", 400, 595, 20, 64),
      anchor("moon", 400, 2, 20, 64),
      anchor("mars", 10, 590, 12, 64),
      anchor("jupiter", 790, 10, 30, 64),
    ];
    const placements = placeLabels(anchors, VIEWPORT);
    expect(placements).toHaveLength(anchors.length);
    const byId = new Map(placements.map((placement) => [placement.id, placement]));
    for (const source of anchors) {
      const placement = byId.get(source.id);
      if (placement === undefined) throw new Error("no placement");
      expect(clearance(placement, source)).toBeGreaterThan(source.radiusPx);
    }
  });

  it("keeps two labels apart", () => {
    const anchors = [
      anchor("earth", 200, 200, 10, 64),
      anchor("mars", 200, 200, 10, 64),
      anchor("venus", 200, 200, 10, 64),
      anchor("mercury", 200, 200, 10, 64),
    ];
    const placements = placeLabels(anchors, VIEWPORT);
    for (const a of placements) {
      for (const b of placements) {
        if (a.id === b.id) continue;
        expect(overlaps(a.box, b.box)).toBe(false);
      }
    }
  });

  it("is a function of the SET, not of the caller's order", () => {
    const anchors = [
      anchor("earth", 300, 250, 12, 64),
      anchor("mars", 305, 251, 12, 64),
      anchor("venus", 298, 248, 12, 64),
    ];
    const forwards = placeLabels(anchors, VIEWPORT);
    const backwards = placeLabels([...anchors].reverse(), VIEWPORT);
    expect(backwards).toEqual(forwards);
    expect(placeLabels(anchors, VIEWPORT)).toEqual(forwards);
  });
});

describe("the stylesheet", () => {
  it("keeps the label's own height equal to the placement's constant", () => {
    const css = readFileSync(new URL("./solar.css", import.meta.url), "utf8");
    const rule = /\.solar__label\s*\{([^}]*)\}/.exec(css);
    if (rule === null) throw new Error("the .solar__label rule is missing from solar.css");
    // The placement arithmetic assumes a fixed label height; a stylesheet that
    // drifted would put boxes 18px tall where the DOM draws something else, and
    // the labels would overlap while every other test stayed green.
    const declarations = rule[1] ?? "";
    expect(declarations).toMatch(new RegExp(`height:\\s*${String(LABEL_HEIGHT_PX)}px`));
  });
});
