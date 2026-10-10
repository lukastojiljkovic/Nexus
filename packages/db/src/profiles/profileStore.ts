import type Database from "better-sqlite3-multiple-ciphers";
import { isInlineImageMime } from "@nexus/core";
import {
  ProfileAnchorDeleteError,
  ProfileLastDeleteError,
  ProfileNotFoundError,
  ProfileValidationError,
} from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** A plaintext sha256 exactly as the blob store names one: 64 lowercase hex characters. */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** The `profiles.kind` CHECK's closed domain (migration 001) — the two kinds ADR-058 gives the top layer to. */
export const PROFILE_KINDS = ["personal", "business"] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];

/** Longest profile name after trimming — the `task_lists` bound, for its reason: a name is a label, not a body. Main's wire validator is narrower (80); the store is no narrower than a restore may legitimately carry. */
export const MAX_PROFILE_NAME_LENGTH = 100;

/** Accepts a full ISO-8601 date-time — the same shape every other store's `now` takes. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/** One profile row (migration 001) with the picture trio migration 040 added. */
export interface ProfileRecord {
  id: string;
  kind: ProfileKind;
  name: string;
  createdAt: string;
  /** The blob store's plaintext sha256 for this profile's picture, or null for "no picture". */
  pictureHash: string | null;
  /** The main-process-sniffed mime the `nx-blob:` protocol serves those bytes as; null exactly when `pictureHash` is. */
  pictureMime: string | null;
  /** The picture's byte length, carried for the archive's blob inventory; null exactly when `pictureHash` is. */
  pictureSizeBytes: number | null;
}

interface ProfileRow {
  id: string;
  kind: ProfileKind;
  name: string;
  created_at: string;
  picture_hash: string | null;
  picture_mime: string | null;
  picture_size_bytes: number | null;
}

function toRecord(row: ProfileRow): ProfileRecord {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    createdAt: row.created_at,
    pictureHash: row.picture_hash,
    pictureMime: row.picture_mime,
    pictureSizeBytes: row.picture_size_bytes,
  };
}

/**
 * The `profiles` table (migration 001) and the picture a profile may carry
 * (SET-001, migration 040), over prepared, parameterized statements
 * (SEC-API-03; every value is bound, never interpolated).
 *
 * The ONE store here that is not constructed per profile, and deliberately so:
 * `profiles` is not per-profile DATA, it IS the profile list — a store scoped to
 * one profile could not answer "which profiles exist", which is the first
 * question the shell asks. The `profile_id` scoping rule every other store
 * follows is still kept, in the only form this table can keep it: `profiles.id`
 * IS the profile id, and every write below binds it in its `WHERE`, so no
 * statement here can ever touch a profile it was not handed.
 *
 * This store owns the CHOICE of picture, never the bytes. The image is an
 * ordinary entry in main's content-addressed encrypted blob store
 * (`apps/desktop/src/main/attachments.ts`, ADR-014/019), so `refCount` and
 * `mimeForHash` exist here for exactly the reason their twins exist on
 * `DashboardSettingsStore`, and are profile-agnostic for exactly the same
 * reason: one hash is one file on disk across the whole database, so garbage
 * collection must count every reference regardless of which profile holds it,
 * and the `nx-blob:` serve gate only ever asks "is this hash something we
 * registered".
 *
 * Every write revalidates its input because the renderer is untrusted
 * (SEC-EL-02) — and here it never even sends the picture: main opens the file,
 * decodes it, re-encodes it and sniffs the result itself. The store still
 * checks, because a store is never the place that assumes its caller did.
 *
 * This store owns the profile ROW's whole lifecycle (ADR-058): `create` mints
 * one and `delete` hard-removes one, while renaming stays in `main/index.ts`
 * (`renameProfile`) and a restore writes the name and the picture together
 * through `RestoreStore`. What a fresh profile STARTS WITH — its Inbox, its
 * feature-flag rows — is deliberately NOT seeded here: that is product policy,
 * and main owns it (the `seedFirstRunProfile`/`ensureInbox` precedent).
 */
