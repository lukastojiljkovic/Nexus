import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NexusDatabase,
  NoteFolderNotFoundError,
  NoteNotFoundError,
  NoteStore,
  NoteValidationError,
  NoteVersionNotFoundError,
  MAX_NOTE_LINKS,
  MAX_NOTE_VERSIONS,
  openDatabase,
  uuidv7,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-notes-"));
  db = openDatabase({ path: join(dir, "notes.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date().toISOString());
  return id;
}

function store(): NoteStore {
  return new NoteStore(db.raw, createProfile());
}

const T0 = "2026-07-12T10:00:00.000Z";
const T1 = "2026-07-12T10:01:00.000Z";
const T2 = "2026-07-12T10:02:00.000Z";
const T3 = "2026-07-12T10:03:00.000Z";

/** A deterministic non-empty binary blob of `length` bytes. */
function bytes(length: number, offset = 0): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i + offset) % 256;
  return out;
}

describe("NoteStore", () => {
  it("creates a note with an empty title and returns its meta", () => {
    const notes = store();
    const created = notes.create(T0);

    expect(created.title).toBe("");
    expect(created.createdAt).toBe(T0);
    expect(created.updatedAt).toBe(T0);
    expect(notes.list()).toEqual([created]);
  });

  it("rejects a malformed now", () => {
    const notes = store();
    const note = notes.create(T0);
    expect(() => notes.create("not-a-date")).toThrow(NoteValidationError);
    expect(() => notes.appendUpdate(note.id, bytes(4), "", "2026-07-12")).toThrow(
      NoteValidationError,
    );
    expect(() => notes.softDelete(note.id, "nope")).toThrow(NoteValidationError);
  });

  it("lists active notes by updated_at descending with an id tiebreak", () => {
    const notes = store();
    const first = notes.create(T0);
    const second = notes.create(T1);
    const third = notes.create(T2);

    // Touching the oldest note moves it to the top.
    notes.appendUpdate(first.id, bytes(4), "Prva", T3);
    expect(notes.list().map((note) => note.id)).toEqual([first.id, third.id, second.id]);

    // Identical updated_at falls back to id descending (uuidv7 ids are time-ordered).
    const twinStore = store();
    const a = twinStore.create(T0);
    const b = twinStore.create(T0);
    const expected = [a.id, b.id].sort().reverse();
    expect(twinStore.list().map((note) => note.id)).toEqual(expected);
  });

  it("appendUpdate stores the update and bumps title and updated_at", () => {
    const notes = store();
    const note = notes.create(T0);

    notes.appendUpdate(note.id, bytes(8), "  Moja beleška  ", T1);

    const listed = notes.list();
    expect(listed[0]?.title).toBe("Moja beleška"); // trimmed
    expect(listed[0]?.updatedAt).toBe(T1);
    expect(listed[0]?.createdAt).toBe(T0);
    expect(notes.load(note.id).title).toBe("Moja beleška");
  });

  it("keeps seq monotonic per note across interleaved appends", () => {
    const notes = store();
    const a = notes.create(T0);
    const b = notes.create(T0);

    notes.appendUpdate(a.id, bytes(4, 1), "", T1);
    notes.appendUpdate(b.id, bytes(4, 2), "", T1);
    notes.appendUpdate(a.id, bytes(4, 3), "", T2);
    notes.appendUpdate(b.id, bytes(4, 4), "", T2);

    expect(notes.readForCompaction(a.id).updates.map((u) => u.seq)).toEqual([1, 2]);
    expect(notes.readForCompaction(b.id).updates.map((u) => u.seq)).toEqual([1, 2]);
  });

  it("round-trips update bytes exactly", () => {
    const notes = store();
    const note = notes.create(T0);
    const original = bytes(1024, 7);

    notes.appendUpdate(note.id, original, "", T1);

    const loaded = notes.load(note.id);
    expect(loaded.updates).toHaveLength(1);
    expect(loaded.updates[0]).toBeInstanceOf(Uint8Array);
    expect(loaded.updates[0]).toEqual(original);
  });

  it("rejects an empty update and one over 256 KB, accepting exactly 256 KB", () => {
    const notes = store();
    const note = notes.create(T0);

    expect(() => notes.appendUpdate(note.id, new Uint8Array(0), "", T1)).toThrow(
      NoteValidationError,
    );
    expect(() => notes.appendUpdate(note.id, bytes(262_145), "", T1)).toThrow(
      NoteValidationError,
    );
    expect(() => notes.appendUpdate(note.id, bytes(262_144), "", T1)).not.toThrow();
  });

  it("rejects a title longer than 200 characters after trimming, allowing an empty one", () => {
    const notes = store();
    const note = notes.create(T0);

    expect(() => notes.appendUpdate(note.id, bytes(4), "x".repeat(201), T1)).toThrow(
      NoteValidationError,
    );
    expect(() => notes.appendUpdate(note.id, bytes(4), `  ${"x".repeat(200)}  `, T1)).not.toThrow();
    expect(() => notes.appendUpdate(note.id, bytes(4), "", T2)).not.toThrow();
    expect(notes.list()[0]?.title).toBe("");
  });

  it("loads a null snapshot and every update when never compacted", () => {
    const notes = store();
    const note = notes.create(T0);
    notes.appendUpdate(note.id, bytes(4, 1), "", T1);
    notes.appendUpdate(note.id, bytes(4, 2), "", T2);

    const loaded = notes.load(note.id);
    expect(loaded.snapshot).toBeNull();
    expect(loaded.updates).toEqual([bytes(4, 1), bytes(4, 2)]);
  });

  it("loads the snapshot plus only the updates past the covered seq after compact", () => {
    const notes = store();
    const note = notes.create(T0);
    notes.appendUpdate(note.id, bytes(4, 1), "", T1);
    notes.appendUpdate(note.id, bytes(4, 2), "", T1);
    notes.compact(note.id, bytes(16, 9), "sažetak", 2, T2);
    notes.appendUpdate(note.id, bytes(4, 3), "", T3);

    const loaded = notes.load(note.id);
    expect(loaded.snapshot).toBeInstanceOf(Uint8Array);
    expect(loaded.snapshot).toEqual(bytes(16, 9));
    expect(loaded.updates).toEqual([bytes(4, 3)]);
  });

  it("counts pending updates over the same seq window as load", () => {
    const notes = store();
    const note = notes.create(T0);
    expect(notes.countPendingUpdates(note.id)).toBe(0);

    notes.appendUpdate(note.id, bytes(4, 1), "", T1);
    notes.appendUpdate(note.id, bytes(4, 2), "", T1);
    expect(notes.countPendingUpdates(note.id)).toBe(2);

    notes.compact(note.id, bytes(8), "", 2, T2);
    expect(notes.countPendingUpdates(note.id)).toBe(0);

    notes.appendUpdate(note.id, bytes(4, 3), "", T3);
    expect(notes.countPendingUpdates(note.id)).toBe(1);
  });

  it("reads the snapshot and pending updates with their seqs for compaction", () => {
    const notes = store();
    const note = notes.create(T0);
    notes.appendUpdate(note.id, bytes(4, 1), "", T1);
    notes.appendUpdate(note.id, bytes(4, 2), "", T1);

    const before = notes.readForCompaction(note.id);
    expect(before.snapshot).toBeNull();
    expect(before.updates).toEqual([
      { seq: 1, bytes: bytes(4, 1) },
      { seq: 2, bytes: bytes(4, 2) },
    ]);

    notes.compact(note.id, bytes(8, 5), "", 1, T2);
    const after = notes.readForCompaction(note.id);
    expect(after.snapshot).toEqual(bytes(8, 5));
    expect(after.updates).toEqual([{ seq: 2, bytes: bytes(4, 2) }]);
  });

  it("compacts atomically: covered updates removed, later ones retained, snapshot upserted", () => {
    const notes = store();
    const note = notes.create(T0);
    notes.appendUpdate(note.id, bytes(4, 1), "", T1);
    notes.appendUpdate(note.id, bytes(4, 2), "", T1);
    notes.appendUpdate(note.id, bytes(4, 3), "", T1);

    notes.compact(note.id, bytes(8, 1), "prvi", 2, T2);
    expect(notes.load(note.id).updates).toEqual([bytes(4, 3)]);

    // A second compact replaces the snapshot row rather than inserting a duplicate.
    notes.compact(note.id, bytes(8, 2), "drugi", 3, T3);
    const loaded = notes.load(note.id);
    expect(loaded.snapshot).toEqual(bytes(8, 2));
    expect(loaded.updates).toEqual([]);
  });

  it("rejects a compact whose coveredSeq regresses, allowing an equal re-compact", () => {
    const notes = store();
    const note = notes.create(T0);
    notes.appendUpdate(note.id, bytes(4, 1), "", T1);
    notes.appendUpdate(note.id, bytes(4, 2), "", T1);
    notes.compact(note.id, bytes(8), "", 2, T2);

    expect(() => notes.compact(note.id, bytes(8), "", 1, T3)).toThrow(NoteValidationError);
    expect(() => notes.compact(note.id, bytes(8), "", 2, T3)).not.toThrow();
  });

  it("continues the seq past the covered window after compaction empties the update log", () => {
    const notes = store();
    const note = notes.create(T0);
    notes.appendUpdate(note.id, bytes(4, 1), "", T1);
    notes.appendUpdate(note.id, bytes(4, 2), "", T1);
    notes.compact(note.id, bytes(8), "", 2, T2);

    // The next update must land past the covered seq, or load would never return it.
    notes.appendUpdate(note.id, bytes(4, 3), "", T3);
    expect(notes.readForCompaction(note.id).updates).toEqual([{ seq: 3, bytes: bytes(4, 3) }]);
    expect(notes.load(note.id).updates).toEqual([bytes(4, 3)]);
  });

  it("storedPlaintext is null before any compaction and reflects the stored value afterward", () => {
    const notes = store();
    const note = notes.create(T0);
    expect(notes.storedPlaintext(note.id)).toBeNull();

    notes.appendUpdate(note.id, bytes(4, 1), "", T1);
    notes.compact(note.id, bytes(8), "sadržaj beleške", 1, T2);
    expect(notes.storedPlaintext(note.id)).toBe("sadržaj beleške");

    // A second compact replaces the stored plaintext, same as the snapshot.
    notes.appendUpdate(note.id, bytes(4, 2), "", T2);
    notes.compact(note.id, bytes(8), "novi sadržaj", 2, T3);
    expect(notes.storedPlaintext(note.id)).toBe("novi sadržaj");
  });

  it("storedPlaintext throws NoteNotFoundError for an unknown or soft-deleted note", () => {
    const notes = store();
    const note = notes.create(T0);
    notes.softDelete(note.id, T1);

    expect(() => notes.storedPlaintext("missing")).toThrow(NoteNotFoundError);
    expect(() => notes.storedPlaintext(note.id)).toThrow(NoteNotFoundError);
  });

  it("hides soft-deleted notes from the list and blocks every child operation", () => {
    const notes = store();
    const note = notes.create(T0);
    notes.appendUpdate(note.id, bytes(4), "", T1);
    notes.softDelete(note.id, T2);

    expect(notes.list()).toHaveLength(0);
    expect(() => notes.appendUpdate(note.id, bytes(4), "", T3)).toThrow(NoteNotFoundError);
    expect(() => notes.load(note.id)).toThrow(NoteNotFoundError);
    expect(() => notes.countPendingUpdates(note.id)).toThrow(NoteNotFoundError);
    expect(() => notes.readForCompaction(note.id)).toThrow(NoteNotFoundError);
    expect(() => notes.compact(note.id, bytes(8), "", 1, T3)).toThrow(NoteNotFoundError);
  });

  it("restores a soft-deleted note with its updates intact", () => {
    const notes = store();
    const note = notes.create(T0);
    notes.appendUpdate(note.id, bytes(4, 1), "Sadržaj", T1);
    notes.softDelete(note.id, T2);
    notes.restore(note.id, T3);

    const listed = notes.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(note.id);
    expect(listed[0]?.title).toBe("Sadržaj");
    expect(notes.load(note.id).updates).toEqual([bytes(4, 1)]);
  });

  it("throws NoteNotFoundError for unknown ids and wrong-state delete/restore", () => {
    const notes = store();
    const note = notes.create(T0);

    expect(() => notes.load("missing")).toThrow(NoteNotFoundError);
    expect(() => notes.softDelete("missing", T1)).toThrow(NoteNotFoundError);
    // not currently deleted -> nothing to restore.
    expect(() => notes.restore(note.id, T1)).toThrow(NoteNotFoundError);
    // double delete -> the second finds no active row.
    notes.softDelete(note.id, T1);
    expect(() => notes.softDelete(note.id, T2)).toThrow(NoteNotFoundError);
  });

  it("isolates notes between profiles", () => {
    const a = new NoteStore(db.raw, createProfile());
    const b = new NoteStore(db.raw, createProfile());
    const owned = a.create(T0);
    a.appendUpdate(owned.id, bytes(4), "Samo A", T1);

    expect(b.list()).toHaveLength(0);
    expect(() => b.appendUpdate(owned.id, bytes(4), "upad", T2)).toThrow(NoteNotFoundError);
    expect(() => b.load(owned.id)).toThrow(NoteNotFoundError);
    expect(() => b.readForCompaction(owned.id)).toThrow(NoteNotFoundError);
    expect(() => b.compact(owned.id, bytes(8), "", 1, T2)).toThrow(NoteNotFoundError);
    expect(() => b.softDelete(owned.id, T2)).toThrow(NoteNotFoundError);
    expect(a.list()).toHaveLength(1);
    expect(a.load(owned.id).title).toBe("Samo A");
  });
});

