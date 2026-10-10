import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CarStore,
  CultureStore,
  DashboardSetStore,
  DashboardSettingsStore,
  EventStore,
  LibraryStore,
  MAX_PROFILE_NAME_LENGTH,
  NexusDatabase,
  NoteAttachmentStore,
  NoteStore,
  ProfileAnchorDeleteError,
  ProfileLastDeleteError,
  ProfileNotFoundError,
  ProfileStore,
  ProfileValidationError,
  RecipeStore,
  RecorderStore,
  SearchHistoryStore,
  SqliteFlagStore,
  SubjectAttachmentStore,
  SubjectStore,
  TaskAttachmentStore,
  TaskListStore,
  TaskStore,
  openDatabase,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

const NOW = "2026-07-30T10:00:00.000Z";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
/** Culture's own hash, distinct from the two the other modules use, so the union's answer names all three. */
const TRACK_HASH = "c".repeat(64);
/**
 * The four hashes the kit modules' own tables name (ADR-108): a library cover,
 * a recipe photo, a car receipt and a recording. Each is distinct, so a union
 * arm that stopped reading one of those tables shows up as a MISSING value
 * rather than as an answer that merely looks plausible.
 */
const COVER_HASH = "1".repeat(64);
const PHOTO_HASH = "2".repeat(64);
const RECEIPT_HASH = "3".repeat(64);
const RECORDING_HASH = "4".repeat(64);

function createProfile(
  name: string,
  createdAt = NOW,
  kind: "personal" | "business" = "personal",
): string {
  const id = `profile-${name}`;
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, kind, name, createdAt);
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

describe("ProfileStore.create", () => {
  it("creates a business profile and returns the row (ADR-058)", () => {
    const store = new ProfileStore(db.raw);
    const created = store.create("business", "Firma", NOW);
    expect(created).toEqual({
      id: created.id,
      kind: "business",
      name: "Firma",
      createdAt: NOW,
      pictureHash: null,
      pictureMime: null,
      pictureSizeBytes: null,
    });
    expect(store.get(created.id)).toEqual(created);
  });

  it("creates a personal profile too — the kind domain is the CHECK's, not 'business only'", () => {
    expect(new ProfileStore(db.raw).create("personal", "Luka", NOW).kind).toBe("personal");
  });

  it("stores the EMPTY name verbatim — the ONB-lite 'not yet named' sentinel", () => {
    // Pinned deliberately: `seedFirstRunProfile` writes "" for the same reason,
    // and the shell routes a profile whose name is "" through the ONB-lite
    // first-entry naming screen. A store that refused "" would break that flow.
    expect(new ProfileStore(db.raw).create("business", "", NOW).name).toBe("");
  });

  it("trims a non-empty name and stores the trimmed value", () => {
    expect(new ProfileStore(db.raw).create("business", "  Firma  ", NOW).name).toBe("Firma");
  });

  it("treats a whitespace-only name as the empty sentinel — trimming comes first", () => {
    expect(new ProfileStore(db.raw).create("business", "   ", NOW).name).toBe("");
  });

  it("refuses a name over the cap after trimming", () => {
    const store = new ProfileStore(db.raw);
    expect(store.create("business", "x".repeat(MAX_PROFILE_NAME_LENGTH), NOW).name).toHaveLength(
      MAX_PROFILE_NAME_LENGTH,
    );
    expect(() => store.create("business", "x".repeat(MAX_PROFILE_NAME_LENGTH + 1), NOW)).toThrow(
      ProfileValidationError,
    );
  });

  it("refuses a kind outside the CHECK's domain", () => {
    for (const bad of ["", "work", "PERSONAL", "Business"]) {
      expect(() =>
        new ProfileStore(db.raw).create(bad as "personal" | "business", "Firma", NOW),
      ).toThrow(ProfileValidationError);
    }
  });

  it("refuses a malformed now", () => {
    expect(() => new ProfileStore(db.raw).create("business", "Firma", "not a date")).toThrow(
      ProfileValidationError,
    );
  });

  it("does not seed the Inbox or feature flags — main owns seeding", () => {
    const created = new ProfileStore(db.raw).create("business", "Firma", NOW);
    const lists = db.raw
      .prepare("SELECT count(*) AS n FROM task_lists WHERE profile_id = ?")
      .get(created.id) as { n: number };
    const flags = db.raw
      .prepare("SELECT count(*) AS n FROM feature_flags WHERE profile_id = ?")
      .get(created.id) as { n: number };
    expect({ lists: lists.n, flags: flags.n }).toEqual({ lists: 0, flags: 0 });
  });
});

