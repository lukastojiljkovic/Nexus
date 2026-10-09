import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InstalledPackView, PackProgress } from "../../shared/ipc.js";
import { baseManifest, entry, makeKey, writePack } from "./fixtures.js";
import { createPacksIpc, type PacksIpcDeps } from "./packsIpc.js";

const CONTENT = "content the card would install";

let root: string;
let userData: string;
let key: ReturnType<typeof makeKey>;
let picked: string | null;
let progress: PackProgress[];
let changes: InstalledPackView[][];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nexus-packs-ipc-"));
  userData = join(root, "userData");
  key = makeKey();
  picked = null;
  progress = [];
  changes = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function service(overrides: Partial<PacksIpcDeps> = {}) {
  return createPacksIpc({
    userData,
    appVersion: "1.6.0",
    publicKeyPem: key.publicKeyPem,
    pickFolder: () => Promise.resolve(picked),
    onProgress: (row) => progress.push(row),
    onChanged: (packs) => changes.push(packs),
    freeBytes: () => null,
    ...overrides,
  });
}

function source(name: string, version = "1.0.0"): string {
  const dir = join(root, name);
  writePack({
    dir,
    key: key.privateKey,
    manifest: baseManifest([entry("content.txt", CONTENT)], { version }),
    contents: { "content.txt": CONTENT },
  });
  return dir;
}

describe("the packs IPC surface", () => {
  it("lists nothing on a device that has never installed a pack", async () => {
    expect(await service().list()).toEqual([]);
  });

  it("inspects a chosen folder, installs it, and announces the change", async () => {
    const packs = service();
    picked = source("pack");

    const inspected = await packs.inspect();
    expect(inspected).toMatchObject({ outcome: "ready" });
    if (inspected.outcome !== "ready") throw new Error("expected a ready candidate");
    expect(inspected.candidate.id).toBe("wikipedia-sr");
    expect(inspected.candidate.size).toBe(Buffer.byteLength(CONTENT, "utf8"));
    expect(inspected.candidate.minAppVersion).toBe("1.0.0");
    // Inspecting does not install anything.
    expect(await packs.list()).toEqual([]);

    const installed = await packs.install();
    expect(installed).toMatchObject({ outcome: "installed" });
    if (installed.outcome !== "installed") throw new Error("expected an install");
    expect(installed.pack.version).toBe("1.0.0");
    expect(installed.pack.licence.spdx).toBe("CC-BY-SA-4.0");
    expect(installed.pack.licence.attribution).toBe("Wikipedia contributors");

    expect((await packs.list()).map((pack) => pack.id)).toEqual(["wikipedia-sr"]);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.map((pack) => pack.id)).toEqual(["wikipedia-sr"]);
    expect(progress.map((row) => row.phase)).toEqual(["copy"]);
  });

  it("answers a cancelled dialog, and refuses to install what was never inspected", async () => {
    const packs = service();
    picked = null;
    expect(await packs.inspect()).toEqual({ outcome: "cancelled" });
    expect(await packs.install()).toEqual({ outcome: "refused", code: "no-candidate" });
  });

  it("refuses an older version at inspection, before Install is offered", async () => {
    const packs = service();
    picked = source("newer", "1.0.1");
    await packs.inspect();
    await packs.install();

    picked = source("older", "1.0.0");
    expect(await packs.inspect()).toEqual({ outcome: "refused", code: "older-than-installed" });
    expect(await packs.install()).toEqual({ outcome: "refused", code: "no-candidate" });
  });

  it("refuses a folder that is not a pack, with the code that names the rule", async () => {
    const packs = service();
    picked = join(root, "nothing-here");
    rmSync(picked, { recursive: true, force: true });
    writeFileSync(picked, "this is a file, not a pack folder");
    expect(await packs.inspect()).toEqual({ outcome: "refused", code: "not-a-directory" });
  });

  it("clears the waiting candidate after an install, so a second call cannot repeat it", async () => {
    const packs = service();
    picked = source("pack");
    await packs.inspect();
    expect(await packs.install()).toMatchObject({ outcome: "installed" });
    expect(await packs.install()).toEqual({ outcome: "refused", code: "no-candidate" });
  });

  it("re-reads the folder on install, so a swap between the two calls is caught", async () => {
    const packs = service();
    picked = source("pack");
    await packs.inspect();
    // What the dialog picked is replaced by something that is not that pack any
    // more: the install must verify again rather than trust the inspection.
    writeFileSync(join(picked, "sneaked.txt"), "an unlisted file");
    expect(await packs.install()).toEqual({ outcome: "refused", code: "extra-file" });
  });

  it("removes an installed pack and reports an id that is not installed", async () => {
    const packs = service();
    picked = source("pack");
    await packs.inspect();
    await packs.install();

    expect(await packs.remove("wikipedia-sr")).toEqual({ outcome: "removed", id: "wikipedia-sr" });
    expect(await packs.list()).toEqual([]);
    expect(await packs.remove("wikipedia-sr")).toEqual({ outcome: "refused", code: "not-found" });
  });

  it("verifies an installed pack, and refuses one that is not installed", async () => {
    const packs = service();
    picked = source("pack");
    await packs.inspect();
    await packs.install();

    const verified = await packs.verify("wikipedia-sr");
    expect(verified).toMatchObject({ outcome: "ok" });
    expect(await packs.verify("not-here")).toEqual({ outcome: "refused", code: "not-found" });
  });

  it("refuses an id whose shape is not a pack id", async () => {
    const packs = service();
    await expect(packs.remove("Not A Pack Id")).rejects.toThrow(/kebab-case/);
  });

  it("propagates a bug rather than dressing it as a refusal", async () => {
    const packs = service({
      pickFolder: () => {
        throw new Error("the dialog fell over");
      },
    });
    await expect(packs.inspect()).rejects.toThrow(/dialog fell over/);
  });
});

describe("a volume with no room", () => {
  it("refuses with no-space before it copies anything, and announces nothing", async () => {
    const packs = service({ freeBytes: () => 1 });
    picked = source("pack");
    await packs.inspect();
    const outcome = await packs.install();
    expect(outcome).toEqual({ outcome: "refused", code: "no-space" });
    expect(changes).toEqual([]);
  });
});
