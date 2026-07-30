import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, protocol } from "electron";
import type { IpcMainInvokeEvent, OpenDialogOptions } from "electron";
import { autoUpdater } from "electron-updater";
import {
  applySearchOperators,
  buildSearchSnippet,
  foldSearchTag,
  isValidDayKey,
  MAX_ARCHIVE_PASSPHRASE_LENGTH,
  parseSearchQuery,
  rankSearchResults,
  resolveDueRange,
  sniffMime,
  toFtsMatchExpression,
  validateArchivePassphrase,
  validateRecurrenceRule,
} from "@nexus/core";
import type {
  NotificationSource,
  ParsedSearchQuery,
  SearchHit,
  SearchKind,
  SearchOperatorFilters,
  SearchTagMatch,
} from "@nexus/core";
import { MAX_PASSCODE_LENGTH, blobStorageName, deriveBlobKeys, type BlobKeys } from "@nexus/core/auth";
import {
  CARD_RATINGS,
  CardStore,
  DatabaseLockedError,
  DeckStore,
  DOCUMENT_TYPES,
  DocumentStore,
  encryptDatabaseInPlace,
  EventStore,
  EXAM_TYPES,
  ExamStore,
  FocusStore,
  isPlaintextDatabase,
  MAX_EVENT_REMINDERS,
  MAX_EVENT_REMINDER_MINUTES,
  MAX_NOTE_ATTACHMENT_BYTES,
  MAX_NOTE_LINKS,
  MAX_NOTE_TEMPLATE_BYTES,
  MAX_NOTE_UPDATE_BYTES,
  MAX_SEARCH_LIMIT,
  MAX_TASK_LIST_NAME_LENGTH,
  MAX_TASK_REMINDERS,
  MAX_TASK_REMINDER_DAYS,
  NOTE_FOLDER_COLORS,
  NoteAttachmentNotFoundError,
  NoteAttachmentStore,
  NotificationStore,
  NoteOrgStore,
  NoteStore,
  NoteTemplateStore,
  openDatabase,
  PeopleStore,
  PERSON_KINDS,
  PlanStore,
  rebuildSearchIndex,
  RestoreStore,
  SearchStore,
  SqliteFlagStore,
  StatsStore,
  STUDY_BLOCK_STATUSES,
  SUBJECT_COLORS,
  SubjectStore,
  TaskListStore,
  TaskStore,
  TaskTagStore,
  TASK_LIST_VIEWS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  uuidv7,
  type Card,
  type CardRating,
  type CreateCardInput,
  type CreateDeckInput,
  type CreateDocumentInput,
  type CreateEventInput,
  type CreateExamInput,
  type CreatePersonInput,
  type CreatePlanInput,
  type CreateSubjectInput,
  type CreateTaskInput,
  type Deck,
  type DeckCounts,
  type DeleteListMode,
  type DocumentRenewal,
  type DocumentType,
  type Event,
  type Exam,
  type ExamType,
  type FocusSession,
  type NexusDatabase,
  type NotificationRecord,
  type NotificationSettings,
  type NoteAttachment,
  type NoteFolder,
  type NoteFolderColor,
  type NoteMeta,
  type NoteTag,
  type NoteTagLink,
  type NoteTemplate,
  type Person,
  type PersonKind,
  type PreviewIntervals,
  type StudyBlock,
  type StudyBlockStatus,
  type StudyBlockWithExam,
  type StudyPlan,
  type Subject,
  type SubjectColor,
  type Task,
  type TaskList,
  type TaskListView,
  type TaskPriority,
  type TaskSection,
  type TaskStatus,
  type TaskTag,
  type TaskTagLink,
  type TrackedDocument,
  type UpdateCardFields,
  type UpdateDeckFields,
  type UpdateDocumentFields,
  type UpdateEventFields,
  type UpdateExamFields,
  type UpdateNotificationSettingsInput,
  type UpdatePersonFields,
  type UpdatePlanFields,
  type UpdateSubjectFields,
  type UpdateTaskFields,
} from "@nexus/db";
import {
  blobStorePaths,
  deleteBlobIfOrphaned,
  migrateLegacyBlobs,
  openExternally,
  readBlob,
  registerBlobProtocol,
  saveAttachmentAs,
  saveBlob,
  type BlobStorePaths,
} from "./attachments.js";
import {
  AuthError,
  changePasscode,
  createAccount,
  readStatus,
  regenerateRecoveryCode,
  unlockWithPasscode,
  unlockWithRecovery,
} from "./auth.js";
import { localToday } from "./clock.js";
import { handleExport } from "./imex.js";
import {
  cancelIdleCompactions,
  captureNoteVersion,
  compactIfNeeded,
  compactNow,
  healNotes,
  scheduleIdleCompaction,
} from "./notes.js";
import { startNotificationScheduler, stopNotificationScheduler } from "./notifications.js";
import {
  applyRestore,
  cancelRestore,
  clearRestoreState,
  pickRestoreFile,
  previewRestore,
  restoreStatus,
  undoRestore,
  type RestoreDeps,
} from "./restore.js";
import {
  CARD_TEXT_MAX_LENGTH,
  IpcChannel,
  MAX_TASK_TAG_NAME_LENGTH,
  NOTE_CARD_KEY_MAX_LENGTH,
  NOTE_CARDS_MAX_COUNT,
  SEARCH_QUERY_MAX_BYTES,
  SEARCH_RESULT_MAX_LIMIT,
  type AppInfo,
  type AuthResult,
  type AuthStatus,
  type ExportResult,
  type FlagState,
  type NoteCardSpec,
  type NoteDocPayload,
  type NoteVersionMeta,
  type Profile,
  type RecurrenceRule,
  type RestoreApplyResult,
  type RestorePickResult,
  type RestorePreviewResult,
  type RestoreStatus,
  type RestoreUndoResult,
  type RunningFocusSession,
  type SaveAttachmentResult,
  type SearchResult,
  type SnoozePreset,
  type StudyStats,
  type TaskListsSnapshot,
} from "../shared/ipc.js";

const isSmoke = process.argv.includes("--smoke");

/** Fixed passcode the smoke run creates its own throwaway account with (ADR-018) — satisfies `validatePasscode` (8+ chars, letter and digit) and is never used for anything but the smoke harness's own disposable `userData/smoke` directory. */
const SMOKE_PASSCODE = "smoke-passcode-1";

// SEC-EL: registers the `nx-blob:` scheme as privileged (ADR-014) — MUST run
// at module scope, before the app's "ready" event, or Electron ignores it.
// `standard` gives it normal URL parsing (so the attachment hash can be read
// back off the host); `secure` + the CSP's `img-src` entry are what let a
// future inline `<img src="nx-blob://...">` (slice 003-b) load at all.
protocol.registerSchemesAsPrivileged([
  { scheme: "nx-blob", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Stable product name so userData resolves to a clean, branded directory
// (%APPDATA%\Nexus) rather than the scoped package name. Set before any
// getPath("userData") call.
app.setName("Nexus");

// Interim brand glyph (four-pointed star, see build/make-icon.ps1). Resolved
// via getAppPath() so the same relative path works unpacked (dev/smoke, app
// root = apps/desktop) and packaged (app root = the asar root; electron-builder
// ships build/icon.ico alongside out/, see electron-builder.yml `files`).
const iconPath = join(app.getAppPath(), "build/icon.ico");

let db: NexusDatabase | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * The unlocked session's data key (hex), held only for as long as the
 * database is open — needed by `auth:regenerate-recovery`, which rewraps the
 * Recovery Kit without asking for the passcode again (the caller already
 * proved possession once this session). `auth:lock` (and nothing else) drops
 * it. Nothing besides that one handler ever reads it.
 */
let unlockedDataKeyHex: string | null = null;

/**
 * The attachment blob store's keys (ADR-019), derived from `unlockedDataKeyHex`
 * the moment it is adopted and sharing its lifetime exactly: set together in
 * `adoptUnlockedKey`, cleared together in `performLock`. Nothing about the
 * data key itself is recoverable from these — they are one-way HKDF outputs.
 */
let blobKeys: BlobKeys | null = null;

/**
 * The unlock's background legacy-blob migration, kept only so something can
 * *wait* for it: nothing in the app does (that is the whole point of running it
 * unawaited), but the smoke rehearsal must know the pass it did not start has
 * finished before it writes a legacy blob of its own, or the two would race
 * over the same directory and make the gate flaky.
 */
let legacyMigrationTask: Promise<unknown> = Promise.resolve();

// STUDY focus timer (piece 4a): the *running* timer is deliberately never a
// database row (see the `focus_sessions` migration's doc comment) — it lives
// only as this main-process runtime state, keyed by profile id, so a crash or
// app restart simply loses the in-progress timer instead of persisting a
// fabricated duration. Only `FocusStore.create` (on `focus:stop`) ever writes
// a `focus_sessions` row.
const runningFocusSessions = new Map<string, RunningFocusSession>();

// --- Database ---------------------------------------------------------------

function databasePath(): string {
  return join(app.getPath("userData"), "nexus.db");
}

/** `<userData>/blobs` (encrypted) + `<userData>/attachments` (legacy plaintext) — the NOTE attachment blob store's roots (ADR-014, encrypted at rest per ADR-019). */
function blobStorePathsFor(): BlobStorePaths {
  return blobStorePaths(app.getPath("userData"));
}

/** `<userData>/tmp-open` — where `openExternally` copies a blob before handing it to the OS's default app. */
function tmpOpenDirPath(): string {
  return join(app.getPath("userData"), "tmp-open");
}

/**
 * Wipes the decrypted copies `openExternally` leaves for the OS shell
 * (ADR-019). Best-effort on purpose: on Windows a file still open in Word or a
 * PDF viewer cannot be deleted, and `rmSync`'s `force` only forgives a missing
 * path, not a busy one. Locking the app must never fail because a viewer is
 * still holding a temp copy — the next lock or launch clears it.
 */
function wipeTmpOpenDir(): void {
  try {
    rmSync(tmpOpenDirPath(), { recursive: true, force: true });
  } catch {
    // Busy files stay behind until a later attempt; nothing here is worth failing a lock over.
  }
}

/** The `userData` directory itself — what every `main/auth.ts` function takes as its first argument (`keychain.json` lives directly inside it, beside `nexus.db`). */
function userDataDir(): string {
  return app.getPath("userData");
}

const SIDECAR_SUFFIXES = ["-wal", "-shm"] as const;

/**
 * Copies a SQLite main file plus whichever of its WAL/SHM sidecars currently
 * exist, so the destination is a complete, self-consistent snapshot even when
 * the source is a WAL-mode database with writes not yet checkpointed into the
 * main file (`openDatabase` always turns on `journal_mode = WAL`, so a plain
 * `nexus.db` file copy alone could silently miss the most recent transactions
 * — this is the difference between a backup that is actually restorable and
 * one that merely looks like it is). Nothing is writing to `from` at any point
 * this runs (the app that owns this call has exclusive access), so a plain
 * filesystem copy of all three files is a valid snapshot. Any sidecar at the
 * destination with no matching source file is removed — left over from
 * whatever used to be there, and otherwise able to silently reintroduce stale
 * WAL frames the next time SQLite opens the destination.
 */
function copyDatabaseTriplet(from: string, to: string): void {
  copyFileSync(from, to);
  for (const suffix of SIDECAR_SUFFIXES) {
    const src = `${from}${suffix}`;
    const dst = `${to}${suffix}`;
    if (existsSync(src)) copyFileSync(src, dst);
    else rmSync(dst, { force: true });
  }
}

/** Removes a SQLite main file and its WAL/SHM sidecars (if any) — the inverse of the snapshot `copyDatabaseTriplet` makes, used once a migration or a restore no longer needs it. */
function removeDatabaseTriplet(path: string): void {
  rmSync(path, { force: true });
  for (const suffix of SIDECAR_SUFFIXES) rmSync(`${path}${suffix}`, { force: true });
}

/**
 * Encrypts a plaintext `nexus.db` in place (ADR-018 step 2): back it up first
 * (2a — the source is already plaintext, so the copy adds no exposure, and it
 * is the difference between an interrupted rekey being an inconvenience and
 * being total data loss), rekey it (2b), reopen it with the new key to prove
 * the rekey actually took (2c), and only then discard the backup (2d).
 */
function migratePlaintextInPlace(path: string, backupPath: string, dataKeyHex: string): void {
  copyDatabaseTriplet(path, backupPath); // 2a
  encryptDatabaseInPlace(path, dataKeyHex); // 2b
  db = openDatabase({ path, encryptionKey: dataKeyHex }); // 2c
  removeDatabaseTriplet(backupPath); // 2d
}

/**
 * Opens `nexus.db` under `dataKeyHex`, encrypting/migrating/recovering it as
 * needed, and sets the module-level `db`. Used by every unlock path
 * (`auth:create`/`auth:unlock`/`auth:recover`, and the smoke harness's own
 * setup) — never called with the database already open.
 *
 * Order of operations, in the order they are tried:
 *
 * 1. No `nexus.db` at all → `openDatabase` creates it already encrypted.
 *    Nothing else to do.
 * 2. `nexus.db` exists and is plaintext → this install predates encryption
 *    (or a previous attempt died before finishing this same step — see the
 *    crash-recovery branch below, which lands back here after restoring a
 *    known-good backup). `migratePlaintextInPlace` runs the full
 *    backup/rekey/reopen/discard sequence.
 * 3. Otherwise the file is already encrypted — the ordinary case on every
 *    later launch. Just open it.
 * 4. Crash recovery: if step 3 throws `DatabaseLockedError` AND a leftover
 *    `nexus.db.pre-encryption` exists, the previous run's rekey (step 2b)
 *    started rewriting `nexus.db` and never finished — a partially rekeyed
 *    file opens as neither valid plaintext (so step 2's check already said
 *    false) nor validly encrypted (so this open just failed). The backup is
 *    the last known-good plaintext snapshot; restoring it and retrying the
 *    whole migration from step 2 turns "total data loss" into "redo one
 *    rekey". Done at most once — a second failure after a fresh restore is a
 *    real error, not a transient crash artifact, and must not be masked by
 *    retrying forever.
 */
function openEncrypted(dataKeyHex: string): void {
  const path = databasePath();
  const backupPath = `${path}.pre-encryption`;

  if (!existsSync(path)) {
    db = openDatabase({ path, encryptionKey: dataKeyHex }); // 1
  } else if (isPlaintextDatabase(path)) {
    migratePlaintextInPlace(path, backupPath, dataKeyHex); // 2
  } else {
    try {
      db = openDatabase({ path, encryptionKey: dataKeyHex }); // 3
    } catch (error) {
      if (!(error instanceof DatabaseLockedError) || !existsSync(backupPath)) {
        throw error;
      }
      copyDatabaseTriplet(backupPath, path); // 4: restore...
      migratePlaintextInPlace(path, backupPath, dataKeyHex); // ...then redo the migration once.
    }
  }

  // Can only run once the database is open.
  seedFirstRunProfile(requireDb());
}

interface ProfileRow {
  id: string;
  kind: "personal" | "business";
  name: string;
  created_at: string;
}

function listProfiles(database: NexusDatabase): Profile[] {
  const rows = database.raw
    .prepare("SELECT id, kind, name, created_at FROM profiles ORDER BY created_at")
    .all() as ProfileRow[];
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    createdAt: row.created_at,
  }));
}

/** Reads one profile by id; throws when it matches no row (IMEX export needs the profile's name for the manifest). */
function requireProfile(database: NexusDatabase, id: string): Profile {
  const profile = listProfiles(database).find((candidate) => candidate.id === id);
  if (!profile) {
    throw new Error("Invalid IPC payload: unknown profile id.");
  }
  return profile;
}

/** Renames an existing profile; throws when the id matches no row (ONB lite). */
function renameProfile(database: NexusDatabase, id: string, name: string): void {
  const result = database.raw
    .prepare("UPDATE profiles SET name = ? WHERE id = ?")
    .run(name, id);
  if (result.changes === 0) {
    throw new Error("Invalid IPC payload: unknown profile id.");
  }
}

