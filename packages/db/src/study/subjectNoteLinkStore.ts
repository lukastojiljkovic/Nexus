import type Database from "better-sqlite3-multiple-ciphers";
import { NoteNotFoundError, SubjectNotFoundError, SubjectNoteLinkValidationError } from "../errors.js";

type DatabaseHandle = Database.Database;

/** One subject↔note edge: "this note belongs to that course". Undirected in meaning, pair-keyed in storage (migration 035). */
export interface SubjectNoteLink {
  subjectId: string;
  noteId: string;
  createdAt: string;
}

/**
 * A linked note as the subject panel draws it: enough to render one row and
 * open it, and deliberately nothing more. The note's body never comes through
 * here — the reveal intent hands the id to Beleške, which loads it the way it
 * always does.
 */
export interface LinkedNote {
  id: string;
  title: string;
  updatedAt: string;
  /** When the link was made — the order the section lists them in. */
  linkedAt: string;
}

interface LinkRow {
  subject_id: string;
  note_id: string;
  created_at: string;
}

interface LinkedNoteRow {
  id: string;
  title: string;
  updated_at: string;
  linked_at: string;
}

/** Accepts a full ISO-8601 date-time (`linkNote`'s `now`) — the spelling every other store in this package uses. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Persistence for STUDY-001's subject↔note links (migration 035): the notes a
 * user has filed under a course. Its own file rather than a method group on
 * `SubjectStore`, for `TaskDependencyStore`'s reason: this is a JOIN TABLE
 * between two entities with no row identity of its own, and it reaches across a
 * module boundary into `notes` — `SubjectStore` owns one table and one profile's
 * subject rows, and folding a second table plus a foreign module's liveness rule
 * into it would make the smaller, hotter store carry the larger one's concerns.
 *
 * Shaped after `TaskDependencyStore` throughout: one join table, a pair-keyed
 * insert that is an idempotent no-op on conflict, a silent delete, and reads
 * that filter for liveness rather than deleting. Construct one per profile,
 * reuse it, over prepared, parameterized statements (SEC-API-03), every value
 * bound, never interpolated. Inputs are revalidated here because the renderer is
 * untrusted (SEC-EL-02), and every statement is scoped by `profile_id` — the
 * edges are reached through their already-scoped subjects and notes, so one
 * profile's links are invisible to a store scoped to another.
 *
 * **Liveness is a READ filter, never a delete** (ADR-037's edge philosophy). A
 * soft delete of EITHER end leaves the link standing, so a note sent to the
 * trash and brought back is still filed under its subject, and so is a restored
 * subject — the only arrangement under which the undo bar tells the truth. Every
 * read below therefore joins BOTH ends and requires both live.
 */
