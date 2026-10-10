import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";

import { checkMeta } from "../../pack-sign.mjs";
import {
  BODY_ORDER,
  MAP_MAX_HEIGHT,
  MAP_MAX_WIDTH,
  PACK_ID,
  PLAN,
  RING_MAX_HEIGHT,
  RING_MAX_WIDTH,
  appVersion,
  assertSources,
  build,
  buildMetadata,
  buildTexturesJson,
  cacheFile,
  convertToWebp,
  fetchSource,
  limitsFor,
  outputPaths,
  sha256,
} from "./build.mjs";

/**
 * The pack builder, tested on fixtures and stubs rather than on the network.
 *
 * Three oracles. `sha256` is checked against the two published test vectors (the
 * empty string and "abc"), which is a digest anyone can look up rather than one
 * this code computed. The converter's dimensions come from the caps the pack
 * documents, and its colour check has a stated codec tolerance. And the metadata
 * is handed to `pack-sign.mjs`'s own `checkMeta`, so the builder cannot drift
 * from the manifest the signing tool refuses to sign.
 */

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "nexus-planet-textures-test-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function fixture(file) {
  return readFileSync(join(FIXTURES, file));
}

/** A `sources.json` entry for bytes this test holds, hashed the way the real file is. */
function sourceFor(id, bytes, url = `https://example.invalid/${id}.bin`) {
  return {
    id,
    url,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    licence: "CC-BY-4.0",
    credit: `${id} credit`,
    evidence: { url: "https://creativecommons.org/licenses/by/4.0/", quote: "quote" },
  };
}

function stubFetch(bodies) {
  const calls = [];
  return {
    calls,
    fetchImpl: (url) => {
      calls.push(url);
      const body = bodies.get(url);
      if (body === undefined) return { ok: false, status: 404 };
      return {
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
      };
    },
  };
}