/**
 * First-run seeding: create exactly one personal profile if the table is empty.
 * The name is intentionally blank — profile naming belongs to onboarding (ONB)
 * later, so we do not invent a personal name here.
 *
 * The Inbox comes with it (TASK-004 / ADR-029): it is the list `TaskStore.create`
 * defaults to, so a profile without one is a profile no task can be added to.
 * Migration 022 backfills every profile that predates this slice; this is the
 * same row for every profile created after it.
 */
function seedFirstRunProfile(database: NexusDatabase): void {
  const { count } = database.raw
    .prepare("SELECT count(*) AS count FROM profiles")
    .get() as { count: number };
  if (count > 0) return;
  const id = uuidv7();
  const now = new Date().toISOString();
  database.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "", now);
  new TaskListStore(database.raw, id).ensureInbox(now);
}

function appInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    userDataPath: app.getPath("userData"),
    databasePath: databasePath(),
    versions: {
      electron: process.versions.electron ?? "",
      chrome: process.versions.chrome ?? "",
      node: process.versions.node,
      v8: process.versions.v8,
    },
  };
}

// --- IPC (typed, allowlisted, validated) ------------------------------------
//
// SEC-EL-02: every payload is structurally revalidated before it reaches the DB,
// and every message must originate from our own window's web contents. Handlers
// throw on bad input, which rejects the renderer's promise — no partial writes.

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error("IPC message rejected: unrecognized sender.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid IPC payload: expected an object.");
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid IPC payload: "${field}" must be a non-empty string.`);
  }
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid IPC payload: "${field}" must be a boolean.`);
  }
  return value;
}

/** A plain string field that may be empty (structural check only; semantics stay in the store). */
function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  return value;
}

/**
 * A passcode field: a non-empty string capped at `MAX_PASSCODE_LENGTH`
 * (`@nexus/core/auth`) before it ever reaches Argon2id (SEC-EL-02) — the real
 * length/character-class policy (`validatePasscode`) is `main/auth.ts`'s job,
 * not this structural check's.
 */
function asPasscode(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PASSCODE_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a non-empty string of at most ${MAX_PASSCODE_LENGTH} characters.`,
    );
  }
  return value;
}

/** The formatted Recovery Kit code is 39 characters (32 + 7 dashes); 64 is generous headroom for stray whitespace, before `normalizeRecoveryCode` rejects anything that still isn't a valid code. */
const MAX_RECOVERY_CODE_LENGTH = 64;

/** A recovery-code field: a non-empty string capped at `MAX_RECOVERY_CODE_LENGTH`, before it ever reaches Argon2id (SEC-EL-02). */
function asRecoveryCodeInput(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_RECOVERY_CODE_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a non-empty string of at most ${MAX_RECOVERY_CODE_LENGTH} characters.`,
    );
  }
  return value;
}

/**
 * A binary field crossing the boundary over structured clone: must arrive as
 * a genuine, non-empty `Uint8Array` no larger than `maxBytes`. The size cap is
 * enforced here AND re-checked in the store (SEC-EL-02: renderer input is
 * untrusted, and the cap is the wire contract, not a UI courtesy).
 */
function asUint8Array(value: unknown, field: string, maxBytes: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error(`Invalid IPC payload: "${field}" must be a non-empty Uint8Array.`);
  }
  if (value.byteLength > maxBytes) {
    throw new Error(`Invalid IPC payload: "${field}" must not exceed ${maxBytes} bytes.`);
  }
  return value;
}

/**
 * A UTF-8 string field within a byte cap — the JSON-document payloads. The cap is
 * enforced here AND re-checked in the store (SEC-EL-02: renderer input is
 * untrusted, and the cap is the wire contract, not a UI courtesy).
 */
function asCappedString(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new Error(`Invalid IPC payload: "${field}" must not exceed ${maxBytes} bytes.`);
  }
  return value;
}

/**
 * An array of non-empty strings, each capped at `maxItemLength`, the array
 * itself capped at `maxItems` (structural checks only; the store owns the
 * self-link/unknown-id/cross-profile filtering, NOTE-004).
 */
function asStringArray(
  value: unknown,
  field: string,
  maxItems: number,
  maxItemLength: number,
): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be an array of at most ${maxItems} items.`,
    );
  }
  if (
    !value.every(
      (item) => typeof item === "string" && item.length > 0 && item.length <= maxItemLength,
    )
  ) {
    throw new Error(
      `Invalid IPC payload: "${field}" must contain only non-empty strings of at most ${maxItemLength} characters.`,
    );
  }
  return value as string[];
}

/**
 * Validates the renderer's generated-card array for `notes:cards-sync`
 * (SEC-EL-02). Structural checks only — `key` uniqueness and the semantics of
 * "new vs. reconciled vs. removed" stay in `CardStore.syncFromNote`'s own
 * reconcile; emptiness after trimming is likewise a domain rule the store
 * owns (the same division `noteTagsCreate` uses for tag names), so an empty
 * `front`/`back` is not rejected here.
 */
function asNoteCardSpecArray(value: unknown, field: string): NoteCardSpec[] {
  if (!Array.isArray(value) || value.length > NOTE_CARDS_MAX_COUNT) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be an array of at most ${NOTE_CARDS_MAX_COUNT} items.`,
    );
  }
  return value.map((entry, index) => {
    const spec = asRecord(entry);
    const key = spec.key;
    if (typeof key !== "string" || key.length === 0 || key.length > NOTE_CARD_KEY_MAX_LENGTH) {
      throw new Error(
        `Invalid IPC payload: "${field}[${index}].key" must be a non-empty string of at most ${NOTE_CARD_KEY_MAX_LENGTH} characters.`,
      );
    }
    return {
      key,
      front: asCappedString(spec.front, `${field}[${index}].front`, CARD_TEXT_MAX_LENGTH),
      back: asCappedString(spec.back, `${field}[${index}].back`, CARD_TEXT_MAX_LENGTH),
    };
  });
}

/** Profile display name: string, 1–80 chars after trimming; the trimmed value is stored. */
function asProfileName(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 80) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be 1-80 characters after trimming.`,
    );
  }
  return trimmed;
}

/** A nullable optional string field: either a string or an explicit null. */
function asNullableString(value: unknown, field: string): string | null {
  if (value === null || typeof value === "string") return value;
  throw new Error(`Invalid IPC payload: "${field}" must be a string or null.`);
}

/**
 * `imex:export`'s passphrase field (ADR-022): `null` for the explicitly-
 * confirmed plaintext export, otherwise a string that must itself pass
 * `validateArchivePassphrase` — the renderer's own form validation is UX only,
 * never trusted here.
 */
function asArchivePassphrase(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || validateArchivePassphrase(value) !== null) {
    throw new Error(`Invalid IPC payload: "${field}" must be null or a valid archive passphrase.`);
  }
  return value;
}

/**
 * `imex:restore-preview`'s passphrase field (ADR-023): `null` for a plain
 * `.nexus.zip`, otherwise a non-empty string capped at
 * `MAX_ARCHIVE_PASSPHRASE_LENGTH`. Deliberately NOT held to
 * `validateArchivePassphrase` the way `asArchivePassphrase` above is: that one
 * guards what we WRITE — we refuse to seal an archive under a weak passphrase
 * — while this one is only an attempt at a file that already exists. The file
 * on disk is the authority on what opens it, so an archive written under an
 * older, laxer policy must stay openable, and a wrong guess simply fails AEAD
 * authentication. The cap is the SEC-EL-02 half, mirroring `asPasscode`: it
 * bounds what can ever reach Argon2id.
 */
function asRestorePassphrase(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ARCHIVE_PASSPHRASE_LENGTH
  ) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be null or a non-empty string of at most ${MAX_ARCHIVE_PASSPHRASE_LENGTH} characters.`,
    );
  }
  return value;
}

/** A restore token is 32 hex characters (`randomBytes(16)`, `main/restore.ts`); 64 is headroom, and the point is only that an opaque value echoed back by the renderer can never grow unbounded. */
const MAX_RESTORE_TOKEN_LENGTH = 64;

/** `imex:restore-apply`'s token field: a non-empty string within `MAX_RESTORE_TOKEN_LENGTH`. Whether it is the CURRENT preview's token is `applyRestore`'s call, not this structural check's — the same division `asRecoveryCodeInput` follows. */
function asRestoreToken(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_RESTORE_TOKEN_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a non-empty string of at most ${MAX_RESTORE_TOKEN_LENGTH} characters.`,
    );
  }
  return value;
}

/**
 * A recurrence rule field (ADR-024): `null` is "no rule" (and, on a patch,
 * clears one), anything else must satisfy `validateRecurrenceRule`. What is
 * passed on is the CANONICAL rule the validator rebuilds — never the
 * renderer's own object, which is untrusted (SEC-EL-02) and may carry a
 * different member order or a duplicated weekday. The canonical form is the
 * only one whose serialization describes what the engine will actually do, so
 * it is the only form the stores should ever see.
 */
function asRecurrenceRule(value: unknown, field: string): RecurrenceRule | null {
  if (value === null) return null;
  const rule = validateRecurrenceRule(value);
  if (rule === null) {
    throw new Error(`Invalid IPC payload: "${field}" must be null or a valid recurrence rule.`);
  }
  return rule;
}

/** A bare "YYYY-MM-DD" day field: a real calendar day, so `2026-02-30` is rejected rather than silently rolled into March. */
function asBareDate(value: unknown, field: string): string {
  const date = asNonEmptyString(value, field);
  if (!isValidDayKey(date)) {
    throw new Error(`Invalid IPC payload: "${field}" must be a "YYYY-MM-DD" calendar day.`);
  }
  return date;
}

function asTaskStatus(value: unknown, field: string): TaskStatus {
  if (typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value)) {
    return value as TaskStatus;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid task status.`);
}

function asTaskPriority(value: unknown, field: string): TaskPriority {
  if (typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value)) {
    return value as TaskPriority;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid task priority.`);
}

/**
 * A task's reminder ladder (ADR-028): whole DAYS of lead time, unique, within
 * the store's own caps — which are imported from it rather than respelled here,
 * so there is exactly one number to change. Days, not the minutes
 * `asEventReminderOffsets` below speaks: a task's deadline is a day, so its
 * ladder is the DOCUMENT model. Structural checks only; `TaskStore`
 * re-canonicalizes (sorts, revalidates, refuses a ladder with no bare-date due
 * date to count back from) whatever it is handed.
 */
function asTaskReminderOffsets(value: unknown, field: string): number[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_TASK_REMINDERS ||
    !value.every(
      (n) =>
        typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_TASK_REMINDER_DAYS,
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(
      `Invalid IPC payload: "${field}" must hold at most ${MAX_TASK_REMINDERS} distinct whole days between 0 and ${MAX_TASK_REMINDER_DAYS}.`,
    );
  }
  return value as number[];
}

/** Validates a `NewTaskFields` payload into a store input; only present keys are carried. */
function asNewTaskInput(value: unknown): CreateTaskInput {
  const task = asRecord(value);
  const input: CreateTaskInput = { title: asNonEmptyString(task.title, "task.title") };
  if (task.description !== undefined) {
    input.description = asNullableString(task.description, "task.description");
  }
  if (task.status !== undefined) input.status = asTaskStatus(task.status, "task.status");
  if (task.priority !== undefined) input.priority = asTaskPriority(task.priority, "task.priority");
  if (task.dueDate !== undefined) input.dueDate = asNullableString(task.dueDate, "task.dueDate");
  if (task.startDate !== undefined) {
    input.startDate = asNullableString(task.startDate, "task.startDate");
  }
  if (task.parentId !== undefined) input.parentId = asNullableString(task.parentId, "task.parentId");
  if (task.recurrence !== undefined) {
    input.recurrence = asRecurrenceRule(task.recurrence, "task.recurrence");
  }
  if (task.reminderOffsets !== undefined) {
    input.reminderOffsets = asTaskReminderOffsets(task.reminderOffsets, "task.reminderOffsets");
  }
  // Placement (TASK-004): structural checks only — that the list is this
  // profile's, that the section belongs to that list, and that a subtask
  // inherits its parent's placement instead are all `TaskStore.create`'s rules.
  if (task.listId !== undefined) input.listId = asNonEmptyString(task.listId, "task.listId");
  if (task.sectionId !== undefined) {
    input.sectionId = asNullableString(task.sectionId, "task.sectionId");
  }
  return input;
}

/**
 * A list or section name (ADR-029): a string that is non-empty and within
 * `MAX_TASK_LIST_NAME_LENGTH` after trimming — the cap imported from the store
 * rather than respelled here, so there is exactly one number to change. The
 * TRIMMED value is what travels on, mirroring `asProfileName`; `TaskListStore`
 * trims and re-checks it regardless (SEC-EL-02).
 */
function asTaskListName(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TASK_LIST_NAME_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be 1-${MAX_TASK_LIST_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/**
 * A task-tag name (migration 023): `asTaskListName`'s rule with the tag cap —
 * non-empty and within `MAX_TASK_TAG_NAME_LENGTH` after trimming, the TRIMMED
 * value travelling on. The cap comes from the wire contract rather than from
 * `@nexus/db` only because `taskTagStore.ts` keeps its own copy module-private
 * (as `noteOrgStore.ts` does); `TaskTagStore` trims and re-checks regardless,
 * and stays authoritative (SEC-EL-02).
 */
function asTaskTagName(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TASK_TAG_NAME_LENGTH) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be 1-${MAX_TASK_TAG_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/** Which shape a list opens in (TASK-005), checked against the store's own closed domain. */
function asTaskListView(value: unknown, field: string): TaskListView {
  if (typeof value === "string" && (TASK_LIST_VIEWS as readonly string[]).includes(value)) {
    return value as TaskListView;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid task list view.`);
}

/**
 * What deleting a list does with its tasks. Required and explicit: the two
 * modes lose different things, so an absent or unrecognized one is a rejection
 * rather than a default — there is no answer this handler may pick for the user.
 */
function asDeleteListMode(value: unknown, field: string): DeleteListMode {
  if (value === "move-to-inbox" || value === "delete-tasks") return value;
  throw new Error(
    `Invalid IPC payload: "${field}" must be "move-to-inbox" or "delete-tasks".`,
  );
}

/** Validates a `TaskFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asTaskFieldChanges(value: unknown): UpdateTaskFields {
  const changes = asRecord(value);
  const patch: UpdateTaskFields = {};
  if (changes.title !== undefined) patch.title = asNonEmptyString(changes.title, "changes.title");
  if (changes.description !== undefined) {
    patch.description = asNullableString(changes.description, "changes.description");
  }
  if (changes.status !== undefined) patch.status = asTaskStatus(changes.status, "changes.status");
  if (changes.priority !== undefined) {
    patch.priority = asTaskPriority(changes.priority, "changes.priority");
  }
  if (changes.dueDate !== undefined) {
    patch.dueDate = asNullableString(changes.dueDate, "changes.dueDate");
  }
  if (changes.startDate !== undefined) {
    patch.startDate = asNullableString(changes.startDate, "changes.startDate");
  }
  if (changes.recurrence !== undefined) {
    patch.recurrence = asRecurrenceRule(changes.recurrence, "changes.recurrence");
  }
  if (changes.reminderOffsets !== undefined) {
    patch.reminderOffsets = asTaskReminderOffsets(
      changes.reminderOffsets,
      "changes.reminderOffsets",
    );
  }
  return patch;
}

/**
 * An event's reminder ladder (CAL-006): whole minutes of lead time, unique,
 * within the store's own caps — which are imported from it rather than
 * respelled here, so there is exactly one number to change. Distinct from
 * `asReminderOffsets` below, which is the DOCUMENT ladder: whole days, and
 * uncapped. Structural checks only; `EventStore` re-canonicalizes (sorts,
 * revalidates) whatever it is handed.
 */
function asEventReminderOffsets(value: unknown, field: string): number[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_EVENT_REMINDERS ||
    !value.every(
      (n) =>
        typeof n === "number" &&
        Number.isInteger(n) &&
        n >= 0 &&
        n <= MAX_EVENT_REMINDER_MINUTES,
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(
      `Invalid IPC payload: "${field}" must hold at most ${MAX_EVENT_REMINDERS} distinct whole minutes between 0 and ${MAX_EVENT_REMINDER_MINUTES}.`,
    );
  }
  return value as number[];
}

