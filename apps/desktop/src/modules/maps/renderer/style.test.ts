import { remoteStyleUrls } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { regions as territories } from "../shared/world/outline.js";
import { disputedAreas } from "../shared/world/disputed.js";
import {
  BACKGROUND_LAYER,
  COUNTRY_LABEL_LAYER,
  DISPUTED_HATCH_IMAGE,
  DISPUTED_HATCH_LAYER,
  DISPUTED_LINE_LAYER,
  DISPUTED_POINT_IMAGE,
  DISPUTED_POINT_LAYER,
  DISPUTED_SOURCE,
  OUTLINE_LAND_LAYER,
  PICK_INSTALLED_LAYER,
  PICK_SELECTED_LAYER,
  fontStack,
  geometryLayers,
  labelLayers,
  labelText,
  mapFlavor,
  outlineAreas,
  outlineLabels,
  regionStyle,
  type MapLayer,
} from "./style.js";

/** A palette that names each token, so an assertion reads which token a colour came from. */
const token = (name: string) => `token(${name})`;
const FONTS = ["Segoe UI", "Noto Sans"];

/**
 * The few expression operators the label chain uses, evaluated against one
 * feature's properties: enough to read what a label says without a renderer.
 */
function evaluate(expression: unknown, properties: Record<string, string>): unknown {
  if (!Array.isArray(expression)) return expression;
  const [operator, ...args] = expression as [string, ...unknown[]];
  switch (operator) {
    case "get":
      return properties[args[0] as string] ?? null;
    case "has":
      return Object.hasOwn(properties, args[0] as string);
    case "coalesce":
      for (const arg of args) {
        const value = evaluate(arg, properties);
        if (value !== null) return value;
      }
      return null;
    case "case":
      for (let at = 0; at + 1 < args.length; at += 2) {
        if (evaluate(args[at], properties) === true) return evaluate(args[at + 1], properties);
      }
      return evaluate(args[args.length - 1], properties);
    default:
      throw new Error(`the test evaluator does not know "${operator}"`);
  }
}

const BELGRADE = {
  name: "Београд",
  "name:sr": "Београд",
  "name:sr-Latn": "Beograd",
  "name:en": "Belgrade",
  "name:hr": "Beograd",
  script: "Cyrillic",
};
const VILLAGE = { name: "Ђуринци", "name:en": "Đurinci", script: "Cyrillic" };
const MUNICH = { name: "München", "name:en": "Munich" };
const MOSCOW = { name: "Москва", "name:en": "Moscow", script: "Cyrillic" };

describe("labelText", () => {
  it("reads English names in English, and the local name where there is none", () => {
    expect(evaluate(labelText("en"), BELGRADE)).toBe("Belgrade");
    expect(evaluate(labelText("en"), { name: "Topola" })).toBe("Topola");
  });

  it("reads Serbian in Latin, then Serbian, then the local name", () => {
    expect(evaluate(labelText("sr"), BELGRADE)).toBe("Beograd");
    expect(evaluate(labelText("sr"), { name: "Topola", "name:sr": "Топола" })).toBe("Топола");
    expect(evaluate(labelText("sr"), VILLAGE)).toBe("Ђуринци");
    expect(evaluate(labelText("sr"), MUNICH)).toBe("München");
    expect(evaluate(labelText("sr"), MOSCOW)).toBe("Москва");
    expect(evaluate(labelText("sr"), { ...MOSCOW, "name:hr": "Moskva" })).toBe("Москва");
  });
});

describe("mapFlavor", () => {
  it("paints land, water, greenery and roads with the app's tokens", () => {
    const flavor = mapFlavor(token);
    expect(flavor.earth).toBe("token(surface)");
    expect(flavor.water).toBe("token(surface-sunken)");
    expect(flavor.wood_a).toBe("token(data-soft)");
    expect(flavor.highway).toBe("token(accent-soft)");
    expect(flavor.boundaries).toBe("token(text-faint)");
    expect(flavor.landcover?.forest).toBe("token(data-soft)");
  });

  it("refuses a token the document does not define, by name", () => {
    expect(() => mapFlavor((name) => (name === "surface-sunken" ? "" : `token(${name})`))).toThrow(/surface-sunken/);
  });
});

