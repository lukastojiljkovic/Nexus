import type Database from "better-sqlite3-multiple-ciphers";
import {
  MAX_ID_LENGTH,
  RECORDING_KINDS,
  RECORDING_MIME_TYPES,
  isRecordingMime,
  recordingKindForMime,
} from "@nexus/core";
import type { RecordingKind, RecordingMime } from "@nexus/core";
import { RecorderNotFoundError, RecorderValidationError } from "../errors.js";
import { isBareDate, isDateTime } from "../finance/money.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** Longest title a recording may carry. Empty is legal on purpose: the date-and-time default belongs to stage 2's copy. */
export const MAX_RECORDING_TITLE_LENGTH = 200;
export const MAX_RECORDING_NOTES_LENGTH = 2_000;
/** A sanity cap on a speech-to-text pass's output, not a product limit — a long recording's transcript is long. */
export const MAX_RECORDING_TRANSCRIPT_LENGTH = 40_000;
/** Tags are NAMES: a label, not a paragraph, and never listed twice. */
export const MAX_RECORDING_TAGS = 12;
export const MAX_RECORDING_TAG_LENGTH = 32;
/** A marker's label is something readable at the top of a scrub bar. */
export const MAX_RECORDING_LABEL_LENGTH = 80;
export const MAX_RECORDING_MARKERS = 500;

/**
 * The longest recording this store accepts, twelve hours. A SANITY cap rather
 * than a product limit — like `MAX_HABIT_COUNT`, it exists so an untrusted
 * caller's number lands in a bounded INTEGER column, not because anybody records
 * half a day.
 */
export const MAX_RECORDING_DURATION_MS = 43_200_000;

/**
 * The largest recording this store accepts: 512 MiB.
 *
 * **Why a bound far above an attachment's 50 MB, and why not more.** The blob
 * store holds a blob whole — `saveBlob` takes the plaintext as one `Uint8Array`,
 * encrypts it into one AES-256-GCM container, and `readBlob` decrypts it back
 * into one buffer — so writing a recording costs roughly twice its size in
 * resident memory in main, plus one more copy when the bytes cross IPC. Measured
 * on this machine (Node 24.19.0; the same primitives `main/attachments.ts`
 * drives, driven directly): 512 MiB costs 241 ms of SHA-256, 417 ms to encrypt,
 * 394 ms to decrypt, 276 ms for one structured clone, and a peak RSS delta of
 * about 1 048 MiB; 200 MiB costs about 550 MiB and 50 MiB about 202 MiB. Half a
 * gigabyte is the largest size that keeps that path comfortably inside a
 * desktop's memory, and it is hundreds of megabytes because a diary video is.
 *
 * Stage 2 DECIDED this, and refused: nothing here is segmented, so the capture
 * stops itself at the cap and stores what it has
 * (`renderer/CaptureSection.tsx`), which is the only end of that situation that
 * keeps the recording — and the page says how much room is left, from the bytes
 * this machine has really produced, so the number is visible long before the
 * stop.
 */
export const MAX_RECORDING_BYTES = 536_870_912;

/**
 * One recording's index row: what was captured, when, how big, and where its
 * bytes live. The bytes themselves are never here — they sit content-addressed
 * in the blob store every attachment uses (`apps/desktop/src/main/attachments.ts`,
 * ADR-019), and this row carries only the `sha256` that names them plus what a
 * list needs to draw: mime, size and duration.
 *
 * **Two days, deliberately.** `createdAt` is when the recording was made;
 * `diaryDate` is the calendar day it was FILED under, and the pair may differ
 * because a diary entry recorded at 23:50 belongs to tomorrow and one recorded
 * on the road belongs to the trip's day. `isDiary` and `diaryDate` are one fact:
 * the schema CHECKs them together (migration 077) and this store refuses half a
 * pair rather than repairing it.
 *
 * `transcript` stays empty until a later local speech-to-text feature fills it.
 * It is a field of the recording rather than a table because it is one document
 * per recording and nothing queries inside it yet.
 */
export interface Recording {
  id: string;
  profileId: string;
  kind: RecordingKind;
  /** Empty when the user gave none — the date-and-time default is stage 2's copy. */
  title: string;
  /** The ISO instant the recording was made; also its place in the list. */
  createdAt: string;
  durationMs: number;
  /** The mime the capture side actually produced — one of `RECORDING_MIME_TYPES`. */
  mime: RecordingMime;
  sizeBytes: number;
  /** Plaintext SHA-256 of the bytes in the blob store, lowercase hex. */
  sha256: string;
  /** Tag names, trimmed, de-duplicated, in the order the user gave them. */
  tags: string[];
  notes: string;
  isDiary: boolean;
  /** A bare `YYYY-MM-DD`, non-null exactly when `isDiary` is true. */
  diaryDate: string | null;
  transcript: string;
  updatedAt: string;
}

/**
 * A marker inside one recording: a millisecond offset and a short label, for
 * navigating a long one. Scoped THROUGH its recording, never by a `profile_id`
 * of its own (migration 077), so every statement touching one resolves the
 * recording in this store's profile first.
 */
