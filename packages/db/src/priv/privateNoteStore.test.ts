import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_PRIVATE_NOTE_VERSIONS,
  NexusDatabase,
  PrivateNoteNotFoundError,
  PrivateNoteStore,
  PrivateNoteValidationError,
  openDatabase,
} from "../index.js";

let dir: string;
let db: NexusDatabase;
let store: PrivateNoteStore;

const NOW = "2026-07-30T10:00:00.000Z";
const LATER = "2026-07-30T11:00:00.000Z";

function insertProfile(id: string): void {
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
}

function sealed(...bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-priv-notes-"));
  db = openDatabase({ path: join(dir, "test.db") });
  insertProfile("p1");
  insertProfile("p2");
  store = new PrivateNoteStore(db.raw, "p1");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("writeSealed / readSealed", () => {
  it("round-trips sealed bytes without ever interpreting them", () => {
    store.writeSealed("n1", sealed(9, 8, 7), NOW);
    expect(Array.from(store.readSealed("n1"))).toEqual([9, 8, 7]);
  });

  it("upserts: a second write replaces the bytes and bumps updated_at, keeping created_at", () => {
    store.writeSealed("n1", sealed(1), NOW);
    store.writeSealed("n1", sealed(2), LATER);
    expect(Array.from(store.readSealed("n1"))).toEqual([2]);
    const row = db.raw
      .prepare("SELECT created_at, updated_at FROM private_notes WHERE id = ?")
      .get("n1") as { created_at: string; updated_at: string };
    expect(row).toEqual({ created_at: NOW, updated_at: LATER });
  });

  it("refuses another profile's id rather than quietly overwriting its row", () => {
    new PrivateNoteStore(db.raw, "p2").writeSealed("n1", sealed(1), NOW);
    expect(() => store.writeSealed("n1", sealed(2), LATER)).toThrow(PrivateNoteValidationError);
    expect(Array.from(new PrivateNoteStore(db.raw, "p2").readSealed("n1"))).toEqual([1]);
  });

  it("refuses empty sealed bytes and a malformed now", () => {
    expect(() => store.writeSealed("n1", sealed(), NOW)).toThrow(PrivateNoteValidationError);
    expect(() => store.writeSealed("n1", sealed(1), "yesterday")).toThrow(
      PrivateNoteValidationError,
    );
  });

  it("readSealed throws for an unknown id and for another profile's id", () => {
    expect(() => store.readSealed("missing")).toThrow(PrivateNoteNotFoundError);
    new PrivateNoteStore(db.raw, "p2").writeSealed("theirs", sealed(1), NOW);
    expect(() => store.readSealed("theirs")).toThrow(PrivateNoteNotFoundError);
  });
});

describe("list", () => {
  it("answers id and timestamps only, newest-touched first — it cannot decrypt, so it never tries", () => {
    store.writeSealed("older", sealed(1), NOW);
    store.writeSealed("newer", sealed(2), LATER);
    expect(store.list()).toEqual([
      { id: "newer", createdAt: LATER, updatedAt: LATER },
      { id: "older", createdAt: NOW, updatedAt: NOW },
    ]);
  });

  it("never lists another profile's rows", () => {
    new PrivateNoteStore(db.raw, "p2").writeSealed("theirs", sealed(1), NOW);
    expect(store.list()).toEqual([]);
  });
});

describe("delete", () => {
  it("hard-deletes the row and its versions — no soft-delete column exists to hide behind", () => {
    store.writeSealed("n1", sealed(1), NOW);
    store.writeVersion("n1", 1, sealed(1), NOW);
    store.delete("n1");
    expect(store.list()).toEqual([]);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM private_note_versions").get() as { n: number }).n,
    ).toBe(0);
  });

  it("throws for an unknown id and for another profile's id", () => {
    expect(() => store.delete("missing")).toThrow(PrivateNoteNotFoundError);
    new PrivateNoteStore(db.raw, "p2").writeSealed("theirs", sealed(1), NOW);
    expect(() => store.delete("theirs")).toThrow(PrivateNoteNotFoundError);
    expect(Array.from(new PrivateNoteStore(db.raw, "p2").readSealed("theirs"))).toEqual([1]);
  });
});

describe("versions", () => {
  beforeEach(() => {
    store.writeSealed("n1", sealed(0), NOW);
  });

  it("writeVersion / listVersions / readVersion round-trip, newest first", () => {
    store.writeVersion("n1", 1, sealed(1), NOW);
    store.writeVersion("n1", 2, sealed(2), LATER);
    expect(store.listVersions("n1")).toEqual([
      { seq: 2, createdAt: LATER },
      { seq: 1, createdAt: NOW },
    ]);
    expect(Array.from(store.readVersion("n1", 1))).toEqual([1]);
    expect(Array.from(store.readVersion("n1", 2))).toEqual([2]);
  });

  it("maxVersionSeq is 0 with no versions and the highest surviving seq otherwise", () => {
    expect(store.maxVersionSeq("n1")).toBe(0);
    store.writeVersion("n1", 3, sealed(3), NOW);
    expect(store.maxVersionSeq("n1")).toBe(3);
  });

  it(`caps history at ${MAX_PRIVATE_NOTE_VERSIONS}, evicting the oldest in the same transaction as the insert`, () => {
    for (let seq = 1; seq <= MAX_PRIVATE_NOTE_VERSIONS + 5; seq++) {
      store.writeVersion("n1", seq, sealed(seq), NOW);
    }
    const seqs = store.listVersions("n1").map((version) => version.seq);
    expect(seqs).toHaveLength(MAX_PRIVATE_NOTE_VERSIONS);
    expect(Math.min(...seqs)).toBe(6);
    expect(Math.max(...seqs)).toBe(MAX_PRIVATE_NOTE_VERSIONS + 5);
    expect(() => store.readVersion("n1", 5)).toThrow(PrivateNoteNotFoundError);
  });

  it("eviction counts per note, never across notes", () => {
    store.writeSealed("n2", sealed(0), NOW);
    for (let seq = 1; seq <= MAX_PRIVATE_NOTE_VERSIONS; seq++) {
      store.writeVersion("n1", seq, sealed(1), NOW);
    }
    store.writeVersion("n2", 1, sealed(2), NOW);
    expect(store.listVersions("n1")).toHaveLength(MAX_PRIVATE_NOTE_VERSIONS);
    expect(store.listVersions("n2")).toHaveLength(1);
  });

  it("refuses a non-positive or non-integer seq and empty sealed bytes", () => {
    expect(() => store.writeVersion("n1", 0, sealed(1), NOW)).toThrow(PrivateNoteValidationError);
    expect(() => store.writeVersion("n1", 1.5, sealed(1), NOW)).toThrow(
      PrivateNoteValidationError,
    );
    expect(() => store.writeVersion("n1", 1, sealed(), NOW)).toThrow(PrivateNoteValidationError);
  });

  it("every version call is scoped through the note's own profile", () => {
    new PrivateNoteStore(db.raw, "p2").writeSealed("theirs", sealed(1), NOW);
    expect(() => store.writeVersion("theirs", 1, sealed(1), NOW)).toThrow(
      PrivateNoteNotFoundError,
    );
    expect(() => store.listVersions("theirs")).toThrow(PrivateNoteNotFoundError);
    expect(() => store.readVersion("theirs", 1)).toThrow(PrivateNoteNotFoundError);
    expect(() => store.maxVersionSeq("theirs")).toThrow(PrivateNoteNotFoundError);
  });
});
