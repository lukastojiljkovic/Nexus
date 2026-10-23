import { tileIdToZxy, zxyToTileId } from "pmtiles";
import { describe, expect, it } from "vitest";

import {
  COVER_BBOX_TILES,
  coverZoom,
  mergeRanges,
  rangesOf,
  ringsOf,
  tileCover,
  zoomBase,
  type Ring,
} from "./cover.js";

/** The longitude and latitude of a tile's corner, Web Mercator's own inverse. */
function corner(z: number, x: number, y: number): [number, number] {
  const n = 2 ** z;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return [(x / n) * 360 - 180, lat];
}

/** A ring a hair inside tiles `x0..x1` × `y0..y1` at zoom `z`. */
function boxRing(z: number, x0: number, y0: number, x1: number, y1: number): Ring {
  const inset = 1e-6;
  const [west, north] = corner(z, x0 + inset, y0 + inset);
  const [east, south] = corner(z, x1 + 1 - inset, y1 + 1 - inset);
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

const sortedIds = (z: number, cells: [number, number][]) =>
  cells.map(([x, y]) => zxyToTileId(z, x, y)).sort((a, b) => a - b);

describe("tile ids and the Hilbert curve", () => {
  it("numbers each zoom after every tile of the zooms above it", () => {
    expect([0, 1, 2, 3].map(zoomBase)).toEqual([0, 1, 5, 21]);
    expect(zoomBase(15)).toBe(zxyToTileId(15, 0, 0));
  });

  it("gives a tile's four children the four ids after four times its own index", () => {
    // The property the whole cut rests on: a tile's descendants at any deeper zoom
    // are one contiguous run of ids. Checked against the library's own curve.
    for (const [z, x, y] of [
      [1, 1, 0],
      [4, 9, 3],
      [7, 100, 77],
      [12, 2_290, 1_490],
    ] as const) {
      const index = zxyToTileId(z, x, y) - zoomBase(z);
      for (let k = 0; k < 4; k += 1) {
        const [cz, cx, cy] = tileIdToZxy(zoomBase(z + 1) + index * 4 + k);
        expect([cz, cx >> 1, cy >> 1]).toEqual([z + 1, x, y]);
      }
    }
  });
});

describe("the tile cover of a region", () => {
  it("is the one tile a ring sits inside, or that tile and its neighbours with a margin", () => {
    const ring = boxRing(3, 4, 2, 4, 2);
    expect(tileCover([ring], 3, 0)).toEqual(sortedIds(3, [[4, 2]]));
    const ids = tileCover([ring], 3, 1);
    expect(ids).toHaveLength(9);
    expect(ids).toContain(zxyToTileId(3, 3, 1));
    expect(ids).toContain(zxyToTileId(3, 5, 3));
  });

  it("fills the inside, where no edge passes, and not a notch the ring leaves out", () => {
    // A U over tiles 0..2 × 0..2 at zoom 3, open at the top middle tile (1, 0).
    const [west, north] = corner(3, 0.5, 0.5);
    const [east, south] = corner(3, 2.5, 2.5);
    const [notchWest, notchBottom] = corner(3, 1.1, 0.9);
    const [notchEast] = corner(3, 1.9, 0.9);
    const ring: Ring = [
      [west, south],
      [east, south],
      [east, north],
      [notchEast, north],
      [notchEast, notchBottom],
      [notchWest, notchBottom],
      [notchWest, north],
      [west, north],
      [west, south],
    ];
    const ids = tileCover([ring], 3, 0);
    expect(ids).toContain(zxyToTileId(3, 1, 1));
    expect(ids).toHaveLength(9);
    const deeper = tileCover([ring], 4, 0);
    // At zoom 4 the notch spans whole tiles (2..3, 0..1) that the ring never touches.
    expect(deeper).not.toContain(zxyToTileId(4, 2, 0));
    expect(deeper).toContain(zxyToTileId(4, 2, 2));
  });

  it("covers every part of a territory that has several", () => {
    const ids = tileCover([boxRing(4, 1, 1, 1, 1), boxRing(4, 12, 9, 13, 9)], 4, 0);
    expect(ids).toEqual(sortedIds(4, [[1, 1], [12, 9], [13, 9]]));
  });

  it("reads the outer ring of every polygon, and leaves holes out", () => {
    const outer = boxRing(2, 0, 0, 1, 1);
    const hole = boxRing(2, 1, 1, 1, 1);
    expect(ringsOf({ type: "Polygon", coordinates: [outer, hole] })).toEqual([outer]);
    expect(ringsOf({ type: "MultiPolygon", coordinates: [[outer, hole], [hole]] })).toEqual([outer, hole]);
  });
});

describe("the zoom a region is covered at", () => {
  /** How many tiles the box spans at `z`, by the Web Mercator formula written out. */
  function boxTiles(z: number, west: number, south: number, east: number, north: number): number {
    const n = 2 ** z;
    const column = (lon: number) => Math.floor(((lon + 180) / 360) * n);
    const row = (lat: number) => {
      const phi = (lat * Math.PI) / 180;
      return Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n);
    };
    return (column(east) - column(west) + 1) * (row(south) - row(north) + 1);
  }

  const box = (west: number, south: number, east: number, north: number): Ring => [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];

  it("is the deepest one whose box spans at most the budget", () => {
    const zoom = coverZoom([box(18.82, 42.23, 23.01, 46.19)], 15);
    expect(boxTiles(zoom, 18.82, 42.23, 23.01, 46.19)).toBeLessThanOrEqual(COVER_BBOX_TILES);
    expect(boxTiles(zoom + 1, 18.82, 42.23, 23.01, 46.19)).toBeGreaterThan(COVER_BBOX_TILES);
    expect(coverZoom([box(-180, -85, 180, 85)], 15)).toBe(7);
  });

  it("never goes past the deepest zoom asked for", () => {
    expect(coverZoom([box(18.82, 42.23, 23.01, 46.19)], 8)).toBe(8);
  });
});

describe("the id ranges of a cover", () => {
  it("is the ancestors above the cover zoom and one run per tile below it", () => {
    const tile = zxyToTileId(3, 4, 2);
    const ranges = rangesOf([tile], 3, 5);
    const index = tile - zoomBase(3);
    expect(ranges).toEqual([
      { start: 0, end: 1 },
      { start: zxyToTileId(1, 1, 0), end: zxyToTileId(1, 1, 0) + 1 },
      { start: zxyToTileId(2, 2, 1), end: zxyToTileId(2, 2, 1) + 1 },
      { start: tile, end: tile + 1 },
      { start: zoomBase(4) + index * 4, end: zoomBase(4) + index * 4 + 4 },
      { start: zoomBase(5) + index * 16, end: zoomBase(5) + index * 16 + 16 },
    ]);
    for (let id = zoomBase(5) + index * 16; id < zoomBase(5) + index * 16 + 16; id += 1) {
      const [, x, y] = tileIdToZxy(id);
      expect([x >> 2, y >> 2]).toEqual([4, 2]);
    }
  });

  it("merges runs that touch or overlap, sorted", () => {
    expect(
      mergeRanges([
        { start: 10, end: 12 },
        { start: 0, end: 3 },
        { start: 3, end: 5 },
        { start: 11, end: 20 },
      ]),
    ).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 20 },
    ]);
  });
});
