import * as Y from "yjs";

import { validateRecurrenceRule } from "../recurrence/recurrence.js";
import type { RecurrenceRule } from "../recurrence/recurrence.js";
import { DATA_FILES } from "./exportArchive.js";
import type {
  ExportCard,
  ExportDeck,
  ExportDocument,
  ExportEvent,
  ExportExam,
  ExportFocusSession,
  ExportNote,
  ExportNoteAttachment,
  ExportNoteFolder,
  ExportNoteTag,
  ExportNoteTagLink,
  ExportNoteTemplate,
  ExportNoteVersion,
  ExportNotification,
  ExportPerson,
  ExportRenewal,
  ExportReviewLogEntry,
  ExportSettings,
  ExportStudyBlock,
  ExportStudyPlan,
  ExportSubject,
  ExportTask,
  ExportTaskAttachment,
  ExportTaskList,
  ExportTaskSection,
  ExportTaskTag,
  ExportTaskTagLink,
  ProfileData,
} from "./exportArchive.js";

/**
 * Pure reader for the IMEX full-export archive (ADR-022, IMEX-002). Takes an
 * archive's already-extracted text/binary entries — never a zip, never
 * ciphertext, never a filesystem — and turns them into a `ProfileData` a
 * restore can write, or a precise list of what is wrong with them. The zip
 * container, the `.nexus.zip` decryption, and the database writes are all
 * separate slices; this module's only job is: are these bytes a Nexus
 * archive this build understands, and if so, what do they say?
 *
 * `ExportTask`/`ExportEvent`/… (`exportArchive.ts`) ARE the interchange
 * contract this module parses back — the same row shapes, field for field,
 * validated against exactly what the writer emits and nothing looser — with
 * one deliberate allowance: a field an OLDER writer did not emit yet may be
 * absent, and is defaulted rather than refused (see `ArchiveEra`), because a
 * backup that cannot be restored is not a backup. Every `CHECK` constraint in
 * `packages/db`'s migrations that this row shape could violate is re-validated
 * here, so a bad archive is a precise, structured `ImportProblem` instead of a
 * raw SQLite error three layers deep inside a restore transaction.
 */

/** Machine-readable problem codes. The renderer maps these to Serbian copy; this module never produces user-facing prose. */
export type ImportProblemCode =
  | "missing-manifest"
  | "invalid-manifest"
  | "unsupported-schema-version"
  | "missing-data-file"
  | "checksum-mismatch"
  | "invalid-json"
  | "unknown-record-type"
  | "invalid-record"
  | "duplicate-id"
  | "unknown-reference"
  | "reference-cycle"
  | "invalid-ydoc"
  | "missing-ydoc"
  | "missing-blob";

export interface ImportProblem {
  severity: "error" | "warning";
  code: ImportProblemCode;
  /** The archive path the problem was found in, when it belongs to one. */
  path?: string;
  /** 1-based line number within an NDJSON file, when it belongs to one. */
  line?: number;
  /** A short English machine-ish detail: the record type, field name, or id at fault. Never a sentence for a user. */
  detail?: string;
}

export interface ImportManifest {
  schemaVersion: string;
  appVersion: string;
  createdAt: string;
  profile: { id: string; name: string };
  settings: ExportSettings;
  modules: readonly { id: string; records: number }[];
  blobs: readonly { sha256: string; sizeBytes: number }[];
}

export interface ImportArchiveInput {
  /** Text entries by archive path (`manifest.json`, `data/*.ndjson`). Entries the archive lacks are simply absent. */
  files: ReadonlyMap<string, string>;
  /** Yjs state by archive path: `data/notes/<noteId>.ydoc` and `data/note-versions/<noteId>/<coveredSeq>.ydoc`. */
  ydocs: ReadonlyMap<string, Uint8Array>;
  /** Names of `blobs/<name>` entries the caller has already read AND verified hash to their own name. Bytes never reach this module. */
  blobNames: ReadonlySet<string>;
  /** sha256 hex over a UTF-8 string — injected exactly as `buildExportArchive` injects it, so this module imports no crypto. */
  hash: (content: string) => string;
}

export interface ImportArchiveResult {
  /** Every problem found, in discovery order. */
  problems: readonly ImportProblem[];
  /** The manifest, when it parsed — available even when `data` is null, so a caller can name the archive in an error report. */
  manifest: ImportManifest | null;
  /** Non-null only when NO problem has severity "error". Warnings do not withhold it. */
  data: ProfileData | null;
}

/**
 * The schema version this build writes and is the newest it accepts, kept in
 * step with `buildExportArchive`'s own `SCHEMA_VERSION`. `1.5.0` added the
 * `task-attachment` record type (migration 024), after `1.4.0` added
 * `task-tag`/`task-tag-link` (migration 023), `1.3.0` the
 * `task-list`/`task-section` types and a task's placement into them (TASK-004 /
 * ADR-029), `1.2.0` a task's `reminderOffsets` (ADR-028) and `1.1.0` the
 * `person` record type (CAL-007 / ADR-026): additive changes, hence MINOR
 * bumps, which is exactly the compatibility mechanism
 * `isSupportedSchemaVersion` implements — an older minor within major 1 still
 * passes the gate here, while an older build refuses a newer archive rather
 * than silently dropping what it cannot see (every person, every task's ladder,
 * every list the user filed their work into, every label they sorted it by, or
 * every file they hung off a task). That, in turn, is why an unrecognised record
 * type below is an ERROR: the version gate makes "ignore what you do not know"
 * unreachable.
 *
 * A new RECORD TYPE needs no `ArchiveEra` flag, unlike a new field on an
 * existing type: an older archive simply carries none of it, which is
 * indistinguishable from a profile that had no tags — while a NEWER archive
 * never reaches a parser at all, because the gate above refuses it. Era flags
 * exist only for the "this row is missing a field it now must have" question,
 * which a whole absent type never asks.
 *
 * Major is still 1 throughout, so there is nothing yet to migrate an older
 * major forward from — a migration framework for a major that has never
 * shipped would be speculative machinery with nothing to exercise it.
 */
export const INTERCHANGE_SCHEMA_VERSION = "1.5.0";

// --- Archive era: what a declared version guarantees its rows CARRY ---------
//
// A backup's whole point is that it restores. Every REQUIRED field added to an
// existing record type since the first release would otherwise make every
// archive written before it unreadable — "refuse the whole thing because a
// field that did not exist yet is absent" is exactly the promise the additive
// MINOR bump exists to keep. So the declared version is read once, up front,
// into the capability record below, and a field the writer of that era did not
// yet emit is DEFAULTED instead of refused.
//
// Leniency covers ABSENCE only (`undefined` — the key is not in the row at
// all), never a malformed value and never an explicit `null`: a writer that
// emitted the key meant it, so it is validated strictly in every era.

/**
 * What the writer of an archive at a given `schemaVersion` is known to have
 * always written. One boolean per "field added after the first release", not
 * one per version, because the two groups were added under different
 * disciplines and only the version can tell them apart.
 */
interface ArchiveEra {
  /**
   * Task/event `recurrence` (ADR-024), event `recurrenceExdates` (ADR-024) and
   * event `reminderOffsets` (CAL-006). All three shipped INSIDE `1.0.x`,
   * without a minor bump — so the version alone cannot tell a `1.0.0` archive
   * written before them from one written after, and `1.0.x` is the one era
   * where their absence is genuinely ambiguous. Leniency is confined to it:
   * from `1.1.0` on the writer always wrote them, so absence there is a damaged
   * row and stays `invalid-record`.
   */
  writesRecurrenceAndEventReminders: boolean;
  /**
   * Task `reminderOffsets` (ADR-028) — added AT the `1.2.0` bump, which is what
   * the honest bump buys: below `1.2.0` its absence is expected and defaults to
   * `[]`, at `1.2.0` and above it is required.
   */
  writesTaskReminders: boolean;
  /**
   * Task `listId`/`sectionId`/`position` (TASK-004 / ADR-029) — added AT the
   * `1.3.0` bump, the same honest arrangement `writesTaskReminders` records for
   * `1.2.0`: below `1.3.0` their absence is expected and defaults to
   * `null`/`null`/`0`, at `1.3.0` and above a task must name the list it lives
   * in. This is the first field addition shipped under that rule from the
   * start — its own flag AND its own bump, together, rather than either alone.
   */
  writesTaskLists: boolean;
}

/**
 * Reads an archive's era off its declared `schemaVersion`. Only ever called
 * after `isSupportedSchemaVersion` has accepted the value, so the unparseable
 * branch is unreachable — and it answers "the writer wrote everything" anyway,
 * because a version this module cannot read is never a reason to validate less.
 */
function eraOf(schemaVersion: string): ArchiveEra {
  const version = parseSemver(schemaVersion);
  if (version === null) {
    return {
      writesRecurrenceAndEventReminders: true,
      writesTaskReminders: true,
      writesTaskLists: true,
    };
  }
  return {
    writesRecurrenceAndEventReminders: version.minor >= 1,
    writesTaskReminders: version.minor >= 2,
    writesTaskLists: version.minor >= 3,
  };
}

