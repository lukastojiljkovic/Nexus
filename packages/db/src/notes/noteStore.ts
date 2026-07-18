import type Database from "better-sqlite3-multiple-ciphers";
import {
  NoteFolderNotFoundError,
  NoteNotFoundError,
  NoteValidationError,
  NoteVersionNotFoundError,
} from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** A note's metadata as the store returns it — never the document itself (that is `load`'s job). */
export interface NoteMeta {
  id: string;
  profileId: string;
  title: string;
  folderId: string | null;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One note's persisted Yjs state: the snapshot (if compacted yet) plus the updates past it, in seq order. */
export interface NoteDoc {
  title: string;
  snapshot: Uint8Array | null;
  updates: Uint8Array[];
}

/**
 * The compaction read: the current snapshot plus every pending update with
 * its seq, in seq order. `coveredSeq` (additive, ADR-015 / NOTE-008) is the
 * stored snapshot's own `covered_seq`, 0 when none is stored yet — how main's
 * explicit pre-restore checkpoint knows which seq to stamp when there are no
 * pending updates to merge.
 */
export interface NoteCompactionRead {
  snapshot: Uint8Array | null;
  coveredSeq: number;
  updates: { seq: number; bytes: Uint8Array }[];
}

/** One checkpoint's metadata — the browse list row; the blob itself is `loadVersion`'s job (ADR-015). */
export interface NoteVersionMeta {
  coveredSeq: number;
  title: string;
  createdAt: string;
}

interface NoteRow {
  id: string;
  profile_id: string;
  title: string;
  folder_id: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
}

interface SnapshotRow {
  snapshot: Buffer;
  covered_seq: number;
}

interface VersionMetaRow {
  covered_seq: number;
  title: string;
  created_at: string;
}

const COLUMNS = "id, profile_id, title, folder_id, pinned, created_at, updated_at";

/** The renderer batches updates below this; the store re-checks it because renderer input is untrusted (SEC-EL-02). */
export const MAX_NOTE_UPDATE_BYTES = 262_144;

/** The most outbound wiki-links `setOutboundLinks` accepts in one call (NOTE-004). */
export const MAX_NOTE_LINKS = 500;

/** Checkpoints kept per note; `captureVersion` prunes the oldest beyond this in the same transaction (ADR-015). */
export const MAX_NOTE_VERSIONS = 50;

const MAX_TITLE_LENGTH = 200;

/** Accepts a full ISO-8601 date-time (the `now` every mutating method takes). */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Yjs-note persistence for a single profile, over prepared, parameterized
 * statements (SEC-API-03; every value is bound, never interpolated). Mirrors
 * `PlanStore`/`FocusStore`: construct one per profile, reuse it; every method
 * that stamps a timestamp takes an explicit `now: string` — the store never
 * reads the clock itself. Inputs are revalidated here because the renderer is
 * untrusted (SEC-EL-02), and every `notes` statement is scoped by `profile_id`;
 * `note_updates`/`note_snapshots` rows are scoped through their note via
 * `requireActive` (the `document_renewals` pattern), so one profile's notes
 * and their child rows are invisible to a store scoped to another.
 *
 * This store is deliberately CRDT-agnostic (ADR-012): update and snapshot
 * blobs are opaque bytes with per-note ordering (`seq`, assigned here — never
 * by the renderer) and transactional guarantees. What the bytes *mean* — how
 * they merge into a document, what plaintext they derive — lives in
 * `mergeNoteState` (`@nexus/core`), called by the desktop main process's
 * compaction policy; the same pure-logic/storage seam IMEX uses.
 *
 * `setOutboundLinks`/`listBacklinks` (NOTE-004, migration 012) index the
 * wiki-links a note's document authors as link nodes carrying only a target
 * note's id: the renderer extracts that id set at flush time and reports it
 * here, the same trust model as the `title` `appendUpdate` already carries
 * (the renderer authors its own content). `note_links` is note-to-note, not a
 * new organizational entity, so it lives here rather than in `NoteOrgStore`.
 *
 * `captureVersion`/`listVersions`/`loadVersion`/`latestVersion` (NOTE-008,
 * migration 014, ADR-015) manage `note_versions` — immutable, pruned
 * checkpoints, a sibling of the mutable `note_snapshots` cache. The store
 * owns mechanism only (dedupe-by-PK insert, retention prune, scoped reads);
 * *when* to capture a checkpoint is `main/notes.ts`'s policy, the same
 * division of labour compaction already uses.
 */
export class NoteStore {
  private readonly insert: Database.Statement;
  private readonly selectActive: Database.Statement;
  private readonly selectActiveUnfiled: Database.Statement;
  private readonly selectActiveByFolder: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly insertUpdate: Database.Statement;
  private readonly updateMeta: Database.Statement;
  private readonly selectSnapshot: Database.Statement;
  private readonly selectUpdatesPastSeq: Database.Statement;
  private readonly countUpdatesPastSeq: Database.Statement;
  private readonly upsertSnapshot: Database.Statement;
  private readonly deleteCoveredUpdates: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;
  private readonly selectFolderInProfile: Database.Statement;
  private readonly updateFolderId: Database.Statement;
  private readonly updatePinned: Database.Statement;
  private readonly noteExistsInProfile: Database.Statement;
  private readonly deleteOutboundLinks: Database.Statement;
  private readonly insertLink: Database.Statement;
  private readonly selectBacklinks: Database.Statement;
  private readonly insertVersion: Database.Statement;
  private readonly pruneVersions: Database.Statement;
  private readonly selectVersions: Database.Statement;
  private readonly selectVersionSnapshot: Database.Statement;
  private readonly selectLatestVersion: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO notes (id, profile_id, title, created_at, updated_at, deleted_at)
       VALUES (?, ?, '', ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM notes
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY pinned DESC, updated_at DESC, id DESC`,
    );
    this.selectActiveUnfiled = db.prepare(
      `SELECT ${COLUMNS} FROM notes
       WHERE profile_id = ? AND deleted_at IS NULL AND folder_id IS NULL
       ORDER BY pinned DESC, updated_at DESC, id DESC`,
    );
    this.selectActiveByFolder = db.prepare(
      `SELECT ${COLUMNS} FROM notes
       WHERE profile_id = ? AND deleted_at IS NULL AND folder_id = ?
       ORDER BY pinned DESC, updated_at DESC, id DESC`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM notes
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // The store — never the renderer — assigns the per-note monotonic seq.
    // After a compaction has emptied the update log, MAX(seq) is NULL, so the
    // fallback to the snapshot's covered_seq keeps the next seq PAST the
    // covered window (a reused seq would be invisible to `load` forever).
    this.insertUpdate = db.prepare(
      `INSERT INTO note_updates (note_id, seq, update_blob, created_at)
       VALUES (?, COALESCE(
                    (SELECT MAX(seq) FROM note_updates WHERE note_id = ?),
                    (SELECT covered_seq FROM note_snapshots WHERE note_id = ?),
                    0) + 1, ?, ?)`,
    );
    this.updateMeta = db.prepare(
      `UPDATE notes SET title = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectSnapshot = db.prepare(
      `SELECT snapshot, covered_seq FROM note_snapshots WHERE note_id = ?`,
    );
    this.selectUpdatesPastSeq = db.prepare(
      `SELECT seq, update_blob FROM note_updates
       WHERE note_id = ? AND seq > ?
       ORDER BY seq`,
    );
    this.countUpdatesPastSeq = db.prepare(
      `SELECT count(*) AS n FROM note_updates WHERE note_id = ? AND seq > ?`,
    );
    this.upsertSnapshot = db.prepare(
      `INSERT INTO note_snapshots (note_id, snapshot, plaintext, covered_seq, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (note_id) DO UPDATE SET
         snapshot = excluded.snapshot,
         plaintext = excluded.plaintext,
         covered_seq = excluded.covered_seq,
         updated_at = excluded.updated_at`,
    );
    this.deleteCoveredUpdates = db.prepare(
      `DELETE FROM note_updates WHERE note_id = ? AND seq <= ?`,
    );
    this.markDeleted = db.prepare(
      `UPDATE notes SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE notes SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.selectFolderInProfile = db.prepare(
      `SELECT id FROM note_folders WHERE id = ? AND profile_id = ?`,
    );
    // Foldering/pinning are organizational (ADR-012 / NOTE-002), not content edits — neither
    // statement touches `updated_at`, unlike every write above it.
    this.updateFolderId = db.prepare(
      `UPDATE notes SET folder_id = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updatePinned = db.prepare(
      `UPDATE notes SET pinned = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // Deliberately NOT filtered by deleted_at: a link to a soft-deleted note
    // must survive so undo/restore heals it (see the migration's doc comment).
    this.noteExistsInProfile = db.prepare(
      `SELECT EXISTS (SELECT 1 FROM notes WHERE id = ? AND profile_id = ?) AS found`,
    );
    this.deleteOutboundLinks = db.prepare(`DELETE FROM note_links WHERE source_note_id = ?`);
    this.insertLink = db.prepare(
      `INSERT INTO note_links (source_note_id, target_note_id) VALUES (?, ?)`,
    );
    this.selectBacklinks = db.prepare(
      `SELECT ${COLUMNS} FROM notes
       JOIN note_links ON note_links.source_note_id = notes.id
       WHERE note_links.target_note_id = ? AND notes.profile_id = ? AND notes.deleted_at IS NULL
       ORDER BY pinned DESC, updated_at DESC, id DESC`,
    );
    // INSERT OR IGNORE is the ADR-015 dedupe guard: a second capture at a
    // covered_seq already checkpointed collapses to a no-op, keeping the
    // first row's title/created_at.
    this.insertVersion = db.prepare(
      `INSERT OR IGNORE INTO note_versions (note_id, covered_seq, snapshot, title, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.pruneVersions = db.prepare(
      `DELETE FROM note_versions WHERE note_id = ? AND covered_seq NOT IN (
         SELECT covered_seq FROM note_versions WHERE note_id = ? ORDER BY covered_seq DESC LIMIT ?
       )`,
    );
    this.selectVersions = db.prepare(
      `SELECT covered_seq, title, created_at FROM note_versions
       WHERE note_id = ? ORDER BY covered_seq DESC`,
    );
    this.selectVersionSnapshot = db.prepare(
      `SELECT snapshot FROM note_versions WHERE note_id = ? AND covered_seq = ?`,
    );
    this.selectLatestVersion = db.prepare(
      `SELECT covered_seq, title, created_at FROM note_versions
       WHERE note_id = ? ORDER BY covered_seq DESC LIMIT 1`,
    );
  }

  /** Inserts an empty, unfiled, unpinned note (title '', no document state yet) and returns its meta. */
  create(now: string): NoteMeta {
    const validNow = validateDateTime(now, "now");
    const id = uuidv7();
    this.insert.run(id, this.profileId, validNow, validNow);
    return {
      id,
      profileId: this.profileId,
      title: "",
      folderId: null,
      pinned: false,
      createdAt: validNow,
      updatedAt: validNow,
    };
  }

  /**
   * Active notes of this profile, pinned first, then newest `updatedAt` first
   * (id descending tiebreak). With no `filter`, every active note is returned;
   * `{ folderId: null }` narrows to unfiled notes, `{ folderId: <id> }` to one
   * folder's notes.
   */
  list(filter?: { folderId?: string | null }): NoteMeta[] {
    let rows: NoteRow[];
    if (filter === undefined || !("folderId" in filter)) {
      rows = this.selectActive.all(this.profileId) as NoteRow[];
    } else if (filter.folderId === null) {
      rows = this.selectActiveUnfiled.all(this.profileId) as NoteRow[];
    } else {
      rows = this.selectActiveByFolder.all(this.profileId, filter.folderId) as NoteRow[];
    }
    return rows.map(toNoteMeta);
  }

  /**
   * Appends one Yjs update to an active note's log and refreshes its
   * denormalized `title`/`updated_at` — one transaction, so the log and the
   * meta can never drift apart. The update must be 1..256 KB (re-checked here
   * even though main validates it too, SEC-EL-02); the title is trimmed, may
   * be empty, and caps at 200 characters. The per-note `seq` is assigned by
   * the store, never the caller.
   */
  appendUpdate(id: string, update: Uint8Array, title: string, now: string): void {
    const validNow = validateDateTime(now, "now");
    const validUpdate = validateUpdate(update);
    const validTitle = validateTitle(title);
    this.requireActive(id);

    this.db.transaction(() => {
      this.insertUpdate.run(id, id, id, Buffer.from(validUpdate), validNow);
      this.updateMeta.run(validTitle, validNow, id, this.profileId);
    })();
  }

  /**
   * One active note's persisted state: its title, the merged snapshot (or
   * null before the first compaction), and every update past the snapshot's
   * `covered_seq`, in seq order — exactly what the renderer replays onto a
   * fresh `Y.Doc`.
   */
  load(id: string): NoteDoc {
    const note = this.requireActive(id);
    const snapshotRow = this.selectSnapshot.get(id) as SnapshotRow | undefined;
    const coveredSeq = snapshotRow?.covered_seq ?? 0;
    const rows = this.selectUpdatesPastSeq.all(id, coveredSeq) as { update_blob: Buffer }[];
    return {
      title: note.title,
      snapshot: snapshotRow ? new Uint8Array(snapshotRow.snapshot) : null,
      updates: rows.map((row) => new Uint8Array(row.update_blob)),
    };
  }

  /** How many updates lie past the snapshot's `covered_seq` (the same window `load` replays) — the compaction trigger. */
  countPendingUpdates(id: string): number {
    this.requireActive(id);
    const snapshotRow = this.selectSnapshot.get(id) as SnapshotRow | undefined;
    const { n } = this.countUpdatesPastSeq.get(id, snapshotRow?.covered_seq ?? 0) as { n: number };
    return n;
  }

  /** The compaction read: the current snapshot plus every pending update with its seq — the caller merges, then calls `compact`. */
  readForCompaction(id: string): NoteCompactionRead {
    this.requireActive(id);
    const snapshotRow = this.selectSnapshot.get(id) as SnapshotRow | undefined;
    const rows = this.selectUpdatesPastSeq.all(id, snapshotRow?.covered_seq ?? 0) as {
      seq: number;
      update_blob: Buffer;
    }[];
    return {
      snapshot: snapshotRow ? new Uint8Array(snapshotRow.snapshot) : null,
      coveredSeq: snapshotRow?.covered_seq ?? 0,
      updates: rows.map((row) => ({ seq: row.seq, bytes: new Uint8Array(row.update_blob) })),
    };
  }

  /**
   * Persists a merged snapshot and drops the updates it covers — one
   * transaction, so a snapshot row can never exist without its covered
   * updates being gone, or the reverse. A `coveredSeq` below the stored
   * snapshot's would silently lose the newer snapshot's edits, so it is
   * rejected (an equal re-compact is an idempotent no-op-shaped upsert).
   */
  compact(id: string, snapshot: Uint8Array, plaintext: string, coveredSeq: number, now: string): void {
    const validNow = validateDateTime(now, "now");
    if (!Number.isInteger(coveredSeq) || coveredSeq < 0) {
      throw new NoteValidationError('"coveredSeq" must be a non-negative integer.');
    }
    this.requireActive(id);

    const existing = this.selectSnapshot.get(id) as SnapshotRow | undefined;
    if (existing && coveredSeq < existing.covered_seq) {
      throw new NoteValidationError(
        `coveredSeq ${coveredSeq} regresses below the stored snapshot's ${existing.covered_seq}.`,
      );
    }

    this.db.transaction(() => {
      this.upsertSnapshot.run(id, Buffer.from(snapshot), plaintext, coveredSeq, validNow);
      this.deleteCoveredUpdates.run(id, coveredSeq);
    })();
  }

  /** Soft-deletes an active note (reversible via `restore`; the update log and snapshot stay in place). */
  softDelete(id: string, now: string): void {
    const validNow = validateDateTime(now, "now");
    const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new NoteNotFoundError(`No active note "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted note (undo of a delete — exactly what soft-delete removed). */
  restore(id: string, now: string): void {
    const validNow = validateDateTime(now, "now");
    const { changes } = this.markRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new NoteNotFoundError(`No deleted note "${id}" to restore in this profile.`);
    }
  }

  /**
   * Files (or unfiles, with `null`) an active note into a folder of this
   * profile — organizational, so `updated_at` is left untouched.
   */
  setFolder(id: string, folderId: string | null): void {
    this.requireActive(id);
    if (folderId !== null) {
      const folder = this.selectFolderInProfile.get(folderId, this.profileId);
      if (!folder) {
        throw new NoteFolderNotFoundError(`No folder "${folderId}" in this profile.`);
      }
    }
    this.updateFolderId.run(folderId, id, this.profileId);
  }

  /** Pins or unpins an active note — organizational, so `updated_at` is left untouched. */
  setPinned(id: string, pinned: boolean): void {
    this.requireActive(id);
    this.updatePinned.run(pinned ? 1 : 0, id, this.profileId);
  }

  /**
   * Replaces an active note's full outbound wiki-link set in one transaction
   * (NOTE-004): the renderer reports the complete target-id set it extracted
   * from the document at flush time, and this call fully replaces whatever was
   * indexed before — never a merge. The input is deduped, the source's own id
   * is silently dropped (no self-links), and any id that does not resolve to a
   * note in this profile is silently dropped too; a soft-deleted target is
   * deliberately kept (its row still exists, just hidden — see the migration's
   * doc comment) so restoring it heals the link. Does not bump `updated_at`:
   * the content edit that produced the link set already did, via
   * `appendUpdate`.
   */
  setOutboundLinks(id: string, targetIds: readonly string[]): void {
    this.requireActive(id);
    if (targetIds.length > MAX_NOTE_LINKS) {
      throw new NoteValidationError(
        `A note may not carry more than ${MAX_NOTE_LINKS} outbound links.`,
      );
    }

    const resolved = [...new Set(targetIds)].filter(
      (targetId) =>
        targetId !== id &&
        (this.noteExistsInProfile.get(targetId, this.profileId) as { found: number }).found === 1,
    );

    this.db.transaction(() => {
      this.deleteOutboundLinks.run(id);
      for (const targetId of resolved) {
        this.insertLink.run(id, targetId);
      }
    })();
  }

  /**
   * Every active note of this profile that links TO `id` (NOTE-004) — the
   * reverse of `setOutboundLinks`, in the house list order (pinned first,
   * then newest `updatedAt`). A soft-deleted source is excluded, the same way
   * `list` excludes any other soft-deleted note.
   */
  listBacklinks(id: string): NoteMeta[] {
    this.requireActive(id);
    const rows = this.selectBacklinks.all(id, this.profileId) as NoteRow[];
    return rows.map(toNoteMeta);
  }

  /**
   * Checkpoints `snapshot` at `coveredSeq` (ADR-015 / NOTE-008): the note's
   * *current* title is captured with it (never a caller-supplied one — the
   * list label always matches what the note was called at that moment), the
   * PK dedupes a repeat capture of the same `coveredSeq` to a no-op, and the
   * retention window is enforced in the same transaction so the table never
   * drifts past `MAX_NOTE_VERSIONS` rows for this note. `snapshot` has no
   * upper size cap — a merged full state legitimately exceeds the 256 KB
   * per-update cap `appendUpdate` enforces.
   */
  captureVersion(id: string, snapshot: Uint8Array, coveredSeq: number, now: string): void {
    const validNow = validateDateTime(now, "now");
    const validSnapshot = validateVersionSnapshot(snapshot);
    if (!Number.isInteger(coveredSeq) || coveredSeq < 1) {
      throw new NoteValidationError('"coveredSeq" must be a positive integer.');
    }
    const note = this.requireActive(id);

    this.db.transaction(() => {
      this.insertVersion.run(id, coveredSeq, Buffer.from(validSnapshot), note.title, validNow);
      this.pruneVersions.run(id, id, MAX_NOTE_VERSIONS);
    })();
  }

  /** This note's checkpoints, newest `coveredSeq` first — metadata only, never the snapshot blob (ADR-015). */
  listVersions(id: string): NoteVersionMeta[] {
    this.requireActive(id);
    const rows = this.selectVersions.all(id) as VersionMetaRow[];
    return rows.map(toNoteVersionMeta);
  }

  /** One checkpoint's full snapshot bytes, or throws `NoteVersionNotFoundError` if `coveredSeq` was never captured (or has since been pruned). */
  loadVersion(id: string, coveredSeq: number): Uint8Array {
    this.requireActive(id);
    const row = this.selectVersionSnapshot.get(id, coveredSeq) as { snapshot: Buffer } | undefined;
    if (!row) {
      throw new NoteVersionNotFoundError(
        `No version at covered_seq ${coveredSeq} for note "${id}" in this profile.`,
      );
    }
    return new Uint8Array(row.snapshot);
  }

  /** The newest checkpoint's metadata, or null if none exists yet — main's age gate for the compaction-time capture policy (ADR-015). */
  latestVersion(id: string): NoteVersionMeta | null {
    this.requireActive(id);
    const row = this.selectLatestVersion.get(id) as VersionMetaRow | undefined;
    return row ? toNoteVersionMeta(row) : null;
  }

  /** Reads an active note in this profile or throws — the gate every update/snapshot access goes through. */
  private requireActive(id: string): NoteMeta {
    const row = this.selectActiveById.get(id, this.profileId) as NoteRow | undefined;
    if (!row) {
      throw new NoteNotFoundError(`No active note "${id}" in this profile.`);
    }
    return toNoteMeta(row);
  }
}

function toNoteMeta(row: NoteRow): NoteMeta {
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    folderId: row.folder_id,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toNoteVersionMeta(row: VersionMetaRow): NoteVersionMeta {
  return { coveredSeq: row.covered_seq, title: row.title, createdAt: row.created_at };
}

function validateUpdate(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new NoteValidationError("A note update must be a non-empty Uint8Array.");
  }
  if (value.byteLength > MAX_NOTE_UPDATE_BYTES) {
    throw new NoteValidationError(
      `A note update must not exceed ${MAX_NOTE_UPDATE_BYTES} bytes.`,
    );
  }
  return value;
}

/** Unlike `validateUpdate`, deliberately no upper bound (ADR-015): a merged full state may legitimately exceed the per-update cap. */
function validateVersionSnapshot(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new NoteValidationError("A note version snapshot must be a non-empty Uint8Array.");
  }
  return value;
}

function validateTitle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new NoteValidationError(
      `A note title must not exceed ${MAX_TITLE_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateDateTime(value: string, field: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new NoteValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}
