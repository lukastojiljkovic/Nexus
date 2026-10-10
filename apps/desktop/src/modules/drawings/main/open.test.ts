import { describe, expect, it } from "vitest";
import {
  drawingKindOf,
  DWG_PACK_ID,
  MAX_DRAWING_BYTES,
  openDrawing,
  PACK_CATALOGUE_ENTRY,
} from "./open.js";

/**
 * The DWG seam: which reader a file's name asks for, and what the two arms of
 * `openDrawing` answer.
 *
 * The DWG arm is the one piece of this module that a later run REPLACES, so its
 * contract is pinned here rather than left to a comment: what the page receives
 * for a DWG today is a pack's id and the catalogue that installs it, and never
 * bytes it would try to parse as DXF.
 */

describe("drawingKindOf", () => {
  it("names the reader for each format this module opens, whatever the case", () => {
    expect(drawingKindOf("plan.dxf")).toBe("dxf");
    expect(drawingKindOf("PLAN.DXF")).toBe("dxf");
    expect(drawingKindOf("Plan.Dwg")).toBe("dwg");
    expect(drawingKindOf("C:/crtezi/plan d.dwg")).toBe("dwg");
  });

  it("refuses by name rather than guessing at anything else", () => {
    expect(drawingKindOf("plan.txt")).toBeNull();
    expect(drawingKindOf("plan")).toBeNull();
    expect(drawingKindOf("plan.dwg.bak")).toBeNull();
    expect(drawingKindOf("")).toBeNull();
  });
});

describe("openDrawing", () => {
  it("hands DXF bytes on, untouched and uncopied", () => {
    const bytes = new Uint8Array([0x30, 0x0a, 0x45, 0x4f, 0x46]);
    const opened = openDrawing(bytes, "dxf");
    expect(opened).toEqual({ outcome: "dxf", bytes });
    // The same view of the same memory: a second 32 MiB copy is not a safety
    // measure, and the bytes are already the wire's own `Uint8Array`.
    expect(opened.outcome === "dxf" && opened.bytes).toBe(bytes);
  });

  it("answers a DWG with the pack that reads it, and never with bytes", () => {
    const opened = openDrawing(new Uint8Array([0x41, 0x43, 0x31, 0x30]), "dwg");
    expect(opened).toEqual({
      outcome: "needs-pack",
      pack: DWG_PACK_ID,
      catalogue: PACK_CATALOGUE_ENTRY,
    });
    // GNU LibreDWG reads DWG in a separate process (GPL-3.0-or-later cannot be
    // linked into this Apache-2.0 app), so the id names a PACK rather than a
    // reader that could have been called here.
    expect(DWG_PACK_ID).toBe("libredwg");
  });
});

describe("the size cap", () => {
  it("is 32 MiB, and is stated once", () => {
    // The number is asserted as a value because `readFileBounded` enforces it
    // BEFORE the bytes are in memory: a cap that silently became 32 KB would
    // refuse every real drawing, and one that became 32 GiB would read the
    // machine to death on a file the user mistook for a drawing.
    expect(MAX_DRAWING_BYTES).toBe(32 * 1024 * 1024);
  });
});