describe("sha256", () => {
  it("is the published digest of the empty string, and of \"abc\"", () => {
    // NIST/RFC 6234's two shortest test vectors, quoted rather than computed.
    expect(sha256(Buffer.alloc(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256(Buffer.from("abc", "utf8"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("sources.json", () => {
  const parsed = JSON.parse(readFileSync("scripts/packs/planet-textures/sources.json", "utf8"));
  const sources = assertSources(parsed);

  it("carries evidence, a digest and a size for every image the plan builds", () => {
    expect(sources.byId.size).toBe(PLAN.length);
    for (const target of PLAN) {
      const source = sources.byId.get(target.source);
      if (source === undefined) throw new Error(`no source for ${target.source}`);
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(source.bytes).toBeGreaterThan(0);
      expect(source.evidence.url.startsWith("https://")).toBe(true);
      // A quote has to be a sentence somebody can find on the page: the shortest
      // one here is NASA's, at 224 characters.
      expect(source.evidence.quote.length).toBeGreaterThan(60);
      expect(["CC-BY-4.0", "Public domain (NASA)"]).toContain(source.licence);
    }
  });

  it("leaves no source unbuilt and names no source twice", () => {
    const ids = parsed.sources.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(PLAN.map((target) => target.source).sort());
  });

  it("refuses a source whose licence cannot be quoted", () => {
    const broken = {
      layout: 1,
      fetched: "2026-10-10",
      sources: [
        {
          ...sourceFor("sun", Buffer.from("x")),
          evidence: { url: "https://creativecommons.org/licenses/by/4.0/", quote: "" },
        },
      ],
    };
    // The plan wants other sources too, so the refusal may name any of them; what
    // matters is that it refuses rather than building a pack on no evidence.
    expect(() => assertSources(broken)).toThrow(/evidence/);
  });

  it("refuses another layout, a repeated id, and an unused source", () => {
    const fetched = "2026-10-10";
    const complete = PLAN.map((target) => sourceFor(target.source, Buffer.from(target.source)));
    const first = complete[0];
    expect(() => assertSources({ layout: 2, fetched, sources: complete })).toThrow(/layout/);
    expect(() => assertSources({ layout: 1, fetched, sources: [...complete, first] })).toThrow(
      /twice/,
    );
    expect(() =>
      assertSources({
        layout: 1,
        fetched,
        sources: [...complete, sourceFor("ceres", Buffer.from("y"))],
      }),
    ).toThrow(/no image is built/);
    expect(() => assertSources({ layout: 1, fetched, sources: complete.slice(1) })).toThrow(
      /not listed/,
    );
  });
});

describe("fetchSource", () => {
  const bytes = fixture("mars-crop.jpg");

  it("downloads once, keeps the bytes in the cache, and serves the cache afterwards", async () => {
    const cacheDir = join(scratch, "cache-download");
    const source = sourceFor("mars", bytes);
    const download = stubFetch(new Map([[source.url, bytes]]));
    const first = await fetchSource(source, { cacheDir, fetchImpl: download.fetchImpl });
    expect(first.fetched).toBe(true);
    expect(first.bytes.equals(bytes)).toBe(true);
    expect(existsSync(cacheFile(cacheDir, source))).toBe(true);

    // A second run that cannot reach the network at all still works, which is the
    // whole point of the cache.
    const offline = stubFetch(new Map());
    const second = await fetchSource(source, { cacheDir, fetchImpl: offline.fetchImpl });
    expect(second.fetched).toBe(false);
    expect(offline.calls).toHaveLength(0);
    expect(second.bytes.equals(bytes)).toBe(true);
  });

  it("discards a cache entry whose bytes no longer match the evidence", async () => {
    const cacheDir = join(scratch, "cache-stale");
    const source = sourceFor("mars", bytes);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile(cacheDir, source), Buffer.from("not the mars crop"));
    const download = stubFetch(new Map([[source.url, bytes]]));
    const result = await fetchSource(source, { cacheDir, fetchImpl: download.fetchImpl });
    expect(download.calls).toEqual([source.url]);
    expect(result.bytes.equals(bytes)).toBe(true);
  });

  it("refuses bytes that do not match the evidence, naming what it found", async () => {
    const cacheDir = join(scratch, "cache-mismatch");
    const source = sourceFor("mars", bytes);
    const download = stubFetch(new Map([[source.url, Buffer.from("something else entirely")]]));
    await expect(fetchSource(source, { cacheDir, fetchImpl: download.fetchImpl })).rejects.toThrow(
      /Update the evidence deliberately/,
    );
  });

  it("refuses a source that answers with anything but 200", async () => {
    const cacheDir = join(scratch, "cache-404");
    const source = sourceFor("mars", bytes, "https://example.invalid/missing.jpg");
    const download = stubFetch(new Map());
    await expect(fetchSource(source, { cacheDir, fetchImpl: download.fetchImpl })).rejects.toThrow(
      /answered 404/,
    );
  });
});

describe("convertToWebp", () => {
  it("caps a 2:1 map at the pack's own limit", async () => {
    const wide = await sharp({
      create: { width: 4096, height: 2048, channels: 3, background: { r: 30, g: 30, b: 30 } },
    })
      .png()
      .toBuffer();
    const converted = await convertToWebp(wide, limitsFor("day"));
    expect(converted.format).toBe("webp");
    expect(converted.width).toBe(MAP_MAX_WIDTH);
    expect(converted.height).toBe(MAP_MAX_HEIGHT);
  });

  it("never enlarges a small source", async () => {
    const small = await sharp({
      create: { width: 64, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    const converted = await convertToWebp(small, limitsFor("day"));
    expect(converted.width).toBe(64);
    expect(converted.height).toBe(32);
  });

  it("lets the ring strip keep its own shape and its alpha", async () => {
    const rings = fixture("saturn-rings-crop.png");
    const converted = await convertToWebp(rings, limitsFor("rings"));
    expect(converted.format).toBe("webp");
    expect(converted.width).toBe(128);
    expect(converted.height).toBe(64);
    expect(converted.hasAlpha).toBe(true);
    // The fixture straddles a real edge in the ring strip: alpha 25 to 249 in the
    // source. Alpha is encoded losslessly at this quality, so both ends survive.
    const alpha = (await sharp(converted.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true }))
      .data;
    let min = 255;
    let max = 0;
    for (let index = 3; index < alpha.length; index += 4) {
      min = Math.min(min, alpha[index]);
      max = Math.max(max, alpha[index]);
    }
    expect(min).toBeLessThanOrEqual(32);
    expect(max).toBeGreaterThanOrEqual(200);
  });

  it("keeps a flat tone within a codec's tolerance of itself", async () => {
    const flat = await sharp({
      create: { width: 64, height: 32, channels: 3, background: { r: 128, g: 64, b: 32 } },
    })
      .png()
      .toBuffer();
    const converted = await convertToWebp(flat, limitsFor("day"));
    const stats = await sharp(converted.data).stats();
    const channels = stats.channels.slice(0, 3).map((channel) => channel.mean);
    // WebP at quality 88 is lossy; ±4 of 255 is the tolerance a flat block needs,
    // and it is still tight enough to catch a wrong colour space or a double
    // encode (which moved these means by more than twenty when it was tried).
    for (const [index, expected] of [128, 64, 32].entries()) {
      expect(Math.abs((channels[index] ?? 0) - expected)).toBeLessThanOrEqual(4);
    }
  });

  it("reads the real fixtures the README describes", async () => {
    const mars = await sharp(fixture("mars-crop.jpg")).metadata();
    expect([mars.format, mars.width, mars.height]).toEqual(["jpeg", 128, 64]);
    const night = await sharp(fixture("black-marble-crop.jpg")).metadata();
    expect([night.format, night.width, night.height]).toEqual(["jpeg", 128, 64]);
    const rings = await sharp(fixture("saturn-rings-crop.png")).metadata();
    expect([rings.format, rings.width, rings.height, rings.hasAlpha]).toEqual(["png", 128, 64, true]);
  });
});

describe("buildTexturesJson", () => {
  const sources = new Map(PLAN.map((target) => [target.source, { credit: `${target.source} credit` }]));
  const textures = buildTexturesJson(
    PLAN.map((target) => ({ ...target })),
    sources,
  );

  it("is layout 1, in the view's body order, without a body that has no map", () => {
    expect(textures.layout).toBe(1);
    expect(Object.keys(textures.bodies)).toEqual(BODY_ORDER.filter((id) => id !== "pluto"));
    expect(textures.bodies.pluto).toBeUndefined();
  });

  it("names each image relative to the pack root, slot by slot, with the body's credit", () => {
    expect(Object.keys(textures.bodies.earth)).toEqual(["day", "night", "credit"]);
    expect(textures.bodies.earth).toEqual({
      day: "images/earth-day.webp",
      night: "images/earth-night.webp",
      credit: "earth-day credit",
    });
    expect(Object.keys(textures.bodies.saturn)).toEqual(["day", "rings", "credit"]);
    expect(textures.bodies.saturn?.rings).toBe("images/saturn-rings.webp");
    expect(textures.bodies.sun).toEqual({ day: "images/sun-day.webp", credit: "sun credit" });
  });
});

describe("metadata and paths", () => {
  it("is metadata pack-sign.mjs will sign", () => {
    const metadata = buildMetadata(appVersion());
    expect(() => checkMeta(metadata)).not.toThrow();
    expect(metadata.id).toBe(PACK_ID);
    expect(metadata.kind).toBe("dataset");
    expect(metadata.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(metadata.minAppVersion).toBe(appVersion());
    expect(metadata.minAppVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(metadata.title.sr.length).toBeGreaterThan(0);
    expect(metadata.title.en.length).toBeGreaterThan(0);
    expect(metadata.description.sr.length).toBeGreaterThan(0);
    expect(metadata.description.en.length).toBeGreaterThan(0);
    // The stricter of the two licences in the pack, and an address for it.
    expect(metadata.licence.spdx).toBe("CC-BY-4.0");
    expect(metadata.licence.url.startsWith("https://")).toBe(true);
    expect(metadata.licence.attribution).toContain("NASA");
    expect(metadata.licence.attribution).toContain("Solar System Scope");
  });

  it("writes the metadata BESIDE the pack folder, never inside it", () => {
    const paths = outputPaths();
    expect(paths.packDir.startsWith(tmpdir())).toBe(true);
    expect(paths.cacheDir.startsWith(tmpdir())).toBe(true);
    expect(paths.metaPath.startsWith(tmpdir())).toBe(true);
    // A metadata file inside the folder would be hashed into the manifest as
    // content by `pack-sign.mjs`, which is the failure this asserts against.
    expect(paths.metaPath.startsWith(paths.packDir + sep)).toBe(false);
  });
});

describe("build", () => {
  it("writes the images, the layout and the metadata from stubbed sources", async () => {
    const cacheDir = join(scratch, "build-cache");
    const packDir = join(scratch, "build-pack");
    const metaPath = join(scratch, "build-pack.meta.json");
    const bodies = new Map();
    const sources = new Map();
    for (const target of PLAN) {
      // The ring strip from its own fixture, everything else from the Mars crop:
      // the bytes only have to be real images, not the right planets.
      const bytes = target.slot === "rings" ? fixture("saturn-rings-crop.png") : fixture("mars-crop.jpg");
      const source = sourceFor(target.source, bytes);
      sources.set(target.source, source);
      bodies.set(source.url, bytes);
    }
    const download = stubFetch(bodies);

    const result = await build({
      cacheDir,
      packDir,
      metaPath,
      sources,
      fetchImpl: download.fetchImpl,
      log: () => undefined,
    });
    expect(result.images).toHaveLength(PLAN.length);
    for (const target of PLAN) expect(existsSync(join(packDir, "images", target.file))).toBe(true);

    const written = JSON.parse(readFileSync(join(packDir, "textures.json"), "utf8"));
    expect(written.layout).toBe(1);
    expect(Object.keys(written.bodies)).toEqual([
      "sun",
      "mercury",
      "venus",
      "earth",
      "moon",
      "mars",
      "jupiter",
      "saturn",
      "uranus",
      "neptune",
    ]);
    const metadata = JSON.parse(readFileSync(metaPath, "utf8"));
    expect(() => checkMeta(metadata)).not.toThrow();
    // The metadata is not part of the pack folder, so `pack-sign` never lists it.
    expect(existsSync(join(packDir, "pack.json"))).toBe(false);
  });

  it("keeps the ring's own limits and the maps' own", () => {
    expect(limitsFor("rings")).toEqual({ maxWidth: RING_MAX_WIDTH, maxHeight: RING_MAX_HEIGHT });
    expect(limitsFor("day")).toEqual({ maxWidth: MAP_MAX_WIDTH, maxHeight: MAP_MAX_HEIGHT });
    expect(limitsFor("night")).toEqual({ maxWidth: MAP_MAX_WIDTH, maxHeight: MAP_MAX_HEIGHT });
  });
});
