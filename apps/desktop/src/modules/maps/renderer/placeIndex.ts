import { VectorTile } from "@mapbox/vector-tile";
import { MAP_PLACE_KINDS, transliterateToLatin, type MapPlace, type MapPlaceKind } from "@nexus/core";
import { PbfReader } from "pbf";
import { tileIdToZxy } from "pmtiles";

import { DETAIL_MAX_ZOOM, type MapRegionDetail } from "../shared/ipc.js";
import { regionById } from "../shared/world/outline.js";
import { coverZoom, ringsOf, tileCover } from "../shared/world/cover.js";
import { installedTerritories } from "./regions/scope.js";
import type { TileArchive } from "./regionTiles.js";

/**
 * A region's place index, read from the tiles of its download.
 *
 * **Why the tiles and not a file.** A region is a PMTiles archive cut from the
 * planet build, and its `places` layer carries every named place the tiles
 * show, so the search reads the same bytes the map draws. The index is what a
 * region's download already contains: nothing is shipped beside it, and the
 * labels and the search cannot disagree about where a town is.
 *
 * **Which zooms are read.** A place is in every tile from its `min_zoom` down,
 * so one tile per place is enough and the deepest zoom holds the most of them.
 * Reading deeper than {@link INDEX_MAX_ZOOM} adds neighbourhoods at many times
 * the tiles, and the search has no use for a neighbourhood a person has not
 * zoomed to.
 */

/**
 * The most tiles one region's index reads. A policy bound, not a measurement:
 * it caps the work a download can ask of the search, and the zoom steps down
 * until the territories fit under it.
 */
export const INDEX_MAX_TILES = 2_000;

/**
 * The deepest zoom an index reads. Villages are in the tiles by this zoom and
 * the deeper ones add neighbourhoods at many times the tiles, for names the
 * search seldom needs. A policy choice, not a measurement.
 */
export const INDEX_MAX_ZOOM = 10;

/** How many tile reads are in flight at once for one region. */
const READ_CONCURRENCY = 6;

/**
 * How far apart, in degrees of latitude and of longitude, two readings of one
 * place may lie. A point is stored in 1/4096 of its tile, and the world's index
 * reads zoom 5, where that step is 360 / 32 / 4096 ≈ 0.0027° of longitude; the
 * bound is a few steps more, and still far short of the next town.
 */
const SAME_PLACE_DEGREES = 0.01;

/** The `places` points' kind, by the `kind` property, where `kind_detail` says nothing the list knows. */
const KIND_OF_KIND: ReadonlyMap<string, MapPlaceKind> = new Map([
  ["country", "country"],
  ["region", "region"],
  ["locality", "locality"],
  ["macrohood", "suburb"],
  ["neighbourhood", "neighbourhood"],
]);

/** The tiles a region's index reads, as `[z, x, y]`, sorted by tile id, each once. */
export function indexTiles(id: string, detail: MapRegionDetail): [z: number, x: number, y: number][] {
  const territories = installedTerritories([id]).flatMap((territory) => {
    const region = regionById(territory);
    return region === undefined ? [] : [ringsOf(region.geometry)];
  });
  const start = coverZoom(territories.flat(), Math.min(DETAIL_MAX_ZOOM[detail], INDEX_MAX_ZOOM));
  const coverAt = (zoom: number): Set<number> => {
    const ids = new Set<number>();
    for (const rings of territories) for (const tile of tileCover(rings, zoom, 0)) ids.add(tile);
    return ids;
  };
  // At zoom 0 a territory is one tile, so the loop always ends.
  let zoom = start;
  let ids = coverAt(zoom);
  while (ids.size > INDEX_MAX_TILES) {
    zoom -= 1;
    ids = coverAt(zoom);
  }
  return [...ids].sort((a, b) => a - b).map((tile) => tileIdToZxy(tile));
}

/** The kind of a `places` feature: its `kind_detail` when the list knows it, else what its `kind` stands for. */
function kindOf(properties: Readonly<Record<string, number | string | boolean>>): MapPlaceKind | null {
  const detail = properties.kind_detail;
  if (typeof detail === "string" && (MAP_PLACE_KINDS as readonly string[]).includes(detail)) {
    return detail as MapPlaceKind;
  }
  const kind = properties.kind;
  return typeof kind === "string" ? (KIND_OF_KIND.get(kind) ?? null) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * One `places` feature as a place, or `null` when it has no name or no kind the
 * index knows. The drawn name follows the map's labels (`labelText` in
 * `style.ts`): the Serbian Latin spelling, then the Croatian one, the local
 * name where the feature is Latin, then English, and for a non-Latin name with
 * neither, its transliteration.
 */
