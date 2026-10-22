import { describe, expect, it } from "vitest";

import { CONTINENTS, regionById } from "../../shared/world/outline.js";
import { regionName, regionScopes, territoryName } from "./names.js";

function territory(id: string) {
  const region = regionById(id);
  if (region === undefined) throw new Error(`no territory ${id}`);
  return region;
}

describe("territoryName", () => {
  it("names a territory in the reader's language through its ISO code", () => {
    expect(territoryName(territory("SRB"), "sr")).toBe("Srbija");
    expect(territoryName(territory("SRB"), "en")).toBe("Serbia");
  });

  it("falls back to the outline's English name where there is no ISO code", () => {
    expect(territoryName(territory("SOL"), "sr")).toBe("Somaliland");
    expect(territoryName(territory("SOL"), "en")).toBe("Somaliland");
  });
});

describe("regionName", () => {
  it("names the world and a continent from the copy table", () => {
    expect(regionName("world", "en")).toBe("The whole world");
    expect(regionName("continent:Europe", "sr")).toBe("Evropa");
    expect(regionName("continent:Seven seas (open ocean)", "en")).toBe("The open sea");
  });

  it("names every continent the outline carries, in both languages", () => {
    for (const continent of CONTINENTS) {
      expect(regionName(`continent:${continent}`, "sr")).not.toBe(`continent:${continent}`);
      expect(regionName(`continent:${continent}`, "en")).not.toBe(`continent:${continent}`);
    }
  });

  it("names a territory by its id", () => {
    expect(regionName("SRB", "sr")).toBe("Srbija");
  });

  it("answers an unknown id with the id itself", () => {
    expect(regionName("XXX", "en")).toBe("XXX");
  });
});

describe("regionScopes", () => {
  it("offers the territory, its continent and the world, in that order", () => {
    expect(regionScopes(territory("SRB"))).toEqual(["SRB", "continent:Europe", "world"]);
  });

  it("leaves the open sea out of the continent step", () => {
    expect(regionScopes(territory("MUS"))).toEqual(["MUS", "world"]);
  });

  it("leaves Antarctica out of the continent step", () => {
    expect(regionScopes(territory("ATA"))).toEqual(["ATA", "world"]);
  });
});
