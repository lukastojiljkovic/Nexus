import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PackError } from "./errors.js";
import { baseManifest, entry, makeKey, writePack } from "./fixtures.js";
import {
  installPackFromDirectory,
  removeInstalledPack,
  verifyInstalledPack,
  volumeFreeBytes,
  type PackInstallDeps,
} from "./install.js";
import { PACKS_STAGING_DIR, packsRoot, readInstalled } from "./registry.js";

const APP_VERSION = "1.6.0";
const CONTENT = "the first version of the content";

let root: string;
let userData: string;
let key: ReturnType<typeof makeKey>;
let progress: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nexus-packs-install-"));
  userData = join(root, "userData");
  key = makeKey();
  progress = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function deps(overrides: Partial<PackInstallDeps> = {}): PackInstallDeps {
  return {
    userData,
    appVersion: APP_VERSION,
    publicKeyPem: key.publicKeyPem,
    onProgress: (row) => progress.push(`${row.phase}:${row.file}`),
    freeBytes: () => null,
    ...overrides,
  };
}

/** Writes a pack folder under `root` and answers its path. */
function source(name: string, options: {
  readonly version?: string;
  readonly contents?: Readonly<Record<string, string>>;
  readonly badHashFor?: string;
  readonly id?: string;
} = {}): string {
  const version = options.version ?? "1.0.0";
  const contents = options.contents ?? { "wikipedia.zim": CONTENT };
  const files = Object.entries(contents).map(([path, text]) => {
    const computed = entry(path, text);
    return options.badHashFor === path ? { ...computed, sha256: "0".repeat(64) } : computed;
  });
  const dir = join(root, name);
  writePack({
    dir,
    key: key.privateKey,
    manifest: baseManifest(files, { version, ...(options.id === undefined ? {} : { id: options.id }) }),
    contents,
  });
  return dir;
}

function refusal(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "no-throw",
    (error: unknown) => (error instanceof PackError ? error.code : `not-a-pack-error: ${String(error)}`),
  );
}

/** Everything left under `.staging`, which must be nothing after any failure. */
function stagingLeftovers(): string[] {
  const staging = join(packsRoot(userData), PACKS_STAGING_DIR);
  return existsSync(staging) ? readdirSync(staging) : [];
}

describe("installing a pack", () => {
  it("copies a valid pack into place and records it", async () => {
    const installed = await installPackFromDirectory(source("pack"), deps());

    expect(installed.manifest.id).toBe("wikipedia-sr");
    expect(installed.manifest.version).toBe("1.0.0");
    expect(installed.fileCount).toBe(1);
    expect(installed.size).toBe(Buffer.byteLength(CONTENT, "utf8"));
    expect(installed.installedAt).toBeGreaterThan(0);

    const dir = join(packsRoot(userData), "wikipedia-sr", "1.0.0");
    expect(readFileSync(join(dir, "wikipedia.zim"), "utf8")).toBe(CONTENT);
    // The manifest and its signature travel with the content, so the installed
    // copy can prove what it is without the folder it came from.
    expect(existsSync(join(dir, "pack.json"))).toBe(true);
    expect(existsSync(join(dir, "pack.json.sig"))).toBe(true);

    const listed = readInstalled(userData, key.publicKeyPem);
    expect(listed.map((pack) => pack.manifest.version)).toEqual(["1.0.0"]);
    expect(progress).toEqual(["copy:wikipedia.zim"]);
  });

  it("keeps a nested folder structure", async () => {
    await installPackFromDirectory(
      source("nested", { contents: { "data/2026/articles.zim": "deep" } }),
      deps(),
    );
    const target = join(packsRoot(userData), "wikipedia-sr", "1.0.0", "data", "2026", "articles.zim");
    expect(readFileSync(target, "utf8")).toBe("deep");
  });

  it("refuses a file whose hash is not the manifest's, and leaves nothing behind", async () => {
    const code = await refusal(
      installPackFromDirectory(source("bad", { badHashFor: "wikipedia.zim" }), deps()),
    );
    expect(code).toBe("hash-mismatch");
    expect(existsSync(join(packsRoot(userData), "wikipedia-sr"))).toBe(false);
    expect(stagingLeftovers()).toEqual([]);
    expect(readInstalled(userData, key.publicKeyPem)).toEqual([]);
  });

  it("refuses before copying a byte when the volume has no room", async () => {
    const code = await refusal(
      installPackFromDirectory(source("pack"), deps({ freeBytes: () => 0 })),
    );
    expect(code).toBe("no-space");
    expect(stagingLeftovers()).toEqual([]);
  });

  it("leaves the old version installed and working when an upgrade fails", async () => {
    await installPackFromDirectory(source("v1"), deps());
    const code = await refusal(
      installPackFromDirectory(
        source("v2", { version: "1.0.1", badHashFor: "wikipedia.zim" }),
        deps(),
      ),
    );
    expect(code).toBe("hash-mismatch");

    const dir = join(packsRoot(userData), "wikipedia-sr", "1.0.0");
    expect(readFileSync(join(dir, "wikipedia.zim"), "utf8")).toBe(CONTENT);
    expect(readdirSync(join(packsRoot(userData), "wikipedia-sr"))).toEqual(["1.0.0"]);
    expect(readInstalled(userData, key.publicKeyPem).map((p) => p.manifest.version)).toEqual(["1.0.0"]);
    expect(stagingLeftovers()).toEqual([]);
  });

  it("removes the previous version once the new one is complete", async () => {
    await installPackFromDirectory(source("v1"), deps());
    const installer = source("v2", {
      version: "1.0.1",
      contents: { "wikipedia.zim": "the second version of the content" },
    });
    await installPackFromDirectory(installer, deps());

    const idDir = join(packsRoot(userData), "wikipedia-sr");
    expect(readdirSync(idDir)).toEqual(["1.0.1"]);
    expect(readdirSync(idDir)[0]).not.toBe("1.0.0");
    const listed = readInstalled(userData, key.publicKeyPem);
    expect(listed.map((pack) => pack.manifest.version)).toEqual(["1.0.1"]);
  });

  it("replaces the same version when it is installed again", async () => {
    await installPackFromDirectory(source("v1"), deps());
    await installPackFromDirectory(
      source("v1b", { contents: { "wikipedia.zim": "a repack of the same version" } }),
      deps(),
    );
    const idDir = join(packsRoot(userData), "wikipedia-sr");
    expect(readdirSync(idDir)).toEqual(["1.0.0"]);
    expect(readFileSync(join(idDir, "1.0.0", "wikipedia.zim"), "utf8")).toBe(
      "a repack of the same version",
    );
  });

  it("refuses a folder that is not a pack, before creating a staging directory", async () => {
    const dir = join(root, "empty");
    rmSync(dir, { recursive: true, force: true });
    writeFileSync(join(root, "not-a-pack.txt"), "x");
    const code = await refusal(installPackFromDirectory(join(root, "not-a-pack.txt"), deps()));
    expect(code).toBe("not-a-directory");
    expect(existsSync(packsRoot(userData))).toBe(false);
  });
});

