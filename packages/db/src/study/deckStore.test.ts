import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeckNotFoundError,
  DeckStore,
  DeckValidationError,
  NexusDatabase,
  openDatabase,
  SubjectStore,
  uuidv7,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-decks-"));
  db = openDatabase({ path: join(dir, "decks.db") });
});

afterEach(() => {
  vi.useRealTimers();
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

/** A profile with one subject, plus the deck store scoped to it. */
function fixture(): { decks: DeckStore; subjects: SubjectStore; subjectId: string } {
  const profileId = createProfile();
  const subjects = new SubjectStore(db.raw, profileId);
  const subjectId = subjects.create({ name: "Analiza 1" }).id;
  return { decks: new DeckStore(db.raw, profileId), subjects, subjectId };
}

describe("DeckStore", () => {
  it("creates a deck against a subject in this profile", () => {
    const { decks, subjectId } = fixture();
    const created = decks.create({ subjectId, name: "Glava 1" });

    expect(created.subjectId).toBe(subjectId);
    expect(created.name).toBe("Glava 1");
    expect(decks.listActive()[0]).toEqual(created);
  });

  it("trims the name on create", () => {
    const { decks, subjectId } = fixture();
    const created = decks.create({ subjectId, name: "  Glava 1  " });
    expect(created.name).toBe("Glava 1");
  });

  it("rejects an empty or whitespace-only name", () => {
    const { decks, subjectId } = fixture();
    expect(() => decks.create({ subjectId, name: "" })).toThrow(DeckValidationError);
    expect(() => decks.create({ subjectId, name: "   " })).toThrow(DeckValidationError);
  });

  it("rejects a name longer than 200 characters", () => {
    const { decks, subjectId } = fixture();
    expect(() => decks.create({ subjectId, name: "x".repeat(201) })).toThrow(
      DeckValidationError,
    );
    expect(() => decks.create({ subjectId, name: "x".repeat(200) })).not.toThrow();
  });

  it("rejects a deck referencing a subject from another profile", () => {
    const { decks } = fixture();
    const foreign = new SubjectStore(db.raw, createProfile());
    const foreignSubjectId = foreign.create({ name: "Elsewhere" }).id;

    expect(() => decks.create({ subjectId: foreignSubjectId, name: "x" })).toThrow(
      DeckValidationError,
    );
  });

  it("rejects a deck referencing a soft-deleted subject", () => {
    const { decks, subjects, subjectId } = fixture();
    subjects.softDelete(subjectId);
    expect(() => decks.create({ subjectId, name: "x" })).toThrow(DeckValidationError);
  });

  it("rejects an update that moves a deck to a subject in another profile", () => {
    const { decks, subjectId } = fixture();
    const created = decks.create({ subjectId, name: "x" });
    const foreign = new SubjectStore(db.raw, createProfile());
    const foreignSubjectId = foreign.create({ name: "Elsewhere" }).id;

    expect(() => decks.update(created.id, { subjectId: foreignSubjectId })).toThrow(
      DeckValidationError,
    );
  });

  it("updates a deck's own fields", () => {
    const { decks, subjectId } = fixture();
    const created = decks.create({ subjectId, name: "x" });

    const updated = decks.update(created.id, { name: "y" });
    expect(updated.name).toBe("y");
    expect(updated.subjectId).toBe(subjectId); // untouched
  });

  it("lists active decks ordered by name then id", () => {
    vi.useFakeTimers();
    const { decks, subjectId } = fixture();
    vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
    const b = decks.create({ subjectId, name: "B" });
    vi.setSystemTime(new Date("2026-07-06T10:00:01.000Z"));
    const a1 = decks.create({ subjectId, name: "A" });
    vi.setSystemTime(new Date("2026-07-06T10:00:02.000Z"));
    const a2 = decks.create({ subjectId, name: "A" });

    // a1/a2 share a name, so the id tiebreak (creation order) settles them.
    expect(decks.listActive().map((d) => d.id)).toEqual([a1.id, a2.id, b.id]);
  });

  it("excludes soft-deleted decks from the active list and restores them", () => {
    const { decks, subjectId } = fixture();
    const created = decks.create({ subjectId, name: "x" });

    decks.softDelete(created.id);
    expect(decks.listActive()).toHaveLength(0);

    decks.restore(created.id);
    const listed = decks.listActive();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
  });

  it("throws DeckNotFoundError for operations on an unknown or wrong-state deck", () => {
    const { decks, subjectId } = fixture();
    const created = decks.create({ subjectId, name: "x" });

    expect(() => decks.update("missing", { name: "y" })).toThrow(DeckNotFoundError);
    expect(() => decks.softDelete("missing")).toThrow(DeckNotFoundError);
    // not currently deleted -> nothing to restore.
    expect(() => decks.restore(created.id)).toThrow(DeckNotFoundError);
    // double delete -> the second finds no active row.
    decks.softDelete(created.id);
    expect(() => decks.softDelete(created.id)).toThrow(DeckNotFoundError);
  });

  it("isolates decks between profiles", () => {
    const a = fixture();
    const b = fixture();
    const owned = a.decks.create({ subjectId: a.subjectId, name: "x" });

    expect(b.decks.listActive()).toHaveLength(0);
    expect(() => b.decks.update(owned.id, { name: "y" })).toThrow(DeckNotFoundError);
    expect(() => b.decks.softDelete(owned.id)).toThrow(DeckNotFoundError);
    expect(a.decks.listActive()).toHaveLength(1);
  });
});
