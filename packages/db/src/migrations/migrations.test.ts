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
  it("creates the tasks table and stamps user_version 2 on a fresh database", () => {
    const db = openDatabase({ path: join(dir, "fresh.db") });
    expect(tableNames(db)).toContain("tasks");
    expect(db.raw.pragma("user_version", { simple: true })).toBe(2);
    db.close();
  });

  it("is a no-op when reopening an already-migrated database", () => {
    const path = join(dir, "again.db");
    const first = openDatabase({ path });
    insertProfile(first, "p1");
    first.close();

    const second = openDatabase({ path });
    expect(second.raw.pragma("user_version", { simple: true })).toBe(2);
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
