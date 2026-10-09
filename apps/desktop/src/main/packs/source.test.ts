import { sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PackError } from "./errors.js";
import { baseManifest, entry, makeKey, writePack } from "./fixtures.js";
import { PACK_MANIFEST_FILE, PACK_SIGNATURE_FILE, openPackSource } from "./source.js";

const CONTENT = "content that stands in for a ZIM file";
const APP_VERSION = "1.6.0";

let root: string;
let packDir: string;
let key: ReturnType<typeof makeKey>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nexus-packs-source-"));
  packDir = join(root, "pack");
  key = makeKey();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A valid pack in `packDir`, with `overrides` applied to its manifest. */
function validPack(overrides: Readonly<Record<string, unknown>> = {}): void {
  const file = entry("wikipedia.zim", CONTENT);
  writePack({
    dir: packDir,
    key: key.privateKey,
    manifest: baseManifest([file], overrides),
    contents: { "wikipedia.zim": CONTENT },
  });
}

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof PackError ? error.code : `not-a-pack-error: ${String(error)}`;
  }
  return "no-throw";
}

function open(dir: string): ReturnType<typeof openPackSource> {
  return openPackSource({ dir, appVersion: APP_VERSION, publicKeyPem: key.publicKeyPem });
}

describe("reading a pack folder", () => {
  it("opens a valid pack and answers with its manifest", () => {
    validPack();
    const source = open(packDir);
    expect(source.manifest.id).toBe("wikipedia-sr");
    expect(source.manifest.files).toHaveLength(1);
  });

  it("refuses a folder with no manifest", () => {
    mkdirSync(packDir, { recursive: true });
    expect(refusal(() => open(packDir))).toBe("not-a-pack");
  });

  it("refuses a path that is not a folder", () => {
    writeFileSync(join(root, "file.txt"), "x");
    expect(refusal(() => open(join(root, "file.txt")))).toBe("not-a-directory");
  });

  it("refuses a pack whose signature is absent", () => {
    const file = entry("wikipedia.zim", CONTENT);
    writePack({
      dir: packDir,
      key: key.privateKey,
      manifest: baseManifest([file]),
      contents: { "wikipedia.zim": CONTENT },
      omitSignature: true,
    });
    expect(refusal(() => open(packDir))).toBe("signature");
  });

  it("refuses a manifest signed by a key that is not this one", () => {
    const other = makeKey();
    const file = entry("wikipedia.zim", CONTENT);
    writePack({
      dir: packDir,
      key: other.privateKey,
      manifest: baseManifest([file]),
      contents: { "wikipedia.zim": CONTENT },
    });
    expect(refusal(() => open(packDir))).toBe("signature");
  });

  it("refuses a manifest edited after it was signed", () => {
    const file = entry("wikipedia.zim", CONTENT);
    const signed = Buffer.from(`${JSON.stringify(baseManifest([file]), null, 2)}\n`, "utf8");
    // The signature covers `signed`; the file on disk is a DIFFERENT manifest
    // that claims a newer version.
    writePack({
      dir: packDir,
      key: key.privateKey,
      signOver: signed,
      manifestBytes: signed,
      contents: { "wikipedia.zim": CONTENT },
    });
    const edited = Buffer.from(`${JSON.stringify(baseManifest([file], { version: "9.9.9" }), null, 2)}\n`);
    writeFileSync(join(packDir, PACK_MANIFEST_FILE), edited);
    expect(refusal(() => open(packDir))).toBe("signature");
  });

  it("refuses a signature over the manifest alone, the updater's shape", () => {
    const { manifestBytes } = writePack({
      dir: packDir,
      key: key.privateKey,
      manifest: baseManifest([entry("wikipedia.zim", CONTENT)]),
      contents: { "wikipedia.zim": CONTENT },
    });
    writeFileSync(join(packDir, PACK_SIGNATURE_FILE), sign(null, manifestBytes, key.privateKey));
    expect(refusal(() => open(packDir))).toBe("signature");
  });

  it("refuses a format this build does not read", () => {
    validPack({ format: 2 });
    expect(refusal(() => open(packDir))).toBe("format-unknown");
  });

  it("refuses a manifest that is not JSON at all", () => {
    const bytes = Buffer.from("this is not JSON", "utf8");
    writePack({ dir: packDir, key: key.privateKey, manifestBytes: bytes });
    expect(refusal(() => open(packDir))).toBe("manifest-unreadable");
  });

  it("refuses a pack that asks for a newer app", () => {
    validPack({ minAppVersion: "99.0.0" });
    expect(refusal(() => open(packDir))).toBe("min-app-version-too-new");
  });

  it("accepts a pack whose minimum is this app's own version", () => {
    validPack({ minAppVersion: APP_VERSION });
    expect(open(packDir).manifest.minAppVersion).toBe(APP_VERSION);
  });

  it("refuses a file the manifest lists but the folder does not have", () => {
    const file = entry("wikipedia.zim", CONTENT);
    writePack({ dir: packDir, key: key.privateKey, manifest: baseManifest([file]) });
    expect(refusal(() => open(packDir))).toBe("missing-file");
  });

  it("refuses a file the folder has but the manifest does not list", () => {
    validPack();
    writeFileSync(join(packDir, "sneaked.zim"), "extra");
    expect(refusal(() => open(packDir))).toBe("extra-file");
  });

  it("refuses a file whose size is not the size the manifest states", () => {
    const file = entry("wikipedia.zim", CONTENT);
    writePack({
      dir: packDir,
      key: key.privateKey,
      manifest: baseManifest([file]),
      contents: { "wikipedia.zim": `${CONTENT} and then some` },
    });
    expect(refusal(() => open(packDir))).toBe("size-mismatch");
  });

  it("refuses a symbolic link or a junction in the source", () => {
    validPack();
    const outside = join(root, "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "elsewhere.zim"), "not part of this pack");
    const link = join(packDir, "linked");
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    expect(refusal(() => open(packDir))).toBe("symlink");
  });

  // Where the chosen folder lives is not the pack's business: a folder reached
  // through a junction, a `subst` drive or a mounted volume is still a folder.
  it("opens a pack whose folder is itself reached through a link", () => {
    validPack();
    const viaLink = join(root, "via-link");
    symlinkSync(packDir, viaLink, process.platform === "win32" ? "junction" : "dir");
    expect(open(viaLink).manifest.id).toBe(baseManifest([]).id);
  });
});
