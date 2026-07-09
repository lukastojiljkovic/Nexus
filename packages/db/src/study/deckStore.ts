import type Database from "better-sqlite3-multiple-ciphers";
import { DeckNotFoundError, DeckValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** A deck as the store returns it: camelCase keys, its subject carried by id. */
export interface Deck {
  id: string;
  profileId: string;
  subjectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when creating a deck; both `subjectId` and `name` are required (STUDY flashcards). */
export interface CreateDeckInput {
  subjectId: string;
  name: string;
}

/**
 * A partial patch of a deck's own fields. An omitted key is left untouched. Soft
 * delete/restore have their own methods.
 */
export interface UpdateDeckFields {
  subjectId?: string;
  name?: string;
}

interface DeckRow {
  id: string;
  profile_id: string;
  subject_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, profile_id, subject_id, name, created_at, updated_at";

const MAX_NAME_LENGTH = 200;

/**
 * Deck persistence for a single profile, over prepared, parameterized statements
 * (SEC-API-03; every value is bound, never interpolated). Mirrors `ExamStore`:
 * construct one per profile, reuse it. Inputs are revalidated here because the
 * renderer is untrusted (SEC-EL-02), and every statement is scoped by `profile_id`
 * so one profile's decks are invisible to another's store — including the subject
 * foreign key, which must resolve to a non-deleted subject in THIS profile.
 */
export class DeckStore {
  private readonly insert: Database.Statement;
  private readonly selectActive: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly selectSubject: Database.Statement;
  private readonly updateFields: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO decks
         (id, profile_id, subject_id, name, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM decks
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY name, id`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM decks
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectSubject = db.prepare(
      `SELECT id FROM subjects
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateFields = db.prepare(
      `UPDATE decks
         SET subject_id = ?, name = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE decks SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE decks SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
  }

  /** Active decks for this profile ordered by name (soft-deleted excluded); the UI re-sorts with the Serbian collator. */
  listActive(): Deck[] {
    const rows = this.selectActive.all(this.profileId) as DeckRow[];
    return rows.map(toDeck);
  }

  /** Inserts a deck against a subject in this profile, and returns the stored row (STUDY flashcards). */
  create(input: CreateDeckInput): Deck {
    const name = validateName(input.name);
    const subjectId = this.resolveSubject(input.subjectId);
    const now = new Date().toISOString();
    const id = uuidv7();

    this.insert.run(id, this.profileId, subjectId, name, now, now);

    return { id, profileId: this.profileId, subjectId, name, createdAt: now, updatedAt: now };
  }

  /** Applies a partial field patch to an active deck (STUDY flashcards editing). */
  update(id: string, fields: UpdateDeckFields): Deck {
    const current = this.requireActive(id);
    return this.writeFields(current, {
      subjectId:
        fields.subjectId !== undefined ? this.resolveSubject(fields.subjectId) : current.subjectId,
      name: fields.name !== undefined ? validateName(fields.name) : current.name,
    });
  }

  /** Soft-deletes an active deck (reversible via `restore`). */
  softDelete(id: string): void {
    const now = new Date().toISOString();
    const { changes } = this.markDeleted.run(now, now, id, this.profileId);
    if (changes === 0) {
      throw new DeckNotFoundError(`No active deck "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted deck (undo of a delete). */
  restore(id: string): void {
    const now = new Date().toISOString();
    const { changes } = this.markRestored.run(now, id, this.profileId);
    if (changes === 0) {
      throw new DeckNotFoundError(`No deleted deck "${id}" to restore in this profile.`);
    }
  }

  /** Reads an active deck in this profile or throws — enforces scope + existence. */
  private requireActive(id: string): Deck {
    const row = this.selectActiveById.get(id, this.profileId) as DeckRow | undefined;
    if (!row) {
      throw new DeckNotFoundError(`No active deck "${id}" in this profile.`);
    }
    return toDeck(row);
  }

  /** Writes a fully-resolved field set and returns the merged deck. */
  private writeFields(current: Deck, next: Required<UpdateDeckFields>): Deck {
    const now = new Date().toISOString();

    this.updateFields.run(next.subjectId, next.name, now, current.id, this.profileId);

    return { ...current, ...next, updatedAt: now };
  }

  /**
   * Validates a subject id references a non-deleted subject in this profile
   * (mirrors `ExamStore.resolveSubject`): the same-profile scope on the lookup is
   * what stops a deck from pointing at another profile's subject.
   */
  private resolveSubject(subjectId: string): string {
    const subject = this.selectSubject.get(subjectId, this.profileId);
    if (!subject) {
      throw new DeckValidationError(
        `subjectId "${subjectId}" does not reference a subject in this profile.`,
      );
    }
    return subjectId;
  }
}

function toDeck(row: DeckRow): Deck {
  return {
    id: row.id,
    profileId: row.profile_id,
    subjectId: row.subject_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DeckValidationError("Deck name must not be empty.");
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new DeckValidationError(`Deck name must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return trimmed;
}
