import type Database from "better-sqlite3-multiple-ciphers";
import { PrivateNoteNotFoundError, PrivateNoteValidationError } from "../errors.js";

type DatabaseHandle = Database.Database;

/** How many sealed version containers one note keeps (ADR-057); `writeVersion` evicts the oldest beyond this in the same transaction as its insert. */
export const MAX_PRIVATE_NOTE_VERSIONS = 20;

/** Accepts a full ISO-8601 date-time — the same shape every other store's `now` takes. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/** Everything `list()` can honestly say about a private note: its id and its timestamps. There is nothing else in cleartext to report (migration 045). */
export interface PrivateNoteMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/** One surviving version's cleartext facts — its bound sequence number and when it was captured. */
export interface PrivateNoteVersionMeta {
  seq: number;
  createdAt: string;
}

/**
 * The `private_notes` / `private_note_versions` tables (migration 045,
 * ADR-057), over prepared, parameterized statements (SEC-API-03; every value
 * is bound, never interpolated). Constructed one per profile and reused, like
 * every other store here; every statement is scoped by `profile_id` —
 * directly, or through the note the versions hang off.
 *
 * **This store knows NOTHING about crypto — bytes in, bytes out.** `sealed`
 * is an opaque NXP1 container (`@nexus/core`'s `privEnvelope.ts`) that only
 * the main process, holding the profile's unwrapped PRIV DEK, can open. The
 * store never parses it, never indexes it, and `list()` NEVER decrypts — it
 * cannot: nothing here holds a key, which is precisely the design (SEC-ZK-05).
 *
 * `delete` is a HARD delete, deliberately (ADR-057): an undo bar holding
 * sealed bytes whose key may re-lock mid-undo is a promise the app cannot
 * keep. The `ON DELETE CASCADE` on `private_note_versions` takes the history
 * with the row.
 *
 * `seq` on a version row is the very sequence number its container's AES-GCM
 * AAD binds — the store stores it verbatim so the caller can open the bytes
 * again, but attaches no meaning to it beyond "unique per note, evict lowest
 * first".
 */