// --- Small, cast-free validation primitives ---------------------------------
//
// Each `expect*`/`parse*` helper below either returns a validated, correctly
// typed value or throws `InvalidFieldError(field)`. Every record parser is a
// straight-line sequence of these calls in the row interface's own field
// order, so the FIRST bad field is what a caller sees — deliberately, so
// `invalid-record`'s `detail` always names something a person can go fix.

class InvalidFieldError extends Error {
  constructor(public readonly field: string) {
    super(`Invalid field: ${field}`);
    this.name = "InvalidFieldError";
  }
}

/** Runs `parse` and converts a thrown `InvalidFieldError` into `{ detail }`; anything else escapes (a genuine bug, not a data problem). */
function tryParse<T>(parse: () => T): { ok: true; value: T } | { ok: false; detail: string } {
  try {
    return { ok: true, value: parse() };
  } catch (error) {
    if (error instanceof InvalidFieldError) return { ok: false, detail: error.field };
    throw error;
  }
}

/**
 * A field that older archives may not carry at all. `parse` runs whenever the
 * key is PRESENT — strictly, in every era, so a malformed or explicitly-null
 * value is refused exactly as before; `fallback` is returned only when the key
 * is absent AND `writerAlwaysWrote` says this archive's era predates the field
 * (see `ArchiveEra`). An absent key at an era that DID write it falls through
 * to `parse(undefined)`, which throws `InvalidFieldError` naming the field —
 * the pre-existing behaviour, kept for exactly the rows that deserve it.
 */
function eraDefault<T>(
  value: unknown,
  writerAlwaysWrote: boolean,
  parse: (value: unknown) => T,
  fallback: T,
): T {
  if (value === undefined && !writerAlwaysWrote) return fallback;
  return parse(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new InvalidFieldError(field);
  return value;
}

function str(value: unknown, field: string): string {
  if (typeof value !== "string") throw new InvalidFieldError(field);
  return value;
}

function nonEmptyStr(value: unknown, field: string): string {
  const s = str(value, field);
  if (s.length === 0) throw new InvalidFieldError(field);
  return s;
}

function nullableStr(value: unknown, field: string): string | null {
  return value === null ? null : str(value, field);
}

function nullableNonEmptyStr(value: unknown, field: string): string | null {
  return value === null ? null : nonEmptyStr(value, field);
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new InvalidFieldError(field);
  return value;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new InvalidFieldError(field);
  return value;
}

function int(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new InvalidFieldError(field);
  return value;
}

function intInRange(value: unknown, field: string, min: number, max: number): number {
  const n = int(value, field);
  if (n < min || n > max) throw new InvalidFieldError(field);
  return n;
}

function nonNegativeInt(value: unknown, field: string): number {
  return intInRange(value, field, 0, Number.MAX_SAFE_INTEGER);
}

function positiveInt(value: unknown, field: string): number {
  return intInRange(value, field, 1, Number.MAX_SAFE_INTEGER);
}

/**
 * Membership-checks against a closed, typed list without ever widening `T` to
 * `string` (which would need an `as T` to narrow back) — a plain `===` loop
 * compiles cleanly because `T extends string` already makes the two sides
 * comparable, and returning `candidate` (typed `T`) needs no assertion at all.
 */
function enumStr<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  const s = str(value, field);
  for (const candidate of allowed) {
    if (candidate === s) return candidate;
  }
  throw new InvalidFieldError(field);
}

function enumInt<T extends number>(value: unknown, field: string, allowed: readonly T[]): T {
  const n = int(value, field);
  for (const candidate of allowed) {
    if (candidate === n) return candidate;
  }
  throw new InvalidFieldError(field);
}

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return allowed.some((candidate) => candidate === value);
}

/** `Date.parse` accepting the string is the whole test — good enough for a full ISO-8601 instant, unlike a bare date, which needs its own calendar check (see `bareDate`). */
function isoDateTime(value: unknown, field: string): string {
  const s = nonEmptyStr(value, field);
  if (Number.isNaN(Date.parse(s))) throw new InvalidFieldError(field);
  return s;
}

function nullableIsoDateTime(value: unknown, field: string): string | null {
  return value === null ? null : isoDateTime(value, field);
}

const BARE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Exactly `YYYY-MM-DD`, AND a real calendar date — `Date.parse` alone would silently accept `2026-02-30` (JS rolls it into March), which is precisely the kind of corrupt-but-parseable value a restore must reject rather than write. */
function bareDate(value: unknown, field: string): string {
  const s = nonEmptyStr(value, field);
  const match = BARE_DATE.exec(s);
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new InvalidFieldError(field);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const asDate = new Date(Date.UTC(year, month - 1, day));
  if (asDate.getUTCFullYear() !== year || asDate.getUTCMonth() !== month - 1 || asDate.getUTCDate() !== day) {
    throw new InvalidFieldError(field);
  }
  return s;
}

function nullableBareDate(value: unknown, field: string): string | null {
  return value === null ? null : bareDate(value, field);
}

/** Every element a real bare calendar date. Order is not required on the way in — the stores keep exceptions sorted, a hand-written archive need not. */
function bareDateArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new InvalidFieldError(field);
  const entries: readonly unknown[] = value;
  return entries.map((item, index) => bareDate(item, `${field}[${index}]`));
}

/**
 * `null`, or a recurrence rule in the exact language this build's engine
 * speaks. Deliberately `validateRecurrenceRule` itself rather than a re-spelled
 * copy of its rules: the archive's rule language and the app's are the same
 * language, and two validators for one grammar could only ever drift apart.
 * Returns the canonical form, so an archive whose rule members arrived in some
 * other order restores as though the store had written it.
 */
function nullableRecurrenceRule(value: unknown, field: string): RecurrenceRule | null {
  if (value === null) return null;
  const rule = validateRecurrenceRule(value);
  if (rule === null) throw new InvalidFieldError(field);
  return rule;
}

function nonNegativeIntArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) throw new InvalidFieldError(field);
  return value.map((item, index) => nonNegativeInt(item, `${field}[${index}]`));
}

/**
 * As `nonNegativeIntArray`, plus a per-element cap, a length cap and a
 * no-duplicates rule — the twin of `EventStore`'s own `validateReminderOffsets`
 * (`@nexus/db`). No SQL CHECK can express any of it over a JSON column, so an
 * archive is the one way such a value could reach the column unchecked. Order
 * is NOT required on the way in, mirroring `bareDateArray`: the store keeps the
 * ladder ascending, a hand-written archive need not, and the restore sorts it.
 */
function boundedIntArray(value: unknown, field: string, max: number, maxLength: number): number[] {
  const items = nonNegativeIntArray(value, field);
  if (items.length > maxLength) throw new InvalidFieldError(field);
  items.forEach((item, index) => {
    if (item > max) throw new InvalidFieldError(`${field}[${index}]`);
  });
  if (new Set(items).size !== items.length) throw new InvalidFieldError(field);
  return items;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Exactly `HH:MM` on a 24-hour clock — the shape `NotificationStore`'s own `validateHHMM` enforces on every write. No SQL CHECK backs it, which is precisely why it has to be checked here: an archive is the one way a value can reach that table without passing through the store. */
function hhmm(value: unknown, field: string): string {
  const s = nonEmptyStr(value, field);
  if (!HHMM.test(s)) throw new InvalidFieldError(field);
  return s;
}

function nullableHhmm(value: unknown, field: string): string | null {
  return value === null ? null : hhmm(value, field);
}

/** `content` is a JSON-encoded ProseMirror document (ADR-016) — valid JSON, and specifically a JSON *object*, not an array/string/number. */
function jsonObjectString(value: unknown, field: string): string {
  const s = nonEmptyStr(value, field);
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    throw new InvalidFieldError(field);
  }
  if (!isRecord(parsed)) throw new InvalidFieldError(field);
  return s;
}

/**
 * Mirrors `NOTE_FOLDER_COLORS` in `@nexus/db`'s `notes/noteOrgStore.ts`
 * (copied, not imported — `@nexus/core` must not depend on `@nexus/db`).
 * Keep this list in sync by hand if the palette ever changes.
 */
const NOTE_FOLDER_COLORS = ["zlato", "bronza", "maslina", "suma", "zad", "ruza", "bordo", "grafit"] as const;

function nullableFolderColor(value: unknown, field: string): string | null {
  return value === null ? null : enumStr(value, field, NOTE_FOLDER_COLORS);
}

// --- Enum domains mirroring `packages/db/src/migrations/*.ts` CHECKs -------

