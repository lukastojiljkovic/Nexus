import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSources, sha256Bytes } from "../build-lib.mjs";
import {
  ID,
  PACK_PATHS,
  SOURCE_ARCHIVE,
  VERSION,
  buildPack,
  metadata,
  packFilesFromArchive,
  sourceNotice,
} from "./build.mjs";

/**
 * The Stockfish builder against a fixture shaped like the release archive — the
 * same entry names under the same `stockfish/` prefix, compressed the same way —
 * so what runs here is the code that runs against the real 81 MB release, not a
 * parallel path written for the test.
 */

const FIXTURE = new URL("./fixtures/stockfish-release.zip", import.meta.url);
const LIBREDWG_FIXTURE = new URL("../libredwg/fixtures/libredwg-win64.zip", import.meta.url);

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nexus-pack-sf-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function fixture() {
  return readFileSync(FIXTURE);
}

describe("what the pack is built from", () => {
  it("takes the engine, the licence, the notices and the whole archive out of the release", () => {
    const archive = fixture();
    const files = packFilesFromArchive(archive);
    expect(files.map((file) => file.path)).toEqual([
      PACK_PATHS.engine,
      PACK_PATHS.copying,
      PACK_PATHS.authors,
      PACK_PATHS.readme,
      PACK_PATHS.source,
    ]);
    expect(files[0].bytes.toString("utf8")).toBe("MZ fixture executable bytes\n");
    expect(files[1].bytes.toString("utf8")).toContain("GENERAL PUBLIC LICENSE");
    // The source file is the archive itself, byte for byte: the release is both
    // the distribution and the Corresponding Source.
    expect(files[4].bytes.equals(archive)).toBe(true);
  });

  it("refuses an archive that is not the release, rather than shipping a half pack", () => {
    // The LibreDWG fixture is a real zip with none of this release's entries.
    expect(() => packFilesFromArchive(readFileSync(LIBREDWG_FIXTURE))).toThrow(
      /holds no "stockfish\/stockfish-windows-x86-64-universal\.exe"/,
    );
  });
});

describe("the metadata the maintainer signs", () => {
  it("names the tool, its protocol and the entry among the files", () => {
    const meta = metadata();
    expect(meta.id).toBe(ID);
    expect(meta.version).toBe(VERSION);
    expect(meta.kind).toBe("tool");
    expect(meta.tool).toEqual({ entry: PACK_PATHS.engine, protocol: "uci" });
    expect(meta.licence.spdx).toBe("GPL-3.0-or-later");
    expect(meta.description.sr.length).toBeGreaterThan(0);
    expect(meta.description.en.length).toBeGreaterThan(0);
    expect(meta.minAppVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("describes the same release sources.json records", async () => {
    const sources = await readSources(new URL("./sources.json", import.meta.url));
    const asset = sources.sources[SOURCE_ARCHIVE];
    expect(asset.url).toContain("github.com/official-stockfish/Stockfish/releases/download/sf_19/");
    expect(asset.licence.spdx).toBe("GPL-3.0-or-later");
    // Every licence claim carries its evidence, quoted, or this test fails:
    // "a source without evidence is not used".
    expect(asset.licence.evidence.length).toBeGreaterThan(0);
    for (const evidence of asset.licence.evidence) {
      expect(evidence.url).toMatch(/^https:\/\//);
      expect(evidence.quote.length).toBeGreaterThan(20);
    }
  });

  it("writes a source notice that names the archive and its digest", () => {
    const notice = sourceNotice({ url: "https://example.org/a.zip", sha256: "ab".repeat(32), bytes: 42 });
    expect(notice).toContain("GPL-3.0-or-later");
    expect(notice).toContain("https://example.org/a.zip");
    expect(notice).toContain("ab".repeat(32));
    expect(notice).toContain("Corresponding Source");
  });
});

describe("a whole build", () => {
  /** A `sources.json` whose one entry describes the fixture archive. */
  function sourcesForFixture(archive) {
    return {
      sources: {
        [SOURCE_ARCHIVE]: {
          url: "https://example.org/stockfish-windows-x86-64-universal.zip",
          sha256: sha256Bytes(archive),
        },
      },
    };
  }

  it("assembles the pack folder and the metadata file, and prints what it did", async () => {
    const archive = fixture();
    const lines = [];
    const result = await buildPack({
      sources: sourcesForFixture(archive),
      cacheDir: join(root, "cache"),
      outDir: join(root, "pack"),
      metaFile: join(root, "pack.meta.json"),
      // The tests never touch the network: the builder's fetch is an argument.
      fetchImpl: async () => new Response(archive, { status: 200, statusText: "OK" }),
      log: (line) => lines.push(line),
    });

    expect(result.files.map((file) => file.path)).toContain(PACK_PATHS.engine);
    for (const path of [PACK_PATHS.engine, PACK_PATHS.copying, PACK_PATHS.source, PACK_PATHS.notice]) {
      expect(existsSync(join(root, "pack", ...path.split("/"))), path).toBe(true);
    }
    const meta = JSON.parse(readFileSync(result.metaFile, "utf8"));
    expect(meta.kind).toBe("tool");
    expect(meta.tool.entry).toBe(PACK_PATHS.engine);
    // The entry the manifest names is one of the files the builder wrote.
    expect(result.files.some((file) => file.path === meta.tool.entry)).toBe(true);
    expect(lines.some((line) => line.startsWith("fetched "))).toBe(true);
    expect(lines.some((line) => line.startsWith("pack-build: stockfish ->"))).toBe(true);
  });

  it("refuses an archive whose digest is not the one sources.json states", async () => {
    const archive = fixture();
    const sources = sourcesForFixture(archive);
    sources.sources[SOURCE_ARCHIVE].sha256 = "00".repeat(32);
    await expect(
      buildPack({
        sources,
        cacheDir: join(root, "cache"),
        outDir: join(root, "pack"),
        metaFile: join(root, "pack.meta.json"),
        fetchImpl: async () => new Response(archive, { status: 200, statusText: "OK" }),
      }),
    ).rejects.toThrow(/not the release it claims to be/);
    expect(existsSync(join(root, "pack"))).toBe(false);
  });
});
