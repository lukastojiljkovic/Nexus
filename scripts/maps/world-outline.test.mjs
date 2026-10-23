import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DISPUTE_OVERRIDE_REASONS,
  MAX_DISPUTED_BYTES,
  buildDisputedAreas,
  buildOutline,
  classifyDisputedAreas,
  disputedParties,
  simplifyRing,
} from "./world-outline.mjs";

/**
 * The outline builder, tested on a three-country fixture whose every case is
 * small enough to check by hand. The real Natural Earth file is never read
 * here: the build is run against it by hand, and its measured numbers are in
 * the README, not in a test.
 */

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/countries.geojson", import.meta.url)), "utf8"),
);
/**
 * All 99 source records, with their real names, types, notes and labels. Their
 * tiny boxes are a test geometry: the census pins classification and overrides,
 * not the shape of Natural Earth's production polygons, which the CLI reads.
 */
const disputedCensus = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/disputed-areas.census.geojson", import.meta.url)), "utf8"),
);
const outline = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../apps/desktop/src/modules/maps/shared/world/outline.json", import.meta.url)),
    "utf8",
  ),
);

const TOLERANCE = 0.01;
const DECIMALS = 4;

const builtOutline = () => buildOutline(fixture, { tolerance: TOLERANCE, decimals: DECIMALS });
const feature = (id) => builtOutline().features.find((f) => f.id === id);

describe("simplifyRing", () => {
  it("drops a vertex within the tolerance and keeps the endpoints closed", () => {
    const ring = [
      [0, 0],
      [1, 0.0001],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ];

    expect(simplifyRing(ring, TOLERANCE)).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ]);
  });

  it("keeps a vertex that lies farther than the tolerance from its neighbours", () => {
    const ring = [
      [0, 0],
      [1, 0.5],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ];

    expect(simplifyRing(ring, TOLERANCE)).toContainEqual([1, 0.5]);
  });

  it("returns a ring whose first and last positions are the same point", () => {
    const simplified = simplifyRing(fixture.features[0].geometry.coordinates[0], TOLERANCE);

    expect(simplified[0]).toEqual(simplified[simplified.length - 1]);
  });
});

describe("buildOutline", () => {
  it("keeps one feature per record, with its ADM0_A3 as the id", () => {
    expect(builtOutline().features.map((f) => f.id)).toEqual(["AAA", "BBB", "CCC", "DDD"]);
  });

  it("keeps exactly the five properties the picker reads", () => {
    expect(Object.keys(feature("AAA").properties).sort()).toEqual(
      ["continent", "iso2", "iso3", "label", "name"],
    );
  });

  it("turns the -99 placeholder codes into null", () => {
    expect(feature("BBB").properties).toMatchObject({ iso2: null, iso3: null, name: "Beta" });
  });

  it("maps the Natural Earth fields to the outline's property names", () => {
    expect(feature("CCC").properties).toEqual({
      iso2: "CC",
      iso3: "CCC",
      name: "Gamma",
      continent: "Asia",
      label: [10, 10],
    });
  });

  it("rounds coordinates, labels included, to the named precision", () => {
    const beta = buildOutline({ features: [fixture.features[1]] }, { tolerance: TOLERANCE, decimals: 2 });

    expect(beta.features[0].properties.label).toEqual([5.12, 5]);
  });

  it("drops a ring that collapses below four positions and keeps the rest of its feature", () => {
    const coordinates = feature("CCC").geometry.coordinates;

    expect(coordinates).toHaveLength(1);
    expect(coordinates[0]).toHaveLength(1);
    expect(coordinates[0][0]).toEqual([
      [10, 10],
      [14, 10],
      [14, 14],
      [10, 14],
      [10, 10],
    ]);
  });

  it("never leaves a feature without a ring: its largest ring survives unsimplified", () => {
    const delta = feature("DDD");

    expect(delta.geometry.coordinates).toEqual([
      [
        [30, 30],
        [30.001, 30],
        [30.001, 30.001],
        [30, 30.001],
        [30, 30],
      ],
    ]);
  });
});


const UKRAINE_OBLASTS = [
  ["UA-14", "Donetsk", 37.5, 48],
  ["UA-09", "Luhansk", 39.2, 48.7],
  ["UA-23", "Zaporizhzhia", 35.5, 47],
  ["UA-65", "Kherson", 33.5, 46.5],
].map(([iso, name, lon, lat]) => ({
  type: "Feature",
  properties: { iso_3166_2: iso, name_en: name },
  geometry: {
    type: "Polygon",
    coordinates: [[
      [lon - 0.2, lat - 0.2],
      [lon + 0.2, lat - 0.2],
      [lon + 0.2, lat + 0.2],
      [lon - 0.2, lat + 0.2],
      [lon - 0.2, lat - 0.2],
    ]],
  },
}));