/**
 * Validates a `NewEventFields` payload into a store input; only present keys are
 * carried. Structural checks only — semantic date/range validation stays in the
 * store, the same division of labour as the task validators.
 */
function asNewEventInput(value: unknown): CreateEventInput {
  const event = asRecord(value);
  const input: CreateEventInput = {
    title: asNonEmptyString(event.title, "event.title"),
    startAt: asNonEmptyString(event.startAt, "event.startAt"),
  };
  if (event.endAt !== undefined) input.endAt = asNullableString(event.endAt, "event.endAt");
  if (event.allDay !== undefined) input.allDay = asBoolean(event.allDay, "event.allDay");
  if (event.location !== undefined) {
    input.location = asNullableString(event.location, "event.location");
  }
  if (event.description !== undefined) {
    input.description = asNullableString(event.description, "event.description");
  }
  if (event.category !== undefined) {
    input.category = asNullableString(event.category, "event.category");
  }
  if (event.recurrence !== undefined) {
    input.recurrence = asRecurrenceRule(event.recurrence, "event.recurrence");
  }
  if (event.reminderOffsets !== undefined) {
    input.reminderOffsets = asEventReminderOffsets(
      event.reminderOffsets,
      "event.reminderOffsets",
    );
  }
  return input;
}

/** Validates an `EventFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asEventFieldChanges(value: unknown): UpdateEventFields {
  const changes = asRecord(value);
  const patch: UpdateEventFields = {};
  if (changes.title !== undefined) patch.title = asNonEmptyString(changes.title, "changes.title");
  if (changes.startAt !== undefined) {
    patch.startAt = asNonEmptyString(changes.startAt, "changes.startAt");
  }
  if (changes.endAt !== undefined) patch.endAt = asNullableString(changes.endAt, "changes.endAt");
  if (changes.allDay !== undefined) patch.allDay = asBoolean(changes.allDay, "changes.allDay");
  if (changes.location !== undefined) {
    patch.location = asNullableString(changes.location, "changes.location");
  }
  if (changes.description !== undefined) {
    patch.description = asNullableString(changes.description, "changes.description");
  }
  if (changes.category !== undefined) {
    patch.category = asNullableString(changes.category, "changes.category");
  }
  if (changes.recurrence !== undefined) {
    patch.recurrence = asRecurrenceRule(changes.recurrence, "changes.recurrence");
  }
  if (changes.reminderOffsets !== undefined) {
    patch.reminderOffsets = asEventReminderOffsets(
      changes.reminderOffsets,
      "changes.reminderOffsets",
    );
  }
  return patch;
}

function asPersonKind(value: unknown, field: string): PersonKind {
  if (typeof value === "string" && (PERSON_KINDS as readonly string[]).includes(value)) {
    return value as PersonKind;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid person kind.`);
}

/** An integer field inside an inclusive structural range — the per-column halves of a person's yearless date. */
function asBoundedInteger(value: unknown, field: string, min: number, max: number): number {
  const int = asInteger(value, field);
  if (int < min || int > max) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a whole number between ${min} and ${max}.`,
    );
  }
  return int;
}

/** An optional whole number: an explicit null, or an integer (any range check stays in the store). */
function asNullableInteger(value: unknown, field: string): number | null {
  return value === null ? null : asInteger(value, field);
}

// A person's date is (month, day) rather than a date string, so each half is
// bounded on its own here. These are the PER-COLUMN bounds only — that the pair
// names a real calendar day (never 30 February) and that a year falls inside
// the store's 1900–2100 window are semantic checks, and `PeopleStore` owns
// those, the same division of labour as the event/document validators above.
const PERSON_MONTH_MIN = 1;
const PERSON_MONTH_MAX = 12;
const PERSON_DAY_MIN = 1;
const PERSON_DAY_MAX = 31;

/** Validates a `NewPersonFields` payload into a store input; only present keys are carried. */
function asNewPersonInput(value: unknown): CreatePersonInput {
  const person = asRecord(value);
  const input: CreatePersonInput = {
    name: asNonEmptyString(person.name, "person.name"),
    kind: asPersonKind(person.kind, "person.kind"),
    month: asBoundedInteger(person.month, "person.month", PERSON_MONTH_MIN, PERSON_MONTH_MAX),
    day: asBoundedInteger(person.day, "person.day", PERSON_DAY_MIN, PERSON_DAY_MAX),
  };
  if (person.year !== undefined) input.year = asNullableInteger(person.year, "person.year");
  if (person.note !== undefined) input.note = asNullableString(person.note, "person.note");
  return input;
}

/** Validates a `PersonFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asPersonFieldChanges(value: unknown): UpdatePersonFields {
  const changes = asRecord(value);
  const patch: UpdatePersonFields = {};
  if (changes.name !== undefined) patch.name = asNonEmptyString(changes.name, "changes.name");
  if (changes.kind !== undefined) patch.kind = asPersonKind(changes.kind, "changes.kind");
  if (changes.month !== undefined) {
    patch.month = asBoundedInteger(changes.month, "changes.month", PERSON_MONTH_MIN, PERSON_MONTH_MAX);
  }
  if (changes.day !== undefined) {
    patch.day = asBoundedInteger(changes.day, "changes.day", PERSON_DAY_MIN, PERSON_DAY_MAX);
  }
  if (changes.year !== undefined) patch.year = asNullableInteger(changes.year, "changes.year");
  if (changes.note !== undefined) patch.note = asNullableString(changes.note, "changes.note");
  return patch;
}

function asDocumentType(value: unknown, field: string): DocumentType {
  if (typeof value === "string" && (DOCUMENT_TYPES as readonly string[]).includes(value)) {
    return value as DocumentType;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid document type.`);
}

/** A reminder ladder: an array of non-negative integer day-counts (structural check only). */
function asReminderOffsets(value: unknown, field: string): number[] {
  if (
    !Array.isArray(value) ||
    !value.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0)
  ) {
    throw new Error(`Invalid IPC payload: "${field}" must be an array of non-negative integers.`);
  }
  return value as number[];
}

/**
 * Validates a `NewDocumentFields` payload into a store input; only present keys
 * are carried. Structural checks only — semantic date/ladder validation stays in
 * the store, the same division of labour as the event validators.
 */
function asNewDocumentInput(value: unknown): CreateDocumentInput {
  const document = asRecord(value);
  const input: CreateDocumentInput = {
    docType: asDocumentType(document.docType, "document.docType"),
    label: asNonEmptyString(document.label, "document.label"),
    expiryDate: asNonEmptyString(document.expiryDate, "document.expiryDate"),
  };
  if (document.reminderOffsets !== undefined) {
    input.reminderOffsets = asReminderOffsets(document.reminderOffsets, "document.reminderOffsets");
  }
  if (document.notes !== undefined) {
    input.notes = asNullableString(document.notes, "document.notes");
  }
  return input;
}

/** Validates a `DocumentFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asDocumentFieldChanges(value: unknown): UpdateDocumentFields {
  const changes = asRecord(value);
  const patch: UpdateDocumentFields = {};
  if (changes.docType !== undefined) {
    patch.docType = asDocumentType(changes.docType, "changes.docType");
  }
  if (changes.label !== undefined) patch.label = asNonEmptyString(changes.label, "changes.label");
  if (changes.expiryDate !== undefined) {
    patch.expiryDate = asNonEmptyString(changes.expiryDate, "changes.expiryDate");
  }
  if (changes.reminderOffsets !== undefined) {
    patch.reminderOffsets = asReminderOffsets(changes.reminderOffsets, "changes.reminderOffsets");
  }
  if (changes.notes !== undefined) patch.notes = asNullableString(changes.notes, "changes.notes");
  return patch;
}

function asSubjectColor(value: unknown, field: string): SubjectColor {
  if (typeof value === "string" && (SUBJECT_COLORS as readonly string[]).includes(value)) {
    return value as SubjectColor;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid subject colour.`);
}

/**
 * Validates a `NewSubjectFields` payload into a store input; only present keys are
 * carried. Structural checks only — the store owns the trim/enum revalidation, the
 * same division of labour as the document validators.
 */
function asNewSubjectInput(value: unknown): CreateSubjectInput {
  const subject = asRecord(value);
  const input: CreateSubjectInput = { name: asNonEmptyString(subject.name, "subject.name") };
  if (subject.color !== undefined) input.color = asSubjectColor(subject.color, "subject.color");
  if (subject.semester !== undefined) {
    input.semester = asNullableString(subject.semester, "subject.semester");
  }
  return input;
}

/** Validates a `SubjectFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asSubjectFieldChanges(value: unknown): UpdateSubjectFields {
  const changes = asRecord(value);
  const patch: UpdateSubjectFields = {};
  if (changes.name !== undefined) patch.name = asNonEmptyString(changes.name, "changes.name");
  if (changes.color !== undefined) patch.color = asSubjectColor(changes.color, "changes.color");
  if (changes.semester !== undefined) {
    patch.semester = asNullableString(changes.semester, "changes.semester");
  }
  if (changes.archived !== undefined) patch.archived = asBoolean(changes.archived, "changes.archived");
  return patch;
}

function asNoteFolderColor(value: unknown, field: string): NoteFolderColor {
  if (typeof value === "string" && (NOTE_FOLDER_COLORS as readonly string[]).includes(value)) {
    return value as NoteFolderColor;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid note folder colour.`);
}

function asNullableNoteFolderColor(value: unknown, field: string): NoteFolderColor | null {
  return value === null ? null : asNoteFolderColor(value, field);
}

/** Validates a note-folder create input; only `parentId`/`name`/`color` are structurally checked — the store owns the trim/enum/parent-FK revalidation. */
function asNoteFolderCreateInput(value: unknown): {
  parentId: string | null;
  name: string;
  color: NoteFolderColor | null;
} {
  const input = asRecord(value);
  return {
    parentId: asNullableString(input.parentId, "input.parentId"),
    name: asString(input.name, "input.name"),
    color: asNullableNoteFolderColor(input.color, "input.color"),
  };
}

/**
 * Validates a note-folder `fields` patch; an omitted key stays omitted, an
 * explicit `color: null` clears the colour — presence is checked with `in`,
 * never `!== undefined`, so the two cases are distinguishable.
 */
function asNoteFolderFieldChanges(value: unknown): { name?: string; color?: NoteFolderColor | null } {
  const rec = asRecord(value);
  const patch: { name?: string; color?: NoteFolderColor | null } = {};
  if ("name" in rec) patch.name = asString(rec.name, "name");
  if ("color" in rec) patch.color = asNullableNoteFolderColor(rec.color, "color");
  return patch;
}

function asExamType(value: unknown, field: string): ExamType {
  if (typeof value === "string" && (EXAM_TYPES as readonly string[]).includes(value)) {
    return value as ExamType;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid exam type.`);
}

/**
 * Validates a `NewExamFields` payload into a store input; only present keys are
 * carried. Structural checks only — semantic date validation and the same-profile
 * subject-FK check stay in the store, the same division of labour as the document
 * validators.
 */
function asNewExamInput(value: unknown): CreateExamInput {
  const exam = asRecord(value);
  const input: CreateExamInput = {
    subjectId: asNonEmptyString(exam.subjectId, "exam.subjectId"),
    examType: asExamType(exam.examType, "exam.examType"),
    examDate: asNonEmptyString(exam.examDate, "exam.examDate"),
  };
  if (exam.scope !== undefined) input.scope = asNullableString(exam.scope, "exam.scope");
  return input;
}

/** Validates an `ExamFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asExamFieldChanges(value: unknown): UpdateExamFields {
  const changes = asRecord(value);
  const patch: UpdateExamFields = {};
  if (changes.subjectId !== undefined) {
    patch.subjectId = asNonEmptyString(changes.subjectId, "changes.subjectId");
  }
  if (changes.examType !== undefined) patch.examType = asExamType(changes.examType, "changes.examType");
  if (changes.examDate !== undefined) {
    patch.examDate = asNonEmptyString(changes.examDate, "changes.examDate");
  }
  if (changes.scope !== undefined) patch.scope = asNullableString(changes.scope, "changes.scope");
  return patch;
}

/**
 * Validates a `NewDeckFields` payload into a store input; only present keys are
 * carried. Structural checks only — the store owns the trim/length and
 * same-profile subject-FK checks, the same division of labour as the exam
 * validators.
 */
function asNewDeckInput(value: unknown): CreateDeckInput {
  const deck = asRecord(value);
  return {
    subjectId: asNonEmptyString(deck.subjectId, "deck.subjectId"),
    name: asNonEmptyString(deck.name, "deck.name"),
  };
}

/** Validates a `DeckFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asDeckFieldChanges(value: unknown): UpdateDeckFields {
  const changes = asRecord(value);
  const patch: UpdateDeckFields = {};
  if (changes.subjectId !== undefined) {
    patch.subjectId = asNonEmptyString(changes.subjectId, "changes.subjectId");
  }
  if (changes.name !== undefined) patch.name = asNonEmptyString(changes.name, "changes.name");
  return patch;
}

/**
 * Validates a `NewCardFields` payload into a store input; all three fields are
 * required. Structural checks only — the store owns the trim/length and
 * same-profile deck-FK checks. `front`/`back` may contain `$…$` KaTeX math and
 * are passed through verbatim (no sanitizing).
 */
function asNewCardInput(value: unknown): CreateCardInput {
  const card = asRecord(value);
  return {
    deckId: asNonEmptyString(card.deckId, "card.deckId"),
    front: asNonEmptyString(card.front, "card.front"),
    back: asNonEmptyString(card.back, "card.back"),
  };
}

/** Validates a `CardFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asCardFieldChanges(value: unknown): UpdateCardFields {
  const changes = asRecord(value);
  const patch: UpdateCardFields = {};
  if (changes.deckId !== undefined) patch.deckId = asNonEmptyString(changes.deckId, "changes.deckId");
  if (changes.front !== undefined) patch.front = asNonEmptyString(changes.front, "changes.front");
  if (changes.back !== undefined) patch.back = asNonEmptyString(changes.back, "changes.back");
  return patch;
}

/** A plain integer field (structural check only; range validation stays in the store). */
function asInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Invalid IPC payload: "${field}" must be an integer.`);
  }
  return value;
}

/** A `coveredSeq` field: an integer, and additionally ≥ 1 — seq 0 never names a version (ADR-015). */
function asPositiveInteger(value: unknown, field: string): number {
  const int = asInteger(value, field);
  if (int < 1) {
    throw new Error(`Invalid IPC payload: "${field}" must be a positive integer.`);
  }
  return int;
}

/** The closed FSRS review-rating domain (Again/Hard/Good/Easy); Manual (0) and anything else is rejected. */
function asCardRating(value: unknown, field: string): CardRating {
  if (typeof value === "number" && (CARD_RATINGS as readonly number[]).includes(value)) {
    return value as CardRating;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid review rating.`);
}

/**
 * Validates a `NewPlanFields` payload into a store input; all four fields are
 * required. Structural checks only — the store owns the exam-lookup, date-
 * ordering, and `dailyMinutes`-range validation, the same division of labour
 * as the exam/deck validators. `now`/`today` are never taken from this payload
 * — they are stamped by main from its own clock.
 */
function asNewPlanInput(value: unknown): CreatePlanInput {
  const plan = asRecord(value);
  return {
    examId: asNonEmptyString(plan.examId, "plan.examId"),
    dailyMinutes: asInteger(plan.dailyMinutes, "plan.dailyMinutes"),
    startDate: asNonEmptyString(plan.startDate, "plan.startDate"),
    examWeekBoost: asBoolean(plan.examWeekBoost, "plan.examWeekBoost"),
  };
}

/** Validates a `PlanFieldChanges` payload into a store patch; an omitted key stays omitted. */
function asPlanFieldChanges(value: unknown): UpdatePlanFields {
  const changes = asRecord(value);
  const patch: UpdatePlanFields = {};
  if (changes.dailyMinutes !== undefined) {
    patch.dailyMinutes = asInteger(changes.dailyMinutes, "changes.dailyMinutes");
  }
  if (changes.startDate !== undefined) {
    patch.startDate = asNonEmptyString(changes.startDate, "changes.startDate");
  }
  if (changes.examWeekBoost !== undefined) {
    patch.examWeekBoost = asBoolean(changes.examWeekBoost, "changes.examWeekBoost");
  }
  return patch;
}

/** The closed study-block status domain; `setBlockStatus`'s own semantic check rejects "missed" (sync-only). */
function asBlockStatus(value: unknown, field: string): StudyBlockStatus {
  if (typeof value === "string" && (STUDY_BLOCK_STATUSES as readonly string[]).includes(value)) {
    return value as StudyBlockStatus;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid block status.`);
}

/**
 * The five NTF/CAL-006/ADR-028 source kinds (mirrors `@nexus/core`'s
 * `NotificationSource`). Not re-exported from `@nexus/db`, so the closed set is
 * declared here, the same division of labour as every other closed-enum
 * validator in this file.
 */
const NOTIFICATION_SOURCES: readonly NotificationSource[] = [
  "document",
  "exam",
  "study-day",
  "event",
  "task",
];

/** The four snooze presets `notifications:snooze` accepts; main resolves each to an absolute `until` from its own clock. */
const SNOOZE_PRESETS: readonly SnoozePreset[] = ["10m", "1h", "tonight", "tomorrow-morning"];

function asNotificationSource(value: unknown, field: string): NotificationSource {
  if (typeof value === "string" && (NOTIFICATION_SOURCES as readonly string[]).includes(value)) {
    return value as NotificationSource;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid notification source.`);
}

function asSnoozePreset(value: unknown, field: string): SnoozePreset {
  if (typeof value === "string" && (SNOOZE_PRESETS as readonly string[]).includes(value)) {
    return value as SnoozePreset;
  }
  throw new Error(`Invalid IPC payload: "${field}" is not a valid snooze preset.`);
}

/** Validates a `notifications:settings-update` payload's `changes`; an omitted key stays omitted. Structural checks only — the store owns "HH:MM"/coherence validation. */
function asNotificationSettingsChanges(value: unknown): UpdateNotificationSettingsInput {
  const changes = asRecord(value);
  const patch: UpdateNotificationSettingsInput = {};
  if (changes.quietFrom !== undefined) {
    patch.quietFrom = asNullableString(changes.quietFrom, "changes.quietFrom");
  }
  if (changes.quietTo !== undefined) {
    patch.quietTo = asNullableString(changes.quietTo, "changes.quietTo");
  }
  if (changes.morningHour !== undefined) {
    patch.morningHour = asNonEmptyString(changes.morningHour, "changes.morningHour");
  }
  return patch;
}

/**
 * Resolves a snooze preset to an absolute ISO-8601 `until`, entirely from
 * main's own clock (SEC-EL-02: the renderer never supplies a snooze
 * deadline). `10m`/`1h` are fixed offsets; `tonight` is today at 18:00 local
 * (the store's own "`until` must be strictly after `now`" check rejects it
 * once evening has already passed — the UI disables the preset then);
 * `tomorrow-morning` is tomorrow at the profile's configured morning hour.
 */
function computeSnoozeUntil(preset: SnoozePreset, now: Date, morningHour: string): string {
  switch (preset) {
    case "10m":
      return new Date(now.getTime() + 10 * 60_000).toISOString();
    case "1h":
      return new Date(now.getTime() + 60 * 60_000).toISOString();
    case "tonight":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0, 0).toISOString();
    case "tomorrow-morning": {
      const [hour, minute] = morningHour.split(":").map(Number);
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        hour,
        minute,
        0,
        0,
      ).toISOString();
    }
  }
}

function requireDb(): NexusDatabase {
  if (!db) throw new Error("Database is locked.");
  return db;
}

/** Mirrors `requireDb()`'s idiom for the attachment blob store's keys (ADR-019): absent means the session is locked. */
function requireBlobKeys(): BlobKeys {
  if (!blobKeys) throw new Error("The attachment store is locked.");
  return blobKeys;
}

function taskStore(profileId: string): TaskStore {
  return new TaskStore(requireDb().raw, profileId);
}

function taskListStore(profileId: string): TaskListStore {
  return new TaskListStore(requireDb().raw, profileId);
}

function taskTagStore(profileId: string): TaskTagStore {
  return new TaskTagStore(requireDb().raw, profileId);
}

function eventStore(profileId: string): EventStore {
  return new EventStore(requireDb().raw, profileId);
}

function peopleStore(profileId: string): PeopleStore {
  return new PeopleStore(requireDb().raw, profileId);
}

function documentStore(profileId: string): DocumentStore {
  return new DocumentStore(requireDb().raw, profileId);
}

function subjectStore(profileId: string): SubjectStore {
  return new SubjectStore(requireDb().raw, profileId);
}

function examStore(profileId: string): ExamStore {
  return new ExamStore(requireDb().raw, profileId);
}

function deckStore(profileId: string): DeckStore {
  return new DeckStore(requireDb().raw, profileId);
}

function cardStore(profileId: string): CardStore {
  return new CardStore(requireDb().raw, profileId);
}

function planStore(profileId: string): PlanStore {
  return new PlanStore(requireDb().raw, profileId);
}

function focusStore(profileId: string): FocusStore {
  return new FocusStore(requireDb().raw, profileId);
}

function statsStore(profileId: string): StatsStore {
  return new StatsStore(requireDb().raw, profileId);
}

function notificationStore(profileId: string): NotificationStore {
  return new NotificationStore(requireDb().raw, profileId);
}

function noteStore(profileId: string): NoteStore {
  return new NoteStore(requireDb().raw, profileId);
}

function noteOrgStore(profileId: string): NoteOrgStore {
  return new NoteOrgStore(requireDb().raw, profileId);
}

function noteAttachmentStore(profileId: string): NoteAttachmentStore {
  return new NoteAttachmentStore(requireDb().raw, profileId);
}

function noteTemplateStore(profileId: string): NoteTemplateStore {
  return new NoteTemplateStore(requireDb().raw, profileId);
}

function searchStore(profileId: string): SearchStore {
  return new SearchStore(requireDb().raw, profileId);
}

/**
 * Finds one attachment via `list` and throws `NoteAttachmentNotFoundError` if
 * absent — `open`/`save-as` need the full row (file name, mime, hash) but the
 * store has no separate `get`, and its `list` is already scoped to an active
 * note in this profile, so this keeps that same profile/note gating intact.
 */
function requireNoteAttachment(profileId: string, noteId: string, attachmentId: string): NoteAttachment {
  const found = noteAttachmentStore(profileId)
    .list(noteId)
    .find((attachment) => attachment.id === attachmentId);
  if (!found) {
    throw new NoteAttachmentNotFoundError(`No attachment "${attachmentId}" on note "${noteId}".`);
  }
  return found;
}

function flagStore(profileId: string): SqliteFlagStore {
  return new SqliteFlagStore(requireDb().raw, profileId);
}

// --- Search (ADR-021): the query pipeline -----------------------------------
//
// Extracted as named functions rather than closures inside `ipcMain.handle`,
// because `runSmokeSearchRehearsal` below calls the exact same code path the
// renderer does.

/** How many bm25 candidates the store is asked for per requested result: `rankSearchResults` re-orders by recency/kind prior/title on top of bm25, and it can only re-order what it was given. */
const SEARCH_CANDIDATE_FACTOR = 3;

/** Radius (chars) `buildSearchSnippet` reaches around a title's first match — generous enough that most titles fit whole, while still bounding a pathologically long one. */
const TITLE_SNIPPET_RADIUS = 120;

/**
 * Maps one store hit to the wire shape. Reusing `buildSearchSnippet` for the
 * TITLE too is deliberate: it is the same operation as for the body — find
 * the matched span, return the surrounding text plus highlight ranges — and
 * it doubles as a bound on a pathologically long title. `title`/`titleRanges`
 * and `snippet`/`snippetRanges` are each internally consistent (the ranges
 * index into their own returned string), never into the source entity's full
 * text.
 */
function toSearchResult(hit: SearchHit, terms: readonly string[]): SearchResult {
  const title = buildSearchSnippet(hit.title, terms, { radius: TITLE_SNIPPET_RADIUS });
  const snippet = buildSearchSnippet(hit.body, terms);
  return {
    kind: hit.kind,
    entityId: hit.entityId,
    parentId: hit.parentId,
    title: title.text,
    titleRanges: [...title.ranges],
    snippet: snippet.text,
    snippetRanges: [...snippet.ranges],
    contextDate: hit.contextDate,
    updatedAt: hit.updatedAt,
  };
}

/** `SearchStore.recent`'s hits, kind-filtered when asked — the raw rows behind `runRecentSearch` and the operator-only query path below. */
function recentHits(
  profileId: string,
  limit: number,
  kinds: readonly SearchKind[],
): SearchHit[] {
  const store = searchStore(profileId);
  return kinds.length > 0 ? store.recent({ limit, kinds }) : store.recent({ limit });
}

/**
 * The profile's most recently touched entries, already in their FINAL order
 * (`SearchStore.recent`) — deliberately NOT passed through
 * `rankSearchResults`, which would reorder them by kind prior/recency instead
 * of the plain "most recently touched" order an empty query is supposed to
 * show. Snippet terms are empty, so each snippet is just the head of its body.
 *
 * `kinds` matters because this is also where a *kind-only* query lands: the
 * palette's chips send `z:` with no words behind it, which has no matchable
 * term and so falls through here from `runSearchQuery`. Dropping the filter at
 * that point would answer "show me only my tasks" with everything.
 */
function runRecentSearch(
  profileId: string,
  limit: number,
  kinds: readonly SearchKind[] = [],
): SearchResult[] {
  return recentHits(profileId, limit, kinds).map((hit) => toSearchResult(hit, []));
}

/** Every entity id carrying a tag whose `foldSearchTag` form starts with `token`, for one `#` token and one module. */
function tagFilterIds(
  tags: ReadonlyArray<{ readonly id: string; readonly folded: string }>,
  linksByTagId: ReadonlyMap<string, readonly string[]>,
  token: string,
): Set<string> {
  const ids = new Set<string>();
  for (const tag of tags) {
    if (!tag.folded.startsWith(token)) continue;
    for (const entityId of linksByTagId.get(tag.id) ?? []) ids.add(entityId);
  }
  return ids;
}

/** Groups tag links by their tag id, so each `#` token walks the tags once instead of the whole link table. */
function groupLinksByTagId(
  links: ReadonlyArray<{ readonly entityId: string; readonly tagId: string }>,
): Map<string, string[]> {
  const byTag = new Map<string, string[]>();
  for (const link of links) {
    const bucket = byTag.get(link.tagId);
    if (bucket) bucket.push(link.entityId);
    else byTag.set(link.tagId, [link.entityId]);
  }
  return byTag;
}

/**
 * One `{ taskIds, noteIds }` set per `#` token. Both modules' tags and links
 * are read (and each name folded) exactly ONCE here, however many tokens were
 * typed — the per-token work is then a prefix scan over an already-folded list.
 */
function buildTagMatches(profileId: string, tokens: readonly string[]): SearchTagMatch[] {
  const noteTags = noteOrgStore(profileId);
  const taskTags = taskTagStore(profileId);
  const foldedNoteTags = noteTags
    .listTags()
    .map((tag) => ({ id: tag.id, folded: foldSearchTag(tag.name) }));
  const foldedTaskTags = taskTags
    .listTags()
    .map((tag) => ({ id: tag.id, folded: foldSearchTag(tag.name) }));
  const noteLinks = groupLinksByTagId(
    noteTags.listTagLinks().map((link) => ({ entityId: link.noteId, tagId: link.tagId })),
  );
  const taskLinks = groupLinksByTagId(
    taskTags.listTagLinks().map((link) => ({ entityId: link.taskId, tagId: link.tagId })),
  );

  return tokens.map((token) => ({
    taskIds: tagFilterIds(foldedTaskTags, taskLinks, token),
    noteIds: tagFilterIds(foldedNoteTags, noteLinks, token),
  }));
}

/**
 * Resolves the parsed operators against this profile's data: each `#` token
 * into the ids it matches, and a `rok:` filter into real day bounds using
 * MAIN's local today — the renderer never gets to say what day it is (SEC-EL).
 * Returns null when the query carries no operators at all, which is also what
 * tells the caller to keep the untouched pipeline (and what keeps an ordinary
 * query from touching the tag tables at all).
 */
function searchOperatorFilters(
  profileId: string,
  parsed: ParsedSearchQuery,
): SearchOperatorFilters | null {
  if (parsed.tags.length === 0 && parsed.due === null) return null;
  return {
    tagMatches: parsed.tags.length > 0 ? buildTagMatches(profileId, parsed.tags) : [],
    dueRange: parsed.due === null ? null : resolveDueRange(parsed.due, localToday()),
  };
}

/**
 * Parses the raw query, asks the store for bm25 candidates (more than
 * `limit` — see `SEARCH_CANDIDATE_FACTOR` — since `rankSearchResults` can
 * only re-order what it was given), re-ranks them with recency/kind
 * prior/title boosts on top of bm25, then truncates to `limit`. Falls back to
 * `runRecentSearch` when the query has no matchable terms:
 * `toFtsMatchExpression` returns null for exactly that case, precisely so an
 * empty or punctuation-only query never reaches the store as a malformed FTS
 * expression.
 *
 * The `#oznaka` / `rok:` operators are POST-filters (see `searchOperators.ts`
 * on why they cannot be SQL), which changes candidate sourcing in two places:
 * with an operator active the store is asked for `MAX_SEARCH_LIMIT` candidates
 * rather than a small multiple of `limit`, since an unknown share of them is
 * about to be filtered away; and an operator with NO text terms — a perfectly
 * ordinary "#posao" — takes the `recent` path instead of falling through to an
 * unfiltered recent list, keeping that method's own recency order (it must
 * never be re-ranked, per its contract) rather than pretending to a relevance
 * it has no query to measure.
 */
function runSearchQuery(profileId: string, rawQuery: string, limit: number): SearchResult[] {
  const parsed = parseSearchQuery(rawQuery);
  const filters = searchOperatorFilters(profileId, parsed);
  const match = toFtsMatchExpression(parsed.terms, { prefixLast: parsed.prefixLast });

  if (match === null) {
    if (filters === null) return runRecentSearch(profileId, limit, parsed.kinds);
    const hits = recentHits(profileId, MAX_SEARCH_LIMIT, parsed.kinds);
    return applySearchOperators(hits, filters)
      .slice(0, limit)
      .map((hit) => toSearchResult(hit, []));
  }

  const store = searchStore(profileId);
  const candidateLimit = filters === null ? limit * SEARCH_CANDIDATE_FACTOR : MAX_SEARCH_LIMIT;
  const candidates =
    parsed.kinds.length > 0
      ? store.search({ match, limit: candidateLimit, kinds: parsed.kinds })
      : store.search({ match, limit: candidateLimit });
  const filtered = filters === null ? candidates : applySearchOperators(candidates, filters);

  const ranked = rankSearchResults(filtered, { now: new Date().toISOString(), query: parsed });
  return ranked.slice(0, limit).map((hit) => toSearchResult(hit, parsed.terms));
}

// --- Auth (ADR-018): the local account gate ---------------------------------
//
// `main/auth.ts` owns the keychain file and the OS keystore; everything here
// composes its functions with this process's own state (`db`, the
// notification scheduler) and turns its thrown `AuthError`s into the wire-safe
// `AuthResult` every expected refusal returns. An unexpected failure (a
// corrupt database, a filesystem error) is left to throw — the renderer's
// generic error path exists for those, and `AuthError` narrowing below is
// exactly what tells the two apart.

/**
 * `auth.readStatus` can only ever report "uninitialized" or "locked" — it has
 * no way to know the database is open in this process. Only `db !== null`
 * means genuinely unlocked this session, so that is layered on top here.
 */
function computeAuthStatus(): AuthStatus {
  const fileStatus = readStatus(userDataDir());
  return db !== null ? { ...fileStatus, state: "unlocked" } : fileStatus;
}

/** Starts everything that only makes sense once the database is open. Never during the smoke run — a scheduled check firing mid-smoke would make its deterministic exit flaky, the same reason `app.whenReady` used to skip it. */
function startUnlockedServices(): void {
  if (isSmoke) return;
  startNotificationScheduler({
    listProfiles: () => listProfiles(requireDb()),
    documentStore,
    eventStore,
    examStore,
    subjectStore,
    planStore,
    taskStore,
    notificationStore,
    getMainWindow: () => mainWindow,
  });

  // The one-time note-healing sweep (see `notes.ts`'s doc comment).
  // Unawaited, mirroring `adoptUnlockedKey`'s legacy-blob drain: an unlock
  // must not block on walking every note of every profile. Identity, not
  // null-ness, is "still this session" — `performLock` sets `db = null` and a
  // later unlock installs a NEW instance, so this stops the sweep both on
  // lock and when a newer session has superseded it.
  const session = requireDb();
  const stores = listProfiles(session).map((profile) => ({
    notes: noteStore(profile.id),
    cards: cardStore(profile.id),
  }));
  healNotes(stores, () => db === session).catch((error: unknown) => {
    console.error(
      `Note healing sweep failed (will retry on the next unlock): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
}

/** Closes the database, stops the scheduler, and drops the data key (and the blob keys derived from it) from memory. Shared by the `auth:lock` handler and the smoke run's own lock/unlock exercise. */
function performLock(): void {
  stopNotificationScheduler();
  // A pending idle-compaction timer (scheduled from `notesAppendUpdate`) would
  // otherwise fire against a database this lock is about to close — throwing
  // where nothing can observe it, and holding open exactly the kind of
  // background work a lock is supposed to stop.
  cancelIdleCompactions();
  // A picked archive holds decrypted bytes and an undo snapshot holds a whole
  // profile's plaintext — both must die with the session's keys (ADR-023).
  clearRestoreState();
  try {
    db?.close();
  } catch {
    // best-effort close; we are locking regardless
  }
  db = null;
  unlockedDataKeyHex = null;
  blobKeys = null;
  // `openExternally` must hand the OS a real plaintext file to open with its
  // default app, so its temp copies are an unavoidable plaintext residue
  // living outside both blob stores. What IS controllable is that they never
  // outlive the session that made them — wiped here on every lock, and once
  // more at startup (`app.whenReady`) in case the process died before a lock
  // ever ran.
  wipeTmpOpenDir();
}

/**
 * Adopts a freshly-verified data key for the rest of the unlocked session:
 * remembers it (`unlockedDataKeyHex`), derives the attachment blob store's
 * keys from it (ADR-019), and kicks off draining any legacy plaintext blobs
 * in the background. Never awaited by its own caller — an unlock must not
 * block on a potentially large migration — and a migration failure is logged
 * and swallowed rather than left to crash the process as an unhandled
 * rejection; the legacy directory simply stays put for the next unlock to
 * try again.
 */
async function adoptUnlockedKey(dataKeyHex: string): Promise<void> {
  unlockedDataKeyHex = dataKeyHex;
  const sessionKeys = await deriveBlobKeys(dataKeyHex);
  blobKeys = sessionKeys;
  // Identity, not null-ness, is what "still this session" means: `performLock`
  // clears `blobKeys`, and a later unlock installs a NEW object — so this pass
  // stops both when the app locks and when it has been superseded, which is
  // what keeps two passes from ever walking the same tree at once.
  const stillThisSession = (): boolean => blobKeys === sessionKeys;
  legacyMigrationTask = migrateLegacyBlobs(blobStorePathsFor(), sessionKeys, stillThisSession).catch(
    (error: unknown) => {
      console.error(
        `Legacy attachment migration failed (will retry on the next unlock): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  );
}

/** Converts an `AuthError` into the `AuthResult` the renderer branches on; a `"throttled"` reason additionally carries a freshly computed `lockedForMs` (the guard file was left untouched by the throttle check that raised it, so re-reading it here is exact, not stale). Anything that is NOT an `AuthError` is rethrown — an unexpected failure, not an expected refusal. */
function authResultFromError(error: unknown): AuthResult {
  if (error instanceof AuthError) {
    if (error.reason === "throttled") {
      return { ok: false, reason: error.reason, lockedForMs: readStatus(userDataDir()).lockedForMs };
    }
    return { ok: false, reason: error.reason };
  }
  throw error;
}

async function handleAuthCreate(passcode: string): Promise<AuthResult> {
  try {
    const { dataKeyHex, recoveryCode } = await createAccount(userDataDir(), passcode);
    openEncrypted(dataKeyHex);
    await adoptUnlockedKey(dataKeyHex);
    startUnlockedServices();
    return { ok: true, recoveryCode };
  } catch (error) {
    return authResultFromError(error);
  }
}

async function handleAuthUnlock(passcode: string): Promise<AuthResult> {
  try {
    const dataKeyHex = await unlockWithPasscode(userDataDir(), passcode);
    // The passcode is always fully verified above, regardless of session
    // state — only the database (re)open is idempotent: a redundant-but-
    // correct unlock while already unlocked must not call `openDatabase` a
    // second time, which would leak the first connection's file handle
    // without ever closing it. (A WRONG passcode never reaches this line —
    // `unlockWithPasscode` already threw.)
    if (db === null) {
      openEncrypted(dataKeyHex);
      await adoptUnlockedKey(dataKeyHex);
      startUnlockedServices();
    }
    return { ok: true };
  } catch (error) {
    return authResultFromError(error);
  }
}

async function handleAuthRecover(recoveryCode: string, newPasscode: string): Promise<AuthResult> {
  try {
    const dataKeyHex = await unlockWithRecovery(userDataDir(), recoveryCode, newPasscode);
    // Same idempotent-open discipline as `handleAuthUnlock` — the recovered
    // data key is unchanged from whatever is already open, so there is
    // nothing to reopen, but the recovery code and new passcode are always
    // fully verified/applied above regardless of session state.
    if (db === null) {
      openEncrypted(dataKeyHex);
      await adoptUnlockedKey(dataKeyHex);
      startUnlockedServices();
    }
    return { ok: true };
  } catch (error) {
    return authResultFromError(error);
  }
}

async function handleAuthChangePasscode(currentPasscode: string, nextPasscode: string): Promise<AuthResult> {
  try {
    await changePasscode(userDataDir(), currentPasscode, nextPasscode);
    return { ok: true };
  } catch (error) {
    return authResultFromError(error);
  }
}

async function handleAuthRegenerateRecovery(): Promise<AuthResult> {
  if (unlockedDataKeyHex === null) {
    // Only reachable via a renderer bug (the Settings action that calls this
    // does not exist while locked) — not a user-facing "expected refusal", so
    // this throws rather than returning an `AuthResult`; no `AuthErrorReason`
    // fits "you are not even unlocked".
    throw new Error("Cannot regenerate the recovery code while locked.");
  }
  try {
    const recoveryCode = await regenerateRecoveryCode(userDataDir(), unlockedDataKeyHex);
    return { ok: true, recoveryCode };
  } catch (error) {
    return authResultFromError(error);
  }
}

/**
 * Everything `main/restore.ts` runs on (ADR-023 slice 3c): the same store
 * getters the `imex:export` handler hands `handleExport` — that shared shape is
 * exactly why undo's snapshot and an ordinary export are provably identical
 * (`profileData.ts`) — plus the pieces only a restore needs. Built fresh per
 * call, like the export handler's own deps literal: every getter resolves
 * `requireDb()`/`requireBlobKeys()` at use time, so a deps object can never
 * outlive the session that made it.
 */
function restoreDeps(): RestoreDeps {
  return {
    taskStore,
    taskListStore,
    taskTagStore,
    eventStore,
    peopleStore,
    documentStore,
    subjectStore,
    examStore,
    deckStore,
    cardStore,
    planStore,
    focusStore,
    notificationStore,
    noteStore,
    noteOrgStore,
    noteTemplateStore,
    noteAttachmentStore,
    flagStore,
    restoreStore: (profileId) => new RestoreStore(requireDb().raw, profileId),
    getProfile: (profileId) => requireProfile(requireDb(), profileId),
    pickArchiveFile: async () => {
      // One filter for both archive kinds: an encrypted export is `.nexus` and
      // a plaintext one `.nexus.zip`, and the reader tells them apart by the
      // file's own magic bytes, never by its extension.
      const options: OpenDialogOptions = {
        properties: ["openFile"],
        filters: [{ name: "Nexus arhiva", extensions: ["nexus", "zip"] }],
      };
      const { canceled, filePaths } = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
      return canceled ? null : (filePaths[0] ?? null);
    },
    // The renderer comes back UNLOCKED: main keeps the open database and the
    // data key across this reload (ADR-023 section 7) — all it discards is the
    // renderer's own view of a profile that just changed under it.
    reloadRenderer: () => {
      mainWindow?.webContents.reload();
    },
    // Discarded, never persisted — exactly what `focus:cancel` does, and for a
    // sharper reason here: the row it would have written is about to be wiped
    // by the very restore asking for this.
    cancelFocusSession: (profileId) => {
      runningFocusSessions.delete(profileId);
    },
    saveBlob: (bytes) => saveBlob(blobStorePathsFor(), requireBlobKeys(), bytes),
    deleteBlobIfOrphaned: (sha256, refCount) =>
      deleteBlobIfOrphaned(blobStorePathsFor(), requireBlobKeys(), sha256, refCount),
  };
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.authStatus, (event): AuthStatus => {
    assertTrustedSender(event);
    return computeAuthStatus();
  });

  ipcMain.handle(IpcChannel.authCreate, (event, payload): Promise<AuthResult> => {
    assertTrustedSender(event);
    const passcode = asPasscode(asRecord(payload).passcode, "passcode");
    return handleAuthCreate(passcode);
  });

  ipcMain.handle(IpcChannel.authUnlock, (event, payload): Promise<AuthResult> => {
    assertTrustedSender(event);
    const passcode = asPasscode(asRecord(payload).passcode, "passcode");
    return handleAuthUnlock(passcode);
  });

  ipcMain.handle(IpcChannel.authRecover, (event, payload): Promise<AuthResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const recoveryCode = asRecoveryCodeInput(body.recoveryCode, "recoveryCode");
    const newPasscode = asPasscode(body.newPasscode, "newPasscode");
    return handleAuthRecover(recoveryCode, newPasscode);
  });

  ipcMain.handle(IpcChannel.authChangePasscode, (event, payload): Promise<AuthResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const currentPasscode = asPasscode(body.currentPasscode, "currentPasscode");
    const nextPasscode = asPasscode(body.nextPasscode, "nextPasscode");
    return handleAuthChangePasscode(currentPasscode, nextPasscode);
  });

  ipcMain.handle(IpcChannel.authRegenerateRecovery, (event): Promise<AuthResult> => {
    assertTrustedSender(event);
    return handleAuthRegenerateRecovery();
  });

  ipcMain.handle(IpcChannel.authLock, (event): void => {
    assertTrustedSender(event);
    performLock();
  });

  ipcMain.handle(IpcChannel.profilesList, (event): Profile[] => {
    assertTrustedSender(event);
    return listProfiles(requireDb());
  });

  ipcMain.handle(IpcChannel.profilesRename, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const id = asNonEmptyString(body.id, "id");
    const name = asProfileName(body.name, "name");
    renameProfile(requireDb(), id, name);
  });

  ipcMain.handle(IpcChannel.flagsGet, (event, payload): Promise<FlagState> => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return new SqliteFlagStore(requireDb().raw, profileId).get();
  });

  ipcMain.handle(IpcChannel.flagsSet, async (event, payload): Promise<void> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const moduleId = asNonEmptyString(body.moduleId, "moduleId");
    const enabled = asBoolean(body.enabled, "enabled");
    await new SqliteFlagStore(requireDb().raw, profileId).set(moduleId, enabled);
  });

  ipcMain.handle(IpcChannel.tasksList, (event, payload): Task[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return taskStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.tasksCreate, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    return taskStore(profileId).create(asNewTaskInput(body.task));
  });

  ipcMain.handle(IpcChannel.tasksUpdate, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return taskStore(profileId).update(id, asTaskFieldChanges(body.changes));
  });

  ipcMain.handle(IpcChannel.tasksSetDone, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const done = asBoolean(body.done, "done");
    return taskStore(profileId).setDone(id, done);
  });

  ipcMain.handle(IpcChannel.tasksDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    taskStore(profileId).softDelete(id);
  });

  ipcMain.handle(IpcChannel.tasksRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    taskStore(profileId).restore(id);
  });

  // SEC-EL-02: `now` is stamped here from main's own clock — when an occurrence
  // was completed (and so where a series continues from) is never the
  // renderer's to say.
  ipcMain.handle(IpcChannel.tasksCompleteOccurrence, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return taskStore(profileId).completeOccurrence(id, new Date().toISOString());
  });

  // --- Task lists and sections (TASK-004 / ADR-029) ---------------------
  //
  // SEC-EL-02 as everywhere else: `assertTrustedSender` first, every field
  // through an `as*` validator, and every `now` stamped from main's own clock —
  // when a list was renamed or reordered is never the renderer's to say.

  ipcMain.handle(IpcChannel.taskListsList, (event, payload): TaskListsSnapshot => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    const lists = taskListStore(profileId);
    const active = lists.listActive();
    // One reply for the whole rail: the sections follow the same list order, so
    // the renderer can never hold sections of a list this reply did not list.
    return { lists: active, sections: active.flatMap((list) => lists.listSections(list.id)) };
  });

  ipcMain.handle(IpcChannel.taskListsCreate, (event, payload): TaskList => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const name = asTaskListName(body.name, "name");
    const parentId = asNullableString(body.parentId, "parentId");
    return taskListStore(profileId).createList({ name, parentId }, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskListsRename, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const name = asTaskListName(body.name, "name");
    taskListStore(profileId).renameList(id, name, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskListsSetView, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const view = asTaskListView(body.view, "view");
    taskListStore(profileId).setDefaultView(id, view, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskListsMove, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const parentId = asNullableString(body.parentId, "parentId");
    const beforeId = asNullableString(body.beforeId, "beforeId");
    const afterId = asNullableString(body.afterId, "afterId");
    taskListStore(profileId).moveList(id, parentId, beforeId, afterId, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskListsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const mode = asDeleteListMode(body.mode, "mode");
    taskListStore(profileId).deleteList(id, mode, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskListsRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    taskListStore(profileId).restoreList(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskSectionsCreate, (event, payload): TaskSection => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const listId = asNonEmptyString(body.listId, "listId");
    const name = asTaskListName(body.name, "name");
    return taskListStore(profileId).createSection(listId, name, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskSectionsRename, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const name = asTaskListName(body.name, "name");
    taskListStore(profileId).renameSection(id, name, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskSectionsMove, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const beforeId = asNullableString(body.beforeId, "beforeId");
    const afterId = asNullableString(body.afterId, "afterId");
    taskListStore(profileId).moveSection(id, beforeId, afterId, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskSectionsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    taskListStore(profileId).deleteSection(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.tasksMoveToList, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const listId = asNonEmptyString(body.listId, "listId");
    return taskStore(profileId).moveToList(id, listId, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.tasksMoveToSection, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const sectionId = asNullableString(body.sectionId, "sectionId");
    return taskStore(profileId).moveToSection(id, sectionId, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.tasksReorder, (event, payload): Task => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const beforeId = asNullableString(body.beforeId, "beforeId");
    const afterId = asNullableString(body.afterId, "afterId");
    return taskStore(profileId).reorder(id, beforeId, afterId, new Date().toISOString());
  });

  // --- Task tags (migration 023) -----------------------------------------
  //
  // The `note-tags:*` surface one module over, channel for channel: the same
  // feature on a different entity, so a second set of semantics would only mean
  // two things for the UI to explain. SEC-EL-02 as everywhere: sender checked
  // first, every field through an `as*` validator, and `createTag`'s `now`
  // stamped from main's own clock.

  ipcMain.handle(IpcChannel.taskTagsList, (event, payload): TaskTag[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return taskTagStore(profileId).listTags();
  });

  ipcMain.handle(IpcChannel.taskTagsCreate, (event, payload): TaskTag => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const name = asTaskTagName(body.name, "name");
    return taskTagStore(profileId).createTag(name, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.taskTagsRename, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const name = asTaskTagName(body.name, "name");
    taskTagStore(profileId).renameTag(id, name);
  });

  ipcMain.handle(IpcChannel.taskTagsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    taskTagStore(profileId).deleteTag(id);
  });

  ipcMain.handle(IpcChannel.taskTagLinksList, (event, payload): TaskTagLink[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return taskTagStore(profileId).listTagLinks();
  });

  ipcMain.handle(IpcChannel.taskTagsAttach, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const taskId = asNonEmptyString(body.taskId, "taskId");
    const tagId = asNonEmptyString(body.tagId, "tagId");
    taskTagStore(profileId).attachTag(taskId, tagId);
  });

  ipcMain.handle(IpcChannel.taskTagsDetach, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const taskId = asNonEmptyString(body.taskId, "taskId");
    const tagId = asNonEmptyString(body.tagId, "tagId");
    taskTagStore(profileId).detachTag(taskId, tagId);
  });

  ipcMain.handle(IpcChannel.eventsList, (event, payload): Event[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return eventStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.eventsCreate, (event, payload): Event => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    return eventStore(profileId).create(asNewEventInput(body.event));
  });

  ipcMain.handle(IpcChannel.eventsUpdate, (event, payload): Event => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return eventStore(profileId).update(id, asEventFieldChanges(body.changes));
  });

  ipcMain.handle(IpcChannel.eventsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    eventStore(profileId).softDelete(id);
  });

  ipcMain.handle(IpcChannel.eventsRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    eventStore(profileId).restore(id);
  });

  // ADR-024: the two series operations. The occurrence date is the renderer's
  // (it names a day the user pointed at), but `now` is stamped here from main's
  // own clock, as everywhere else on this wire.
  ipcMain.handle(IpcChannel.eventsAddRecurrenceExdate, (event, payload): Event => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const date = asBareDate(body.date, "date");
    return eventStore(profileId).addRecurrenceExdate(id, date, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.eventsSplitRecurrence, (event, payload): Event => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const occurrenceDate = asBareDate(body.occurrenceDate, "occurrenceDate");
    return eventStore(profileId).splitRecurrence(id, occurrenceDate, new Date().toISOString());
  });

  // CAL-007 (ADR-026). `PeopleStore` takes `now` from its caller rather than
  // reading the clock, so every mutating handler below stamps it here from
  // main's own clock — when a person was added or edited is never the
  // renderer's to say (SEC-EL-02), exactly as with the task/event writes above.
  ipcMain.handle(IpcChannel.peopleList, (event, payload): Person[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return peopleStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.peopleCreate, (event, payload): Person => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    return peopleStore(profileId).create(asNewPersonInput(body.person), new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.peopleUpdate, (event, payload): Person => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return peopleStore(profileId).update(
      id,
      asPersonFieldChanges(body.changes),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.peopleDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    peopleStore(profileId).softDelete(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.peopleRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    peopleStore(profileId).restore(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.documentsList, (event, payload): TrackedDocument[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return documentStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.documentsCreate, (event, payload): TrackedDocument => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    return documentStore(profileId).create(asNewDocumentInput(body.document));
  });

  ipcMain.handle(IpcChannel.documentsUpdate, (event, payload): TrackedDocument => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return documentStore(profileId).update(id, asDocumentFieldChanges(body.changes));
  });

  ipcMain.handle(IpcChannel.documentsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    documentStore(profileId).softDelete(id);
  });

  ipcMain.handle(IpcChannel.documentsRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    documentStore(profileId).restore(id);
  });

  ipcMain.handle(IpcChannel.documentsRenew, (event, payload): TrackedDocument => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const newExpiryDate = asNonEmptyString(body.newExpiryDate, "newExpiryDate");
    return documentStore(profileId).renew(id, newExpiryDate);
  });

  ipcMain.handle(IpcChannel.documentsRenewals, (event, payload): DocumentRenewal[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return documentStore(profileId).listRenewals(id);
  });

  ipcMain.handle(IpcChannel.subjectsList, (event, payload): Subject[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return subjectStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.subjectsCreate, (event, payload): Subject => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    return subjectStore(profileId).create(asNewSubjectInput(body.subject));
  });

  ipcMain.handle(IpcChannel.subjectsUpdate, (event, payload): Subject => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return subjectStore(profileId).update(id, asSubjectFieldChanges(body.changes));
  });

  ipcMain.handle(IpcChannel.subjectsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    subjectStore(profileId).softDelete(id);
  });

  ipcMain.handle(IpcChannel.subjectsRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    subjectStore(profileId).restore(id);
  });

  ipcMain.handle(IpcChannel.examsList, (event, payload): Exam[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return examStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.examsCreate, (event, payload): Exam => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    return examStore(profileId).create(asNewExamInput(body.exam));
  });

  ipcMain.handle(IpcChannel.examsUpdate, (event, payload): Exam => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return examStore(profileId).update(id, asExamFieldChanges(body.changes));
  });

  ipcMain.handle(IpcChannel.examsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    examStore(profileId).softDelete(id);
  });

  ipcMain.handle(IpcChannel.examsRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    examStore(profileId).restore(id);
  });

  ipcMain.handle(IpcChannel.decksList, (event, payload): Deck[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return deckStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.decksCreate, (event, payload): Deck => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    return deckStore(profileId).create(asNewDeckInput(body.deck));
  });

  ipcMain.handle(IpcChannel.decksUpdate, (event, payload): Deck => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return deckStore(profileId).update(id, asDeckFieldChanges(body.changes));
  });

  ipcMain.handle(IpcChannel.decksDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    deckStore(profileId).softDelete(id);
  });

  ipcMain.handle(IpcChannel.decksRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    deckStore(profileId).restore(id);
  });

  ipcMain.handle(IpcChannel.cardsListByDeck, (event, payload): Card[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const deckId = asNonEmptyString(body.deckId, "deckId");
    return cardStore(profileId).listByDeck(deckId);
  });

  ipcMain.handle(IpcChannel.cardsCreate, (event, payload): Card => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    return cardStore(profileId).create(asNewCardInput(body.card), new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.cardsUpdate, (event, payload): Card => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return cardStore(profileId).update(id, asCardFieldChanges(body.changes));
  });

  ipcMain.handle(IpcChannel.cardsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    cardStore(profileId).softDelete(id);
  });

  ipcMain.handle(IpcChannel.cardsRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    cardStore(profileId).restore(id);
  });

  ipcMain.handle(IpcChannel.cardsCounts, (event, payload): DeckCounts[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return cardStore(profileId).countsByDeck(new Date().toISOString());
  });

  // SEC-EL-02: `now` is always stamped here from the main process's own clock —
  // the renderer's `now` is never trusted for FSRS scheduling decisions.
  ipcMain.handle(IpcChannel.reviewQueue, (event, payload): Card[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const scope: { deckId?: string; subjectId?: string; newLimit?: number } = {};
    if (body.deckId !== undefined) scope.deckId = asNonEmptyString(body.deckId, "deckId");
    if (body.subjectId !== undefined) scope.subjectId = asNonEmptyString(body.subjectId, "subjectId");
    if (body.newLimit !== undefined) scope.newLimit = asInteger(body.newLimit, "newLimit");
    return cardStore(profileId).dueQueue(scope, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.reviewGrade, (event, payload): Card => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const rating = asCardRating(body.rating, "rating");
    return cardStore(profileId).review(id, rating, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.reviewUndo, (event, payload): Card => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return cardStore(profileId).undoLastReview(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.reviewPreview, (event, payload): PreviewIntervals => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return cardStore(profileId).previewIntervals(id, new Date().toISOString());
  });

  // SEC-EL-02: `now`/`today` are always stamped here from the main process's own
  // clock — the renderer never supplies either for plan/block date math.
  ipcMain.handle(IpcChannel.plansList, (event, payload): StudyPlan[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return planStore(profileId).listActive();
  });

  ipcMain.handle(IpcChannel.plansCreate, (event, payload): StudyPlan => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    return planStore(profileId).createPlan(
      asNewPlanInput(body.plan),
      new Date().toISOString(),
      localToday(),
    );
  });

  ipcMain.handle(IpcChannel.plansUpdate, (event, payload): StudyPlan => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return planStore(profileId).updatePlan(
      id,
      asPlanFieldChanges(body.changes),
      new Date().toISOString(),
      localToday(),
    );
  });

  ipcMain.handle(IpcChannel.plansDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    planStore(profileId).softDelete(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.plansRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    planStore(profileId).restore(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.plansSyncAll, (event, payload): number => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return planStore(profileId).syncAll(new Date().toISOString(), localToday());
  });

  ipcMain.handle(IpcChannel.blocksListByPlan, (event, payload): StudyBlock[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const planId = asNonEmptyString(body.planId, "planId");
    return planStore(profileId).listBlocks(planId);
  });

  ipcMain.handle(IpcChannel.blocksRange, (event, payload): StudyBlockWithExam[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const fromDate = asNonEmptyString(body.fromDate, "fromDate");
    const toDate = asNonEmptyString(body.toDate, "toDate");
    return planStore(profileId).listBlocksInRange(fromDate, toDate);
  });

  ipcMain.handle(IpcChannel.blocksSetStatus, (event, payload): StudyBlock => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const status = asBlockStatus(body.status, "status");
    return planStore(profileId).setBlockStatus(id, status, new Date().toISOString());
  });

  // SEC-EL-02: `startedAt`/`endedAt`/`now` are always stamped here from the
  // main process's own clock — the renderer never supplies a timer boundary.
  // The running timer itself lives only in `runningFocusSessions` (see its
  // declaration); a crash or restart loses it honestly, never a fabricated row.
  ipcMain.handle(IpcChannel.focusStart, (event, payload): RunningFocusSession => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const subjectId = asNonEmptyString(body.subjectId, "subjectId");
    if (runningFocusSessions.has(profileId)) {
      throw new Error("A focus session is already running for this profile.");
    }
    // Validates the subject before recording — a running timer is never
    // started against an unknown/foreign/soft-deleted subject.
    focusStore(profileId).resolveSubject(subjectId);
    const running: RunningFocusSession = { subjectId, startedAt: new Date().toISOString() };
    runningFocusSessions.set(profileId, running);
    return running;
  });

  ipcMain.handle(IpcChannel.focusStop, (event, payload): FocusSession | null => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    const running = runningFocusSessions.get(profileId);
    if (!running) {
      throw new Error("No focus session is running for this profile.");
    }
    runningFocusSessions.delete(profileId);

    const endedAt = new Date().toISOString();
    if (endedAt <= running.startedAt) return null; // sub-millisecond stop: discarded, not persisted
    return focusStore(profileId).create(
      { subjectId: running.subjectId, startedAt: running.startedAt, endedAt },
      endedAt,
    );
  });

  ipcMain.handle(IpcChannel.focusStatus, (event, payload): RunningFocusSession | null => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return runningFocusSessions.get(profileId) ?? null;
  });

  ipcMain.handle(IpcChannel.focusCancel, (event, payload): void => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    runningFocusSessions.delete(profileId);
  });

  ipcMain.handle(IpcChannel.focusListRange, (event, payload): FocusSession[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const fromDate = asNonEmptyString(body.fromDate, "fromDate");
    const toDate = asNonEmptyString(body.toDate, "toDate");
    return focusStore(profileId).listRange(fromDate, toDate);
  });

  ipcMain.handle(IpcChannel.focusDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    focusStore(profileId).softDelete(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.focusRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    focusStore(profileId).restore(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.statsStudy, (event, payload): StudyStats => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const fromDate = asNonEmptyString(body.fromDate, "fromDate");
    const toDate = asNonEmptyString(body.toDate, "toDate");
    const stats = statsStore(profileId);
    return {
      subjectMinutes: stats.subjectMinutes(fromDate, toDate),
      activityDays: stats.activityDays(fromDate, toDate),
      reviews: stats.reviewCounts(fromDate, toDate),
      blocks: stats.blockTotals(fromDate, toDate),
    };
  });

  ipcMain.handle(IpcChannel.notificationsCenterList, (event, payload): NotificationRecord[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return notificationStore(profileId).listCenter();
  });

  ipcMain.handle(IpcChannel.notificationsSnooze, (event, payload): NotificationRecord => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const preset = asSnoozePreset(body.preset, "preset");
    const store = notificationStore(profileId);
    const now = new Date();
    const until = computeSnoozeUntil(preset, now, store.getSettings().morningHour);
    const record = store.snooze(id, until, now.toISOString());
    mainWindow?.webContents.send(IpcChannel.notificationsChanged);
    return record;
  });

  ipcMain.handle(IpcChannel.notificationsDismiss, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    notificationStore(profileId).dismiss(id, new Date().toISOString());
    mainWindow?.webContents.send(IpcChannel.notificationsChanged);
  });

  ipcMain.handle(IpcChannel.notificationsSettingsGet, (event, payload): NotificationSettings => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return notificationStore(profileId).getSettings();
  });

  ipcMain.handle(IpcChannel.notificationsSettingsUpdate, (event, payload): NotificationSettings => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const changes = asNotificationSettingsChanges(body.changes);
    return notificationStore(profileId).updateSettings(changes, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.notificationsSourceToggle, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const source = asNotificationSource(body.source, "source");
    const enabled = asBoolean(body.enabled, "enabled");
    notificationStore(profileId).setSourceEnabled(source, enabled, new Date().toISOString());
  });

  // NOTE slice a1 (ADR-012): binary Yjs updates cross this boundary as
  // Uint8Array over structured clone. The store assigns the per-note seq and
  // main owns the compaction lifecycle — neither ever takes renderer input —
  // and `now` is always stamped here from main's own clock (SEC-EL-02).
  ipcMain.handle(IpcChannel.notesList, (event, payload): NoteMeta[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const filter = "folderId" in body ? { folderId: asNullableString(body.folderId, "folderId") } : undefined;
    return noteStore(profileId).list(filter);
  });

  ipcMain.handle(IpcChannel.notesCreate, (event, payload): NoteMeta => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return noteStore(profileId).create(new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.notesLoad, (event, payload): NoteDocPayload => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return noteStore(profileId).load(id);
  });

  ipcMain.handle(IpcChannel.notesAppendUpdate, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const update = asUint8Array(body.update, "update", MAX_NOTE_UPDATE_BYTES);
    const title = asString(body.title, "title");
    const store = noteStore(profileId);
    store.appendUpdate(id, update, title, new Date().toISOString());
    compactIfNeeded(store, id);
    // ADR-021 / SRCH-002 freshness fix: below the compaction threshold the
    // note's searchable body would otherwise only catch up at the NEXT
    // compaction, which could be an entire session away. Re-resolved through
    // `noteStore` rather than closing over `store` so a lock+relock between
    // now and the timer firing can never hand `compactNow` a store built on a
    // stale/closed database handle.
    scheduleIdleCompaction(`${profileId}:${id}`, () => {
      if (!db) return; // locked/closed by the time the timer fired — nothing to do
      compactNow(noteStore(profileId), id);
    });
  });

  ipcMain.handle(IpcChannel.notesDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    noteStore(profileId).softDelete(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.notesRestore, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    noteStore(profileId).restore(id, new Date().toISOString());
  });

  // NOTE-002 (organization): folders/tags/pins. `now` is always stamped here
  // from main's own clock, never accepted from the renderer (SEC-EL-02).
  ipcMain.handle(IpcChannel.noteFoldersList, (event, payload): NoteFolder[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return noteOrgStore(profileId).listFolders();
  });

  ipcMain.handle(IpcChannel.noteFoldersCreate, (event, payload): NoteFolder => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    return noteOrgStore(profileId).createFolder(
      asNoteFolderCreateInput(body.input),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.noteFoldersUpdate, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    noteOrgStore(profileId).updateFolder(
      id,
      asNoteFolderFieldChanges(body.fields),
      new Date().toISOString(),
    );
  });

  ipcMain.handle(IpcChannel.noteFoldersMove, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const newParentId = asNullableString(body.newParentId, "newParentId");
    noteOrgStore(profileId).moveFolder(id, newParentId, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.noteFoldersDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    noteOrgStore(profileId).deleteFolder(id, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.noteTagsList, (event, payload): NoteTag[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return noteOrgStore(profileId).listTags();
  });

  ipcMain.handle(IpcChannel.noteTagsCreate, (event, payload): NoteTag => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    return noteOrgStore(profileId).createTag(asString(body.name, "name"), new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.noteTagsRename, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    noteOrgStore(profileId).renameTag(id, asString(body.name, "name"));
  });

  ipcMain.handle(IpcChannel.noteTagsDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    noteOrgStore(profileId).deleteTag(id);
  });

  ipcMain.handle(IpcChannel.noteTagLinksList, (event, payload): NoteTagLink[] => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return noteOrgStore(profileId).listTagLinks();
  });

  ipcMain.handle(IpcChannel.noteTagsAttach, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const noteId = asNonEmptyString(body.noteId, "noteId");
    const tagId = asNonEmptyString(body.tagId, "tagId");
    noteOrgStore(profileId).attachTag(noteId, tagId);
  });

  ipcMain.handle(IpcChannel.noteTagsDetach, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const noteId = asNonEmptyString(body.noteId, "noteId");
    const tagId = asNonEmptyString(body.tagId, "tagId");
    noteOrgStore(profileId).detachTag(noteId, tagId);
  });

  ipcMain.handle(IpcChannel.notesSetFolder, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const noteId = asNonEmptyString(body.noteId, "noteId");
    const folderId = asNullableString(body.folderId, "folderId");
    noteStore(profileId).setFolder(noteId, folderId);
  });

  ipcMain.handle(IpcChannel.notesSetPinned, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const noteId = asNonEmptyString(body.noteId, "noteId");
    const pinned = asBoolean(body.pinned, "pinned");
    noteStore(profileId).setPinned(noteId, pinned);
  });

  // NOTE-004: `targetIds` is renderer-declared like `title` on
  // notes:append-update (the renderer authors its own document content); the
  // store re-validates semantics (self-link, unknown id, cross-profile id).
  ipcMain.handle(IpcChannel.notesSetLinks, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const targetIds = asStringArray(body.targetIds, "targetIds", MAX_NOTE_LINKS, 64);
    noteStore(profileId).setOutboundLinks(id, targetIds);
  });

  ipcMain.handle(IpcChannel.notesBacklinks, (event, payload): NoteMeta[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return noteStore(profileId).listBacklinks(id);
  });

  // NOTE-008 (version history, ADR-015): checkpoints cross this boundary as
  // browse-list metadata (`notesVersions`) or an opaque snapshot blob
  // (`notesVersionLoad`) — the renderer replays the latter onto a throwaway
  // Y.Doc for a read-only preview. `notesVersionCapture` triggers the
  // pre-restore safety checkpoint; main merges only stored state, so no
  // renderer bytes are involved (the same bounded-harm shape as compaction).
  ipcMain.handle(IpcChannel.notesVersions, (event, payload): NoteVersionMeta[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return noteStore(profileId).listVersions(id);
  });

  ipcMain.handle(IpcChannel.notesVersionLoad, (event, payload): Uint8Array => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const coveredSeq = asPositiveInteger(body.coveredSeq, "coveredSeq");
    return noteStore(profileId).loadVersion(id, coveredSeq);
  });

  ipcMain.handle(IpcChannel.notesVersionCapture, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    captureNoteVersion(noteStore(profileId), id);
  });

  // NOTE-009 (templates, slice 009-a, ADR-016): a template crosses this
  // boundary as an opaque JSON-document string whose semantics the store
  // re-validates (parses to `{ type: "doc", ... }`) — main only checks shape
  // and the byte cap. `now` is stamped here, never accepted from the
  // renderer. `name` is passed through `asString` (not `asNonEmptyString`)
  // deliberately: emptiness after trimming is a domain rule the store owns
  // and reports as `NoteTemplateValidationError`, the same treatment
  // `noteTagsCreate`/`noteTagsRename` give tag names.
  ipcMain.handle(IpcChannel.notesTemplatesList, (event, payload): NoteTemplate[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    return noteTemplateStore(profileId).list();
  });

  ipcMain.handle(IpcChannel.notesTemplateSave, (event, payload): NoteTemplate => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const name = asString(body.name, "name");
    const content = asCappedString(body.content, "content", MAX_NOTE_TEMPLATE_BYTES);
    return noteTemplateStore(profileId).save(name, content, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.notesTemplateRename, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const name = asString(body.name, "name");
    noteTemplateStore(profileId).rename(id, name, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.notesTemplateDelete, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    noteTemplateStore(profileId).remove(id);
  });

  // NOTE-006 (inline flashcards): `cards` is renderer-declared derived data
  // about the note's own content, the same trust model as `targetIds` on
  // notes:set-links — main only checks shape/caps, and
  // `CardStore.syncFromNote` re-validates that the note and deck are both
  // live in this profile before reconciling. The returned create/update/
  // remove counts are discarded: the editor already knows what it sent, and
  // the counts exist for the store's own tests.
  ipcMain.handle(IpcChannel.notesCardsSync, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const deckId = asNonEmptyString(body.deckId, "deckId");
    const cards = asNoteCardSpecArray(body.cards, "cards");
    cardStore(profileId).syncFromNote(id, deckId, cards, new Date().toISOString());
  });

  ipcMain.handle(IpcChannel.notesCardDeckSet, (event, payload): void => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const deckId = asNullableString(body.deckId, "deckId");
    noteStore(profileId).setCardDeck(id, deckId, new Date().toISOString());
  });

  // NOTE-003 (attachments, slice 003-a, ADR-014): bytes are content-addressed
  // on disk (main/attachments.ts) — only this index row crosses IPC as
  // structured data; `mime` is always main-sniffed from `bytes` (SEC-FILE-02),
  // never the renderer's claim, and `now` is stamped here, never accepted
  // from the renderer.
  ipcMain.handle(IpcChannel.noteAttachmentsList, (event, payload): NoteAttachment[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    return noteAttachmentStore(profileId).list(id);
  });

  ipcMain.handle(IpcChannel.noteAttachmentsAdd, async (event, payload): Promise<NoteAttachment> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const fileName = asNonEmptyString(body.fileName, "fileName");
    const bytes = asUint8Array(body.bytes, "bytes", MAX_NOTE_ATTACHMENT_BYTES);

    const store = noteAttachmentStore(profileId);
    const mime = sniffMime(bytes);
    const { sha256 } = await saveBlob(blobStorePathsFor(), requireBlobKeys(), bytes);
    try {
      return store.add(
        id,
        { fileName, mime, sizeBytes: bytes.byteLength, sha256 },
        new Date().toISOString(),
      );
    } catch (error) {
      // The blob was already written (write-if-absent); if the row failed to
      // insert (e.g. an unknown/soft-deleted note), GC it so a failed add
      // never leaves an orphan file — but only if nothing else references it.
      await deleteBlobIfOrphaned(
        blobStorePathsFor(),
        requireBlobKeys(),
        sha256,
        store.refCount(sha256),
      );
      throw error;
    }
  });

  ipcMain.handle(IpcChannel.noteAttachmentsRemove, async (event, payload): Promise<void> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const attachmentId = asNonEmptyString(body.attachmentId, "attachmentId");

    const store = noteAttachmentStore(profileId);
    const removed = store.remove(id, attachmentId);
    await deleteBlobIfOrphaned(
      blobStorePathsFor(),
      requireBlobKeys(),
      removed.sha256,
      store.refCount(removed.sha256),
    );
  });

  ipcMain.handle(IpcChannel.noteAttachmentsOpen, async (event, payload): Promise<void> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const id = asNonEmptyString(body.id, "id");
    const attachmentId = asNonEmptyString(body.attachmentId, "attachmentId");

    const attachment = requireNoteAttachment(profileId, id, attachmentId);
    await openExternally(blobStorePathsFor(), requireBlobKeys(), tmpOpenDirPath(), attachment);
  });

  ipcMain.handle(
    IpcChannel.noteAttachmentsSaveAs,
    (event, payload): Promise<SaveAttachmentResult> => {
      assertTrustedSender(event);
      const body = asRecord(payload);
      const profileId = asNonEmptyString(body.profileId, "profileId");
      const id = asNonEmptyString(body.id, "id");
      const attachmentId = asNonEmptyString(body.attachmentId, "attachmentId");

      const attachment = requireNoteAttachment(profileId, id, attachmentId);
      return saveAttachmentAs(mainWindow, blobStorePathsFor(), requireBlobKeys(), attachment);
    },
  );

  // Global search (ADR-021 / PRD 08 SRCH-001/002): `runSearchQuery`/
  // `runRecentSearch` own the actual pipeline (see their doc comments) so the
  // smoke rehearsal can call the exact same code the renderer does.
  ipcMain.handle(IpcChannel.searchQuery, (event, payload): SearchResult[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const query = asCappedString(body.query, "query", SEARCH_QUERY_MAX_BYTES);
    const limit = Math.min(asPositiveInteger(body.limit, "limit"), SEARCH_RESULT_MAX_LIMIT);
    return runSearchQuery(profileId, query, limit);
  });

  ipcMain.handle(IpcChannel.searchRecent, (event, payload): SearchResult[] => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const limit = Math.min(asPositiveInteger(body.limit, "limit"), SEARCH_RESULT_MAX_LIMIT);
    return runRecentSearch(profileId, limit);
  });

  /**
   * Rebuilds the ENTIRE file's search index (`rebuildSearchIndex`), not just
   * this profile's slice of it — deliberately whole-file, since the index is
   * derived data and a repair cannot be half-done. `profileId` is validated
   * only to prove the caller is in a real, unlocked session; it plays no part
   * in what gets rebuilt.
   */
  ipcMain.handle(IpcChannel.searchRebuild, (event, payload): number => {
    assertTrustedSender(event);
    asNonEmptyString(asRecord(payload).profileId, "profileId");
    return rebuildSearchIndex(requireDb().raw);
  });

  // IMEX slice a1 (PRD 14 IMEX-001, extended by ADR-022): gathers this
  // profile's data and streams it to a path the native save dialog returns —
  // never a path the renderer supplies (SEC-EL) — either as a plain
  // `.nexus.zip` or, when `passphrase` is non-null, sealed into an `.nexus`
  // `NXA1` container under a key derived from it.
  ipcMain.handle(IpcChannel.imexExport, (event, payload): Promise<ExportResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const passphrase = asArchivePassphrase(body.passphrase, "passphrase");
    const profile = requireProfile(requireDb(), profileId);
    return handleExport(
      {
        taskStore,
        taskListStore,
        taskTagStore,
        eventStore,
        peopleStore,
        documentStore,
        subjectStore,
        examStore,
        deckStore,
        cardStore,
        planStore,
        focusStore,
        notificationStore,
        noteStore,
        noteOrgStore,
        noteTemplateStore,
        noteAttachmentStore,
        readBlob: (sha256) => readBlob(blobStorePathsFor(), requireBlobKeys(), sha256),
        flagStore,
        getMainWindow: () => mainWindow,
      },
      profile,
      passphrase,
    );
  });

  // IMEX restore (ADR-023, slice 3c). Each of these is a thin validation shim
  // over `main/restore.ts`, which owns the whole sequence — pick, dry-run
  // preview, apply, undo — and holds the only state involved. The renderer
  // never supplies a filesystem path: `imex:restore-pick` is the sole source of
  // one, and every later call refers to that pick without naming it (SEC-EL).
  ipcMain.handle(IpcChannel.imexRestorePick, (event): Promise<RestorePickResult> => {
    assertTrustedSender(event);
    return pickRestoreFile(restoreDeps());
  });

  ipcMain.handle(IpcChannel.imexRestorePreview, (event, payload): Promise<RestorePreviewResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const passphrase = asRestorePassphrase(body.passphrase, "passphrase");
    return previewRestore(restoreDeps(), profileId, passphrase);
  });

  ipcMain.handle(IpcChannel.imexRestoreApply, (event, payload): Promise<RestoreApplyResult> => {
    assertTrustedSender(event);
    const body = asRecord(payload);
    const profileId = asNonEmptyString(body.profileId, "profileId");
    const token = asRestoreToken(body.token, "token");
    return applyRestore(restoreDeps(), profileId, token);
  });

  ipcMain.handle(IpcChannel.imexRestoreUndo, (event, payload): Promise<RestoreUndoResult> => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return undoRestore(restoreDeps(), profileId);
  });

  ipcMain.handle(IpcChannel.imexRestoreStatus, (event, payload): RestoreStatus => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    return restoreStatus(profileId);
  });

  ipcMain.handle(IpcChannel.imexRestoreCancel, (event): Promise<void> => {
    assertTrustedSender(event);
    return cancelRestore();
  });

  ipcMain.handle(IpcChannel.appInfo, (event): AppInfo => {
    assertTrustedSender(event);
    return appInfo();
  });
}

