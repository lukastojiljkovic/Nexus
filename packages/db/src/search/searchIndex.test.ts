import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { foldSearchText } from "@nexus/core";
import {
  CardStore,
  DeckStore,
  DocumentStore,
  EventStore,
  ExamStore,
  MIGRATIONS,
  NexusDatabase,
  NoteAttachmentStore,
  NoteStore,
  SubjectStore,
  TaskStore,
  openDatabase,
  runMigrations,
  uuidv7,
} from "../index.js";

/**
 * Drives migration 017's search index entirely THROUGH the real stores —
 * never by writing to `search_entries` directly — because the property under
 * test is that an ordinary store call (create/update/soft-delete/restore/hard
 * delete) keeps the index in step, with zero calls from any store into a
 * search module. Reads go straight through raw SQL, mirroring how
 * `migrations.test.ts` asserts schema behaviour.
 */

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-search-"));
  db = openDatabase({ path: join(dir, "search.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(name = "P"): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, new Date().toISOString());
  return id;
}

interface SearchEntryRow {
  id: number;
  profile_id: string;
  kind: string;
  entity_id: string;
  parent_id: string | null;
  title: string;
  body: string;
  title_folded: string;
  body_folded: string;
  context_date: string | null;
  updated_at: string;
}

function entry(kind: string, entityId: string): SearchEntryRow | undefined {
  return db.raw
    .prepare("SELECT * FROM search_entries WHERE kind = ? AND entity_id = ?")
    .get(kind, entityId) as SearchEntryRow | undefined;
}

function entryCount(): number {
  return (db.raw.prepare("SELECT count(*) AS n FROM search_entries").get() as { n: number }).n;
}

function ftsCount(): number {
  return (db.raw.prepare("SELECT count(*) AS n FROM search_fts").get() as { n: number }).n;
}

function ftsMatchCount(query: string): number {
  return (
    db.raw
      .prepare("SELECT count(*) AS n FROM search_fts WHERE search_fts MATCH ?")
      .get(query) as { n: number }
  ).n;
}

function ftsMatchEntities(query: string): Array<{ kind: string; entity_id: string }> {
  return db.raw
    .prepare(
      `SELECT e.kind AS kind, e.entity_id AS entity_id
       FROM search_fts f JOIN search_entries e ON e.id = f.rowid
       WHERE search_fts MATCH ?`,
    )
    .all(query) as Array<{ kind: string; entity_id: string }>;
}

const NOW = "2026-07-26T10:00:00.000Z";
const LATER = "2026-07-26T10:05:00.000Z";

describe("global search index (migration 017)", () => {
  it("indexes one of each of the nine kinds with the right kind/entity/title/parent/context_date/title_folded", () => {
    const profileId = createProfile();
    const tasks = new TaskStore(db.raw, profileId);
    const events = new EventStore(db.raw, profileId);
    const notes = new NoteStore(db.raw, profileId);
    const documents = new DocumentStore(db.raw, profileId);
    const subjects = new SubjectStore(db.raw, profileId);
    const exams = new ExamStore(db.raw, profileId);
    const decks = new DeckStore(db.raw, profileId);
    const cards = new CardStore(db.raw, profileId);
    const attachments = new NoteAttachmentStore(db.raw, profileId);

    const task = tasks.create({ title: "Predati izveštaj", dueDate: "2026-08-01" });
    const event = events.create({ title: "Sastanak", startAt: "2026-08-01T09:00:00Z" });
    const note = notes.create(NOW);
    notes.appendUpdate(note.id, Uint8Array.from([1, 2, 3]), "Moja beleška", NOW);
    const document = documents.create({
      docType: "pasos",
      label: "Pasoš",
      expiryDate: "2027-01-01",
      notes: "Vazi za putovanja",
    });
    const subject = subjects.create({ name: "Matematika", semester: "Prolece 2026" });
    const exam = exams.create({ subjectId: subject.id, examType: "pismeni", examDate: "2026-09-01" });
    const deck = decks.create({ subjectId: subject.id, name: "Integrali" });
    const card = cards.create({ deckId: deck.id, front: "2+2", back: "4" }, NOW);
    const attachment = attachments.add(
      note.id,
      { fileName: "skripta.pdf", mime: "application/pdf", sizeBytes: 1024, sha256: "a".repeat(64) },
      NOW,
    );

    const taskEntry = entry("task", task.id);
    expect(taskEntry?.title).toBe("Predati izveštaj");
    expect(taskEntry?.parent_id).toBeNull();
    expect(taskEntry?.context_date).toBe("2026-08-01");
    expect(taskEntry?.title_folded).toBe(foldSearchText("Predati izveštaj"));

    const eventEntry = entry("event", event.id);
    expect(eventEntry?.title).toBe("Sastanak");
    expect(eventEntry?.parent_id).toBeNull();
    expect(eventEntry?.context_date).toBe("2026-08-01T09:00:00Z");

    const noteEntry = entry("note", note.id);
    expect(noteEntry?.title).toBe("Moja beleška");
    expect(noteEntry?.parent_id).toBeNull();
    expect(noteEntry?.context_date).toBeNull();
    expect(noteEntry?.title_folded).toBe(foldSearchText("Moja beleška"));

    const documentEntry = entry("document", document.id);
    expect(documentEntry?.title).toBe("Pasoš");
    expect(documentEntry?.parent_id).toBeNull();
    expect(documentEntry?.context_date).toBe("2027-01-01");
    expect(documentEntry?.body).toBe("Vazi za putovanja pasos");

    const subjectEntry = entry("subject", subject.id);
    expect(subjectEntry?.title).toBe("Matematika");
    expect(subjectEntry?.parent_id).toBeNull();

    const examEntry = entry("exam", exam.id);
    expect(examEntry?.title).toBe("pismeni · Matematika");
    expect(examEntry?.parent_id).toBe(subject.id);
    expect(examEntry?.context_date).toBe("2026-09-01");

    const deckEntry = entry("deck", deck.id);
    expect(deckEntry?.title).toBe("Integrali");
    expect(deckEntry?.parent_id).toBe(subject.id);

    const cardEntry = entry("card", card.id);
    expect(cardEntry?.title).toBe("2+2");
    expect(cardEntry?.parent_id).toBe(deck.id);
    expect(cardEntry?.context_date).toBe(card.due);

    const attachmentEntry = entry("attachment", attachment.id);
    expect(attachmentEntry?.title).toBe("skripta.pdf");
    expect(attachmentEntry?.parent_id).toBe(note.id);
    expect(attachmentEntry?.context_date).toBeNull();

    expect(entryCount()).toBe(9);
  });

  it("matches a Serbian task title by both a Latin-diacritic term and its dj-substituted Cyrillic-style fold, with search_fts joined back to the right entity", () => {
    const profileId = createProfile();
    const task = new TaskStore(db.raw, profileId).create({ title: "Rešenje za Đorđa" });

    expect(ftsMatchCount('"resenje"*')).toBe(1);
    expect(ftsMatchCount('"djordja"*')).toBe(1);

    const hits = ftsMatchEntities('"djordja"*');
    expect(hits).toEqual([{ kind: "task", entity_id: task.id }]);
    expect(ftsCount()).toBe(entryCount());
  });

  it("renaming a task removes the old term from the FTS index and adds the new one, without growing the FTS row count", () => {
    const profileId = createProfile();
    const tasks = new TaskStore(db.raw, profileId);
    const task = tasks.create({ title: "Alfa zadatak" });

    expect(ftsMatchCount('"alfa"*')).toBe(1);
    const before = ftsCount();

    tasks.update(task.id, { title: "Beta zadatak" });

    expect(ftsMatchCount('"alfa"*')).toBe(0);
    expect(ftsMatchCount('"beta"*')).toBe(1);
    expect(ftsCount()).toBe(before);
  });

  it("soft-deleting a task removes its entry and restoring it brings it back, with no orphan FTS rows either way", () => {
    const profileId = createProfile();
    const tasks = new TaskStore(db.raw, profileId);
    const task = tasks.create({ title: "Oprati auto" });

    expect(entry("task", task.id)).toBeDefined();
    expect(ftsCount()).toBe(entryCount());

    tasks.softDelete(task.id);
    expect(entry("task", task.id)).toBeUndefined();
    expect(ftsCount()).toBe(entryCount());

    tasks.restore(task.id);
    expect(entry("task", task.id)).toBeDefined();
    expect(ftsCount()).toBe(entryCount());
  });

  it("indexes a note's body from its snapshot, and re-compacting with new plaintext refreshes it without duplicating the row", () => {
    const profileId = createProfile();
    const notes = new NoteStore(db.raw, profileId);
    const note = notes.create(NOW);
    notes.appendUpdate(note.id, Uint8Array.from([1, 2, 3]), "Plan puta", NOW);

    // No snapshot has been compacted yet: the body is empty.
    expect(entry("note", note.id)?.body).toBe("");

    notes.compact(note.id, Uint8Array.from([9, 9, 9]), "Prvi pasus teksta.", 1, LATER);
    const first = entry("note", note.id);
    expect(first?.body).toBe("Prvi pasus teksta.");
    expect(first?.body_folded).toBe(foldSearchText("Prvi pasus teksta."));

    notes.compact(note.id, Uint8Array.from([8, 8, 8]), "Drugi, izmenjeni tekst.", 2, LATER);
    const second = entry("note", note.id);
    expect(second?.body).toBe("Drugi, izmenjeni tekst.");
    expect(entryCount()).toBe(1); // still exactly one note entry, never a duplicate
  });

  it("caps an oversized note body at 8000 characters in both body and body_folded", () => {
    const profileId = createProfile();
    const notes = new NoteStore(db.raw, profileId);
    const note = notes.create(NOW);
    notes.appendUpdate(note.id, Uint8Array.from([1, 2, 3]), "Dugacka beleska", NOW);

    const longText = "lorem ipsum ".repeat(700); // 8400 ASCII characters, well past the cap
    expect(longText.length).toBeGreaterThan(8000);
    notes.compact(note.id, Uint8Array.from([1]), longText, 1, LATER);

    const row = entry("note", note.id);
    expect(row?.body.length).toBe(8000);
    expect(row?.body).toBe(longText.slice(0, 8000));
    expect(row?.body_folded).toBe(foldSearchText(longText.slice(0, 8000)));
  });

  it("soft-deleting a note removes its attachment entries and restoring the note brings them back", () => {
    const profileId = createProfile();
    const notes = new NoteStore(db.raw, profileId);
    const attachments = new NoteAttachmentStore(db.raw, profileId);
    const note = notes.create(NOW);
    const attachment = attachments.add(
      note.id,
      { fileName: "slika.png", mime: "image/png", sizeBytes: 2048, sha256: "b".repeat(64) },
      NOW,
    );

    expect(entry("attachment", attachment.id)).toBeDefined();

    notes.softDelete(note.id, LATER);
    expect(entry("note", note.id)).toBeUndefined();
    expect(entry("attachment", attachment.id)).toBeUndefined();

    notes.restore(note.id, LATER);
    expect(entry("note", note.id)).toBeDefined();
    expect(entry("attachment", attachment.id)).toBeDefined();
    expect(ftsCount()).toBe(entryCount());
  });

  it("soft-deleting a deck removes its cards' entries and restoring the deck brings them back", () => {
    const profileId = createProfile();
    const subjects = new SubjectStore(db.raw, profileId);
    const decks = new DeckStore(db.raw, profileId);
    const cards = new CardStore(db.raw, profileId);
    const subject = subjects.create({ name: "Fizika" });
    const deck = decks.create({ subjectId: subject.id, name: "Mehanika" });
    const card = cards.create({ deckId: deck.id, front: "F = ma", back: "Njutnov zakon" }, NOW);

    expect(entry("card", card.id)).toBeDefined();

    decks.softDelete(deck.id);
    expect(entry("deck", deck.id)).toBeUndefined();
    expect(entry("card", card.id)).toBeUndefined();

    decks.restore(deck.id);
    expect(entry("deck", deck.id)).toBeDefined();
    expect(entry("card", card.id)).toBeDefined();
    expect(ftsCount()).toBe(entryCount());
  });

  it("renaming a subject rewrites its exams' titles", () => {
    const profileId = createProfile();
    const subjects = new SubjectStore(db.raw, profileId);
    const exams = new ExamStore(db.raw, profileId);
    const subject = subjects.create({ name: "Matematika" });
    const exam = exams.create({ subjectId: subject.id, examType: "usmeni", examDate: "2026-09-10" });

    expect(entry("exam", exam.id)?.title).toBe("usmeni · Matematika");

    subjects.update(subject.id, { name: "Fizika" });

    const refreshed = entry("exam", exam.id);
    expect(refreshed?.title).toBe("usmeni · Fizika");
    expect(refreshed?.title_folded).toBe(foldSearchText("usmeni · Fizika"));
  });

  it("keeps a subject's exams and decks indexed after the subject is soft-deleted", () => {
    // The deliberate asymmetry against cards and attachments, which DO vanish
    // with their parent: `ExamStore.list` and `DeckStore.list` do not filter on
    // subject liveness either, and search must show exactly what the module's
    // own list shows. Pinned as a test because a comment alone would not stop
    // someone "fixing" the two views to join on the subject's deleted_at.
    const profileId = createProfile();
    const subjects = new SubjectStore(db.raw, profileId);
    const subject = subjects.create({ name: "Hemija" });
    const exam = new ExamStore(db.raw, profileId).create({
      subjectId: subject.id,
      examType: "kolokvijum",
      examDate: "2026-10-01",
    });
    const deck = new DeckStore(db.raw, profileId).create({
      subjectId: subject.id,
      name: "Organska",
    });

    subjects.softDelete(subject.id);

    expect(entry("subject", subject.id)).toBeUndefined();
    expect(entry("exam", exam.id)?.title).toBe("kolokvijum · Hemija");
    expect(entry("deck", deck.id)).toBeDefined();
    expect(ftsCount()).toBe(entryCount());
  });

  it("scopes entries by profile: an entity never appears under another profile's profile_id", () => {
    const p1 = createProfile("P1");
    const p2 = createProfile("P2");
    const task = new TaskStore(db.raw, p1).create({ title: "Samo za P1" });

    expect(entry("task", task.id)?.profile_id).toBe(p1);

    const crossProfileRow = db.raw
      .prepare("SELECT * FROM search_entries WHERE entity_id = ? AND profile_id = ?")
      .get(task.id, p2);
    expect(crossProfileRow).toBeUndefined();
  });

  it("hard-deleting a row removes both its entry and its FTS row", () => {
    const profileId = createProfile();
    const task = new TaskStore(db.raw, profileId).create({ title: "Za brisanje" });
    expect(entry("task", task.id)).toBeDefined();

    db.raw.prepare("DELETE FROM tasks WHERE id = ?").run(task.id);

    expect(entry("task", task.id)).toBeUndefined();
    expect(entryCount()).toBe(0);
    expect(ftsCount()).toBe(0);
  });

  it("hard-deleting a note with attachments cascades cleanly: the FK cascade to note_attachments fires its own AD trigger, leaving no orphan entries", () => {
    const profileId = createProfile();
    const notes = new NoteStore(db.raw, profileId);
    const attachments = new NoteAttachmentStore(db.raw, profileId);
    const note = notes.create(NOW);
    attachments.add(
      note.id,
      { fileName: "prilog.pdf", mime: "application/pdf", sizeBytes: 512, sha256: "c".repeat(64) },
      NOW,
    );

    expect(entryCount()).toBe(2); // the note itself, plus its one attachment

    // NoteStore itself never hard-deletes (only soft-delete); this is the SQL-level
    // hard delete that ON DELETE CASCADE (migration 013) propagates to
    // note_attachments. Verified empirically against this SQLite build
    // (3.53.2): a cascade-triggered child delete DOES fire the child table's
    // own AFTER DELETE trigger, which is what removes the attachment's entry
    // below without any extra cleanup statement in notes_search_ad.
    db.raw.prepare("DELETE FROM notes WHERE id = ?").run(note.id);

    expect(entryCount()).toBe(0);
    expect(ftsCount()).toBe(0);
  });

  it("backfills existing data when migration 017 is applied to an already-populated, pre-existing database", () => {
    // The only honest way to exercise the backfill once migration 017 is a
    // permanent part of MIGRATIONS: build a file with every EARLIER migration
    // applied and real data in it, THEN bring it up to the latest schema —
    // exactly what happens to an existing install. Bypasses `openDatabase` so
    // the pre-migration-17 state can be constructed directly; registers
    // `nx_fold` by hand, mirroring what `openDatabase` does, since the
    // backfill statements call it.
    const backfillPath = join(dir, "backfill.db");
    const rawDb = new Database(backfillPath);
    rawDb.pragma("journal_mode = WAL");
    rawDb.pragma("foreign_keys = ON");
    rawDb.function("nx_fold", { deterministic: true }, (value: unknown) =>
      typeof value === "string" ? foldSearchText(value) : null,
    );

    // Selected by VERSION, not by position: "every migration before the search
    // index" is what this file needs, and slicing the last entry off the list
    // only said that while 017 happened to be the newest migration — the day a
    // migration 018 landed, the "pre-migration-017" file silently became a
    // post-017 one. `migrations.test.ts` pins that versions run 1..N gap-free,
    // so the count below and the stamped version agree by construction.
    const beforeSearchIndex = MIGRATIONS.filter((migration) => migration.version < 17);
    runMigrations(rawDb, beforeSearchIndex);
    expect(rawDb.pragma("user_version", { simple: true })).toBe(16);

    const profileId = uuidv7();
    rawDb
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(profileId, "personal", "P", NOW);
    const taskId = uuidv7();
    rawDb
      .prepare(
        `INSERT INTO tasks (id, profile_id, title, status, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(taskId, profileId, "Pre-migracije zadatak", "todo", NOW, NOW, null);

    // Confirms this really is a pre-migration-017 file, not an accidental no-op.
    const tablesBefore = (
      rawDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(tablesBefore).not.toContain("search_entries");

    runMigrations(rawDb, MIGRATIONS);
    expect(rawDb.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);

    const row = rawDb
      .prepare("SELECT title, title_folded, profile_id FROM search_entries WHERE kind = 'task' AND entity_id = ?")
      .get(taskId) as { title: string; title_folded: string; profile_id: string } | undefined;
    expect(row?.title).toBe("Pre-migracije zadatak");
    expect(row?.title_folded).toBe(foldSearchText("Pre-migracije zadatak"));
    expect(row?.profile_id).toBe(profileId);

    const ftsRow = rawDb
      .prepare(
        `SELECT count(*) AS n FROM search_fts f
         JOIN search_entries e ON e.id = f.rowid
         WHERE e.entity_id = ?`,
      )
      .get(taskId) as { n: number };
    expect(ftsRow.n).toBe(1);

    rawDb.close();
  });
});