describe("ProfileStore.delete", () => {
  /** Seeds a business profile with rows in every module a delete must take with it, and returns its id. */
  function seedDoomedBusinessProfile(): string {
    const profileId = new ProfileStore(db.raw).create("business", "Firma", NOW).id;
    new TaskListStore(db.raw, profileId).ensureInbox(NOW);
    const task = new TaskStore(db.raw, profileId).create({ title: "jedinstvenizadatak" });
    new TaskAttachmentStore(db.raw, profileId).add(
      task.id,
      { fileName: "a.pdf", mime: "application/pdf", sizeBytes: 4, sha256: HASH },
      NOW,
    );
    new EventStore(db.raw, profileId).create({ title: "Sastanak", startAt: NOW });
    const note = new NoteStore(db.raw, profileId).create(NOW);
    new NoteAttachmentStore(db.raw, profileId).add(
      note.id,
      { fileName: "b.png", mime: "image/png", sizeBytes: 4, sha256: OTHER_HASH },
      NOW,
    );
    const subject = new SubjectStore(db.raw, profileId).create({ name: "Analiza" });
    new SubjectAttachmentStore(db.raw, profileId).add(
      subject.id,
      { fileName: "c.pdf", mime: "application/pdf", sizeBytes: 4, sha256: HASH },
      NOW,
    );
    new DashboardSetStore(db.raw, profileId).create("Tabla", NOW);
    new DashboardSettingsStore(db.raw, profileId).setBackground("f".repeat(64), "image/png", 4, NOW);
    // The culture corner (migration 073), seeded down to both of its CHILD
    // tables: a visit's photo and a playlist's item carry no `profile_id`, so
    // they are the two rows the audit below proves a profile delete reaches
    // through their parents.
    const culture = new CultureStore(db.raw, profileId);
    const visit = culture.createVisit(
      { kind: "theatre", title: "Hamlet", venue: "Narodno pozorište", date: "2026-05-01" },
      NOW,
    );
    culture.addVisitPhoto(
      visit.id,
      { fileName: "program.pdf", mime: "application/pdf", sizeBytes: 4, sha256: OTHER_HASH },
      NOW,
    );
    const track = culture.createTrack(
      { title: "Pesma", durationMs: 1_000, fileName: "pesma.mp3", mime: "audio/mpeg", sizeBytes: 4, sha256: HASH },
      NOW,
    );
    const playlist = culture.createPlaylist("Za kola", NOW);
    culture.addPlaylistTrack(playlist.id, track.id, NOW);
    // The device-local search history (SRCH-009 / migration 050) — seeded so
    // the schema-driven audit below actually has something to prove about it.
    // Deleting a profile DOES take its remembered queries: they are excluded
    // from an archive and from a restore's wipe, never from the profile they
    // belong to ceasing to exist.
    new SearchHistoryStore(db.raw, profileId).record("#posao rok:danas", NOW);
    // A flag row is the one profile-referencing row migration 001 gave no ON
    // DELETE CASCADE — the delete must clear it explicitly or fail on the FK.
    db.raw
      .prepare(
        "INSERT INTO feature_flags (profile_id, module_id, enabled, updated_at) VALUES (?, ?, 1, ?)",
      )
      .run(profileId, "study", NOW);
    return profileId;
  }

  it("hard-deletes the row and every table's rows the profile owned — the cascade audit", () => {
    const keeper = createProfile("keeper");
    const doomed = seedDoomedBusinessProfile();
    const store = new ProfileStore(db.raw);

    store.delete(doomed, NOW);

    expect(store.get(doomed)).toBeNull();
    expect(store.get(keeper)).not.toBeNull();

    // Every table carrying a `profile_id` column must hold zero rows for the
    // deleted profile — enumerated from the schema itself, so a future
    // migration's table joins this audit automatically.
    const tables = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    for (const table of tables) {
      const columns = db.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some((column) => column.name === "profile_id")) continue;
      const { n } = db.raw
        .prepare(`SELECT count(*) AS n FROM ${table} WHERE profile_id = ?`)
        .get(doomed) as { n: number };
      expect({ table, n }).toEqual({ table, n: 0 });
    }

    // The child tables that carry no `profile_id` of their own reach zero
    // through their parents' cascades — the keeper seeded none, so a total
    // count is exact here.
    for (const table of [
      "task_attachments",
      "note_attachments",
      "subject_attachments",
      "note_updates",
      "culture_visit_photos",
      "culture_playlist_items",
    ]) {
      const { n } = db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
      expect({ table, n }).toEqual({ table, n: 0 });
    }
  });

  it("leaves no ghost rows in the FTS shadow — search stops finding the deleted profile's text", () => {
    createProfile("keeper");
    const keeperWithTask = createProfile("keeper2", "2026-07-30T11:00:00.000Z");
    new TaskListStore(db.raw, keeperWithTask).ensureInbox(NOW);
    new TaskStore(db.raw, keeperWithTask).create({ title: "jedinstvenizadatak" });

    const doomed = seedDoomedBusinessProfile();
    const before = db.raw
      .prepare("SELECT count(*) AS n FROM search_fts WHERE search_fts MATCH ?")
      .get("jedinstvenizadatak") as { n: number };
    expect(before.n).toBe(2);

    new ProfileStore(db.raw).delete(doomed, NOW);

    // One hit left — the keeper's. `search_fts` is maintained purely by the
    // AD triggers on `search_entries`, and the store deletes those rows
    // explicitly (never leaning on cascade to fire a trigger), so this pins
    // the whole chain: entries gone, shadow ghost-free, the keeper untouched.
    const after = db.raw
      .prepare("SELECT count(*) AS n FROM search_fts WHERE search_fts MATCH ?")
      .get("jedinstvenizadatak") as { n: number };
    expect(after.n).toBe(1);
    const entries = db.raw
      .prepare("SELECT count(*) AS n FROM search_entries WHERE profile_id = ?")
      .get(doomed) as { n: number };
    expect(entries.n).toBe(0);
  });

  it("refuses the personal profile — the account's anchor", () => {
    createProfile("other", "2026-07-30T11:00:00.000Z", "business");
    const personal = createProfile("a");
    expect(() => new ProfileStore(db.raw).delete(personal, NOW)).toThrow(ProfileAnchorDeleteError);
  });

  it("refuses the last remaining profile, whatever its kind", () => {
    const lone = createProfile("lone", NOW, "business");
    expect(() => new ProfileStore(db.raw).delete(lone, NOW)).toThrow(ProfileLastDeleteError);
  });

  it("refuses an id no profile carries", () => {
    createProfile("a");
    expect(() => new ProfileStore(db.raw).delete("ghost", NOW)).toThrow(ProfileNotFoundError);
  });

  it("refuses a malformed now", () => {
    createProfile("a");
    const business = createProfile("b", "2026-07-30T11:00:00.000Z", "business");
    expect(() => new ProfileStore(db.raw).delete(business, "not a date")).toThrow(
      ProfileValidationError,
    );
  });
});

