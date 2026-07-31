import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NexusDatabase,
  NoteNotFoundError,
  NoteStore,
  SubjectNotFoundError,
  SubjectNoteLinkStore,
  SubjectNoteLinkValidationError,
  SubjectStore,
  openDatabase,
  uuidv7,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-subject-note-links-"));
  db = openDatabase({ path: join(dir, "subject-note-links.db") });
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

interface Fixture {
  links: SubjectNoteLinkStore;
  subjects: SubjectStore;
  notes: NoteStore;
  profileId: string;
}

function fixture(): Fixture {
  const profileId = createProfile();
  return {
    links: new SubjectNoteLinkStore(db.raw, profileId),
    subjects: new SubjectStore(db.raw, profileId),
    notes: new NoteStore(db.raw, profileId),
    profileId,
  };
}

const T0 = "2026-07-30T09:00:00.000Z";
const T1 = "2026-07-30T10:00:00.000Z";
const T2 = "2026-07-30T11:00:00.000Z";

describe("SubjectNoteLinkStore — linkNote", () => {
  it("files a note under a subject and reports it back with its title", () => {
    const { links, subjects, notes } = fixture();
    const subject = subjects.create({ name: "Analiza 1" });
    const note = notes.create(T0);
    notes.appendUpdate(note.id, new Uint8Array([1, 2, 3]), "Integrali", T0);

    links.linkNote(subject.id, note.id, T1);

    expect(links.listLinkedNotes(subject.id)).toEqual([
      { id: note.id, title: "Integrali", updatedAt: T0, linkedAt: T1 },
    ]);
  });

  it("is idempotent — linking the same pair twice leaves one row with its FIRST timestamp", () => {
    const { links, subjects, notes } = fixture();
    const subject = subjects.create({ name: "A" });
    const note = notes.create(T0);

    links.linkNote(subject.id, note.id, T1);
    links.linkNote(subject.id, note.id, T2);

    const linked = links.listLinkedNotes(subject.id);
    expect(linked).toHaveLength(1);
    expect(linked[0]?.linkedAt).toBe(T1);
  });

  it("rejects an unknown, soft-deleted, or cross-profile subject", () => {
    const a = fixture();
    const b = fixture();
    const subject = a.subjects.create({ name: "A" });
    const note = a.notes.create(T0);
    const deleted = a.subjects.create({ name: "Obrisan" });
    a.subjects.softDelete(deleted.id);

    expect(() => a.links.linkNote("missing", note.id, T1)).toThrow(SubjectNotFoundError);
    expect(() => a.links.linkNote(deleted.id, note.id, T1)).toThrow(SubjectNotFoundError);
    expect(() => b.links.linkNote(subject.id, note.id, T1)).toThrow(SubjectNotFoundError);
  });

  it("rejects an unknown, soft-deleted, or cross-profile note", () => {
    const a = fixture();
    const b = fixture();
    const subject = a.subjects.create({ name: "A" });
    const note = a.notes.create(T0);
    const deleted = a.notes.create(T0);
    a.notes.softDelete(deleted.id, T1);
    const otherSubject = b.subjects.create({ name: "B" });

    expect(() => a.links.linkNote(subject.id, "missing", T1)).toThrow(NoteNotFoundError);
    expect(() => a.links.linkNote(subject.id, deleted.id, T1)).toThrow(NoteNotFoundError);
    expect(() => b.links.linkNote(otherSubject.id, note.id, T1)).toThrow(NoteNotFoundError);
  });

  it("rejects a malformed now", () => {
    const { links, subjects, notes } = fixture();
    const subject = subjects.create({ name: "A" });
    const note = notes.create(T0);
    expect(() => links.linkNote(subject.id, note.id, "nope")).toThrow(
      SubjectNoteLinkValidationError,
    );
  });
});

describe("SubjectNoteLinkStore — listLinkedNotes", () => {
  it("is empty for a subject with no links, and orders by when each link was made", () => {
    const { links, subjects, notes } = fixture();
    const subject = subjects.create({ name: "A" });
    expect(links.listLinkedNotes(subject.id)).toEqual([]);

    const first = notes.create(T0);
    const second = notes.create(T0);
    // Distinct link timestamps: the order under test is the link's own, never a
    // tiebreak over two ids minted inside the same millisecond.
    links.linkNote(subject.id, second.id, T2);
    links.linkNote(subject.id, first.id, T1);

    expect(links.listLinkedNotes(subject.id).map((n) => n.id)).toEqual([first.id, second.id]);
  });

  it("rejects an unknown, soft-deleted, or cross-profile subject", () => {
    const a = fixture();
    const b = fixture();
    const subject = a.subjects.create({ name: "A" });
    const deleted = a.subjects.create({ name: "Obrisan" });
    a.subjects.softDelete(deleted.id);

    expect(() => a.links.listLinkedNotes("missing")).toThrow(SubjectNotFoundError);
    expect(() => a.links.listLinkedNotes(deleted.id)).toThrow(SubjectNotFoundError);
    expect(() => b.links.listLinkedNotes(subject.id)).toThrow(SubjectNotFoundError);
  });

  it("hides a note the trash holds, and shows it again once it is restored", () => {
    const { links, subjects, notes } = fixture();
    const subject = subjects.create({ name: "A" });
    const note = notes.create(T0);
    links.linkNote(subject.id, note.id, T1);

    notes.softDelete(note.id, T2);
    expect(links.listLinkedNotes(subject.id)).toEqual([]);

    notes.restore(note.id, T2);
    expect(links.listLinkedNotes(subject.id).map((n) => n.id)).toEqual([note.id]);
  });
});

