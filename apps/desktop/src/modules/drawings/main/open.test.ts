import { describe, expect, it } from "vitest";

import { DwgError, type DwgRefusal } from "../../../main/tools/dwg.js";
import {
  drawingKindOf,
  DWG_PACK_ID,
  DwgFailureError,
  dwgFailureOf,
  MAX_DRAWING_BYTES,
  openDwg,
  PACK_CATALOGUE_ENTRY,
  type DwgFailureCode,
  type DwgTool,
  type ToolCredit,
} from "./open.js";

/**
 * The DWG flow (ADR-094), with a FAKE converter.
 *
 * `openDwg` takes a `DwgTool`, so the four ways a conversion can end — bytes, no
 * pack, the converter failing, an answer over the cap — are all reachable here
 * without LibreDWG, without a process and without a file. What the real converter
 * adds on top of this (a staged copy, an argv, a session) is
 * `main/tools/dwg.ts`'s own subject and its own test; what THIS file pins is what
 * the module does with the three answers, and that the converter's exit code and
 * first diagnostic line survive the trip.
 */

const CREDIT: ToolCredit = {
  id: DWG_PACK_ID,
  version: "0.14.8601",
  title: { sr: "LibreDWG", en: "LibreDWG" },
  licence: {
    spdx: "GPL-3.0-or-later",
    attribution: "The LibreDWG developers",
    url: "https://www.gnu.org/licenses/gpl-3.0.html",
  },
  source: {
    name: "GNU LibreDWG",
    url: "https://www.gnu.org/software/libredwg/",
  },
};

/** A converter that answers what a case says, and records what it was asked for. */
function fakeTool(answer: (path: string, maxBytes: number) => Promise<Uint8Array>): {
  readonly tool: DwgTool;
  readonly asked: { readonly path: string; readonly maxBytes: number }[];
} {
  const asked: { path: string; maxBytes: number }[] = [];
  return {
    asked,
    tool: {
      credit: CREDIT,
      convert: (path, maxBytes) => {
        asked.push({ path, maxBytes });
        return answer(path, maxBytes);
      },
    },
  };
}

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

describe("opening a DWG through the pack", () => {
  it("hands the DXF on untouched, with the pack that converted it credited", async () => {
    const bytes = new Uint8Array([0x30, 0x0a, 0x45, 0x4f, 0x46]);
    const fake = fakeTool(() => Promise.resolve(bytes));
    const opened = await openDwg({ path: "C:/crtezi/plan.dwg", tool: fake.tool, maxBytes: 1024 });
    expect(opened).toEqual({ outcome: "dxf", bytes, tool: CREDIT });
    // The same view of the same memory: a second copy of a drawing is not a
    // safety measure, and the bytes are already the wire's own `Uint8Array`.
    expect(opened.outcome === "dxf" && opened.bytes).toBe(bytes);
    // The converter is asked for the FILE the user picked and for the caller's
    // own cap — never for a name or an argument this flow composed.
    expect(fake.asked).toEqual([{ path: "C:/crtezi/plan.dwg", maxBytes: 1024 }]);
  });

  it("answers a DWG with the pack that reads it when no pack is installed, and never with bytes", async () => {
    const opened = await openDwg({ path: "C:/crtezi/plan.dwg", tool: null, maxBytes: 1024 });
    expect(opened).toEqual({
      outcome: "needs-pack",
      pack: DWG_PACK_ID,
      catalogue: PACK_CATALOGUE_ENTRY,
    });
    // GNU LibreDWG reads DWG in a separate process (GPL-3.0-or-later cannot be
    // linked into this Apache-2.0 app), so the id names a PACK rather than a
    // reader that could have been called here — and the pointer names the one
    // surface that installs one.
    expect(DWG_PACK_ID).toBe("libredwg");
    expect(PACK_CATALOGUE_ENTRY).toBe("settings:packs");
  });

  it("reports a failed conversion with the converter's exit code and its own first line", async () => {
    const fake = fakeTool(() =>
      Promise.reject(
        new DwgFailureError(
          { code: "conversion-failed", exitCode: 1, reason: "READ ERROR 0x1" },
          "dwg2dxf exited with code 1: READ ERROR 0x1",
        ),
      ),
    );
    const opened = await openDwg({ path: "C:/crtezi/broken.dwg", tool: fake.tool, maxBytes: 1024 });
    // The two values a person can act on, as data — and NOT the message, which is
    // the client's sentence for a log rather than for a page.
    expect(opened).toEqual({
      outcome: "conversion-failed",
      failure: { code: "conversion-failed", exitCode: 1, reason: "READ ERROR 0x1" },
    });
  });

  it("refuses an answer larger than the cap, before it reaches the parser", async () => {
    const huge = new Uint8Array(64);
    const fake = fakeTool(() => Promise.resolve(huge));
    const opened = await openDwg({ path: "C:/crtezi/big.dwg", tool: fake.tool, maxBytes: 32 });
    expect(opened).toEqual({
      outcome: "conversion-failed",
      failure: { code: "too-large", exitCode: 0, reason: null },
    });
  });

  it("lets anything that is not a conversion failure travel, rather than telling the user about it", async () => {
    // A `TypeError` in this application's own wiring is a defect, and a page that
    // showed it as „the converter failed“ would send a reader to install a pack
    // that is already installed.
    const fake = fakeTool(() => Promise.reject(new TypeError("bug in this app")));
    await expect(
      openDwg({ path: "C:/crtezi/plan.dwg", tool: fake.tool, maxBytes: 1024 }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe("the conversion client's refusals, as the wire's failures", () => {
  it("maps every code the client can answer with, keeping its exit and its words", () => {
    const cases: readonly [DwgRefusal, DwgFailureCode][] = [
      ["conversion-failed", "conversion-failed"],
      ["conversion-stopped", "conversion-stopped"],
      ["input-too-large", "too-large"],
      ["output-too-large", "too-large"],
      ["not-a-tool", "not-a-tool"],
      ["io", "io"],
    ];
    for (const [refusal, expected] of cases) {
      const failure = dwgFailureOf(
        new DwgError(refusal, "the client's own sentence", { exitCode: 2, reason: "READ ERROR 0x2" }),
      );
      expect(failure).toEqual({ code: expected, exitCode: 2, reason: "READ ERROR 0x2" });
    }
  });

  it("answers nulls for a conversion that never exited on its own", () => {
    // A killed process has no exit code and may have written nothing: the two
    // fields say so rather than carrying a zero the program never produced.
    expect(dwgFailureOf(new DwgError("conversion-stopped", "stopped"))).toEqual({
      code: "conversion-stopped",
      exitCode: null,
      reason: null,
    });
  });
});

describe("the size cap", () => {
  it("is 32 MiB, and is stated once", () => {
    // The number is asserted as a value because it bounds three reads: a DXF this
    // module opens, a DWG it stages for the pack, and the DXF the pack answers. A
    // cap that silently became 32 KB would refuse every real drawing, and one that
    // became 32 GiB would read the machine to death on a file somebody mistook for
    // a drawing.
    expect(MAX_DRAWING_BYTES).toBe(32 * 1024 * 1024);
  });
});
