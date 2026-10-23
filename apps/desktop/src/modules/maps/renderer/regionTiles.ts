import { MAP_REGION_DETAILS, type MapRegionDetail, type MapRegionView } from "../shared/ipc.js";

/**
 * The map's tiles, from every installed region at once (ADR-118 §10).
 *
 * MapLibre reads one source per detail, `nx-regions://<detail>/{z}/{x}/{y}`,
 * and this answers each tile from whichever installed region of that detail
 * holds it, the newest build first. A tile no region holds is an empty tile,
 * which MapLibre draws as nothing, so the outline beneath shows through. Three
 * sources at most, however many regions are installed, and the style stays
 * the same size.
 *
 * The regions themselves are PMTiles files read through `nx-map:`, each opened
 * once and kept open while the registry lists it.
 */

export const REGION_TILE_SCHEME = "nx-regions";

/** The one call this needs from a PMTiles archive. */
export interface TileArchive {
  getZxy(z: number, x: number, y: number, signal?: AbortSignal): Promise<{ data: ArrayBuffer } | undefined>;
}

export interface RegionTiles {
  /** Takes the installed regions, and answers the tile source each detail with one needs. */
  set(installed: readonly MapRegionView[]): { detail: MapRegionDetail; tiles: string }[];
  /** Answers one tile address. */
  tile(url: string, signal: AbortSignal): Promise<Uint8Array>;
}

const TILE_ADDRESS = new RegExp(`^${REGION_TILE_SCHEME}://(\\w+)/(\\d+)/(\\d+)/(\\d+)`);

export function createRegionTiles(open: (url: string) => TileArchive): RegionTiles {
  let opened = new Map<string, TileArchive>();
  let byDetail = new Map<string, TileArchive[]>();

  return {
    set(installed) {
      const newestFirst = [...installed].sort((left, right) => right.build.localeCompare(left.build));
      const keep = new Map<string, TileArchive>();
      const next = new Map<string, TileArchive[]>();
      for (const region of newestFirst) {
        const archive = opened.get(region.url) ?? keep.get(region.url) ?? open(region.url);
        keep.set(region.url, archive);
        next.set(region.detail, [...(next.get(region.detail) ?? []), archive]);
      }
      opened = keep;
      byDetail = next;
      return MAP_REGION_DETAILS.filter((detail) => next.has(detail)).map((detail) => ({
        detail,
        // The files behind the source are in its address, so a new download is
        // a new source to MapLibre rather than a cache of empty tiles.
        tiles: `${REGION_TILE_SCHEME}://${detail}/{z}/{x}/{y}?v=${newestFirst
          .filter((region) => region.detail === detail)
          .map((region) => region.url.slice(region.url.lastIndexOf("/") + 1))
          .join("+")}`,
      }));
    },

    async tile(url, signal) {
      const match = TILE_ADDRESS.exec(url);
      if (match === null) throw new Error(`Nexus: "${url}" is not a region tile address.`);
      const [, detail = "", z, x, y] = match;
      for (const archive of byDetail.get(detail) ?? []) {
        const tile = await archive.getZxy(Number(z), Number(x), Number(y), signal);
        if (tile !== undefined) return new Uint8Array(tile.data);
      }
      return new Uint8Array();
    },
  };
}
