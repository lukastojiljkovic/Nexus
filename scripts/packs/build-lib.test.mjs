import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ensureCached,
  formatBytes,
  formatReport,
  readSources,
  sha256Bytes,
  validateRelativePath,
  verifyDigest,
  writeMetaFile,
  writePackFiles,
} from "./build-lib.mjs";
import { metadata as libredwgMetadata } from "./libredwg/build.mjs";
import { metadata as stockfishMetadata } from "./stockfish/build.mjs";

/**
 * The shared half of the two tool-pack builders, and the one link between them
 * and the app: the keys a builder's metadata carries are the keys the manifest
 * parser defines, minus the `files` list that `pack-sign.mjs` computes.
 */

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nexus-pack-lib-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/** A `fetch` that answers with `bytes` and records how many times it was asked. */
function serve(bytes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    return new Response(bytes, { status: 200, statusText: "OK" });
  };
  return { impl, calls };
}

describe("a pack path", () => {
  it("accepts the relative, forward-slashed names a pack uses", () => {
    expect(validateRelativePath("engine/engine.exe")).toBe("engine/engine.exe");
    expect(validateRelativePath("COPYING")).toBe("COPYING");
  });

  it("refuses an absolute path, a drive, a backslash and a wandering segment", () => {
    for (const path of ["/etc/passwd", "C:/windows", "\\\\server\\share", "bin\\tool.exe", "../escape", "a//b", "a/./b", ""]) {
      expect(() => validateRelativePath(path), path).toThrow();
    }
  });
});

describe("digests", () => {
  it("hashes a buffer, and the empty buffer is the published SHA-256 of nothing", () => {
    // The well-known SHA-256 of the empty input, which is a value the algorithm
    // defines rather than one this run produced.
    expect(sha256Bytes(Buffer.alloc(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Bytes(Buffer.from("abc", "utf8"))).toBe(
      createHash("sha256").update("abc").digest("hex"),
    );
  });

  it("refuses a digest that is not the publisher's, naming both", () => {
    expect(() => verifyDigest("aa", "bb", "engine.zip")).toThrow(/engine\.zip/);
    expect(() => verifyDigest("aa", "bb", "engine.zip")).toThrow(/SHA-256 aa/);
    expect(() => verifyDigest("aa", "aa", "engine.zip")).not.toThrow();
  });
});

describe("the cache", () => {
  it("fetches once, verifies every time, and reuses what is there", async () => {
    const bytes = Buffer.from("archive bytes", "utf8");
    const digest = sha256Bytes(bytes);
    const { impl, calls } = serve(bytes);
    const first = await ensureCached({
      url: "https://example.org/engine.zip",
      file: "engine.zip",
      sha256: digest,
      cacheDir: join(root, "cache"),
      fetchImpl: impl,
    });
    expect(first.fetched).toBe(true);
    expect(first.sha256).toBe(digest);
    expect(calls).toHaveLength(1);

    const second = await ensureCached({
      url: "https://example.org/engine.zip",
      file: "engine.zip",
      sha256: digest,
      cacheDir: join(root, "cache"),
      fetchImpl: impl,
    });
    expect(second.fetched).toBe(false);
    // Re-running a builder over an unchanged cache is not a second download.
    expect(calls).toHaveLength(1);
  });

  it("refuses a file whose bytes are not the digest the publisher states", async () => {
    const { impl } = serve(Buffer.from("not that archive", "utf8"));
    await expect(
      ensureCached({
        url: "https://example.org/engine.zip",
        file: "engine.zip",
        sha256: sha256Bytes(Buffer.from("the archive", "utf8")),
        cacheDir: join(root, "cache"),
        fetchImpl: impl,
      }),
    ).rejects.toThrow(/not the release it claims to be/);
  });

  it("refuses an answer that is not a success", async () => {
    await expect(
      ensureCached({
        url: "https://example.org/missing.zip",
        file: "missing.zip",
        sha256: "00".repeat(32),
        cacheDir: join(root, "cache"),
        fetchImpl: async () => new Response("no", { status: 404, statusText: "Not Found" }),
      }),
    ).rejects.toThrow(/404/);
  });
});

describe("writing a pack folder", () => {
  it("writes nested files, and removes what a previous build left behind", async () => {
    const dir = join(root, "pack");
    const first = await writePackFiles({
      dir,
      files: [
        { path: "bin/tool.exe", bytes: Buffer.from("exe", "utf8") },
        { path: "COPYING", bytes: Buffer.from("gpl", "utf8") },
      ],
    });
    expect(first).toEqual([
      { path: "bin/tool.exe", size: 3 },
      { path: "COPYING", size: 3 },
    ]);
    expect(readFileSync(join(dir, "bin", "tool.exe"), "utf8")).toBe("exe");

    const second = await writePackFiles({
      dir,
      files: [{ path: "COPYING", bytes: Buffer.from("gpl", "utf8") }],
    });
    expect(second).toHaveLength(1);
    // A stale binary beside a fresh manifest is the one mistake nothing
    // downstream catches, so the folder is rebuilt rather than added to.
    expect(() => readFileSync(join(dir, "bin", "tool.exe"))).toThrow();
  });

  it("refuses to write outside the pack folder", async () => {
    await expect(
      writePackFiles({ dir: join(root, "pack"), files: [{ path: "../escape", bytes: Buffer.from("x") }] }),
    ).rejects.toThrow(/not a usable pack path/);
  });
});

describe("the metadata file", () => {
  it("writes the object as JSON with a trailing newline", async () => {
    const path = join(root, "out", "pack.meta.json");
    const meta = { format: 1, id: "x" };
    await writeMetaFile(path, meta);
    expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(meta, null, 2)}\n`);
  });

  it("carries exactly the keys the app's manifest defines, minus the file list it computes", async () => {
    const manifest = readFileSync(
      new URL("../../apps/desktop/src/main/packs/manifest.ts", import.meta.url),
      "utf8",
    );
    const block = /const MANIFEST_KEYS: readonly string\[\] = \[([^\]]*)\]/.exec(manifest);
    expect(block).not.toBeNull();
    const appKeys = [...(block?.[1] ?? "").matchAll(/"([a-zA-Z]+)"/g)].map((match) => match[1]);
    // `files` is the one key the maintainer never types: `pack-sign.mjs` measures
    // it off the folder. `notice` is optional and only a safety pack carries it
    // (ADR-103); a tool pack has none.
    const expected = appKeys.filter((key) => key !== "files" && key !== "notice").sort();
    expect(Object.keys(stockfishMetadata()).sort()).toEqual(expected);
    expect(Object.keys(libredwgMetadata()).sort()).toEqual(expected);
  });
});

describe("the report line", () => {
  it("reads sizes in binary units and the elapsed time to one decimal", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KiB");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(81431614)).toBe("77.7 MiB");
    expect(
      formatReport({ id: "x", dir: "D", fileCount: 6, totalBytes: 2048, elapsedMs: 12340 }),
    ).toBe("pack-build: x -> D (6 files, 2.0 KiB, 12.3s)");
  });
});

describe("sources.json", () => {
  it("refuses a file that is not an object", async () => {
    const path = join(root, "sources.json");
    writeFileSync(path, "[]");
    await expect(readSources(path)).rejects.toThrow(/must be a JSON object/);
  });
});