const TASK_STATUSES = ["todo", "doing", "done"] as const;
const TASK_PRIORITIES = ["none", "low", "medium", "high"] as const;
const DOC_TYPES = ["licna_karta", "pasos", "vozacka", "registracija", "kartica", "polisa", "custom"] as const;
const SUBJECT_COLORS = ["jade", "gold", "bronze", "burgundy", "crimson", "graphite"] as const;
const EXAM_TYPES = ["pismeni", "usmeni", "kolokvijum"] as const;
const CARD_STATES = [0, 1, 2, 3] as const;
const REVIEW_RATINGS = [1, 2, 3, 4] as const;
const STUDY_BLOCK_STATUSES = ["planned", "done", "missed"] as const;
const NOTIFICATION_SOURCES = ["document", "exam", "study-day", "event", "task"] as const;
const NOTIFICATION_STATUSES = ["delivered", "snoozed", "dismissed"] as const;
const PERSON_KINDS = ["birthday", "anniversary"] as const;
/** Mirrors `TASK_LIST_VIEWS` in `@nexus/db`'s `tasks/taskListStore.ts` and migration 022's CHECK (copied, not imported — the `NOTE_FOLDER_COLORS` arrangement). */
const TASK_LIST_VIEWS = ["list", "kanban"] as const;

/**
 * A leap year, used only by `parsePerson` to ask whether a (month, day) pair
 * is a real day in SOME year — the twin of `PeopleStore`'s own `LEAP_YEAR`
 * (`@nexus/db`), which is what keeps 29 February acceptable.
 */
const PERSON_LEAP_YEAR = "2024";

/**
 * Mirrors `MAX_EVENT_REMINDER_MINUTES`/`MAX_EVENT_REMINDERS` in `@nexus/db`'s
 * `events/eventStore.ts` (copied, not imported — `@nexus/core` must not depend
 * on `@nexus/db`), the same arrangement as `NOTE_FOLDER_COLORS` above.
 */
const MAX_EVENT_REMINDER_MINUTES = 43_200;
const MAX_EVENT_REMINDERS = 8;

/**
 * Mirrors `MAX_TASK_REMINDER_DAYS`/`MAX_TASK_REMINDERS` in `@nexus/db`'s
 * `tasks/taskStore.ts` (copied, not imported — `@nexus/core` must not depend
 * on `@nexus/db`), the same arrangement as the event caps above. Days, not
 * minutes: a task's ladder counts back from a bare-date due date (ADR-028).
 */
const MAX_TASK_REMINDER_DAYS = 365;
const MAX_TASK_REMINDERS = 8;

// --- Record type discriminants ----------------------------------------------

type RecordType =
  | "task"
  | "task-list"
  | "task-section"
  | "task-tag"
  | "task-tag-link"
  | "task-attachment"
  | "event"
  | "document"
  | "renewal"
  | "person"
  | "subject"
  | "exam"
  | "deck"
  | "card"
  | "review"
  | "plan"
  | "block"
  | "focus-session"
  | "notification"
  | "note-folder"
  | "note-tag"
  | "note"
  | "note-tag-link"
  | "note-attachment"
  | "note-version"
  | "note-template";

const ALL_RECORD_TYPES: readonly RecordType[] = [
  "task",
  "task-list",
  "task-section",
  "task-tag",
  "task-tag-link",
  "task-attachment",
  "event",
  "document",
  "renewal",
  "person",
  "subject",
  "exam",
  "deck",
  "card",
  "review",
  "plan",
  "block",
  "focus-session",
  "notification",
  "note-folder",
  "note-tag",
  "note",
  "note-tag-link",
  "note-attachment",
  "note-version",
  "note-template",
];

type DataFilePath = (typeof DATA_FILES)[number];

/** Which record types the writer puts in each of the five NDJSON files — a type in any OTHER file is `invalid-record` (detail `"type"`), not silently accepted (ADR-022). */
const FILE_RECORD_TYPES: Record<DataFilePath, readonly RecordType[]> = {
  "data/tasks.ndjson": [
    "task-list",
    "task-section",
    "task-tag",
    "task",
    "task-tag-link",
    "task-attachment",
  ],
  "data/calendar.ndjson": ["event", "document", "renewal", "person"],
  "data/study.ndjson": ["subject", "exam", "deck", "card", "review", "plan", "block", "focus-session"],
  "data/notifications.ndjson": ["notification"],
  "data/notes.ndjson": [
    "note-folder",
    "note-tag",
    "note",
    "note-tag-link",
    "note-attachment",
    "note-version",
    "note-template",
  ],
};

// --- Per-record parsers, one field validator call per interface field, in --
// --- the interface's own declared order (see the class comment above). ----

function parseTask(raw: Record<string, unknown>, era: ArchiveEra): ExportTask {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const parentId = nullableNonEmptyStr(raw.parentId, "parentId");
  const title = nonEmptyStr(raw.title, "title");
  const description = nullableStr(raw.description, "description");
  const status = enumStr(raw.status, "status", TASK_STATUSES);
  const priority = enumStr(raw.priority, "priority", TASK_PRIORITIES);
  const done = bool(raw.done, "done");
  const dueDate = nullableBareDate(raw.dueDate, "dueDate");
  const startDate = nullableBareDate(raw.startDate, "startDate");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  const completedAt = nullableIsoDateTime(raw.completedAt, "completedAt");
  const recurrence = eraDefault(
    raw.recurrence,
    era.writesRecurrenceAndEventReminders,
    (value) => nullableRecurrenceRule(value, "recurrence"),
    null,
  );
  const reminderOffsets = eraDefault(
    raw.reminderOffsets,
    era.writesTaskReminders,
    (value) => boundedIntArray(value, "reminderOffsets", MAX_TASK_REMINDER_DAYS, MAX_TASK_REMINDERS),
    [],
  );
  // `done` is a denormalized read of `status`, and migration 002's CHECK ties
  // `status = 'done'` to `completed_at IS NOT NULL` — both invariants must
  // hold for the row to be writable back at all.
  if (done !== (status === "done")) throw new InvalidFieldError("done");
  if ((status === "done") !== (completedAt !== null)) throw new InvalidFieldError("completedAt");
  // A recurring task advances its own due date on completion (ADR-024), so the
  // rule phases from that date and `TaskStore` refuses the pair in both
  // directions. No SQL CHECK backs it — the store is the gate — which is
  // exactly why an archive has to be checked: a dateless rule would be a series
  // with nothing to advance.
  if (recurrence !== null && dueDate === null) throw new InvalidFieldError("recurrence");
  // ADR-028: a reminder ladder counts whole days BACK from the due date, so a
  // laddered task must HAVE one, and it must be a bare calendar day to count
  // from — the pair rule `TaskStore` enforces in both directions, backed by no
  // SQL CHECK, which is exactly why an archive has to be checked for it.
  // `bareDate` is the whole test: `dueDate` reached here through
  // `nullableBareDate`, so the only case still left to refuse is `null`, and
  // refusing it through the same helper keeps the rule one statement, not two.
  if (reminderOffsets.length > 0) bareDate(dueDate, "dueDate");
  // TASK-004: a 1.3 writer always names the list a task lives in, so `null` is
  // refused there — it is only ever what an OLDER archive's absent key defaults
  // to, and `RestoreStore` reads that null as "the target profile's Inbox".
  const listId = eraDefault<string | null>(
    raw.listId,
    era.writesTaskLists,
    (value) => nonEmptyStr(value, "listId"),
    null,
  );
  const sectionId = eraDefault<string | null>(
    raw.sectionId,
    era.writesTaskLists,
    (value) => nullableNonEmptyStr(value, "sectionId"),
    null,
  );
  // `int`, not `nonNegativeInt`: a position is a relative sort key, and
  // prepending walks it below zero (`TaskListStore.positionBetween`).
  const position = eraDefault(
    raw.position,
    era.writesTaskLists,
    (value) => int(value, "position"),
    0,
  );
  // A section is a heading INSIDE a list, so one without the other is a row the
  // store could not have written. Which list it belongs to is checked in the
  // reference pass, where the sections are known.
  if (sectionId !== null && listId === null) throw new InvalidFieldError("sectionId");
  return {
    id, profileId, parentId, title, description, status, priority, done,
    dueDate, startDate, createdAt, updatedAt, completedAt, recurrence, reminderOffsets,
    listId, sectionId, position,
  };
}

function parseTaskList(raw: Record<string, unknown>): ExportTaskList {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const parentId = nullableNonEmptyStr(raw.parentId, "parentId");
  const name = nonEmptyStr(raw.name, "name");
  const isInbox = bool(raw.isInbox, "isInbox");
  const defaultView = enumStr(raw.defaultView, "defaultView", TASK_LIST_VIEWS);
  const position = int(raw.position, "position");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, profileId, parentId, name, isInbox, defaultView, position, createdAt, updatedAt };
}

function parseTaskSection(raw: Record<string, unknown>): ExportTaskSection {
  const id = nonEmptyStr(raw.id, "id");
  const listId = nonEmptyStr(raw.listId, "listId");
  const name = nonEmptyStr(raw.name, "name");
  const position = int(raw.position, "position");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, listId, name, position, createdAt, updatedAt };
}

/** `parseNoteTag`'s twin, and deliberately identical: migration 023's `task_tags` is migration 011's `note_tags` with tasks on the other end of the join. */
function parseTaskTag(raw: Record<string, unknown>): ExportTaskTag {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const name = nonEmptyStr(raw.name, "name");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  return { id, profileId, name, createdAt };
}

