import { describe, expect, it } from "vitest";

import { matrixBox } from "./CellMatrix.js";

/**
 * The band edges. A heatmap is n cells and n-1 gaps, and the off-by-one gap is
 * invisible on screen — a matrix drawn with a trailing gap still looks like a
 * matrix, just very slightly the wrong scale inside its `viewBox`.
 */
describe("matrixBox", () => {
  it("counts n cells and n-1 gaps, never a trailing gap", () => {
    // The house size: 13px cells, 3px gaps, a 7-day week.
    expect(matrixBox(7, 3, 13, 3)).toEqual({ step: 16, width: 7 * 16 - 3, height: 3 * 16 - 3 });
  });

  it("puts the last cell's far edge exactly on the box's edge", () => {
    const { step, width, height } = matrixBox(53, 7, 13, 3);
    // A cell's origin is `index * step`; its far edge is that plus `size`.
    expect((53 - 1) * step + 13).toBe(width);
    expect((7 - 1) * step + 13).toBe(height);
  });

  it("is a single cell with no gap at all when there is one of each", () => {
    expect(matrixBox(1, 1, 13, 3)).toEqual({ step: 16, width: 13, height: 13 });
  });

  it("never returns a zero-sized box, which a browser refuses to draw", () => {
    // An empty matrix reaches here whenever the caller has rows but no columns
    // yet — a term with no days in it, a habit list still loading.
    expect(matrixBox(0, 0, 13, 3)).toEqual({ step: 16, width: 1, height: 1 });
    expect(matrixBox(0, 5, 13, 3).width).toBe(1);
    expect(matrixBox(5, 0, 13, 3).height).toBe(1);
  });

  it("carries the gap into the step, so a gapless matrix is a solid block", () => {
    expect(matrixBox(4, 2, 10, 0)).toEqual({ step: 10, width: 40, height: 20 });
  });
});
