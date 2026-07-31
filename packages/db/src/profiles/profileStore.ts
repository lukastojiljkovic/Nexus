import type Database from "better-sqlite3-multiple-ciphers";
import { isInlineImageMime } from "@nexus/core";
import { ProfileNotFoundError, ProfileValidationError } from "../errors.js";

type DatabaseHandle = Database.Database;

/** A plaintext sha256 exactly as the blob store names one: 64 lowercase hex characters. */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** One profile row (migration 001) with the picture trio migration 040 added. */
export interface ProfileRecord {
  id: string;
  kind: "personal" | "business";
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
  kind: "personal" | "business";
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
 * Naming and creating profiles stay in `main/index.ts` for now (`renameProfile`,
 * `seedFirstRunProfile`), and a restore writes the name and the picture together
 * through `RestoreStore` — this store's writes are the picture alone.
 */
export class ProfileStore {
  private readonly selectAll: Database.Statement;
  private readonly selectOne: Database.Statement;
  private readonly updatePicture: Database.Statement;
  private readonly countByHash: Database.Statement;
  private readonly selectMimeByHash: Database.Statement;

  constructor(db: DatabaseHandle) {
    const columns = `id, kind, name, created_at, picture_hash, picture_mime, picture_size_bytes`;
    this.selectAll = db.prepare(`SELECT ${columns} FROM profiles ORDER BY created_at, id`);
    this.selectOne = db.prepare(`SELECT ${columns} FROM profiles WHERE id = ?`);
    this.updatePicture = db.prepare(
      `UPDATE profiles
          SET picture_hash = ?, picture_mime = ?, picture_size_bytes = ?
        WHERE id = ?`,
    );
    this.countByHash = db.prepare(`SELECT count(*) AS n FROM profiles WHERE picture_hash = ?`);
    this.selectMimeByHash = db.prepare(
      `SELECT picture_mime AS mime FROM profiles WHERE picture_hash = ? LIMIT 1`,
    );
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
