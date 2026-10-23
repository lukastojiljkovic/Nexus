import { PbfWriter } from "pbf";
import { zxyToTileId } from "pmtiles";
import { describe, expect, it } from "vitest";

import type { MapPlace } from "@nexus/core";
import {
  INDEX_MAX_TILES,
  indexTiles,
  mergePlaces,
  placeFromFeature,
  placesFromTile,
  readRegionPlaces,
} from "./placeIndex.js";

const EXTENT = 4096;

/** A point of an encoded tile: its tile-unit position and the tags it carries. */
interface EncodedPoint {
  readonly id?: number;
  readonly x: number;
  readonly y: number;
  readonly props: Record<string, string | number>;
}

function zigzag(value: number): number {
  return (value << 1) ^ (value >> 31);
}

/** One `places` layer of an MVT tile, written by the MVT spec's own field numbers. */
function encodeTile(points: readonly EncodedPoint[], layerName = "places"): Uint8Array {
  const keys: string[] = [];
  const values: (string | number)[] = [];
  const indexIn = <T extends string | number>(list: T[], value: T): number => {
    const found = list.indexOf(value);
    if (found !== -1) return found;
    list.push(value);
    return list.length - 1;
  };
  const features = points.map((point) => {
    const tags: number[] = [];
    for (const [key, value] of Object.entries(point.props)) {
      tags.push(indexIn(keys, key), indexIn(values, value));
    }
    return { point, tags };
  });
  const writer = new PbfWriter();
  writer.writeMessage(3, writeLayer, { layerName, features, keys, values });
  return writer.finish();

  function writeLayer(
    layer: {
      layerName: string;
      features: { point: EncodedPoint; tags: number[] }[];
      keys: string[];
      values: (string | number)[];
    },
    pbf: PbfWriter,
  ): void {
    pbf.writeStringField(1, layer.layerName);
    for (const feature of layer.features) pbf.writeMessage(2, writeFeature, feature);
    for (const key of layer.keys) pbf.writeStringField(3, key);
    for (const value of layer.values) pbf.writeMessage(4, writeValue, value);
    pbf.writeVarintField(5, EXTENT);
    pbf.writeVarintField(15, 2);
  }
}

function writeFeature(feature: { point: EncodedPoint; tags: number[] }, pbf: PbfWriter): void {
  const { point, tags } = feature;
  if (point.id !== undefined) pbf.writeVarintField(1, point.id);
  pbf.writePackedVarint(2, tags);
  pbf.writeVarintField(3, 1);
  // MoveTo (command 1, count 1) = 9, then the position as zigzag deltas from the origin.
  pbf.writePackedVarint(4, [9, zigzag(point.x), zigzag(point.y)]);
}

function writeValue(value: string | number, pbf: PbfWriter): void {
  if (typeof value === "string") pbf.writeStringField(1, value);
  else pbf.writeDoubleField(3, value);
}

/** Where a longitude and latitude fall in a tile at `z`: the tile column and row, and the point inside it. */
function tilePosition(lon: number, lat: number, z: number) {
  const n = 2 ** z;
  const fx = ((lon + 180) / 360) * n;
  const radians = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * n;
  return {
    x: Math.floor(fx),
    y: Math.floor(fy),
    px: Math.round((fx - Math.floor(fx)) * EXTENT),
    py: Math.round((fy - Math.floor(fy)) * EXTENT),
  };
}

function place(over: Partial<MapPlace> = {}): MapPlace {
  return {
    id: 1,
    name: "Čačak",
    nameCyr: "Чачак",
    nameEn: "Cacak",
    kind: "city",
    lat: 43.89,
    lon: 20.35,
    population: 73000,
    ...over,
  };
}

