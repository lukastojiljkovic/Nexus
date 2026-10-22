import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PMTiles } from "pmtiles";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DownloadHttp } from "../../../../main/download/service.js";
import { readHeader } from "../extract/archive.js";
import { allTiles, bufferSource, buildArchive, tileBytes } from "../extract/fixtures.js";
import { BUILD_BASE_URL, BUILDS_URL } from "./builds.js";
import { createRegionDownloads, type RegionDownloadsDeps } from "./downloads.js";
import { fakeHost, type FakeHost } from "./fixtures.js";
import { mapsDir, partPath, readJob, readRegions, writeJob } from "./registry.js";

// The planet for these tests: every tile of zooms 0 to 6, its directory split into leaves.
const PLANET = buildArchive(allTiles(6), { rootBudget: 300 });
const urlOf = (key: string) => `${BUILD_BASE_URL}${key}.pmtiles`;

function listOf(builds: [key: string, bytes: Uint8Array][]): string {
  return JSON.stringify(
    builds.map(([key, bytes]) => ({
      key: `${key}.pmtiles`,
      size: bytes.length,
      md5sum: createHash("md5").update(bytes).digest("base64"),
      version: "4.15.2",
    })),
  );
}

let userData = "";
let host: FakeHost;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "nexus-region-downloads-"));
  host = fakeHost({ [BUILDS_URL]: listOf([["20261022", PLANET]]), [urlOf("20261022")]: PLANET });
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

function downloadsWith(overrides: Partial<RegionDownloadsDeps> = {}) {
  return createRegionDownloads({
    userData,
    mode: () => "downloads",
    isAllowedUrl: () => true,
    http: host,
    freeSpaceBytes: async () => 1e12,
    ...overrides,
  });
}

/** The installed region's file, read back through the pmtiles library. */
async function tileIn(z: number, x: number, y: number): Promise<Uint8Array | null> {
  const row = readRegions(userData)[0];
  if (row === undefined) return null;
  const tile = await new PMTiles(bufferSource(readFileSync(join(mapsDir(userData), row.file)))).getZxy(z, x, y);
  return tile === undefined ? null : new Uint8Array(tile.data);
}

describe("measuring a region", () => {
  it("answers the finished file's size and the build it comes from", async () => {
    const estimate = await downloadsWith().estimate("SRB", "overview");
    expect(estimate).toMatchObject({ ok: true, build: "20261022" });
    expect(estimate.ok && estimate.bytes).toBeGreaterThan(0);
  });

  it("refuses an unknown region, the wrong mode, and a region past the entry cap", async () => {
    expect(await downloadsWith().estimate("XXX", "overview")).toEqual({ ok: false, problem: "region" });
    expect(await downloadsWith({ mode: () => "offline" }).estimate("SRB", "overview")).toEqual({
      ok: false,
      problem: "mode",
    });
    expect(await downloadsWith({ maxEntries: 2 }).estimate("SRB", "overview")).toEqual({
      ok: false,
      problem: "too-large",
    });
  });
});

describe("downloading a region", () => {
  it("installs a file the library reads, holding the region and nothing else", async () => {
    const downloads = downloadsWith();
    const estimate = await downloads.estimate("SRB", "overview");
    downloads.download("SRB", "overview");
    await downloads.idle();
    const view = downloads.view();
    expect(view.job).toBeNull();
    expect(view.installed).toEqual([
      {
        id: "SRB",
        detail: "overview",
        build: "20261022",
        bytes: estimate.ok ? estimate.bytes : -1,
        url: "nx-map://region/srb.20261022.overview.pmtiles",
      },
    ]);
    // Serbia at zoom 6, and the middle of the Atlantic, which is not in it.
    expect(await tileIn(6, 35, 23)).toEqual(tileBytes(6, 35, 23));
    expect(await tileIn(6, 24, 23)).toBeNull();
    expect(existsSync(partPath(userData, "SRB"))).toBe(false);
  });

  it("copies the whole build for the world at full detail, and checks its MD5", async () => {
    const downloads = downloadsWith();
    downloads.download("world", "full");
    await downloads.idle();
    const row = readRegions(userData)[0];
    expect(row?.bytes).toBe(PLANET.length);
    expect(readFileSync(join(mapsDir(userData), row?.file ?? ""))).toEqual(Buffer.from(PLANET));

    rmSync(join(mapsDir(userData), row?.file ?? ""));
    host.serve(BUILDS_URL, new TextEncoder().encode(listOf([["20261022", new Uint8Array(PLANET.length)]])));
    const again = downloadsWith();
    again.download("world", "full");
    await again.idle();
    expect(again.view().job).toMatchObject({ state: "failed", problem: "hash" });
    expect(readJob(userData, "world")).toBeNull();
  });

  it("refuses to start when the volume cannot hold the file", async () => {
    const downloads = downloadsWith({ freeSpaceBytes: async () => 0 });
    downloads.download("SRB", "overview");
    await downloads.idle();
    expect(downloads.view().job).toMatchObject({ state: "failed", problem: "no-space" });
    expect(readRegions(userData)).toEqual([]);
  });
});

