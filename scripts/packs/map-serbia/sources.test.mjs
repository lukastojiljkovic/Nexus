import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GLYPH_RANGES, SOURCES, formatBytes, plainText, regionFrom, sourceOf } from "./sources.mjs";

/**
 * The source catalogue and the two pure functions that turn a response into
 * something the pack can carry.
 *
 * The region fixture is Geofabrik's `index-v1.json` cut to two features — the
 * shape of the real file (one GeoJSON Feature per region, with the region's
 * polygon) at a size that can live in the repository. The real polygon is
 * hundreds of kilobytes and takes a live download, which is why nothing in this
 * repository states Serbia's bounding box.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const INDEX = JSON.parse(readFileSync(join(FIXTURES, "geofabrik-index-mini.json"), "utf8"));

describe("the source catalogue", () => {
  it("carries licence evidence for every source: a page and a sentence on it", () => {
    for (const source of SOURCES) {
      expect(source.id, source.id).toBeTruthy();
      expect(source.url, source.id).toMatch(/^https:\/\//);
      expect(source.licenceEvidence.url, source.id).toMatch(/^https:\/\//);
      // A licence name is a claim; the sentence is the evidence. The shortest of
      // them is Geofabrik's own licence line, "License: ODbL 1.0".
      expect(source.licenceEvidence.quote.length, source.id).toBeGreaterThan(10);
    }
  });

  it("names each source once", () => {
    const ids = SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses an id it does not carry", () => {
    expect(sourceOf("geofabrik-extract").licence).toBe("ODbL-1.0");
    expect(() => sourceOf("nope")).toThrow(/no source "nope"/);
  });

  it("asks for the nineteen glyph ranges the style's labels can need", () => {
    expect(GLYPH_RANGES).toHaveLength(19);
    expect(GLYPH_RANGES[0]).toBe("0-255");
    expect(GLYPH_RANGES[GLYPH_RANGES.length - 1]).toBe("4608-4863");
  });
});

describe("the region", () => {
  const region = regionFrom(INDEX, "serbia");

  it("takes the bounding box and the centre from the polygon itself", () => {
    expect(region.bounds).toEqual([18.8, 42.2, 23.0, 46.2]);
    expect(region.center).toEqual({ lon: 20.9, lat: 44.2 });
    expect(region.geometry.type).toBe("Polygon");
  });

  it("picks the zoom at which the region's width fits one screen", () => {
    // spanLon = 4.2 degrees, so 2^z >= 360/4.2 = 85.71 and z = floor(log2(85.71))
    // = 6.
    expect(Math.log2(360 / 4.2)).toBeCloseTo(6.42, 2);
    expect(region.zoom).toBe(6);
  });

  it("reads a MultiPolygon as readily as a Polygon", () => {
    const multi = {
      features: [
        {
          properties: { id: "x" },
          geometry: {
            type: "MultiPolygon",
            coordinates: [
              [[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]],
              [[[10, 10], [12, 10], [12, 11], [10, 11], [10, 10]]],
            ],
          },
        },
      ],
    };
    expect(regionFrom(multi, "x").bounds).toEqual([0, 0, 12, 11]);
  });

  it("refuses a region the index does not carry, rather than cutting the world", () => {
    expect(() => regionFrom(INDEX, "atlantis")).toThrow(/not in the index/);
  });
});

describe("the small helpers", () => {
  it("writes a size a person reads", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 kB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2.5 * 1024 ** 3)).toBe("2.50 GB");
  });

  it("strips a licence page to its words and leaves the text alone", () => {
    const text = plainText(
      "<html><head><style>p{color:red}</style><script>var x=1;</script></head><body><h1>Open Database License (ODbL) v1.0</h1><p>You are free to copy.</p></body></html>",
    );
    expect(text).toBe("Open Database License (ODbL) v1.0\nYou are free to copy.");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("var x");
  });
});
