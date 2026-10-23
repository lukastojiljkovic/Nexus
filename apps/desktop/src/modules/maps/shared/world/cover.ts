/**
 * Which tiles a region's download holds, as runs of tile ids.
 *
 * **One coarse cover, then arithmetic.** PMTiles numbers the tiles of a zoom
 * along a Hilbert curve, so a tile's descendants at every deeper zoom are one
 * contiguous run of ids: tile index `d` at zoom `c` owns indices
 * `d·4^(z−c) … (d+1)·4^(z−c) − 1` at zoom `z`. A region is therefore rasterised
 * once, at the deepest zoom whose bounding box stays within
 * {@link COVER_BBOX_TILES}, and every deeper zoom is a run per covered tile. A
 * country at full detail is a few thousand runs, never a list of millions of
 * tiles. Above the cover zoom the region is the covered tiles' ancestors.
 *
 * **Conservative on purpose.** A covered tile is taken whole down to the last
 * zoom, and the cover grows by {@link COVER_MARGIN_TILES} all round, because the
 * bundled outline is simplified (coordinates rounded to 0.001°) and a coast that
 * lies a little outside its outline must still be in the download. The cost is
 * a band of the neighbour's tiles along the border.
 */

import { zxyToTileId } from "pmtiles";

import type { WorldGeometry } from "./outline.js";

export type LonLat = readonly [lon: number, lat: number];
export type Ring = readonly LonLat[];

/** A run of tile ids, `start` included and `end` not. */
export interface TileRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The most tiles a region's bounding box may span at its cover zoom. A policy
 * value: it bounds the rasterising work and the number of runs per zoom, and at
 * this size Serbia is covered at zoom 13, where a tile is about 3.5 km wide
 * (40 075 km × cos 44° / 2^13).
 */
export const COVER_BBOX_TILES = 16_384;

/** How many tiles the cover grows by on every side; see the header. */
export const COVER_MARGIN_TILES = 1;

/** Web Mercator's limit: the latitude where the square map ends. */
const MAX_LATITUDE = 85.051_128_78;

/** The first tile id of zoom `z`: every tile of the zooms above it comes first. */
export function zoomBase(z: number): number {
  return (4 ** z - 1) / 3;
}

/**
 * The outer ring of every polygon of a territory. Holes are left out: a hole in
 * a country (an enclave) is a few tiles that the margin would take anyway.
 */
export function ringsOf(geometry: WorldGeometry): Ring[] {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((polygon) => (polygon[0] === undefined ? [] : [polygon[0]]));
}

/** A position as a point on the unit Web Mercator square, x east and y south. */
function project([lon, lat]: LonLat): [number, number] {
  const phi = (Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat)) * Math.PI) / 180;
  return [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2];
}