/** Inserts a root folder for `profileId` directly (NoteStore does not own folders). */
function insertFolder(profileId: string, id: string): string {
  db.raw
    .prepare(
      `INSERT INTO note_folders (id, profile_id, parent_id, name, color, created_at, updated_at)
       VALUES (?, ?, NULL, 'F', NULL, ?, ?)`,
    )
    .run(id, profileId, T0, T0);
  return id;
}

/** Inserts a subject + deck for `profileId` directly (NoteStore does not own decks). */
function insertDeck(profileId: string, id: string, deletedAt: string | null = null): string {
  const subjectId = uuidv7();
  db.raw
    .prepare(
      `INSERT INTO subjects (id, profile_id, name, color, created_at, updated_at)
       VALUES (?, ?, 'S', 'jade', ?, ?)`,
    )
    .run(subjectId, profileId, T0, T0);
  db.raw
    .prepare(
      `INSERT INTO decks (id, profile_id, subject_id, name, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'D', ?, ?, ?)`,
    )
    .run(id, profileId, subjectId, T0, T0, deletedAt);
  return id;
}

describe("NoteStore — organization (folder_id, pinned)", () => {
  function storeWithProfile(): { notes: NoteStore; profileId: string } {
    const profileId = createProfile();
    return { notes: new NoteStore(db.raw, profileId), profileId };
  }

  it("creates a note unfiled and unpinned", () => {
    const notes = store();
    const created = notes.create(T0);
    expect(created.folderId).toBeNull();
    expect(created.pinned).toBe(false);
    expect(notes.list()[0]?.folderId).toBeNull();
    expect(notes.list()[0]?.pinned).toBe(false);
  });

  it("orders pinned notes first, then by updated_at descending", () => {
    const notes = store();
    const first = notes.create(T0);
    const second = notes.create(T1);
    const third = notes.create(T2);

    // Without pins: newest updated_at first.
    expect(notes.list().map((n) => n.id)).toEqual([third.id, second.id, first.id]);

    // Pinning the oldest floats it to the top; the rest keep updated_at order.
    notes.setPinned(first.id, true);
    expect(notes.list().map((n) => n.id)).toEqual([first.id, third.id, second.id]);
  });

  it("filters the list by folder: all, unfiled, and by-folder", () => {
    const { notes, profileId } = storeWithProfile();
    const folder = insertFolder(profileId, uuidv7());
    const a = notes.create(T0);
    const b = notes.create(T1);
    const c = notes.create(T2);
    notes.setFolder(a.id, folder);

    // no filter -> every active note.
    expect(notes.list().map((n) => n.id).sort()).toEqual([a.id, b.id, c.id].sort());
    // null -> only unfiled notes.
    expect(notes.list({ folderId: null }).map((n) => n.id)).toEqual([c.id, b.id]);
    // a folder id -> only that folder's notes.
    expect(notes.list({ folderId: folder }).map((n) => n.id)).toEqual([a.id]);
  });

  it("setFolder files a note and reports the folder id, then clears it with null", () => {
    const { notes, profileId } = storeWithProfile();
    const folder = insertFolder(profileId, uuidv7());
    const note = notes.create(T0);

    notes.setFolder(note.id, folder);
    expect(notes.list({ folderId: folder })[0]?.folderId).toBe(folder);

    notes.setFolder(note.id, null);
    expect(notes.list({ folderId: null }).map((n) => n.id)).toContain(note.id);
  });

  it("setFolder rejects a folder that is not in this profile", () => {
    const { notes } = storeWithProfile();
    const otherProfile = createProfile();
    const foreignFolder = insertFolder(otherProfile, uuidv7());
    const note = notes.create(T0);

    expect(() => notes.setFolder(note.id, "no-such-folder")).toThrow(NoteFolderNotFoundError);
    expect(() => notes.setFolder(note.id, foreignFolder)).toThrow(NoteFolderNotFoundError);
  });

  it("setFolder rejects a note that is not active in this profile", () => {
    const a = storeWithProfile();
    const b = storeWithProfile();
    const folderB = insertFolder(b.profileId, uuidv7());
    const owned = a.notes.create(T0);

    expect(() => b.notes.setFolder(owned.id, folderB)).toThrow(NoteNotFoundError);
    expect(() => a.notes.setFolder("missing", null)).toThrow(NoteNotFoundError);
  });

  it("setPinned toggles the flag and surfaces it in the list", () => {
    const notes = store();
    const note = notes.create(T0);

    notes.setPinned(note.id, true);
    expect(notes.list()[0]?.pinned).toBe(true);
    notes.setPinned(note.id, false);
    expect(notes.list()[0]?.pinned).toBe(false);

    expect(() => notes.setPinned("missing", true)).toThrow(NoteNotFoundError);
  });

  it("does not bump updated_at when foldering or pinning", () => {
    const { notes, profileId } = storeWithProfile();
    const folder = insertFolder(profileId, uuidv7());
    const note = notes.create(T0);

    notes.setFolder(note.id, folder);
    notes.setPinned(note.id, true);

    // Organizational changes never touch the content timestamp.
    expect(notes.list()[0]?.updatedAt).toBe(T0);
  });
});

