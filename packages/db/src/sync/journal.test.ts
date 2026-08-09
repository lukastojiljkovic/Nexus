import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYNC_MAP } from "@nexus/sync";
import { NoteStore, TaskListStore, TaskStore, openDatabase, uuidv7 } from "../index.js";
import type { NexusDatabase } from "../index.js";

/**
 * Migration 063's triggers, against the real schema.
 *
 * The one property every test here is a face of: **a row of user content cannot
 * be written, changed or destroyed without the journal learning about it.** The
 * cases worth spelling out are the ones where that is nearly untrue — a row with
 * no `profile_id` of its own, and a row destroyed by a cascade whose parent is
 * already gone by the time its own trigger runs.
 */

const NOW = "2026-08-09T10:00:00.000Z";
const US = String.fromCharCode(31);

let dir: string;
let db: NexusDatabase;
let profileId: string;

interface JournalRow {
  profile_id: string;
  collection: string;
  object_id: string;
}

function journal(): JournalRow[] {
  return db.raw
    .prepare("SELECT profile_id, collection, object_id FROM sync_journal ORDER BY collection, object_id")
    .all() as JournalRow[];
}

function entries(): string[] {
  return journal().map((row) => `${row.collection}/${row.object_id}`);
}

function clearJournal(): void {
  db.raw.exec("DELETE FROM sync_journal");
}

function enableJournal(): void {
  db.raw.prepare("UPDATE meta SET value = '1' WHERE key = 'sync_journal_enabled'").run();
}

