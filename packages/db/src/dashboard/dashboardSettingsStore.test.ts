import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DashboardSetStore,
  DashboardSettingsStore,
  DashboardSettingsValidationError,
  DEFAULT_BACKGROUND_DIM,
  MAX_BACKGROUND_DIM,
  NexusDatabase,
  openDatabase,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

const NOW = "2026-07-30T10:00:00.000Z";
const LATER = "2026-07-30T11:00:00.000Z";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

function createProfile(name: string): string {
  const id = `profile-${name}`;
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, NOW);
  return id;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-dashboard-"));
  db = openDatabase({ path: join(dir, "dashboard.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("DashboardSettingsStore.get", () => {
  it("answers with defaults — no background, dim 40 — while no row exists", () => {
    const store = new DashboardSettingsStore(db.raw, createProfile("a"));
    expect(store.get()).toEqual({
      backgroundHash: null,
      backgroundMime: null,
      backgroundSizeBytes: null,
      backgroundDim: DEFAULT_BACKGROUND_DIM,
      activeSetId: null,
    });
  });

  it("never writes a row just by being read", () => {
    const profileId = createProfile("a");
    new DashboardSettingsStore(db.raw, profileId).get();
    const { n } = db.raw
      .prepare("SELECT count(*) AS n FROM dashboard_settings")
      .get() as { n: number };
    expect(n).toBe(0);
  });
});

describe("DashboardSettingsStore.setBackground", () => {
  it("creates the row on first write and returns the resolved settings", () => {
    const store = new DashboardSettingsStore(db.raw, createProfile("a"));
    const settings = store.setBackground(HASH, "image/png", 2048, NOW);
    expect(settings).toEqual({
      backgroundHash: HASH,
      backgroundMime: "image/png",
      backgroundSizeBytes: 2048,
      backgroundDim: DEFAULT_BACKGROUND_DIM,
      activeSetId: null,
    });
    expect(store.get()).toEqual(settings);
  });

  it("keeps the dim the profile already chose when the image is replaced", () => {
    const store = new DashboardSettingsStore(db.raw, createProfile("a"));
    store.setDim(75, NOW);
    const settings = store.setBackground(HASH, "image/jpeg", 10, LATER);
    expect(settings.backgroundDim).toBe(75);
  });

  it("accepts every inline image format and refuses anything else", () => {
    const store = new DashboardSettingsStore(db.raw, createProfile("a"));
    for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(() => store.setBackground(HASH, mime, 10, NOW)).not.toThrow();
    }
    expect(() => store.setBackground(HASH, "application/pdf", 10, NOW)).toThrow(
      DashboardSettingsValidationError,
    );
    expect(() => store.setBackground(HASH, "image/svg+xml", 10, NOW)).toThrow(
      DashboardSettingsValidationError,
    );
    expect(() => store.setBackground(HASH, "application/octet-stream", 10, NOW)).toThrow(
      DashboardSettingsValidationError,
    );
  });

  it("refuses a hash that is not a lowercase 64-character sha256", () => {
    const store = new DashboardSettingsStore(db.raw, createProfile("a"));
    expect(() => store.setBackground("a".repeat(63), "image/png", 10, NOW)).toThrow(
      DashboardSettingsValidationError,
    );
    expect(() => store.setBackground("A".repeat(64), "image/png", 10, NOW)).toThrow(
      DashboardSettingsValidationError,
    );
    expect(() => store.setBackground(`${"a".repeat(63)}/`, "image/png", 10, NOW)).toThrow(
      DashboardSettingsValidationError,
    );
  });

  it("refuses a non-positive or non-integer size", () => {
    const store = new DashboardSettingsStore(db.raw, createProfile("a"));
    expect(() => store.setBackground(HASH, "image/png", 0, NOW)).toThrow(
      DashboardSettingsValidationError,
    );
    expect(() => store.setBackground(HASH, "image/png", -1, NOW)).toThrow(
      DashboardSettingsValidationError,
    );
    expect(() => store.setBackground(HASH, "image/png", 1.5, NOW)).toThrow(
      DashboardSettingsValidationError,
    );
  });

  it("refuses a malformed timestamp", () => {
    const store = new DashboardSettingsStore(db.raw, createProfile("a"));
    expect(() => store.setBackground(HASH, "image/png", 10, "juče")).toThrow(
      DashboardSettingsValidationError,
    );
  });
});