// --- Window (hardened) ------------------------------------------------------

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 720,
    show: false, // shown on ready-to-show to avoid a blank-white first paint
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true, // SEC-EL-01
      nodeIntegration: false, // SEC-EL-01
      sandbox: true, // SEC-EL-01
      // webSecurity is left at its secure default and never touched (SEC-EL-01).
    },
  });

  win.once("ready-to-show", () => win.show());

  // SEC-EL-03: deny every attempt to open a new window. The shell has no external
  // links yet; a vetted shell.openExternal wrapper lands with the first one.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // SEC-EL-03: lock navigation to the app's own document; block anything else.
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

// --- Smoke check ------------------------------------------------------------
//
// `--smoke`: prove the shell is wired end to end, then exit deterministically.
// Combines an authoritative main-side DB read with confirmation that the
// renderer completed a real window.nexus round trip (renderer -> preload -> IPC
// -> DB -> renderer). No extra IPC channel is added: the renderer flags its own
// readiness on `window`, which main reads via executeJavaScript.
//
// ADR-018: the app now starts locked, so the renderer's own round trip needs
// the database open before the window even loads — `runSmokeAuthSetup` (called
// from `app.whenReady` before `createWindow`) creates the smoke run's own
// throwaway account for exactly that reason. This function then proves the
// rest of the auth cycle for real: unlocked -> lock -> locked -> unlock (right
// passcode) -> unlock (wrong passcode) -> still-working data channel.