function createSubject(): string {
  const id = uuidv7();
  db.raw
    .prepare(
      "INSERT INTO subjects (id, profile_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, profileId, "Matematika", NOW, NOW);
  return id;
}

function attachToSubject(subjectId: string): string {
  const id = uuidv7();
  db.raw
    .prepare(
      `INSERT INTO subject_attachments (id, subject_id, file_name, mime, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, subjectId, "skripta.pdf", "application/pdf", 10, "a".repeat(64), NOW);
  return id;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-journal-"));
  db = openDatabase({ path: join(dir, "journal.db") });
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "P", NOW);
  // Every task needs somewhere to land, and the Inbox is created before the
  // flag is turned on so it never shows up in a journal a test is reading.
  new TaskListStore(db.raw, profileId).ensureInbox(NOW);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the flag", () => {
  it("ships off, so a device that never turns cloud on journals nothing", () => {
    const value = db.raw
      .prepare("SELECT value FROM meta WHERE key = 'sync_journal_enabled'")
      .get() as { value: string } | undefined;
    expect(value).toEqual({ value: "0" });

    const tasks = new TaskStore(db.raw, profileId);
    const task = tasks.create({ title: "Nevidljiv" }, NOW);
    tasks.update(task.id, { title: "I dalje nevidljiv" });
    db.raw.prepare("DELETE FROM tasks WHERE id = ?").run(task.id);

    expect(journal()).toEqual([]);
  });

  it("is the only thing standing between the same writes and a full journal", () => {
    enableJournal();
    const task = new TaskStore(db.raw, profileId).create({ title: "Vidljiv" }, NOW);
    expect(journal()).toEqual([
      { profile_id: profileId, collection: "tasks", object_id: task.id },
    ]);
  });
});

describe("a row that carries its own profile", () => {
  beforeEach(enableJournal);

  it("journals an insert, an update and a delete under one entry each", () => {
    const tasks = new TaskStore(db.raw, profileId);
    const task = tasks.create({ title: "Prijava" }, NOW);
    expect(entries()).toEqual([`tasks/${task.id}`]);

    // A dirty SET, not a log: five more writes leave the same one entry.
    for (const title of ["a", "b", "c", "d", "e"]) tasks.update(task.id, { title });
    expect(entries()).toEqual([`tasks/${task.id}`]);

    clearJournal();
    db.raw.prepare("DELETE FROM tasks WHERE id = ?").run(task.id);
    expect(entries()).toEqual([`tasks/${task.id}`]);
  });

  it("gives a per-profile singleton the empty object id", () => {
    db.raw.prepare("INSERT INTO calendar_settings (profile_id) VALUES (?)").run(profileId);
    expect(journal()).toEqual([
      { profile_id: profileId, collection: "calendar_settings", object_id: "" },
    ]);
  });

  it("joins a natural key with the unit separator", () => {
    db.raw
      .prepare(
        `INSERT INTO fit_measurements (profile_id, day, weight_kg, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(profileId, "2026-08-09", 74.5, NOW, NOW);
    expect(entries()).toEqual(["fit_measurements/2026-08-09"]);

    db.raw
      .prepare(
        `INSERT INTO feature_flags (profile_id, module_id, enabled, updated_at) VALUES (?, ?, 1, ?)`,
      )
      .run(profileId, "task", NOW);
    expect(entries()).toContain("feature_flags/task");
  });

  it("journals both object ids when an update moves the identity itself", () => {
    // No store does this today. The second statement in `_sync_au` is there so
    // that one which starts doing it tomorrow cannot strand a tombstone.
    db.raw
      .prepare(
        `INSERT INTO fit_measurements (profile_id, day, weight_kg, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(profileId, "2026-08-09", 74.5, NOW, NOW);
    clearJournal();

    db.raw
      .prepare("UPDATE fit_measurements SET day = ? WHERE profile_id = ? AND day = ?")
      .run("2026-08-10", profileId, "2026-08-09");

    expect(entries()).toEqual(["fit_measurements/2026-08-09", "fit_measurements/2026-08-10"]);
  });
});

describe("a row that has no profile of its own", () => {
  beforeEach(enableJournal);

  it("reaches the profile through its parent", () => {
    const subject = createSubject();
    clearJournal();
    const attachment = attachToSubject(subject);

    expect(journal()).toEqual([
      { profile_id: profileId, collection: "subject_attachments", object_id: attachment },
    ]);
  });

  it("is still journaled when its parent cascades it away", () => {
    // The case that would otherwise lose a deletion for good: by the time
    // `subject_attachments`' own AFTER DELETE trigger runs, the subject it would
    // have joined to is already gone. The subject's BEFORE DELETE is what saves
    // it — and without a tombstone here, the file would be destroyed on this
    // device and remain, forever, on every other one.
    const subject = createSubject();
    const attachment = attachToSubject(subject);
    clearJournal();

    db.raw.prepare("DELETE FROM subjects WHERE id = ?").run(subject);

    expect(entries()).toEqual([`subject_attachments/${attachment}`, `subjects/${subject}`]);
    expect(journal().every((row) => row.profile_id === profileId)).toBe(true);
  });

  it("is still journaled when the cascade that reaches it is two levels deep", () => {
    // `tasks.parent_id` cascades to subtasks, and a subtask cascades to its
    // attachments — so deleting one parent task destroys rows two joins away.
    // The subtask's OWN `_sync_bd` is what has to fire here, on a row SQLite
    // deleted as a foreign-key action rather than a statement anyone wrote.
    // Assumed, this is the deletion that silently never travels; asserted, it
    // is the one case that proves `_sync_bd` covers a chain and not just a step.
    const tasks = new TaskStore(db.raw, profileId);
    const parent = tasks.create({ title: "Roditelj" }, NOW);
    const child = tasks.create({ title: "Podzadatak", parentId: parent.id }, NOW);
    const attachment = uuidv7();
    db.raw
      .prepare(
        `INSERT INTO task_attachments (id, task_id, file_name, mime, size_bytes, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(attachment, child.id, "prilog.pdf", "application/pdf", 7, "c".repeat(64), NOW);
    clearJournal();

    db.raw.prepare("DELETE FROM tasks WHERE id = ?").run(parent.id);

    expect(entries().sort()).toEqual(
      [`task_attachments/${attachment}`, `tasks/${parent.id}`, `tasks/${child.id}`].sort(),
    );
    expect(journal().every((row) => row.profile_id === profileId)).toBe(true);
  });

  it("journals every one of a note's children when the note is purged", () => {
    const notes = new NoteStore(db.raw, profileId);
    const note = notes.create(NOW);
    notes.appendUpdate(note.id, new Uint8Array([1, 2, 3]), "Beleska", NOW);
    notes.appendUpdate(note.id, new Uint8Array([4, 5, 6]), "Beleska", NOW);
    notes.captureVersion(note.id, new Uint8Array([7]), 2, NOW);
    const attachment = uuidv7();
    db.raw
      .prepare(
        `INSERT INTO note_attachments (id, note_id, file_name, mime, size_bytes, sha256, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(attachment, note.id, "slika.png", "image/png", 4, "b".repeat(64), NOW);
    clearJournal();

    db.raw.prepare("DELETE FROM notes WHERE id = ?").run(note.id);

    expect(entries().sort()).toEqual(
      [
        `note_attachments/${attachment}`,
        `note_updates/${note.id}${US}1`,
        `note_updates/${note.id}${US}2`,
        `note_versions/${note.id}${US}2`,
        `notes/${note.id}`,
      ].sort(),
    );
  });
});

describe("a row that is a field of some other object", () => {
  beforeEach(enableJournal);

  it("marks the PARENT dirty, never itself", () => {
    const tasks = new TaskStore(db.raw, profileId);
    const task = tasks.create({ title: "Sa oznakom" }, NOW);
    const tag = uuidv7();
    db.raw
      .prepare("INSERT INTO task_tags (id, profile_id, name, created_at) VALUES (?, ?, ?, ?)")
      .run(tag, profileId, "hitno", NOW);
    clearJournal();

    db.raw.prepare("INSERT INTO task_tag_links (task_id, tag_id) VALUES (?, ?)").run(task.id, tag);

    expect(entries()).toEqual([`tasks/${task.id}`]);
  });

  it("marks the blocked task dirty when the blocker is deleted out from under it", () => {
    // `task_dependencies` hangs off the BLOCKED task, so deleting a BLOCKER
    // changes an object that still exists — and the ordinary child trigger is
    // what notices, because the object it joins to was never in the cascade.
    const tasks = new TaskStore(db.raw, profileId);
    const blocked = tasks.create({ title: "Ceka" }, NOW);
    const blocker = tasks.create({ title: "Blokira" }, NOW);
    db.raw
      .prepare("INSERT INTO task_dependencies (blocker_id, blocked_id) VALUES (?, ?)")
      .run(blocker.id, blocked.id);
    clearJournal();

    db.raw.prepare("DELETE FROM tasks WHERE id = ?").run(blocker.id);

    expect(entries().sort()).toEqual([`tasks/${blocked.id}`, `tasks/${blocker.id}`].sort());
  });
});

describe("the shape of the thing", () => {
  it("gives every collection and every parent-field its three triggers, and the derived table none", () => {
    // What turns "a new collection needs a new migration" from a thing to
    // remember into a thing that fails: the map is the current truth, the
    // triggers are what migration 063 froze, and this is where they meet.
    const live = new Set(
      (
        db.raw
          .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
          .all() as { name: string }[]
      ).map((row) => row.name),
    );

    const missing: string[] = [];
    for (const entry of SYNC_MAP) {
      const wanted =
        entry.kind === "derived"
          ? []
          : [`${entry.table}_sync_ai`, `${entry.table}_sync_au`, `${entry.table}_sync_ad`];
      for (const name of wanted) if (!live.has(name)) missing.push(name);
    }
    expect(missing).toEqual([]);

    const derived = SYNC_MAP.filter((entry) => entry.kind === "derived").flatMap((entry) => [
      `${entry.table}_sync_ai`,
      `${entry.table}_sync_au`,
      `${entry.table}_sync_ad`,
    ]);
    expect(derived.filter((name) => live.has(name))).toEqual([]);
  });

  it("empties both sync tables when the profile they belong to is deleted", () => {
    enableJournal();
    const task = new TaskStore(db.raw, profileId).create({ title: "Odlazi" }, NOW);
    db.raw
      .prepare(
        `INSERT INTO sync_row_state (profile_id, collection, object_id, state_json, updated_at)
         VALUES (?, 'tasks', ?, '{}', ?)`,
      )
      .run(profileId, task.id, NOW);

    expect(() => db.raw.prepare("DELETE FROM profiles WHERE id = ?").run(profileId)).not.toThrow();

    expect(journal()).toEqual([]);
    expect(db.raw.prepare("SELECT count(*) AS n FROM sync_row_state").get()).toEqual({ n: 0 });
  });
});