export class ProfileStore {
  private readonly selectAll: Database.Statement;
  private readonly selectOne: Database.Statement;
  private readonly countAll: Database.Statement;
  private readonly insertProfile: Database.Statement;
  private readonly updatePicture: Database.Statement;
  private readonly countByHash: Database.Statement;
  private readonly selectMimeByHash: Database.Statement;
  private readonly selectBlobHashes: Database.Statement;
  private readonly deleteSearchEntries: Database.Statement;
  private readonly deleteFlagRows: Database.Statement;
  private readonly deleteProfileRow: Database.Statement;

  constructor(private readonly db: DatabaseHandle) {
    const columns = `id, kind, name, created_at, picture_hash, picture_mime, picture_size_bytes`;
    this.selectAll = db.prepare(`SELECT ${columns} FROM profiles ORDER BY created_at, id`);
    this.selectOne = db.prepare(`SELECT ${columns} FROM profiles WHERE id = ?`);
    this.countAll = db.prepare(`SELECT count(*) AS n FROM profiles`);
    this.insertProfile = db.prepare(
      `INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)`,
    );
    this.updatePicture = db.prepare(
      `UPDATE profiles
          SET picture_hash = ?, picture_mime = ?, picture_size_bytes = ?
        WHERE id = ?`,
    );
    this.countByHash = db.prepare(`SELECT count(*) AS n FROM profiles WHERE picture_hash = ?`);
    this.selectMimeByHash = db.prepare(
      `SELECT picture_mime AS mime FROM profiles WHERE picture_hash = ? LIMIT 1`,
    );
    // The seven blob-naming tables, joined through their parents where the row
    // carries no `profile_id` of its own — the delete-side counterpart of
    // main's `blobRefCount` union (ADR-019/041/SET-001). UNION deduplicates.
    // Deliberately NO liveness filter on the parents: a soft-deleted task's
    // attachment row still holds its hash, and the cascade takes it too — and
    // the same holds for a soft-deleted VISIT's photos and for the tracks a
    // deleted listing was removed from (culture, migration 073).
    this.selectBlobHashes = db.prepare(
      `SELECT na.sha256 AS hash FROM note_attachments na
         JOIN notes n ON n.id = na.note_id WHERE n.profile_id = ?
       UNION
       SELECT ta.sha256 FROM task_attachments ta
         JOIN tasks t ON t.id = ta.task_id WHERE t.profile_id = ?
       UNION
       SELECT sa.sha256 FROM subject_attachments sa
         JOIN subjects s ON s.id = sa.subject_id WHERE s.profile_id = ?
       UNION
      SELECT vp.sha256 FROM culture_visit_photos vp
        JOIN culture_visits v ON v.id = vp.visit_id WHERE v.profile_id = ?
      UNION
      SELECT ct.sha256 FROM culture_tracks ct WHERE ct.profile_id = ?
      UNION
       SELECT background_hash FROM dashboard_settings
        WHERE profile_id = ? AND background_hash IS NOT NULL
       UNION
       SELECT picture_hash FROM profiles WHERE id = ? AND picture_hash IS NOT NULL`,
    );
    this.deleteSearchEntries = db.prepare(`DELETE FROM search_entries WHERE profile_id = ?`);
    this.deleteFlagRows = db.prepare(`DELETE FROM feature_flags WHERE profile_id = ?`);
    this.deleteProfileRow = db.prepare(`DELETE FROM profiles WHERE id = ?`);
  }

  /** Every profile, oldest first — the order the shell has always listed them in, with `id` breaking a tie between two created in the same millisecond. */
  list(): ProfileRecord[] {
    return (this.selectAll.all() as ProfileRow[]).map(toRecord);
  }

  /** One profile by id, or null when no row carries it. */
  get(id: string): ProfileRecord | null {
    const row = this.selectOne.get(id) as ProfileRow | undefined;
    return row === undefined ? null : toRecord(row);
  }

