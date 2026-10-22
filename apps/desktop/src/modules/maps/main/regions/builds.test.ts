import { describe, expect, it } from "vitest";

import { BUILD_BASE_URL, parseBuilds } from "./builds.js";

const ENTRY = {
  key: "20261022.pmtiles",
  size: 139_077_432_987,
  md5sum: "psbfbv+304fdON2I61p+Tg==",
  b3sum: "94c819e7f124431d338cac53018459d86d7bd6bd9ca1f2f015daccd7c2ae3b93",
  uploaded: "2026-10-22T09:03:22.082Z",
  version: "4.15.2",
};

describe("the list of planet builds", () => {
  it("reads an entry as the build file's address, size, MD5 and schema", () => {
    expect(parseBuilds([ENTRY])).toEqual([
      {
        key: "20261022",
        url: `${BUILD_BASE_URL}20261022.pmtiles`,
        bytes: 139_077_432_987,
        md5: "a6c6df6effb7d387dd38dd88eb5a7e4e",
        version: "4.15.2",
      },
    ]);
  });

  it("puts the newest build first, whatever order the list is in", () => {
    const older = { ...ENTRY, key: "20261020.pmtiles" };
    const newer = { ...ENTRY, key: "20261021.pmtiles" };
    expect(parseBuilds([older, ENTRY, newer]).map((build) => build.key)).toEqual(["20261022", "20261021", "20261020"]);
  });

  it("drops an entry it cannot vouch for, and keeps the rest", () => {
    const bad = [
      { ...ENTRY, key: "../20261022.pmtiles" },
      { ...ENTRY, key: "20261022.mbtiles" },
      { ...ENTRY, size: -1 },
      { ...ENTRY, size: 1.5 },
      { ...ENTRY, md5sum: "not base64 of sixteen bytes" },
      // A basemap schema the style this build paints does not read.
      { ...ENTRY, version: "5.0.0" },
      { ...ENTRY, version: 4 },
      null,
      "20261022.pmtiles",
    ];
    expect(parseBuilds([...bad, { ...ENTRY, key: "20261021.pmtiles" }]).map((build) => build.key)).toEqual(["20261021"]);
  });

  it("answers no builds for a document that is not a list", () => {
    expect(parseBuilds({ builds: [ENTRY] })).toEqual([]);
    expect(parseBuilds(null)).toEqual([]);
  });
});
