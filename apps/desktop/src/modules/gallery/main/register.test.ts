import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";

import { ModuleHost, type ModuleBlobWrite, type ModulePlatform } from "../../../main/moduleIpc.js";
import { register } from "./register.js";

vi.mock("./nativeImage.js", () => ({
  processGalleryImage: () => ({
    width: 1600,
    height: 900,
    thumbnail: new Uint8Array([9, 8, 7]),
    thumbnailMime: "image/png" as const,
  }),
}));

vi.mock("./art.js", () => ({
  readArt: async () => ({ works: [], skipped: [] }),
}));

vi.mock("../../../main/zim/host.js", () => ({
  zimHost: () => ({
    libraries: () => [],
    images: () => ({ entries: [], nextIndex: 0, done: true }),
  }),
}));

const TRUSTED = { trusted: true };
const NOW = Date.parse("2026-10-24T08:00:00.000Z");
const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlB4ZkAAAAASUVORK5CYII=",
    "base64",
  ),
);

let dir: string;
let db: NexusDatabase;

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function harness() {
  const blobs = new Map<string, Uint8Array>();
  const saveBlob = async (bytes: Uint8Array): Promise<ModuleBlobWrite> => {
    const sha256 = hash(bytes);
    const created = !blobs.has(sha256);
    blobs.set(sha256, bytes);
    return { sha256, created };
  };
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => db.raw,
    notify: () => undefined,
    schedule: () => () => undefined,
    packs: { userData: () => dir, publicKeyPem: "unused" },
    now: () => NOW,
    saveBlob,
    attachFiles: async () => ({ canceled: true }),
    releaseBlob: async (sha256) => {
      blobs.delete(sha256);
    },
  };
  const host = new ModuleHost(platform);
  register(host);
  return { host, blobs };
}

function profile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date(NOW).toISOString());
  return id;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-gallery-module-"));
  db = openDatabase({ path: join(dir, "gallery.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Gallery main handlers", () => {
  it("stores main-decoded dimensions and both encrypted blobs", async () => {
    const { host, blobs } = harness();
    const profileId = profile();
    const bytes = PNG;
    const view = await call<{
      personal: {
        width: number;
        height: number;
        sha256: string;
        thumbnailSha256: string;
        thumbnailSizeBytes: number;
      }[];
    }>(host, "gallery:importImage", {
      profileId,
      fileName: "slika.png",
      title: "Slika",
      notes: "",
      tags: ["more"],
      bytes,
    });
    expect(view.personal[0]).toMatchObject({
      width: 1600,
      height: 900,
      sha256: hash(bytes),
      thumbnailSha256: hash(new Uint8Array([9, 8, 7])),
      thumbnailSizeBytes: 3,
    });
    expect([...blobs.keys()]).toEqual([hash(bytes), hash(new Uint8Array([9, 8, 7]))]);
  });

  it("removes both blobs when metadata cannot be written", async () => {
    const { host, blobs } = harness();
    await expect(
      call(host, "gallery:importImage", {
        profileId: "missing",
        fileName: "slika.png",
        title: "Slika",
        notes: "",
        tags: [],
        bytes: PNG,
      }),
    ).rejects.toThrow();
    expect(blobs.size).toBe(0);
  });

  it("releases both blobs when a personal image is deleted", async () => {
    const { host, blobs } = harness();
    const profileId = profile();
    const imported = await call<{ personal: { id: string }[] }>(host, "gallery:importImage", {
      profileId,
      fileName: "slika.png",
      title: "Slika",
      notes: "",
      tags: [],
      bytes: PNG,
    });
    await call(host, "gallery:remove", { profileId, id: imported.personal[0]!.id });
    expect(blobs.size).toBe(0);
  });

  it("accepts only the raster formats the image decoder and viewer support", async () => {
    const { host } = harness();
    await expect(
      call(host, "gallery:importImage", {
        profileId: profile(),
        fileName: "drawing.svg",
        title: "Drawing",
        notes: "",
        tags: [],
        bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      }),
    ).rejects.toThrow(/PNG, JPEG, WebP or GIF/);
  });
});
