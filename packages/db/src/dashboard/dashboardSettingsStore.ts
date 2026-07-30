import type Database from "better-sqlite3-multiple-ciphers";
import { isInlineImageMime } from "@nexus/core";
import { DashboardSettingsValidationError } from "../errors.js";

type DatabaseHandle = Database.Database;

/**
 * The dim the scrim uses when the profile has never chosen one (migration 030's
 * column default, named once so the store, the settings row and the archive's
 * parser all read the same number).
 */
export const DEFAULT_BACKGROUND_DIM = 40;

/**
 * The largest dim the slider — and migration 030's CHECK — allow. 90 rather
 * than 100 deliberately: a scrim at full opacity is not a dimmed photograph,
 * it is no photograph, and offering that as a setting only invites the user to
 * wonder where their image went.
 */
export const MAX_BACKGROUND_DIM = 90;

/** A plaintext sha256 exactly as the blob store names one: 64 lowercase hex characters. */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Accepts a full ISO-8601 date-time — the same shape every other store's `now` takes. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/** This profile's resolved dashboard preferences (defaults already applied). */
export interface DashboardSettings {
  /** The blob store's plaintext sha256 for the chosen image, or null for "no background". */
  backgroundHash: string | null;
  /** The main-process-sniffed mime the `nx-blob:` protocol serves those bytes as; null exactly when `backgroundHash` is. */
  backgroundMime: string | null;
  /** The image's byte length, carried for the archive's blob inventory; null exactly when `backgroundHash` is. */
  backgroundSizeBytes: number | null;
  /** How much the scrim above the image dims it, 0..`MAX_BACKGROUND_DIM`. */
  backgroundDim: number;
}

interface SettingsRow {
  background_hash: string | null;
  background_mime: string | null;
  background_size_bytes: number | null;
  background_dim: number;
}

/**
 * The dashboard's per-profile background choice and dim (SET-006 / ADR-041),
 * over prepared, parameterized statements (SEC-API-03; every value is bound,
 * never interpolated). Constructed one per profile and reused, like every other
 * store here.
 *
 * `get` is a get-or-default read that never writes — the `ntf_settings`
 * arrangement (migration 009 / `NotificationStore.getSettings`): a profile that
 * has never opened this setting costs no row, and the defaults live in one
 * place rather than being seeded into every profile at creation.
 *
 * This store owns the CHOICE, never the bytes. The image is an ordinary entry
 * in main's content-addressed encrypted blob store
 * (`apps/desktop/src/main/attachments.ts`, ADR-014/019), so `refCount` and
 * `mimeForHash` exist here for exactly the reason their twins exist on
 * `NoteAttachmentStore`, and are profile-agnostic for exactly the same reason:
 * one hash is one file on disk across the whole database, so garbage collection
 * must count every reference regardless of which profile holds it, and the
 * `nx-blob:` serve gate only ever asks "is this hash something we registered".
 *
 * Every write revalidates its input because the renderer is untrusted
 * (SEC-EL-02) — main already sniffs the mime from the file's own bytes and caps
 * its size, and this store still checks, because a store is never the place
 * that assumes its caller did.
 */
