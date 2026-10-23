/**
 * What a region id names, and which tiles its download holds (ADR-118).
 *
 * A region is a territory of the bundled outline (its `ADM0_A3` id), a
 * continent of it (`continent:<name>`), or `world`. A continent is the union
 * of its territories, each covered on its own: one cover over a continent's
 * box would be taken at a zoom so coarse that its one-tile margin is a band
 * hundreds of kilometres wide, while each territory's cover is as fine as its
 * own box allows.
 */

import {
  CONTINENTS,
  regionBounds,
  regionById,
  regionsOfContinent,
  type WorldBounds,
  type WorldRegion,
} from "../../shared/world/outline.js";
import { coverZoom, mergeRanges, rangesOf, ringsOf, tileCover, zoomBase, type TileRange } from "../extract/cover.js";

const CONTINENT_PREFIX = "continent:";

export type RegionTarget =
  | { readonly kind: "territory"; readonly region: WorldRegion }
  | { readonly kind: "continent"; readonly name: string; readonly regions: readonly WorldRegion[] }
  | { readonly kind: "world" };

/** The region an id names, or `null` for one the outline does not carry. */
export function regionTarget(id: string): RegionTarget | null {
  if (id === "world") return { kind: "world" };
  if (id.startsWith(CONTINENT_PREFIX)) {
    const name = id.slice(CONTINENT_PREFIX.length);
    return CONTINENTS.includes(name) ? { kind: "continent", name, regions: regionsOfContinent(name) } : null;
  }
  const region = regionById(id);
  return region === undefined ? null : { kind: "territory", region };
}

/** The stem of a region's files: the id in lower case, every other character a dash. */
export function regionFileStem(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The tile ids a region holds from zoom 0 to `maxZoom`, sorted and merged. */
export function regionRanges(target: RegionTarget, maxZoom: number): TileRange[] {
  if (target.kind === "world") return [{ start: 0, end: zoomBase(maxZoom + 1) }];
  const regions = target.kind === "territory" ? [target.region] : target.regions;
  return mergeRanges(
    regions.flatMap((region) => {
      const rings = ringsOf(region.geometry);
      const zoom = coverZoom(rings, maxZoom);
      return rangesOf(tileCover(rings, zoom), zoom, maxZoom);
    }),
  );
}

/** The box the cut's header names, for the map to fit to. */
export function regionTargetBounds(target: RegionTarget): WorldBounds {
  if (target.kind === "world") return { minLon: -180, minLat: -85.051_128_78, maxLon: 180, maxLat: 85.051_128_78 };
  const boxes = (target.kind === "territory" ? [target.region] : target.regions).map((region) => regionBounds(region.id));
  return {
    minLon: Math.min(...boxes.map((box) => box.minLon)),
    minLat: Math.min(...boxes.map((box) => box.minLat)),
    maxLon: Math.max(...boxes.map((box) => box.maxLon)),
    maxLat: Math.max(...boxes.map((box) => box.maxLat)),
  };
}