/** The deepest zoom, up to `maxZoom`, at which the region's box spans at most {@link COVER_BBOX_TILES}. */
export function coverZoom(rings: readonly Ring[], maxZoom: number): number {
  let [minX, minY, maxX, maxY] = [1, 1, 0, 0];
  for (const ring of rings) {
    for (const position of ring) {
      const [x, y] = project(position);
      [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
    }
  }
  for (let z = maxZoom; z > 0; z -= 1) {
    const cell = (value: number) => Math.min(2 ** z - 1, Math.floor(value * 2 ** z));
    const tiles = (cell(maxX) - cell(minX) + 1) * (cell(maxY) - cell(minY) + 1);
    if (tiles <= COVER_BBOX_TILES) return z;
  }
  return 0;
}

/**
 * The ids of the tiles at `zoom` the region touches, ascending: every tile an
 * edge passes through (a grid walk), every tile whose centre is inside a ring
 * (a scanline per row), then `margin` tiles all round.
 */
export function tileCover(rings: readonly Ring[], zoom: number, margin = COVER_MARGIN_TILES): number[] {
  const n = 2 ** zoom;
  const cells = new Set<number>();
  const mark = (x: number, y: number) => {
    if (x >= 0 && x < n && y >= 0 && y < n) cells.add(y * n + x);
  };
  for (const ring of rings) {
    const points = ring.map((position) => project(position).map((value) => value * n) as [number, number]);
    for (let index = 1; index < points.length; index += 1) {
      walk(points[index - 1] as [number, number], points[index] as [number, number], mark);
    }
    fill(points, n, mark);
  }
  const grown = new Set<number>();
  for (const key of cells) {
    const [x, y] = [key % n, Math.floor(key / n)];
    for (let dy = -margin; dy <= margin; dy += 1) {
      for (let dx = -margin; dx <= margin; dx += 1) {
        const [gx, gy] = [x + dx, y + dy];
        if (gx >= 0 && gx < n && gy >= 0 && gy < n) grown.add(gy * n + gx);
      }
    }
  }
  return [...grown].map((key) => zxyToTileId(zoom, key % n, Math.floor(key / n))).sort((a, b) => a - b);
}

/** Marks every cell the segment from `a` to `b` passes through (Amanatides and Woo's grid walk). */
function walk(a: [number, number], b: [number, number], mark: (x: number, y: number) => void): void {
  let [x, y] = [Math.floor(a[0]), Math.floor(a[1])];
  const [endX, endY] = [Math.floor(b[0]), Math.floor(b[1])];
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const [stepX, stepY] = [Math.sign(dx), Math.sign(dy)];
  const [deltaX, deltaY] = [stepX === 0 ? Infinity : Math.abs(1 / dx), stepY === 0 ? Infinity : Math.abs(1 / dy)];
  let nextX = stepX > 0 ? (x + 1 - a[0]) / dx : stepX < 0 ? (a[0] - x) / -dx : Infinity;
  let nextY = stepY > 0 ? (y + 1 - a[1]) / dy : stepY < 0 ? (a[1] - y) / -dy : Infinity;
  mark(x, y);
  for (let steps = Math.abs(endX - x) + Math.abs(endY - y); steps > 0; steps -= 1) {
    if (nextX < nextY) {
      nextX += deltaX;
      x += stepX;
    } else {
      nextY += deltaY;
      y += stepY;
    }
    mark(x, y);
  }
}

/** Marks every cell whose centre is inside the ring, row by row (even-odd). */
function fill(points: readonly [number, number][], n: number, mark: (x: number, y: number) => void): void {
  const ys = points.map(([, y]) => y);
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  const bottom = Math.min(n - 1, Math.floor(Math.max(...ys)));
  for (let row = top; row <= bottom; row += 1) {
    const centre = row + 0.5;
    const crossings: number[] = [];
    for (let index = 1; index < points.length; index += 1) {
      const [x0, y0] = points[index - 1] as [number, number];
      const [x1, y1] = points[index] as [number, number];
      if (y0 <= centre !== y1 <= centre) crossings.push(x0 + ((centre - y0) / (y1 - y0)) * (x1 - x0));
    }
    crossings.sort((left, right) => left - right);
    for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
      const from = Math.ceil((crossings[pair] as number) - 0.5);
      const to = Math.floor((crossings[pair + 1] as number) - 0.5);
      for (let column = from; column <= to; column += 1) mark(column, row);
    }
  }
}

/** The id runs from zoom 0 to `maxZoom` of a cover taken at `zoom`, merged. */
export function rangesOf(cover: readonly number[], zoom: number, maxZoom: number): TileRange[] {
  const ranges: TileRange[] = [];
  for (let z = 0; z <= maxZoom; z += 1) {
    const base = zoomBase(z);
    for (const id of cover) {
      const index = id - zoomBase(zoom);
      if (z < zoom) {
        const ancestor = base + Math.floor(index / 4 ** (zoom - z));
        ranges.push({ start: ancestor, end: ancestor + 1 });
      } else {
        const span = 4 ** (z - zoom);
        ranges.push({ start: base + index * span, end: base + (index + 1) * span });
      }
    }
  }
  return mergeRanges(ranges);
}

/** The runs sorted, with every two that touch or overlap made one. */
export function mergeRanges(ranges: readonly TileRange[]): TileRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: TileRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
    } else {
      merged.push(range);
    }
  }
  return merged;
}