describe("disputed areas", () => {
  it("classifies every one of the 99 source records by exactly one named rule", () => {
    const { included, excluded } = classifyDisputedAreas(disputedCensus);

    expect(disputedCensus.features).toHaveLength(99);
    expect(included).toHaveLength(87);
    expect(excluded).toHaveLength(12);
    expect(included.length + excluded.length).toBe(99);
    expect(excluded.map((item) => item.name).sort()).toEqual(
      [
        "Artsakh",
        "Baykonur",
        "Donetsk People's Republic",
        "Hans Island",
        "Ilemi Triange",
        "Israel",
        "Korean islands under UN jurisdiction",
        "Korean Demilitarized Zone (north)",
        "Korean Demilitarized Zone (south)",
        "Luhansk People's Republic",
        "UNDOF Zone",
        "W. Sahara (Indeterminate)",
      ].sort(),
    );
  });

  it("records a reason for every source override and every added feature", () => {
    expect(Object.keys(DISPUTE_OVERRIDE_REASONS).sort()).toEqual(
      [
        "Artsakh",
        "Belize",
        "Bird Island",
        "Bir Tawil",
        "Ceuta",
        "Cyprus U.N. Buffer Zone",
        "Donetsk People's Republic",
        "Dragonja River",
        "Gaza",
        "Hans Island",
        "Israel",
        "Ilemi Triange",
        "Kosovo",
        "Liancourt Rocks",
        "Luhansk People's Republic",
        "Machias Seal Island",
        "Melilla",
        "North Borneo",
        "Scarborough Shoal",
        "Senkaku / Diaoyu Islands",
        "Spratly Is.",
        "UA-09",
        "UA-14",
        "UA-23",
        "UA-65",
        "Vukovar Island",
        "W. Sahara",
        "West Bank",
        "Šarengrad Island",
      ].sort(),
    );
    for (const [name, reason] of Object.entries(DISPUTE_OVERRIDE_REASONS)) {
      expect(reason.trim(), name).not.toBe("");
    }
  });

  it("reads administering states and claimants, deduplicated and in stable order", () => {
    expect(disputedParties("Admin. by India; Claimed by Pakistan", "Kashmir")).toEqual(["IND", "PAK"]);
    expect(disputedParties("Admin. By Israel; Claimed by Palestine", "East Jerusalem")).toEqual(["ISR", "PSX"]);
    expect(
      disputedParties("Claimed by China, Taiwan, Malaysia, the Philippines, and Brunei", "Spratly Is."),
    ).toEqual(["BRN", "CHN", "MYS", "PHL", "TWN"]);
  });

  it("fails an unknown party by name and by the feature that named it", () => {
    expect(() => disputedParties("Claimed by Atlantis", "Atlantis Rock")).toThrow(
      /Atlantis[\s\S]*Atlantis Rock/,
    );
  });

  it("builds Kosovo, Spratly and Bir Tawil as decided", () => {
    const built = buildDisputedAreas(disputedCensus, { features: UKRAINE_OBLASTS }, outline);
    const byName = (name) => built.features.find((area) => area.properties.name === name);

    expect(byName("Kosovo")?.properties.parties).toEqual(["KOS", "SRB"]);
    expect(byName("Spratly Islands")?.properties.parties).toContain("VNM");
    expect(byName("Bir Tawil")?.properties).toMatchObject({ parties: [], note: "unclaimed" });
    expect(byName("Ilemi Triangle")?.geometry.type).toBe("MultiPolygon");
    const westernSahara = built.features.filter((area) => area.properties.name === "Western Sahara");
    expect(westernSahara).toHaveLength(1);
    expect(westernSahara[0]?.geometry.type).toBe("MultiPolygon");
  });

  it("replaces the two breakaway polygons with four whole Ukrainian oblasts", () => {
    const built = buildDisputedAreas(disputedCensus, { features: UKRAINE_OBLASTS }, outline);
    const oblasts = built.features.filter((area) => area.id.endsWith("-oblast"));

    expect(oblasts.map((area) => area.properties.name)).toEqual([
      "Donetsk Oblast",
      "Luhansk Oblast",
      "Zaporizhzhia Oblast",
      "Kherson Oblast",
    ]);
    for (const oblast of oblasts) expect(oblast.properties.parties).toEqual(["RUS", "UKR"]);
    expect(built.features.some((area) => area.properties.name.includes("People's Republic"))).toBe(false);
  });

  it("adds the four island points at the specified coordinates", () => {
    const built = buildDisputedAreas(disputedCensus, { features: UKRAINE_OBLASTS }, outline);
    const points = new Map(
      built.features
        .filter((area) => area.geometry.type === "Point")
        .map((area) => [area.properties.name, area.geometry.coordinates]),
    );

    expect(points).toMatchObject(
      new Map([
        ["Senkaku / Diaoyu Islands", [123.48, 25.74]],
        ["Liancourt Rocks", [131.87, 37.24]],
        ["Scarborough Shoal", [117.76, 15.15]],
        ["Machias Seal Island", [-67.1, 44.5]],
      ]),
    );
  });

  it("stays under the shipped ceiling and gives every feature a stable unique slug", () => {
    const built = buildDisputedAreas(disputedCensus, { features: UKRAINE_OBLASTS }, outline);
    const ids = built.features.map((area) => area.id);
    const bytes = Buffer.byteLength(`${JSON.stringify(built)}\n`, "utf8");

    expect(bytes).toBeLessThan(MAX_DISPUTED_BYTES);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});