describe("verifying an installed pack", () => {
  it("reports a pack whose every hash still matches", async () => {
    await installPackFromDirectory(source("pack"), deps());
    progress = [];
    const verified = await verifyInstalledPack({
      userData,
      id: "wikipedia-sr",
      publicKeyPem: key.publicKeyPem,
      onProgress: (row) => progress.push(`${row.phase}:${row.file}`),
    });
    expect(verified.manifest.version).toBe("1.0.0");
    expect(progress).toEqual(["verify:wikipedia.zim"]);
  });

  it("refuses a pack whose content changed under it", async () => {
    await installPackFromDirectory(source("pack"), deps());
    writeFileSync(join(packsRoot(userData), "wikipedia-sr", "1.0.0", "wikipedia.zim"), "tampered");
    const code = await refusal(
      verifyInstalledPack({
        userData,
        id: "wikipedia-sr",
        publicKeyPem: key.publicKeyPem,
        onProgress: () => undefined,
      }),
    );
    expect(code).toBe("hash-mismatch");
  });

  it("refuses a pack a file went missing from", async () => {
    await installPackFromDirectory(source("pack"), deps());
    rmSync(join(packsRoot(userData), "wikipedia-sr", "1.0.0", "wikipedia.zim"));
    const code = await refusal(
      verifyInstalledPack({
        userData,
        id: "wikipedia-sr",
        publicKeyPem: key.publicKeyPem,
        onProgress: () => undefined,
      }),
    );
    expect(code).toBe("missing-file");
  });

  it("refuses an id that is not installed", async () => {
    const code = await refusal(
      verifyInstalledPack({
        userData,
        id: "not-here",
        publicKeyPem: key.publicKeyPem,
        onProgress: () => undefined,
      }),
    );
    expect(code).toBe("not-found");
  });
});

describe("removing an installed pack", () => {
  it("deletes the folder and drops it from the index", async () => {
    await installPackFromDirectory(source("pack"), deps());
    const remaining = await removeInstalledPack({
      userData,
      id: "wikipedia-sr",
      publicKeyPem: key.publicKeyPem,
    });
    expect(remaining).toEqual([]);
    expect(existsSync(join(packsRoot(userData), "wikipedia-sr"))).toBe(false);
  });

  it("refuses an id that is not installed", async () => {
    const code = await refusal(
      removeInstalledPack({ userData, id: "not-here", publicKeyPem: key.publicKeyPem }),
    );
    expect(code).toBe("not-found");
  });
});

describe("free space", () => {
  it("answers a real number for a directory that exists", () => {
    const free = volumeFreeBytes(root);
    expect(free).not.toBeNull();
    expect(free ?? 0).toBeGreaterThan(0);
  });

  it("answers null rather than guessing for a path that cannot be measured", () => {
    expect(volumeFreeBytes(join(root, "no", "such", "place"))).toBeNull();
  });
});
