import { describe, expect, it } from "vitest";

import { BUILD_BASE_URL, BUILDS_URL, type PlanetBuild } from "./builds.js";
import { fakeHost } from "./fixtures.js";
import { buildReader, fetchBuilds, RegionError } from "./http.js";

const BUILD: PlanetBuild = {
  key: "20261022",
  url: `${BUILD_BASE_URL}20261022.pmtiles`,
  bytes: 1000,
  md5: "00".repeat(16),
  version: "4.15.2",
};

const FILE = Uint8Array.from({ length: 1000 }, (_, index) => index % 251);
const allowed = (url: string) => url.startsWith("https://build");
const signal = new AbortController().signal;

async function problemOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RegionError) return error.problem;
    throw error;
  }
  throw new Error("It did not fail.");
}

describe("reading the list of builds", () => {
  it("answers the builds the list names", async () => {
    const list = JSON.stringify([
      { key: "20261022.pmtiles", size: 9, md5sum: "psbfbv+304fdON2I61p+Tg==", version: "4.15.2" },
    ]);
    const builds = await fetchBuilds(fakeHost({ [BUILDS_URL]: list }), allowed, signal);
    expect(builds.map((build) => build.key)).toEqual(["20261022"]);
  });

  it("refuses a host the launch does not allow, before asking it anything", async () => {
    const host = fakeHost({});
    expect(await problemOf(fetchBuilds(host, () => false, signal))).toBe("url");
    expect(host.requests).toEqual([]);
  });

  it("calls a failed answer or a list past its cap a network failure", async () => {
    expect(await problemOf(fetchBuilds(fakeHost({}), allowed, signal))).toBe("network");
    const huge = fakeHost({ [BUILDS_URL]: new Uint8Array(1024 * 1024 + 1) });
    expect(await problemOf(fetchBuilds(huge, allowed, signal))).toBe("network");
    expect(await problemOf(fetchBuilds(fakeHost({ [BUILDS_URL]: "{" }), allowed, signal))).toBe("network");
  });
});

describe("reading a build by ranges", () => {
  it("answers exactly the bytes asked for, and pins the build's ETag", async () => {
    const reader = buildReader(fakeHost({ [BUILD.url]: FILE }), BUILD, allowed, signal, null);
    expect(await reader.read(10, 20)).toEqual(FILE.slice(10, 30));
    expect(reader.etag()).toBe('"1000"');
  });

  it("stops when the build changes between two reads, so two files' bytes never mix", async () => {
    const host = fakeHost({ [BUILD.url]: FILE });
    const reader = buildReader(host, BUILD, allowed, signal, null);
    await reader.read(0, 10);
    host.serve(BUILD.url, FILE, '"rebuilt"');
    expect(await problemOf(reader.read(10, 10))).toBe("build-changed");
  });

  it("checks a resumed download against the ETag it began with", async () => {
    const reader = buildReader(fakeHost({ [BUILD.url]: FILE }), BUILD, allowed, signal, '"earlier"');
    expect(await problemOf(reader.read(0, 10))).toBe("build-changed");
  });

  it("refuses an answer that is not the range asked for", async () => {
    // A file shorter than the list said: the range comes back short, with another total.
    const short = buildReader(fakeHost({ [BUILD.url]: FILE.slice(0, 500) }), BUILD, allowed, signal, null);
    expect(await problemOf(short.read(490, 20))).toBe("network");
    expect(await problemOf(buildReader(fakeHost({}), BUILD, allowed, signal, null).read(0, 10))).toBe("network");
    expect(await problemOf(buildReader(fakeHost({ [BUILD.url]: FILE }), BUILD, () => false, signal, null).read(0, 10))).toBe("url");
  });
});
