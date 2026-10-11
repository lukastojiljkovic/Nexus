import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readSources, sha256Bytes } from "../build-lib.mjs";
import {
  BINARY_ARCHIVE,
  ID,
  LICENCE_FILE,
  PACK_PATHS,
  SOURCE_ARCHIVE,
  VERSION,
  buildPack,
  metadata,
  packFilesFromArchive,
  sourceNotice,
} from "./build.mjs";

/**
 * The LibreDWG builder against a fixture shaped like the published Windows
 * archive (`dwg2dxf.exe`, `dwgread.exe`, the four DLLs and `README.txt`, all at
 * the archive's root, deflated) — the code that runs against the real 12 MB build
 * is the code that runs here.
 */

const FIXTURE = new URL("./fixtures/libredwg-win64.zip", import.meta.url);
const STOCKFISH_FIXTURE = new URL("../stockfish/fixtures/stockfish-release.zip", import.meta.url);

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nexus-pack-ld-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function fixture() {
  return readFileSync(FIXTURE);
}

describe("what the pack is built from", () => {
  it("lays the publisher's programs under bin/, and adds the licence the archive lacks", () => {
    const files = packFilesFromArchive({
      binaryArchive: fixture(),
      sourceArchive: Buffer.from("source archive bytes", "utf8"),
      copying: Buffer.from("GNU GPL text", "utf8"),
    });
    expect(files.map((file) => file.path)).toEqual([
      PACK_PATHS.entry,
      "bin/dwgread.exe",
      "bin/libredwg-0.dll",
      "bin/libiconv-2.dll",
      "bin/libpcre2-8-0.dll",
      "bin/libpcre2-16-0.dll",
      PACK_PATHS.readme,
      PACK_PATHS.copying,
      PACK_PATHS.source,
    ]);
    expect(files[0].bytes.toString("utf8")).toBe("MZ fixture dwg2dxf\n");
    expect(files[7].bytes.toString("utf8")).toBe("GNU GPL text");
    expect(files[8].bytes.toString("utf8")).toBe("source archive bytes");
  });

  it("refuses an archive that is not the release, rather than shipping a half pack", () => {
    expect(() =>
      packFilesFromArchive({
        binaryArchive: readFileSync(STOCKFISH_FIXTURE),
        sourceArchive: Buffer.from("x"),
        copying: Buffer.from("y"),
      }),
    ).toThrow(/holds no "dwg2dxf\.exe"/);
  });
});

describe("the metadata the maintainer signs", () => {
  it("names the converter, its protocol and the entry among the files", () => {
    const meta = metadata();
    expect(meta.id).toBe(ID);
    expect(meta.version).toBe(VERSION);
    expect(meta.kind).toBe("tool");
    expect(meta.tool).toEqual({ entry: "bin/dwg2dxf.exe", protocol: "stdio" });
    expect(meta.licence.spdx).toBe("GPL-3.0-or-later");
    expect(meta.description.sr.length).toBeGreaterThan(0);
    expect(meta.description.en.length).toBeGreaterThan(0);
  });

  it("records the publisher's own checksum file as the source of the source archive's digest", async () => {
    const sources = await readSources(new URL("./sources.json", import.meta.url));
    const source = sources.sources[SOURCE_ARCHIVE];
    expect(source.sha256From.url).toMatch(/dist\.sha256$/);
    expect(source.sha256From.quote).toContain(source.sha256);
    expect(sources.sources[LICENCE_FILE].licence.spdx).toBe("GPL-3.0-or-later");
    // The quoted sentence is the project's own statement, taken from its README
    // at the shipped version — "free software, licensed under ... version 3 ...
    // or any later version", which is where the SPDX id comes from.
    expect(sources.sources[LICENCE_FILE].licence.evidence[0].quote).toContain("any later version");
    // The tag the builder downloads from is the version the pack claims.
    expect(sources.release.tag).toBe(VERSION);
    expect(sources.sources[BINARY_ARCHIVE].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("writes a source notice that says which file is the licence and where the source is", () => {
    const notice = sourceNotice({
      binary: { url: "https://example.org/win64.zip", sha256: "cd".repeat(32), bytes: 42 },
      source: { url: "https://example.org/src.tar.xz", sha256: "ef".repeat(32) },
    });
    expect(notice).toContain("GPL-3.0-or-later");
    expect(notice).toContain("https://example.org/src.tar.xz");
    expect(notice).toContain("COPYING");
    expect(notice).toContain("Corresponding Source");
  });
});

describe("a whole build", () => {
  /** A `sources.json` whose three entries describe the fixtures and the licence text. */
  function sourcesForFixtures(input) {
    return {
      sources: {
        [BINARY_ARCHIVE]: { url: "https://example.org/win64.zip", sha256: sha256Bytes(input.binary) },
        [SOURCE_ARCHIVE]: { url: "https://example.org/src.tar.xz", sha256: sha256Bytes(input.source) },
        [LICENCE_FILE]: { url: "https://example.org/COPYING", sha256: sha256Bytes(input.copying) },
      },
    };
  }

  it("assembles the pack folder and the metadata file from the three sources", async () => {
    const binary = fixture();
    const source = Buffer.from("a source archive standing in for a tar.xz", "utf8");
    const copying = Buffer.from("the project's licence text", "utf8");
    const byUrl = new Map([
      ["https://example.org/win64.zip", binary],
      ["https://example.org/src.tar.xz", source],
      ["https://example.org/COPYING", copying],
    ]);
    const lines = [];
    const result = await buildPack({
      sources: sourcesForFixtures({ binary, source, copying }),
      cacheDir: join(root, "cache"),
      outDir: join(root, "pack"),
      metaFile: join(root, "pack.meta.json"),
      fetchImpl: async (url) => new Response(byUrl.get(url), { status: 200, statusText: "OK" }),
      log: (line) => lines.push(line),
    });

    for (const path of [PACK_PATHS.entry, PACK_PATHS.copying, PACK_PATHS.source, PACK_PATHS.notice]) {
      expect(existsSync(join(root, "pack", ...path.split("/"))), path).toBe(true);
    }
    expect(readFileSync(join(root, "pack", PACK_PATHS.copying), "utf8")).toBe(
      "the project's licence text",
    );
    const meta = JSON.parse(readFileSync(result.metaFile, "utf8"));
    expect(meta.kind).toBe("tool");
    expect(result.files.some((file) => file.path === meta.tool.entry)).toBe(true);
    // Every source was fetched and verified, and the report line names the pack.
    expect(lines.filter((line) => line.startsWith("fetched "))).toHaveLength(3);
    expect(lines.some((line) => line.startsWith("pack-build: libredwg ->"))).toBe(true);
  });

  it("refuses a licence text whose bytes are not the digest sources.json states", async () => {
    const binary = fixture();
    const source = Buffer.from("source", "utf8");
    const sources = sourcesForFixtures({ binary, source, copying: Buffer.from("licence", "utf8") });
    sources.sources[LICENCE_FILE].sha256 = "00".repeat(32);
    await expect(
      buildPack({
        sources,
        cacheDir: join(root, "cache"),
        outDir: join(root, "pack"),
        metaFile: join(root, "pack.meta.json"),
        fetchImpl: async (url) =>
          new Response(url === "https://example.org/win64.zip" ? binary : Buffer.from("licence", "utf8"), {
            status: 200,
            statusText: "OK",
          }),
      }),
    ).rejects.toThrow(/not the release it claims to be/);
    expect(existsSync(join(root, "pack"))).toBe(false);
  });
});
