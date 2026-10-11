import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_PLACE_NAME_LENGTH,
  appPlaceKinds,
  buildPlaces,
  labelRungs,
  labelsGeoJson,
  minZoomOf,
  placeFromNode,
  placesFile,
  populationOf,
} from "./places.mjs";

/**
 * The place converter, on real OSM nodes.
 *
 * `serbia-place-nodes.json` is a cut of an Overpass API answer, read 2026-10-10
 * with `node[place][name]` over six small bounding boxes around Beograd, Novi
 * Sad, Niš, Čačak, Kraljevo and Kraljevo's village of Grdica; the cut keeps the
 * tags this converter reads and drops the fifty-odd `name:*` translations the
 * Overpass reply carried. Every node id can be checked against
 * `https://www.openstreetmap.org/node/<id>`.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const KINDS = appPlaceKinds();

const OVERPASS = JSON.parse(readFileSync(join(FIXTURES, "serbia-place-nodes.json"), "utf8"));

/** The Overpass reply's nodes, in the shape the PBF reader yields. */
const NODES = OVERPASS.elements.map((entry) => ({
  id: entry.id,
  lat: entry.lat,
  lon: entry.lon,
  tags: entry.tags,
}));

function nodeOf(id) {
  const entry = NODES.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`fixture: no node ${String(id)}`);
  return entry;
}

describe("the app's own kind list", () => {
  it("is read out of the app's source, so the two cannot disagree", () => {
    // The app refuses a file carrying a kind it does not know, and it refuses it
    // whole - so the builder writes only kinds the app named, read from there.
    expect(KINDS).toHaveLength(18);
    expect(KINDS).toContain("city");
    expect(KINDS).toContain("locality");
  });

  it("refuses a file whose list it cannot find, rather than writing any kind it likes", () => {
    expect(() => appPlaceKinds("export const SOMETHING_ELSE = [];")).toThrow(/MAP_PLACE_KINDS/);
  });
});

describe("a node as a place", () => {
  it("reads Beograd's two scripts and its English name from the tags the node states", () => {
    // node 60571493: place=city, name=Београд, name:sr-Latn=Beograd,
    // name:en=Belgrade, population=1197714.
    expect(placeFromNode(nodeOf(60571493), KINDS)).toEqual({
      id: 60571493,
      name: "Beograd",
      nameCyr: "Београд",
      nameEn: "Belgrade",
      kind: "city",
      lat: 44.8178131,
      lon: 20.4568974,
      population: 1197714,
    });
  });

  it("keeps the diacritics of a Latin name and the Cyrillic of the same town", () => {
    expect(placeFromNode(nodeOf(254037025), KINDS)).toMatchObject({
      name: "Čačak",
      nameCyr: "Чачак",
      population: 69598,
    });
    expect(placeFromNode(nodeOf(100890898), KINDS)).toMatchObject({
      name: "Niš",
      nameCyr: "Ниш",
    });
  });

  it("reads a place whose name is Cyrillic and whose Serbian Latin tag is the Latin form", () => {
    // node 1883488000 (Ušće): name=Ушће (Cyrillic), name:sr-Latn=Ušće (Latin),
    // name:en=Ušće, and no population stated at all.
    expect(placeFromNode(nodeOf(1883488000), KINDS)).toEqual({
      id: 1883488000,
      name: "Ušće",
      nameCyr: "Ушће",
      nameEn: "Ušće",
      kind: "locality",
      lat: 44.8209873,
      lon: 20.436035,
      population: null,
    });
  });

  it("skips a node that is not a place, has no name, or is outside every bound", () => {
    expect(placeFromNode({ id: 1, lat: 44, lon: 20, tags: { amenity: "cafe" } }, KINDS)).toBeNull();
    expect(placeFromNode({ id: 1, lat: 44, lon: 20, tags: { place: "plot" } }, KINDS)).toBeNull();
    expect(placeFromNode({ id: 1, lat: 44, lon: 20, tags: { place: "city" } }, KINDS)).toBeNull();
    expect(
      placeFromNode(
        { id: 1, lat: 44, lon: 20, tags: { place: "city", name: "x".repeat(MAX_PLACE_NAME_LENGTH + 1) } },
        KINDS,
      ),
    ).toBeNull();
    expect(placeFromNode({ id: 0, lat: 44, lon: 20, tags: { place: "city", name: "X" } }, KINDS)).toBeNull();
  });

  it("trims a name and stores no empty optional string", () => {
    const place = placeFromNode(
      { id: 7, lat: 44, lon: 20, tags: { place: "village", name: "  Grdica  " } },
      KINDS,
    );
    expect(place).toMatchObject({ name: "Grdica", nameCyr: null, nameEn: null, population: null });
  });

  it("takes int_name for the Latin form when the node states no Serbian Latin name", () => {
    // Some nodes are named only in Cyrillic and carry their Latin spelling in
    // `int_name`; that is what it is for, and it is the last fallback before a
    // place is left out for having no name the map can draw.
    const place = placeFromNode(
      {
        id: 9,
        lat: 44.8,
        lon: 20.4,
        tags: { place: "city", name: "Београд", int_name: "Beograd", population: "1 197 714" },
      },
      KINDS,
    );
    expect(place).toMatchObject({ name: "Beograd", nameCyr: "Београд", population: 1197714 });
  });
});

