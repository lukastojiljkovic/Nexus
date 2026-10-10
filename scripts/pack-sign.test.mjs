import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PACK_SIGNATURE_CONTEXT,
  checkMeta,
  collectFiles,
  parseArgs,
  signPack,
} from "./pack-sign.mjs";

/**
 * The maintainer's signing tool, tested against the thing that matters: the
 * bytes it writes are bytes the app's verification accepts. The signature is
 * checked here with `node:crypto` directly rather than through the app's
 * helper, so the test does not prove "the app agrees with itself".
 *
 * The key is generated per test. A real private key is never read by anything
 * in this file, and the only place one is ever read is the CLI, from the path
 * the maintainer passes.
 */

let root;
let keyPair;
let keyPath;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nexus-pack-sign-"));
  keyPair = generateKeyPairSync("ed25519");
  keyPath = join(root, "throwaway.pem");
  writeFileSync(keyPath, keyPair.privateKey.export({ type: "pkcs8", format: "pem" }));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function meta(overrides = {}) {
  return {
    format: 1,
    id: "wikipedia-sr",
    version: "1.0.0",
    kind: "zim",
    title: { sr: "Vikipedija", en: "Wikipedia" },
    description: { sr: "opis", en: "description" },
    licence: { spdx: "CC-BY-SA-4.0", attribution: "authors", url: "https://example.org" },
    source: { name: "Kiwix", url: "https://www.kiwix.org/" },
    minAppVersion: "1.0.0",
    ...overrides,
  };
}

/** A folder with two content files, one of them nested. */
function packFolder() {
  const dir = join(root, "pack");
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(join(dir, "top.zim"), "top level content");
  writeFileSync(join(dir, "data", "articles.zim"), "nested content");
  return dir;
}

describe("collecting a pack's files", () => {
  it("hashes and measures every content file, nested folders included", () => {
    const files = collectFiles(packFolder());
    expect(files.map((file) => file.path)).toEqual(["data/articles.zim", "top.zim"]);
    const top = files.find((file) => file.path === "top.zim");
    expect(top.size).toBe(Buffer.byteLength("top level content", "utf8"));
    expect(top.sha256).toBe(createHash("sha256").update("top level content").digest("hex"));
  });

  it("refuses a link, which the app would refuse to install", () => {
    const dir = packFolder();
    const outside = join(root, "outside");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(dir, "linked"), process.platform === "win32" ? "junction" : "dir");
    expect(() => collectFiles(dir)).toThrow(/is a link/);
  });

  it("never lists the manifest or its signature", () => {
    const dir = packFolder();
    writeFileSync(join(dir, "pack.json"), "{}");
    writeFileSync(join(dir, "pack.json.sig"), "signature");
    expect(collectFiles(dir).map((file) => file.path)).toEqual([
      "data/articles.zim",
      "top.zim",
    ]);
  });
});

describe("signing a pack", () => {
  it("writes a manifest and a signature over exactly those bytes", () => {
    const dir = packFolder();
    const result = signPack({ dir, meta: meta(), key: keyPath });
    expect(result.fileCount).toBe(2);
    expect(result.totalBytes).toBe(
      Buffer.byteLength("top level content", "utf8") + Buffer.byteLength("nested content", "utf8"),
    );

    const manifestBytes = readFileSync(join(dir, "pack.json"));
    const signature = readFileSync(join(dir, "pack.json.sig"));
    const signed = Buffer.concat([Buffer.from(PACK_SIGNATURE_CONTEXT, "utf8"), manifestBytes]);
    expect(verify(null, signed, keyPair.publicKey, signature)).toBe(true);
    // Never over the manifest alone: that is the shape of the updater's signature.
    expect(verify(null, manifestBytes, keyPair.publicKey, signature)).toBe(false);

    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    expect(manifest.format).toBe(1);
    expect(manifest.id).toBe("wikipedia-sr");
    expect(manifest.files).toHaveLength(2);
    for (const file of manifest.files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("refuses a folder with no content in it", () => {
    const dir = join(root, "empty");
    mkdirSync(dir, { recursive: true });
    expect(() => signPack({ dir, meta: meta(), key: keyPath })).toThrow(/no content files/);
  });
});

describe("the metadata it is willing to sign", () => {
  it("refuses a missing field, so the app never gets a manifest it must refuse", () => {
    const { kind, ...incomplete } = meta();
    expect(incomplete.kind).toBeUndefined();
    expect(() => checkMeta(incomplete)).toThrow(/"kind"/);
  });

  it("refuses a field it does not know, which is a typo costlier than an error", () => {
    expect(() => checkMeta(meta({ minAppVerison: "1.0.0" }))).toThrow(/unknown field/);
  });

  it("refuses a file list in the metadata, because that half is computed here", () => {
    expect(() => checkMeta(meta({ files: [] }))).toThrow(/"files"/);
  });
});

describe("the command line", () => {
  it("refuses a missing flag by name", () => {
    expect(() => parseArgs(["--dir", "/tmp/x", "--meta", "/tmp/m.json"])).toThrow(/--key/);
  });

  it("reads the three flags it needs", () => {
    expect(parseArgs(["--dir", "d", "--meta", "m", "--key", "k"])).toEqual({
      dir: "d",
      meta: "m",
      key: "k",
    });
  });
});

describe("the signature context", () => {
  /**
   * The app verifies against its own copy of the string (`packs/verify.ts`), and
   * a script cannot import TypeScript, so this is the one place the two meet.
   */
  it("is the string the app verifies against", () => {
    const verifier = readFileSync(
      new URL("../apps/desktop/src/main/packs/verify.ts", import.meta.url),
      "utf8",
    );
    expect(verifier).toContain(
      `export const PACK_SIGNATURE_CONTEXT = ${JSON.stringify(PACK_SIGNATURE_CONTEXT)};`,
    );
  });
});
