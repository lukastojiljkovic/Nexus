import { describe, expect, it } from "vitest";
import type { GeoPoint } from "@nexus/core";
import {
  emptyCollection,
  locationFeatureCollection,
  measureLineCollection,
  measureMetres,
  measurePointCollection,
  pinColourExpression,
  pinsFeatureCollection,
  selectedPinCollection,
  styleCamera,
} from "./mapData.js";
import { MAPS_PIN_COLORS, type MapsPinView } from "../shared/ipc.js";

/**
 * What the page hands MapLibre, built as data.
 *
 * **The one defect these tests exist for is the coordinate order.** GeoJSON
 * writes `[longitude, latitude]` and every human says "latitude, longitude", so
 * a swap is the classic mistake in this kind of code — and it is invisible: a
 * swapped pair still draws a point, just 3 000 km away, off screen, with nothing
 * thrown. Every fixture below therefore has two coordinates that differ in sign
 * AND magnitude, so a swap moves the point somewhere a different assertion
 * reads.
 */

/** Beograd (node 60571493) and its neighbourhood, as real coordinates with opposite signs. */
const BEOGRAD: GeoPoint = { lat: 44.8178131, lon: 20.4568974 };
const SOUTH_WEST: GeoPoint = { lat: -33.8688, lon: -70.6693 };

function pin(over: Partial<MapsPinView> = {}): MapsPinView {
  return {
    id: "pin-1",
    title: "Vinarija",
    note: "Otvoreno do 18h",
    lat: BEOGRAD.lat,
    lon: BEOGRAD.lon,
    color: "suma",
    ...over,
  };
}

describe("the pins", () => {
  it("writes each pin as a point in [lon, lat] order, carrying its id and colour", () => {
    expect(pinsFeatureCollection([pin(), pin({ id: "pin-2", color: "bordo", ...SOUTH_WEST })])).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [20.4568974, 44.8178131] },
          properties: { id: "pin-1", color: "suma", title: "Vinarija" },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-70.6693, -33.8688] },
          properties: { id: "pin-2", color: "bordo", title: "Vinarija" },
        },
      ],
    });
  });

  it("answers nothing, rather than everything, when no pin is selected", () => {
    expect(selectedPinCollection([pin()], null)).toEqual(emptyCollection());
    expect(selectedPinCollection([pin()], "nobody")).toEqual(emptyCollection());
    const one = selectedPinCollection([pin(), pin({ id: "pin-2" })], "pin-2");
    expect(one.features).toHaveLength(1);
    expect(one.features[0]?.properties.id).toBe("pin-2");
  });
});

describe("the machine's own position", () => {
  it("is one point when there is a fix, and an empty source when there is none", () => {
    expect(locationFeatureCollection(null)).toEqual(emptyCollection());
    expect(locationFeatureCollection(SOUTH_WEST)).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-70.6693, -33.8688] },
          properties: {},
        },
      ],
    });
  });
});

describe("the measurement", () => {
  it("has points for every click and a line only from the second one", () => {
    expect(measurePointCollection([BEOGRAD]).features).toHaveLength(1);
    expect(measureLineCollection([BEOGRAD])).toEqual({ type: "FeatureCollection", features: [] });
    expect(measureLineCollection([])).toEqual({ type: "FeatureCollection", features: [] });

    const line = measureLineCollection([BEOGRAD, SOUTH_WEST]);
    expect(line.features).toHaveLength(1);
    expect(line.features[0]?.geometry.coordinates).toEqual([
      [20.4568974, 44.8178131],
      [-70.6693, -33.8688],
    ]);
  });

  it("adds the consecutive great-circle legs and nothing else", () => {
    const distance = (a: GeoPoint, b: GeoPoint): number =>
      Math.hypot(a.lat - b.lat, a.lon - b.lon);
    // Two legs of a three-point path: 3-4-5 and 6-8-10 if the legs were real
    // distances, and here they are the identity's own arithmetic: hypot(3,4) = 5
    // and hypot(6,8) = 10, so the sum is 15.
    const path: readonly GeoPoint[] = [
      { lat: 0, lon: 0 },
      { lat: 3, lon: 4 },
      { lat: 9, lon: 12 },
    ];
    expect(measureMetres(path, distance)).toBeCloseTo(15, 10);
    expect(measureMetres([{ lat: 0, lon: 0 }], distance)).toBe(0);
    expect(measureMetres([], distance)).toBe(0);
  });
});

describe("the pin colours", () => {
  it("builds a match expression over the palette, with the first swatch as the fallback", () => {
    const value = (color: string): string => `#${color}`;
    const expression = pinColourExpression(value);
    expect(expression).toEqual([
      "match",
      ["get", "color"],
      "zlato",
      "#zlato",
      "bronza",
      "#bronza",
      "maslina",
      "#maslina",
      "suma",
      "#suma",
      "zad",
      "#zad",
      "ruza",
      "#ruza",
      "bordo",
      "#bordo",
      "grafit",
      "#grafit",
      "#zlato",
    ]);
    // Eight arms and the fallback: a colour the wire refuses lands on the first
    // swatch rather than on MapLibre's default black. Two elements for the
    // operator and its input, two per arm, one fallback.
    expect(expression).toHaveLength(2 + MAPS_PIN_COLORS.length * 2 + 1);
  });
});

describe("the pack's own camera", () => {
  it("reads the two standard style fields", () => {
    expect(styleCamera({ center: [20.5, 44.8], zoom: 7 })).toEqual({
      center: { lon: 20.5, lat: 44.8 },
      zoom: 7,
    });
  });

  it("answers nothing for a style that states none, rather than inventing a viewpoint", () => {
    expect(styleCamera(null)).toBeNull();
    expect(styleCamera({})).toBeNull();
    expect(styleCamera({ center: [20.5], zoom: 7 })).toBeNull();
    expect(styleCamera({ center: [20.5, "44.8"], zoom: 7 })).toBeNull();
    expect(styleCamera({ center: [20.5, 44.8], zoom: Number.NaN })).toBeNull();
  });
});
