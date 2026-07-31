import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NexusDatabase,
  ProfileNotFoundError,
  ProfileStore,
  ProfileValidationError,
  openDatabase,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

const NOW = "2026-07-30T10:00:00.000Z";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

function createProfile(name: string, createdAt = NOW): string {
  const id = `profile-${name}`;
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, createdAt);
  return id;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-profiles-"));
  db = openDatabase({ path: join(dir, "profiles.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("ProfileStore.list", () => {
  it("answers in creation order, carrying the picture trio as null while none is set", () => {
    createProfile("b", "2026-07-30T11:00:00.000Z");
    createProfile("a", "2026-07-30T10:00:00.000Z");
    expect(new ProfileStore(db.raw).list()).toEqual([
      {
        id: "profile-a",
        kind: "personal",
        name: "a",
        createdAt: "2026-07-30T10:00:00.000Z",
        pictureHash: null,
        pictureMime: null,
        pictureSizeBytes: null,
      },
      {
        id: "profile-b",
        kind: "personal",
        name: "b",
        createdAt: "2026-07-30T11:00:00.000Z",
        pictureHash: null,
        pictureMime: null,
        pictureSizeBytes: null,
      },
    ]);
  });

  it("carries the whole trio once a picture is set", () => {
    const store = new ProfileStore(db.raw);
    const profileId = createProfile("a");
    store.setPicture(profileId, HASH, "image/png", 4096);
    expect(store.list()[0]).toEqual({
      id: profileId,
      kind: "personal",
      name: "a",
      createdAt: NOW,
      pictureHash: HASH,
      pictureMime: "image/png",
      pictureSizeBytes: 4096,
    });
  });
});

describe("ProfileStore.get", () => {
  it("answers with one profile, trio included", () => {
    const store = new ProfileStore(db.raw);
    const profileId = createProfile("a");
    store.setPicture(profileId, HASH, "image/png", 4096);
    expect(store.get(profileId)?.pictureHash).toBe(HASH);
  });

  it("answers null for an id no row carries", () => {
    expect(new ProfileStore(db.raw).get("ghost")).toBeNull();
  });
});

describe("ProfileStore.setPicture", () => {
  it("returns the resolved profile and leaves the name alone", () => {
    const store = new ProfileStore(db.raw);
    const profileId = createProfile("a");
    expect(store.setPicture(profileId, HASH, "image/png", 4096)).toEqual({
      id: profileId,
      kind: "personal",
      name: "a",
      createdAt: NOW,
      pictureHash: HASH,
      pictureMime: "image/png",
      pictureSizeBytes: 4096,
    });
  });

  it("replaces a picture the profile already had", () => {
    const store = new ProfileStore(db.raw);
    const profileId = createProfile("a");
    store.setPicture(profileId, HASH, "image/png", 4096);
    expect(store.setPicture(profileId, OTHER_HASH, "image/jpeg", 8192)).toMatchObject({
      pictureHash: OTHER_HASH,
      pictureMime: "image/jpeg",
      pictureSizeBytes: 8192,
    });
  });

  it("touches only the named profile", () => {
    const store = new ProfileStore(db.raw);
    const mine = createProfile("a");
    const theirs = createProfile("b", "2026-07-30T11:00:00.000Z");
    store.setPicture(mine, HASH, "image/png", 4096);
    expect(store.get(theirs)?.pictureHash).toBeNull();
  });

  it("refuses a hash that is not 64 lowercase hex characters", () => {
    const store = new ProfileStore(db.raw);
    const profileId = createProfile("a");
    for (const bad of ["", "A".repeat(64), "a".repeat(63), `${HASH}0`, "not a hash"]) {
      expect(() => store.setPicture(profileId, bad, "image/png", 4096)).toThrow(
        ProfileValidationError,
      );
    }
  });

  it("refuses a mime outside the inline-image allowlist", () => {
    const store = new ProfileStore(db.raw);
    const profileId = createProfile("a");
    for (const bad of ["application/pdf", "image/svg+xml", "text/html", ""]) {
      expect(() => store.setPicture(profileId, HASH, bad, 4096)).toThrow(ProfileValidationError);
    }
  });

  it("refuses a size that is not a positive whole number", () => {
    const store = new ProfileStore(db.raw);
    const profileId = createProfile("a");
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => store.setPicture(profileId, HASH, "image/png", bad)).toThrow(
        ProfileValidationError,
      );
    }
  });

  it("refuses an id no profile carries", () => {
    expect(() => new ProfileStore(db.raw).setPicture("ghost", HASH, "image/png", 4096)).toThrow(
      ProfileNotFoundError,
    );
  });
});

describe("ProfileStore.clearPicture", () => {
  it("nulls the whole trio at once", () => {
    const store = new ProfileStore(db.raw);
    const profileId = createProfile("a");
    store.setPicture(profileId, HASH, "image/png", 4096);
    expect(store.clearPicture(profileId)).toMatchObject({
      pictureHash: null,
      pictureMime: null,
      pictureSizeBytes: null,
    });
  });

  it("is a no-op on a profile that has none", () => {
    const store = new ProfileStore(db.raw);
    const profileId = createProfile("a");
    expect(store.clearPicture(profileId).pictureHash).toBeNull();
  });

  it("refuses an id no profile carries", () => {
    expect(() => new ProfileStore(db.raw).clearPicture("ghost")).toThrow(ProfileNotFoundError);
  });
});

describe("ProfileStore.refCount", () => {
  it("counts every profile naming the hash, across profiles", () => {
    const store = new ProfileStore(db.raw);
    const first = createProfile("a");
    const second = createProfile("b", "2026-07-30T11:00:00.000Z");
    expect(store.refCount(HASH)).toBe(0);

    store.setPicture(first, HASH, "image/png", 4096);
    expect(store.refCount(HASH)).toBe(1);

    store.setPicture(second, HASH, "image/png", 4096);
    expect(store.refCount(HASH)).toBe(2);

    store.clearPicture(first);
    expect(store.refCount(HASH)).toBe(1);
  });

  it("never counts a hash no profile names", () => {
    const store = new ProfileStore(db.raw);
    store.setPicture(createProfile("a"), HASH, "image/png", 4096);
    expect(store.refCount(OTHER_HASH)).toBe(0);
  });
});

describe("ProfileStore.mimeForHash", () => {
  it("answers the stored mime for a hash any profile names", () => {
    const store = new ProfileStore(db.raw);
    store.setPicture(createProfile("a"), HASH, "image/png", 4096);
    expect(store.mimeForHash(HASH)).toBe("image/png");
  });

  it("answers null for a hash no profile names — the nx-blob 404 gate", () => {
    expect(new ProfileStore(db.raw).mimeForHash(HASH)).toBeNull();
  });
});