/** Runs before the window exists: creates the smoke run's own account so the renderer's readiness round-trip (which calls a data channel) has something to succeed against. */
async function runSmokeAuthSetup(): Promise<void> {
  const before = readStatus(userDataDir());
  if (before.state !== "uninitialized") {
    throw new Error(`expected an uninitialized account before smoke setup, got "${before.state}"`);
  }
  const created = await handleAuthCreate(SMOKE_PASSCODE);
  if (!created.ok) {
    throw new Error(`smoke account creation failed: ${created.reason}`);
  }
  if (created.recoveryCode === undefined) {
    throw new Error("account creation returned no Recovery Kit code");
  }
  smokeRecoveryCode = created.recoveryCode;
}

/**
 * The Recovery Kit code the smoke account was created with — kept only so the
 * migration rehearsal below can use it. A real account hands the code to the
 * user once and never holds on to it.
 */
let smokeRecoveryCode = "";

/** The passcode the migration rehearsal sets while recovering, to prove the re-bound wrap actually works afterwards. */
const SMOKE_MIGRATED_PASSCODE = "migrated-passcode-2";

/**
 * Rehearses the device-migration path (ADR-018) end to end against the real OS
 * keystore — the one flow that cannot be unit-tested, because its whole point
 * is what DPAPI does with a blob it did not produce.
 *
 * Carrying `nexus.db` + `keychain.json` to another machine (or another Windows
 * account) is simulated by overwriting `guard` with bytes this machine's DPAPI
 * cannot decrypt, which is exactly what a foreign blob looks like from here.
 * The passcode must then refuse with `otherDevice` rather than lie about being
 * wrong, the Recovery Kit must still open the database, and the new passcode it
 * sets must be usable on the next lock — that last step is what proves recovery
 * re-bound the wrap to *this* device instead of leaving the account permanently
 * recovery-only.
 */
