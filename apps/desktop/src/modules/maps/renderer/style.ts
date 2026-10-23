import { layers, namedFlavor, type Flavor } from "@protomaps/basemaps";
import type { MapOptions } from "maplibre-gl";

import { DETAIL_MAX_ZOOM, MAP_REGION_DETAILS, type MapRegionDetail } from "../shared/ipc.js";
import { disputedAreas } from "../shared/world/disputed.js";
import { regionBounds, regions, type WorldGeometry } from "../shared/world/outline.js";
import { territoryName, type Locale } from "./regions/names.js";

/**
 * The map's style, built in the renderer from the regions on this machine
 * (ADR-118 §10).
 *
 * **The shapes are the vendor's, the colours are ours.** `@protomaps/basemaps`
 * turns a flavour, one colour per surface, into the layers its tile schema
 * needs. The flavour is the seam where the Nexus palette goes in: every key
 * those layers read is mapped to a semantic token below, read live from the
 * document, so the map follows the theme the way the rest of the page does.
 *
 * **The labels are the vendor's layers with our text.** The tiles carry `name`
 * in the local script, `name:en`, and for many places `name:hr`, but no
 * Serbian name. So a label's text is our own chain (`labelText`), its font is
 * the UI's own stack, drawn from the system's fonts because the style names no
 * glyph server, and the icons, shields, POIs and house numbers are left out:
 * nothing here draws a sprite.
 *
 * **The outline is always there.** The bundled Natural Earth outline is the
 * land under every region, the borders where nothing is downloaded, the
 * country names at the zooms that show countries, and the shapes a click
 * picks. A map with nothing downloaded is therefore still a world to pick
 * from.
 */

type StyleSpecification = Exclude<NonNullable<MapOptions["style"]>, string>;
export type MapLayer = StyleSpecification["layers"][number];
type MapSource = StyleSpecification["sources"][string];

/** A semantic token's live value by its name without `--nx-`: `token("surface")`. */
export type TokenOf = (name: string) => string;

export const BACKGROUND_LAYER = "background";
export const OUTLINE_SOURCE = "outline";
export const OUTLINE_LAND_LAYER = "outline-land";
export const OUTLINE_BORDER_LAYER = "outline-borders";
export const DISPUTED_SOURCE = "disputed";
export const DISPUTED_HATCH_LAYER = "disputed-hatch";
export const DISPUTED_LINE_LAYER = "disputed-border";
export const DISPUTED_POINT_LAYER = "disputed-points";
export const DISPUTED_HATCH_IMAGE = "disputed-hatch";
export const DISPUTED_POINT_IMAGE = "disputed-point";
export const COUNTRY_SOURCE = "countries";
export const COUNTRY_LABEL_LAYER = "country-labels";
/** The territories some installed region covers, tinted while the picker is open. */
export const PICK_INSTALLED_LAYER = "pick-installed";
/** The territory the region card is open for. */
export const PICK_SELECTED_LAYER = "pick-selected";

/** The source id of one detail's tiles. */
export function detailSource(detail: MapRegionDetail): string {
  return `regions-${detail}`;
}

/**
 * Every flavour key the vendor's geometry layers read, and the token each one
 * wears: land is the surface and water the sunken surface beside it (the
 * palette has no blue, and the app's rule forbids adding one); greenery is the
 * data tint; roads are the raised surface with border casings, and motorways
 * the accent's soft tint edged with its strong colour; boundaries are ink.
 */
