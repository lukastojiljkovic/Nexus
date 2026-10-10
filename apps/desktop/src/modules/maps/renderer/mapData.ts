import type { GeoPoint } from "@nexus/core";
import {
  MAPS_PIN_COLORS,
  type MapsLocationView,
  type MapsPinColor,
  type MapsPinView,
} from "../shared/ipc.js";

/**
 * The four things the page hands MapLibre, built as data.
 *
 * **Why these are pure functions and not inline literals in the component.**
 * A GeoJSON feature is a shape with three nested levels, and the page builds
 * four kinds of them: the pins, the machine's own position, the measurement's
 * points and the line through them. Written inline, one of the four would
 * eventually carry `lng` where the others carry `lon` — a mistake that draws
 * nothing and throws nowhere, because a GeoJSON parser reads a missing key as
 * an empty coordinate and skips the feature. Here the shape is one function per
 * kind, each with its own test, and the component only decides WHEN.
 *
 * **Why the coordinates are `[lon, lat]`.** That is the GeoJSON specification's
 * order (RFC 7946 §3.1.1), the opposite of how a person says a coordinate, and
 * the single most common defect in map code. It is stated in this comment and
 * pinned by a test whose two values differ in sign AND magnitude, so a swap
 * cannot pass.
 */

/** A GeoJSON point feature, structurally. MapLibre's own type is the `@types/geojson` one, which this package cannot import directly. */
export interface MapPointFeature {
  readonly type: "Feature";
  readonly geometry: { readonly type: "Point"; readonly coordinates: readonly [number, number] };
  readonly properties: Readonly<Record<string, unknown>>;
}

/** A GeoJSON line feature, structurally. */
export interface MapLineFeature {
  readonly type: "Feature";
  readonly geometry: {
    readonly type: "LineString";
    readonly coordinates: readonly (readonly [number, number])[];
  };
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface MapPointCollection {
  readonly type: "FeatureCollection";
  readonly features: readonly MapPointFeature[];
}

export interface MapLineCollection {
  readonly type: "FeatureCollection";
  readonly features: readonly MapLineFeature[];
}

/** `[lon, lat]`, the order GeoJSON states. */
function position(point: GeoPoint): [number, number] {
  return [point.lon, point.lat];
}

/** An empty collection: what every source starts as, so `setData` never has to guess. */
export function emptyCollection(): MapPointCollection {
  return { type: "FeatureCollection", features: [] };
}

/**
 * The `circle-color` expression that paints each pin in its own swatch.
 *
 * **A match expression rather than eight layers.** The alternative — one layer
 * per colour, each filtered — is eight sources of truth for one rule, and the
 * page would then have to remove and re-add layers whenever a swatch changed.
 * The values come from the live tokens (`--nx-swatch-*`), so a pin's colour IS
 * the palette's colour in both themes; the fallback arm is the first swatch, and
 * it can only be reached by a row whose colour the wire refused.
 */
export function pinColourExpression(colourOf: (color: MapsPinColor) => string): readonly unknown[] {
  const arms: unknown[] = [];
  for (const color of MAPS_PIN_COLORS) arms.push(color, colourOf(color));
  return ["match", ["get", "color"], ...arms, colourOf(MAPS_PIN_COLORS[0])];
}

/** The pins, each carrying its own id and colour so the layer can paint and the page can select. */
export function pinsFeatureCollection(
  pins: readonly MapsPinView[],
): MapPointCollection {
  return {
    type: "FeatureCollection",
    features: pins.map((pin) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: position(pin) },
      properties: { id: pin.id, color: pin.color, title: pin.title },
    })),
  };
}

/** The pin that is selected right now, as a one-feature collection, or nothing when none is. */
export function selectedPinCollection(
  pins: readonly MapsPinView[],
  selectedId: string | null,
): MapPointCollection {
  const selected = pins.filter((pin) => pin.id === selectedId);
  return selected.length === 0 ? emptyCollection() : pinsFeatureCollection(selected);
}

/** Where the machine is, or nothing: `null` is "no fix", and an empty source is how a map says so. */
export function locationFeatureCollection(location: MapsLocationView | null): MapPointCollection {
  if (location === null) return emptyCollection();
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: position(location) },
        properties: {},
      },
    ],
  };
}

/** The measurement: one point per click, and a line through them when there are two or more. */
export function measurePointCollection(points: readonly GeoPoint[]): MapPointCollection {
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: position(point) },
      properties: {},
    })),
  };
}

/** The measurement's line, with `null` beyond the first point: one point is not a line. */
export function measureLineCollection(points: readonly GeoPoint[]): MapLineCollection {
  if (points.length < 2) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: points.map(position) },
        properties: {},
      },
    ],
  };
}

/** The whole length of a measurement in metres: the great-circle sum over its consecutive pairs. */
export function measureMetres(points: readonly GeoPoint[], distance: (a: GeoPoint, b: GeoPoint) => number): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) continue;
    total += distance(from, to);
  }
  return total;
}

/**
 * The camera a pack's style states for itself.
 *
 * A map style may carry `center` and `zoom` among its own fields
 * (`https://maplibre.org/maplibre-style-spec/`, read 2026-10-10), and the pack's
 * builder writes them from the region polygon it cut the tiles out of — so the
 * app never states a coordinate of Serbia, and a second region needs no line
 * here. `null` means the style states no camera, which is a style that has not
 * been built by this app's builder; the page then leaves the camera to the
 * renderer rather than inventing a viewpoint.
 */
export function styleCamera(style: unknown): { readonly center: GeoPoint; readonly zoom: number } | null {
  if (typeof style !== "object" || style === null) return null;
  const record = style as Record<string, unknown>;
  const center = record.center;
  const zoom = record.zoom;
  if (
    !Array.isArray(center) ||
    center.length < 2 ||
    typeof center[0] !== "number" ||
    typeof center[1] !== "number" ||
    typeof zoom !== "number" ||
    !Number.isFinite(zoom)
  ) {
    return null;
  }
  return { center: { lon: center[0], lat: center[1] }, zoom };
}