async function runSmokeMigrationRehearsal(): Promise<void> {
  performLock();

  const keychainFile = join(userDataDir(), "keychain.json");
  const parsed: unknown = JSON.parse(readFileSync(keychainFile, "utf8"));
  const foreignGuard = { ...(parsed as Record<string, unknown>), guard: randomBytes(64).toString("base64") };
  writeFileSync(keychainFile, JSON.stringify(foreignGuard, null, 2));

  const migratedStatus = computeAuthStatus();
  if (!migratedStatus.requiresRecovery || migratedStatus.state !== "locked") {
    throw new Error(
      `expected a foreign guard to read as locked + requiresRecovery, got ${JSON.stringify(migratedStatus)}`,
    );
  }

  const passcodeOnOtherDevice = await handleAuthUnlock(SMOKE_PASSCODE);
  if (passcodeOnOtherDevice.ok || passcodeOnOtherDevice.reason !== "otherDevice") {
    throw new Error(
      `expected the passcode to refuse with "otherDevice", got ${JSON.stringify(passcodeOnOtherDevice)}`,
    );
  }

  const recovered = await handleAuthRecover(smokeRecoveryCode, SMOKE_MIGRATED_PASSCODE);
  if (!recovered.ok) {
    throw new Error(`expected the Recovery Kit to open a migrated account, got reason "${recovered.reason}"`);
  }
  if (listProfiles(requireDb()).length < 1) {
    throw new Error("expected the profile to be readable after recovery");
  }

  performLock();
  const afterMigration = await handleAuthUnlock(SMOKE_MIGRATED_PASSCODE);
  if (!afterMigration.ok) {
    throw new Error(
      `expected the passcode set during recovery to work on this device, got reason "${afterMigration.reason}"`,
    );
  }
}

