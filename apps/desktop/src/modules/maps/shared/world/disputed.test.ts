import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { disputedAreas, disputesWithin } from "./disputed.js";

describe("the disputed layer", () => {
  it("has unique kebab-case ids and exactly the shipped properties", () => {
    const ids = disputedAreas.map((area) => area.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const area of disputedAreas) {
      expect(area.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(Object.keys(area).sort()).toEqual(["geometry", "id", "name", "note", "parties", "within"]);
    }
  });

  it("contains the decided oblasts, the four points, and no replaced records", () => {
    for (const id of ["donetsk-oblast", "luhansk-oblast", "zaporizhzhia-oblast", "kherson-oblast"]) {
      expect(disputedAreas.find((area) => area.id === id), id).toBeDefined();
    }
    for (const id of ["senkaku-diaoyu-islands", "liancourt-rocks", "scarborough-shoal", "machias-seal-island"]) {
      expect(disputedAreas.find((area) => area.id === id)?.geometry.type, id).toBe("Point");
    }
    expect(disputedAreas.some((area) => area.name === "Ilemi Triange")).toBe(false);
    expect(disputedAreas.some((area) => area.name === "Donetsk People's Republic")).toBe(false);
    expect(disputedAreas.some((area) => area.name === "Luhansk People's Republic")).toBe(false);
  });

  it("lists an area on the territories it is in, not on every neighbour along its border", () => {
    const within = (id: string) => disputedAreas.find((area) => area.id === id)?.within;

    expect(within("kosovo")).toEqual(["KOS"]);
    expect(within("gaza")).toEqual(["PSX"]);
    expect(within("western-sahara")).not.toContain("MRT");
    expect(within("luhansk-oblast")).toEqual(["UKR"]);
  });

  it("names every area in English words, with no source abbreviation and no claimant's own name for it", () => {
    for (const area of disputedAreas) {
      expect(area.name, area.id).not.toMatch(/\b(?:Is|I|Ter|USNB|NSF|W|N|S|Br)\.(?:\s|$)/);
    }
    expect(disputedAreas.some((area) => area.name === "Guayana Esequiba")).toBe(false);
    expect(disputedAreas.some((area) => area.name === "Turkish Republic of Northern Cyprus")).toBe(false);
    expect(disputedAreas.some((area) => area.name === "Hans Island")).toBe(false);
  });

  it("stays under the 250 000-byte ceiling", () => {
    const bytes = readFileSync(new URL("./disputed.json", import.meta.url)).byteLength;

    expect(bytes).toBeLessThan(250_000);
  });

  it("is a precomputed lookup, not a geometry pass", () => {
    for (const id of ["KOS", "RUS", "SDN", "SAH"]) {
      expect(disputesWithin(id).every((area) => area.within.includes(id))).toBe(true);
    }
  });
});
