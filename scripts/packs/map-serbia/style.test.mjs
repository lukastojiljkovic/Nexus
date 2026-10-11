import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LABEL_FONT_STACK,
  assertLocalStyle,
  flavourFor,
  fontStacksIn,
  labelLayers,
  packStyle,
  remoteStyleUrls,
  styleUrls,
} from "./style.mjs";
import { kebab, readTokenFiles, resolveToken, semanticTokens } from "./tokens.mjs";

/**
 * The style: the vendor's geometry painted with this app's tokens, our own
 * labels, and every address in the pack.
 *
 * Two fixtures, both real. `protomaps-style-5.7.2.json` is a cut of the style
 * `@protomaps/basemaps` 5.7.2 generates — thirteen of its seventy-one layers,
 * kept verbatim, including its `places_locality` layer whose text-field is the
 * per-language expression this builder deliberately does not use, and both
 * address forms a style can carry. The token files are the app's own, read from
 * `packages/tokens` rather than copies, which is what makes "the map wears the
 * palette" a fact rather than a promise.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const FIXTURES = join(HERE, "fixtures");

const VENDOR_STYLE = JSON.parse(readFileSync(join(FIXTURES, "protomaps-style-5.7.2.json"), "utf8"));
const TOKENS = readTokenFiles(REPO_ROOT);

/** The vendor's own flavour, as the builder gets it from the package it downloads. */
const VENDOR_FLAVOUR = JSON.parse(
  readFileSync(join(FIXTURES, "protomaps-flavour-light.json"), "utf8"),
);

const REGION = {
  center: { lon: 20.5, lat: 44.2 },
  zoom: 7,
  bounds: [18.8, 42.2, 23.0, 46.2],
};

const FILES = {
  tiles: "maps.pmtiles",
  labels: "labels.geojson",
  glyphs: "fonts/{fontstack}/{range}.pbf",
};

describe("the app's tokens", () => {
  it("resolves the semantic layer of both themes through their references", () => {
    // `dan.json` says `bg: "{color.paper.100}"` and `global.json` says
    // `paper.100 = #f7f4ee`; `noc.json` says `bg: "{color.night.950}"` and
    // `night.950 = #070911`. These are the app's own published values.
    expect(TOKENS.dan.bg).toBe("#f7f4ee");
    expect(TOKENS.dan["surface-alt"]).toBe("#efeadd");
    expect(TOKENS.dan["data-soft"]).toBe("#e1f0e7");
    expect(TOKENS.noc.bg).toBe("#070911");
    expect(TOKENS.noc.surface).toBe("#101426");
    expect(TOKENS.noc["text-faint"]).toBe("#6f7490");
  });

  it("kebabs a semantic name the way the app's stylesheet does", () => {
    expect(kebab("surfaceAlt")).toBe("surface-alt");
    expect(kebab("textMuted")).toBe("text-muted");
    expect(kebab("bg")).toBe("bg");
  });

  it("refuses a reference it cannot resolve instead of shipping braces to MapLibre", () => {
    expect(resolveToken("{color.paper.100}", new Map([["color.paper.100", "#fffdf9"]]))).toBe("#fffdf9");
    expect(resolveToken("#123456", new Map())).toBe("#123456");
    expect(() => resolveToken("{color.nope.1}", new Map())).toThrow(/not defined/);
    expect(() => resolveToken("{a.b}", new Map([["a.b", "{c.d}"]]))).toThrow(/another reference/);
  });

  it("reads a theme's semantic layer whole", () => {
    const semantic = semanticTokens(
      { color: { paper: { "100": "#f7f4ee" } } },
      { semantic: { bg: "{color.paper.100}", shadow: "none" } },
    );
    expect(semantic).toEqual({ bg: "#f7f4ee", shadow: "none" });
  });
});

describe("the flavour our palette paints", () => {
  const flavour = flavourFor(TOKENS.dan, VENDOR_FLAVOUR);

  it("paints the water, the land and the buildings with the palette's own values", () => {
    // The app's Dan tokens: `surface-sunken` is #e9e2d1, `surface` is #fffdf9,
    // `border` is #d5cbb2 and `accent-soft` is #f3ead1.
    expect(flavour.water).toBe(TOKENS.dan["surface-sunken"]);
    expect(flavour.earth).toBe(TOKENS.dan.surface);
    expect(flavour.background).toBe(TOKENS.dan["surface-alt"]);
    expect(flavour.buildings).toBe(TOKENS.dan.border);
    expect(flavour.highway).toBe(TOKENS.dan["accent-soft"]);
    expect(flavour.boundaries).toBe(TOKENS.dan["text-faint"]);
    expect(flavour.park_b).toBe(TOKENS.dan["data-soft"]);
  });

  it("paints the landcover matrix too, since the vendor keeps seven colours inside one key", () => {
    expect(flavour.landcover.forest).toBe(TOKENS.dan["data-soft"]);
    expect(flavour.landcover.urban_area).toBe(TOKENS.dan["surface-alt"]);
    expect(flavour.landcover.barren).toBe(TOKENS.dan["border-subtle"]);
  });

  it("paints the second theme from the second theme's tokens, with no colour of its own", () => {
    const nocturne = flavourFor(TOKENS.noc, VENDOR_FLAVOUR);
    expect(nocturne.water).toBe(TOKENS.noc["surface-sunken"]);
    expect(nocturne.earth).toBe(TOKENS.noc.surface);
    expect(nocturne.earth).not.toBe(flavour.earth);
  });

  it("refuses a palette missing the token a key needs, rather than painting a vendor colour", () => {
    expect(() => flavourFor({ bg: "#fff" }, VENDOR_FLAVOUR)).toThrow(/surface-alt/);
  });
});