/**
 * Rehearses the ADR-019 attachment-encryption migration end to end against
 * the real filesystem — the one flow that cannot be exercised by
 * `@nexus/core/auth`'s own unit tests, because its whole point is what a real
 * `<userData>/attachments` legacy tree looks like to `migrateLegacyBlobs`.
 * Runs after `runSmokeMigrationRehearsal`, which leaves the app unlocked (its
 * final step is a passcode unlock on the migrated account), so `blobKeys` is
 * already populated here.
 *
 * Proves, in order: (1) a hand-written legacy plaintext blob is readable
 * through the dual-read window before any migration runs; (2) migrating it
 * moves it into the encrypted store as a genuine `NXB1` container and removes
 * the now-empty legacy tree; (3) a fresh `saveBlob` never touches plaintext
 * on disk either; (4) running the migration again is a true no-op.
 */
async function runSmokeBlobMigrationRehearsal(): Promise<void> {
  const paths = blobStorePathsFor();
  const keys = requireBlobKeys();
  // The last unlock started a migration pass of its own; let it finish before
  // planting a legacy blob, so the two never walk the tree at the same time.
  await legacyMigrationTask;

  // 1. The dual-read window.
  const legacyBytes = Buffer.from("legacy attachment bytes for the smoke rehearsal");
  const legacySha256 = createHash("sha256").update(legacyBytes).digest("hex");
  const legacyFanoutDir = join(paths.legacyDir, legacySha256.slice(0, 2));
  mkdirSync(legacyFanoutDir, { recursive: true });
  writeFileSync(join(legacyFanoutDir, legacySha256), legacyBytes);

  const beforeMigration = await readBlob(paths, keys, legacySha256);
  if (beforeMigration === null || !Buffer.from(beforeMigration).equals(legacyBytes)) {
    throw new Error("expected readBlob to serve the hand-written legacy blob before migration");
  }

  // 2. The migration.
  const migrationResult = await migrateLegacyBlobs(paths, keys, () => true);
  if (migrationResult.migrated < 1 || migrationResult.skipped !== 0) {
    throw new Error(
      `expected the migration to move at least one blob with nothing skipped, got ${JSON.stringify(migrationResult)}`,
    );
  }
  if (existsSync(join(legacyFanoutDir, legacySha256))) {
    throw new Error("expected the legacy blob file to be gone after migration");
  }
  if (existsSync(paths.legacyDir)) {
    throw new Error("expected the legacy attachments directory to be removed after a clean migration");
  }

  const legacyStorageName = await blobStorageName(keys.nameKey, legacySha256);
  const migratedContainer = readFileSync(
    join(paths.dir, legacyStorageName.slice(0, 2), legacyStorageName),
  );
  if (migratedContainer.subarray(0, 4).toString("ascii") !== "NXB1") {
    throw new Error("expected the migrated blob's on-disk container to start with the NXB1 magic");
  }
  if (migratedContainer.includes(legacyBytes)) {
    throw new Error("expected the migrated blob's on-disk container to NOT contain its plaintext");
  }

  const afterMigration = await readBlob(paths, keys, legacySha256);
  if (afterMigration === null || !Buffer.from(afterMigration).equals(legacyBytes)) {
    throw new Error("expected readBlob to still serve the migrated blob's original bytes");
  }

  // 3. A fresh save is encrypted, never plaintext, on disk.
  const freshBytes = Buffer.from("fresh attachment bytes written after unlock");
  const { sha256: freshSha256 } = await saveBlob(paths, keys, freshBytes);
  const freshStorageName = await blobStorageName(keys.nameKey, freshSha256);
  const freshContainer = readFileSync(join(paths.dir, freshStorageName.slice(0, 2), freshStorageName));
  if (freshContainer.subarray(0, 4).toString("ascii") !== "NXB1") {
    throw new Error("expected a freshly saved blob's on-disk container to start with the NXB1 magic");
  }
  if (freshContainer.includes(freshBytes)) {
    throw new Error("expected a freshly saved blob's on-disk container to NOT contain its plaintext");
  }
  const freshReadBack = await readBlob(paths, keys, freshSha256);
  if (freshReadBack === null || !Buffer.from(freshReadBack).equals(freshBytes)) {
    throw new Error("expected readBlob to round-trip a freshly saved blob");
  }

  // 4. Idempotence: nothing left to migrate, and it must not throw.
  const secondPass = await migrateLegacyBlobs(paths, keys, () => true);
  if (secondPass.migrated !== 0 || secondPass.skipped !== 0) {
    throw new Error(`expected a second migration pass to be a no-op, got ${JSON.stringify(secondPass)}`);
  }
}