function parseTaskTagLink(raw: Record<string, unknown>): ExportTaskTagLink {
  const taskId = nonEmptyStr(raw.taskId, "taskId");
  const tagId = nonEmptyStr(raw.tagId, "tagId");
  return { taskId, tagId };
}

/** `parseNoteAttachment`'s twin, and deliberately identical: migration 024's `task_attachments` is migration 013's `note_attachments` with a task on the other end. `sizeBytes` is `positiveInt` because both tables CHECK it. */
function parseTaskAttachment(raw: Record<string, unknown>): ExportTaskAttachment {
  const id = nonEmptyStr(raw.id, "id");
  const taskId = nonEmptyStr(raw.taskId, "taskId");
  const fileName = nonEmptyStr(raw.fileName, "fileName");
  const mime = nonEmptyStr(raw.mime, "mime");
  const sizeBytes = positiveInt(raw.sizeBytes, "sizeBytes");
  const sha256 = nonEmptyStr(raw.sha256, "sha256");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  return { id, taskId, fileName, mime, sizeBytes, sha256, createdAt };
}

function parseEvent(raw: Record<string, unknown>, era: ArchiveEra): ExportEvent {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const title = nonEmptyStr(raw.title, "title");
  const description = nullableStr(raw.description, "description");
  const startAt = isoDateTime(raw.startAt, "startAt");
  const endAt = nullableIsoDateTime(raw.endAt, "endAt");
  const allDay = bool(raw.allDay, "allDay");
  const location = nullableStr(raw.location, "location");
  const category = nullableStr(raw.category, "category");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  const recurrence = eraDefault(
    raw.recurrence,
    era.writesRecurrenceAndEventReminders,
    (value) => nullableRecurrenceRule(value, "recurrence"),
    null,
  );
  const recurrenceExdates = eraDefault(
    raw.recurrenceExdates,
    era.writesRecurrenceAndEventReminders,
    (value) => bareDateArray(value, "recurrenceExdates"),
    [],
  );
  const reminderOffsets = eraDefault(
    raw.reminderOffsets,
    era.writesRecurrenceAndEventReminders,
    (value) =>
      boundedIntArray(value, "reminderOffsets", MAX_EVENT_REMINDER_MINUTES, MAX_EVENT_REMINDERS),
    [],
  );
  // No cross-field end->=start check: migration 003 deliberately carries no
  // SQL CHECK for it either (comparing ISO strings across mixed zones is
  // fragile), so there is no invariant here to mirror.
  //
  // The two recurrence invariants below ARE mirrored, from `EventStore`:
  // exceptions belong to a series (clearing the rule clears them, so a row
  // carrying exceptions without a rule is one the store could not have
  // written), and a master anchors on its own start DAY, so that day has to
  // exist — `2026-02-30T09:00:00Z` parses as an instant but is nothing to
  // phase a series from.
  if (recurrence === null && recurrenceExdates.length > 0) {
    throw new InvalidFieldError("recurrenceExdates");
  }
  if (recurrence !== null) bareDate(startAt.slice(0, 10), "startAt");
  return {
    id, profileId, title, description, startAt, endAt, allDay, location, category,
    createdAt, updatedAt, recurrence, recurrenceExdates, reminderOffsets,
  };
}

function parseDocument(raw: Record<string, unknown>): ExportDocument {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const docType = enumStr(raw.docType, "docType", DOC_TYPES);
  const label = nonEmptyStr(raw.label, "label");
  const expiryDate = bareDate(raw.expiryDate, "expiryDate");
  const reminderOffsets = nonNegativeIntArray(raw.reminderOffsets, "reminderOffsets");
  const notes = nullableStr(raw.notes, "notes");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, profileId, docType, label, expiryDate, reminderOffsets, notes, createdAt, updatedAt };
}

function parseRenewal(raw: Record<string, unknown>): ExportRenewal {
  const id = nonEmptyStr(raw.id, "id");
  const documentId = nonEmptyStr(raw.documentId, "documentId");
  // `previous_expiry` (migration 004) is the same kind of value as
  // `expiry_date` — a bare calendar date, not an instant — so it gets the
  // same validator.
  const previousExpiry = bareDate(raw.previousExpiry, "previousExpiry");
  const renewedAt = isoDateTime(raw.renewedAt, "renewedAt");
  return { id, documentId, previousExpiry, renewedAt };
}

/**
 * The twin of `PeopleStore`'s own validation (`@nexus/db`), CAL-007/ADR-026.
 * Migration 020's CHECKs cover each of `month`/`day` alone; nothing in SQL can
 * see the PAIR, so `(2, 30)` and `(4, 31)` would sit in the table happily —
 * which is precisely why an archive has to be checked. Validated against a
 * leap year (`bareDate` already owns "is this a real calendar day"), so 29
 * February passes: leap-day birthdays exist, and the calendar clamps them to
 * the 28th in the years that lack a 29th.
 *
 * `year`'s 1900-2100 window mirrors the store's for the same reason it exists
 * there: to catch a typo'd `19858`, not to model history.
 */