export class SubjectNoteLinkStore {
  private readonly selectActiveSubjectById: Database.Statement;
  private readonly selectActiveNoteById: Database.Statement;
  private readonly selectLinks: Database.Statement;
  private readonly selectLinkedNotes: Database.Statement;
  private readonly selectSubjectsOfNote: Database.Statement;
  private readonly insertLink: Database.Statement;
  private readonly deleteLink: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectActiveSubjectById = db.prepare(
      `SELECT id FROM subjects WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectActiveNoteById = db.prepare(
      `SELECT id FROM notes WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectLinks = db.prepare(
      `SELECT snl.subject_id, snl.note_id, snl.created_at
       FROM subject_note_links snl
       JOIN subjects s ON s.id = snl.subject_id
       JOIN notes n ON n.id = snl.note_id
       WHERE s.profile_id = ? AND s.deleted_at IS NULL
         AND n.profile_id = ? AND n.deleted_at IS NULL
       ORDER BY snl.subject_id, snl.note_id`,
    );
    this.selectLinkedNotes = db.prepare(
      `SELECT n.id, n.title, n.updated_at, snl.created_at AS linked_at
       FROM subject_note_links snl
       JOIN subjects s ON s.id = snl.subject_id
       JOIN notes n ON n.id = snl.note_id
       WHERE snl.subject_id = ?
         AND s.profile_id = ? AND s.deleted_at IS NULL
         AND n.profile_id = ? AND n.deleted_at IS NULL
       ORDER BY snl.created_at ASC, n.id ASC`,
    );
    this.selectSubjectsOfNote = db.prepare(
      `SELECT snl.subject_id
       FROM subject_note_links snl
       JOIN subjects s ON s.id = snl.subject_id
       JOIN notes n ON n.id = snl.note_id
       WHERE snl.note_id = ?
         AND s.profile_id = ? AND s.deleted_at IS NULL
         AND n.profile_id = ? AND n.deleted_at IS NULL
       ORDER BY snl.subject_id`,
    );
    this.insertLink = db.prepare(
      `INSERT INTO subject_note_links (subject_id, note_id, created_at)
       VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
    );
    // Scoped through the SUBJECT end alone, exactly as `task_dependencies`'
    // delete is through its blocker: both ends of a link always belong to the
    // same profile — `linkNote` refuses any other pair, and the archive parser
    // reference-checks both ends against the archive's own rows — so naming the
    // subject names the whole edge.
    this.deleteLink = db.prepare(
      `DELETE FROM subject_note_links
       WHERE subject_id = ? AND note_id = ?
         AND subject_id IN (SELECT id FROM subjects WHERE profile_id = ?)`,
    );
  }

  /** Every link of this profile whose BOTH ends are live, subject id then note id — the exporter's whole read (mirrors `TaskDependencyStore.listLinks`). */
  listLinks(): SubjectNoteLink[] {
    const rows = this.selectLinks.all(this.profileId, this.profileId) as LinkRow[];
    return rows.map((row) => ({
      subjectId: row.subject_id,
      noteId: row.note_id,
      createdAt: row.created_at,
    }));
  }

  /**
   * The live notes filed under one live subject of this profile, oldest link
   * first. An unknown, soft-deleted or cross-profile subject is
   * `SubjectNotFoundError` rather than an empty list: "there is nothing here"
   * and "there is no such subject" are different answers, and only the store can
   * tell them apart.
   */
  listLinkedNotes(subjectId: string): LinkedNote[] {
    this.requireActiveSubject(subjectId);
    const rows = this.selectLinkedNotes.all(
      subjectId,
      this.profileId,
      this.profileId,
    ) as LinkedNoteRow[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at,
      linkedAt: row.linked_at,
    }));
  }

  /** The reverse lookup, over `subject_note_links_note`: which live subjects one live note is filed under. */
  listSubjectsOfNote(noteId: string): string[] {
    this.requireActiveNote(noteId);
    const rows = this.selectSubjectsOfNote.all(noteId, this.profileId, this.profileId) as {
      subject_id: string;
    }[];
    return rows.map((row) => row.subject_id);
  }

  /** Files a live note under a live subject of this profile. A link that already exists is a no-op — the pair key makes that safe without a read-then-write. */
  linkNote(subjectId: string, noteId: string, now: string): void {
    const validNow = validateDateTime(now, "now");
    this.requireActiveSubject(subjectId);
    this.requireActiveNote(noteId);
    this.insertLink.run(subjectId, noteId, validNow);
  }

  /** Removes one link; silent (never throws) whether or not it existed — `TaskDependencyStore.removeDependency`'s rule. */
  unlinkNote(subjectId: string, noteId: string): void {
    this.deleteLink.run(subjectId, noteId, this.profileId);
  }

  /** Confirms an active subject exists in this profile or throws — one half of the gate every write goes through. */
  private requireActiveSubject(id: string): void {
    const row = this.selectActiveSubjectById.get(id, this.profileId);
    if (!row) {
      throw new SubjectNotFoundError(`No active subject "${id}" in this profile.`);
    }
  }

  /** Confirms an active note exists in this profile or throws — the other half. */
  private requireActiveNote(id: string): void {
    const row = this.selectActiveNoteById.get(id, this.profileId);
    if (!row) {
      throw new NoteNotFoundError(`No active note "${id}" in this profile.`);
    }
  }
}

function validateDateTime(value: string, field: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new SubjectNoteLinkValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}
