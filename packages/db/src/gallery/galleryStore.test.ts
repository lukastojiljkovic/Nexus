import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GalleryNotFoundError,
  GalleryStore,
  NexusDatabase,
  openDatabase,
  parseGalleryExport,
  uuidv7,
} from "../index.js";

const NOW = "2026-10-24T08:00:00.000Z";
const LATER = "2026-10-24T09:00:00.000Z";

let dir: string;
let db: NexusDatabase;
let profileId: string;
let gallery: GalleryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-gallery-"));
  db = openDatabase({ path: join(dir, "gallery.db") });
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "P", NOW);
  gallery = new GalleryStore(db.raw, profileId);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function item(title = "More") {
  return {
    title,
    notes: "Leto 2026.",
    tags: ["more", "Leto"],
    fileName: "more.jpg",
    mime: "image/jpeg",
    sizeBytes: 12_345,
    sha256: "a".repeat(64),
    thumbnailMime: "image/png",
    thumbnailSha256: "b".repeat(64),
    thumbnailSizeBytes: 8_000,
    width: 1600,
    height: 900,
  };
}

describe("GalleryStore", () => {
  it("creates, lists, edits and soft-deletes profile-owned images", () => {
    const created = gallery.create(item(), NOW);
    expect(gallery.listActive()).toEqual([created]);
    expect(gallery.update(created.id, { title: "Jadransko more" }, LATER).title).toBe(
      "Jadransko more",
    );
    gallery.remove(created.id, LATER);
    expect(gallery.listActive()).toEqual([]);
    expect(() => gallery.get(created.id)).toThrow(GalleryNotFoundError);
  });

  it("round-trips through the archive and replaces only its own profile", () => {
    const created = gallery.create(item(), NOW);
    const exported = gallery.exportData();
    expect(parseGalleryExport(JSON.parse(JSON.stringify(exported)))).toEqual(exported);
    gallery.importData({ version: 1, items: [] });
    expect(gallery.listActive()).toEqual([]);
    gallery.importData(exported);
    expect(gallery.listActive()[0]).toMatchObject({ id: created.id, title: "More" });
  });

  it("counts and names both the original and generated thumbnail", () => {
    gallery.create(item(), NOW);
    expect(gallery.refCount("a".repeat(64))).toBe(1);
    expect(gallery.mimeForHash("a".repeat(64))).toBe("image/jpeg");
    expect(gallery.refCount("b".repeat(64))).toBe(1);
    expect(gallery.mimeForHash("b".repeat(64))).toBe("image/png");
    expect(gallery.mimeForHash("c".repeat(64))).toBeNull();
  });

  it("refuses archive metadata whose hashes or media types could not be served", () => {
    const exported = gallery.exportData();
    const base = {
      id: uuidv7(),
      title: "Slika",
      notes: "",
      tags: [],
      fileName: "slika.png",
      mime: "image/png",
      sizeBytes: 10,
      sha256: "a".repeat(64),
      thumbnailMime: "image/png",
      thumbnailSha256: "b".repeat(64),
      thumbnailSizeBytes: 8,
      width: 10,
      height: 10,
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(() =>
      parseGalleryExport({ ...exported, items: [{ ...base, sha256: "not-a-digest" }] }),
    ).toThrow();
    expect(() =>
      parseGalleryExport({ ...exported, items: [{ ...base, mime: "text/html" }] }),
    ).toThrow();
  });
});