describe("NoteStore — wiki-links (note_links)", () => {
  it("replaces the full outbound set on each call", () => {
    const notes = store();
    const source = notes.create(T0);
    const a = notes.create(T0);
    const b = notes.create(T0);
    const c = notes.create(T0);

    notes.setOutboundLinks(source.id, [a.id, b.id]);
    expect(notes.listBacklinks(a.id).map((n) => n.id)).toEqual([source.id]);
    expect(notes.listBacklinks(b.id).map((n) => n.id)).toEqual([source.id]);

    notes.setOutboundLinks(source.id, [c.id]);
    expect(notes.listBacklinks(a.id)).toEqual([]);
    expect(notes.listBacklinks(b.id)).toEqual([]);
    expect(notes.listBacklinks(c.id).map((n) => n.id)).toEqual([source.id]);
  });

  it("dedupes repeated target ids", () => {
    const notes = store();
    const source = notes.create(T0);
    const target = notes.create(T0);

    notes.setOutboundLinks(source.id, [target.id, target.id, target.id]);
    expect(notes.listBacklinks(target.id)).toHaveLength(1);
  });

  it("silently drops a self-link", () => {
    const notes = store();
    const source = notes.create(T0);
    const target = notes.create(T0);

    notes.setOutboundLinks(source.id, [source.id, target.id]);
    expect(notes.listBacklinks(source.id)).toEqual([]);
    expect(notes.listBacklinks(target.id).map((n) => n.id)).toEqual([source.id]);
  });

  it("silently drops an unknown target id", () => {
    const notes = store();
    const source = notes.create(T0);

    expect(() => notes.setOutboundLinks(source.id, ["missing"])).not.toThrow();
    expect(notes.listBacklinks(source.id)).toEqual([]);
  });

  it("silently drops a target owned by another profile", () => {
    const a = new NoteStore(db.raw, createProfile());
    const b = new NoteStore(db.raw, createProfile());
    const source = a.create(T0);
    const foreignTarget = b.create(T0);

    expect(() => a.setOutboundLinks(source.id, [foreignTarget.id])).not.toThrow();
    expect(a.listBacklinks(source.id)).toEqual([]);
    expect(b.listBacklinks(foreignTarget.id)).toEqual([]);
  });

  it("keeps a link to a soft-deleted target, reappearing in backlinks after restore", () => {
    const notes = store();
    const source = notes.create(T0);
    const target = notes.create(T0);
    notes.setOutboundLinks(source.id, [target.id]);

    notes.softDelete(target.id, T1);
    notes.restore(target.id, T2);
    // The link row survived the target's soft-delete/restore round trip.
    expect(notes.listBacklinks(target.id).map((n) => n.id)).toEqual([source.id]);
  });

  it("excludes soft-deleted sources from backlinks, reappearing after restore", () => {
    const notes = store();
    const source = notes.create(T0);
    const target = notes.create(T0);
    notes.setOutboundLinks(source.id, [target.id]);

    notes.softDelete(source.id, T1);
    expect(notes.listBacklinks(target.id)).toEqual([]);

    notes.restore(source.id, T2);
    expect(notes.listBacklinks(target.id).map((n) => n.id)).toEqual([source.id]);
  });

  it("cascades link rows when the source note is hard-deleted, verified via the target's backlinks", () => {
    const notes = store();
    const source = notes.create(T0);
    const target = notes.create(T0);
    notes.setOutboundLinks(source.id, [target.id]);
    expect(notes.listBacklinks(target.id)).toHaveLength(1);

    db.raw.prepare("DELETE FROM notes WHERE id = ?").run(source.id);
    expect(notes.listBacklinks(target.id)).toEqual([]);
  });

  it("cascades link rows when the target note is hard-deleted", () => {
    const notes = store();
    const source = notes.create(T0);
    const target = notes.create(T0);
    notes.setOutboundLinks(source.id, [target.id]);

    db.raw.prepare("DELETE FROM notes WHERE id = ?").run(target.id);
    expect(
      (
        db.raw
          .prepare("SELECT count(*) AS n FROM note_links WHERE source_note_id = ?")
          .get(source.id) as { n: number }
      ).n,
    ).toBe(0);
  });

  it("rejects more than 500 target ids, accepting exactly 500", () => {
    const notes = store();
    const source = notes.create(T0);
    const tooMany = Array.from({ length: MAX_NOTE_LINKS + 1 }, () => uuidv7());
    const exactlyMax = Array.from({ length: MAX_NOTE_LINKS }, () => uuidv7());

    expect(() => notes.setOutboundLinks(source.id, tooMany)).toThrow(NoteValidationError);
    expect(() => notes.setOutboundLinks(source.id, exactlyMax)).not.toThrow();
  });

  it("throws NoteNotFoundError from an unknown, soft-deleted, or cross-profile source", () => {
    const a = new NoteStore(db.raw, createProfile());
    const b = new NoteStore(db.raw, createProfile());
    const ownedByB = b.create(T0);
    const target = a.create(T0);
    const deletable = a.create(T0);
    a.softDelete(deletable.id, T1);

    expect(() => a.setOutboundLinks("missing", [target.id])).toThrow(NoteNotFoundError);
    expect(() => a.setOutboundLinks(ownedByB.id, [target.id])).toThrow(NoteNotFoundError);
    expect(() => a.setOutboundLinks(deletable.id, [target.id])).toThrow(NoteNotFoundError);
    expect(() => a.listBacklinks("missing")).toThrow(NoteNotFoundError);
    expect(() => a.listBacklinks(ownedByB.id)).toThrow(NoteNotFoundError);
    expect(() => a.listBacklinks(deletable.id)).toThrow(NoteNotFoundError);
  });

  it("does not bump updated_at", () => {
    const notes = store();
    const source = notes.create(T0);
    const target = notes.create(T0);

    notes.setOutboundLinks(source.id, [target.id]);
    expect(notes.list().find((n) => n.id === source.id)?.updatedAt).toBe(T0);
  });

  it("clears all outbound links with an empty array", () => {
    const notes = store();
    const source = notes.create(T0);
    const target = notes.create(T0);
    notes.setOutboundLinks(source.id, [target.id]);
    expect(notes.listBacklinks(target.id)).toHaveLength(1);

    notes.setOutboundLinks(source.id, []);
    expect(notes.listBacklinks(target.id)).toEqual([]);
  });

  it("orders backlinks by pinned desc, then updated_at desc, id desc — the house list order", () => {
    const notes = store();
    const target = notes.create(T0);
    const s1 = notes.create(T0);
    const s2 = notes.create(T1);
    const s3 = notes.create(T2);
    notes.setOutboundLinks(s1.id, [target.id]);
    notes.setOutboundLinks(s2.id, [target.id]);
    notes.setOutboundLinks(s3.id, [target.id]);

    expect(notes.listBacklinks(target.id).map((n) => n.id)).toEqual([s3.id, s2.id, s1.id]);

    notes.setPinned(s1.id, true);
    expect(notes.listBacklinks(target.id).map((n) => n.id)).toEqual([s1.id, s3.id, s2.id]);
  });
});