/**
 * Rehearses global search end to end (ADR-021 / PRD 08 SRCH-002) through the
 * real store, `runSearchQuery`/`runRecentSearch` and `rebuildSearchIndex` —
 * the diacritic fold is the one thing that is worth proving against the
 * packaged app's own connection (the `nx_fold` SQL function `openDatabase`
 * registers), not just against `@nexus/core`'s pure functions in isolation.
 */
function runSmokeSearchRehearsal(): void {
  const [profile] = listProfiles(requireDb());
  if (!profile) throw new Error("expected at least one profile for the search rehearsal");

  const task = taskStore(profile.id).create({ title: "Rešenje za Đorđa" });
  try {
    for (const query of ["resenje", "djordja"]) {
      const results = runSearchQuery(profile.id, query, 10);
      const hit = results.find((result) => result.entityId === task.id);
      if (!hit) {
        throw new Error(
          `expected query "${query}" to find the diacritic task, got ${JSON.stringify(results)}`,
        );
      }
      if (hit.titleRanges.length === 0) {
        throw new Error(`expected query "${query}" to produce a non-empty titleRanges`);
      }
    }

    const recent = runRecentSearch(profile.id, 10);
    if (!recent.some((result) => result.entityId === task.id)) {
      throw new Error("expected the freshly created task to appear in runRecentSearch");
    }

    // A kind chip clicked with nothing typed sends exactly this: a kind prefix
    // and no words. It has no matchable term, so it falls through to the
    // recent list — which still has to honour the filter, or "show me only my
    // tasks" answers with everything.
    const note = noteStore(profile.id).create(new Date().toISOString());
    try {
      const kindOnly = runSearchQuery(profile.id, "z:", 10);
      if (!kindOnly.some((result) => result.entityId === task.id)) {
        throw new Error('expected the kind-only query "z:" to still list the task');
      }
      if (kindOnly.some((result) => result.kind !== "task")) {
        throw new Error(
          `expected the kind-only query "z:" to return tasks only, got ${JSON.stringify(
            kindOnly.map((result) => result.kind),
          )}`,
        );
      }
    } finally {
      noteStore(profile.id).softDelete(note.id, new Date().toISOString());
    }

    const rawDb = requireDb().raw;
    const rebuiltCount = rebuildSearchIndex(rawDb);
    const { count: indexedCount } = rawDb
      .prepare("SELECT count(*) AS count FROM search_entries")
      .get() as { count: number };
    if (rebuiltCount !== indexedCount) {
      throw new Error(
        `expected rebuildSearchIndex's returned count (${rebuiltCount}) to match search_entries' row count (${indexedCount})`,
      );
    }

    const afterRebuild = runSearchQuery(profile.id, "resenje", 10);
    if (!afterRebuild.some((result) => result.entityId === task.id)) {
      throw new Error("expected the task to still be findable after rebuildSearchIndex");
    }
  } finally {
    taskStore(profile.id).softDelete(task.id);
  }
}

async function runSmoke(win: BrowserWindow): Promise<void> {
  const profiles = listProfiles(requireDb());
  if (profiles.length < 1) {
    throw new Error("expected at least one profile after first-run seeding");
  }

  const rendererOk: unknown = await win.webContents.executeJavaScript(
    `new Promise((resolve) => {
       if (window.__nexusReady === true) return resolve(true);
       if (window.__nexusError === true) return resolve(false);
       window.addEventListener("nexus-ready", () => resolve(true), { once: true });
       window.addEventListener("nexus-error", () => resolve(false), { once: true });
       setTimeout(() => resolve(window.__nexusReady === true), 8000);
     })`,
  );
  if (rendererOk !== true) {
    throw new Error("renderer IPC round-trip did not succeed");
  }

  const unlockedStatus = computeAuthStatus();
  if (unlockedStatus.state !== "unlocked") {
    throw new Error(`expected "unlocked" status, got "${unlockedStatus.state}"`);
  }

  performLock();
  const lockedStatus = computeAuthStatus();
  if (lockedStatus.state !== "locked") {
    throw new Error(`expected "locked" status after auth:lock, got "${lockedStatus.state}"`);
  }

  const rightUnlock = await handleAuthUnlock(SMOKE_PASSCODE);
  if (!rightUnlock.ok) {
    throw new Error(`expected the correct passcode to unlock, got reason "${rightUnlock.reason}"`);
  }

  const wrongUnlock = await handleAuthUnlock("definitely-wrong-1");
  if (wrongUnlock.ok || wrongUnlock.reason !== "wrongPasscode") {
    throw new Error(
      `expected a wrong passcode to return { ok: false, reason: "wrongPasscode" }, got ${JSON.stringify(wrongUnlock)}`,
    );
  }

  // The existing profile/renderer checks still pass after the lock/unlock
  // cycle — proves re-unlocking after a lock reopens a genuinely working
  // database, not just a non-null handle.
  const profilesAfterRelock = listProfiles(requireDb());
  if (profilesAfterRelock.length < 1) {
    throw new Error("expected the profile to still be readable after re-unlocking");
  }

  await runSmokeMigrationRehearsal();
  await runSmokeBlobMigrationRehearsal();
  runSmokeSearchRehearsal();
}

// --- Auto-update (SEC-EL-07) -------------------------------------------------
//
// The feed URL is baked into the packaged build from electron-builder.yml's
// `publish` config (GitHub provider) — never runtime-configurable, so nothing
// here can be pointed at an arbitrary update source. The `nexus-releases` feed
// repo does not exist yet (founder decision pending), so every failure mode
// (offline, no feed, 404) is expected right now and must stay completely
// benign: logged, never thrown, never surfaced to the renderer. Both the
// promise rejection and the "error" event are handled — electron-updater emits
// the latter for some failure paths, and an unhandled EventEmitter "error"
// would otherwise crash the process.
function checkForUpdates(): void {
  autoUpdater.on("error", (error: Error) => {
    console.error(`Auto-update check failed (benign, no update feed yet): ${error.message}`);
  });
  autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
    console.error(
      `Auto-update check failed (benign, no update feed yet): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
}

function shutdown(code: number): void {
  stopNotificationScheduler();
  cancelIdleCompactions(); // same reasoning as `performLock` — about to close `db`
  try {
    db?.close();
  } catch {
    // best-effort close; we are exiting anyway
  }
  // Force-exit so the smoke run returns a deterministic code without waiting on
  // window / GPU teardown.
  app.exit(code);
}

// --- Lifecycle --------------------------------------------------------------

app.whenReady().then(async () => {
  if (isSmoke) {
    // Never the developer's real `%APPDATA%\Nexus` — a nested, disposable
    // directory. Wiped up front (Electron only auto-creates the DEFAULT
    // userData path, not one redirected here, and a leftover keychain.json
    // from a previous run would make the very first smoke assertion below
    // false on the second run onward) then recreated, since nothing else
    // will create it before the first file write into it.
    const smokeUserDataPath = join(app.getPath("userData"), "smoke");
    rmSync(smokeUserDataPath, { recursive: true, force: true });
    mkdirSync(smokeUserDataPath, { recursive: true });
    app.setPath("userData", smokeUserDataPath);
  }

  try {
    // See `performLock`'s doc comment: `openExternally`'s temp copies are an
    // unavoidable plaintext residue outside both blob stores. Wiping them once
    // here catches whatever a previous run left behind if the process died
    // before a lock ever ran (a graceful lock already wipes this directory).
    wipeTmpOpenDir();

    // ADR-018: the main process starts LOCKED. No database is opened here —
    // `db` stays null until `auth:create`/`auth:unlock`/`auth:recover`
    // succeeds (via `openEncrypted`), so every data channel's `requireDb()`
    // genuinely has nothing to hand back until the passcode is verified.
    registerIpc();

    // ADR-014: the profileId argument is never read by `mimeForHash` — it is
    // deliberately profile-agnostic (see `NoteAttachmentStore`'s doc comment),
    // so any placeholder value is safe here. The lookup itself is wrapped: while
    // locked, `noteAttachmentStore("")` throws through `requireDb()` — caught
    // here and turned into a clean 404 (`registerBlobProtocol` already 404s on
    // a null mime) rather than a generic network error surfacing in the
    // renderer for every attachment image while locked.
    registerBlobProtocol(
      (sha256) => {
        try {
          return noteAttachmentStore("").mimeForHash(sha256);
        } catch {
          return null;
        }
      },
      blobStorePathsFor(),
      () => blobKeys,
    );

    if (isSmoke) {
      // Unlike a real launch, the smoke run cannot wait for a renderer-driven
      // auth:create/auth:unlock call: the renderer's own readiness round-trip
      // (below, after the window loads) calls a data channel, so the database
      // must already be open before `createWindow` runs.
      await runSmokeAuthSetup();
    }

    mainWindow = createWindow();

    // Never in dev, never during the smoke run — only a real packaged install.
    if (app.isPackaged && !isSmoke) checkForUpdates();

    if (isSmoke) {
      mainWindow.webContents.once("did-finish-load", () => {
        void runSmoke(mainWindow!)
          .then(() => {
            process.stdout.write("SMOKE OK\n");
            shutdown(0);
          })
          .catch((error: unknown) => {
            process.stderr.write(
              `SMOKE FAIL: ${error instanceof Error ? error.message : String(error)}\n`,
            );
            shutdown(1);
          });
      });
    }
  } catch (error) {
    process.stderr.write(
      `Startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    shutdown(1);
  }

  app.on("activate", () => {
    if (!isSmoke && BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  stopNotificationScheduler();
  cancelIdleCompactions(); // same reasoning as `performLock` — about to close `db`
  clearRestoreState(); // likewise: decrypted archive bytes and a plaintext undo snapshot must not outlive the session
  try {
    db?.close();
  } catch {
    // ignore
  }
});
