import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NexusDatabase, openDatabase } from "../index.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-migrate-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function tableNames(db: NexusDatabase): string[] {
  return (
    db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function insertProfile(db: NexusDatabase, id: string): void {
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date().toISOString());
}

describe("migration 002 — tasks", () => {
  it("creates the tasks table and stamps the latest user_version on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("tasks");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(4);
    db.close();
  });

  it("is a no-op when reopening an already-migrated database", () => {
    const path = join(dir, "again.db");
    const first = openDatabase({ path });
    insertProfile(first, "p1");
    first.close();

    const second = openDatabase({ path });
    expect(second.raw.pragma("user_version", { simple: true })).toBe(4);
    expect(tableNames(second)).toContain("tasks");
    expect(
      (second.raw.prepare("SELECT count(*) AS n FROM profiles").get() as { n: number }).n,
    ).toBe(1);
    second.close();
  });

  it("enforces the status/completed_at completion invariant with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check.db") });
    insertProfile(db, "p1");
    const now = new Date().toISOString();
    const insert = db.raw.prepare(
      `INSERT INTO tasks (id, profile_id, title, status, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    // status 'done' but no completion timestamp -> violates the invariant.
    expect(() => insert.run("t1", "p1", "x", "done", now, now, null)).toThrow();
    // a completion timestamp on a non-done task is equally rejected.
    expect(() => insert.run("t2", "p1", "x", "todo", now, now, now)).toThrow();
    // the consistent combinations are accepted.
    expect(() => insert.run("t3", "p1", "x", "todo", now, now, null)).not.toThrow();
    expect(() => insert.run("t4", "p1", "x", "done", now, now, now)).not.toThrow();
    db.close();
  });

  it("cascades task deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade.db") });
    insertProfile(db, "p1");
    const now = new Date().toISOString();
    db.raw
      .prepare(
        `INSERT INTO tasks (id, profile_id, title, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("t1", "p1", "x", "todo", now, now);

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM tasks").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 003 — events", () => {
  it("creates the events table and stamps user_version 4 on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("events");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(4);
    db.close();
  });

  it("enforces the all_day flag with a 0/1 CHECK", () => {
    const db = openDatabase({ path: join(dir, "check.db") });
    insertProfile(db, "p1");
    const now = new Date().toISOString();
    const insert = db.raw.prepare(
      `INSERT INTO events (id, profile_id, title, start_at, all_day, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    // all_day outside {0, 1} -> rejected by the CHECK.
    expect(() => insert.run("e1", "p1", "x", now, 2, now, now)).toThrow();
    // the two boolean encodings are accepted.
    expect(() => insert.run("e2", "p1", "x", now, 0, now, now)).not.toThrow();
    expect(() => insert.run("e3", "p1", "x", now, 1, now, now)).not.toThrow();
    db.close();
  });

  it("creates the events_profile_active partial index", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("events_profile_active");
    db.close();
  });

  it("cascades event deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade.db") });
    insertProfile(db, "p1");
    const now = new Date().toISOString();
    db.raw
      .prepare(
        `INSERT INTO events (id, profile_id, title, start_at, all_day, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("e1", "p1", "x", now, 0, now, now);

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});

describe("migration 004 — documents", () => {
  const insertDocument = (db: NexusDatabase, id: string, profileId: string, docType: string) =>
    db.raw
      .prepare(
        `INSERT INTO tracked_documents
           (id, profile_id, doc_type, label, expiry_date, reminder_offsets, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, profileId, docType, "x", "2027-01-01", "[90]", now(), now());

  const now = () => new Date().toISOString();

  it("creates both document tables and stamps user_version 4 on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    const names = tableNames(db);
    expect(names).toContain("tracked_documents");
    expect(names).toContain("document_renewals");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(4);
    db.close();
  });

  it("rejects a doc_type outside the closed set with a CHECK", () => {
    const db = openDatabase({ path: join(dir, "check.db") });
    insertProfile(db, "p1");
    // an unlisted type -> rejected by the CHECK.
    expect(() => insertDocument(db, "d1", "p1", "bogus")).toThrow();
    // an enumerated type is accepted.
    expect(() => insertDocument(db, "d2", "p1", "pasos")).not.toThrow();
    db.close();
  });

  it("creates the documents partial index and the renewals index", () => {
    const db = openDatabase({ path: join(dir, "index.db") });
    const indexes = (
      db.raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toContain("documents_profile_active");
    expect(indexes).toContain("document_renewals_document");
    db.close();
  });

  it("cascades document deletion when the owning profile is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade.db") });
    insertProfile(db, "p1");
    insertDocument(db, "d1", "p1", "pasos");

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run("p1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM tracked_documents").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });

  it("cascades renewal deletion when the owning document is removed", () => {
    const db = openDatabase({ path: join(dir, "cascade-renewals.db") });
    insertProfile(db, "p1");
    insertDocument(db, "d1", "p1", "pasos");
    db.raw
      .prepare(
        `INSERT INTO document_renewals (id, document_id, previous_expiry, renewed_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run("r1", "d1", "2025-01-01", now());

    db.raw.prepare("DELETE FROM tracked_documents WHERE id = ?").run("d1");
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM document_renewals").get() as { n: number }).n,
    ).toBe(0);
    db.close();
  });
});
