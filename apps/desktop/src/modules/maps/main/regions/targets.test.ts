import { zxyToTileId } from "pmtiles";
import { describe, expect, it } from "vitest";

import { regionById, regionsOfContinent } from "../../shared/world/outline.js";
import { zoomBase } from "../extract/cover.js";
import { DETAIL_MAX_ZOOM, regionFileStem, regionRanges, regionTarget } from "./targets.js";

describe("what a region id names", () => {
  it("is a territory of the outline, a continent of it, or the world", () => {
    expect(regionTarget("SRB")).toEqual({ kind: "territory", region: regionById("SRB") });
    expect(regionTarget("continent:Europe")).toMatchObject({ kind: "continent", name: "Europe" });
    expect(regionTarget("world")).toEqual({ kind: "world" });
  });

  it("is nothing for an id the outline does not carry", () => {
    for (const id of ["XXX", "srb", "continent:Atlantis", "continent:", "World", "../SRB", ""]) {
      expect(regionTarget(id), id).toBeNull();
    }
  });

  it("names a file with letters, digits and dashes only", () => {
    expect(regionFileStem("SRB")).toBe("srb");
    expect(regionFileStem("continent:North America")).toBe("continent-north-america");
    expect(regionFileStem("world")).toBe("world");
  });
});

describe("the tiles a region downloads", () => {
  it("are every tile of the zooms asked for when it is the world", () => {
    const target = regionTarget("world");
    expect(target && regionRanges(target, DETAIL_MAX_ZOOM.overview)).toEqual([
      { start: 0, end: zoomBase(DETAIL_MAX_ZOOM.overview + 1) },
    ]);
  });

  it("hold Belgrade for Serbia, and not Zagreb", () => {
    const target = regionTarget("SRB");
    const ranges = target === null ? [] : regionRanges(target, 12);
    const holds = (z: number, x: number, y: number) => {
      const id = zxyToTileId(z, x, y);
      return ranges.some((range) => range.start <= id && id < range.end);
    };
    // Belgrade (20.46 E, 44.82 N) and Zagreb (15.98 E, 45.81 N) at zoom 12.
    expect(holds(12, 2280, 1476)).toBe(true);
    expect(holds(12, 2229, 1460)).toBe(false);
  });

  it("are every territory's tiles for a continent, each covered on its own", () => {
    const continent = regionTarget("continent:Europe");
    const ranges = continent === null ? [] : regionRanges(continent, 10);
    const serbia = regionTarget("SRB");
    const holdsAll = (inner: { start: number; end: number }[]) =>
      inner.every((part) => ranges.some((range) => range.start <= part.start && part.end <= range.end));
    expect(serbia === null ? false : holdsAll(regionRanges(serbia, 10))).toBe(true);
    expect(regionsOfContinent("Europe").length).toBeGreaterThan(1);
  });
});