const VENDOR_KEYS: Partial<Record<keyof Flavor, string>> = {
  background: "surface-alt",
  earth: "surface",
  water: "surface-sunken",
  glacier: "surface",
  sand: "border-subtle",
  beach: "border-subtle",
  park_a: "data-soft",
  park_b: "data-soft",
  wood_a: "data-soft",
  wood_b: "data-soft",
  scrub_a: "data-soft",
  scrub_b: "data-soft",
  zoo: "data-soft",
  hospital: "surface-alt",
  school: "surface-alt",
  aerodrome: "surface-alt",
  runway: "surface-alt",
  pier: "surface-alt",
  industrial: "border-subtle",
  military: "border-subtle",
  pedestrian: "border-subtle",
  buildings: "border",
  minor_service: "surface-raised",
  minor_a: "surface-raised",
  minor_b: "surface-raised",
  link: "surface-raised",
  other: "surface-raised",
  minor_service_casing: "border",
  minor_casing: "border",
  link_casing: "border",
  major: "surface-raised",
  major_casing_early: "border-strong",
  major_casing_late: "border-strong",
  highway: "accent-soft",
  highway_casing_early: "accent-strong",
  highway_casing_late: "accent-strong",
  railway: "border-strong",
  boundaries: "text-faint",
  tunnel_other_casing: "border-strong",
  tunnel_minor_casing: "border-strong",
  tunnel_link_casing: "border-strong",
  tunnel_major_casing: "border-strong",
  tunnel_highway_casing: "accent-strong",
  tunnel_other: "surface-raised",
  tunnel_minor: "surface-raised",
  tunnel_link: "surface-raised",
  tunnel_major: "surface-raised",
  tunnel_highway: "accent-soft",
  bridges_other_casing: "border",
  bridges_minor_casing: "border",
  bridges_link_casing: "border",
  bridges_major_casing: "border-strong",
  bridges_highway_casing: "accent-strong",
  bridges_other: "surface-raised",
  bridges_minor: "surface-raised",
  bridges_link: "surface-raised",
  bridges_major: "surface-raised",
  bridges_highway: "accent-soft",
};

const LANDCOVER: Record<keyof NonNullable<Flavor["landcover"]>, string> = {
  grassland: "data-soft",
  farmland: "data-soft",
  forest: "data-soft",
  scrub: "data-soft",
  urban_area: "surface-alt",
  barren: "border-subtle",
  glacier: "surface",
};

/**
 * The label layers kept, and the ink each wears. Every other vendor label
 * layer is left out: POIs, shields, one-way arrows and house numbers need a
 * sprite, and country names come from the outline, named in the reader's
 * language.
 */
const LABEL_INKS: Record<string, string> = {
  places_locality: "text",
  places_subplace: "text-subtle",
  places_region: "text-muted",
  water_label_ocean: "text-subtle",
  water_label_lakes: "text-subtle",
  water_waterway_label: "text-subtle",
  earth_label_islands: "text-subtle",
  roads_labels_major: "text-muted",
  roads_labels_minor: "text-muted",
};

/** What a vendor label placed around its icon; with the icon gone, the name sits where it was. */
const ICON_PLACEMENT = ["text-variable-anchor", "text-radial-offset", "text-justify", "text-offset"];

const HALO = { width: 1.2, blur: 0.4 };

/** One token, refusing by name when the document does not define it: an empty colour is a map MapLibre refuses whole. */
function ink(token: TokenOf, name: string): string {
  const value = token(name);
  if (value === "") throw new Error(`Nexus: the map's colour token --nx-${name} is not defined.`);
  return value;
}

/** The vendor's light flavour with every key the geometry reads painted from the app's tokens. */
export function mapFlavor(token: TokenOf): Flavor {
  const flavor: Flavor = { ...namedFlavor("light") };
  for (const [key, name] of Object.entries(VENDOR_KEYS)) {
    (flavor as unknown as Record<string, string>)[key] = ink(token, name);
  }
  flavor.landcover = Object.fromEntries(
    Object.entries(LANDCOVER).map(([key, name]) => [key, ink(token, name)]),
  ) as unknown as NonNullable<Flavor["landcover"]>;
  return flavor;
}

/**
 * What a label says, by the reader's language.
 *
 * English reads `name:en`, else the local name. Serbian is written in Latin
 * here, and the tiles have no Serbian name, so it reads the closest name they
 * do have: the Croatian one (`Beograd`, `Beč`, `Moskva`), then the local name
 * where it is already Latin (the vendor sets `script` only for one that is
 * not), then English, which for a Serbian village is its Latin spelling.
 */
export function labelText(locale: Locale): unknown[] {
  if (locale === "en") return ["coalesce", ["get", "name:en"], ["get", "name"]];
  return [
    "coalesce",
    ["get", "name:sr-Latn"],
    ["get", "name:hr"],
    ["case", ["has", "script"], ["coalesce", ["get", "name:en"], ["get", "name"]], ["get", "name"]],
  ];
}