export interface RecordingMarker {
  id: string;
  recordingId: string;
  /** Milliseconds from the recording's start, 0 … the recording's own `durationMs`. */
  atMs: number;
  label: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fields for a new recording. The bytes are NOT here: stage 2 writes them to the
 * blob store first (main sniffs the mime and hashes the plaintext, SEC-FILE-02)
 * and hands this store the `sha256` it got back, `note_attachments`'
 * arrangement.
 */
export interface CreateRecordingInput {
  kind: RecordingKind;
  /** Absent or blank means no title yet. */
  title?: string;
  mime: string;
  durationMs: number;
  sizeBytes: number;
  sha256: string;
  tags?: readonly string[];
  notes?: string;
  isDiary?: boolean;
  diaryDate?: string | null;
  transcript?: string;
}

/**
 * A partial patch of what a user can change about a recording that already
 * exists. An omitted key is left untouched; an explicit `null` on `diaryDate`
 * clears it.
 *
 * **The media is deliberately absent.** `kind`, `mime`, `durationMs`,
 * `sizeBytes` and `sha256` describe the recording itself rather than its labels:
 * re-encoding or trimming produces different bytes, which is a NEW recording,
 * and letting a patch rewrite the hash while the blob store still holds the old
 * bytes would leave a row pointing at nothing.
 */
export interface UpdateRecordingFields {
  title?: string;
  tags?: readonly string[];
  notes?: string;
  isDiary?: boolean;
  diaryDate?: string | null;
  transcript?: string;
}

export interface AddMarkerInput {
  atMs: number;
  label: string;
}

/** A marker patch. An omitted key is left untouched. */
export interface UpdateMarkerFields {
  atMs?: number;
  label?: string;
}

/** An exported recording: the row minus `profileId`, which the importing profile decides. */
export type ExportedRecording = Omit<Recording, "profileId">;

/**
 * The module's one preference: whether a capture waits a few seconds before it
 * starts, so a person can put the device down.
 *
 * A PROFILE fact rather than a device one, on the rule the kit's settings card
 * states: what a module archives travels in the profile's own archive, and
 * „Vrati na podrazumevano" belongs to the cards whose whole state is this
 * machine's (SET §5). `false` is what a profile with no row answers — a countdown
 * nobody asked for would be the app delaying a recording the user just asked for.
 */
export interface RecorderSettings {
  readonly countdown: boolean;
}

/**
 * The version `exportData` writes and `importData` is the only reader of.
 *
 * **2**, because stage 2 added the `settings` member: a new shape is a new
 * number, never a quiet reinterpretation (the same rule `parseExport` states
 * about its exact keys). Stage 1's payload never shipped, so nothing in the
 * world carries version 1 and this number costs nobody an archive.
 */
export const RECORDER_EXPORT_VERSION = 2;

/**
 * The recorder's slice of a profile archive: plain JSON, versioned, and METADATA
 * ONLY.
 *
 * **Why no bytes.** The profile archive carries every attachment's bytes as a
 * `blobs/<sha256>` binary entry resolved by main's blob reader, and a recording
 * travels the same way for the same reason — but the JSON this store produces is
 * the INDEX, exactly as `note_attachments`' rows are the index half of a note's
 * files. The module declares one binary entry per `sha256` through the kit's own
 * blob hook (ADR-108); this store never sees a byte. That split is what keeps
 * `packages/db` free of I/O and what makes the round trip testable without a
 * filesystem.
 *
 * Only LIVE recordings are exported, and only their markers: the profile
 * archive's own posture is that a soft delete is a local fact (the archive
 * carries no `deletedAt` at all), so a throw-away that has not been restored is
 * simply not in the archive.
 */
export interface RecorderExport {
  readonly version: typeof RECORDER_EXPORT_VERSION;
  readonly recordings: readonly ExportedRecording[];
  readonly markers: readonly RecordingMarker[];
  /** The module's one preference, which travels with the profile like every other settings row a module archives. */
  readonly settings: RecorderSettings;
}

/** What one import wrote, for the caller's own "Uvezeno N snimaka" line. */
export interface RecorderImportResult {
  readonly recordings: number;
  readonly markers: number;
}

interface RecordingRow {
  id: string;
  profile_id: string;
  kind: string;
  title: string;
  created_at: string;
  duration_ms: number;
  mime: string;
  size_bytes: number;
  sha256: string;
  tags: string;
  notes: string;
  is_diary: number;
  diary_date: string | null;
  transcript: string;
  updated_at: string;
}

interface MarkerRow {
  id: string;
  recording_id: string;
  at_ms: number;
  label: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, profile_id, kind, title, created_at, duration_ms, mime, size_bytes, sha256, " +
  "tags, notes, is_diary, diary_date, transcript, updated_at";

const MARKER_COLUMNS = "id, recording_id, at_ms, label, created_at, updated_at";

const MARKER_SELECT_COLUMNS = "m.id, m.recording_id, m.at_ms, m.label, m.created_at, m.updated_at";

/**
 * Recordings and their markers for a single profile, over prepared,
 * parameterized statements (SEC-API-03). Construct one per profile and reuse it.
 *
 * **Every recording statement is scoped by `profile_id`; every marker statement
 * is scoped through its recording.** `recording_markers` carries no `profile_id`
 * of its own (migration 077, the `habit_entries` arrangement), so each marker
 * method resolves its recording in THIS profile first and refuses when it cannot
 * — a marker write naming another profile's recording is a
 * `RecorderNotFoundError`, never a row.
 *
 * **Ordering is chronological, so no `Intl.Collator` appears here.** A recorder
 * has one natural order — newest first — and a title is a label rather than a
 * key; the reads that group by day live in `@nexus/core`
 * (`packages/core/src/recorder/recordingGroups.ts`), because which day an instant
 * falls on is a presentation question and stage 2's page owns it.
 *
 * **Deleting a recording does not delete its markers.** `softDelete` is an
 * UPDATE, so the markers stay exactly where they are and `restore` brings the
 * recording back with them; migration 077's CASCADE reaches them only on a HARD
 * delete, which is what a profile deletion is.
 *
 * `now` is supplied by the caller and validated here — main stamps the clock, the
 * renderer never does.
 */
export class RecorderStore {
  private readonly insertRecording: Database.Statement;
  private readonly selectActive: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly updateFields: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;
  private readonly selectExport: Database.Statement;
  private readonly selectExportMarkers: Database.Statement;
  private readonly deleteMarkersForProfile: Database.Statement;
  private readonly deleteRecordingsForProfile: Database.Statement;
  private readonly insertMarker: Database.Statement;
  private readonly selectMarkers: Database.Statement;
  private readonly selectMarker: Database.Statement;
  private readonly countMarkers: Database.Statement;
  private readonly updateMarkerFields: Database.Statement;
  private readonly deleteMarker: Database.Statement;
  private readonly countBySha: Database.Statement;
  private readonly mimeBySha: Database.Statement;
  private readonly selectSettings: Database.Statement;
  private readonly deleteSettingsForProfile: Database.Statement;
  private readonly upsertSettings: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertRecording = db.prepare(
      `INSERT INTO recordings
         (id, profile_id, kind, title, created_at, duration_ms, mime, size_bytes, sha256,
          tags, notes, is_diary, diary_date, transcript, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM recordings
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC`,
    );
    // The one gate every mutation and every marker write passes: live in THIS
    // profile. Deliberately not a "list the trash" read — nothing in the product
    // browses deleted recordings, and an undo reaches one by id.
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM recordings
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateFields = db.prepare(
      `UPDATE recordings
         SET title = ?, tags = ?, notes = ?, is_diary = ?, diary_date = ?, transcript = ?,
             updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE recordings SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE recordings SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.selectExport = db.prepare(
      `SELECT ${COLUMNS} FROM recordings
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`,
    );
    // One query for the whole export, joined to its recording's profile rather
    // than filtered on a column the marker table deliberately does not have.
    this.selectExportMarkers = db.prepare(
      `SELECT ${MARKER_SELECT_COLUMNS}
         FROM recording_markers m
         JOIN recordings r ON r.id = m.recording_id
        WHERE r.profile_id = ? AND r.deleted_at IS NULL
        ORDER BY m.recording_id, m.at_ms, m.id`,
    );
    // Children before parents, never leaning on the CASCADE — RESTORE_WIPE_TABLES'
    // own rule, and what lets the same statements run whatever
    // `PRAGMA foreign_keys` happens to be.
    this.deleteMarkersForProfile = db.prepare(
      `DELETE FROM recording_markers
        WHERE recording_id IN (SELECT id FROM recordings WHERE profile_id = ?)`,
    );
    this.deleteRecordingsForProfile = db.prepare(
      `DELETE FROM recordings WHERE profile_id = ?`,
    );
    this.insertMarker = db.prepare(
      `INSERT INTO recording_markers (id, recording_id, at_ms, label, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.selectMarkers = db.prepare(
      `SELECT ${MARKER_COLUMNS} FROM recording_markers
       WHERE recording_id = ? ORDER BY at_ms ASC, id ASC`,
    );
    this.selectMarker = db.prepare(
      `SELECT ${MARKER_COLUMNS} FROM recording_markers WHERE id = ? AND recording_id = ?`,
    );
    this.countMarkers = db.prepare(
      `SELECT count(*) AS n FROM recording_markers WHERE recording_id = ?`,
    );
    this.updateMarkerFields = db.prepare(
      `UPDATE recording_markers SET at_ms = ?, label = ?, updated_at = ?
       WHERE id = ? AND recording_id = ?`,
    );
    this.deleteMarker = db.prepare(
      `DELETE FROM recording_markers WHERE id = ? AND recording_id = ?`,
    );
    // The reverse lookups on `recordings_sha` (migration 077): which rows hold
    // a hash, and what to serve it as. DELIBERATELY profile-agnostic (no
    // `profile_id` in either query, unlike every other statement above): the
    // blob store is content-addressed across the WHOLE database, so two
    // recordings of byte-identical media in two profiles are one file on disk
    // and a count that saw one profile would be the same bug one profile
    // smaller (`NoteAttachmentStore`'s own rule, one module over).
    this.countBySha = db.prepare(`SELECT count(*) AS n FROM recordings WHERE sha256 = ?`);
    // One mime, deterministically: two rows sharing a hash were produced by
    // the same capture settings, and the id is a UUIDv7, so "the oldest row"
    // is a stable answer rather than whichever row SQLite happened to scan
    // first.
    this.mimeBySha = db.prepare(`SELECT mime FROM recordings WHERE sha256 = ? ORDER BY id LIMIT 1`);
    this.selectSettings = db.prepare(`SELECT countdown FROM recorder_settings WHERE profile_id = ?`);
    this.deleteSettingsForProfile = db.prepare(`DELETE FROM recorder_settings WHERE profile_id = ?`);
    this.upsertSettings = db.prepare(
      `INSERT INTO recorder_settings (profile_id, countdown) VALUES (?, ?)
       ON CONFLICT(profile_id) DO UPDATE SET countdown = excluded.countdown`,
    );
  }

  /** This profile's live recordings, newest first. */
  listActive(): Recording[] {
    const rows = this.selectActive.all(this.profileId) as RecordingRow[];
    return rows.map((row) => this.toRecording(row));
  }

  /** Inserts a recording and returns the stored row, its title/tags/text canonicalised. */
  create(input: CreateRecordingInput, now: string): Recording {
    const validNow = validateDateTime(now, "now");
    const resolved = resolveRecording({
      kind: input.kind,
      title: input.title ?? "",
      mime: input.mime,
      durationMs: input.durationMs,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      tags: input.tags ?? [],
      notes: input.notes ?? "",
      isDiary: input.isDiary ?? false,
      diaryDate: input.diaryDate ?? null,
      transcript: input.transcript ?? "",
    });
    const id = uuidv7();

    this.insertRecording.run(
      id, this.profileId, resolved.kind, resolved.title, validNow, resolved.durationMs,
      resolved.mime, resolved.sizeBytes, resolved.sha256, serializeTags(resolved.tags),
      resolved.notes, resolved.isDiary ? 1 : 0, resolved.diaryDate, resolved.transcript, validNow,
    );

    return { id, profileId: this.profileId, ...resolved, createdAt: validNow, updatedAt: validNow };
  }

  /**
   * Applies a partial patch to a live recording. The MEDIA fields are read from
   * the stored row rather than from `fields` — see `UpdateRecordingFields`.
   *
   * Clearing the diary means clearing its date: `{ isDiary: false }` alone is
   * REFUSED, because the stored date would be left on a recording that is no
   * longer a diary, and silently dropping it would be this store deciding what
   * the caller meant (migration 055's `unit`/`target` posture). The caller sends
   * `{ isDiary: false, diaryDate: null }`, which is the whole fact at once.
   */
  update(id: string, fields: UpdateRecordingFields, now: string): Recording {
    const validNow = validateDateTime(now, "now");
    const current = this.requireRecording(id);

    const resolved = resolveRecording({
      kind: current.kind,
      title: fields.title ?? current.title,
      mime: current.mime,
      durationMs: current.durationMs,
      sizeBytes: current.sizeBytes,
      sha256: current.sha256,
      tags: fields.tags ?? current.tags,
      notes: fields.notes ?? current.notes,
      isDiary: fields.isDiary ?? current.isDiary,
      diaryDate: "diaryDate" in fields ? (fields.diaryDate ?? null) : current.diaryDate,
      transcript: fields.transcript ?? current.transcript,
    });

    this.updateFields.run(
      resolved.title, serializeTags(resolved.tags), resolved.notes,
      resolved.isDiary ? 1 : 0, resolved.diaryDate, resolved.transcript, validNow,
      id, this.profileId,
    );
    return { ...current, ...resolved, updatedAt: validNow };
  }

  /** Soft-deletes a live recording (reversible via `restore`). Its markers are UNTOUCHED — see the class comment. */
  softDelete(id: string, now: string): void {
    const validNow = validateDateTime(now, "now");
    const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new RecorderNotFoundError(`No live recording "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted recording, with every marker it had. */
  restore(id: string, now: string): void {
    const validNow = validateDateTime(now, "now");
    const { changes } = this.markRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new RecorderNotFoundError(`No deleted recording "${id}" to restore in this profile.`);
    }
  }

  /**
   * How many recording rows reference this hash, across EVERY profile — what
   * `main/index.ts`'s `blobRefCount` sums before a blob is garbage-collected.
   *
   * A SOFT-DELETED recording still counts, and that is the point rather than an
   * oversight: `softDelete` is an UPDATE, `restore` brings the row back, and a
   * GC that ignored the trash would delete the bytes an undo is about to point
   * at again. Only a hard delete (a profile delete, which cascades) drops a
   * recording's reference.
   */
  refCount(sha256: string): number {
    const { n } = this.countBySha.get(sha256) as { n: number };
    return n;
  }

  /**
   * The mime `nx-blob:` must announce for this hash, or `null` when no
   * recording row anywhere names it — the serve gate, exactly as
   * `NoteAttachmentStore.mimeForHash` is for attachments. What it announces is
   * the mime `MediaRecorder` reported for the bytes (one of the four in
   * `@nexus/core`'s closed list, which migration 077 CHECKs), never a mime
   * sniffed from a container this store cannot parse.
   */
  mimeForHash(sha256: string): string | null {
    const row = this.mimeBySha.get(sha256) as { mime: string } | undefined;
    return row?.mime ?? null;
  }

  /** This profile's preference, or the store's own default when it has no row — `TimersStore.settings`' arrangement one module over. */
  settings(): RecorderSettings {
    const row = this.selectSettings.get(this.profileId) as { countdown: number } | undefined;
    return { countdown: row?.countdown === 1 };
  }

  /** Writes the module's one preference, replacing whatever stood there. */
  setCountdown(countdown: boolean, now: string): RecorderSettings {
    // The timestamp is validated even though no column holds it: the caller's
    // clock is the same one `create` takes, and a store that accepted an
    // unreadable instant here would be the one place in this module where a
    // caller's clock went unchecked.
    validateDateTime(now, "now");
    this.upsertSettings.run(this.profileId, countdown ? 1 : 0);
    return { countdown };
  }

  /**
   * The settings the archive carries, written as a REPLACEMENT: an archive that
   * carries none (`null`) deletes the row, so the profile answers the store's own
   * default rather than a value restated by the importer.
   */
  replaceFromArchive(settings: RecorderSettings | null): RecorderSettings {
    this.deleteSettingsForProfile.run(this.profileId);
    if (settings === null) return { countdown: false };
    this.upsertSettings.run(this.profileId, settings.countdown ? 1 : 0);
    return { countdown: settings.countdown };
  }

  /** One live recording's markers, oldest first. */
  listMarkers(recordingId: string): RecordingMarker[] {
    this.requireRecording(recordingId);
    const rows = this.selectMarkers.all(recordingId) as MarkerRow[];
    return rows.map(toMarker);
  }

  /**
   * Adds a marker inside a live recording. `atMs` is validated against the
   * recording's OWN duration, a rule no SQLite CHECK can express because the
   * parent column is in another table (migration 077 says so out loud).
   */
  addMarker(recordingId: string, input: AddMarkerInput, now: string): RecordingMarker {
    const validNow = validateDateTime(now, "now");
    const recording = this.requireRecording(recordingId);
    const marker = resolveMarker(input, recording.durationMs);
    const { n } = this.countMarkers.get(recordingId) as { n: number };
    if (n >= MAX_RECORDING_MARKERS) {
      throw new RecorderValidationError(
        `A recording may carry at most ${MAX_RECORDING_MARKERS} markers.`,
      );
    }

    const id = uuidv7();
    this.insertMarker.run(id, recordingId, marker.atMs, marker.label, validNow, validNow);
    return { id, recordingId, ...marker, createdAt: validNow, updatedAt: validNow };
  }

  /** Moves and/or relabels a marker, re-validating the offset against the recording's duration. */
  updateMarker(
    recordingId: string,
    markerId: string,
    fields: UpdateMarkerFields,
    now: string,
  ): RecordingMarker {
    const validNow = validateDateTime(now, "now");
    const recording = this.requireRecording(recordingId);
    const current = this.requireMarker(recordingId, markerId);
    const marker = resolveMarker(
      { atMs: fields.atMs ?? current.atMs, label: fields.label ?? current.label },
      recording.durationMs,
    );

    this.updateMarkerFields.run(marker.atMs, marker.label, validNow, markerId, recordingId);
    return { ...current, ...marker, updatedAt: validNow };
  }

  /**
   * Removes one marker and returns it. An id that names no marker of THIS
   * recording — unknown entirely, or a real marker of another recording — is a
   * `RecorderNotFoundError`, so a cross-recording id never reaches a row.
   */
  removeMarker(recordingId: string, markerId: string): RecordingMarker {
    this.requireRecording(recordingId);
    const current = this.requireMarker(recordingId, markerId);
    this.deleteMarker.run(markerId, recordingId);
    return current;
  }

  /**
   * This profile's recorder data as one versioned, plain-JSON value: live
   * recordings, their markers and the module's one preference — metadata only
   * (see `RecorderExport`).
   *
   * **The bytes travel beside this value, and not through it.** A recording's
   * `sha256` reaches the archive's `blobs/` union through the module's own blob
   * hook (ADR-108, `ctx.blobs` in the module's `main/register.ts`), which reads
   * the hashes off this same value and hands them to main; the restore writes the
   * bytes back before the module's `apply` writes the rows that name them. So
   * this store still produces metadata only — no byte ever reaches
   * `packages/db` — and the section needs no blob field of its own.
   */
  exportData(): RecorderExport {
    const recordings = (this.selectExport.all(this.profileId) as RecordingRow[]).map((row) =>
      toExportedRecording(this.toRecording(row)),
    );
    const markers = (this.selectExportMarkers.all(this.profileId) as MarkerRow[]).map(toMarker);
    return { version: RECORDER_EXPORT_VERSION, recordings, markers, settings: this.settings() };
  }

  /**
   * Writes an exported value into THIS profile, replacing everything the profile
   * had. The whole value is validated first and nothing is written until that
   * pass has succeeded, so a refusal leaves the profile exactly as it was; an
   * unknown version is refused before any other field is read.
   *
   * A marker is checked against the recording it NAMES inside the same value —
   * existence and duration both — because an archive is a file a user picked, and
   * a marker hanging off a recording the archive does not carry (or pointing past
   * the end of one it does) is a corrupt archive rather than a row to write.
   *
   * The write itself is one transaction: this profile's markers, then its
   * recordings, then the value's recordings, then the value's markers — children
   * before parents in both directions, so nothing leans on `ON DELETE CASCADE`.
   */
  importData(value: unknown): RecorderImportResult {
    const parsed = parseExport(value);

    this.db.transaction(() => {
      this.deleteMarkersForProfile.run(this.profileId);
      this.deleteRecordingsForProfile.run(this.profileId);
      // The preference is replaced too, and NOT by leaning on the recording
      // wipe: it lives in its own table, so an archive that carries recordings
      // but says nothing about settings must still land in a known state.
      this.replaceFromArchive(parsed.settings);
      for (const row of parsed.recordings) {
        this.insertRecording.run(
          row.id, this.profileId, row.kind, row.title, row.createdAt, row.durationMs, row.mime,
          row.sizeBytes, row.sha256, serializeTags(row.tags), row.notes, row.isDiary ? 1 : 0,
          row.diaryDate, row.transcript, row.updatedAt,
        );
      }
      for (const marker of parsed.markers) {
        this.insertMarker.run(
          marker.id, marker.recordingId, marker.atMs, marker.label,
          marker.createdAt, marker.updatedAt,
        );
      }
    })();

    return { recordings: parsed.recordings.length, markers: parsed.markers.length };
  }

  /** Reads a live recording in this profile or throws — the scope check every marker statement runs first. */
  private requireRecording(id: string): Recording {
    const row = this.selectActiveById.get(id, this.profileId) as RecordingRow | undefined;
    if (!row) {
      throw new RecorderNotFoundError(`No live recording "${id}" in this profile.`);
    }
    return this.toRecording(row);
  }

  private requireMarker(recordingId: string, markerId: string): RecordingMarker {
    const row = this.selectMarker.get(markerId, recordingId) as MarkerRow | undefined;
    if (!row) {
      throw new RecorderNotFoundError(`No marker "${markerId}" on recording "${recordingId}".`);
    }
    return toMarker(row);
  }

  private toRecording(row: RecordingRow): Recording {
    return {
      id: row.id,
      profileId: row.profile_id,
      kind: row.kind as RecordingKind,
      title: row.title,
      createdAt: row.created_at,
      durationMs: row.duration_ms,
      mime: row.mime as RecordingMime,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      tags: parseStoredTags(row.tags, row.id),
      notes: row.notes,
      isDiary: row.is_diary === 1,
      diaryDate: row.diary_date,
      transcript: row.transcript,
      updatedAt: row.updated_at,
    };
  }
}

/** A recording's own fields, minus the ones the row rather than the caller decides. */
type ResolvedRecording = Omit<Recording, "id" | "profileId" | "createdAt" | "updatedAt">;

/**
 * Reads a whole archive value into the payload `importData` writes, and writes
 * nothing itself.
 *
 * **Why this is exported rather than reached through a store.** The module kit
 * runs an import in two moments with two promises (`ModuleImport`): `parse` at
 * the PREVIEW, so a refusal reaches the user before they confirm a restore that
 * replaces their profile, and again at apply time before anything is written.
 * Both halves have to be the SAME validation, or an archive the preview cleared
 * could still fail half-written: so the pure half is this function, and
 * `importData` calls it rather than the other way round. A caller that wants to
 * read an archive with no profile database in hand (a preview, a test) has
 * exactly one door, and it is this one.
 */
export function parseRecorderExport(value: unknown): RecorderExport {
  const parsed = parseExport(value);
  return {
    version: RECORDER_EXPORT_VERSION,
    recordings: parsed.recordings,
    markers: parsed.markers,
    settings: parsed.settings,
  };
}

/**
 * Validates and resolves a whole recording's fields — the ONE place every refusal
 * lives, so `create`, `update` and `importData` cannot drift on what a recording
 * is allowed to be. The scheme checks (`kind`, `mime`, and the two agreeing) run
 * before the values, so a row of the wrong shape is refused for that rather than
 * for whichever number happened to be read first.
 */
function resolveRecording(fields: {
  kind: string;
  title: string;
  mime: string;
  durationMs: number;
  sizeBytes: number;
  sha256: string;
  tags: unknown;
  notes: string;
  isDiary: boolean;
  diaryDate: string | null;
  transcript: string;
}): ResolvedRecording {
  const kind = validateKind(fields.kind);
  const mime = validateMime(fields.mime);
  if (recordingKindForMime(mime) !== kind) {
    throw new RecorderValidationError(`"mime" ${mime} is not a ${kind} container.`);
  }
  return {
    kind,
    mime,
    title: validateTitle(fields.title),
    durationMs: validateDuration(fields.durationMs),
    sizeBytes: validateSizeBytes(fields.sizeBytes),
    sha256: validateSha256(fields.sha256),
    tags: validateTags(fields.tags),
    notes: validateNotes(fields.notes),
    transcript: validateTranscript(fields.transcript),
    ...resolveDiary(fields.isDiary, fields.diaryDate),
  };
}

function validateKind(value: string): RecordingKind {
  if (!(RECORDING_KINDS as readonly string[]).includes(value)) {
    throw new RecorderValidationError(`"kind" must be one of: ${RECORDING_KINDS.join(", ")}.`);
  }
  return value as RecordingKind;
}

/** The closed list `@nexus/core` declares and migration 077 CHECKs — one list, three enforcers. */
function validateMime(value: string): RecordingMime {
  if (!isRecordingMime(value)) {
    throw new RecorderValidationError(
      `"mime" must be one of: ${RECORDING_MIME_TYPES.join(", ")}.`,
    );
  }
  return value;
}

/**
 * The diary flag and its date, refused as half a pair rather than repaired:
 * clearing a date while keeping the flag (or the reverse) is an edit the caller
 * got wrong, and silently completing it would be this store deciding what they
 * meant.
 */
function resolveDiary(
  isDiary: boolean,
  diaryDate: string | null,
): { isDiary: boolean; diaryDate: string | null } {
  if (isDiary) {
    if (diaryDate === null || !isBareDate(diaryDate)) {
      throw new RecorderValidationError(
        '"diaryDate" must be a real calendar day (YYYY-MM-DD) on a diary entry.',
      );
    }
    return { isDiary: true, diaryDate };
  }
  if (diaryDate !== null) {
    throw new RecorderValidationError(
      '"diaryDate" is set on a recording that is not a diary entry — pass null to clear it.',
    );
  }
  return { isDiary: false, diaryDate: null };
}

/** Trimmed, empty allowed, bounded — the date-and-time default title is stage 2's. */
function validateTitle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > MAX_RECORDING_TITLE_LENGTH) {
    throw new RecorderValidationError(
      `"title" must be at most ${MAX_RECORDING_TITLE_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/**
 * Tag NAMES, on `validateTagNames`' terms in the TASK module: trimmed, non-empty,
 * within `MAX_RECORDING_TAG_LENGTH`, de-duplicated AFTER trimming because two
 * identical tags are one label, and capped in count. Takes `unknown` because the
 * import path hands it whatever the archive file held.
 */
function validateTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new RecorderValidationError('"tags" must be an array of names.');
  }
  if (value.length > MAX_RECORDING_TAGS) {
    throw new RecorderValidationError(
      `A recording may carry at most ${MAX_RECORDING_TAGS} tags (got ${value.length}).`,
    );
  }
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new RecorderValidationError('"tags" must hold strings.');
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      throw new RecorderValidationError('"tags" must not hold an empty name.');
    }
    if (trimmed.length > MAX_RECORDING_TAG_LENGTH) {
      throw new RecorderValidationError(
        `A tag must be at most ${MAX_RECORDING_TAG_LENGTH} characters after trimming.`,
      );
    }
    if (!tags.includes(trimmed)) tags.push(trimmed);
  }
  return tags;
}

function validateNotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > MAX_RECORDING_NOTES_LENGTH) {
    throw new RecorderValidationError(
      `"notes" must be at most ${MAX_RECORDING_NOTES_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateTranscript(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > MAX_RECORDING_TRANSCRIPT_LENGTH) {
    throw new RecorderValidationError(
      `"transcript" must be at most ${MAX_RECORDING_TRANSCRIPT_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/** A whole positive duration within the cap — never a float, and never zero: a recording nobody heard is not a recording. */
function validateDuration(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_RECORDING_DURATION_MS) {
    throw new RecorderValidationError(
      `"durationMs" must be a whole number of milliseconds between 1 and ${MAX_RECORDING_DURATION_MS}.`,
    );
  }
  return value;
}

/** A whole positive byte count within `MAX_RECORDING_BYTES`; see that constant for why the cap is where it is. */
function validateSizeBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_RECORDING_BYTES) {
    throw new RecorderValidationError(
      `"sizeBytes" must be a positive whole number of at most ${MAX_RECORDING_BYTES} bytes.`,
    );
  }
  return value;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function validateSha256(value: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new RecorderValidationError('"sha256" must be a 64-character lowercase hex string.');
  }
  return value;
}

/**
 * A marker's own fields, held to its recording's duration. `atMs` may be 0 (the
 * very start) and may equal the duration (the very end) — both are points inside
 * the recording, and refusing the end would make one legitimate marker
 * unrepresentable.
 */
function resolveMarker(
  fields: { atMs: number; label: string },
  durationMs: number,
): { atMs: number; label: string } {
  if (!Number.isSafeInteger(fields.atMs) || fields.atMs < 0 || fields.atMs > durationMs) {
    throw new RecorderValidationError(
      `"atMs" must be a whole millisecond between 0 and the recording's ${durationMs} ms.`,
    );
  }
  const label = fields.label.trim();
  if (label.length === 0 || label.length > MAX_RECORDING_LABEL_LENGTH) {
    throw new RecorderValidationError(
      `"label" must be 1-${MAX_RECORDING_LABEL_LENGTH} characters after trimming.`,
    );
  }
  return { atMs: fields.atMs, label };
}

/**
 * Reads the stored column back. This store writes only `serializeTags` output, so
 * anything that fails to validate is corruption (a hand-edited file, a bad
 * restore) rather than input to be coerced — reading it as `[]` would silently
 * drop the labels a user chose, so it throws naming the row
 * (`HabitStore.parseStoredSchedule`'s posture).
 */
function parseStoredTags(text: string, id: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  try {
    return validateTags(parsed);
  } catch {
    throw new RecorderValidationError(`Recording "${id}" carries stored tags that are not valid.`);
  }
}

function serializeTags(tags: readonly string[]): string {
  return JSON.stringify(tags);
}

function validateDateTime(value: string, field: string): string {
  if (!isDateTime(value)) {
    throw new RecorderValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}

function toMarker(row: MarkerRow): RecordingMarker {
  return {
    id: row.id,
    recordingId: row.recording_id,
    atMs: row.at_ms,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The row as the archive carries it: everything but the profile, which the importing profile decides. */
function toExportedRecording(recording: Recording): ExportedRecording {
  return {
    id: recording.id,
    kind: recording.kind,
    title: recording.title,
    createdAt: recording.createdAt,
    durationMs: recording.durationMs,
    mime: recording.mime,
    sizeBytes: recording.sizeBytes,
    sha256: recording.sha256,
    tags: recording.tags,
    notes: recording.notes,
    isDiary: recording.isDiary,
    diaryDate: recording.diaryDate,
    transcript: recording.transcript,
    updatedAt: recording.updatedAt,
  };
}

const EXPORT_KEYS = ["version", "recordings", "markers", "settings"] as const;

const EXPORT_SETTINGS_KEYS = ["countdown"] as const;

const EXPORTED_RECORDING_KEYS = [
  "id",
  "kind",
  "title",
  "createdAt",
  "durationMs",
  "mime",
  "sizeBytes",
  "sha256",
  "tags",
  "notes",
  "isDiary",
  "diaryDate",
  "transcript",
  "updatedAt",
] as const;

const EXPORTED_MARKER_KEYS = [
  "id",
  "recordingId",
  "atMs",
  "label",
  "createdAt",
  "updatedAt",
] as const;

/**
 * Validates a whole imported value into rows, writing nothing. Every shape, enum,
 * range and length goes through the same resolvers `create` and `update` use, so
 * an archive cannot introduce a row this store would have refused from the
 * renderer; on top of that this pass owns the two rules only a whole-value read
 * can see — identifiers are bounded and unique, and a marker's `recordingId`
 * resolves inside the value with its offset inside that recording's duration.
 *
 * Keys are EXACTLY the ones `exportData` writes (`validateFocusConfig`'s rule):
 * an unknown key means the value was not produced by this module, and ignoring it
 * would let a renamed field go on being read as its own default.
 */
function parseExport(value: unknown): {
  recordings: ExportedRecording[];
  markers: RecordingMarker[];
  settings: RecorderSettings;
} {
  const root = asRecord(value, "the recorder archive");
  if (root.version !== RECORDER_EXPORT_VERSION) {
    throw new RecorderValidationError(
      `The recorder archive version must be ${RECORDER_EXPORT_VERSION}, got ${JSON.stringify(root.version)}.`,
    );
  }
  requireExactKeys(root, EXPORT_KEYS, "the recorder archive");

  const recordings = asList(root.recordings, "recordings").map((row, index) =>
    parseExportedRecording(row, `recordings[${index}]`),
  );
  const markers = asList(root.markers, "markers").map((row, index) =>
    parseExportedMarker(row, `markers[${index}]`),
  );
  const settingsRow = asRecord(root.settings, "settings");
  requireExactKeys(settingsRow, EXPORT_SETTINGS_KEYS, "settings");
  const countdown = settingsRow.countdown;
  if (typeof countdown !== "boolean") {
    throw new RecorderValidationError('"settings.countdown" must be a boolean.');
  }

  const recordingsById = uniqueById(recordings, "The archive's recordings");
  uniqueById(markers, "The archive's markers");
  for (const marker of markers) {
    const recording = recordingsById.get(marker.recordingId);
    if (recording === undefined) {
      throw new RecorderValidationError(
        `Marker "${marker.id}" names recording "${marker.recordingId}", which the archive does not carry.`,
      );
    }
    if (marker.atMs > recording.durationMs) {
      throw new RecorderValidationError(
        `Marker "${marker.id}" sits at ${marker.atMs} ms, past its recording's ${recording.durationMs} ms.`,
      );
    }
  }

  return { recordings, markers, settings: { countdown } };
}

function parseExportedRecording(value: unknown, where: string): ExportedRecording {
  const row = asRecord(value, where);
  requireExactKeys(row, EXPORTED_RECORDING_KEYS, where);
  const resolved = resolveRecording({
    kind: asString(row.kind, `${where}.kind`),
    title: asString(row.title, `${where}.title`),
    mime: asString(row.mime, `${where}.mime`),
    durationMs: asNumber(row.durationMs, `${where}.durationMs`),
    sizeBytes: asNumber(row.sizeBytes, `${where}.sizeBytes`),
    sha256: asString(row.sha256, `${where}.sha256`),
    tags: asList(row.tags, `${where}.tags`).map((tag, index) =>
      asString(tag, `${where}.tags[${index}]`),
    ),
    notes: asString(row.notes, `${where}.notes`),
    isDiary: asBoolean(row.isDiary, `${where}.isDiary`),
    diaryDate: row.diaryDate === null ? null : asString(row.diaryDate, `${where}.diaryDate`),
    transcript: asString(row.transcript, `${where}.transcript`),
  });
  return {
    id: asId(row.id, `${where}.id`),
    createdAt: asDateTime(row.createdAt, `${where}.createdAt`),
    updatedAt: asDateTime(row.updatedAt, `${where}.updatedAt`),
    ...resolved,
  };
}

function parseExportedMarker(value: unknown, where: string): RecordingMarker {
  const row = asRecord(value, where);
  requireExactKeys(row, EXPORTED_MARKER_KEYS, where);
  // The upper bound here is permissive on purpose: a marker's real ceiling is its
  // own recording's duration, and only `parseExport` has the recordings in hand
  // to check it. What this pass proves is that the offset is a whole,
  // non-negative millisecond.
  const marker = resolveMarker(
    { atMs: asNumber(row.atMs, `${where}.atMs`), label: asString(row.label, `${where}.label`) },
    Number.MAX_SAFE_INTEGER,
  );
  return {
    id: asId(row.id, `${where}.id`),
    recordingId: asId(row.recordingId, `${where}.recordingId`),
    ...marker,
    createdAt: asDateTime(row.createdAt, `${where}.createdAt`),
    updatedAt: asDateTime(row.updatedAt, `${where}.updatedAt`),
  };
}

/**
 * An identifier from an archive: non-empty and bounded by `MAX_ID_LENGTH`, the
 * one bound every id in this product lives under (`@nexus/core`'s `ids.ts`).
 * Nothing downstream bounds an id — a store writes through prepared statements
 * and no migration CHECKs one past `NOT NULL` — so the archive reader is the only
 * place it can be refused.
 */
function asId(value: unknown, where: string): string {
  const id = asString(value, where);
  if (id.length === 0 || id.length > MAX_ID_LENGTH) {
    throw new RecorderValidationError(
      `${where} must be a non-empty identifier of at most ${MAX_ID_LENGTH} characters.`,
    );
  }
  return id;
}

function asDateTime(value: unknown, where: string): string {
  const text = asString(value, where);
  if (!isDateTime(text)) {
    throw new RecorderValidationError(`${where} must be an ISO-8601 date-time.`);
  }
  return text;
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RecorderValidationError(`${where} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  row: Record<string, unknown>,
  keys: readonly string[],
  where: string,
): void {
  const present = Object.keys(row);
  if (present.length !== keys.length || keys.some((key) => !(key in row))) {
    throw new RecorderValidationError(`${where} must carry exactly: ${keys.join(", ")}.`);
  }
}

function asList(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new RecorderValidationError(`${where} must be an array.`);
  }
  return value;
}

function asString(value: unknown, where: string): string {
  if (typeof value !== "string") {
    throw new RecorderValidationError(`${where} must be a string.`);
  }
  return value;
}

function asNumber(value: unknown, where: string): number {
  if (typeof value !== "number") {
    throw new RecorderValidationError(`${where} must be a number.`);
  }
  return value;
}

function asBoolean(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") {
    throw new RecorderValidationError(`${where} must be a boolean.`);
  }
  return value;
}

/** Ids in an archive must be unique, or an insert would violate the primary key halfway through the transaction. */
function uniqueById<T extends { id: string }>(rows: readonly T[], where: string): Map<string, T> {
  const byId = new Map<string, T>();
  for (const row of rows) {
    if (byId.has(row.id)) {
      throw new RecorderValidationError(`${where} carries the id "${row.id}" twice.`);
    }
    byId.set(row.id, row);
  }
  return byId;
}
