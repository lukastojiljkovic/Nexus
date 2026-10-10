import { describe, expect, it } from "vitest";
import { isRemoteStyleUrl, remoteStyleUrls, styleUrls } from "./style.js";

/**
 * Reading a style's addresses.
 *
 * The style below is a trimmed but real-shaped one: the positions it fills are
 * the ones `https://maplibre.org/maplibre-style-spec/` (read 2026-10-10) gives
 * an address to, and the map pack's own style fills the same ones with the pack
 * scheme. The two cases that matter are therefore the same style twice: once as
 * a pack would never ship it (`https://` everywhere) and once as it does
 * (`nx-pack://` and `pmtiles://nx-pack://`).
 */

const REMOTE_STYLE = {
  version: 8,
  glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
  sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/light",
  sources: {
    protomaps: {
      type: "vector",
      url: "https://api.protomaps.com/tiles/v4.json?key=x",
    },
    raster: {
      type: "raster",
      tiles: ["https://tiles.example.com/{z}/{x}/{y}.png", "nx-pack://map-serbia/local.png"],
    },
    places: {
      type: "geojson",
      data: "https://example.com/places.geojson",
    },
  },
  layers: [{ id: "earth", type: "fill", source: "protomaps", "source-layer": "earth" }],
};

const PACK_STYLE = {
  version: 8,
  glyphs: "nx-pack://map-serbia/fonts/{fontstack}/{range}.pbf",
  sprite: [{ id: "light", url: "nx-pack://map-serbia/sprites/light" }],
  sources: {
    protomaps: {
      type: "vector",
      url: "pmtiles://nx-pack://map-serbia/maps.pmtiles",
    },
    places: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  },
  layers: [{ id: "earth", type: "fill", source: "protomaps", "source-layer": "earth" }],
};

describe("a style's addresses", () => {
  it("finds every one, in document order, with the path it sits at", () => {
    expect(styleUrls(REMOTE_STYLE)).toEqual([
      {
        at: "glyphs",
        url: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
      },
      { at: "sprite", url: "https://protomaps.github.io/basemaps-assets/sprites/v4/light" },
      { at: "sources.protomaps.url", url: "https://api.protomaps.com/tiles/v4.json?key=x" },
      { at: "sources.raster.tiles[0]", url: "https://tiles.example.com/{z}/{x}/{y}.png" },
      { at: "sources.raster.tiles[1]", url: "nx-pack://map-serbia/local.png" },
      { at: "sources.places.data", url: "https://example.com/places.geojson" },
    ]);
  });

  it("keeps the four that would reach the network, and only those", () => {
    expect(remoteStyleUrls(REMOTE_STYLE)).toEqual([
      {
        at: "glyphs",
        url: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
      },
      { at: "sprite", url: "https://protomaps.github.io/basemaps-assets/sprites/v4/light" },
      { at: "sources.protomaps.url", url: "https://api.protomaps.com/tiles/v4.json?key=x" },
      { at: "sources.raster.tiles[0]", url: "https://tiles.example.com/{z}/{x}/{y}.png" },
      { at: "sources.places.data", url: "https://example.com/places.geojson" },
    ]);
  });

  it("passes a pack's own style, whose addresses are the pack and the archive inside it", () => {
    expect(styleUrls(PACK_STYLE)).toEqual([
      { at: "glyphs", url: "nx-pack://map-serbia/fonts/{fontstack}/{range}.pbf" },
      { at: "sprite[0].url", url: "nx-pack://map-serbia/sprites/light" },
      { at: "sources.protomaps.url", url: "pmtiles://nx-pack://map-serbia/maps.pmtiles" },
    ]);
    expect(remoteStyleUrls(PACK_STYLE)).toEqual([]);
  });

  it("reads a malformed style as no addresses rather than throwing", () => {
    // The answer here feeds a refusal, so it has to be an answer: a style this
    // function cannot read is refused by the renderer, which owns what a style
    // IS - not by a `TypeError` on the page.
    expect(styleUrls(null)).toEqual([]);
    expect(styleUrls("style.json")).toEqual([]);
    expect(styleUrls({ sources: [], glyphs: 12, sprite: {} })).toEqual([]);
    expect(styleUrls({ sources: { a: { tiles: [1, "nx-pack://x/y"] } } })).toEqual([
      { at: "sources.a.tiles[1]", url: "nx-pack://x/y" },
    ]);
  });

  it("calls https, http and protocol-relative remote, and everything else local", () => {
    expect(isRemoteStyleUrl("https://example.com/a")).toBe(true);
    expect(isRemoteStyleUrl("http://example.com/a")).toBe(true);
    expect(isRemoteStyleUrl("//example.com/a")).toBe(true);
    expect(isRemoteStyleUrl("nx-pack://map-serbia/a")).toBe(false);
    expect(isRemoteStyleUrl("pmtiles://nx-pack://map-serbia/a")).toBe(false);
    expect(isRemoteStyleUrl("/local/a")).toBe(false);
  });
});
