import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { baseManifest, entry, makeKey, writePack } from "./fixtures.js";
import { installPackFromDirectory } from "./install.js";
import {
  PACKS_DIR,
  PACKS_REGISTRY_FILE,
  PACKS_REGISTRY_VERSION,
  readInstalled,
  rebuildInstalled,
  registryPath,
  writeInstalled,
} from "./registry.js";

let root: string;
let userData: string;
let key: ReturnType<typeof makeKey>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nexus-packs-registry-"));
  userData = join(root, "userData");
  key = makeKey();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Installs one pack, which is the only way an installed pack ever comes to exist. */
async function install(version: string): Promise<void> {
  const contents = `content for ${version}`;
  const dir = join(root, `source-${version}`);
  writePack({
    dir,
    key: key.privateKey,
    manifest: baseManifest([entry("content.txt", contents)], { version }),
    contents: { "content.txt": contents },
  });
  await installPackFromDirectory(dir, {
    userData,
    appVersion: "1.6.0",
    publicKeyPem: key.publicKeyPem,
    onProgress: () => undefined,
    freeBytes: () => null,
  });
}

describe("the packs index", () => {
  it("lists nothing when there is no packs directory at all", () => {
    expect(readInstalled(userData, key.publicKeyPem)).toEqual([]);
  });

  it("rebuilds from disk when the index is missing", async () => {
    await install("1.0.0");
    rmSync(registryPath(userData));
    const packs = readInstalled(userData, key.publicKeyPem);
    expect(packs.map((pack) => pack.manifest.version)).toEqual(["1.0.0"]);
    expect(packs[0]?.size).toBe(Buffer.byteLength("content for 1.0.0", "utf8"));
  });

  it("rebuilds when the index is corrupt", async () => {
    await install("1.0.0");
    writeFileSync(registryPath(userData), "{ this is not json");
    expect(readInstalled(userData, key.publicKeyPem).map((p) => p.manifest.version)).toEqual(["1.0.0"]);
  });

  it("rebuilds when the index is of an unknown version", async () => {
    await install("1.0.0");
    writeFileSync(registryPath(userData), JSON.stringify({ version: 99, packs: [] }));
    expect(readInstalled(userData, key.publicKeyPem).map((p) => p.manifest.version)).toEqual(["1.0.0"]);
  });

  it("rebuilds when an entry's manifest is not a manifest", async () => {
    await install("1.0.0");
    writeFileSync(
      registryPath(userData),
      JSON.stringify({
        version: PACKS_REGISTRY_VERSION,
        packs: [{ manifest: { format: 1 }, size: 1, fileCount: 1, installedAt: 1 }],
      }),
    );
    expect(readInstalled(userData, key.publicKeyPem).map((p) => p.manifest.version)).toEqual(["1.0.0"]);
  });

  it("does not list a folder whose signed manifest no longer verifies", async () => {
    await install("1.0.0");
    writeFileSync(
      join(userData, PACKS_DIR, "wikipedia-sr", "1.0.0", "pack.json"),
      `${JSON.stringify(baseManifest([entry("content.txt", "content for 1.0.0")], { version: "9.9.9" }), null, 2)}\n`,
    );
    expect(rebuildInstalled(userData, key.publicKeyPem)).toEqual([]);
  });

  it("round-trips through the written index", async () => {
    await install("1.0.0");
    const written = readInstalled(userData, key.publicKeyPem);
    expect(JSON.parse(readFileSync(registryPath(userData), "utf8"))).toMatchObject({
      version: PACKS_REGISTRY_VERSION,
    });
    // Writing back exactly what was read changes nothing about what is listed.
    writeInstalled(userData, written);
    expect(readInstalled(userData, key.publicKeyPem)).toEqual(written);
  });

  it("writes the index into the packs directory it describes", () => {
    mkdirSync(userData, { recursive: true });
    writeInstalled(userData, []);
    expect(registryPath(userData).endsWith(join(PACKS_DIR, PACKS_REGISTRY_FILE))).toBe(true);
    expect(JSON.parse(readFileSync(registryPath(userData), "utf8"))).toEqual({
      version: PACKS_REGISTRY_VERSION,
      packs: [],
    });
  });
});
