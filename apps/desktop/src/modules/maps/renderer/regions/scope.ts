import { regionBounds, regionById, regions, regionsOfContinent, type WorldBounds } from "../../shared/world/outline.js";

/**
 * What a region id covers on the outline: a territory, a continent's
 * territories, or every territory. The map's picker tints by it, the camera
 * frames by it, and the place search reads its tiles by it.
 */

/** The territories a set of installed region ids covers, each once. */
export function installedTerritories(ids: readonly string[]): string[] {
  const covered = new Set<string>();
  for (const id of ids) {
    if (id === "world") return regions.map((region) => region.id);
    if (id.startsWith("continent:")) {
      for (const region of regionsOfContinent(id.slice("continent:".length))) covered.add(region.id);
    } else if (regionById(id) !== undefined) {
      covered.add(id);
    }
  }
  return [...covered];
}

/** The box around a territory or a continent, for the camera; `null` for the world, which is the whole map. */
export function coverBounds(id: string): WorldBounds | null {
  const boxes = id === "world" ? [] : installedTerritories([id]).map((territory) => regionBounds(territory));
  if (boxes.length === 0) return null;
  return {
    minLon: Math.min(...boxes.map((box) => box.minLon)),
    minLat: Math.min(...boxes.map((box) => box.minLat)),
    maxLon: Math.max(...boxes.map((box) => box.maxLon)),
    maxLat: Math.max(...boxes.map((box) => box.maxLat)),
  };
}