function parsePerson(raw: Record<string, unknown>): ExportPerson {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const name = nonEmptyStr(raw.name, "name");
  const kind = enumStr(raw.kind, "kind", PERSON_KINDS);
  const month = intInRange(raw.month, "month", 1, 12);
  const day = intInRange(raw.day, "day", 1, 31);
  bareDate(
    `${PERSON_LEAP_YEAR}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    "day",
  );
  const year = raw.year === null ? null : intInRange(raw.year, "year", 1900, 2100);
  const note = nullableStr(raw.note, "note");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, profileId, name, kind, month, day, year, note, createdAt, updatedAt };
}

function parseSubject(raw: Record<string, unknown>): ExportSubject {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const name = nonEmptyStr(raw.name, "name");
  const color = enumStr(raw.color, "color", SUBJECT_COLORS);
  const semester = nullableStr(raw.semester, "semester");
  const archived = bool(raw.archived, "archived");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, profileId, name, color, semester, archived, createdAt, updatedAt };
}

function parseExam(raw: Record<string, unknown>): ExportExam {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const subjectId = nonEmptyStr(raw.subjectId, "subjectId");
  const examType = enumStr(raw.examType, "examType", EXAM_TYPES);
  const examDate = bareDate(raw.examDate, "examDate");
  const scope = nullableStr(raw.scope, "scope");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, profileId, subjectId, examType, examDate, scope, createdAt, updatedAt };
}

function parseDeck(raw: Record<string, unknown>): ExportDeck {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const subjectId = nonEmptyStr(raw.subjectId, "subjectId");
  const name = nonEmptyStr(raw.name, "name");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, profileId, subjectId, name, createdAt, updatedAt };
}

function parseCard(raw: Record<string, unknown>): ExportCard {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const deckId = nonEmptyStr(raw.deckId, "deckId");
  const front = nonEmptyStr(raw.front, "front");
  const back = nonEmptyStr(raw.back, "back");
  const sourceNoteId = nullableNonEmptyStr(raw.sourceNoteId, "sourceNoteId");
  const sourceBlockKey = nullableNonEmptyStr(raw.sourceBlockKey, "sourceBlockKey");
  // Both or neither. No SQL CHECK backs this — `CardStore` enforces it
  // structurally instead (`create` writes two nulls, `syncFromNote` writes two
  // values, and nothing else ever touches these columns), which is exactly why
  // an archive has to be checked: a half-set pair would sit in
  // `syncFromNote`'s reconcile map under the key `null`, match no block, and
  // get soft-deleted the first time the user opened the note.
  if ((sourceNoteId === null) !== (sourceBlockKey === null)) {
    throw new InvalidFieldError("sourceBlockKey");
  }
  const due = isoDateTime(raw.due, "due");
  const stability = finiteNumber(raw.stability, "stability");
  const difficulty = finiteNumber(raw.difficulty, "difficulty");
  const elapsedDays = int(raw.elapsedDays, "elapsedDays");
  const scheduledDays = int(raw.scheduledDays, "scheduledDays");
  const learningSteps = int(raw.learningSteps, "learningSteps");
  const reps = int(raw.reps, "reps");
  const lapses = int(raw.lapses, "lapses");
  const state = enumInt(raw.state, "state", CARD_STATES);
  const lastReview = nullableIsoDateTime(raw.lastReview, "lastReview");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return {
    id, profileId, deckId, front, back, sourceNoteId, sourceBlockKey, due, stability,
    difficulty, elapsedDays, scheduledDays, learningSteps, reps, lapses, state,
    lastReview, createdAt, updatedAt,
  };
}

function parseReview(raw: Record<string, unknown>): ExportReviewLogEntry {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const cardId = nonEmptyStr(raw.cardId, "cardId");
  const rating = enumInt(raw.rating, "rating", REVIEW_RATINGS);
  const state = enumInt(raw.state, "state", CARD_STATES);
  const due = isoDateTime(raw.due, "due");
  const stability = finiteNumber(raw.stability, "stability");
  const difficulty = finiteNumber(raw.difficulty, "difficulty");
  const elapsedDays = int(raw.elapsedDays, "elapsedDays");
  const lastElapsedDays = int(raw.lastElapsedDays, "lastElapsedDays");
  const scheduledDays = int(raw.scheduledDays, "scheduledDays");
  const learningSteps = int(raw.learningSteps, "learningSteps");
  const review = isoDateTime(raw.review, "review");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  return {
    id, profileId, cardId, rating, state, due, stability, difficulty, elapsedDays,
    lastElapsedDays, scheduledDays, learningSteps, review, createdAt,
  };
}

function parsePlan(raw: Record<string, unknown>): ExportStudyPlan {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const examId = nonEmptyStr(raw.examId, "examId");
  const dailyMinutes = intInRange(raw.dailyMinutes, "dailyMinutes", 15, 480);
  const startDate = bareDate(raw.startDate, "startDate");
  const examWeekBoost = bool(raw.examWeekBoost, "examWeekBoost");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, profileId, examId, dailyMinutes, startDate, examWeekBoost, createdAt, updatedAt };
}

function parseBlock(raw: Record<string, unknown>): ExportStudyBlock {
  const id = nonEmptyStr(raw.id, "id");
  const planId = nonEmptyStr(raw.planId, "planId");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const blockDate = bareDate(raw.blockDate, "blockDate");
  const minutes = positiveInt(raw.minutes, "minutes");
  const status = enumStr(raw.status, "status", STUDY_BLOCK_STATUSES);
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, planId, profileId, blockDate, minutes, status, createdAt, updatedAt };
}

function parseFocusSession(raw: Record<string, unknown>): ExportFocusSession {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const subjectId = nonEmptyStr(raw.subjectId, "subjectId");
  const startedAt = isoDateTime(raw.startedAt, "startedAt");
  const endedAt = isoDateTime(raw.endedAt, "endedAt");
  // Migration 008's CHECK: `ended_at > started_at` — every persisted session
  // has a genuine, positive duration. Compared as STRINGS, because that CHECK
  // is a SQLite TEXT comparison: mirroring it exactly means this rejects
  // precisely what the database would reject, rather than what is merely
  // backwards in wall-clock terms.
  if (!(endedAt > startedAt)) throw new InvalidFieldError("endedAt");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, profileId, subjectId, startedAt, endedAt, createdAt, updatedAt };
}

function parseNotification(raw: Record<string, unknown>): ExportNotification {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const source = enumStr(raw.source, "source", NOTIFICATION_SOURCES);
  // `entityId` is deliberately NOT reference-checked: it points at several
  // different tables and at rows that may legitimately be gone by now.
  const entityId = nonEmptyStr(raw.entityId, "entityId");
  const occurrenceKey = nonEmptyStr(raw.occurrenceKey, "occurrenceKey");
  const title = nonEmptyStr(raw.title, "title");
  const body = nonEmptyStr(raw.body, "body");
  const status = enumStr(raw.status, "status", NOTIFICATION_STATUSES);
  const snoozedUntil = nullableIsoDateTime(raw.snoozedUntil, "snoozedUntil");
  const deliveredAt = isoDateTime(raw.deliveredAt, "deliveredAt");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return {
    id, profileId, source, entityId, occurrenceKey, title, body, status,
    snoozedUntil, deliveredAt, createdAt, updatedAt,
  };
}

function parseNoteFolder(raw: Record<string, unknown>): ExportNoteFolder {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const parentId = nullableNonEmptyStr(raw.parentId, "parentId");
  const name = nonEmptyStr(raw.name, "name");
  const color = nullableFolderColor(raw.color, "color");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, profileId, parentId, name, color, createdAt, updatedAt };
}

function parseNoteTag(raw: Record<string, unknown>): ExportNoteTag {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const name = nonEmptyStr(raw.name, "name");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  return { id, profileId, name, createdAt };
}

/** Metadata only — `snapshot` is attached afterward from `input.ydocs` (rule 7 of the reader's spec). */
function parseNoteMeta(raw: Record<string, unknown>): Omit<ExportNote, "snapshot"> {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  // Deliberately `str`, not `nonEmptyStr`: `NoteStore.create` inserts a note
  // with `title = ''` and `appendUpdate` documents the title as "may be
  // empty" — a never-titled or freshly-cleared note is legitimate data, not
  // a corrupt row.
  const title = str(raw.title, "title");
  const folderId = nullableNonEmptyStr(raw.folderId, "folderId");
  const pinned = bool(raw.pinned, "pinned");
  const cardDeckId = nullableNonEmptyStr(raw.cardDeckId, "cardDeckId");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, profileId, title, folderId, pinned, cardDeckId, createdAt, updatedAt };
}

function parseNoteTagLink(raw: Record<string, unknown>): ExportNoteTagLink {
  const noteId = nonEmptyStr(raw.noteId, "noteId");
  const tagId = nonEmptyStr(raw.tagId, "tagId");
  return { noteId, tagId };
}

function parseNoteTemplate(raw: Record<string, unknown>): ExportNoteTemplate {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const name = nonEmptyStr(raw.name, "name");
  const content = jsonObjectString(raw.content, "content");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, profileId, name, content, createdAt, updatedAt };
}

function parseNoteAttachment(raw: Record<string, unknown>): ExportNoteAttachment {
  const id = nonEmptyStr(raw.id, "id");
  const noteId = nonEmptyStr(raw.noteId, "noteId");
  const fileName = nonEmptyStr(raw.fileName, "fileName");
  const mime = nonEmptyStr(raw.mime, "mime");
  const sizeBytes = positiveInt(raw.sizeBytes, "sizeBytes");
  const sha256 = nonEmptyStr(raw.sha256, "sha256");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  return { id, noteId, fileName, mime, sizeBytes, sha256, createdAt };
}

/** Metadata only — `snapshot` is attached afterward from `input.ydocs`, and is REQUIRED (rule 7), unlike a note's. */
function parseNoteVersionMeta(raw: Record<string, unknown>): Omit<ExportNoteVersion, "snapshot"> {
  const noteId = nonEmptyStr(raw.noteId, "noteId");
  const coveredSeq = nonNegativeInt(raw.coveredSeq, "coveredSeq");
  // Same "may be empty" reasoning as a note's own title — a version captures
  // whatever the note was titled at that moment.
  const title = str(raw.title, "title");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  return { noteId, coveredSeq, title, createdAt };
}

// --- Collecting parsed rows with their archive origin -----------------------

/** One parsed row plus where it came from — needed after the fact, to attach `path`/`line` to a reference or cycle problem discovered only once every row is known. */
interface Located<T> {
  row: T;
  path: string;
  line: number;
}

function locate<T>(row: T, path: string, line: number): Located<T> {
  return { row, path, line };
}

/** One bucket per collection: its rows (in file order) and the id-keys already seen, for `duplicate-id`. */
interface Bucket<T> {
  entries: Located<T>[];
  seenKeys: Set<string>;
}

function newBucket<T>(): Bucket<T> {
  return { entries: [], seenKeys: new Set() };
}

/** Records `row` into `bucket`, reporting `duplicate-id` (but still keeping the row) if `key` was already seen — a duplicate makes the whole import an error regardless, so keeping it does no harm and keeps this function simple. */
function pushRow<T>(
  bucket: Bucket<T>,
  key: string,
  row: T,
  path: string,
  line: number,
  problems: ImportProblem[],
): void {
  if (bucket.seenKeys.has(key)) {
    problems.push(problem("error", "duplicate-id", { path, line, detail: key }));
  } else {
    bucket.seenKeys.add(key);
  }
  bucket.entries.push(locate(row, path, line));
}

function rowsOf<T>(bucket: Bucket<T>): T[] {
  return bucket.entries.map((entry) => entry.row);
}

interface Collections {
  tasks: Bucket<ExportTask>;
  taskLists: Bucket<ExportTaskList>;
  taskSections: Bucket<ExportTaskSection>;
  taskTags: Bucket<ExportTaskTag>;
  taskTagLinks: Bucket<ExportTaskTagLink>;
  taskAttachments: Bucket<ExportTaskAttachment>;
  events: Bucket<ExportEvent>;
  documents: Bucket<ExportDocument>;
  renewals: Bucket<ExportRenewal>;
  people: Bucket<ExportPerson>;
  subjects: Bucket<ExportSubject>;
  exams: Bucket<ExportExam>;
  decks: Bucket<ExportDeck>;
  cards: Bucket<ExportCard>;
  reviewLog: Bucket<ExportReviewLogEntry>;
  plans: Bucket<ExportStudyPlan>;
  blocks: Bucket<ExportStudyBlock>;
  focusSessions: Bucket<ExportFocusSession>;
  notifications: Bucket<ExportNotification>;
  noteFolders: Bucket<ExportNoteFolder>;
  noteTags: Bucket<ExportNoteTag>;
  notes: Bucket<Omit<ExportNote, "snapshot">>;
  noteTagLinks: Bucket<ExportNoteTagLink>;
  noteAttachments: Bucket<ExportNoteAttachment>;
  noteVersions: Bucket<Omit<ExportNoteVersion, "snapshot">>;
  noteTemplates: Bucket<ExportNoteTemplate>;
}

function newCollections(): Collections {
  return {
    tasks: newBucket(), taskLists: newBucket(), taskSections: newBucket(),
    taskTags: newBucket(), taskTagLinks: newBucket(), taskAttachments: newBucket(),
    events: newBucket(), documents: newBucket(), renewals: newBucket(),
    people: newBucket(), subjects: newBucket(), exams: newBucket(), decks: newBucket(), cards: newBucket(),
    reviewLog: newBucket(), plans: newBucket(), blocks: newBucket(), focusSessions: newBucket(),
    notifications: newBucket(), noteFolders: newBucket(), noteTags: newBucket(), notes: newBucket(),
    noteTagLinks: newBucket(), noteAttachments: newBucket(), noteVersions: newBucket(),
    noteTemplates: newBucket(),
  };
}

/** Parses `raw` per its `type` and files it into the matching bucket. Throws `InvalidFieldError` on a bad field — the line loop turns that into `invalid-record`. `era` reaches only the two parsers whose rows gained fields after the first release (see `ArchiveEra`). */
function dispatchRecord(
  type: RecordType,
  raw: Record<string, unknown>,
  path: string,
  line: number,
  collections: Collections,
  problems: ImportProblem[],
  era: ArchiveEra,
): void {
  switch (type) {
    case "task": {
      const row = parseTask(raw, era);
      pushRow(collections.tasks, row.id, row, path, line, problems);
      return;
    }
    case "task-list": {
      const row = parseTaskList(raw);
      pushRow(collections.taskLists, row.id, row, path, line, problems);
      return;
    }
    case "task-section": {
      const row = parseTaskSection(raw);
      pushRow(collections.taskSections, row.id, row, path, line, problems);
      return;
    }
    case "task-tag": {
      const row = parseTaskTag(raw);
      pushRow(collections.taskTags, row.id, row, path, line, problems);
      return;
    }
    // A join row's identity is the PAIR (migration 023's PRIMARY KEY), exactly
    // as `note-tag-link`'s is — so that composite is what `duplicate-id` keys on.
    case "task-tag-link": {
      const row = parseTaskTagLink(raw);
      pushRow(collections.taskTagLinks, `taskId=${row.taskId},tagId=${row.tagId}`, row, path, line, problems);
      return;
    }
    case "task-attachment": {
      const row = parseTaskAttachment(raw);
      pushRow(collections.taskAttachments, row.id, row, path, line, problems);
      return;
    }
    case "event": {
      const row = parseEvent(raw, era);
      pushRow(collections.events, row.id, row, path, line, problems);
      return;
    }
    case "document": {
      const row = parseDocument(raw);
      pushRow(collections.documents, row.id, row, path, line, problems);
      return;
    }
    case "renewal": {
      const row = parseRenewal(raw);
      pushRow(collections.renewals, row.id, row, path, line, problems);
      return;
    }
    case "person": {
      const row = parsePerson(raw);
      pushRow(collections.people, row.id, row, path, line, problems);
      return;
    }
    case "subject": {
      const row = parseSubject(raw);
      pushRow(collections.subjects, row.id, row, path, line, problems);
      return;
    }
    case "exam": {
      const row = parseExam(raw);
      pushRow(collections.exams, row.id, row, path, line, problems);
      return;
    }
    case "deck": {
      const row = parseDeck(raw);
      pushRow(collections.decks, row.id, row, path, line, problems);
      return;
    }
    case "card": {
      const row = parseCard(raw);
      pushRow(collections.cards, row.id, row, path, line, problems);
      return;
    }
    case "review": {
      const row = parseReview(raw);
      pushRow(collections.reviewLog, row.id, row, path, line, problems);
      return;
    }
    case "plan": {
      const row = parsePlan(raw);
      pushRow(collections.plans, row.id, row, path, line, problems);
      return;
    }
    case "block": {
      const row = parseBlock(raw);
      pushRow(collections.blocks, row.id, row, path, line, problems);
      return;
    }
    case "focus-session": {
      const row = parseFocusSession(raw);
      pushRow(collections.focusSessions, row.id, row, path, line, problems);
      return;
    }
    case "notification": {
      const row = parseNotification(raw);
      pushRow(collections.notifications, row.id, row, path, line, problems);
      return;
    }
    case "note-folder": {
      const row = parseNoteFolder(raw);
      pushRow(collections.noteFolders, row.id, row, path, line, problems);
      return;
    }
    case "note-tag": {
      const row = parseNoteTag(raw);
      pushRow(collections.noteTags, row.id, row, path, line, problems);
      return;
    }
    case "note": {
      const row = parseNoteMeta(raw);
      pushRow(collections.notes, row.id, row, path, line, problems);
      return;
    }
    case "note-tag-link": {
      const row = parseNoteTagLink(raw);
      pushRow(collections.noteTagLinks, `noteId=${row.noteId},tagId=${row.tagId}`, row, path, line, problems);
      return;
    }
    case "note-attachment": {
      const row = parseNoteAttachment(raw);
      pushRow(collections.noteAttachments, row.id, row, path, line, problems);
      return;
    }
    case "note-version": {
      const row = parseNoteVersionMeta(raw);
      pushRow(
        collections.noteVersions,
        `noteId=${row.noteId},coveredSeq=${row.coveredSeq}`,
        row,
        path,
        line,
        problems,
      );
      return;
    }
    case "note-template": {
      const row = parseNoteTemplate(raw);
      pushRow(collections.noteTemplates, row.id, row, path, line, problems);
      return;
    }
  }
}

// --- Manifest parsing --------------------------------------------------------

function parseSettings(value: unknown): ExportSettings {
  const root = expectRecord(value, "settings");

  const flagsRoot = expectRecord(root.flags, "settings.flags");
  const flags: Record<string, boolean> = {};
  for (const [key, flagValue] of Object.entries(flagsRoot)) {
    flags[key] = bool(flagValue, `settings.flags.${key}`);
  }

  const notifRoot = expectRecord(root.notifications, "settings.notifications");
  const quietFrom = nullableHhmm(notifRoot.quietFrom, "settings.notifications.quietFrom");
  const quietTo = nullableHhmm(notifRoot.quietTo, "settings.notifications.quietTo");
  // `NotificationStore.saveSettings`' own pair rule: quiet hours are both set
  // or both cleared. A half-set pair is not a cosmetic oddity — the quiet-hours
  // window is what holds a notification back, and half of one has no meaning.
  if ((quietFrom === null) !== (quietTo === null)) {
    throw new InvalidFieldError("settings.notifications.quietTo");
  }
  const sourcesRaw = notifRoot.enabledSources;
  if (!Array.isArray(sourcesRaw)) throw new InvalidFieldError("settings.notifications.enabledSources");
  const notifications = {
    quietFrom,
    quietTo,
    morningHour: hhmm(notifRoot.morningHour, "settings.notifications.morningHour"),
    // Migration 009's `ntf_source_settings.source` CHECK. Settings ride in the
    // manifest rather than an NDJSON row, which is exactly how this constraint
    // could have been overlooked — a restore writes these values into that
    // table just the same.
    enabledSources: sourcesRaw.map((item, index) =>
      enumStr(item, `settings.notifications.enabledSources[${index}]`, NOTIFICATION_SOURCES),
    ),
  };

  return { flags, notifications };
}

function parseModules(value: unknown): { id: string; records: number }[] {
  if (!Array.isArray(value)) throw new InvalidFieldError("modules");
  return value.map((item, index) => {
    const entry = expectRecord(item, `modules[${index}]`);
    return {
      id: nonEmptyStr(entry.id, `modules[${index}].id`),
      records: nonNegativeInt(entry.records, `modules[${index}].records`),
    };
  });
}

/** Not part of the public `ImportManifest` shape (checksums are this module's own concern), but must be well-formed for checksum verification (step 4) to mean anything. */
function parseChecksums(value: unknown): Record<string, string> {
  const root = expectRecord(value, "checksums");
  const checksums: Record<string, string> = {};
  for (const [key, checksumValue] of Object.entries(root)) {
    checksums[key] = nonEmptyStr(checksumValue, `checksums.${key}`);
  }
  return checksums;
}

function parseBlobs(value: unknown): { sha256: string; sizeBytes: number }[] {
  if (!Array.isArray(value)) throw new InvalidFieldError("blobs");
  return value.map((item, index) => {
    const entry = expectRecord(item, `blobs[${index}]`);
    return {
      sha256: nonEmptyStr(entry.sha256, `blobs[${index}].sha256`),
      sizeBytes: positiveInt(entry.sizeBytes, `blobs[${index}].sizeBytes`),
    };
  });
}

/** `checksums` rides along internally (step 4 needs it) but is stripped before the manifest is handed back — it is not part of the public `ImportManifest` contract. */
function parseManifest(
  text: string,
): { ok: true; manifest: ImportManifest; checksums: Record<string, string> } | { ok: false; detail?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false };
  }

  const outcome = tryParse(() => {
    const root = expectRecord(parsed, "(root)");

    const schemaVersion = nonEmptyStr(root.schemaVersion, "schemaVersion");
    const appVersion = nonEmptyStr(root.appVersion, "appVersion");
    const createdAt = isoDateTime(root.createdAt, "createdAt");

    const profileRoot = expectRecord(root.profile, "profile");
    const profile = {
      id: nonEmptyStr(profileRoot.id, "profile.id"),
      name: nonEmptyStr(profileRoot.name, "profile.name"),
    };

    const settings = parseSettings(root.settings);
    const modules = parseModules(root.modules);
    const checksums = parseChecksums(root.checksums);
    const blobs = parseBlobs(root.blobs);

    const manifest: ImportManifest = { schemaVersion, appVersion, createdAt, profile, settings, modules, blobs };
    return { manifest, checksums };
  });

  if (!outcome.ok) return { ok: false, detail: outcome.detail };
  return { ok: true, manifest: outcome.value.manifest, checksums: outcome.value.checksums };
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function parseSemver(value: string): { major: number; minor: number; patch: number } | null {
  const match = SEMVER.exec(value);
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Refuses a `schemaVersion` that is newer than `INTERCHANGE_SCHEMA_VERSION` in
 * major or minor (patch may be anything — the writer's own patch bumps carry
 * no meaning a reader needs to reject on), or whose major isn't `1` at all.
 * An OLDER minor within major 1 is accepted, and that is the whole point of
 * bumping the minor when a record type is added: a 1.0 archive (written before
 * `person` existed) restores here unchanged, because it can only ever carry
 * FEWER types than this build knows. `1` is still the only major this build
 * has ever written, so there is no older major to accept via a migration path
 * yet (see the constant's own doc).
 */
function isSupportedSchemaVersion(schemaVersion: string): boolean {
  const candidate = parseSemver(schemaVersion);
  if (candidate === null) return false;
  if (candidate.major !== 1) return false;
  const current = parseSemver(INTERCHANGE_SCHEMA_VERSION);
  if (current === null) throw new Error("INTERCHANGE_SCHEMA_VERSION is not valid semver.");
  return candidate.minor <= current.minor;
}

// --- NDJSON line splitting ---------------------------------------------------

/** The writer ends every non-empty file with exactly one trailing `\n` (`toNdjson`) and renders zero rows as `""` — dropping one trailing empty element after a plain split handles both shapes uniformly. */
function splitNdjsonLines(content: string): string[] {
  const parts = content.split("\n");
  const last = parts[parts.length - 1];
  if (parts.length > 0 && last === "") parts.pop();
  return parts;
}

// --- Small problem-builder ---------------------------------------------------

function problem(
  severity: ImportProblem["severity"],
  code: ImportProblemCode,
  options: { path?: string; line?: number; detail?: string } = {},
): ImportProblem {
  return {
    severity,
    code,
    ...(options.path !== undefined ? { path: options.path } : {}),
    ...(options.line !== undefined ? { line: options.line } : {}),
    ...(options.detail !== undefined ? { detail: options.detail } : {}),
  };
}

// --- Yjs decode check ---------------------------------------------------------

/** Whether `bytes` decode as a Yjs update at all — a throwaway `Y.Doc`, applied once and destroyed, exactly the `mergeNoteState`/`extractNoteLinkTargets` ceremony, just discarding the result instead of reading it. */
function isValidYUpdate(bytes: Uint8Array): boolean {
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, bytes);
    return true;
  } catch {
    return false;
  } finally {
    probe.destroy();
  }
}

// --- Reference integrity & cycle detection -----------------------------------

/** Every row in `bucket` whose `getRef` result is non-null must resolve inside `targetIds`, else `unknown-reference` naming `field` and the dangling id. */
function checkReference<T>(
  bucket: Bucket<T>,
  getRef: (row: T) => string | null,
  field: string,
  targetIds: ReadonlySet<string>,
  problems: ImportProblem[],
): void {
  for (const entry of bucket.entries) {
    const ref = getRef(entry.row);
    if (ref === null) continue;
    if (!targetIds.has(ref)) {
      problems.push(
        problem("error", "unknown-reference", { path: entry.path, line: entry.line, detail: `${field}=${ref}` }),
      );
    }
  }
}

/**
 * Detects a cycle in a self-referencing parent chain (`task.parentId`,
 * `note-folder.parentId`) via three-colour DFS: a back-edge to a node still
 * "visiting" is a cycle, reported once (not once per node on it); a dangling
 * reference (already reported by `checkReference`) just ends the walk, since
 * an absent id can never be part of a cycle.
 */
function checkParentCycle<T>(
  bucket: Bucket<T>,
  getId: (row: T) => string,
  getParentId: (row: T) => string | null,
  path: string,
  problems: ImportProblem[],
): void {
  const parentOf = new Map<string, string | null>();
  for (const entry of bucket.entries) parentOf.set(getId(entry.row), getParentId(entry.row));

  const state = new Map<string, "visiting" | "done">();
  for (const startId of parentOf.keys()) {
    if (state.get(startId) === "done") continue;

    const visitedThisWalk: string[] = [];
    let current: string | null = startId;
    while (current !== null) {
      const currentState = state.get(current);
      if (currentState === "visiting") {
        problems.push(problem("error", "reference-cycle", { path, detail: current }));
        break;
      }
      if (currentState === "done") break;
      state.set(current, "visiting");
      visitedThisWalk.push(current);
      current = parentOf.get(current) ?? null;
    }
    for (const visited of visitedThisWalk) state.set(visited, "done");
  }
}

// --- Main entry point ---------------------------------------------------------

export function parseImportArchive(input: ImportArchiveInput): ImportArchiveResult {
  const problems: ImportProblem[] = [];

  const manifestText = input.files.get("manifest.json");
  if (manifestText === undefined) {
    problems.push(problem("error", "missing-manifest", { path: "manifest.json" }));
    return { problems, manifest: null, data: null };
  }

  const manifestOutcome = parseManifest(manifestText);
  if (!manifestOutcome.ok) {
    problems.push(
      problem(
        "error",
        "invalid-manifest",
        manifestOutcome.detail !== undefined
          ? { path: "manifest.json", detail: manifestOutcome.detail }
          : { path: "manifest.json" },
      ),
    );
    return { problems, manifest: null, data: null };
  }
  const { manifest, checksums } = manifestOutcome;

  if (!isSupportedSchemaVersion(manifest.schemaVersion)) {
    problems.push(
      problem("error", "unsupported-schema-version", { path: "manifest.json", detail: manifest.schemaVersion }),
    );
    return { problems, manifest, data: null };
  }

  // --- Checksums (rule 4). Iterating the UNION of the files this build knows
  // about and the files the manifest actually declares is what makes this both
  // airtight and version-proof. Iterating `DATA_FILES` alone would let a
  // manifest that simply omits a checksum entry hand us a data file nothing
  // covers; iterating the declared checksums alone would do the same for a
  // manifest that declares none. An older archive within the supported range
  // legitimately declares FEWER files than this build writes, and is accepted:
  // absent-and-undeclared is nothing at all, while present-and-undeclared is
  // data no checksum covers, which is unverifiable and therefore unrestorable.
  // Absence is always checked before comparison, never inferred as "matches
  // the hash of the empty string".
  for (const path of new Set<string>([...DATA_FILES, ...Object.keys(checksums)])) {
    const expected = checksums[path];
    const content = input.files.get(path);
    if (expected === undefined) {
      if (content !== undefined) {
        problems.push(problem("error", "checksum-mismatch", { path, detail: "undeclared" }));
      }
      continue;
    }
    if (content === undefined) {
      problems.push(problem("error", "missing-data-file", { path }));
      continue;
    }
    if (input.hash(content) !== expected) {
      problems.push(problem("error", "checksum-mismatch", { path }));
    }
  }

  // --- Records: parse every present data file, line by line. The era is read
  // once here, off the version the gate above just accepted, and carried into
  // every row: which fields this archive's writer is known to have written is a
  // property of the ARCHIVE, never of an individual line.
  const era = eraOf(manifest.schemaVersion);
  const collections = newCollections();
  for (const path of DATA_FILES) {
    const content = input.files.get(path);
    if (content === undefined) continue; // already reported above; nothing to parse
    const allowedTypes = FILE_RECORD_TYPES[path];

    splitNdjsonLines(content).forEach((line, index) => {
      const lineNumber = index + 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        problems.push(problem("error", "invalid-json", { path, line: lineNumber }));
        return;
      }
      if (!isRecord(parsed)) {
        problems.push(problem("error", "invalid-json", { path, line: lineNumber }));
        return;
      }
      const root = parsed;
      if (typeof root.type !== "string") {
        problems.push(problem("error", "invalid-json", { path, line: lineNumber }));
        return;
      }
      const type = root.type;

      // An ERROR, not a tolerated warning. "Ignore what you do not recognise"
      // is the right rule for additive schema evolution — but it is
      // unreachable here, because the version gate above already refuses any
      // archive newer than this build in major or minor, and an OLDER archive
      // can only ever carry FEWER types than this build knows. So a type we do
      // not recognise is never a newer Nexus; it is a damaged or hand-edited
      // file. Skipping the line would then quietly drop real rows from a
      // backup, which is the exact failure this whole reader exists to refuse.
      if (!isOneOf(type, ALL_RECORD_TYPES)) {
        problems.push(problem("error", "unknown-record-type", { path, line: lineNumber, detail: type }));
        return;
      }
      if (!allowedTypes.includes(type)) {
        problems.push(problem("error", "invalid-record", { path, line: lineNumber, detail: "type" }));
        return;
      }

      const dispatchOutcome = tryParse(() =>
        dispatchRecord(type, root, path, lineNumber, collections, problems, era),
      );
      if (!dispatchOutcome.ok) {
        problems.push(
          problem("error", "invalid-record", { path, line: lineNumber, detail: dispatchOutcome.detail }),
        );
      }
    });
  }

  // --- Yjs (rule 7): attach a note's snapshot when present; a note-version's
  // snapshot is required.
  const notes: ExportNote[] = collections.notes.entries.map((entry) => {
    const meta = entry.row;
    const ydocPath = `data/notes/${meta.id}.ydoc`;
    const bytes = input.ydocs.get(ydocPath);
    if (bytes === undefined) return { ...meta, snapshot: null };
    if (!isValidYUpdate(bytes)) {
      problems.push(problem("error", "invalid-ydoc", { path: ydocPath }));
      return { ...meta, snapshot: null };
    }
    return { ...meta, snapshot: bytes };
  });

  const noteVersions: ExportNoteVersion[] = [];
  for (const entry of collections.noteVersions.entries) {
    const meta = entry.row;
    const ydocPath = `data/note-versions/${meta.noteId}/${meta.coveredSeq}.ydoc`;
    const bytes = input.ydocs.get(ydocPath);
    if (bytes === undefined) {
      problems.push(problem("error", "missing-ydoc", { path: ydocPath }));
      continue;
    }
    if (!isValidYUpdate(bytes)) {
      problems.push(problem("error", "invalid-ydoc", { path: ydocPath }));
      continue;
    }
    noteVersions.push({ ...meta, snapshot: bytes });
  }

  // --- Blobs (rule 8): a missing blob is a warning — the row still restores.
  // Both attachment tables are checked, because both name the same `blobs/`
  // namespace: a task's file is as lost as a note's when the archive omits it,
  // and a warning raised for only one of them would under-report the damage the
  // restore preview shows the user.
  for (const entry of [
    ...collections.noteAttachments.entries,
    ...collections.taskAttachments.entries,
  ]) {
    const attachment = entry.row;
    if (!input.blobNames.has(attachment.sha256)) {
      problems.push(
        problem("warning", "missing-blob", { path: `blobs/${attachment.sha256}`, detail: attachment.id }),
      );
    }
  }

  // --- Reference integrity ----------------------------------------------------
  const taskIds = new Set(rowsOf(collections.tasks).map((row) => row.id));
  const taskListIds = new Set(rowsOf(collections.taskLists).map((row) => row.id));
  const taskTagIds = new Set(rowsOf(collections.taskTags).map((row) => row.id));
  /** Which list each section belongs to — a task's `sectionId` must resolve to a section of the task's OWN list, which a plain id set cannot say. */
  const listOfSection = new Map(rowsOf(collections.taskSections).map((row) => [row.id, row.listId]));
  const subjectIds = new Set(rowsOf(collections.subjects).map((row) => row.id));
  const examIds = new Set(rowsOf(collections.exams).map((row) => row.id));
  const deckIds = new Set(rowsOf(collections.decks).map((row) => row.id));
  const cardIds = new Set(rowsOf(collections.cards).map((row) => row.id));
  const planIds = new Set(rowsOf(collections.plans).map((row) => row.id));
  const documentIds = new Set(rowsOf(collections.documents).map((row) => row.id));
  const noteIds = new Set(rowsOf(collections.notes).map((row) => row.id));
  const folderIds = new Set(rowsOf(collections.noteFolders).map((row) => row.id));
  const tagIds = new Set(rowsOf(collections.noteTags).map((row) => row.id));

  checkReference(collections.tasks, (row) => row.parentId, "parentId", taskIds, problems);
  checkReference(collections.tasks, (row) => row.listId, "listId", taskListIds, problems);
  checkReference(collections.taskLists, (row) => row.parentId, "parentId", taskListIds, problems);
  checkReference(collections.taskSections, (row) => row.listId, "listId", taskListIds, problems);
  checkReference(collections.taskTagLinks, (row) => row.taskId, "taskId", taskIds, problems);
  checkReference(collections.taskTagLinks, (row) => row.tagId, "tagId", taskTagIds, problems);
  checkReference(collections.taskAttachments, (row) => row.taskId, "taskId", taskIds, problems);
  // The one reference `checkReference` cannot express: the section must exist
  // AND belong to the task's own list. A section of some other list would pass
  // every foreign key the schema has and still put the task under a heading
  // nothing renders.
  for (const entry of collections.tasks.entries) {
    const { sectionId, listId } = entry.row;
    if (sectionId === null) continue;
    if (listOfSection.get(sectionId) === listId) continue;
    problems.push(
      problem("error", "unknown-reference", {
        path: entry.path,
        line: entry.line,
        detail: `sectionId=${sectionId}`,
      }),
    );
  }
  checkReference(collections.exams, (row) => row.subjectId, "subjectId", subjectIds, problems);
  checkReference(collections.decks, (row) => row.subjectId, "subjectId", subjectIds, problems);
  checkReference(collections.cards, (row) => row.deckId, "deckId", deckIds, problems);
  checkReference(collections.cards, (row) => row.sourceNoteId, "sourceNoteId", noteIds, problems);
  checkReference(collections.reviewLog, (row) => row.cardId, "cardId", cardIds, problems);
  checkReference(collections.plans, (row) => row.examId, "examId", examIds, problems);
  checkReference(collections.blocks, (row) => row.planId, "planId", planIds, problems);
  checkReference(collections.focusSessions, (row) => row.subjectId, "subjectId", subjectIds, problems);
  checkReference(collections.renewals, (row) => row.documentId, "documentId", documentIds, problems);
  checkReference(collections.notes, (row) => row.folderId, "folderId", folderIds, problems);
  checkReference(collections.notes, (row) => row.cardDeckId, "cardDeckId", deckIds, problems);
  checkReference(collections.noteFolders, (row) => row.parentId, "parentId", folderIds, problems);
  checkReference(collections.noteTagLinks, (row) => row.noteId, "noteId", noteIds, problems);
  checkReference(collections.noteTagLinks, (row) => row.tagId, "tagId", tagIds, problems);
  checkReference(collections.noteAttachments, (row) => row.noteId, "noteId", noteIds, problems);
  checkReference(collections.noteVersions, (row) => row.noteId, "noteId", noteIds, problems);

  // --- Cycles: the three self-referencing parent chains.
  checkParentCycle(collections.tasks, (row) => row.id, (row) => row.parentId, "data/tasks.ndjson", problems);
  checkParentCycle(
    collections.taskLists,
    (row) => row.id,
    (row) => row.parentId,
    "data/tasks.ndjson",
    problems,
  );
  checkParentCycle(
    collections.noteFolders,
    (row) => row.id,
    (row) => row.parentId,
    "data/notes.ndjson",
    problems,
  );

  const hasError = problems.some((p) => p.severity === "error");
  const data: ProfileData | null = hasError
    ? null
    : {
        tasks: rowsOf(collections.tasks),
        taskLists: rowsOf(collections.taskLists),
        taskSections: rowsOf(collections.taskSections),
        taskTags: rowsOf(collections.taskTags),
        taskTagLinks: rowsOf(collections.taskTagLinks),
        taskAttachments: rowsOf(collections.taskAttachments),
        events: rowsOf(collections.events),
        documents: rowsOf(collections.documents),
        renewals: rowsOf(collections.renewals),
        people: rowsOf(collections.people),
        subjects: rowsOf(collections.subjects),
        exams: rowsOf(collections.exams),
        decks: rowsOf(collections.decks),
        cards: rowsOf(collections.cards),
        reviewLog: rowsOf(collections.reviewLog),
        plans: rowsOf(collections.plans),
        blocks: rowsOf(collections.blocks),
        focusSessions: rowsOf(collections.focusSessions),
        notifications: rowsOf(collections.notifications),
        notes,
        noteFolders: rowsOf(collections.noteFolders),
        noteTags: rowsOf(collections.noteTags),
        noteTagLinks: rowsOf(collections.noteTagLinks),
        noteTemplates: rowsOf(collections.noteTemplates),
        noteAttachments: rowsOf(collections.noteAttachments),
        noteVersions,
      };

  return { problems, manifest, data };
}