describe("a population tag", () => {
  it("reads the forms OpenStreetMap actually carries", () => {
    expect(populationOf("1197714")).toBe(1197714);
    expect(populationOf("1 234")).toBe(1234);
    // Serbian groups thousands with a dot: "12.000" is twelve thousand, and an
    // English "12.345" is read the same way - a population is never a fraction.
    expect(populationOf("12.000")).toBe(12000);
    expect(populationOf("~1200")).toBeNull();
    expect(populationOf("about 1200")).toBeNull();
    // A trailing note after the number is read past: the number is the statement.
    expect(populationOf("1234 (2011)")).toBe(1234);
    expect(populationOf("unknown")).toBeNull();
    expect(populationOf(undefined)).toBeNull();
    expect(populationOf("0")).toBeNull();
  });
});

describe("the label ladder", () => {
  it("decides at which zoom a place is named", () => {
    // A city's rung follows its own population: 1.2 million names early, a few
    // thousand waits for the streets.
    expect(minZoomOf("city", 1_197_714)).toBe(5);
    expect(minZoomOf("city", 69_598)).toBe(6);
    expect(minZoomOf("city", null)).toBe(7);
    expect(minZoomOf("city", 1200)).toBe(8);
    expect(minZoomOf("town", 8_449)).toBe(10);
    expect(minZoomOf("town", 900)).toBe(11);
    expect(minZoomOf("village", 742)).toBe(11);
    expect(minZoomOf("quarter", null)).toBe(11);
    expect(minZoomOf("neighbourhood", null)).toBe(12);
    expect(minZoomOf("locality", null)).toBe(13);
    expect(minZoomOf("country", null)).toBe(2);
    expect(minZoomOf("plot", null)).toBeNull();
  });
});

describe("the whole pass", () => {
  const { places, skipped } = buildPlaces(NODES, KINDS);

  it("keeps the eight real places, in id order, and counts what it left out", () => {
    // In id order, which is the order the file is written in: Novi Sad is node
    // 59735022 and Beograd 60571493, so the capital is second.
    expect(places.map((place) => place.name)).toEqual([
      "Novi Sad",
      "Beograd",
      "Niš",
      "Čačak",
      "Kraljevo",
      "Grdica",
      "Dorćol",
      "Ušće",
    ]);
    expect(skipped).toEqual({ kind: 0, nameless: 0, long: 0, repeated: 0 });
  });

  it("writes the search index the app's reader takes", () => {
    const file = placesFile("serbia", places);
    expect(file.version).toBe(1);
    expect(file.region).toBe("serbia");
    expect(file.places[0]).toEqual({
      id: 59735022,
      name: "Novi Sad",
      nameCyr: "Нови Сад",
      nameEn: "Novi Sad",
      kind: "city",
      lat: 45.2551338,
      lon: 19.8451756,
      population: 260438,
    });
  });

  it("writes the label file the style's layers filter, in [lon, lat] order", () => {
    const labels = labelsGeoJson(places);
    const beograd = labels.features.find((feature) => feature.properties.name === "Beograd");
    expect(beograd).toEqual({
      type: "Feature",
      geometry: { type: "Point", coordinates: [20.4568974, 44.8178131] },
      properties: { name: "Beograd", kind: "city", minZoom: 5 },
    });
    expect(labels.features).toHaveLength(8);
    // Nothing but the three properties the style reads travels in the file.
    expect(Object.keys(beograd?.properties ?? {})).toEqual(["name", "kind", "minZoom"]);
  });

  it("reports the rungs the style needs a layer for", () => {
    expect(labelRungs(places)).toEqual([5, 6, 11, 13]);
  });

  it("drops a repeated node rather than offering the same point twice", () => {
    const twice = [NODES[1], NODES[1]].map((entry) => entry);
    const result = buildPlaces(twice, KINDS);
    expect(result.places).toHaveLength(1);
    expect(result.skipped.repeated).toBe(1);
  });
});
