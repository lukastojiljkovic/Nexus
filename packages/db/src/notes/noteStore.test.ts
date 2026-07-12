import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NexusDatabase,
  NoteNotFoundError,
  NoteStore,
  NoteValidationError,
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