describe("indexTiles", () => {
  it("reads Serbia at zoom 8 for the overview", () => {
    const tiles = indexTiles("SRB", "overview");
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every(([z]) => z === 8)).toBe(true);
  });

  it("reads Serbia at zoom 10 for the towns", () => {
    const tiles = indexTiles("SRB", "towns");
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every(([z]) => z === 10)).toBe(true);
  });

  it("keeps the whole world within the tile budget at the overview", () => {
    expect(indexTiles("world", "overview").length).toBeLessThanOrEqual(INDEX_MAX_TILES);
  });

  it("keeps a continent within the tile budget at the towns detail", () => {
    expect(indexTiles("continent:Europe", "towns").length).toBeLessThanOrEqual(INDEX_MAX_TILES);
  });

  it("lists every tile once, sorted by tile id", () => {
    const ids = indexTiles("continent:Europe", "towns").map(([z, x, y]) => zxyToTileId(z, x, y));
    expect(ids).toEqual([...new Set(ids)].sort((a, b) => a - b));
  });

  it("reads no tiles for an id that names no territory", () => {
    expect(indexTiles("XXX", "towns")).toEqual([]);
  });

  it("never reads deeper than the detail allows", () => {
    expect(indexTiles("SRB", "full").every(([z]) => z <= 10)).toBe(true);
  });
});

describe("placeFromFeature", () => {
  it("reads Belgrade as Latin with its Cyrillic and English spellings", () => {
    const belgrade = placeFromFeature(
      {
        name: "Београд",
        "name:sr": "Београд",
        "name:sr-Latn": "Beograd",
        "name:en": "Belgrade",
        script: "Cyrillic",
        kind: "locality",
        kind_detail: "city",
        population: 1197714,
      },
      20.4568974,
      44.8178131,
      7,
    );
    expect(belgrade).toEqual({
      id: 7,
      name: "Beograd",
      nameCyr: "Београд",
      nameEn: "Belgrade",
      kind: "city",
      lat: 44.8178131,
      lon: 20.4568974,
      population: 1197714,
    });
  });

  it("uses Serbian names before the local label and never substitutes Croatian", () => {
    expect(
      placeFromFeature(
        {
          name: "Приштина",
          "name:sr": "Приштина",
          "name:sr-Latn": "Priština",
          "name:hr": "Priština",
          script: "Cyrillic",
          kind: "locality",
          kind_detail: "city",
        },
        21.17,
        42.67,
        8,
      )?.name,
    ).toBe("Priština");
    expect(
      placeFromFeature(
        {
          name: "Топола",
          "name:sr": "Топола",
          "name:hr": "Topola",
          script: "Cyrillic",
          kind: "locality",
          kind_detail: "town",
        },
        20.68,
        44.25,
        9,
      )?.name,
    ).toBe("Топола");
  });

  it("keeps the local name when the data has no Serbian or English spelling", () => {
    const place = placeFromFeature({ name: "Ниш", script: "Cyrillic", kind: "locality", kind_detail: "city" }, 21.9, 43.3, 1);
    expect(place?.name).toBe("Ниш");
    expect(place?.nameEn).toBeNull();
  });

  it("keeps a Latin name as it is, since the data states no script for it", () => {
    const place = placeFromFeature({ name: "München", "name:en": "Munich", kind: "locality", kind_detail: "city" }, 11.58, 48.14, 1);
    expect(place?.name).toBe("München");
    expect(place?.nameCyr).toBeNull();
    expect(place?.nameEn).toBe("Munich");
  });

  it("names a macrohood a suburb", () => {
    expect(placeFromFeature({ name: "Vračar", kind: "macrohood" }, 20.47, 44.8, 1)?.kind).toBe("suburb");
  });

  it("skips a feature of an unknown kind", () => {
    expect(placeFromFeature({ name: "X", kind: "ocean" }, 0, 0, 1)).toBeNull();
  });

  it("skips a feature with no name", () => {
    expect(placeFromFeature({ kind: "locality", kind_detail: "city" }, 0, 0, 1)).toBeNull();
  });

  it("states no population for a negative or non-numeric one", () => {
    const base = { name: "Ćuprija", kind: "locality", kind_detail: "town" };
    expect(placeFromFeature({ ...base, population: -5 }, 21.3, 43.9, 1)?.population).toBeNull();
    expect(placeFromFeature({ ...base, population: "many" }, 21.3, 43.9, 1)?.population).toBeNull();
    expect(placeFromFeature({ ...base, population: 0 }, 21.3, 43.9, 1)?.population).toBe(0);
  });
});

