import { afterEach, describe, expect, it, vi } from "vitest";
import { DxfFetcher } from "dxf-viewer";
import { insunitsOfHeader, unitOfInsunits } from "./units.js";

/**
 * The worker's parse step, against a DXF written here by hand: a line, a circle,
 * a text, and two layers.
 *
 * **Why the fixture is handwritten.** A real drawing is tens of thousands of
 * entity pairs and would prove nothing about what this module reads from one: a
 * failure would say "something in this file", not which group code. Every value
 * below is asserted EXACTLY, so a parser change that quietly stopped reading a
 * layer's colour, a circle's radius or the header's `$INSUNITS` fails here.
 *
 * **Why this is the worker's own step.** `DxfWorker._Load` - the code a worker
 * runs when the page asks it to load - calls exactly this: `new
 * DxfFetcher(url).Fetch()`, then the scene builder over the result. The fetch's
 * URL is answered here by a stub, which is the same thing the worker's own shim
 * does in the app (see `parseWorker.ts`); everything after it is the library's
 * real parser, unmodified.
 */

/** AutoCAD R12 (AC1009), millimetres (`$INSUNITS` = 4), two layers. */
const FIXTURE = [
  "0", "SECTION", "2", "HEADER",
  "9", "$ACADVER", "1", "AC1009",
  "9", "$INSUNITS", "70", "4",
  "9", "$EXTMIN", "10", "0.0", "20", "0.0",
  "9", "$EXTMAX", "10", "100.0", "20", "60.0",
  "0", "ENDSEC",
  "0", "SECTION", "2", "TABLES",
  "0", "TABLE", "2", "LAYER", "70", "2",
  "0", "LAYER", "2", "0", "70", "0", "62", "7", "6", "CONTINUOUS",
  "0", "LAYER", "2", "KONSTRUKCIJA", "70", "0", "62", "1", "6", "CONTINUOUS",
  "0", "ENDTAB", "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES",
  "0", "LINE", "8", "0", "10", "0.0", "20", "0.0", "11", "100.0", "21", "50.0",
  "0", "CIRCLE", "8", "KONSTRUKCIJA", "10", "40.0", "20", "30.0", "40", "12.5",
  "0", "TEXT", "8", "KONSTRUKCIJA", "10", "10.0", "20", "60.0", "40", "5.0",
  "1", "KOTIRANJE",
  "0", "ENDSEC", "0", "EOF", "",
].join("\n");

/**
 * The little of the parsed document this test reads.
 *
 * The library publishes its parsed document as `any` - its own README says the
 * bundled parser has no public type model - so the shape is stated HERE, where
 * the assertions are, rather than left as `any` at every `expect`.
 */
interface ParsedFixture {
  header: Record<string, unknown>;
  entities: readonly {
    type: string;
    layer?: string;
    vertices?: readonly { x: number; y: number }[];
    center?: { x: number; y: number };
    radius?: number;
    text?: string;
    textHeight?: number;
    startPoint?: { x: number; y: number };
  }[];
  tables: { layer: { layers: Record<string, { colorIndex: number; color: number }> } };
}

async function parse(): Promise<ParsedFixture> {
  const encoded = new TextEncoder().encode(FIXTURE);
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(encoded)));
  return (await new DxfFetcher("nx-drawing://opened").Fetch()) as ParsedFixture;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the hand-written fixture", () => {
  it("parses the three entities it contains, with their exact geometry", async () => {
    const dxf = await parse();
    expect(dxf.entities.map((entity) => entity.type)).toEqual(["LINE", "CIRCLE", "TEXT"]);
    const [line, circle, text] = dxf.entities;
    // The line, from the origin to (100, 50) on layer "0".
    expect(line?.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
    expect(line?.layer).toBe("0");
    // The circle: centre (40, 30), radius 12.5.
    expect(circle?.center).toEqual({ x: 40, y: 30 });
    expect(circle?.radius).toBe(12.5);
    // The text: height 5, string "KOTIRANJE", at (10, 60).
    expect(text?.text).toBe("KOTIRANJE");
    expect(text?.textHeight).toBe(5);
    expect(text?.startPoint).toEqual({ x: 10, y: 60 });
  });

  it("parses both layers with the colour each declares", async () => {
    const dxf = await parse();
    const layers = dxf.tables.layer.layers;
    expect(Object.keys(layers)).toEqual(["0", "KONSTRUKCIJA"]);
    // AutoCAD colour index 7 is the default (the library resolves it to white)
    // and index 1 is red: 0xff0000.
    expect(layers["0"]?.colorIndex).toBe(7);
    expect(layers["0"]?.color).toBe(0xffffff);
    expect(layers["KONSTRUKCIJA"]?.colorIndex).toBe(1);
    expect(layers["KONSTRUKCIJA"]?.color).toBe(0xff0000);
  });

  it("reads the drawing's own unit out of the header, and names it", async () => {
    const dxf = await parse();
    expect(dxf.header.$INSUNITS).toBe(4);
    // The units helper's end of the same fact: code 4 is "Millimeters".
    expect(unitOfInsunits(dxf.header.$INSUNITS)).toBe("millimeters");
    // And the page's end of it, which reads the FILE rather than the parsed
    // document: the same fixture, through `insunitsOfHeader`.
    expect(insunitsOfHeader(FIXTURE)).toBe(4);
    expect(dxf.header.$ACADVER).toBe("AC1009");
  });
});
