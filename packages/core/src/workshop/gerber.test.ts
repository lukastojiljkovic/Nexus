import { describe, expect, it } from "vitest";

import { boardSizeMm, gerberBoxMm, gerberRoleOf, type GerberRole } from "./gerber.js";

/**
 * The Gerber half that needs no library: what a file is, and how big the board
 * is. Both are pure arithmetic over what the file says and what the converter
 * measured, so both are pinned here rather than through a screenshot.
 */

describe("gerberRoleOf", () => {
  it("believes the file's own X2 FileFunction attribute before its name", () => {
    // A file whose name says nothing useful and whose header states the truth.
    expect(gerberRoleOf("board-1.gbr", "%TF.FileFunction,Copper,L1,Top*%\n%FSLAX24Y24*%")).toBe(
      "copper-top",
    );
    expect(gerberRoleOf("board-1.gbr", "%TF.FileFunction,Soldermask,Bot*%")).toBe("mask-bottom");
    expect(gerberRoleOf("board-1.gbr", "%TF.FileFunction,Legend,Top*%")).toBe("silk-top");
    expect(gerberRoleOf("board-1.gbr", "%TF.FileFunction,Paste,Bot*%")).toBe("paste-bottom");
    expect(gerberRoleOf("board-1.gbr", "%TF.FileFunction,Profile,NP*%")).toBe("outline");
    // An inner layer names neither side.
    expect(gerberRoleOf("board-1.gbr", "%TF.FileFunction,Copper,L2,Inr*%")).toBe("copper-inner");
  });

  it("falls back to the name for the X1 files that declare nothing", () => {
    const byName: readonly [string, GerberRole][] = [
      ["board-F_Cu.gbr", "copper-top"],
      ["board-B_Cu.gbr", "copper-bottom"],
      ["board-In1_Cu.gbr", "copper-inner"],
      ["board-F_Mask.gbr", "mask-top"],
      ["board-B_Mask.gbr", "mask-bottom"],
      ["board-F_SilkS.gbr", "silk-top"],
      ["board-B_SilkS.gbr", "silk-bottom"],
      ["board-F_Paste.gbr", "paste-top"],
      ["board-B_Paste.gbr", "paste-bottom"],
      ["board-Edge_Cuts.gbr", "outline"],
      ["top.gtl", "copper-top"],
      ["bottom.gbl", "copper-bottom"],
      ["inner.g2", "copper-inner"],
      ["TopMask.gts", "mask-top"],
      ["BottomMask.gbs", "mask-bottom"],
      ["TopSilk.gto", "silk-top"],
      ["PasteTop.gtp", "paste-top"],
      ["board.gko", "outline"],
      ["board.gm1", "outline"],
      ["board.drl", "drill"],
      ["board-PTH.drl", "drill"],
      ["board-NPTH.drl", "drill"],
      ["holes.xln", "drill"],
      ["holes.nc", "drill"],
      ["drill.txt", "drill"],
    ];
    for (const [name, role] of byName) {
      expect(gerberRoleOf(name), name).toBe(role);
    }
  });

  it("calls a bare .gbr what it is - Gerber, and not a guess", () => {
    // Every X2 file is `.gbr`, so the extension says nothing about the layer,
    // and a viewer that guessed would file a track layer under "silkscreen".
    expect(gerberRoleOf("board.gbr")).toBe("other");
    expect(gerberRoleOf("board-1.gbr", "%TF.FileFunction,Other,Document*%")).toBe("other");
    expect(gerberRoleOf("README.md")).toBe("other");
  });
});

describe("gerberBoxMm", () => {
  it("derives the origin from the converter's own scale", () => {
    // gerber-to-svg answers a viewBox in the file's coordinate units and the
    // size in millimetres: 3000 units over 3 mm is 1000 units per mm, so an
    // origin at 500 units sits at half a millimetre.
    const box = gerberBoxMm("copper-top", [500, 500, 3000, 1000], 3, 1);
    expect(box).toEqual({
      role: "copper-top",
      originXmm: 0.5,
      originYmm: 0.5,
      widthMm: 3,
      heightMm: 1,
    });
  });

  it("reads an inch-unit file's box as readily as a metric one", () => {
    // A 100-unit-per-inch file: 200 units over 2 inches is 100 units per inch,
    // which is the same scale factor, and the millimetre answer is what the
    // caller passed in.
    const box = gerberBoxMm("drill", [0, 0, 200, 100], 50.8, 25.4);
    expect(box.originXmm).toBe(0);
    expect(box.originYmm).toBe(0);
    expect(box.widthMm).toBe(50.8);
  });
});

describe("boardSizeMm", () => {
  const copper = { role: "copper-top", originXmm: 1, originYmm: 1, widthMm: 20, heightMm: 10 } as const;
  const drill = { role: "drill", originXmm: 2, originYmm: 2, widthMm: 4, heightMm: 4 } as const;

  it("measures the union of the opened layers when no outline was opened", () => {
    const size = boardSizeMm([copper, drill]);
    // From (1, 1) to (21, 11) - the copper layer is the wider of the two.
    expect(size).toEqual({ widthMm: 20, heightMm: 10, from: "layers" });
  });

  it("prefers the outline when the board has one, because that layer IS the board", () => {
    const outline = {
      role: "outline",
      originXmm: 0,
      originYmm: 0,
      widthMm: 30,
      heightMm: 25,
    } as const;
    expect(boardSizeMm([copper, outline, drill])).toEqual({
      widthMm: 30,
      heightMm: 25,
      from: "outline",
    });
  });

  it("answers nothing for a board with no layers", () => {
    expect(boardSizeMm([])).toEqual({ widthMm: 0, heightMm: 0, from: "layers" });
  });
});