export class PrivateNoteStore {
  private readonly selectMetas: Database.Statement;
  private readonly selectSealed: Database.Statement;
  private readonly upsertNote: Database.Statement;
  private readonly deleteNote: Database.Statement;
  private readonly countOwnNote: Database.Statement;
  private readonly insertVersion: Database.Statement;
  private readonly evictVersions: Database.Statement;
  private readonly selectVersions: Database.Statement;
  private readonly selectVersionSealed: Database.Statement;
  private readonly selectMaxSeq: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectMetas = db.prepare(
      `SELECT id, created_at, updated_at FROM private_notes
        WHERE profile_id = ?
        ORDER BY updated_at DESC, id DESC`,
    );
    this.selectSealed = db.prepare(
      `SELECT sealed FROM private_notes WHERE id = ? AND profile_id = ?`,
    );
    // The `WHERE` on the conflict arm is what keeps the GLOBAL primary key from
    // letting one profile's write land on another profile's row: a foreign id
    // conflicts, updates nothing, and `changes === 0` below turns that into a
    // named refusal instead of a silent cross-profile overwrite.
    this.upsertNote = db.prepare(
      `INSERT INTO private_notes (id, profile_id, sealed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         sealed = excluded.sealed,
         updated_at = excluded.updated_at
       WHERE private_notes.profile_id = excluded.profile_id`,
    );
    this.deleteNote = db.prepare(
      `DELETE FROM private_notes WHERE id = ? AND profile_id = ?`,
    );
    this.countOwnNote = db.prepare(
      `SELECT count(*) AS n FROM private_notes WHERE id = ? AND profile_id = ?`,
    );
    this.insertVersion = db.prepare(
      `INSERT INTO private_note_versions (note_id, seq, sealed, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    this.evictVersions = db.prepare(
      `DELETE FROM private_note_versions
        WHERE note_id = ?
          AND seq NOT IN (
            SELECT seq FROM private_note_versions
             WHERE note_id = ?
             ORDER BY seq DESC
             LIMIT ?
          )`,
    );
    this.selectVersions = db.prepare(
      `SELECT seq, created_at FROM private_note_versions
        WHERE note_id = ?
        ORDER BY seq DESC`,
    );
    this.selectVersionSealed = db.prepare(
      `SELECT sealed FROM private_note_versions WHERE note_id = ? AND seq = ?`,
    );
    this.selectMaxSeq = db.prepare(
      `SELECT COALESCE(MAX(seq), 0) AS max_seq FROM private_note_versions WHERE note_id = ?`,
    );
  }

  /** This profile's notes, newest-touched first: ids and timestamps ONLY (migration 045's whole cleartext surface). Never decrypts — it has no key to decrypt with. */
  list(): PrivateNoteMeta[] {
    const rows = this.selectMetas.all(this.profileId) as {
      id: string;
      created_at: string;
      updated_at: string;
    }[];
    return rows.map((row) => ({ id: row.id, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  /** One note's sealed container, verbatim. Throws for an id this profile has no row for. */
  readSealed(id: string): Uint8Array {
    const row = this.selectSealed.get(id, this.profileId) as { sealed: Buffer } | undefined;
    if (row === undefined) {
      throw new PrivateNoteNotFoundError(`No private note "${id}" in this profile.`);
    }
    return row.sealed;
  }

  /** Upserts one note's sealed container, bumping `updated_at` (`created_at` only on first insert). Refuses an id another profile owns — see the upsert statement's comment. */
  writeSealed(id: string, sealed: Uint8Array, now: string): void {
    validateSealed(sealed);
    validateDateTime(now);
    const result = this.upsertNote.run(id, this.profileId, Buffer.from(sealed), now, now);
    if (result.changes === 0) {
      throw new PrivateNoteValidationError(
        `Private note "${id}" belongs to another profile; refusing to overwrite it.`,
      );
    }
  }

  /** HARD delete (ADR-057 — see the class doc comment); the cascade takes the note's versions with it. Throws for an id this profile has no row for. */
  delete(id: string): void {
    const result = this.deleteNote.run(id, this.profileId);
    if (result.changes === 0) {
      throw new PrivateNoteNotFoundError(`No private note "${id}" in this profile.`);
    }
  }

  /**
   * Captures one sealed container as version `seq`, evicting the oldest rows
   * beyond `MAX_PRIVATE_NOTE_VERSIONS` in the SAME transaction as the insert.
   * `seq` must be the sequence the container was sealed under (its AAD) — the
   * store cannot check that, only store it faithfully.
   */
  writeVersion(noteId: string, seq: number, sealed: Uint8Array, now: string): void {
    this.requireOwnNote(noteId);
    if (!Number.isInteger(seq) || seq <= 0) {
      throw new PrivateNoteValidationError(`"seq" must be a positive whole number.`);
    }
    validateSealed(sealed);
    validateDateTime(now);
    // Insert and eviction as ONE transaction: a version without its eviction
    // (or the reverse) is a state no crash may leave behind.
    this.db.transaction((): void => {
      this.insertVersion.run(noteId, seq, Buffer.from(sealed), now);
      this.evictVersions.run(noteId, noteId, MAX_PRIVATE_NOTE_VERSIONS);
    })();
  }

  /** The note's surviving versions, newest first: seq and capture time — the two cleartext facts a version row has. */
  listVersions(noteId: string): PrivateNoteVersionMeta[] {
    this.requireOwnNote(noteId);
    const rows = this.selectVersions.all(noteId) as { seq: number; created_at: string }[];
    return rows.map((row) => ({ seq: row.seq, createdAt: row.created_at }));
  }

  /** One version's sealed container, verbatim. Throws when the note or the version is not this profile's to read. */
  readVersion(noteId: string, seq: number): Uint8Array {
    this.requireOwnNote(noteId);
    const row = this.selectVersionSealed.get(noteId, seq) as { sealed: Buffer } | undefined;
    if (row === undefined) {
      throw new PrivateNoteNotFoundError(`No version ${seq} of private note "${noteId}".`);
    }
    return row.sealed;
  }

  /**
   * The highest surviving version seq, or 0 while none exist. This — not the
   * row COUNT, which eviction shrinks — is what the caller's "live container
   * is sealed at max + 1" arithmetic must stand on to stay monotonic.
   */
  maxVersionSeq(noteId: string): number {
    this.requireOwnNote(noteId);
    const { max_seq } = this.selectMaxSeq.get(noteId) as { max_seq: number };
    return max_seq;
  }

  /** The uniform ownership gate every version call passes through: a note id that is not this profile's does not exist, whatever table it sits in. */
  private requireOwnNote(noteId: string): void {
    const { n } = this.countOwnNote.get(noteId, this.profileId) as { n: number };
    if (n === 0) {
      throw new PrivateNoteNotFoundError(`No private note "${noteId}" in this profile.`);
    }
  }
}

function validateSealed(sealed: Uint8Array): void {
  if (!(sealed instanceof Uint8Array) || sealed.length === 0) {
    throw new PrivateNoteValidationError(`"sealed" must be a non-empty byte array.`);
  }
}

function validateDateTime(value: string): void {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new PrivateNoteValidationError(`"now" must be an ISO-8601 date-time.`);
  }
}