describe("geometryLayers", () => {
  const layers = geometryLayers("regions-towns", mapFlavor(token));

  it("draws from the given source under ids of its own, with no background and no text", () => {
    expect(layers.length).toBeGreaterThan(40);
    for (const layer of layers) {
      expect(layer.id.startsWith("regions-towns:")).toBe(true);
      expect(layer.type).not.toBe("background");
      expect(layer.type).not.toBe("symbol");
      expect("source" in layer && layer.source).toBe("regions-towns");
    }
  });
});

describe("labelLayers", () => {
  const layers = labelLayers("regions-full", { token, fonts: FONTS, locale: "sr" });
  const ids = layers.map((layer) => layer.id);
  const layout = (layer: MapLayer) => ("layout" in layer ? (layer.layout ?? {}) : {}) as Record<string, unknown>;
  const paint = (layer: MapLayer) => ("paint" in layer ? (layer.paint ?? {}) : {}) as Record<string, unknown>;

  it("keeps places, water, islands and road names, and drops icons, shields, POIs, addresses and countries", () => {
    expect(ids).toEqual(
      expect.arrayContaining([
        "regions-full:places_locality",
        "regions-full:places_subplace",
        "regions-full:places_region",
        "regions-full:water_label_ocean",
        "regions-full:water_label_lakes",
        "regions-full:water_waterway_label",
        "regions-full:earth_label_islands",
        "regions-full:roads_labels_major",
        "regions-full:roads_labels_minor",
      ]),
    );
    for (const dropped of ["pois", "roads_shields", "roads_oneway", "address_label", "places_country"]) {
      expect(ids).not.toContain(`regions-full:${dropped}`);
    }
  });

  it("writes every label in the locale's chain, in the UI's fonts, with no icon", () => {
    for (const layer of layers) {
      expect(layout(layer)["text-field"]).toEqual(labelText("sr"));
      expect(layout(layer)["text-font"]).toEqual(FONTS);
      expect(Object.keys(layout(layer)).filter((key) => key.startsWith("icon-"))).toEqual([]);
    }
  });

  it("centres a town's name where its dot was, and inks each kind from a token", () => {
    const locality = layers.find((layer) => layer.id === "regions-full:places_locality");
    expect(locality && layout(locality)["text-variable-anchor"]).toBeUndefined();
    expect(locality && layout(locality)["text-radial-offset"]).toBeUndefined();
    expect(locality && paint(locality)["text-color"]).toBe("token(text)");
    for (const layer of layers) expect(paint(layer)["text-halo-color"]).toBe("token(surface-raised)");
  });
});

describe("fontStack", () => {
  it("reads a CSS font-family list into names, without quotes", () => {
    expect(fontStack(`"Segoe UI Variable Text", "Segoe UI", Inter, system-ui, 'Noto Sans', sans-serif`)).toEqual([
      "Segoe UI Variable Text",
      "Segoe UI",
      "Inter",
      "system-ui",
      "Noto Sans",
      "sans-serif",
    ]);
    expect(fontStack("")).toEqual([]);
  });
});

describe("the outline", () => {
  it("has one area per territory, carrying its id", () => {
    const areas = outlineAreas();
    expect(areas.features).toHaveLength(territories.length);
    expect(areas.features.find((feature) => feature.properties.id === "SRB")?.geometry.type).toMatch(/Polygon/);
  });

  it("labels each territory at Natural Earth's label point, in the reader's language", () => {
    const serbia = outlineLabels("sr").features.find((feature) => feature.properties.id === "SRB");
    expect(serbia?.properties.name).toBe("Srbija");
    expect(serbia?.geometry.coordinates).toEqual(territories.find((region) => region.id === "SRB")?.label);
    expect(outlineLabels("en").features.find((feature) => feature.properties.id === "DEU")?.properties.name).toBe(
      "Germany",
    );
  });

  it("places a large territory's name before a small one's", () => {
    const rank = (id: string) =>
      outlineLabels("en").features.find((feature) => feature.properties.id === id)?.properties.rank ?? 0;
    expect(rank("RUS")).toBeLessThan(rank("SRB"));
    expect(rank("SRB")).toBeLessThan(rank("MNE"));
  });
});

