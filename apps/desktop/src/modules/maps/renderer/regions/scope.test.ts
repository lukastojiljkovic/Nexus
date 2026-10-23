import { describe, expect, it } from "vitest";

import { regionBounds, regionsOfContinent, regions as territories } from "../../shared/world/outline.js";
import { coverBounds, installedTerritories } from "./scope.js";

describe("installedTerritories", () => {
  it("names the territories a set of installed regions covers", () => {
    expect(installedTerritories(["SRB"])).toEqual(["SRB"]);
    expect(installedTerritories(["continent:Europe"]).sort()).toEqual(
      regionsOfContinent("Europe")
        .map((region) => region.id)
        .sort(),
    );
    expect(installedTerritories(["world"])).toHaveLength(territories.length);
    expect(installedTerritories(["SRB", "continent:Europe"]).filter((id) => id === "SRB")).toHaveLength(1);
  });
});

describe("coverBounds", () => {
  it("boxes a territory, and a continent across all of its territories", () => {
    expect(coverBounds("SRB")).toEqual(regionBounds("SRB"));
    const europe = coverBounds("continent:Europe");
    expect(europe?.minLon).toBeLessThan(regionBounds("PRT").minLon + 1e-9);
    expect(europe?.maxLat).toBeGreaterThan(regionBounds("SRB").maxLat);
  });

  it("has no box for the world, or for an id the outline does not carry", () => {
    expect(coverBounds("world")).toBeNull();
    expect(coverBounds("XXX")).toBeNull();
  });
});
