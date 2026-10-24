import outlineFile from "./outline.json";

/**
 * The world outline the map picker draws, built by `scripts/maps/world-outline.mjs`
 * from Natural Earth's 1:50m admin-0 countries. The file ships inside the app so
 * the picker needs no pack, and the same polygons decide which tiles a region's
 * download contains. See `README.md` beside it for the source and the rebuild.
 *
 * The picker shows a territory's name through `Intl.DisplayNames` by `iso2`, so
 * it follows the reader's locale; `name` is Natural Earth's English name, for the
 * records that have no `iso2`.
 */

export type WorldPosition = readonly [number, number];
export type WorldRing = readonly WorldPosition[];
export type WorldPolygon = readonly WorldRing[];

export type WorldGeometry =
  | { readonly type: "Polygon"; readonly coordinates: WorldPolygon }
  | { readonly type: "MultiPolygon"; readonly coordinates: readonly WorldPolygon[] };

export interface WorldRegion {
  /** Natural Earth's `ADM0_A3`, unique across the outline. */
  readonly id: string;
  /** `null` where Natural Earth carries its `-99` placeholder. */
  readonly iso2: string | null;
  readonly iso3: string | null;
  /** Natural Earth's `NAME_EN`: the fallback where `iso2` is `null`. */
  readonly name: string;
  readonly continent: string;
  /** Where Natural Earth puts the territory's label, as [longitude, latitude]. */
  readonly label: WorldPosition;
  readonly geometry: WorldGeometry;
}

export interface WorldBounds {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
}

/** The file's shape, as the build writes it: the id outside the properties, as GeoJSON has it. */
interface OutlineFile {
  readonly features: readonly {
    readonly id: string;
    readonly properties: Omit<WorldRegion, "id" | "geometry">;
    readonly geometry: WorldGeometry;
  }[];
}

/**
 * Every territory, in the order the build wrote them. The cast is through
 * `unknown` because the JSON import widens every tuple to `number[]`; the shape
 * is the build's, and `outline.test.ts` reads the file through this module.
 */
export const regions: readonly WorldRegion[] = (outlineFile as unknown as OutlineFile).features.map(
  ({ id, properties, geometry }) => ({ id, ...properties, geometry }),
);

const byId = new Map(regions.map((region) => [region.id, region]));

/** The distinct continents, sorted by code point so the order never depends on the locale. */
export const CONTINENTS: readonly string[] = [...new Set(regions.map((region) => region.continent))].sort();

export function regionById(id: string): WorldRegion | undefined {
  return byId.get(id);
}

export function regionsOfContinent(continent: string): readonly WorldRegion[] {
  return regions.filter((region) => region.continent === continent);
}

/**
 * The longitude and latitude box around a territory, over every part of it.
 * A territory whose parts sit on both sides of the antimeridian (Fiji, Russia)
 * gets the whole width, because the box is taken on the numbers as stored.
 */
export function regionBounds(id: string): WorldBounds {
  const region = regionById(id);
  if (region === undefined) throw new Error(`regionBounds: no world region "${id}".`);

  const polygons = region.geometry.type === "Polygon" ? [region.geometry.coordinates] : region.geometry.coordinates;
  const positions = polygons.flatMap((polygon) => polygon.flat());
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of positions) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  return { minLon, minLat, maxLon, maxLat };
}