describe("pausing and resuming", () => {
  /** Holds the first read of tile data until `release`, so a test can act mid-download. */
  function gatedHost(): DownloadHttp & { reached: Promise<void>; release: () => void } {
    const tileData = readHeader(PLANET).tileDataOffset;
    let reach = () => undefined as void;
    let release = () => undefined as void;
    const reached = new Promise<void>((resolve) => (reach = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    return {
      reached,
      release,
      request: async (url, init) => {
        const start = Number(/^bytes=(\d+)/.exec(init.headers["Range"] ?? "")?.[1] ?? -1);
        if (start >= tileData) {
          reach();
          await gate;
        }
        return host.request(url, init);
      },
    };
  }

  async function finishedBytes(): Promise<Buffer> {
    const downloads = downloadsWith();
    downloads.download("SRB", "overview");
    await downloads.idle();
    const file = join(mapsDir(userData), readRegions(userData)[0]?.file ?? "");
    const bytes = readFileSync(file);
    rmSync(mapsDir(userData), { recursive: true });
    return bytes;
  }

  it("keeps the partial file when paused, and finishes the same file when started again", async () => {
    const expected = await finishedBytes();
    const gated = gatedHost();
    const downloads = downloadsWith({ http: gated });
    downloads.download("SRB", "overview");
    await gated.reached;
    expect(downloads.pause().job).toMatchObject({ state: "paused" });
    gated.release();
    await downloads.idle();
    expect(readJob(userData, "SRB")).toMatchObject({ build: "20261022", bytes: expected.length });

    downloads.download("SRB", "overview");
    await downloads.idle();
    expect(readFileSync(join(mapsDir(userData), readRegions(userData)[0]?.file ?? ""))).toEqual(expected);
  });

  it("shows a download a previous run left unfinished as paused, and resumes it from the file", async () => {
    const expected = await finishedBytes();
    const header = readHeader(expected);
    writeJob(userData, { id: "SRB", detail: "overview", build: "20261022", etag: `"${String(PLANET.length)}"`, bytes: expected.length });
    // The prefix and a few bytes of the first fetch: the fetch is written again from its start.
    writeFileSync(partPath(userData, "SRB"), expected.subarray(0, header.tileDataOffset + 5));

    const downloads = downloadsWith();
    expect(downloads.view().job).toMatchObject({ id: "SRB", state: "paused", receivedBytes: header.tileDataOffset + 5 });
    downloads.download("SRB", "overview");
    await downloads.idle();
    expect(readFileSync(join(mapsDir(userData), readRegions(userData)[0]?.file ?? ""))).toEqual(expected);
  });

  it("starts over when the build changed while the download was paused", async () => {
    const expected = await finishedBytes();
    writeJob(userData, { id: "SRB", detail: "overview", build: "20261022", etag: '"another file"', bytes: expected.length });
    writeFileSync(partPath(userData, "SRB"), Buffer.alloc(expected.length - 1, 7));

    const downloads = downloadsWith();
    downloads.download("SRB", "overview");
    await downloads.idle();
    expect(readFileSync(join(mapsDir(userData), readRegions(userData)[0]?.file ?? ""))).toEqual(expected);
  });

  it("forgets the partial file on cancel", async () => {
    const gated = gatedHost();
    const downloads = downloadsWith({ http: gated });
    downloads.download("SRB", "overview");
    await gated.reached;
    const cancelled = downloads.cancel();
    gated.release();
    expect((await cancelled).job).toBeNull();
    expect(existsSync(partPath(userData, "SRB"))).toBe(false);
    expect(readJob(userData, "SRB")).toBeNull();
  });
});

describe("updating and removing", () => {
  it("replaces a region with one cut from a newer build, and deletes the old file", async () => {
    const downloads = downloadsWith();
    downloads.download("SRB", "overview");
    await downloads.idle();
    const old = readRegions(userData)[0]?.file ?? "";

    host.serve(BUILDS_URL, new TextEncoder().encode(listOf([["20261023", PLANET], ["20261022", PLANET]])));
    host.serve(urlOf("20261023"), PLANET);
    expect((await downloads.estimate("SRB", "overview")).ok).toBe(true);
    expect(downloads.view().newestBuild).toBe("20261023");
    downloads.download("SRB", "overview");
    await downloads.idle();
    expect(readRegions(userData).map((row) => row.build)).toEqual(["20261023"]);
    expect(existsSync(join(mapsDir(userData), old))).toBe(false);
  });

  it("removes a region and its file", async () => {
    const downloads = downloadsWith();
    downloads.download("SRB", "overview");
    await downloads.idle();
    const file = join(mapsDir(userData), readRegions(userData)[0]?.file ?? "");
    expect((await downloads.remove("SRB")).installed).toEqual([]);
    expect(existsSync(file)).toBe(false);
    mkdirSync(mapsDir(userData), { recursive: true });
  });
});