  /**
   * Creates a profile row (ADR-058) and returns it. `kind` is revalidated
   * against migration 001's CHECK domain and `name` is trimmed and capped —
   * the store revalidates because no caller is ever assumed to have (SEC-EL-02).
   *
   * The EMPTY name (after trimming) is stored verbatim, deliberately: "" is the
   * sentinel `seedFirstRunProfile` has always written for "not yet named", and
   * the shell reads it as the cue to route the profile through the ONB-lite
   * first-entry naming screen. Refusing it here would break that flow.
   *
   * The row is ALL this writes. The Inbox (`TaskListStore.ensureInbox`) and any
   * feature-flag rows are main's to seed — what a new profile starts with is
   * product policy, not schema.
   */
  create(kind: ProfileKind, name: string, now: string): ProfileRecord {
    const validKind = validateKind(kind);
    const validName = validateName(name);
    const validNow = validateDateTime(now);
    const id = uuidv7();
    this.insertProfile.run(id, validKind, validName, validNow);
    return this.require(id);
  }

  /**
   * HARD-deletes a profile and everything it owns, in one transaction (ADR-058).
   * Refused by named error for the account's anchor (`kind === "personal"`,
   * `ProfileAnchorDeleteError`) and for the last remaining profile
   * (`ProfileLastDeleteError`) — see each class's doc for why.
   *
   * Migration 001's `ON DELETE CASCADE` web takes the profile's data with the
   * row, verified table by table in this store's test. Two deletes stay
   * explicit, because cascade alone would not do them justice:
   *
   *  - `search_entries` (migration 017) DOES cascade, but its FTS shadow
   *    (`search_fts`) is maintained purely by AFTER DELETE triggers. Deleting
   *    the rows explicitly makes the shadow's cleanup a plain statement this
   *    build's tests pin, rather than a bet on trigger-on-cascade semantics —
   *    `RESTORE_WIPE_TABLES`' own "never lean on cascade to reach a row" rule.
   *  - `feature_flags` is the one profile-referencing table migration 001 gave
   *    no `ON DELETE CASCADE`; left alone it would block the delete on its FK.
   *
   * The blobs the profile's rows named are NOT touched here — the store never
   * owns bytes on disk. Main collects the hashes BEFORE calling this
   * (`blobHashes`) and runs its refcount-gated GC walk after, so a file another
   * profile still names survives. `now` is the caller's clock, validated as on
   * every mutation; a hard delete stamps nothing with it today.
   */
  delete(id: string, now: string): void {
    validateDateTime(now);
    this.db.transaction((): void => {
      const row = this.selectOne.get(id) as ProfileRow | undefined;
      if (row === undefined) {
        throw new ProfileNotFoundError(`No profile "${id}".`);
      }
      if (row.kind === "personal") {
        throw new ProfileAnchorDeleteError(`Profile "${id}" is the account's personal anchor.`);
      }
      const { n } = this.countAll.get() as { n: number };
      if (n <= 1) {
        throw new ProfileLastDeleteError(`Profile "${id}" is the last remaining profile.`);
      }
      this.deleteSearchEntries.run(id);
      this.deleteFlagRows.run(id);
      this.deleteProfileRow.run(id);
    })();
  }

  /**
   * Every blob hash this profile's rows name, deduplicated, across all seven
   * blob-naming tables — soft-deleted parents included, since their attachment
   * rows still hold bytes the cascade is about to take. Main reads this BEFORE
   * `delete` and then runs `deleteBlobIfOrphaned` per hash against the
   * post-delete `blobRefCount`, which is what keeps a deleted profile from
   * leaking files without ever deleting one some other profile still shows.
   *
   * **Culture's two sources are read here even though main's `blobRefCount`
   * does not yet count them** (stage 1 adds the tables, stage 2 wires the
   * module's page and its blob GC). That asymmetry is safe in one direction
   * only, which is the one this method is for: a hash that ONLY culture names
   * counts zero after the delete and its blob is collected, and a hash another
   * profile still names survives. The other direction — removing one photo
   * THROUGH main's GC — must not be wired up until `blobRefCount` knows these
   * tables, or a blob culture still holds could be collected as an orphan.
   */
  blobHashes(profileId: string): string[] {
    return (
      this.selectBlobHashes.all(
        profileId,
        profileId,
        profileId,
        profileId,
        profileId,
        profileId,
        profileId,
      ) as { hash: string }[]
    ).map((row) => row.hash);
  }

