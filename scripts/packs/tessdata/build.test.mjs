import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkMeta } from "../../pack-sign.mjs";
import {
  LICENCE_FILE,
  LANGUAGES,
  PACK_ID,
  TESSDATA_DIR,
  buildPack,
  gzipBytes,
  packMetadata,
  readSources,
  trainedDataName,
} from "./build.mjs";

/**
 * The tessdata pack's converter and layout, on fixtures cut from the real
 * source (Apache-2.0, `sources.json`): the first 4 KB of `eng.traineddata`,
 * which is a model's real header bytes and nothing this repository edited.
 *
 * Nothing here touches the network: `buildPack` takes its fetcher injected, so
 * the whole pack is assembled from those bytes in a temp directory and the
 * assertions are made against what lands on disk. That is the point - the pack
 * that ships is produced by this code path, and a converter that only works on
 * a developer's machine with a warm cache is a converter nobody can verify.
 */

const FIXTURE = readFileSync(new URL("./fixtures/eng.traineddata.head", import.meta.url));

/** The fixture's own digest, so the test's sources.json is honest about what it hands over. */
const FIXTURE_SHA = createHash("sha256").update(FIXTURE).digest("hex");

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tessdata-pack-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A `sources.json` whose digests are the fixtures' own, laid out like the real one. */
function writeFixtureSources() {
  const source = (name, language) => ({
    name,
    language,
    url: `https://example.invalid/${name}`,
    sha256: FIXTURE_SHA,
    bytes: FIXTURE.byteLength,
    gzipBytes: null,
  });
  const sourcesDir = join(dir, "sources");
  mkdirSync(sourcesDir, { recursive: true });
  writeFileSync(
    join(sourcesDir, "sources.json"),
    JSON.stringify(
      {
        pack: PACK_ID,
        fetched: "2026-10-10",
        version: "2026.10.0",
        licence: {
          spdx: "Apache-2.0",
          url: "https://example.invalid/LICENSE",
          attribution: "a fixture",
        },
        evidence: [{ url: "https://example.invalid/LICENSE", sentence: "Apache License" }],
        sources: [
          ...LANGUAGES.map((language) => source(`${language}.traineddata`, language)),
          source("LICENSE", null),
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  return sourcesDir;
}

describe("trainedDataName", () => {
  it("names the file tesseract.js looks for, which is the gzip one by default", () => {
    expect(trainedDataName("srp_latn")).toBe("srp_latn.traineddata.gz");
    expect(trainedDataName("eng", false)).toBe("eng.traineddata");
  });
});

describe("gzipBytes", () => {
  it("round-trips the source bytes exactly", () => {
    expect(gunzipSync(gzipBytes(FIXTURE)).equals(FIXTURE)).toBe(true);
  });

  it("is deterministic, so a rebuild produces the manifest's own hashes", () => {
    expect(gzipBytes(FIXTURE).equals(gzipBytes(FIXTURE))).toBe(true);
  });

  it("actually compresses: the fixture's gzip is smaller than the fixture", () => {
    expect(gzipBytes(FIXTURE).byteLength).toBeLessThan(FIXTURE.byteLength);
  });
});

describe("the real sources.json", () => {
  const sources = readSources();

  it("lists every language this pack ships, and the licence beside them", () => {
    expect(sources.sources.map((source) => source.name).sort()).toEqual(
      [...LANGUAGES.map((language) => `${language}.traineddata`), "LICENSE"].sort(),
    );
  });

  it("carries a digest, a size and an https URL for every source", () => {
    for (const source of sources.sources) {
      expect(source.sha256, source.name).toMatch(/^[0-9a-f]{64}$/);
      expect(source.bytes, source.name).toBeGreaterThan(0);
      expect(source.url, source.name).toMatch(/^https:\/\/raw\.githubusercontent\.com\//);
    }
  });

  it("states the licence with the evidence the rules require: a URL and the sentence on it", () => {
    expect(sources.licence.spdx).toBe("Apache-2.0");
    expect(sources.licence.url).toContain("tessdata_fast");
    expect(sources.evidence.length).toBeGreaterThan(0);
    for (const evidence of sources.evidence) {
      expect(evidence.url).toMatch(/^https:\/\//);
      expect(evidence.sentence.length).toBeGreaterThan(0);
    }
  });

  it("dates the fetch, which is what the pack's version is derived from", () => {
    expect(sources.fetched).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(packMetadata(sources).version).toBe(sources.version);
  });
});

describe("packMetadata", () => {
  const metadata = packMetadata(readSources());

  it("is metadata the signing tool accepts, so the maintainer can sign this pack", () => {
    expect(() => checkMeta(metadata)).not.toThrow();
    expect(metadata.format).toBe(1);
    expect(metadata.id).toBe(PACK_ID);
    expect(metadata.kind).toBe("dataset");
  });

  it("carries both languages of copy and the attribution the licence requires", () => {
    for (const language of ["sr", "en"]) {
      expect(metadata.title[language].length, language).toBeGreaterThan(0);
      expect(metadata.description[language].length, language).toBeGreaterThan(0);
    }
    expect(metadata.licence.spdx).toBe("Apache-2.0");
    expect(metadata.licence.attribution).toContain("tessdata_fast");
    expect(metadata.licence.url).toMatch(/^https:\/\//);
  });

  it("names a version the rollback rule can compare", () => {
    expect(metadata.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(metadata.version.startsWith(readSources().fetched.slice(0, 4))).toBe(true);
  });
});

describe("buildPack", () => {
  it("assembles the pack folder and a signable metadata file from the sources", async () => {
    const sourcesDir = writeFixtureSources();
    const outputDir = join(dir, "out");
    const metadataPath = join(dir, "out.meta.json");
    const fetchBytes = async (url) => {
      if (url.includes("LICENSE")) return FIXTURE;
      return FIXTURE;
    };

    const result = await buildPack({
      sourcesDir,
      cacheDir: join(dir, "cache"),
      outputDir,
      metadataPath,
      fetchBytes,
      log: () => undefined,
    });

    // One gzipped model per language, plus the licence, all inside the folder
    // the signing tool is pointed at - and nothing else.
    const modelBytes = gzipBytes(FIXTURE);
    expect(result.fileCount).toBe(LANGUAGES.length + 1);
    expect(result.totalBytes).toBe(modelBytes.byteLength * LANGUAGES.length + FIXTURE.byteLength);
    for (const language of LANGUAGES) {
      const packed = readFileSync(join(outputDir, TESSDATA_DIR, trainedDataName(language)));
      expect(gunzipSync(packed).equals(FIXTURE), language).toBe(true);
    }
    expect(readFileSync(join(outputDir, LICENCE_FILE)).equals(FIXTURE)).toBe(true);

    // The metadata file is what `--meta` will be given, and it must not carry
    // `files`: the signing tool computes those from the folder and refuses a
    // metadata file that states them itself.
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    expect(metadata.files).toBeUndefined();
    expect(() => checkMeta(metadata)).not.toThrow();
  });

  it("reuses the cache on a second run instead of downloading again", async () => {
    const sourcesDir = writeFixtureSources();
    let fetches = 0;
    const fetchBytes = async () => {
      fetches += 1;
      return FIXTURE;
    };
    const options = {
      sourcesDir,
      cacheDir: join(dir, "cache"),
      outputDir: join(dir, "out"),
      metadataPath: join(dir, "out.meta.json"),
      fetchBytes,
      log: () => undefined,
    };

    await buildPack(options);
    const afterFirst = fetches;
    await buildPack(options);
    expect(afterFirst).toBeGreaterThan(0);
    expect(fetches).toBe(afterFirst);
  });

  it("re-fetches a cached file whose bytes no longer match sources.json", async () => {
    const sourcesDir = writeFixtureSources();
    const cacheDir = join(dir, "cache");
    let fetches = 0;
    const options = {
      sourcesDir,
      cacheDir,
      outputDir: join(dir, "out"),
      metadataPath: join(dir, "out.meta.json"),
      fetchBytes: async () => {
        fetches += 1;
        return FIXTURE;
      },
      log: () => undefined,
    };

    await buildPack(options);
    // Corrupt one cached file: the next run must not trust it.
    writeFileSync(join(cacheDir, "eng.traineddata"), Buffer.from("not the model"));
    const before = fetches;
    await buildPack(options);
    expect(fetches).toBe(before + 1);
    expect(readFileSync(join(cacheDir, "eng.traineddata")).equals(FIXTURE)).toBe(true);
  });

  it("refuses a source whose bytes are not the bytes sources.json describes", async () => {
    const sourcesDir = writeFixtureSources();
    await expect(
      buildPack({
        sourcesDir,
        cacheDir: join(dir, "cache"),
        outputDir: join(dir, "out"),
        metadataPath: join(dir, "out.meta.json"),
        fetchBytes: async () => Buffer.from("something else entirely"),
        log: () => undefined,
      }),
    ).rejects.toThrow(/Upstream moved/);
  });
});