describe("our own labels", () => {
  const layers = labelLayers(TOKENS.dan, [4, 5, 11, 13]);

  it("makes one layer per rung, each with the rung as its own minzoom", () => {
    expect(layers.map((layer) => layer.id)).toEqual([
      "nexus-labels-4",
      "nexus-labels-5",
      "nexus-labels-11",
      "nexus-labels-13",
    ]);
    expect(layers.map((layer) => layer.minzoom)).toEqual([4, 5, 11, 13]);
    expect(layers.map((layer) => layer.filter)).toEqual([
      ["==", ["get", "minZoom"], 4],
      ["==", ["get", "minZoom"], 5],
      ["==", ["get", "minZoom"], 11],
      ["==", ["get", "minZoom"], 13],
    ]);
  });

  it("draws the place's name from the label file, in the one font stack the pack ships", () => {
    for (const layer of layers) {
      expect(layer["source-layer"]).toBeUndefined();
      expect(layer.source).toBe("labels");
      expect(layer.layout["text-field"]).toEqual(["get", "name"]);
      expect(layer.layout["text-font"]).toEqual([LABEL_FONT_STACK]);
      expect(layer.layout["text-allow-overlap"]).toBe(false);
    }
  });

  it("gives a country the muted ink, a city the body ink and a village the subtle one", () => {
    expect(layers[0]?.paint["text-color"]).toBe(TOKENS.dan["text-muted"]);
    expect(layers[1]?.paint["text-color"]).toBe(TOKENS.dan.text);
    expect(layers[3]?.paint["text-color"]).toBe(TOKENS.dan["text-subtle"]);
    expect(layers[0]?.paint["text-halo-color"]).toBe(TOKENS.dan["surface-raised"]);
  });

  it("grows the type with the zoom, which is the one place a camera expression is allowed", () => {
    expect(layers[1]?.layout["text-size"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      6,
      11,
      12,
      15,
    ]);
    // A country's label is the larger one, and it is sized from its own rung.
    expect(layers[0]?.layout["text-size"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      4,
      12,
      8,
      15,
    ]);
  });
});

describe("a style's addresses", () => {
  it("finds all three in the vendored style, with the paths they sit at", () => {
    expect(styleUrls(VENDOR_STYLE)).toEqual([
      {
        at: "glyphs",
        url: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
      },
      { at: "sprite", url: "https://protomaps.github.io/basemaps-assets/sprites/v4/light" },
      {
        at: "sources.protomaps.url",
        url: "https://api.protomaps.com/tiles/v4.json?key=EXAMPLE",
      },
    ]);
    expect(remoteStyleUrls(VENDOR_STYLE)).toHaveLength(3);
  });

  it("reads the font stacks a vendored style's label layers can ask for", () => {
    // `roads_labels_major` names the stack as an array, `places_country` as one
    // string, and `places_locality` hides two of them inside a `case` - which is
    // why the extractor only trusts a `literal` inside an expression.
    expect(fontStacksIn(VENDOR_STYLE)).toEqual(["Noto Sans Medium", "Noto Sans Regular"]);
  });

  it("refuses a style that would fetch from the network, naming every address", () => {
    expect(() => assertLocalStyle(VENDOR_STYLE, "map-serbia")).toThrow(
      /sources\.protomaps\.url → https:\/\/api\.protomaps\.com/,
    );
  });
});

describe("the pack's style", () => {
  const style = packStyle({
    semantic: TOKENS.dan,
    geometryLayers: [{ id: "background", type: "background", paint: {} }],
    rungs: [5, 13],
    region: REGION,
    packId: "map-serbia",
    files: FILES,
  });

  it("points every address into the pack, and passes its own check", () => {
    expect(style.sources).toEqual({
      protomaps: {
        type: "vector",
        url: "pmtiles://nx-pack://map-serbia/maps.pmtiles",
      },
      labels: { type: "geojson", data: "nx-pack://map-serbia/labels.geojson" },
    });
    expect(style.glyphs).toBe("nx-pack://map-serbia/fonts/{fontstack}/{range}.pbf");
    expect(style.sprite).toBeUndefined();
    expect(remoteStyleUrls(style)).toEqual([]);
    expect(assertLocalStyle(style, "map-serbia")).toBe(style);
  });

  it("carries the region's own camera, so the app states no coordinate", () => {
    expect(style.center).toEqual([20.5, 44.2]);
    expect(style.zoom).toBe(7);
    expect(style.bounds).toEqual([18.8, 42.2, 23.0, 46.2]);
  });

  it("holds the vendor's geometry and our labels, in that order", () => {
    expect(style.layers.map((layer) => layer.id)).toEqual([
      "background",
      "nexus-labels-5",
      "nexus-labels-13",
    ]);
    expect(fontStacksIn(style)).toEqual([LABEL_FONT_STACK]);
  });

  it("refuses a style with too few addresses to be a map", () => {
    expect(() => assertLocalStyle({ version: 8, sources: {} }, "map-serbia")).toThrow(
      /needs a tile source, a label source and its glyphs/,
    );
  });
});