describe("ProfileStore.blobHashes", () => {
  it("unions every hash the profile's rows name across every blob-naming table", () => {
    const profileId = new ProfileStore(db.raw).create("business", "Firma", NOW).id;
    new TaskListStore(db.raw, profileId).ensureInbox(NOW);
    const task = new TaskStore(db.raw, profileId).create({ title: "Zadatak" });
    new TaskAttachmentStore(db.raw, profileId).add(
      task.id,
      { fileName: "a.pdf", mime: "application/pdf", sizeBytes: 4, sha256: HASH },
      NOW,
    );
    const note = new NoteStore(db.raw, profileId).create(NOW);
    new NoteAttachmentStore(db.raw, profileId).add(
      note.id,
      // The task's own hash again — the union must deduplicate, not repeat.
      { fileName: "b.png", mime: "image/png", sizeBytes: 4, sha256: HASH },
      NOW,
    );
    const subject = new SubjectStore(db.raw, profileId).create({ name: "Analiza" });
    new SubjectAttachmentStore(db.raw, profileId).add(
      subject.id,
      { fileName: "c.pdf", mime: "application/pdf", sizeBytes: 4, sha256: OTHER_HASH },
      NOW,
    );
    const backgroundHash = "f".repeat(64);
    new DashboardSettingsStore(db.raw, profileId).setBackground(backgroundHash, "image/png", 4, NOW);
    const pictureHash = "e".repeat(64);
    const store = new ProfileStore(db.raw);
    store.setPicture(profileId, pictureHash, "image/png", 4);
    // Culture's two, added by migration 073: a visit's photo and the track a
    // listening log points at. The track reuses the task's hash on purpose —
    // the union deduplicates across every table, not merely within one.
    const culture = new CultureStore(db.raw, profileId);
    const visit = culture.createVisit(
      { kind: "museum", title: "Postavka", venue: "Muzej", date: "2026-05-01" },
      NOW,
    );
    culture.addVisitPhoto(
      visit.id,
      { fileName: "d.jpg", mime: "image/jpeg", sizeBytes: 4, sha256: HASH },
      NOW,
    );
    culture.createTrack(
      { title: "Pesma", durationMs: 1_000, fileName: "e.mp3", mime: "audio/mpeg", sizeBytes: 4, sha256: TRACK_HASH },
      NOW,
    );

    // And the four the kit modules' own tables name (ADR-108), through the
    // stores that write them rather than by hand: a library cover, a recipe
    // photo, a car receipt and a recording. Deleting the profile cascades every
    // one of those rows away, so their bytes are orphaned by the same delete -
    // this list is the only thing that knows to collect them.
    const library = new LibraryStore(db.raw, profileId);
    const item = library.createItem({ kind: "book", title: "Knjiga" }, NOW);
    library.setCover(
      item.id,
      { fileName: "korica.jpg", mime: "image/jpeg", sizeBytes: 4, sha256: COVER_HASH },
      NOW,
    );
    new RecipeStore(db.raw, profileId).create(
      {
        title: "Sarma",
        course: "main",
        servings: 4,
        ingredients: [],
        steps: [{ text: "Kuvati." }],
        source: "own",
        photo: { fileName: "jelo.jpg", mime: "image/jpeg", sizeBytes: 4, sha256: PHOTO_HASH },
      },
      NOW,
    );
    const cars = new CarStore(db.raw, profileId);
    const vehicle = cars.createVehicle(
      {
        name: "Pasat",
        make: "Volkswagen",
        model: "Passat",
        year: 2015,
        fuelType: "diesel",
        distanceUnit: "km",
      },
      NOW,
    );
    const service = cars.createService(
      vehicle.id,
      { date: "2026-05-01", category: "oil", description: "Mali servis" },
      NOW,
    );
    cars.addServiceAttachment(
      service.id,
      { fileName: "racun.pdf", mime: "application/pdf", sizeBytes: 4, sha256: RECEIPT_HASH },
      NOW,
    );
    new RecorderStore(db.raw, profileId).create(
      {
        kind: "audio",
        mime: "audio/webm;codecs=opus",
        durationMs: 1_000,
        sizeBytes: 4,
        sha256: RECORDING_HASH,
      },
      NOW,
    );

    expect(store.blobHashes(profileId).sort()).toEqual(
      [
        HASH,
        OTHER_HASH,
        TRACK_HASH,
        COVER_HASH,
        PHOTO_HASH,
        RECEIPT_HASH,
        RECORDING_HASH,
        backgroundHash,
        pictureHash,
      ].sort(),
    );
  });

  it("includes a soft-deleted parent's attachments — their rows still hold the bytes", () => {
    const profileId = new ProfileStore(db.raw).create("business", "Firma", NOW).id;
    new TaskListStore(db.raw, profileId).ensureInbox(NOW);
    const tasks = new TaskStore(db.raw, profileId);
    const task = tasks.create({ title: "Zadatak" });
    new TaskAttachmentStore(db.raw, profileId).add(
      task.id,
      { fileName: "a.pdf", mime: "application/pdf", sizeBytes: 4, sha256: HASH },
      NOW,
    );
    tasks.softDelete(task.id);
    expect(new ProfileStore(db.raw).blobHashes(profileId)).toEqual([HASH]);
  });

  it("never answers another profile's hashes", () => {
    const mine = new ProfileStore(db.raw).create("business", "Firma", NOW).id;
    const theirs = createProfile("theirs");
    new ProfileStore(db.raw).setPicture(theirs, HASH, "image/png", 4);
    expect(new ProfileStore(db.raw).blobHashes(mine)).toEqual([]);
  });
});

describe("flag scoping (SqliteFlagStore beside profile delete)", () => {
  it("two profiles' flag rows never cross, and a delete removes only its own", async () => {
    const keeper = createProfile("keeper");
    const doomed = createProfile("doomed", "2026-07-30T11:00:00.000Z", "business");
    await new SqliteFlagStore(db.raw, keeper).set("study", true);
    await new SqliteFlagStore(db.raw, doomed).set("study", false);

    new ProfileStore(db.raw).delete(doomed, NOW);

    expect(await new SqliteFlagStore(db.raw, keeper).get()).toEqual({ study: true });
    expect(await new SqliteFlagStore(db.raw, doomed).get()).toEqual({});
  });
});