export function placeFromFeature(
  properties: Readonly<Record<string, number | string | boolean>>,
  lon: number,
  lat: number,
  id: number,
): MapPlace | null {
  const local = text(properties.name);
  const kind = kindOf(properties);
  if (local === null || kind === null) return null;
  const population = properties.population;
  const name =
    text(properties["name:sr-Latn"]) ??
    text(properties["name:hr"]) ??
    (properties.script === undefined ? local : text(properties["name:en"])) ??
    transliterateToLatin(local);
  return {
    id,
    name,
    nameCyr: properties.script === "Cyrillic" ? local : null,
    nameEn: text(properties["name:en"]),
    kind,
    lat,
    lon,
    population: typeof population === "number" && Number.isFinite(population) && population >= 0 ? population : null,
  };
}

/** The feature id as a place id: a positive integer, else 0, which {@link mergePlaces} later makes unique. */
function placeId(id: number | undefined): number {
  return id !== undefined && Number.isSafeInteger(id) && id > 0 ? id : 0;
}

/**
 * The places of one tile that lie inside it. A point in the tile's buffer is
 * the neighbour's place, and the neighbour's own tile reads it, so a place is
 * read once however many tiles' buffers it sits in.
 */
export function placesFromTile(bytes: Uint8Array, z: number, x: number, y: number): MapPlace[] {
  const layer = new VectorTile(new PbfReader(bytes)).layers.places;
  if (layer === undefined) return [];
  const places: MapPlace[] = [];
  for (let index = 0; index < layer.length; index += 1) {
    const feature = layer.feature(index);
    const point = feature.loadGeometry()[0]?.[0];
    const extent = feature.extent;
    if (feature.type !== 1 || point === undefined) continue;
    if (point.x < 0 || point.x >= extent || point.y < 0 || point.y >= extent) continue;
    const lon = ((x + point.x / extent) / 2 ** z) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + point.y / extent)) / 2 ** z))) * 180) / Math.PI;
    const place = placeFromFeature(feature.properties, lon, lat, placeId(feature.id));
    if (place !== null) places.push(place);
  }
  return places;
}

/**
 * The places of several regions as one list. A place two regions both carry
 * (a territory and its continent, both installed) is kept once, from the first
 * list that has it, so the caller orders the most detailed region first. The
 * two regions may read it at different zooms, so its two positions differ by
 * the tile grid: one place is one kind and name within {@link SAME_PLACE_DEGREES}.
 * Places with no feature id then get distinct negative ids, because the page
 * keys its results by id.
 */
export function mergePlaces(lists: readonly (readonly MapPlace[])[]): MapPlace[] {
  const byName = new Map<string, MapPlace[]>();
  const merged: MapPlace[] = [];
  for (const list of lists) {
    for (const place of list) {
      const key = `${place.kind}|${place.name}`;
      const kept = byName.get(key) ?? [];
      const near = (other: MapPlace): boolean =>
        Math.abs(other.lat - place.lat) <= SAME_PLACE_DEGREES && Math.abs(other.lon - place.lon) <= SAME_PLACE_DEGREES;
      if (kept.some(near)) continue;
      byName.set(key, [...kept, place]);
      merged.push(place);
    }
  }
  let unnamed = 0;
  return merged.map((place) => {
    if (place.id !== 0) return place;
    unnamed += 1;
    return { ...place, id: -unnamed };
  });
}

/** Every listed tile's places, a missing tile skipped, at most {@link READ_CONCURRENCY} reads in flight. */
export async function readRegionPlaces(
  archive: TileArchive,
  tiles: readonly (readonly [z: number, x: number, y: number])[],
  signal?: AbortSignal,
): Promise<MapPlace[]> {
  const perTile = new Array<MapPlace[]>(tiles.length);
  let next = 0;
  const reader = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const address = tiles[index];
      if (address === undefined) return;
      const [z, x, y] = address;
      const tile = await archive.getZxy(z, x, y, signal);
      perTile[index] = tile === undefined ? [] : placesFromTile(new Uint8Array(tile.data), z, x, y);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, tiles.length) }, reader));
  return perTile.flat();
}
