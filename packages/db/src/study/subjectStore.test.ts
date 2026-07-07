import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NexusDatabase,
  openDatabase,
  SubjectNotFoundError,
  SubjectStore,
  SubjectValidationError,
  uuidv7,
  type SubjectColor,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-subjects-"));
  db = openDatabase({ path: join(dir, "subjects.db") });
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

function store(): SubjectStore {
  return new SubjectStore(db.raw, createProfile());
}

describe("SubjectStore", () => {
  it("creates a subject with defaults when only a name is given", () => {
    const subjects = store();
    const created = subjects.create({ name: "  Analiza 1  " });

    expect(created.name).toBe("Analiza 1"); // trimmed
    expect(created.color).toBe("jade"); // default colour
    expect(created.semester).toBeNull();
    expect(created.archived).toBe(false);
    expect(subjects.listActive()[0]).toEqual(created);
  });

  it("creates a subject with all fields supplied", () => {
    const subjects = store();
    const created = subjects.create({
      name: "Baze podataka",
      color: "burgundy",
      semester: "2026 letnji",
    });

    expect(created.color).toBe("burgundy");
    expect(created.semester).toBe("2026 letnji");
    expect(created.archived).toBe(false);
  });

  it("rejects an empty or whitespace-only name", () => {
    const subjects = store();
    expect(() => subjects.create({ name: "" })).toThrow(SubjectValidationError);
    expect(() => subjects.create({ name: "   " })).toThrow(SubjectValidationError);
  });

  it("rejects a colour outside the closed set", () => {
    const subjects = store();
    expect(() =>
      subjects.create({ name: "x", color: "teal" as unknown as SubjectColor }),
    ).toThrow(SubjectValidationError);
  });

  it("archives a subject via update while keeping it in the active list", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
    const subjects = store();
    const created = subjects.create({ name: "Mreže" });

    vi.setSystemTime(new Date("2026-07-06T10:05:00.000Z"));
    const archived = subjects.update(created.id, { archived: true });
    expect(archived.archived).toBe(true);
    expect(archived.updatedAt).not.toBe(created.updatedAt);

    const listed = subjects.listActive();
    expect(listed).toHaveLength(1); // archived is not deleted
    expect(listed[0]?.archived).toBe(true);
  });

  it("clears the semester with an explicit null on update", () => {
    const subjects = store();
    const created = subjects.create({ name: "OS", semester: "2026 letnji" });

    const updated = subjects.update(created.id, { semester: null });
    expect(updated.semester).toBeNull();
  });

  it("lists active subjects ordered by name then id", () => {
    vi.useFakeTimers();
    const subjects = store();
    vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
    const zebra = subjects.create({ name: "Zebra" });
    vi.setSystemTime(new Date("2026-07-06T10:00:01.000Z"));
    const alphaA = subjects.create({ name: "Alpha" });
    vi.setSystemTime(new Date("2026-07-06T10:00:02.000Z"));
    const alphaB = subjects.create({ name: "Alpha" });

    // alphaA/alphaB share a name, so the id tiebreak (creation order) settles them.
    expect(subjects.listActive().map((s) => s.id)).toEqual([alphaA.id, alphaB.id, zebra.id]);
  });

  it("excludes soft-deleted subjects from the active list and restores them", () => {
    const subjects = store();
    const created = subjects.create({ name: "x" });

    subjects.softDelete(created.id);
    expect(subjects.listActive()).toHaveLength(0);

    subjects.restore(created.id);
    const listed = subjects.listActive();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
  });

  it("throws SubjectNotFoundError for operations on an unknown or wrong-state subject", () => {
    const subjects = store();
    const created = subjects.create({ name: "x" });

    expect(() => subjects.update("missing", { name: "y" })).toThrow(SubjectNotFoundError);
    expect(() => subjects.softDelete("missing")).toThrow(SubjectNotFoundError);
    // not currently deleted -> nothing to restore.
    expect(() => subjects.restore(created.id)).toThrow(SubjectNotFoundError);
    // double delete -> the second finds no active row.
    subjects.softDelete(created.id);
    expect(() => subjects.softDelete(created.id)).toThrow(SubjectNotFoundError);
  });

  it("isolates subjects between profiles", () => {
    const a = new SubjectStore(db.raw, createProfile());
    const b = new SubjectStore(db.raw, createProfile());
    const owned = a.create({ name: "A only" });

    expect(b.listActive()).toHaveLength(0);
    expect(() => b.update(owned.id, { name: "hijack" })).toThrow(SubjectNotFoundError);
    expect(() => b.softDelete(owned.id)).toThrow(SubjectNotFoundError);
    expect(a.listActive()).toHaveLength(1);
  });
});