describe("regionStyle", () => {
  const style = regionStyle({
    token,
    fonts: FONTS,
    locale: "en",
    sources: [
      { detail: "full", tiles: "nx-regions://full/{z}/{x}/{y}?v=1" },
      { detail: "overview", tiles: "nx-regions://overview/{z}/{x}/{y}?v=1" },
    ],
  });
  const ids = style.layers.map((layer) => layer.id);
  const at = (id: string) => ids.indexOf(id);
  const first = (prefix: string, type?: string) =>
    style.layers.findIndex((layer) => layer.id.startsWith(prefix) && (type === undefined || layer.type === type));
  const last = (prefix: string, type?: string) =>
    style.layers.findLastIndex((layer) => layer.id.startsWith(prefix) && (type === undefined || layer.type === type));

  it("declares one source per installed detail, at that detail's deepest zoom, and asks for no glyphs or sprite", () => {
    expect(style.sources["regions-full"]).toEqual({
      type: "vector",
      tiles: ["nx-regions://full/{z}/{x}/{y}?v=1"],
      maxzoom: 15,
    });
    expect(style.sources["regions-overview"]).toMatchObject({ maxzoom: 8 });
    expect(style.sources["regions-towns"]).toBeUndefined();
    expect(style.glyphs).toBeUndefined();
    expect(style.sprite).toBeUndefined();
  });

  it("draws the outline under the regions, the coarser detail under the finer, and every name above every shape", () => {
    expect(at(BACKGROUND_LAYER)).toBe(0);
    expect(at(OUTLINE_LAND_LAYER)).toBeLessThan(first("regions-overview:"));
    expect(last("regions-overview:", "fill")).toBeLessThan(first("regions-full:"));
    expect(last("regions-full:", "line")).toBeLessThan(at(PICK_INSTALLED_LAYER));
    expect(at(PICK_SELECTED_LAYER)).toBeLessThan(first("regions-overview:", "symbol"));
    expect(last("regions-full:", "symbol")).toBeLessThan(at(COUNTRY_LABEL_LAYER));
  });

  it("draws every dispute over the outline with a hatch, a dashed border and a dashed point", () => {
    expect(style.sources[DISPUTED_SOURCE]).toMatchObject({
      type: "geojson",
      data: expect.objectContaining({ type: "FeatureCollection" }),
    });
    const source = style.sources[DISPUTED_SOURCE];
    expect(source && "data" in source ? source.data : null).toMatchObject({
      features: expect.arrayContaining([expect.objectContaining({ id: "kosovo" })]),
    });

    const hatch = style.layers[at(DISPUTED_HATCH_LAYER)];
    expect(hatch).toMatchObject({
      type: "fill",
      source: DISPUTED_SOURCE,
      paint: { "fill-pattern": DISPUTED_HATCH_IMAGE },
    });
    expect(style.layers[at(DISPUTED_LINE_LAYER)]).toMatchObject({
      type: "line",
      source: DISPUTED_SOURCE,
      paint: { "line-dasharray": expect.any(Array) },
    });
    expect(style.layers[at(DISPUTED_POINT_LAYER)]).toMatchObject({
      type: "symbol",
      source: DISPUTED_SOURCE,
      layout: { "icon-image": DISPUTED_POINT_IMAGE },
    });
    expect(disputedAreas.length).toBeGreaterThan(0);
  });

  it("orders every dispute layer above the outline and below every label", () => {
    expect(at(OUTLINE_LAND_LAYER)).toBeLessThan(at(DISPUTED_HATCH_LAYER));
    expect(at(DISPUTED_HATCH_LAYER)).toBeLessThan(at(DISPUTED_LINE_LAYER));
    expect(at(DISPUTED_LINE_LAYER)).toBeLessThan(at(DISPUTED_POINT_LAYER));
    expect(at(DISPUTED_POINT_LAYER)).toBeLessThan(first("regions-overview:", "symbol"));
    expect(at(DISPUTED_POINT_LAYER)).toBeLessThan(at(COUNTRY_LABEL_LAYER));
  });

  it("names no address off this machine, which is what makes the map work offline", () => {
    expect(remoteStyleUrls(style)).toEqual([]);
  });

  it("hides the picker's layers until the page shows them", () => {
    for (const id of [PICK_INSTALLED_LAYER, PICK_SELECTED_LAYER]) {
      const layer = style.layers[at(id)];
      expect(layer && "layout" in layer && layer.layout).toMatchObject({ visibility: "none" });
    }
  });
});