  /**
   * Points a profile at a picture already written to the blob store, leaving
   * its name alone.
   *
   * `mime` must be one `isInlineImageMime` allows — the one format rule the
   * whole app already applies to anything it renders inline. Main's own
   * pipeline always hands this `image/png` (it re-encodes, which is what strips
   * the original's metadata), and this store is deliberately no narrower than
   * the app's rule: an archive written by another build may legitimately name a
   * different one of the four, and refusing it here would make a restore fail
   * over a format the `nx-blob:` protocol serves happily.
   */
  setPicture(profileId: string, sha256: string, mime: string, sizeBytes: number): ProfileRecord {
    const hash = validateHash(sha256);
    const validMime = validateMime(mime);
    const size = validateSize(sizeBytes);
    const result = this.updatePicture.run(hash, validMime, size, profileId);
    if (result.changes === 0) {
      throw new ProfileNotFoundError(`No profile "${profileId}".`);
    }
    return this.require(profileId);
  }

  /**
   * Drops the picture, nulling the whole trio at once (migration 040's CHECKs
   * allow nothing else). Never touches the blob itself: whether the bytes are
   * now orphaned is main's question, answered through `refCount` AFTER this row
   * is written.
   */
  clearPicture(profileId: string): ProfileRecord {
    const result = this.updatePicture.run(null, null, null, profileId);
    if (result.changes === 0) {
      throw new ProfileNotFoundError(`No profile "${profileId}".`);
    }
    return this.require(profileId);
  }

  /** How many profiles name this hash as their picture — deliberately profile-agnostic; see the class doc comment. */
  refCount(sha256: string): number {
    const { n } = this.countByHash.get(sha256) as { n: number };
    return n;
  }

  /** The stored mime for a hash any profile names as its picture, or null — deliberately profile-agnostic; see the class doc comment. */
  mimeForHash(sha256: string): string | null {
    const row = this.selectMimeByHash.get(sha256) as { mime: string | null } | undefined;
    return row?.mime ?? null;
  }

  /** The row a write just touched. `changes` already proved it exists, so a miss here would be a bug, not a data case. */
  private require(profileId: string): ProfileRecord {
    const record = this.get(profileId);
    if (record === null) {
      throw new ProfileNotFoundError(`No profile "${profileId}".`);
    }
    return record;
  }
}

function validateHash(value: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new ProfileValidationError(`"sha256" must be 64 lowercase hexadecimal characters.`);
  }
  return value;
}

function validateKind(value: string): ProfileKind {
  for (const kind of PROFILE_KINDS) {
    if (kind === value) return kind;
  }
  throw new ProfileValidationError(`"${value}" is not a profile kind.`);
}

/** Trims, then allows either the EMPTY sentinel (see `create`) or 1..`MAX_PROFILE_NAME_LENGTH` characters. */
function validateName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > MAX_PROFILE_NAME_LENGTH) {
    throw new ProfileValidationError(
      `"name" must be at most ${MAX_PROFILE_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateDateTime(value: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new ProfileValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}

function validateMime(value: string): string {
  if (!isInlineImageMime(value)) {
    throw new ProfileValidationError(
      `"${value}" is not one of the inline image formats a profile picture may use.`,
    );
  }
  return value;
}

function validateSize(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ProfileValidationError(`"sizeBytes" must be a positive whole number.`);
  }
  return value;
}