describe("placesFromTile", () => {
  it("reads a real place back at its position to four decimals", () => {
    const { x, y, px, py } = tilePosition(20.4568974, 44.8178131, 10);
    const bytes = encodeTile([{ id: 42, x: px, y: py, props: { name: "Београд", script: "Cyrillic", kind: "locality", kind_detail: "city" } }]);
    const [belgrade] = placesFromTile(bytes, 10, x, y);
    expect(belgrade?.id).toBe(42);
    expect(belgrade?.lat).toBeCloseTo(44.8178131, 4);
    expect(belgrade?.lon).toBeCloseTo(20.4568974, 4);
    expect(belgrade?.name).toBe("Београд");
  });

  it("drops a point that lies in the tile's buffer", () => {
    const { x, y, px, py } = tilePosition(20.4568974, 44.8178131, 10);
    const props = { name: "Zemun", kind: "locality", kind_detail: "town" };
    const bytes = encodeTile([
      { x: px, y: py, props },
      { x: -10, y: py, props },
      { x: px, y: EXTENT + 10, props },
    ]);
    expect(placesFromTile(bytes, 10, x, y)).toHaveLength(1);
  });

  it("answers a tile with no places layer with no places", () => {
    expect(placesFromTile(encodeTile([{ x: 1, y: 1, props: { name: "X", kind: "locality" } }], "roads"), 10, 0, 0)).toEqual([]);
  });

  it("gives a place with no positive feature id the id zero", () => {
    const bytes = encodeTile([{ x: 100, y: 100, props: { name: "Mali Zvornik", kind: "locality", kind_detail: "town" } }]);
    expect(placesFromTile(bytes, 10, 0, 0).map((row) => row.id)).toEqual([0]);
  });
});

describe("mergePlaces", () => {
  it("keeps the first copy of a place that two lists both carry", () => {
    const first = place({ id: 5 });
    const second = place({ id: 9 });
    const merged = mergePlaces([[first], [second, place({ id: 10, name: "Ivanjica", lat: 43.59, lon: 20.23 })]]);
    expect(merged.map((row) => row.id)).toEqual([5, 10]);
  });

  it("keeps one Belgrade when the world's index reads it at zoom 5 and Serbia's at zoom 10", () => {
    const read = (z: number) => {
      const { x, y, px, py } = tilePosition(20.4568974, 44.8178131, z);
      const props = { name: "Београд", "name:hr": "Beograd", script: "Cyrillic", kind: "locality", kind_detail: "city" };
      return placesFromTile(encodeTile([{ x: px, y: py, props }]), z, x, y);
    };
    expect(mergePlaces([read(10), read(5)])).toHaveLength(1);
  });

  it("keeps two places of one name and kind that are towns apart", () => {
    const merged = mergePlaces([[place({ id: 1, name: "Lipnica", kind: "village", lat: 44.55, lon: 19.25 })], [place({ id: 2, name: "Lipnica", kind: "village", lat: 43.95, lon: 20.4 })]]);
    expect(merged).toHaveLength(2);
  });

  it("gives places with no feature id distinct negative ids", () => {
    const merged = mergePlaces([[place({ id: 0, name: "A" }), place({ id: 0, name: "B" }), place({ id: 3, name: "C" })]]);
    expect(merged.map((row) => row.id)).toEqual([-1, -2, 3]);
  });
});

describe("readRegionPlaces", () => {
  it("skips missing tiles and never has more than six reads in flight", async () => {
    const tiles = Array.from({ length: 20 }, (_, x) => [10, x, 0] as const);
    let inFlight = 0;
    let peak = 0;
    const archive = {
      getZxy: async (_z: number, x: number) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        if (x % 2 === 0) return undefined;
        const bytes = encodeTile([{ x: 2048, y: 2048, props: { name: `P${String(x)}`, kind: "locality", kind_detail: "town" } }]);
        return { data: bytes.buffer as ArrayBuffer };
      },
    };
    const places = await readRegionPlaces(archive, tiles);
    expect(places.map((row) => row.name)).toEqual(Array.from({ length: 10 }, (_, i) => `P${String(2 * i + 1)}`));
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
  });
});
