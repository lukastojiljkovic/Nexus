import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  mapsDir,
  readJob,
  readRegions,
  regionFileName,
  removeJob,
  sweepRegionFiles,
  writeJob,
  writeRegions,
  type InstalledRegion,
} from "./registry.js";

let userData = "";

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "nexus-regions-"));
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

const SERBIA: InstalledRegion = {
  id: "SRB",
  detail: "full",
  build: "20261022",
  bytes: 399_280_064,
  file: "srb.20261022.full.pmtiles",
};

describe("the regions on this machine", () => {
  it("are none before anything was written, and read back what was", () => {
    expect(readRegions(userData)).toEqual([]);
    writeRegions(userData, [SERBIA]);
    expect(readRegions(userData)).toEqual([SERBIA]);
  });

  it("name a file only by the name the id, build and detail make", () => {
    expect(regionFileName("continent:Europe", "20261022", "towns")).toBe("continent-europe.20261022.towns.pmtiles");
    mkdirSync(mapsDir(userData), { recursive: true });
    writeFileSync(
      join(mapsDir(userData), "regions.json"),
      JSON.stringify({
        regions: [
          SERBIA,
          { ...SERBIA, id: "MNE", file: "../../nexus.db" },
          { ...SERBIA, id: "XXX", file: "xxx.20261022.full.pmtiles" },
          { ...SERBIA, id: "HRV", detail: "street", file: "hrv.20261022.street.pmtiles" },
          { ...SERBIA, id: "BIH", bytes: -1, file: "bih.20261022.full.pmtiles" },
        ],
      }),
    );
    expect(readRegions(userData)).toEqual([SERBIA]);
  });

  it("read as none from a file that is not the registry", () => {
    mkdirSync(mapsDir(userData), { recursive: true });
    writeFileSync(join(mapsDir(userData), "regions.json"), "{");
    expect(readRegions(userData)).toEqual([]);
  });
});

describe("a paused download's record", () => {
  it("is kept beside its partial file, and removed with it", () => {
    const job = { id: "SRB", detail: "full", build: "20261022", etag: '"abc"', bytes: 1000 } as const;
    writeJob(userData, job);
    writeFileSync(join(mapsDir(userData), "srb.part"), "partial");
    expect(readJob(userData, "SRB")).toEqual(job);
    removeJob(userData, "SRB");
    expect(readJob(userData, "SRB")).toBeNull();
    expect(readdirSync(mapsDir(userData))).toEqual([]);
  });
});

describe("sweeping the folder", () => {
  it("deletes a region file the registry no longer names, and keeps the rest", () => {
    writeRegions(userData, [SERBIA]);
    const dir = mapsDir(userData);
    for (const name of [SERBIA.file, "srb.20261021.full.pmtiles", "srb.part", "notes.txt"]) writeFileSync(join(dir, name), "x");
    sweepRegionFiles(userData);
    expect(readdirSync(dir).sort()).toEqual(["notes.txt", "regions.json", SERBIA.file, "srb.part"].sort());
    expect(existsSync(join(dir, "srb.20261021.full.pmtiles"))).toBe(false);
  });
});
