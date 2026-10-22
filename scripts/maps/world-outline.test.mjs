import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildOutline, simplifyRing } from "./world-outline.mjs";

/**
 * The outline builder, tested on a three-country fixture whose every case is
 * small enough to check by hand. The real Natural Earth file is never read
 * here: the build is run against it by hand, and its measured numbers are in
 * the README, not in a test.
 */

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/countries.geojson", import.meta.url)), "utf8"),
);

const TOLERANCE = 0.01;
const DECIMALS = 4;

const outline = () => buildOutline(fixture, { tolerance: TOLERANCE, decimals: DECIMALS });
const feature = (id) => outline().features.find((f) => f.id === id);

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
    expect(outline().features.map((f) => f.id)).toEqual(["AAA", "BBB", "CCC", "DDD"]);
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