export class DashboardSettingsStore {
  private readonly selectSettings: Database.Statement;
  private readonly upsertSettings: Database.Statement;
  private readonly countByHash: Database.Statement;
  private readonly selectMimeByHash: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectSettings = db.prepare(
      `SELECT background_hash, background_mime, background_size_bytes, background_dim
         FROM dashboard_settings
        WHERE profile_id = ?`,
    );
    this.upsertSettings = db.prepare(
      `INSERT INTO dashboard_settings
         (profile_id, background_hash, background_mime, background_size_bytes,
          background_dim, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET
         background_hash = excluded.background_hash,
         background_mime = excluded.background_mime,
         background_size_bytes = excluded.background_size_bytes,
         background_dim = excluded.background_dim,
         updated_at = excluded.updated_at`,
    );
    this.countByHash = db.prepare(
      `SELECT count(*) AS n FROM dashboard_settings WHERE background_hash = ?`,
    );
    this.selectMimeByHash = db.prepare(
      `SELECT background_mime AS mime FROM dashboard_settings WHERE background_hash = ? LIMIT 1`,
    );
  }

  /** This profile's resolved preferences: no background and dim 40 while the row is absent. Never writes. */
  get(): DashboardSettings {
    const row = this.selectSettings.get(this.profileId) as SettingsRow | undefined;
    if (row === undefined) {
      return {
        backgroundHash: null,
        backgroundMime: null,
        backgroundSizeBytes: null,
        backgroundDim: DEFAULT_BACKGROUND_DIM,
      };
    }
    return {
      backgroundHash: row.background_hash,
      backgroundMime: row.background_mime,
      backgroundSizeBytes: row.background_size_bytes,
      backgroundDim: row.background_dim,
    };
  }

  /**
   * Points this profile's dashboard at an image already written to the blob
   * store, keeping whatever dim the profile had chosen — replacing the picture
   * is not a reason to undo the user's separate decision about how far it
   * recedes behind the content.
   *
   * `mime` must be one `isInlineImageMime` allows: those four raster formats
   * are what Chromium decodes safely in its sandboxed renderer, and the one
   * format rule the whole app already applies to inline previews. Anything
   * else is refused by name rather than re-encoded — silently converting a
   * user's file is a bigger surprise than declining it.
   */
  setBackground(
    sha256: string,
    mime: string,
    sizeBytes: number,
    now: string,
  ): DashboardSettings {
    const validNow = validateDateTime(now);
    const hash = validateHash(sha256);
    const validMime = validateMime(mime);
    const size = validateSize(sizeBytes);
    const current = this.get();
    this.upsertSettings.run(
      this.profileId,
      hash,
      validMime,
      size,
      current.backgroundDim,
      validNow,
      validNow,
    );
    return {
      backgroundHash: hash,
      backgroundMime: validMime,
      backgroundSizeBytes: size,
      backgroundDim: current.backgroundDim,
    };
  }

  /**
   * Drops the image, keeping the dim — so a later pick lands on exactly the
   * look the profile last settled on. Never touches the blob itself: whether
   * the bytes are now orphaned is main's question, answered through `refCount`
   * AFTER this row is gone.
   */
  clearBackground(now: string): DashboardSettings {
    const validNow = validateDateTime(now);
    const current = this.get();
    this.upsertSettings.run(
      this.profileId,
      null,
      null,
      null,
      current.backgroundDim,
      validNow,
      validNow,
    );
    return {
      backgroundHash: null,
      backgroundMime: null,
      backgroundSizeBytes: null,
      backgroundDim: current.backgroundDim,
    };
  }

  /** Sets how far the scrim dims the image (0..`MAX_BACKGROUND_DIM`), leaving the chosen image alone. */
  setDim(dim: number, now: string): DashboardSettings {
    const validNow = validateDateTime(now);
    const validDim = validateDim(dim);
    const current = this.get();
    this.upsertSettings.run(
      this.profileId,
      current.backgroundHash,
      current.backgroundMime,
      current.backgroundSizeBytes,
      validDim,
      validNow,
      validNow,
    );
    return { ...current, backgroundDim: validDim };
  }

  /** How many profiles name this hash as their background — deliberately profile-agnostic; see the class doc comment. */
  refCount(sha256: string): number {
    const { n } = this.countByHash.get(sha256) as { n: number };
    return n;
  }

  /** The stored mime for a hash any profile names as its background, or null — deliberately profile-agnostic; see the class doc comment. */
  mimeForHash(sha256: string): string | null {
    const row = this.selectMimeByHash.get(sha256) as { mime: string | null } | undefined;
    return row?.mime ?? null;
  }
}

function validateDateTime(value: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new DashboardSettingsValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}

function validateHash(value: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new DashboardSettingsValidationError(
      `"sha256" must be 64 lowercase hexadecimal characters.`,
    );
  }
  return value;
}

function validateMime(value: string): string {
  if (!isInlineImageMime(value)) {
    throw new DashboardSettingsValidationError(
      `"${value}" is not one of the inline image formats a background may use.`,
    );
  }
  return value;
}

function validateSize(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new DashboardSettingsValidationError(`"sizeBytes" must be a positive whole number.`);
  }
  return value;
}

function validateDim(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_BACKGROUND_DIM) {
    throw new DashboardSettingsValidationError(
      `"dim" must be a whole number between 0 and ${MAX_BACKGROUND_DIM}.`,
    );
  }
  return value;
}