describe("NoteStore — card deck mapping (card_deck_id)", () => {
  function storeWithProfile(): { notes: NoteStore; profileId: string } {
    const profileId = createProfile();
    return { notes: new NoteStore(db.raw, profileId), profileId };
  }

  it("creates a note with no card deck mapped", () => {
    const notes = store();
    const created = notes.create(T0);
    expect(created.cardDeckId).toBeNull();
    expect(notes.list()[0]?.cardDeckId).toBeNull();
  });

  it("sets the mapping and round-trips it through list/meta", () => {
    const { notes, profileId } = storeWithProfile();
    const deckId = insertDeck(profileId, uuidv7());
    const note = notes.create(T0);

    notes.setCardDeck(note.id, deckId, T1);

    expect(notes.list()[0]?.cardDeckId).toBe(deckId);
  });

  it("clears the mapping with null", () => {
    const { notes, profileId } = storeWithProfile();
    const deckId = insertDeck(profileId, uuidv7());
    const note = notes.create(T0);
    notes.setCardDeck(note.id, deckId, T1);

    notes.setCardDeck(note.id, null, T2);
    expect(notes.list()[0]?.cardDeckId).toBeNull();
  });

  it("bumps updated_at like every other note write", () => {
    const { notes, profileId } = storeWithProfile();
    const deckId = insertDeck(profileId, uuidv7());
    const note = notes.create(T0);

    notes.setCardDeck(note.id, deckId, T1);
    expect(notes.list()[0]?.updatedAt).toBe(T1);
  });

  it("rejects an unknown or soft-deleted note", () => {
    const { notes, profileId } = storeWithProfile();
    const deckId = insertDeck(profileId, uuidv7());
    const note = notes.create(T0);
    notes.softDelete(note.id, T1);

    expect(() => notes.setCardDeck("missing", deckId, T2)).toThrow(NoteNotFoundError);
    expect(() => notes.setCardDeck(note.id, deckId, T2)).toThrow(NoteNotFoundError);
  });

  it("rejects a deck owned by another profile", () => {
    const { notes } = storeWithProfile();
    const otherProfile = createProfile();
    const foreignDeck = insertDeck(otherProfile, uuidv7());
    const note = notes.create(T0);

    expect(() => notes.setCardDeck(note.id, foreignDeck, T1)).toThrow(NoteValidationError);
  });

  it("rejects an unknown deck id", () => {
    const notes = store();
    const note = notes.create(T0);
    expect(() => notes.setCardDeck(note.id, "missing", T1)).toThrow(NoteValidationError);
  });

  it("rejects a soft-deleted deck", () => {
    const { notes, profileId } = storeWithProfile();
    const deckId = insertDeck(profileId, uuidv7(), T0); // deleted_at = T0
    const note = notes.create(T0);

    expect(() => notes.setCardDeck(note.id, deckId, T1)).toThrow(NoteValidationError);
  });

  it("rejects a malformed now", () => {
    const { notes, profileId } = storeWithProfile();
    const deckId = insertDeck(profileId, uuidv7());
    const note = notes.create(T0);
    expect(() => notes.setCardDeck(note.id, deckId, "not-a-date")).toThrow(NoteValidationError);
  });
});