describe("DashboardSettingsStore.clearBackground", () => {
  it("drops the image but keeps the dim, so re-picking one restores the same look", () => {
    const store = new DashboardSettingsStore(db.raw, createProfile("a"));
    store.setBackground(HASH, "image/png", 10, NOW);
    store.setDim(15, NOW);

    expect(store.clearBackground(LATER)).toEqual({
      backgroundHash: null,
      backgroundMime: null,
      backgroundSizeBytes: null,
      backgroundDim: 15,
      activeSetId: null,
    });
  });

  it("is a no-op that still answers with defaults when nothing was set", () => {
    const store = new DashboardSettingsStore(db.raw, createProfile("a"));
    expect(store.clearBackground(NOW).backgroundHash).toBeNull();
    expect(store.get().backgroundDim).toBe(DEFAULT_BACKGROUND_DIM);
  });
});

describe("DashboardSettingsStore.setDim", () => {
  it("accepts both ends of the closed range", () => {
    const store = new DashboardSettingsStore(db.raw, createProfile("a"));
    expect(store.setDim(0, NOW).backgroundDim).toBe(0);
    expect(store.setDim(MAX_BACKGROUND_DIM, NOW).backgroundDim).toBe(MAX_BACKGROUND_DIM);
  });

  it("refuses anything outside it, and anything that is not a whole number", () => {
    const store = new DashboardSettingsStore(db.raw, createProfile("a"));
    expect(() => store.setDim(-1, NOW)).toThrow(DashboardSettingsValidationError);
    expect(() => store.setDim(MAX_BACKGROUND_DIM + 1, NOW)).toThrow(
      DashboardSettingsValidationError,
    );
    expect(() => store.setDim(12.5, NOW)).toThrow(DashboardSettingsValidationError);
    expect(() => store.setDim(Number.NaN, NOW)).toThrow(DashboardSettingsValidationError);
  });

  it("leaves the chosen background alone", () => {
    const store = new DashboardSettingsStore(db.raw, createProfile("a"));
    store.setBackground(HASH, "image/webp", 10, NOW);
    expect(store.setDim(80, LATER)).toEqual({
      backgroundHash: HASH,
      backgroundMime: "image/webp",
      backgroundSizeBytes: 10,
      backgroundDim: 80,
      activeSetId: null,
    });
  });

  it("preserves the active-set choice across background and dim writes (ADR-055)", () => {
    const profileId = createProfile("a");
    const store = new DashboardSettingsStore(db.raw, profileId);
    const sets = new DashboardSetStore(db.raw, profileId);
    const set = sets.create("Fakultet", NOW);
    sets.setActive(set.id, NOW);

    store.setDim(25, LATER);
    store.setBackground(HASH, "image/png", 10, LATER);
    store.clearBackground(LATER);
    expect(store.get().activeSetId).toBe(set.id);
  });
});

describe("DashboardSettingsStore — profile scoping", () => {
  it("keeps one profile's choice invisible to another's store", () => {
    const first = new DashboardSettingsStore(db.raw, createProfile("a"));
    const second = new DashboardSettingsStore(db.raw, createProfile("b"));

    first.setBackground(HASH, "image/png", 10, NOW);
    expect(second.get().backgroundHash).toBeNull();

    second.setDim(10, NOW);
    expect(first.get().backgroundDim).toBe(DEFAULT_BACKGROUND_DIM);
  });
});

describe("DashboardSettingsStore.refCount / mimeForHash", () => {
  it("counts every profile that names the hash — the blob store is content-addressed across the whole file", () => {
    const first = new DashboardSettingsStore(db.raw, createProfile("a"));
    const second = new DashboardSettingsStore(db.raw, createProfile("b"));

    expect(first.refCount(HASH)).toBe(0);
    first.setBackground(HASH, "image/png", 10, NOW);
    expect(first.refCount(HASH)).toBe(1);
    // Read through the OTHER profile's store: deliberately profile-agnostic, so
    // garbage collection can never delete a blob a second profile still shows.
    expect(second.refCount(HASH)).toBe(1);

    second.setBackground(HASH, "image/png", 10, NOW);
    expect(first.refCount(HASH)).toBe(2);

    first.clearBackground(LATER);
    expect(first.refCount(HASH)).toBe(1);
    second.clearBackground(LATER);
    expect(first.refCount(HASH)).toBe(0);
  });

  it("resolves the stored mime for a hash any profile names, and null for one nobody does", () => {
    const store = new DashboardSettingsStore(db.raw, createProfile("a"));
    expect(store.mimeForHash(HASH)).toBeNull();
    store.setBackground(HASH, "image/gif", 10, NOW);
    expect(store.mimeForHash(HASH)).toBe("image/gif");
    expect(store.mimeForHash(OTHER_HASH)).toBeNull();
  });
});