describe("SubjectNoteLinkStore — listLinks", () => {
  it("lists every live-both-ends pair of this profile and nothing of another's", () => {
    const a = fixture();
    const b = fixture();
    const subject = a.subjects.create({ name: "A" });
    const note = a.notes.create(T0);
    a.links.linkNote(subject.id, note.id, T1);

    const otherSubject = b.subjects.create({ name: "B" });
    const otherNote = b.notes.create(T0);
    b.links.linkNote(otherSubject.id, otherNote.id, T1);

    expect(a.links.listLinks()).toEqual([
      { subjectId: subject.id, noteId: note.id, createdAt: T1 },
    ]);
    expect(b.links.listLinks()).toEqual([
      { subjectId: otherSubject.id, noteId: otherNote.id, createdAt: T1 },
    ]);
  });

  it("hides a pair whose subject or note is soft-deleted, without removing the row", () => {
    const { links, subjects, notes } = fixture();
    const subject = subjects.create({ name: "A" });
    const note = notes.create(T0);
    links.linkNote(subject.id, note.id, T1);

    subjects.softDelete(subject.id);
    expect(links.listLinks()).toEqual([]);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM subject_note_links").get() as { n: number }).n,
    ).toBe(1);

    subjects.restore(subject.id);
    expect(links.listLinks()).toHaveLength(1);
  });
});

describe("SubjectNoteLinkStore — listSubjectsOfNote", () => {
  it("answers with every live subject a live note is filed under", () => {
    const { links, notes, profileId } = fixture();
    // Explicit ids: `listSubjectsOfNote` orders by subject id, and two subjects
    // created in the same millisecond would make a minted order a coin flip.
    const insertSubject = db.raw.prepare(
      `INSERT INTO subjects (id, profile_id, name, color, created_at, updated_at)
       VALUES (?, ?, ?, 'jade', ?, ?)`,
    );
    insertSubject.run("s-aaa", profileId, "Prvi", T0, T0);
    insertSubject.run("s-bbb", profileId, "Drugi", T0, T0);

    const note = notes.create(T0);
    links.linkNote("s-bbb", note.id, T1);
    links.linkNote("s-aaa", note.id, T2);

    expect(links.listSubjectsOfNote(note.id)).toEqual(["s-aaa", "s-bbb"]);
  });

  it("rejects an unknown, soft-deleted, or cross-profile note", () => {
    const a = fixture();
    const b = fixture();
    const note = a.notes.create(T0);
    const deleted = a.notes.create(T0);
    a.notes.softDelete(deleted.id, T1);

    expect(() => a.links.listSubjectsOfNote("missing")).toThrow(NoteNotFoundError);
    expect(() => a.links.listSubjectsOfNote(deleted.id)).toThrow(NoteNotFoundError);
    expect(() => b.links.listSubjectsOfNote(note.id)).toThrow(NoteNotFoundError);
  });
});

describe("SubjectNoteLinkStore — unlinkNote", () => {
  it("removes one link and is silent whether or not it was there", () => {
    const { links, subjects, notes } = fixture();
    const subject = subjects.create({ name: "A" });
    const note = notes.create(T0);
    links.linkNote(subject.id, note.id, T1);

    links.unlinkNote(subject.id, note.id);
    expect(links.listLinkedNotes(subject.id)).toEqual([]);
    // A second removal, an unknown pair and an unknown id all pass silently.
    expect(() => links.unlinkNote(subject.id, note.id)).not.toThrow();
    expect(() => links.unlinkNote("missing", "missing")).not.toThrow();
  });

  it("never removes another profile's link", () => {
    const a = fixture();
    const b = fixture();
    const subject = a.subjects.create({ name: "A" });
    const note = a.notes.create(T0);
    a.links.linkNote(subject.id, note.id, T1);

    b.links.unlinkNote(subject.id, note.id);
    expect(a.links.listLinkedNotes(subject.id)).toHaveLength(1);
  });
});

describe("SubjectNoteLinkStore — hard delete", () => {
  it("cascades a link away when either end's row is removed at the SQL level", () => {
    const { links, subjects, notes } = fixture();
    const subject = subjects.create({ name: "A" });
    const note = notes.create(T0);
    links.linkNote(subject.id, note.id, T1);

    db.raw.prepare("DELETE FROM notes WHERE id = ?").run(note.id);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM subject_note_links").get() as { n: number }).n,
    ).toBe(0);
    expect(links.listLinkedNotes(subject.id)).toEqual([]);
  });
});