describe("NoteStore — version history (note_versions, ADR-015)", () => {
  it("captureVersion inserts a checkpoint stamped with the note's current title", () => {
    const notes = store();
    const note = notes.create(T0);
    notes.appendUpdate(note.id, bytes(4), "Naslov", T1);

    notes.captureVersion(note.id, bytes(16, 1), 1, T2);

    expect(notes.listVersions(note.id)).toEqual([{ coveredSeq: 1, title: "Naslov", createdAt: T2 }]);
    expect(notes.loadVersion(note.id, 1)).toEqual(bytes(16, 1));
  });

  it("listVersions returns metadata only, newest coveredSeq first", () => {
    const notes = store();
    const note = notes.create(T0);
    notes.captureVersion(note.id, bytes(8, 1), 1, T1);
    notes.captureVersion(note.id, bytes(8, 2), 2, T2);
    notes.captureVersion(note.id, bytes(8, 3), 3, T3);

    expect(notes.listVersions(note.id)).toEqual([
      { coveredSeq: 3, title: "", createdAt: T3 },
      { coveredSeq: 2, title: "", createdAt: T2 },
      { coveredSeq: 1, title: "", createdAt: T1 },
    ]);
  });

  it("dedupes a repeated coveredSeq via INSERT OR IGNORE, keeping the first row", () => {
    const notes = store();
    const note = notes.create(T0);
    notes.appendUpdate(note.id, bytes(4), "Prvi naslov", T1);
    notes.captureVersion(note.id, bytes(16, 1), 1, T2);

    // A later capture at the same coveredSeq (different title/snapshot/time) collapses into the first row.
    notes.appendUpdate(note.id, bytes(4, 2), "Drugi naslov", T3);
    notes.captureVersion(note.id, bytes(16, 9), 1, T3);

    const versions = notes.listVersions(note.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toEqual({ coveredSeq: 1, title: "Prvi naslov", createdAt: T2 });
    expect(notes.loadVersion(note.id, 1)).toEqual(bytes(16, 1));
  });

  it("prunes to MAX_NOTE_VERSIONS in the same transaction, keeping the highest coveredSeqs", () => {
    const notes = store();
    const note = notes.create(T0);

    for (let seq = 1; seq <= MAX_NOTE_VERSIONS + 5; seq += 1) {
      notes.captureVersion(note.id, bytes(8, seq), seq, T1);
    }

    const versions = notes.listVersions(note.id);
    expect(versions).toHaveLength(MAX_NOTE_VERSIONS);
    expect(versions.map((v) => v.coveredSeq)).toEqual(
      Array.from({ length: MAX_NOTE_VERSIONS }, (_, i) => MAX_NOTE_VERSIONS + 5 - i),
    );
    // The lowest 5 (seq 1..5) fell off the retention window.
    expect(versions.some((v) => v.coveredSeq <= 5)).toBe(false);
  });

  it("rejects a non-positive or non-integer coveredSeq, an empty snapshot, and a malformed now", () => {
    const notes = store();
    const note = notes.create(T0);

    expect(() => notes.captureVersion(note.id, bytes(8), 0, T1)).toThrow(NoteValidationError);
    expect(() => notes.captureVersion(note.id, bytes(8), -1, T1)).toThrow(NoteValidationError);
    expect(() => notes.captureVersion(note.id, bytes(8), 1.5, T1)).toThrow(NoteValidationError);
    expect(() => notes.captureVersion(note.id, new Uint8Array(0), 1, T1)).toThrow(NoteValidationError);
    expect(() => notes.captureVersion(note.id, bytes(8), 1, "not-a-date")).toThrow(NoteValidationError);
    expect(() => notes.captureVersion(note.id, bytes(8), 1, T1)).not.toThrow();
  });

  it("accepts a snapshot far larger than the 256 KB update cap (no upper bound)", () => {
    const notes = store();
    const note = notes.create(T0);
    const large = bytes(500_000, 3);

    expect(() => notes.captureVersion(note.id, large, 1, T1)).not.toThrow();
    expect(notes.loadVersion(note.id, 1)).toEqual(large);
  });

  it("round-trips loadVersion's snapshot bytes exactly", () => {
    const notes = store();
    const note = notes.create(T0);
    const snapshot = bytes(2048, 3);
    notes.captureVersion(note.id, snapshot, 1, T1);

    const loaded = notes.loadVersion(note.id, 1);
    expect(loaded).toBeInstanceOf(Uint8Array);
    expect(loaded).toEqual(snapshot);
  });

  it("loadVersion throws NoteVersionNotFoundError for an uncaptured coveredSeq", () => {
    const notes = store();
    const note = notes.create(T0);
    notes.captureVersion(note.id, bytes(8), 1, T1);

    expect(() => notes.loadVersion(note.id, 2)).toThrow(NoteVersionNotFoundError);
  });

  it("latestVersion is null on a fresh note and the newest row afterward", () => {
    const notes = store();
    const note = notes.create(T0);
    expect(notes.latestVersion(note.id)).toBeNull();

    notes.captureVersion(note.id, bytes(8, 1), 1, T1);
    notes.captureVersion(note.id, bytes(8, 2), 2, T2);

    expect(notes.latestVersion(note.id)).toEqual({ coveredSeq: 2, title: "", createdAt: T2 });
  });

  it("rejects every version operation on a soft-deleted note", () => {
    const notes = store();
    const note = notes.create(T0);
    notes.captureVersion(note.id, bytes(8), 1, T1);
    notes.softDelete(note.id, T2);

    expect(() => notes.captureVersion(note.id, bytes(8), 2, T3)).toThrow(NoteNotFoundError);
    expect(() => notes.listVersions(note.id)).toThrow(NoteNotFoundError);
    expect(() => notes.loadVersion(note.id, 1)).toThrow(NoteNotFoundError);
    expect(() => notes.latestVersion(note.id)).toThrow(NoteNotFoundError);
  });

  it("isolates versions between profiles", () => {
    const a = new NoteStore(db.raw, createProfile());
    const b = new NoteStore(db.raw, createProfile());
    const note = a.create(T0);
    a.captureVersion(note.id, bytes(8), 1, T1);

    expect(() => b.captureVersion(note.id, bytes(8), 1, T1)).toThrow(NoteNotFoundError);
    expect(() => b.listVersions(note.id)).toThrow(NoteNotFoundError);
    expect(() => b.loadVersion(note.id, 1)).toThrow(NoteNotFoundError);
    expect(() => b.latestVersion(note.id)).toThrow(NoteNotFoundError);
    expect(a.listVersions(note.id)).toHaveLength(1);
  });

  it("readForCompaction reports coveredSeq 0 before compaction and the stored covered_seq after", () => {
    const notes = store();
    const note = notes.create(T0);
    notes.appendUpdate(note.id, bytes(4, 1), "", T1);
    expect(notes.readForCompaction(note.id).coveredSeq).toBe(0);

    notes.compact(note.id, bytes(8), "", 1, T2);
    expect(notes.readForCompaction(note.id).coveredSeq).toBe(1);
  });
});