/** A CSS `font-family` list as the names MapLibre's `text-font` takes. */
export function fontStack(family: string): string[] {
  return family
    .split(",")
    .map((name) => name.trim().replace(/^["']|["']$/g, ""))
    .filter((name) => name !== "");
}

/** The vendor's shapes for one source, under ids of that source, without its background. */
export function geometryLayers(source: string, flavor: Flavor): MapLayer[] {
  return (layers(source, flavor) as unknown as MapLayer[])
    .filter((layer) => layer.type !== "background")
    .map((layer) => ({ ...layer, id: `${source}:${layer.id}` }));
}

export interface LabelOptions {
  readonly token: TokenOf;
  readonly fonts: readonly string[];
  readonly locale: Locale;
}

/** The kept vendor label layers for one source, with our text, fonts and inks. */
export function labelLayers(source: string, { token, fonts, locale }: LabelOptions): MapLayer[] {
  const halo = ink(token, "surface-raised");
  return (layers(source, namedFlavor("light"), { lang: "en" }) as unknown as MapLayer[]).flatMap((layer) => {
    const color = LABEL_INKS[layer.id];
    if (color === undefined || layer.type !== "symbol") return [];
    const vendor = (layer.layout ?? {}) as Record<string, unknown>;
    const hadIcon = "icon-image" in vendor;
    const layout = Object.fromEntries(
      Object.entries(vendor).filter(
        ([key]) => !key.startsWith("icon-") && !(hadIcon && ICON_PLACEMENT.includes(key)),
      ),
    );
    return [
      {
        ...layer,
        id: `${source}:${layer.id}`,
        layout: { ...layout, "text-field": labelText(locale), "text-font": [...fonts] },
        paint: {
          "text-color": ink(token, color),
          "text-halo-color": halo,
          "text-halo-width": HALO.width,
          "text-halo-blur": HALO.blur,
        },
      } as MapLayer,
    ];
  });
}

export interface OutlineArea {
  readonly type: "Feature";
  readonly properties: { readonly id: string };
  readonly geometry: WorldGeometry;
}

export interface OutlineLabel {
  readonly type: "Feature";
  readonly properties: { readonly id: string; readonly name: string; readonly rank: number };
  readonly geometry: { readonly type: "Point"; readonly coordinates: readonly [number, number] };
}

let areas: { readonly type: "FeatureCollection"; readonly features: readonly OutlineArea[] } | null = null;

/** Every territory's shape, carrying its id: the land, the borders and what a click picks. */
export function outlineAreas(): { readonly type: "FeatureCollection"; readonly features: readonly OutlineArea[] } {
  areas ??= {
    type: "FeatureCollection",
    features: regions.map((region) => ({
      type: "Feature",
      properties: { id: region.id },
      geometry: region.geometry,
    })),
  };
  return areas;
}

/** Every disputed shape, carrying only the id the style needs. */
export function disputedAreasGeoJson(): {
  readonly type: "FeatureCollection";
  readonly features: readonly {
    readonly type: "Feature";
    readonly id: string;
    readonly properties: { readonly id: string };
    readonly geometry: (typeof disputedAreas)[number]["geometry"];
  }[];
} {
  return {
    type: "FeatureCollection",
    features: disputedAreas.map((area) => ({
      type: "Feature",
      id: area.id,
      properties: { id: area.id },
      geometry: area.geometry,
    })),
  };
}

const DISPUTED_AREA_FILTER = ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]];
const DISPUTED_POINT_FILTER = ["==", ["geometry-type"], "Point"];

/**
 * Every territory's name at Natural Earth's label point. `rank` is the
 * negated area of its box, so `symbol-sort-key` places a large territory's
 * name before a small one's when they collide.
 */
export function outlineLabels(locale: Locale): {
  readonly type: "FeatureCollection";
  readonly features: readonly OutlineLabel[];
} {
  return {
    type: "FeatureCollection",
    features: regions.map((region) => {
      const box = regionBounds(region.id);
      return {
        type: "Feature",
        properties: {
          id: region.id,
          name: territoryName(region, locale),
          rank: -(box.maxLon - box.minLon) * (box.maxLat - box.minLat),
        },
        geometry: { type: "Point", coordinates: region.label },
      };
    }),
  };
}

/** The filter that tints the installed territories. */
export function installedFilter(ids: readonly string[]): unknown[] {
  return ["in", ["get", "id"], ["literal", [...ids]]];
}

/** The filter that outlines the picked territory, or nothing. */
export function selectedFilter(id: string | null): unknown[] {
  return ["==", ["get", "id"], id ?? ""];
}

export interface RegionStyleInput extends LabelOptions {
  /** One tile URL template per detail that has at least one installed region. */
  readonly sources: readonly { readonly detail: MapRegionDetail; readonly tiles: string }[];
}

/**
 * The whole style: the outline under the regions, the coarser detail under the
 * finer so a finer tile covers a coarser one wherever both exist, the picker's
 * tint above the shapes, and every name above every shape.
 */
export function regionStyle(input: RegionStyleInput): StyleSpecification {
  const { token, fonts, locale } = input;
  const details = MAP_REGION_DETAILS.filter((detail) => input.sources.some((source) => source.detail === detail));
  const flavor = mapFlavor(token);
  const tileSources = Object.fromEntries(
    input.sources.map(({ detail, tiles }): [string, MapSource] => [
      detailSource(detail),
      { type: "vector", tiles: [tiles], maxzoom: DETAIL_MAX_ZOOM[detail] },
    ]),
  );
  const hidden = { visibility: "none" } as const;

  return {
    version: 8,
    sources: {
      [OUTLINE_SOURCE]: { type: "geojson", data: outlineAreas() as never },
      [DISPUTED_SOURCE]: { type: "geojson", data: disputedAreasGeoJson() as never },
      [COUNTRY_SOURCE]: { type: "geojson", data: outlineLabels(locale) as never },
      ...tileSources,
    },
    layers: [
      { id: BACKGROUND_LAYER, type: "background", paint: { "background-color": ink(token, "surface-sunken") } },
      { id: OUTLINE_LAND_LAYER, type: "fill", source: OUTLINE_SOURCE, paint: { "fill-color": ink(token, "surface") } },
      {
        id: OUTLINE_BORDER_LAYER,
        type: "line",
        source: OUTLINE_SOURCE,
        paint: {
          "line-color": ink(token, "text-faint"),
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 8, 1.2],
        },
      },
      ...details.flatMap((detail) => geometryLayers(detailSource(detail), flavor)),
      {
        id: DISPUTED_HATCH_LAYER,
        type: "fill",
        source: DISPUTED_SOURCE,
        filter: DISPUTED_AREA_FILTER as never,
        paint: { "fill-pattern": DISPUTED_HATCH_IMAGE, "fill-opacity": 0.9 },
      },
      {
        id: DISPUTED_LINE_LAYER,
        type: "line",
        source: DISPUTED_SOURCE,
        filter: DISPUTED_AREA_FILTER as never,
        paint: {
          "line-color": ink(token, "data"),
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1.1, 8, 2],
          "line-dasharray": [2, 1.5],
        },
      },
      {
        id: DISPUTED_POINT_LAYER,
        type: "symbol",
        source: DISPUTED_SOURCE,
        filter: DISPUTED_POINT_FILTER as never,
        layout: { "icon-image": DISPUTED_POINT_IMAGE, "icon-size": 1, "icon-allow-overlap": true },
      },
      {
        id: PICK_INSTALLED_LAYER,
        type: "fill",
        source: OUTLINE_SOURCE,
        filter: installedFilter([]) as never,
        layout: hidden,
        paint: { "fill-color": ink(token, "accent"), "fill-opacity": 0.14 },
      },
      {
        id: PICK_SELECTED_LAYER,
        type: "line",
        source: OUTLINE_SOURCE,
        filter: selectedFilter(null) as never,
        layout: hidden,
        paint: { "line-color": ink(token, "accent-strong"), "line-width": 2 },
      },
      ...details.flatMap((detail) => labelLayers(detailSource(detail), { token, fonts, locale })),
      {
        id: COUNTRY_LABEL_LAYER,
        type: "symbol",
        source: COUNTRY_SOURCE,
        maxzoom: 7,
        layout: {
          "text-field": ["get", "name"],
          "text-font": [...fonts],
          "text-size": ["interpolate", ["linear"], ["zoom"], 1, 10, 6, 15],
          "text-max-width": 7,
          "text-padding": 4,
          "symbol-sort-key": ["get", "rank"],
        },
        paint: {
          "text-color": ink(token, "text-muted"),
          "text-halo-color": ink(token, "surface-raised"),
          "text-halo-width": HALO.width,
          "text-halo-blur": HALO.blur,
        },
      },
    ],
  };
}
