import * as Y from "yjs";

import { TIME_GRID_MAX_END_MINUTES, TIME_GRID_MIN_EVENT_MINUTES } from "../calendar/timeGridDrag.js";
import { validateRecurrenceRule } from "../recurrence/recurrence.js";
import type { RecurrenceRule } from "../recurrence/recurrence.js";
import { renderClozeCard } from "../study/clozeText.js";
import { isEmptyTaskViewConfig, validateTaskViewConfig } from "../tasks/taskViewConfig.js";
import { ARCHIVE_PROFILE_KINDS, DATA_FILES } from "./exportArchive.js";
import type {
  ArchiveModuleId,
  ArchiveProfileKind,
  ArchiveProfilePicture,
  ExportCalendarSettings,
  ExportCard,
  ExportDashboardSet,
  ExportDashboardSettings,
  ExportDashboardWidget,
  ExportDeck,
  ExportDocument,
  ExportEvent,
  ExportEventTemplate,
  ExportEventTemplatePayload,
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
  ExportStudySettings,
  ExportSubject,
  ExportSubjectAttachment,
  ExportSubjectNoteLink,
  ExportTask,
  ExportTaskAttachment,
  ExportTaskDependency,
  ExportTaskList,
  ExportTaskSection,
  ExportTaskTag,
  ExportTaskTagLink,
  ExportTaskTemplate,
  ExportTaskTemplatePayload,
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
  /**
   * The profile the archive is OF. `picture` is `null` both for a profile that
   * has none and for every archive written before `1.18.0` — indistinguishable
   * on purpose, because they mean the same thing (an OPTIONAL-with-a-default
   * field, so no `ArchiveEra` flag; see `INTERCHANGE_SCHEMA_VERSION`). A picture
   * that IS declared is validated strictly, in every era. `kind` (ADR-058,
   * `1.22.0`) follows the same rule: absent means `"personal"` — the only kind
   * any earlier archive could be of — and a declared value is validated
   * strictly against the closed domain.
   */
  profile: {
    id: string;
    name: string;
    kind: ArchiveProfileKind;
    picture: ArchiveProfilePicture | null;
  };
  settings: ExportSettings;
  modules: readonly { id: string; records: number }[];
  blobs: readonly { sha256: string; sizeBytes: number }[];
}

/**
 * How strict the reader is about ONE bad row (ADR-043 section 1).
 *
 * `"restore"` — the default and the original contract: a restore REPLACES a
 * profile, so a row it cannot read is data the user is about to lose, and the
 * only honest answer is to refuse the whole archive and say why.
 *
 * `"import"` — a foreign import MERGES an archive into a profile that already
 * has data, so refusing everything over one damaged row throws away the other
 * nine thousand good ones. A per-row structural problem is demoted to a
 * warning, the row is dropped, the drop cascades along references, and every
 * drop is named in `problems` and counted in `dropped` — salvage, never
 * silence.
 *
 * The GRAMMAR is identical in both: one parser, one set of rules, two
 * strictness policies. Archive-level problems (bad manifest, bad checksums,
 * unsupported version, a malformed NDJSON line) stay hard errors in both
 * modes — a corrupt container is not something to guess at.
 */
export type ImportMode = "restore" | "import";

/** The `ImportProblemCode`s that cost a row its place in import mode (see `ImportDrop`). */
export type ImportDropReason =
  | "unknown-record-type"
  | "invalid-record"
  | "duplicate-id"
  | "unknown-reference"
  | "reference-cycle"
  | "missing-ydoc"
  | "invalid-ydoc";

/**
 * One row import mode dropped, in structured form. `problems` already NAMES
 * every drop (with its path and line) for a person reading a report; this is
 * the same fact in a shape a planner can count by module without re-parsing
 * prose — `planForeignImport` folds it straight into `ImportPlanReport`.
 * Always empty in restore mode, which refuses rather than drops.
 */
export interface ImportDrop {
  /** The manifest module the dropped row belonged to, from the data file it rode in. */
  module: ArchiveModuleId;
  /** The record type, or null when the row's own `type` was not one this build knows (the raw string is then in `detail`). */
  type: ArchiveRecordType | null;
  reason: ImportDropReason;
  /** A short English machine-ish detail — the offending field, id or `field=id` reference. Never a sentence for a user. */
  detail: string;
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
  /** Row-level strictness. Absent means `"restore"`, so every pre-ADR-043 caller keeps the contract it was written against. */
  mode?: ImportMode;
}

export interface ImportArchiveResult {
  /** Every problem found, in discovery order. */
  problems: readonly ImportProblem[];
  /** The manifest, when it parsed — available even when `data` is null, so a caller can name the archive in an error report. */
  manifest: ImportManifest | null;
  /** Non-null only when NO problem has severity "error". Warnings do not withhold it. */
  data: ProfileData | null;
  /** Every row import mode salvaged past, in discovery order. Always empty in restore mode. */
  dropped: readonly ImportDrop[];
}

/**
 * The schema version this build writes and is the newest it accepts, kept in
 * step with `buildExportArchive`'s own `SCHEMA_VERSION`. `1.24.0` added a task
 * list's kanban column arrangement (ADR-060): `hiddenColumns`/`columnOrder`
 * INSIDE the `task-list` row's existing `viewConfig` object, both optional and
 * absent meaning "every column drawn, in natural order" — which is what every
 * earlier archive's boards were, so no `ArchiveEra` flag. A minor bump even
 * though no record type and no top-level field changed, because `viewConfig`
 * is re-validated STRICTLY here (`parseTaskList`): a pre-`1.24.0` build handed
 * these members would refuse the row as malformed rather than carry it blind,
 * and the version gate owes it the honest answer instead of that baffling
 * field error. (`1.23.0` is a concurrent lane's own entry — see the note at
 * the constant.) Before it, `1.22.0` added the
 * profile's `kind` on the manifest's own `profile` object (ADR-058, business
 * profiles) — always written on the way out, OPTIONAL with the default
 * `"personal"` on the way in, since a personal profile is the only kind any
 * earlier archive could be OF — after `1.21.0` added named
 * dashboards (DASH-008 / ADR-055, migration 043) — the `dashboard-set` record
 * type riding in the data file `1.9.0` created, an OPTIONAL `setId` on
 * `dashboard-widget` and an OPTIONAL `activeSetId` on `dashboard-settings`,
 * each absent meaning the default board, which is the only board any earlier
 * archive could describe — after `1.20.0` added the `calendar-settings`
 * record type — the profile's fixed semester dates (CAL-010 / ADR-054,
 * migration 042), zero-or-one row riding first in the data file the CAL module
 * already had, exactly as `study-settings` rides in its own — after `1.19.0` added the
 * profile's default snooze preset (NTF-009, migration 041) — one field in the
 * manifest's `settings.notifications` object, beside the quiet hours it is a
 * sibling preference of — after `1.18.0` added a
 * profile's picture (SET-001, migration 040) — three fields on the manifest's
 * own `profile` object, declaring a blob in the same `blobs/` union every
 * attachment travels in. A MANIFEST field rather than a record type, because a
 * picture is a fact about the profile exactly as its name is, and because every
 * `ProfileData` collection belongs to one archive module while a profile's
 * identity belongs to none — after `1.17.0` added a note folder's `defaultView`
 * — the shape its notes are drawn in (NOTE-002, migration 039) — after
 * `1.16.0` added a task
 * list's `viewConfig` — what it remembers about each of its four views (ADR-050,
 * migration 038) — after `1.15.0` added the
 * `event-template` record type — a saved SHAPE of one event (CAL-009, migration
 * 036), riding in the data file the CAL module already had — after `1.14.0`
 * added the `subject-attachment` and `subject-note-link` record types — a
 * subject's materials and the notes filed under it (STUDY-001, migration 035),
 * both riding in the data file the STUDY module already had — after `1.13.0`
 * added the
 * `study-settings` record type — one profile's FSRS target retention and its
 * two daily caps (STUDY-007, migration 034), riding in that same file — after
 * `1.12.0` added a
 * card's `problemSteps` — the worked solution its `back` is derived from
 * (ADR-046) — after `1.11.0` added the `dashboard-widget` record type — the
 * profile's dashboard layout (DASH-002 / ADR-045, migration 032) — riding in
 * the data file `1.9.0` already created, and `1.10.0` added a
 * card's `kind` and a cloze card's `clozeText`/`clozeOrdinal` (STUDY-006 /
 * ADR-042), `1.9.0` the `dashboard-settings` record type and its
 * own data file (SET-006 / ADR-041), `1.8.0` the `task-dependency` record type
 * (migration 029 / ADR-037), `1.5.0`-`1.7.0` task attachments, task templates
 * and the NOTE folder preferences, `1.4.0` the `task-tag`/`task-tag-link`
 * types (migration 023), `1.3.0` the `task-list`/`task-section` types and a
 * task's placement into them (TASK-004 / ADR-029), `1.2.0` a task's
 * `reminderOffsets` (ADR-028) and `1.1.0` the `person` record type (CAL-007 /
 * ADR-026): additive changes, hence MINOR bumps, which is exactly the
 * compatibility mechanism
 * `isSupportedSchemaVersion` implements — an older minor within major 1 still
 * passes the gate here, while an older build refuses a newer archive rather
 * than silently dropping what it cannot see (every person, every task's ladder,
 * every list the user filed their work into, every label they sorted it by, or
 * every cloze card's template). That, in turn, is why an unrecognised record
 * type below is an ERROR: the version gate makes "ignore what you do not know"
 * unreachable.
 *
 * A new RECORD TYPE needs no `ArchiveEra` flag, unlike a new field on an
 * existing type: an older archive simply carries none of it, which is
 * indistinguishable from a profile that had no dependencies — or, at `1.9.0`,
 * from one that never chose a dashboard background, or, at `1.11.0`, from one
 * that never rearranged its dashboard, or, at `1.13.0`, from one that never
 * touched its study preferences, at `1.14.0` from one whose subjects carry
 * neither materials nor linked notes, or, at `1.15.0`, from one that never
 * saved an event as a template, or, at `1.20.0`, from one that never set its
 * semester dates — while a NEWER archive
 * never reaches a parser at all, because the gate above refuses it. Era flags
 * exist only for the "this row is missing a field it now must have" question,
 * which a whole absent type never asks — and which an OPTIONAL-with-a-default
 * field never asks either: `kind`'s absence means `"basic"` in every era,
 * because that is what every pre-ADR-042 archive's cards actually were,
 * `problemSteps`'s absence means "no worked solution", because that is what
 * every pre-ADR-046 archive's cards actually had, a task list's
 * `viewConfig` absence means "no view preferences", because a list written
 * before ADR-050 had no views to have preferences about, a note folder's
 * `defaultView` absence means `"list"`, because that is the only shape a folder
 * written before NOTE-002's toggle was ever drawn in, and `profile.picture`'s
 * absence means "no picture", because no profile written before `1.18.0` could
 * have had one, `settings.notifications.snoozeDefault`'s absence means
 * „10 min“, because that is what the snooze button did in every build before
 * `1.19.0` gave it a preference to read, and a widget's `setId` — like the
 * settings row's `activeSetId` — absent means the DEFAULT board, because
 * before `1.21.0` there was no other board a row could belong to.
 *
 * Major is still 1 throughout, so there is nothing yet to migrate an older
 * major forward from — a migration framework for a major that has never
 * shipped would be speculative machinery with nothing to exercise it.
 *
 */
// SUPERVISOR NOTE: 1.24.0 skips 1.23.0 on purpose — a sibling lane concurrently
// holds 1.23.0. Kept equal to `SCHEMA_VERSION` (exportArchive.ts) by
// importArchive.test.ts; whichever lane merges second leaves the HIGHER number
// standing and keeps both history entries.
export const INTERCHANGE_SCHEMA_VERSION = "1.24.0";

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
  /**
   * A note folder's `defaultTemplateId`/`isCaptureDefault` (NOTE prefs /
   * ADR-036) — added AT the `1.7.0` bump, the arrangement `writesTaskLists`
   * established: below `1.7.0` their absence is expected and defaults to
   * `null`/`false`, at `1.7.0` and above a folder must state both. `false` is
   * the honest default for the capture flag specifically because it is a
   * per-profile SINGLETON: defaulting it to `true` on an era that never wrote
   * it would let an old archive claim the mark for every folder at once.
   */
  writesNoteFolderPrefs: boolean;
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
      writesNoteFolderPrefs: true,
    };
  }
  return {
    writesRecurrenceAndEventReminders: version.minor >= 1,
    writesTaskReminders: version.minor >= 2,
    writesTaskLists: version.minor >= 3,
    writesNoteFolderPrefs: version.minor >= 7,
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

/**
 * A name/title the writing store keeps TRIMMED, checked against what that store
 * would itself have written: whitespace-only is refused, and a value carrying
 * outer whitespace is refused too rather than silently trimmed here — the
 * writer emits the canonical form, so anything else is a row the store did not
 * write. `maxLength` (after trimming, which is the same string) is optional
 * because a task title has no cap at all (`TaskStore.validateTitle`).
 */
function trimmedNonEmptyStr(value: unknown, field: string, maxLength?: number): string {
  const s = nonEmptyStr(value, field);
  if (s !== s.trim()) throw new InvalidFieldError(field);
  if (maxLength !== undefined && s.length > maxLength) throw new InvalidFieldError(field);
  return s;
}

function nullableNonEmptyStr(value: unknown, field: string): string | null {
  return value === null ? null : nonEmptyStr(value, field);
}

/**
 * A string whose CONTENT must itself be JSON — what a `TEXT` column documented
 * as holding JSON actually holds. Parsed and thrown away: nothing here
 * interprets the value (see `parseDashboardWidget`), the parse IS the check.
 */
function jsonText(value: unknown, field: string): string {
  const s = nonEmptyStr(value, field);
  try {
    JSON.parse(s);
  } catch {
    throw new InvalidFieldError(field);
  }
  return s;
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

/** `intInRange`'s twin for a REAL column — the one interchange field (a target retention) that is deliberately not a whole number. */
function numberInRange(value: unknown, field: string, min: number, max: number): number {
  const n = finiteNumber(value, field);
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

/**
 * An array of trimmed, non-empty names, the array capped at `maxItems` and each
 * item at `maxItemLength` — the shape a task template's `tagNames` and
 * `subtaskTitles` both take. `unique` is what tells them apart, and the
 * difference is real: two identical tags are ONE label (migration 023's
 * PRIMARY KEY says so, and `TaskTemplateStore` de-duplicates), while two
 * identical subtask titles are two things to do. Repetition is therefore
 * refused for the first and kept in order for the second.
 */
function boundedNameArray(
  value: unknown,
  field: string,
  maxItems: number,
  maxItemLength: number,
  unique: boolean,
): string[] {
  if (!Array.isArray(value)) throw new InvalidFieldError(field);
  const entries: readonly unknown[] = value;
  if (entries.length > maxItems) throw new InvalidFieldError(field);
  const names = entries.map((item, index) =>
    trimmedNonEmptyStr(item, `${field}[${index}]`, maxItemLength),
  );
  if (unique && new Set(names).size !== names.length) throw new InvalidFieldError(field);
  return names;
}

/** Exactly the 64 lowercase hex characters the blob store names a file by — and exactly what `blobs/<name>` must spell for the archive to be able to carry it. */
function sha256Hex(value: unknown, field: string): string {
  const s = nonEmptyStr(value, field);
  if (!SHA256_PATTERN.test(s)) throw new InvalidFieldError(field);
  return s;
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

/**
 * A field whose only legal value in THIS shape is absence: an all-day event
 * template's `startTime`. Written as its own validator rather than an `if`, so
 * a violation is the same named `invalid-record` detail every other field
 * produces rather than a differently-worded refusal.
 */
function nullOnly(value: unknown, field: string): null {
  if (value === null || value === undefined) return null;
  throw new InvalidFieldError(field);
}

/** `HH:MM` as minutes from midnight. Only ever called on a value `hhmm` has already accepted. */
function clockMinutes(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
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
/** Mirrors the `cards.kind` CHECK of migration 031 (ADR-042). */
const CARD_KINDS = ["basic", "cloze"] as const;
/** Mirrors `MAX_TEXT_LENGTH` in `@nexus/db`'s `study/cardStore.ts` — the cap every card text column lives under. */
const MAX_CARD_TEXT_LENGTH = 10_000;
const REVIEW_RATINGS = [1, 2, 3, 4] as const;
const STUDY_BLOCK_STATUSES = ["planned", "done", "missed"] as const;
/**
 * Mirrors the `notifications.source` CHECK as migration 037 leaves it — the
 * LEDGER's domain, which includes `"security"` (NTF-007) because a recorded
 * security event is history like any other row.
 */
const NOTIFICATION_SOURCES = ["document", "exam", "study-day", "event", "task", "security"] as const;

/**
 * Mirrors the narrower `ntf_source_settings.source` CHECK, which migration 037
 * deliberately leaves alone: `"security"` is not a preference, so it can never
 * appear in a settings row — or in the `enabledSources` list one is written
 * from.
 */
const TOGGLEABLE_NOTIFICATION_SOURCES = ["document", "exam", "study-day", "event", "task"] as const;

/**
 * Mirrors `SNOOZE_PRESETS` in `@nexus/db`'s `notify/notificationStore.ts` and
 * migration 041's CHECK (copied, not imported — the `NOTE_FOLDER_COLORS`
 * arrangement). `DEFAULT_SNOOZE_PRESET` beside it is what an archive written
 * before `1.19.0` means by saying nothing.
 */
const SNOOZE_PRESETS = ["10m", "1h", "tonight", "tomorrow-morning"] as const;
const DEFAULT_SNOOZE_PRESET = "10m";
const NOTIFICATION_STATUSES = ["delivered", "snoozed", "dismissed"] as const;
const PERSON_KINDS = ["birthday", "anniversary"] as const;
/** Mirrors `TASK_LIST_VIEWS` in `@nexus/db`'s `tasks/taskListStore.ts` and migration 038's CHECK (copied, not imported — the `NOTE_FOLDER_COLORS` arrangement). */
const TASK_LIST_VIEWS = ["list", "kanban", "cards", "calendar"] as const;
/** Mirrors `NOTE_FOLDER_VIEWS` in `@nexus/db`'s `notes/noteOrgStore.ts` and migration 039's CHECK. Narrower than the list's set above, and deliberately: a note has neither a select field to make columns from nor a date to sit on. */
const NOTE_FOLDER_VIEWS = ["list", "cards"] as const;

/**
 * Mirrors `MAX_BACKGROUND_DIM` in `@nexus/db`'s
 * `dashboard/dashboardSettingsStore.ts` and migration 030's CHECK (copied, not
 * imported — the `NOTE_FOLDER_COLORS` arrangement).
 */
const MAX_BACKGROUND_DIM = 90;

/**
 * Mirrors `MIN_TARGET_RETENTION`/`MAX_TARGET_RETENTION`/`MAX_NEW_PER_DAY`/
 * `MAX_REVIEWS_PER_DAY` in `@nexus/db`'s `study/studySettingsStore.ts` and
 * migration 034's three CHECKs (copied, not imported — the `NOTE_FOLDER_COLORS`
 * arrangement). Each is restated here so an out-of-range value in an archive is
 * a named `invalid-record` rather than a raw SQLite constraint error inside the
 * restore transaction.
 */
const MIN_TARGET_RETENTION = 0.7;
const MAX_TARGET_RETENTION = 0.97;
const MAX_NEW_PER_DAY = 100;
const MAX_REVIEWS_PER_DAY = 1000;

/**
 * Mirrors `DASHBOARD_WIDGET_SIZES` in `@nexus/db`'s
 * `dashboard/dashboardWidgetStore.ts`, migration 032's `size` CHECK and
 * `WidgetSize` in this package's own widget contract (copied here rather than
 * imported from `@nexus/db` — the `NOTE_FOLDER_COLORS` arrangement).
 */
const DASHBOARD_WIDGET_SIZES = ["S", "M", "L"] as const;

/**
 * Mirrors `MAX_DASHBOARD_SET_NAME_LENGTH` in `@nexus/db`'s
 * `dashboard/dashboardSetStore.ts` (copied, not imported — `@nexus/core` must
 * not depend on `@nexus/db`), the `NOTE_FOLDER_COLORS` arrangement.
 */
const MAX_DASHBOARD_SET_NAME_LENGTH = 100;

/**
 * A widget id as a module's manifest publishes it: `moduleId:widgetId`, both
 * ASCII kebab slugs. Mirrors `WIDGET_ID_PATTERN` in `@nexus/db`'s
 * `dashboard/dashboardWidgetStore.ts`. The SHAPE is all either side checks —
 * which widgets exist is the module registry's catalogue, and an archive
 * naming one this build does not carry is a layout to keep, not a row to
 * refuse (migration 032).
 */
const WIDGET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The inline image formats a dashboard background — and, since `1.18.0`, a
 * profile picture — may use. `isInlineImageMime` (`@nexus/core`'s own
 * `files/sniff.ts`) spelled as a closed list so `enumStr` can name the offending
 * field the way every other enum here does. The two are pinned equal by this
 * module's own tests. ONE list for both, deliberately: they are the same
 * question — "will `nx-blob:` serve this and will Chromium decode it" — asked
 * about two blobs.
 */
const BACKGROUND_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/** A plaintext sha256 exactly as the blob store names one, and as `blobs/<name>` spells it in the archive. */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

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

/**
 * Mirrors `MAX_TASK_TEMPLATE_NAME_LENGTH` / `MAX_TASK_TEMPLATE_DUE_OFFSET_DAYS`
 * / `MAX_TASK_TEMPLATE_TAGS` / `MAX_TASK_TEMPLATE_SUBTASKS` in `@nexus/db`'s
 * `tasks/taskTemplateStore.ts`, plus `MAX_TASK_TAG_NAME_LENGTH` from
 * `tasks/taskTagStore.ts` (copied, not imported — `@nexus/core` must not depend
 * on `@nexus/db`), the same arrangement as the caps above. Nothing in migration
 * 027 can CHECK a JSON column, so an archive is the one way a payload could
 * reach that column having passed nobody's validator.
 */
const MAX_TASK_TEMPLATE_NAME_LENGTH = 80;
const MAX_TASK_TEMPLATE_DUE_OFFSET_DAYS = 365;
const MAX_TASK_TEMPLATE_TAGS = 20;
const MAX_TASK_TEMPLATE_SUBTASKS = 30;
const MAX_TASK_TAG_NAME_LENGTH = 50;

/**
 * Mirrors `MAX_EVENT_TEMPLATE_NAME_LENGTH` in `@nexus/db`'s
 * `events/eventTemplateStore.ts` (copied, not imported — `@nexus/core` must not
 * depend on `@nexus/db`), for the reason the task-template caps above are:
 * nothing in migration 036 can CHECK a JSON column, so an archive is the one way
 * a payload could reach that column having passed nobody's validator.
 *
 * The two span bounds are NOT copies: `TIME_GRID_MIN_EVENT_MINUTES` and
 * `TIME_GRID_MAX_END_MINUTES` live in THIS package (`calendar/timeGridDrag.ts`)
 * and the store re-exports them, so both sides genuinely share one constant and
 * the usual copy-drift risk does not arise.
 */
const MAX_EVENT_TEMPLATE_NAME_LENGTH = 80;

// --- Record type discriminants ----------------------------------------------

/** Every record type the interchange carries, spelled exactly as the `type` discriminant on an NDJSON row. Exported because `ImportDrop` names one. */
export type ArchiveRecordType =
  | "task"
  | "task-list"
  | "task-section"
  | "task-tag"
  | "task-tag-link"
  | "task-attachment"
  | "task-template"
  | "task-dependency"
  | "event"
  | "event-template"
  | "document"
  | "renewal"
  | "person"
  | "calendar-settings"
  | "subject"
  | "subject-attachment"
  | "subject-note-link"
  | "exam"
  | "deck"
  | "card"
  | "review"
  | "plan"
  | "block"
  | "focus-session"
  | "study-settings"
  | "notification"
  | "note-folder"
  | "note-tag"
  | "note"
  | "note-tag-link"
  | "note-attachment"
  | "note-version"
  | "note-template"
  | "dashboard-settings"
  | "dashboard-set"
  | "dashboard-widget";

const ALL_RECORD_TYPES: readonly ArchiveRecordType[] = [
  "task",
  "task-list",
  "task-section",
  "task-tag",
  "task-tag-link",
  "task-attachment",
  "task-template",
  "task-dependency",
  "event",
  "event-template",
  "document",
  "renewal",
  "person",
  "calendar-settings",
  "subject",
  "subject-attachment",
  "subject-note-link",
  "exam",
  "deck",
  "card",
  "review",
  "plan",
  "block",
  "focus-session",
  "study-settings",
  "notification",
  "note-folder",
  "note-tag",
  "note",
  "note-tag-link",
  "note-attachment",
  "note-version",
  "note-template",
  "dashboard-settings",
  "dashboard-set",
  "dashboard-widget",
];

type DataFilePath = (typeof DATA_FILES)[number];

/** Which record types the writer puts in each of the five NDJSON files — a type in any OTHER file is `invalid-record` (detail `"type"`), not silently accepted (ADR-022). */
const FILE_RECORD_TYPES: Record<DataFilePath, readonly ArchiveRecordType[]> = {
  "data/tasks.ndjson": [
    "task-list",
    "task-section",
    "task-tag",
    "task",
    "task-tag-link",
    "task-attachment",
    "task-template",
    "task-dependency",
  ],
  "data/calendar.ndjson": [
    "calendar-settings",
    "event",
    "document",
    "renewal",
    "person",
    "event-template",
  ],
  "data/study.ndjson": [
    "study-settings",
    "subject",
    "subject-attachment",
    "subject-note-link",
    "exam",
    "deck",
    "card",
    "review",
    "plan",
    "block",
    "focus-session",
  ],
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
  "data/dashboard.ndjson": ["dashboard-settings", "dashboard-set", "dashboard-widget"],
};

/**
 * Which manifest module each data file's rows belong to — the same grouping
 * `countProfileModules` counts by, spelled here as an explicit map rather than
 * relying on `DATA_FILES` and `ARCHIVE_MODULE_IDS` happening to be in the same
 * order. A dropped row is reported against its module (ADR-043), and a report
 * that attributed drops to the wrong module would be worse than none.
 */
const MODULE_OF_DATA_FILE: Record<DataFilePath, ArchiveModuleId> = {
  "data/tasks.ndjson": "tasks",
  "data/calendar.ndjson": "calendar",
  "data/study.ndjson": "study",
  "data/notifications.ndjson": "notifications",
  "data/notes.ndjson": "notes",
  "data/dashboard.ndjson": "dashboard",
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
  // Optional with a default (absent or null = no preferences), so no era flag —
  // see the `problemSteps` reasoning at INTERCHANGE_SCHEMA_VERSION. A PRESENT
  // value is validated by the very function the store writes through, strictly:
  // an archive is a file a person can edit, and a shape this build cannot read
  // must not be smuggled into a column that has no CHECK to catch it.
  const viewConfig =
    raw.viewConfig === undefined || raw.viewConfig === null
      ? null
      : validateTaskViewConfig(raw.viewConfig);
  if (viewConfig === null && raw.viewConfig !== undefined && raw.viewConfig !== null) {
    throw new InvalidFieldError("viewConfig");
  }
  const position = int(raw.position, "position");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return {
    id, profileId, parentId, name, isInbox, defaultView,
    viewConfig: viewConfig === null || isEmptyTaskViewConfig(viewConfig) ? null : viewConfig,
    position, createdAt, updatedAt,
  };
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

/**
 * `TaskTemplateStore.validatePayload`'s twin (ADR-035). Every field is
 * revalidated rather than passed through, because a payload lives in a JSON
 * column no `CHECK` can reach: this parser and that store's own validator are
 * between them the ONLY two gates the value ever passes, and they must agree.
 *
 * Nested, so the field paths a problem names read `payload.title`,
 * `payload.tagNames[2]` — the row's own structure, which is what makes an
 * `invalid-record` detail something a person can go and fix.
 */
function parseTaskTemplatePayload(value: unknown, field: string): ExportTaskTemplatePayload {
  const raw = expectRecord(value, field);

  const title = trimmedNonEmptyStr(raw.title, `${field}.title`);
  const description = nullableStr(raw.description, `${field}.description`);
  const priority = enumStr(raw.priority, `${field}.priority`, TASK_PRIORITIES);
  const dueOffsetDays =
    raw.dueOffsetDays === null
      ? null
      : intInRange(raw.dueOffsetDays, `${field}.dueOffsetDays`, 0, MAX_TASK_TEMPLATE_DUE_OFFSET_DAYS);
  const reminderOffsets = boundedIntArray(
    raw.reminderOffsets,
    `${field}.reminderOffsets`,
    MAX_TASK_REMINDER_DAYS,
    MAX_TASK_REMINDERS,
  );
  const recurrence = nullableRecurrenceRule(raw.recurrence, `${field}.recurrence`);
  const tagNames = boundedNameArray(
    raw.tagNames,
    `${field}.tagNames`,
    MAX_TASK_TEMPLATE_TAGS,
    MAX_TASK_TAG_NAME_LENGTH,
    true,
  );
  const subtaskTitles = boundedNameArray(
    raw.subtaskTitles,
    `${field}.subtaskTitles`,
    MAX_TASK_TEMPLATE_SUBTASKS,
    // A subtask title is a TASK title, and `TaskStore` puts no length cap on
    // one; the array cap alone bounds this field, so the per-item bound is the
    // same "no cap" (`Infinity`) that store enforces.
    Number.POSITIVE_INFINITY,
    false,
  );

  // The anchor rule (ADR-024 / ADR-028) as the store states it against the
  // RELATIVE offset: a ladder counts days back from the due date the apply
  // computes, and a rule phases from it, so a template carrying either must
  // describe one. `0` satisfies it — "due the day it is applied" is a date.
  if (reminderOffsets.length > 0 && dueOffsetDays === null) {
    throw new InvalidFieldError(`${field}.dueOffsetDays`);
  }
  if (recurrence !== null && dueOffsetDays === null) {
    throw new InvalidFieldError(`${field}.dueOffsetDays`);
  }

  return {
    title,
    description,
    priority,
    dueOffsetDays,
    reminderOffsets,
    recurrence,
    tagNames,
    subtaskTitles,
  };
}

function parseTaskTemplate(raw: Record<string, unknown>): ExportTaskTemplate {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const name = trimmedNonEmptyStr(raw.name, "name", MAX_TASK_TEMPLATE_NAME_LENGTH);
  const payload = parseTaskTemplatePayload(raw.payload, "payload");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, profileId, name, payload, createdAt, updatedAt };
}

/**
 * One dependency edge (migration 029 / ADR-037). The self-edge is refused right
 * here rather than in the cycle pass below, because it needs no graph to see and
 * `invalid-record` names the field a person can go fix; a longer loop, which
 * only the whole file can reveal, is `reference-cycle` further down.
 */
function parseTaskDependency(raw: Record<string, unknown>): ExportTaskDependency {
  const blockerId = nonEmptyStr(raw.blockerId, "blockerId");
  const blockedId = nonEmptyStr(raw.blockedId, "blockedId");
  if (blockerId === blockedId) throw new InvalidFieldError("blockedId");
  return { blockerId, blockedId };
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

/**
 * `EventTemplateStore.validatePayload`'s twin (CAL-009). Every field is
 * revalidated rather than passed through, because a payload lives in a JSON
 * column no `CHECK` can reach: this parser and that store's own validator are
 * between them the ONLY two gates the value ever passes, and they must agree.
 *
 * Nested, so the field paths a problem names read `payload.startTime`,
 * `payload.reminderOffsets` — the row's own structure, which is what makes an
 * `invalid-record` detail something a person can go and fix.
 */
function parseEventTemplatePayload(
  value: unknown,
  field: string,
): ExportEventTemplatePayload {
  const raw = expectRecord(value, field);

  const title = trimmedNonEmptyStr(raw.title, `${field}.title`);
  const allDay = bool(raw.allDay, `${field}.allDay`);
  // The store's pair rule, both ways round: a timed template MUST name the
  // minute it starts at, and an all-day one must not — an all-day event's start
  // is a bare day key, with no clock part to put one in.
  const startTime = allDay
    ? nullOnly(raw.startTime, `${field}.startTime`)
    : hhmm(raw.startTime, `${field}.startTime`);
  const durationMinutes =
    raw.durationMinutes === null || raw.durationMinutes === undefined
      ? null
      : intInRange(
          raw.durationMinutes,
          `${field}.durationMinutes`,
          TIME_GRID_MIN_EVENT_MINUTES,
          TIME_GRID_MAX_END_MINUTES,
        );
  const location = nullableStr(raw.location, `${field}.location`);
  const description = nullableStr(raw.description, `${field}.description`);
  const category = nullableStr(raw.category, `${field}.category`);
  const reminderOffsets = boundedIntArray(
    raw.reminderOffsets,
    `${field}.reminderOffsets`,
    MAX_EVENT_REMINDER_MINUTES,
    MAX_EVENT_REMINDERS,
  );
  // No anchor check on the rule, unlike an `event` row's: a template carries no
  // start day at all, and apply supplies a real one.
  const recurrence = nullableRecurrenceRule(raw.recurrence, `${field}.recurrence`);

  // The store's two cross-field rules. A duration belongs to a span of clock
  // time, so an all-day template cannot carry one; and the span has to END
  // inside its own day, because a timed event's end lives on its start's day
  // (`TIME_GRID_MAX_END_MINUTES` is 23:59 for exactly that reason).
  if (durationMinutes !== null) {
    if (startTime === null) throw new InvalidFieldError(`${field}.durationMinutes`);
    if (clockMinutes(startTime) + durationMinutes > TIME_GRID_MAX_END_MINUTES) {
      throw new InvalidFieldError(`${field}.durationMinutes`);
    }
  }

  return {
    title,
    allDay,
    startTime,
    durationMinutes,
    location,
    description,
    category,
    reminderOffsets,
    recurrence,
  };
}

function parseEventTemplate(raw: Record<string, unknown>): ExportEventTemplate {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const name = trimmedNonEmptyStr(raw.name, "name", MAX_EVENT_TEMPLATE_NAME_LENGTH);
  const payload = parseEventTemplatePayload(raw.payload, "payload");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, profileId, name, payload, createdAt, updatedAt };
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

/** `parseTaskAttachment`'s twin, and deliberately identical: migration 035's `subject_attachments` is migration 024's `task_attachments` with a subject on the other end. `sizeBytes` is `positiveInt` because both tables CHECK it. */
function parseSubjectAttachment(raw: Record<string, unknown>): ExportSubjectAttachment {
  const id = nonEmptyStr(raw.id, "id");
  const subjectId = nonEmptyStr(raw.subjectId, "subjectId");
  const fileName = nonEmptyStr(raw.fileName, "fileName");
  const mime = nonEmptyStr(raw.mime, "mime");
  const sizeBytes = positiveInt(raw.sizeBytes, "sizeBytes");
  const sha256 = nonEmptyStr(raw.sha256, "sha256");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  return { id, subjectId, fileName, mime, sizeBytes, sha256, createdAt };
}

/**
 * One subject↔note link (migration 035). `parseTaskDependency`'s shape plus the
 * timestamp the row actually carries; there is no self-edge to refuse here,
 * because the two ends are different KINDS of row — a subject can no more be its
 * own note than a tag can be its own task. Both references are checked in the
 * cross-reference pass below, exactly as a dependency's are.
 */
function parseSubjectNoteLink(raw: Record<string, unknown>): ExportSubjectNoteLink {
  const subjectId = nonEmptyStr(raw.subjectId, "subjectId");
  const noteId = nonEmptyStr(raw.noteId, "noteId");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  return { subjectId, noteId, createdAt };
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
  const { kind, clozeText, clozeOrdinal, problemSteps } = parseCardKind(raw);
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
    id, profileId, deckId, front, back, sourceNoteId, sourceBlockKey,
    kind, clozeText, clozeOrdinal, problemSteps, due, stability,
    difficulty, elapsedDays, scheduledDays, learningSteps, reps, lapses, state,
    lastReview, createdAt, updatedAt,
  };
}

/**
 * The KIND-CONDITIONED fields of one card row: the ADR-042 cloze pair and the
 * ADR-046 problem steps, both of which only some kinds may carry. `kind` is
 * optional with a default (absent = `"basic"`), so no `ArchiveEra` flag is
 * involved: an archive predating this field carried only basic cards, which is
 * precisely what the default says. Present keys are strict in every era, as
 * always.
 *
 * The pair rule mirrors the `cards` CHECK constraints of migration 031 — both
 * set for a cloze card, neither for a basic one — and the ordinal is checked
 * against the template by RE-RUNNING the `{{…}}` grammar rather than by
 * re-describing it: an ordinal the template does not contain would restore a
 * card whose blank nothing can fill, and `renderClozeCard` is the same reader
 * `CardStore` derives that card's sides with.
 *
 * `problemSteps` is optional-with-a-default in the same way (absent or null =
 * no worked solution) and mirrors migration 033's CHECK: only a basic card may
 * carry it, and never as an empty string. The cap is the writing store's own,
 * and the value is required TRIMMED — `CardStore` trims before writing, so
 * anything else is a row it did not write.
 */
function parseCardKind(raw: Record<string, unknown>): {
  kind: string;
  clozeText: string | null;
  clozeOrdinal: number | null;
  problemSteps: string | null;
} {
  const kind = raw.kind === undefined ? "basic" : enumStr(raw.kind, "kind", CARD_KINDS);
  const clozeText =
    raw.clozeText === undefined ? null : nullableNonEmptyStr(raw.clozeText, "clozeText");
  const clozeOrdinal =
    raw.clozeOrdinal === undefined || raw.clozeOrdinal === null
      ? null
      : nonNegativeInt(raw.clozeOrdinal, "clozeOrdinal");
  const problemSteps =
    raw.problemSteps === undefined || raw.problemSteps === null
      ? null
      : trimmedNonEmptyStr(raw.problemSteps, "problemSteps", MAX_CARD_TEXT_LENGTH);

  if (kind !== "cloze") {
    if (clozeText !== null) throw new InvalidFieldError("clozeText");
    if (clozeOrdinal !== null) throw new InvalidFieldError("clozeOrdinal");
    return { kind, clozeText: null, clozeOrdinal: null, problemSteps };
  }
  if (clozeText === null) throw new InvalidFieldError("clozeText");
  if (clozeOrdinal === null) throw new InvalidFieldError("clozeOrdinal");
  if (renderClozeCard(clozeText, clozeOrdinal) === null) {
    throw new InvalidFieldError("clozeOrdinal");
  }
  // A cloze card's back is already derived from its template; a second source
  // for the same side is a row migration 033's CHECK would refuse outright.
  if (problemSteps !== null) throw new InvalidFieldError("problemSteps");
  return { kind, clozeText, clozeOrdinal, problemSteps: null };
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

function parseNoteFolder(raw: Record<string, unknown>, era: ArchiveEra): ExportNoteFolder {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const parentId = nullableNonEmptyStr(raw.parentId, "parentId");
  const name = nonEmptyStr(raw.name, "name");
  const color = nullableFolderColor(raw.color, "color");
  // ADR-036: the id is checked for SHAPE only, never for existence. It may name
  // a built-in template (a code constant, in no table at all) or a
  // `note_templates` row, and migration 028 declares no foreign key for exactly
  // that reason. An id naming a template this archive did not carry is
  // therefore NOT a restore-time error: the apply path treats a dangling
  // default as "no template", so a folder can never refuse to create a note.
  const defaultTemplateId = eraDefault<string | null>(
    raw.defaultTemplateId,
    era.writesNoteFolderPrefs,
    (value) => nullableNonEmptyStr(value, "defaultTemplateId"),
    null,
  );
  const isCaptureDefault = eraDefault(
    raw.isCaptureDefault,
    era.writesNoteFolderPrefs,
    (value) => bool(value, "isCaptureDefault"),
    false,
  );
  // Optional with a default (absent or null = the list every folder written
  // before NOTE-002 was drawn as), so no era flag — the `viewConfig` reasoning
  // at INTERCHANGE_SCHEMA_VERSION. A PRESENT value is validated strictly
  // against the closed set: an archive is a file a person can edit, and
  // migration 039's CHECK would otherwise refuse it mid-restore with a raw
  // constraint error instead of a named `invalid-record`.
  const defaultView =
    raw.defaultView === undefined || raw.defaultView === null
      ? "list"
      : enumStr(raw.defaultView, "defaultView", NOTE_FOLDER_VIEWS);
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return {
    id, profileId, parentId, name, color, defaultTemplateId, isCaptureDefault,
    defaultView, createdAt, updatedAt,
  };
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

/**
 * One profile's study-scheduling preferences (STUDY-007). Three bounds, each of
 * them migration 034's own CHECK restated — an archive is the one way a value
 * can reach that table without passing through `StudySettingsStore`, and an
 * out-of-range one would otherwise abort a restore halfway through:
 *
 * - `targetRetention` inside 0.70..0.97, and a real number rather than a whole
 *   one — it is ts-fsrs's `request_retention`, a probability, and the only
 *   non-integer numeric field in this whole contract;
 * - `newPerDay` a whole number inside 0..100, zero included: "no new cards
 *   today" is an answer, not an absence;
 * - `maxReviewsPerDay` either `null` — which MEANS uncapped, and is the one way
 *   to say it — or a whole number inside 1..1000. Zero is refused rather than
 *   read as "uncapped": a cap of nothing is not a cap.
 */
/**
 * The profile's fixed semester dates (CAL-010 / ADR-054). Three rules beyond
 * the field shapes, each one `CalendarSettingsStore` enforces on every live
 * write, restated here so a bad archive is a named `invalid-record` rather
 * than a raw SQLite constraint error inside the restore transaction:
 *
 * - each date, when present, is a REAL bare calendar day (`bareDate` — the
 *   table's GLOB CHECK knows shapes, not February);
 * - the pair is both-set or both-null (migration 042's table tolerates a half
 *   so one upsert can stage it; a term with one edge means nothing);
 * - the closed range runs forward (`semesterStart <= semesterEnd`).
 *
 * Both cross-field problems name `semesterEnd` — the second half of the pair,
 * the same convention the quiet-hours pair rule follows.
 */
function parseCalendarSettings(raw: Record<string, unknown>): ExportCalendarSettings {
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const semesterStart = nullableBareDate(raw.semesterStart, "semesterStart");
  const semesterEnd = nullableBareDate(raw.semesterEnd, "semesterEnd");
  if ((semesterStart === null) !== (semesterEnd === null)) {
    throw new InvalidFieldError("semesterEnd");
  }
  if (semesterStart !== null && semesterEnd !== null && semesterStart > semesterEnd) {
    throw new InvalidFieldError("semesterEnd");
  }
  return { profileId, semesterStart, semesterEnd };
}

function parseStudySettings(raw: Record<string, unknown>): ExportStudySettings {
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const targetRetention = numberInRange(
    raw.targetRetention,
    "targetRetention",
    MIN_TARGET_RETENTION,
    MAX_TARGET_RETENTION,
  );
  const newPerDay = intInRange(raw.newPerDay, "newPerDay", 0, MAX_NEW_PER_DAY);
  const maxReviewsPerDay =
    raw.maxReviewsPerDay === null
      ? null
      : intInRange(raw.maxReviewsPerDay, "maxReviewsPerDay", 1, MAX_REVIEWS_PER_DAY);
  return { profileId, targetRetention, newPerDay, maxReviewsPerDay };
}

/**
 * The dashboard's background choice and dim (SET-006 / ADR-041). Three rules no
 * SQL CHECK on its own could have caught in an archive, and each of them is a
 * rule `DashboardSettingsStore` enforces on every live write:
 *
 * - the hash is a real content-address (`blobs/<name>` is spelled exactly this
 *   way, and a hash that is not would name a file the archive cannot hold);
 * - the mime is one of the four inline image formats — the same closed set the
 *   store refuses outside of, so a restored background is always something the
 *   `nx-blob:` protocol can serve and Chromium can decode;
 * - all three background fields are set together or not at all — migration
 *   030's CHECK, restated here so a half-set triple is a named `invalid-record`
 *   instead of a raw SQLite error inside the restore transaction.
 *
 * `backgroundDim` is bounded here rather than merely typed: 0..90 is the
 * column's own CHECK, and an out-of-range value would otherwise abort a restore
 * halfway through.
 */
function parseDashboardSettings(raw: Record<string, unknown>): ExportDashboardSettings {
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const backgroundHash =
    raw.backgroundHash === null ? null : sha256Hex(raw.backgroundHash, "backgroundHash");
  const backgroundMime =
    raw.backgroundMime === null
      ? null
      : enumStr(raw.backgroundMime, "backgroundMime", BACKGROUND_MIMES);
  const backgroundSizeBytes =
    raw.backgroundSizeBytes === null ? null : positiveInt(raw.backgroundSizeBytes, "backgroundSizeBytes");
  if ((backgroundHash === null) !== (backgroundMime === null)) {
    throw new InvalidFieldError("backgroundMime");
  }
  if ((backgroundHash === null) !== (backgroundSizeBytes === null)) {
    throw new InvalidFieldError("backgroundSizeBytes");
  }
  const backgroundDim = intInRange(raw.backgroundDim, "backgroundDim", 0, MAX_BACKGROUND_DIM);
  // Optional with a default (absent or null = the default board), so no era
  // flag — the `kind` reasoning at INTERCHANGE_SCHEMA_VERSION. A PRESENT id is
  // validated here for shape and reference-checked against the archive's own
  // sets in the reference pass.
  const activeSetId =
    raw.activeSetId === undefined || raw.activeSetId === null
      ? null
      : nonEmptyStr(raw.activeSetId, "activeSetId");
  return { profileId, backgroundHash, backgroundMime, backgroundSizeBytes, backgroundDim, activeSetId };
}

/**
 * One named dashboard (DASH-008 / ADR-055). The name is checked against what
 * `DashboardSetStore` would itself have written — trimmed, 1..100 characters —
 * because migration 043 has no CHECK to lean on, and an archive is the one way
 * text could reach that column having passed nobody's writer. The DEFAULT
 * board never appears here: it is not a row (see `ExportDashboardSet`).
 */
function parseDashboardSet(raw: Record<string, unknown>): ExportDashboardSet {
  const id = nonEmptyStr(raw.id, "id");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const name = trimmedNonEmptyStr(raw.name, "name", MAX_DASHBOARD_SET_NAME_LENGTH);
  const position = int(raw.position, "position");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  return { id, profileId, name, position, createdAt, updatedAt };
}

/**
 * One placed widget of the dashboard layout (DASH-002 / ADR-045). Three rules
 * beyond the field shapes, and none of them is something migration 032's own
 * CHECK could have caught in an archive:
 *
 * - `widgetId` is a `moduleId:widgetId` slug. Only the SHAPE: which widgets
 *   exist is the module registry's catalogue, and a row naming one this build
 *   does not carry is deliberately KEPT — a layout survives a module being
 *   switched off, and rendering is what filters, never storage. A value that
 *   could not name a widget at ALL is another matter, and is refused here.
 * - `size` is one of the three presets — the column's own CHECK, restated so an
 *   out-of-domain value is a named `invalid-record` instead of a raw SQLite
 *   error inside the restore transaction.
 * - `config`, when non-null, must parse as JSON. Nothing interprets it (no
 *   widget publishes a config schema yet), but an archive is the one way text
 *   could reach that column having passed nobody's writer, and a column
 *   documented as JSON must not start holding something else.
 *
 * `position` is an integer of any sign: a sparse sort key, never a count, and a
 * prepend legitimately walks below zero.
 */
function parseDashboardWidget(raw: Record<string, unknown>): ExportDashboardWidget {
  const instanceId = nonEmptyStr(raw.instanceId, "instanceId");
  const profileId = nonEmptyStr(raw.profileId, "profileId");
  const widgetId = nonEmptyStr(raw.widgetId, "widgetId");
  if (!WIDGET_ID_PATTERN.test(widgetId)) throw new InvalidFieldError("widgetId");
  const size = enumStr(raw.size, "size", DASHBOARD_WIDGET_SIZES);
  const position = int(raw.position, "position");
  const config = raw.config === null ? null : jsonText(raw.config, "config");
  const createdAt = isoDateTime(raw.createdAt, "createdAt");
  const updatedAt = isoDateTime(raw.updatedAt, "updatedAt");
  // Optional with a default (absent or null = the default board, ADR-055), so
  // no era flag — see `parseDashboardSettings`' `activeSetId`, its exact twin.
  const setId =
    raw.setId === undefined || raw.setId === null ? null : nonEmptyStr(raw.setId, "setId");
  return { instanceId, profileId, widgetId, size, position, config, createdAt, updatedAt, setId };
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

/** One parsed row plus where it came from — needed after the fact, to attach `path`/`line` to a reference or cycle problem discovered only once every row is known, and to name the module a dropped row belonged to. */
interface Located<T> {
  row: T;
  path: DataFilePath;
  line: number;
}

function locate<T>(row: T, path: DataFilePath, line: number): Located<T> {
  return { row, path, line };
}

/** One bucket per collection: its rows (in file order) and the id-keys already seen, for `duplicate-id`. `entries` is reassigned when import mode drops rows. */
interface Bucket<T> {
  entries: Located<T>[];
  seenKeys: Set<string>;
}

function newBucket<T>(): Bucket<T> {
  return { entries: [], seenKeys: new Set() };
}

/**
 * Everything a per-row problem needs to know beyond the row itself: how strict
 * to be, and where to record what strictness cost. One object rather than three
 * parameters threaded through every parser, because every future row-level rule
 * needs exactly these three.
 */
interface ParseContext {
  mode: ImportMode;
  problems: ImportProblem[];
  drops: ImportDrop[];
}

/** The severity a PER-ROW problem carries: an error that refuses the archive in restore mode, a warning that drops one row in import mode (ADR-043). */
function rowSeverity(ctx: ParseContext): ImportProblem["severity"] {
  return ctx.mode === "import" ? "warning" : "error";
}

/**
 * Records a PER-ROW problem at the mode's severity, plus — in import mode,
 * where the severity is a warning precisely because the row is being dropped —
 * the structured drop beside it. In restore mode nothing is dropped: the
 * archive is refused as a whole, so `dropped` stays empty.
 */
function rowProblem(
  ctx: ParseContext,
  reason: ImportDropReason,
  type: ArchiveRecordType | null,
  path: DataFilePath,
  line: number,
  detail: string,
): void {
  ctx.problems.push(problem(rowSeverity(ctx), reason, { path, line, detail }));
  if (ctx.mode === "import") {
    ctx.drops.push({ module: MODULE_OF_DATA_FILE[path], type, reason, detail });
  }
}

/**
 * Records `row` into `bucket`. A `key` already seen is `duplicate-id`: in
 * restore mode an error, and the row is still kept (a duplicate refuses the
 * whole archive regardless, so keeping it does no harm); in import mode a
 * warning, and the SECOND occurrence is the one that drops — the first is kept,
 * because a file's own order is the only thing that can tell them apart.
 */
function pushRow<T>(
  bucket: Bucket<T>,
  key: string,
  row: T,
  type: ArchiveRecordType,
  path: DataFilePath,
  line: number,
  ctx: ParseContext,
): void {
  if (bucket.seenKeys.has(key)) {
    rowProblem(ctx, "duplicate-id", type, path, line, key);
    if (ctx.mode === "import") return;
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
  taskTemplates: Bucket<ExportTaskTemplate>;
  taskDependencies: Bucket<ExportTaskDependency>;
  events: Bucket<ExportEvent>;
  eventTemplates: Bucket<ExportEventTemplate>;
  documents: Bucket<ExportDocument>;
  renewals: Bucket<ExportRenewal>;
  people: Bucket<ExportPerson>;
  calendarSettings: Bucket<ExportCalendarSettings>;
  subjects: Bucket<ExportSubject>;
  subjectAttachments: Bucket<ExportSubjectAttachment>;
  subjectNoteLinks: Bucket<ExportSubjectNoteLink>;
  exams: Bucket<ExportExam>;
  decks: Bucket<ExportDeck>;
  cards: Bucket<ExportCard>;
  reviewLog: Bucket<ExportReviewLogEntry>;
  plans: Bucket<ExportStudyPlan>;
  blocks: Bucket<ExportStudyBlock>;
  focusSessions: Bucket<ExportFocusSession>;
  studySettings: Bucket<ExportStudySettings>;
  notifications: Bucket<ExportNotification>;
  noteFolders: Bucket<ExportNoteFolder>;
  noteTags: Bucket<ExportNoteTag>;
  notes: Bucket<Omit<ExportNote, "snapshot">>;
  noteTagLinks: Bucket<ExportNoteTagLink>;
  noteAttachments: Bucket<ExportNoteAttachment>;
  noteVersions: Bucket<Omit<ExportNoteVersion, "snapshot">>;
  noteTemplates: Bucket<ExportNoteTemplate>;
  dashboardSettings: Bucket<ExportDashboardSettings>;
  dashboardSets: Bucket<ExportDashboardSet>;
  dashboardWidgets: Bucket<ExportDashboardWidget>;
}

function newCollections(): Collections {
  return {
    tasks: newBucket(), taskLists: newBucket(), taskSections: newBucket(),
    taskTags: newBucket(), taskTagLinks: newBucket(), taskAttachments: newBucket(),
    taskTemplates: newBucket(), taskDependencies: newBucket(),
    events: newBucket(), eventTemplates: newBucket(),
    documents: newBucket(), renewals: newBucket(),
    people: newBucket(), calendarSettings: newBucket(), subjects: newBucket(),
    subjectAttachments: newBucket(), subjectNoteLinks: newBucket(),
    exams: newBucket(), decks: newBucket(), cards: newBucket(),
    reviewLog: newBucket(), plans: newBucket(), blocks: newBucket(), focusSessions: newBucket(),
    studySettings: newBucket(),
    notifications: newBucket(), noteFolders: newBucket(), noteTags: newBucket(), notes: newBucket(),
    noteTagLinks: newBucket(), noteAttachments: newBucket(), noteVersions: newBucket(),
    noteTemplates: newBucket(), dashboardSettings: newBucket(), dashboardSets: newBucket(),
    dashboardWidgets: newBucket(),
  };
}

/** Parses `raw` per its `type` and files it into the matching bucket. Throws `InvalidFieldError` on a bad field — the line loop turns that into `invalid-record` at `ctx`'s severity. `era` reaches only the parsers whose rows gained fields after the first release (see `ArchiveEra`). */
function dispatchRecord(
  type: ArchiveRecordType,
  raw: Record<string, unknown>,
  path: DataFilePath,
  line: number,
  collections: Collections,
  ctx: ParseContext,
  era: ArchiveEra,
): void {
  switch (type) {
    case "task": {
      const row = parseTask(raw, era);
      pushRow(collections.tasks, row.id, row, type, path, line, ctx);
      return;
    }
    case "task-list": {
      const row = parseTaskList(raw);
      pushRow(collections.taskLists, row.id, row, type, path, line, ctx);
      return;
    }
    case "task-section": {
      const row = parseTaskSection(raw);
      pushRow(collections.taskSections, row.id, row, type, path, line, ctx);
      return;
    }
    case "task-tag": {
      const row = parseTaskTag(raw);
      pushRow(collections.taskTags, row.id, row, type, path, line, ctx);
      return;
    }
    // A join row's identity is the PAIR (migration 023's PRIMARY KEY), exactly
    // as `note-tag-link`'s is — so that composite is what `duplicate-id` keys on.
    case "task-tag-link": {
      const row = parseTaskTagLink(raw);
      pushRow(collections.taskTagLinks, `taskId=${row.taskId},tagId=${row.tagId}`, row, type, path, line, ctx);
      return;
    }
    case "task-attachment": {
      const row = parseTaskAttachment(raw);
      pushRow(collections.taskAttachments, row.id, row, type, path, line, ctx);
      return;
    }
    case "task-template": {
      const row = parseTaskTemplate(raw);
      pushRow(collections.taskTemplates, row.id, row, type, path, line, ctx);
      return;
    }
    // Migration 029's PRIMARY KEY is the pair too, so the same rule applies —
    // and the ORDER of that pair is the record, which is why the key spells both
    // roles out rather than sorting the two ids into a set.
    case "task-dependency": {
      const row = parseTaskDependency(raw);
      pushRow(
        collections.taskDependencies,
        `blockerId=${row.blockerId},blockedId=${row.blockedId}`,
        row,
        type,
        path,
        line,
        ctx,
      );
      return;
    }
    case "event": {
      const row = parseEvent(raw, era);
      pushRow(collections.events, row.id, row, type, path, line, ctx);
      return;
    }
    case "event-template": {
      const row = parseEventTemplate(raw);
      pushRow(collections.eventTemplates, row.id, row, type, path, line, ctx);
      return;
    }
    case "document": {
      const row = parseDocument(raw);
      pushRow(collections.documents, row.id, row, type, path, line, ctx);
      return;
    }
    case "renewal": {
      const row = parseRenewal(raw);
      pushRow(collections.renewals, row.id, row, type, path, line, ctx);
      return;
    }
    case "person": {
      const row = parsePerson(raw);
      pushRow(collections.people, row.id, row, type, path, line, ctx);
      return;
    }
    // One row per profile (migration 042's PRIMARY KEY), so `profileId` IS the
    // row's identity and a second one is a `duplicate-id` — exactly as for
    // `study-settings` and `dashboard-settings`.
    case "calendar-settings": {
      const row = parseCalendarSettings(raw);
      pushRow(collections.calendarSettings, row.profileId, row, type, path, line, ctx);
      return;
    }
    case "subject": {
      const row = parseSubject(raw);
      pushRow(collections.subjects, row.id, row, type, path, line, ctx);
      return;
    }
    case "subject-attachment": {
      const row = parseSubjectAttachment(raw);
      pushRow(collections.subjectAttachments, row.id, row, type, path, line, ctx);
      return;
    }
    // Migration 035's PRIMARY KEY is the pair, so that composite is what
    // `duplicate-id` keys on — `task-tag-link`'s rule, and `task-dependency`'s.
    case "subject-note-link": {
      const row = parseSubjectNoteLink(raw);
      pushRow(
        collections.subjectNoteLinks,
        `subjectId=${row.subjectId},noteId=${row.noteId}`,
        row,
        type,
        path,
        line,
        ctx,
      );
      return;
    }
    case "exam": {
      const row = parseExam(raw);
      pushRow(collections.exams, row.id, row, type, path, line, ctx);
      return;
    }
    case "deck": {
      const row = parseDeck(raw);
      pushRow(collections.decks, row.id, row, type, path, line, ctx);
      return;
    }
    case "card": {
      const row = parseCard(raw);
      pushRow(collections.cards, row.id, row, type, path, line, ctx);
      return;
    }
    case "review": {
      const row = parseReview(raw);
      pushRow(collections.reviewLog, row.id, row, type, path, line, ctx);
      return;
    }
    case "plan": {
      const row = parsePlan(raw);
      pushRow(collections.plans, row.id, row, type, path, line, ctx);
      return;
    }
    case "block": {
      const row = parseBlock(raw);
      pushRow(collections.blocks, row.id, row, type, path, line, ctx);
      return;
    }
    case "focus-session": {
      const row = parseFocusSession(raw);
      pushRow(collections.focusSessions, row.id, row, type, path, line, ctx);
      return;
    }
    // One row per profile (migration 034's PRIMARY KEY), so `profileId` IS the
    // row's identity and a second one is a `duplicate-id` — exactly as for
    // `dashboard-settings`.
    case "study-settings": {
      const row = parseStudySettings(raw);
      pushRow(collections.studySettings, row.profileId, row, type, path, line, ctx);
      return;
    }
    case "notification": {
      const row = parseNotification(raw);
      pushRow(collections.notifications, row.id, row, type, path, line, ctx);
      return;
    }
    case "note-folder": {
      const row = parseNoteFolder(raw, era);
      pushRow(collections.noteFolders, row.id, row, type, path, line, ctx);
      return;
    }
    case "note-tag": {
      const row = parseNoteTag(raw);
      pushRow(collections.noteTags, row.id, row, type, path, line, ctx);
      return;
    }
    case "note": {
      const row = parseNoteMeta(raw);
      pushRow(collections.notes, row.id, row, type, path, line, ctx);
      return;
    }
    case "note-tag-link": {
      const row = parseNoteTagLink(raw);
      pushRow(collections.noteTagLinks, `noteId=${row.noteId},tagId=${row.tagId}`, row, type, path, line, ctx);
      return;
    }
    case "note-attachment": {
      const row = parseNoteAttachment(raw);
      pushRow(collections.noteAttachments, row.id, row, type, path, line, ctx);
      return;
    }
    case "note-version": {
      const row = parseNoteVersionMeta(raw);
      pushRow(
        collections.noteVersions,
        `noteId=${row.noteId},coveredSeq=${row.coveredSeq}`,
        row,
        type,
        path,
        line,
        ctx,
      );
      return;
    }
    case "note-template": {
      const row = parseNoteTemplate(raw);
      pushRow(collections.noteTemplates, row.id, row, type, path, line, ctx);
      return;
    }
    // One row per profile (migration 030's PRIMARY KEY), so `profileId` IS the
    // row's identity and a second one is a `duplicate-id` — the same reasoning
    // that makes a join row's key its pair.
    case "dashboard-settings": {
      const row = parseDashboardSettings(raw);
      pushRow(collections.dashboardSettings, row.profileId, row, type, path, line, ctx);
      return;
    }
    // A PLACEMENT's identity is its own `instanceId` (migration 032's PRIMARY
    // KEY) — the same widget legitimately appears twice in one layout, so
    // keying on `widgetId` would call a deliberate arrangement a duplicate.
    case "dashboard-widget": {
      const row = parseDashboardWidget(raw);
      pushRow(collections.dashboardWidgets, row.instanceId, row, type, path, line, ctx);
      return;
    }
    case "dashboard-set": {
      const row = parseDashboardSet(raw);
      pushRow(collections.dashboardSets, row.id, row, type, path, line, ctx);
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
    // table just the same. Narrower than the ledger's own domain on purpose:
    // `"security"` is a source a row may carry, never one a preference may name.
    enabledSources: sourcesRaw.map((item, index) =>
      enumStr(
        item,
        `settings.notifications.enabledSources[${index}]`,
        TOGGLEABLE_NOTIFICATION_SOURCES,
      ),
    ),
    // Migration 041's CHECK. Optional-with-a-default, so no `ArchiveEra` flag:
    // an archive written before `1.19.0` carries no key at all, and „10 min“ is
    // what its profile's snooze button meant. Absence only — a key that IS
    // there is validated strictly, in every era, like every other field here.
    snoozeDefault:
      notifRoot.snoozeDefault === undefined
        ? DEFAULT_SNOOZE_PRESET
        : enumStr(notifRoot.snoozeDefault, "settings.notifications.snoozeDefault", SNOOZE_PRESETS),
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

/**
 * The profile's picture, off the manifest's own `profile` object (SET-001,
 * `1.18.0`). ABSENT and explicit `null` mean the same thing — "this profile has
 * no picture" — which is exactly what every pre-`1.18.0` archive says by
 * carrying no key at all, so this is an OPTIONAL-with-a-default field and needs
 * no `ArchiveEra` flag (the ADR-028 rule: an era flag exists only for a field
 * whose absence is AMBIGUOUS, and this one's never is).
 *
 * A value that IS present is validated strictly, in every era, against the same
 * three rules `parseDashboardSettings` applies to the background it is shaped
 * after: a real content-address, a mime inside the closed inline-image set (so a
 * restored picture is always something `nx-blob:` can serve and Chromium can
 * decode), and a positive size. The all-or-nothing rule those two need a pair
 * check for is free here — the three live in one object, so half of one is not
 * a shape this can hold.
 */
function parseProfilePicture(value: unknown): ArchiveProfilePicture | null {
  if (value === undefined || value === null) return null;
  const root = expectRecord(value, "profile.picture");
  return {
    hash: sha256Hex(root.hash, "profile.picture.hash"),
    mime: enumStr(root.mime, "profile.picture.mime", BACKGROUND_MIMES),
    sizeBytes: positiveInt(root.sizeBytes, "profile.picture.sizeBytes"),
  };
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
      // ADR-058 (`1.22.0`). Optional-with-a-default, so no `ArchiveEra` flag:
      // an archive written before business profiles carries no key at all, and
      // `"personal"` is the only kind its profile could have been. Absence
      // only — a key that IS there is validated strictly, in every era,
      // exactly as `settings.notifications.snoozeDefault` is.
      kind:
        profileRoot.kind === undefined
          ? ("personal" as ArchiveProfileKind)
          : enumStr(profileRoot.kind, "profile.kind", ARCHIVE_PROFILE_KINDS),
      picture: parseProfilePicture(profileRoot.picture),
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

/** A note version's identity — the `(noteId, coveredSeq)` primary key, as one string, for keying its state by. */
function versionKey(noteId: string, coveredSeq: number): string {
  return `${noteId}#${coveredSeq}`;
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
//
// The archive's whole reference graph is declared ONCE, as the ordered table
// `referenceRules` builds. Restore mode walks it a single time and reports each
// dangling reference as an error; import mode walks it to a fixpoint, resolving
// each dangling reference the way the table says (ADR-043 section 1) — two
// strictness policies over one grammar, exactly as the row parsers are.

/**
 * What a dangling reference costs its row.
 *
 * `"drop"` — the row goes, and the drop cascades: whatever pointed at IT now
 * dangles too. The ADR's default, and what every required reference must do
 * (a card without its deck, a renewal without its document, a note version
 * without its note are not rows anything could write).
 *
 * `detach` — the FIELD goes and the row survives, for the handful of
 * references that are placement rather than substance: a task's list and
 * section (ADR-043's "fall to the Inbox rule"), a note's folder and its card
 * deck. Each is nullable in the interchange contract precisely because the row
 * is complete without it, and losing a whole note because a folder row was
 * damaged would be the opposite of salvage.
 */
type DanglingPolicy<T> = "drop" | { detach: (row: T) => T };

/**
 * One reference in the archive's graph, erased to a uniform closure so the
 * ordered table can hold rules over rows of different types. Generics live
 * inside `referenceRule`, never in the table.
 */
interface ReferenceRule {
  /** Reports every dangling reference as an error, changing nothing (restore mode). */
  report(problems: ImportProblem[]): void;
  /** Drops or detaches every dangling reference, warning as it goes; returns true when it dropped at least one row (import mode). */
  resolve(ctx: ParseContext): boolean;
}

function referenceRule<T>(spec: {
  bucket: Bucket<T>;
  type: ArchiveRecordType;
  /** The field name the problem's `detail` names, as `field=id`. */
  field: string;
  /** The reference this row carries, or null when it carries none. */
  ref: (row: T) => string | null;
  /**
   * Builds the "does this reference resolve?" test. Called ONCE per sweep, not
   * once per row: the index it closes over is rebuilt on every sweep (import
   * mode's drops shrink what is left to resolve against) but never inside the
   * row loop, which would make each sweep quadratic.
   */
  resolver: () => (ref: string, row: T) => boolean;
  onDangling: DanglingPolicy<T>;
}): ReferenceRule {
  /** Every entry whose reference is present but unresolvable, with the id at fault. */
  function dangling(): { entry: Located<T>; ref: string }[] {
    const resolves = spec.resolver();
    const found: { entry: Located<T>; ref: string }[] = [];
    for (const entry of spec.bucket.entries) {
      const ref = spec.ref(entry.row);
      if (ref === null || resolves(ref, entry.row)) continue;
      found.push({ entry, ref });
    }
    return found;
  }

  return {
    report(problems) {
      for (const { entry, ref } of dangling()) {
        problems.push(
          problem("error", "unknown-reference", {
            path: entry.path,
            line: entry.line,
            detail: `${spec.field}=${ref}`,
          }),
        );
      }
    },
    resolve(ctx) {
      const found = dangling();
      if (found.length === 0) return false;
      const policy = spec.onDangling;
      const doomed = new Set<Located<T>>();
      for (const { entry, ref } of found) {
        rowProblem(ctx, "unknown-reference", spec.type, entry.path, entry.line, `${spec.field}=${ref}`);
        if (policy === "drop") doomed.add(entry);
        else entry.row = policy.detach(entry.row);
      }
      if (doomed.size === 0) return false;
      spec.bucket.entries = spec.bucket.entries.filter((entry) => !doomed.has(entry));
      return true;
    },
  };
}

/**
 * Detects a cycle in a self-referencing parent chain (`task.parentId`,
 * `task-list.parentId`, `note-folder.parentId`) via three-colour DFS: a
 * back-edge to a node still "visiting" is a cycle, reported once (not once per
 * node on it); a dangling reference (already reported by the reference rules)
 * just ends the walk, since an absent id can never be part of a cycle.
 * Returns the id each cycle was closed at — restore mode only reports them,
 * import mode drops those rows, which is what breaks the cycle so the
 * reference pass can cascade normally.
 */
function findParentCycles<T>(
  bucket: Bucket<T>,
  getId: (row: T) => string,
  getParentId: (row: T) => string | null,
): string[] {
  const parentOf = new Map<string, string | null>();
  for (const entry of bucket.entries) parentOf.set(getId(entry.row), getParentId(entry.row));

  const closedAt: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  for (const startId of parentOf.keys()) {
    if (state.get(startId) === "done") continue;

    const visitedThisWalk: string[] = [];
    let current: string | null = startId;
    while (current !== null) {
      const currentState = state.get(current);
      if (currentState === "visiting") {
        closedAt.push(current);
        break;
      }
      if (currentState === "done") break;
      state.set(current, "visiting");
      visitedThisWalk.push(current);
      current = parentOf.get(current) ?? null;
    }
    for (const visited of visitedThisWalk) state.set(visited, "done");
  }
  return closedAt;
}

/** One self-referencing parent chain, erased the way `ReferenceRule` is, so the three chains read as one table. */
interface CycleRule {
  report(problems: ImportProblem[]): void;
  resolve(ctx: ParseContext): boolean;
}

function cycleRule<T>(spec: {
  bucket: Bucket<T>;
  type: ArchiveRecordType;
  path: DataFilePath;
  id: (row: T) => string;
  parentId: (row: T) => string | null;
}): CycleRule {
  return {
    report(problems) {
      for (const id of findParentCycles(spec.bucket, spec.id, spec.parentId)) {
        problems.push(problem("error", "reference-cycle", { path: spec.path, detail: id }));
      }
    },
    resolve(ctx) {
      const closedAt = new Set(findParentCycles(spec.bucket, spec.id, spec.parentId));
      if (closedAt.size === 0) return false;
      // The row the back-edge closes on is the one that goes: removing it is
      // the smallest cut that breaks the cycle, and its descendants then fall
      // to this rule's own reference rule, cascading like any other drop.
      const survivors: Located<T>[] = [];
      for (const entry of spec.bucket.entries) {
        const id = spec.id(entry.row);
        if (!closedAt.has(id)) {
          survivors.push(entry);
          continue;
        }
        rowProblem(ctx, "reference-cycle", spec.type, entry.path, entry.line, id);
      }
      spec.bucket.entries = survivors;
      return true;
    },
  };
}

/** The folders claiming the quick-capture mark, in file order — everything past the first is a double claim (ADR-036). */
function captureClaimants(collections: Collections) {
  return collections.noteFolders.entries.filter((entry) => entry.row.isCaptureDefault);
}

/**
 * The archive's whole reference graph, in the order restore mode has always
 * reported it. Each rule's target set is read through a closure rather than
 * captured as a value, because import mode re-runs the table after every drop
 * and a captured set would go stale the moment a row disappeared.
 */
function referenceRules(collections: Collections): ReferenceRule[] {
  const idsOf = <T extends { id: string }>(bucket: Bucket<T>): ReadonlySet<string> =>
    new Set(bucket.entries.map((entry) => entry.row.id));
  const taskIds = () => idsOf(collections.tasks);
  const taskListIds = () => idsOf(collections.taskLists);
  const taskTagIds = () => idsOf(collections.taskTags);
  const subjectIds = () => idsOf(collections.subjects);
  const examIds = () => idsOf(collections.exams);
  const deckIds = () => idsOf(collections.decks);
  const cardIds = () => idsOf(collections.cards);
  const planIds = () => idsOf(collections.plans);
  const documentIds = () => idsOf(collections.documents);
  const noteIds = () => idsOf(collections.notes);
  const folderIds = () => idsOf(collections.noteFolders);
  const noteTagIds = () => idsOf(collections.noteTags);
  /** Which list each section belongs to — a task's `sectionId` must resolve to a section of the task's OWN list, which a plain id set cannot say. */
  const listOfSection = () =>
    new Map(collections.taskSections.entries.map((entry) => [entry.row.id, entry.row.listId]));

  return [
    referenceRule({
      bucket: collections.tasks,
      type: "task",
      field: "parentId",
      ref: (row) => row.parentId,
      resolver: () => {
        const ids = taskIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.tasks,
      type: "task",
      field: "listId",
      ref: (row) => row.listId,
      resolver: () => {
        const ids = taskListIds();
        return (ref) => ids.has(ref);
      },
      // ADR-043: a task whose list is gone falls to the Inbox rule — the same
      // `null` an archive written before ADR-029 carries, which a restore and
      // the foreign-import planner both read as "the target profile's Inbox".
      // `sectionId` goes with it: the parser's own invariant forbids a section
      // without a list, and a heading in a list the task no longer lives in
      // would be a placement nothing renders.
      onDangling: { detach: (row) => ({ ...row, listId: null, sectionId: null }) },
    }),
    referenceRule({
      bucket: collections.taskLists,
      type: "task-list",
      field: "parentId",
      ref: (row) => row.parentId,
      resolver: () => {
        const ids = taskListIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.taskSections,
      type: "task-section",
      field: "listId",
      ref: (row) => row.listId,
      resolver: () => {
        const ids = taskListIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.taskTagLinks,
      type: "task-tag-link",
      field: "taskId",
      ref: (row) => row.taskId,
      resolver: () => {
        const ids = taskIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.taskTagLinks,
      type: "task-tag-link",
      field: "tagId",
      ref: (row) => row.tagId,
      resolver: () => {
        const ids = taskTagIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.taskAttachments,
      type: "task-attachment",
      field: "taskId",
      ref: (row) => row.taskId,
      resolver: () => {
        const ids = taskIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.taskDependencies,
      type: "task-dependency",
      field: "blockerId",
      ref: (row) => row.blockerId,
      resolver: () => {
        const ids = taskIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.taskDependencies,
      type: "task-dependency",
      field: "blockedId",
      ref: (row) => row.blockedId,
      resolver: () => {
        const ids = taskIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    // The one reference a plain id set cannot express: the section must exist
    // AND belong to the task's own list. A section of some other list would
    // pass every foreign key the schema has and still put the task under a
    // heading nothing renders.
    referenceRule({
      bucket: collections.tasks,
      type: "task",
      field: "sectionId",
      ref: (row) => row.sectionId,
      resolver: () => {
        const listOf = listOfSection();
        return (ref, row) => listOf.get(ref) === row.listId;
      },
      onDangling: { detach: (row) => ({ ...row, sectionId: null }) },
    }),
    referenceRule({
      bucket: collections.exams,
      type: "exam",
      field: "subjectId",
      ref: (row) => row.subjectId,
      resolver: () => {
        const ids = subjectIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.subjectAttachments,
      type: "subject-attachment",
      field: "subjectId",
      ref: (row) => row.subjectId,
      resolver: () => {
        const ids = subjectIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    // A link's two ends live in two different NDJSON files, so both are checked
    // here rather than by the writer's ordering — the same treatment a card's
    // `sourceNoteId` gets, one file over.
    referenceRule({
      bucket: collections.subjectNoteLinks,
      type: "subject-note-link",
      field: "subjectId",
      ref: (row) => row.subjectId,
      resolver: () => {
        const ids = subjectIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.subjectNoteLinks,
      type: "subject-note-link",
      field: "noteId",
      ref: (row) => row.noteId,
      resolver: () => {
        const ids = noteIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.decks,
      type: "deck",
      field: "subjectId",
      ref: (row) => row.subjectId,
      resolver: () => {
        const ids = subjectIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.cards,
      type: "card",
      field: "deckId",
      ref: (row) => row.deckId,
      resolver: () => {
        const ids = deckIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.cards,
      type: "card",
      field: "sourceNoteId",
      ref: (row) => row.sourceNoteId,
      resolver: () => {
        const ids = noteIds();
        return (ref) => ids.has(ref);
      },
      // ADR-043 names this one a drop even though the column is nullable:
      // clearing it would silently turn a note-derived card into a hand-made
      // one, and `syncFromNote` would then generate a second card for the
      // block the next time that note was opened.
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.reviewLog,
      type: "review",
      field: "cardId",
      ref: (row) => row.cardId,
      resolver: () => {
        const ids = cardIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.plans,
      type: "plan",
      field: "examId",
      ref: (row) => row.examId,
      resolver: () => {
        const ids = examIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.blocks,
      type: "block",
      field: "planId",
      ref: (row) => row.planId,
      resolver: () => {
        const ids = planIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.focusSessions,
      type: "focus-session",
      field: "subjectId",
      ref: (row) => row.subjectId,
      resolver: () => {
        const ids = subjectIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.renewals,
      type: "renewal",
      field: "documentId",
      ref: (row) => row.documentId,
      resolver: () => {
        const ids = documentIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.notes,
      type: "note",
      field: "folderId",
      ref: (row) => row.folderId,
      resolver: () => {
        const ids = folderIds();
        return (ref) => ids.has(ref);
      },
      // A folder is placement, like a list: the exporter already files a note
      // whose folder is absent directly under `notes/` (`buildNotePaths`), so
      // the archive format itself says a folderless note is a normal note.
      onDangling: { detach: (row) => ({ ...row, folderId: null }) },
    }),
    referenceRule({
      bucket: collections.notes,
      type: "note",
      field: "cardDeckId",
      ref: (row) => row.cardDeckId,
      resolver: () => {
        const ids = deckIds();
        return (ref) => ids.has(ref);
      },
      // The deck a note generates cards INTO — decoration on the note, and
      // nullable for exactly that reason. Losing a note's whole body because
      // its deck row was damaged is not salvage.
      onDangling: { detach: (row) => ({ ...row, cardDeckId: null }) },
    }),
    referenceRule({
      bucket: collections.noteFolders,
      type: "note-folder",
      field: "parentId",
      ref: (row) => row.parentId,
      resolver: () => {
        const ids = folderIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    // ADR-036: the quick-capture folder is a per-profile SINGLETON, an
    // invariant no single row can break and therefore no per-row parser can
    // catch. Migration 028 backs it with a partial unique index, so a second
    // claimant would abort the restore transaction with a raw SQLite error;
    // catching it here instead names the offending row and line. Import mode
    // CLEARS the later claims rather than dropping the folders — the claim is
    // a flag, the folder is data, and losing a folder over a flag would be
    // the opposite of salvage.
    {
      report(problems) {
        for (const entry of captureClaimants(collections).slice(1)) {
          problems.push(
            problem("error", "invalid-record", {
              path: entry.path,
              line: entry.line,
              detail: "isCaptureDefault",
            }),
          );
        }
      },
      resolve(ctx) {
        for (const entry of captureClaimants(collections).slice(1)) {
          rowProblem(ctx, "invalid-record", "note-folder", entry.path, entry.line, "isCaptureDefault");
          entry.row = { ...entry.row, isCaptureDefault: false };
        }
        // A cleared flag strands nothing, so there is never a re-sweep to ask for.
        return false;
      },
    },
    referenceRule({
      bucket: collections.noteTagLinks,
      type: "note-tag-link",
      field: "noteId",
      ref: (row) => row.noteId,
      resolver: () => {
        const ids = noteIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.noteTagLinks,
      type: "note-tag-link",
      field: "tagId",
      ref: (row) => row.tagId,
      resolver: () => {
        const ids = noteTagIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.noteAttachments,
      type: "note-attachment",
      field: "noteId",
      ref: (row) => row.noteId,
      resolver: () => {
        const ids = noteIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    referenceRule({
      bucket: collections.noteVersions,
      type: "note-version",
      field: "noteId",
      ref: (row) => row.noteId,
      resolver: () => {
        const ids = noteIds();
        return (ref) => ids.has(ref);
      },
      onDangling: "drop",
    }),
    // ADR-055: a placement's board must be a set this archive carries — null
    // (the default board) carries no reference at all. DETACHED rather than
    // dropped, on the task `listId` precedent: a widget whose board is gone
    // falls back onto the default board, which is where every widget was
    // before boards existed, rather than costing the user a card.
    referenceRule({
      bucket: collections.dashboardWidgets,
      type: "dashboard-widget",
      field: "setId",
      ref: (row) => row.setId ?? null,
      resolver: () => {
        const ids = idsOf(collections.dashboardSets);
        return (ref) => ids.has(ref);
      },
      onDangling: { detach: (row) => ({ ...row, setId: null }) },
    }),
    // And the settings row's own pointer, on the same terms: an active board
    // that is not in the archive detaches to „Početna“, never to a pointer at
    // nothing.
    referenceRule({
      bucket: collections.dashboardSettings,
      type: "dashboard-settings",
      field: "activeSetId",
      ref: (row) => row.activeSetId ?? null,
      resolver: () => {
        const ids = idsOf(collections.dashboardSets);
        return (ref) => ids.has(ref);
      },
      onDangling: { detach: (row) => ({ ...row, activeSetId: null }) },
    }),
  ];
}

/** The three self-referencing parent chains, in the order restore mode has always reported them. */
function cycleRules(collections: Collections): CycleRule[] {
  return [
    cycleRule({
      bucket: collections.tasks,
      type: "task",
      path: "data/tasks.ndjson",
      id: (row) => row.id,
      parentId: (row) => row.parentId,
    }),
    cycleRule({
      bucket: collections.taskLists,
      type: "task-list",
      path: "data/tasks.ndjson",
      id: (row) => row.id,
      parentId: (row) => row.parentId,
    }),
    cycleRule({
      bucket: collections.noteFolders,
      type: "note-folder",
      path: "data/notes.ndjson",
      id: (row) => row.id,
      parentId: (row) => row.parentId,
    }),
    // The fourth cycle is a graph, not a parent chain (ADR-037's dependency
    // acyclicity), so it carries its own DFS instead of `cycleRule`'s walk. The
    // smallest cut is the EDGE that closed the loop — dropping that one row
    // breaks the cycle and the fixpoint re-runs until none remain.
    {
      report(problems) {
        checkDependencyCycle(collections.taskDependencies, problems);
      },
      resolve(ctx) {
        const edge = findDependencyCycleEdge(collections.taskDependencies);
        if (edge === null) return false;
        rowProblem(
          ctx,
          "reference-cycle",
          "task-dependency",
          edge.path,
          edge.line,
          `blockerId=${edge.row.blockerId},blockedId=${edge.row.blockedId}`,
        );
        collections.taskDependencies.entries = collections.taskDependencies.entries.filter(
          (entry) => entry !== edge,
        );
        return true;
      },
    },
  ];
}

/**
 * Import mode's reference pass: drop, detach and break cycles until nothing
 * changes. A fixpoint rather than a single sweep because every drop can strand
 * a row that resolved a moment ago — a dropped subject takes its decks, which
 * take their cards, which take their review log — and a cycle broken here can
 * strand rows the reference rules must then see. Termination is structural:
 * every iteration that returns true has removed at least one row from a finite
 * set, and rows are never added.
 */
function resolveReferencesForImport(collections: Collections, ctx: ParseContext): void {
  const references = referenceRules(collections);
  const cycles = cycleRules(collections);
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of references) changed = rule.resolve(ctx) || changed;
    for (const rule of cycles) changed = rule.resolve(ctx) || changed;
  }
}

/**
 * Detects a cycle among the archive's task dependencies (ADR-037) — the store's
 * own acyclicity invariant, restated over parsed rows because an archive is the
 * one way an edge can reach `task_dependencies` without passing through
 * `TaskDependencyStore.addDependency`, and no SQL `CHECK` can walk a graph.
 *
 * A three-colour DFS over the directed blocker → blocked graph, like
 * `checkParentCycle` above, with one difference the shape forces: a task may
 * block many tasks, so the walk branches, and the thing worth naming is the EDGE
 * that closed the loop rather than the node it landed on — a node sits on the
 * cycle by accident of traversal order, while the edge is a line in a file the
 * user can go and delete. Reported once, not once per edge on the loop; an id on
 * either end that no task carries is `unknown-reference`'s business and is left
 * in the graph here (an absent task simply has no outgoing edges).
 */
function checkDependencyCycle(
  bucket: Bucket<ExportTaskDependency>,
  problems: ImportProblem[],
): void {
  const found = findDependencyCycleEdge(bucket);
  if (found === null) return;
  problems.push(
    problem("error", "reference-cycle", {
      path: found.path,
      line: found.line,
      detail: `blockerId=${found.row.blockerId},blockedId=${found.row.blockedId}`,
    }),
  );
}

/** The edge that closes a dependency loop, or null — the DFS `checkDependencyCycle` reports through, shared with import mode's edge-dropping resolver. */
function findDependencyCycleEdge(
  bucket: Bucket<ExportTaskDependency>,
): Located<ExportTaskDependency> | null {
  if (bucket.entries.length === 0) return null;

  const outgoing = new Map<string, Located<ExportTaskDependency>[]>();
  for (const entry of bucket.entries) {
    const edges = outgoing.get(entry.row.blockerId);
    if (edges) edges.push(entry);
    else outgoing.set(entry.row.blockerId, [entry]);
  }

  const state = new Map<string, "visiting" | "done">();

  /** The edge that closed a loop below `nodeId`, or null. Returned rather than stashed in an outer `let`, so the caller's narrowing is plain. */
  const visit = (nodeId: string): Located<ExportTaskDependency> | null => {
    if (state.get(nodeId) === "done") return null;
    state.set(nodeId, "visiting");
    for (const edge of outgoing.get(nodeId) ?? []) {
      const next = edge.row.blockedId;
      if (state.get(next) === "visiting") {
        state.set(nodeId, "done");
        return edge;
      }
      if (state.get(next) === "done") continue;
      const found = visit(next);
      if (found !== null) {
        state.set(nodeId, "done");
        return found;
      }
    }
    state.set(nodeId, "done");
    return null;
  };

  for (const blockerId of outgoing.keys()) {
    const found = visit(blockerId);
    if (found !== null) return found;
  }
  return null;
}

// --- Main entry point ---------------------------------------------------------

export function parseImportArchive(input: ImportArchiveInput): ImportArchiveResult {
  const problems: ImportProblem[] = [];
  const drops: ImportDrop[] = [];
  // Absent means restore: the mode this reader was written against, and the one
  // every pre-ADR-043 caller silently relies on.
  const ctx: ParseContext = { mode: input.mode ?? "restore", problems, drops };

  const manifestText = input.files.get("manifest.json");
  if (manifestText === undefined) {
    problems.push(problem("error", "missing-manifest", { path: "manifest.json" }));
    return { problems, manifest: null, data: null, dropped: drops };
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
    return { problems, manifest: null, data: null, dropped: drops };
  }
  const { manifest, checksums } = manifestOutcome;

  if (!isSupportedSchemaVersion(manifest.schemaVersion)) {
    problems.push(
      problem("error", "unsupported-schema-version", { path: "manifest.json", detail: manifest.schemaVersion }),
    );
    return { problems, manifest, data: null, dropped: drops };
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

      // In restore mode an ERROR, not a tolerated warning. "Ignore what you do
      // not recognise" is the right rule for additive schema evolution — but it
      // is unreachable here, because the version gate above already refuses any
      // archive newer than this build in major or minor, and an OLDER archive
      // can only ever carry FEWER types than this build knows. So a type we do
      // not recognise is never a newer Nexus; it is a damaged or hand-edited
      // file. Skipping the line would then quietly drop real rows from a
      // backup, which is the exact failure this whole reader exists to refuse —
      // in import mode, where the archive is somebody else's and the profile
      // keeps everything it already has, the row is instead dropped and named.
      if (!isOneOf(type, ALL_RECORD_TYPES)) {
        rowProblem(ctx, "unknown-record-type", null, path, lineNumber, type);
        return;
      }
      if (!allowedTypes.includes(type)) {
        rowProblem(ctx, "invalid-record", type, path, lineNumber, "type");
        return;
      }

      const dispatchOutcome = tryParse(() =>
        dispatchRecord(type, root, path, lineNumber, collections, ctx, era),
      );
      if (!dispatchOutcome.ok) {
        rowProblem(ctx, "invalid-record", type, path, lineNumber, dispatchOutcome.detail);
      }
    });
  }

  // --- Yjs (rule 7): a note's snapshot is attached when present; a
  // note-version's is required. Both are read into maps rather than straight
  // into the result arrays, because import mode's reference pass below can
  // still drop the row a snapshot belongs to — the final arrays are built from
  // the surviving bucket entries, once, at the end.
  const noteSnapshots = new Map<string, Uint8Array>();
  for (const entry of collections.notes.entries) {
    const ydocPath = `data/notes/${entry.row.id}.ydoc`;
    const bytes = input.ydocs.get(ydocPath);
    if (bytes === undefined) continue; // a never-edited note has no state, which is not a problem
    // A note whose state will not decode keeps its row and loses its body: the
    // title, folder, tags and links are all still real data. The problem names
    // it in both modes — this is not a dropped ROW, so it is never a drop.
    if (!isValidYUpdate(bytes)) {
      problems.push(problem(rowSeverity(ctx), "invalid-ydoc", { path: ydocPath }));
      continue;
    }
    noteSnapshots.set(entry.row.id, bytes);
  }

  const versionSnapshots = new Map<string, Uint8Array>();
  const versionsWithoutState = new Set<Located<Omit<ExportNoteVersion, "snapshot">>>();
  for (const entry of collections.noteVersions.entries) {
    const meta = entry.row;
    const ydocPath = `data/note-versions/${meta.noteId}/${meta.coveredSeq}.ydoc`;
    const bytes = input.ydocs.get(ydocPath);
    if (bytes !== undefined && isValidYUpdate(bytes)) {
      versionSnapshots.set(versionKey(meta.noteId, meta.coveredSeq), bytes);
      continue;
    }
    // A version IS its state — a checkpoint with nothing to restore from is not
    // a row at all, so it goes in both modes; only the severity differs, and
    // only import mode counts it as a drop.
    const reason: ImportDropReason = bytes === undefined ? "missing-ydoc" : "invalid-ydoc";
    problems.push(problem(rowSeverity(ctx), reason, { path: ydocPath }));
    versionsWithoutState.add(entry);
    if (ctx.mode === "import") {
      drops.push({
        module: MODULE_OF_DATA_FILE[entry.path],
        type: "note-version",
        reason,
        detail: ydocPath,
      });
    }
  }
  // Restore mode leaves the stateless versions in the bucket: the archive is
  // refused anyway, and removing them would change which reference problems it
  // reports about them. Import mode takes them out, so nothing downstream has
  // to remember they are hollow.
  if (ctx.mode === "import" && versionsWithoutState.size > 0) {
    collections.noteVersions.entries = collections.noteVersions.entries.filter(
      (entry) => !versionsWithoutState.has(entry),
    );
  }

  // --- Blobs (rule 8): a missing blob is a warning — the row still restores.
  // ALL THREE attachment tables are checked, because all three name the same
  // `blobs/` namespace: a task's file, a subject's material and a note's
  // attachment are equally lost when the archive omits them, and a warning
  // raised for only some of them would under-report the damage the restore
  // preview shows the user. A dashboard background is a blob on the same terms
  // (ADR-041, checked just below): its row restores either way, and the
  // dashboard simply comes back without a picture rather than the whole archive
  // being refused over one lost image.
  for (const entry of [
    ...collections.noteAttachments.entries,
    ...collections.taskAttachments.entries,
    ...collections.subjectAttachments.entries,
  ]) {
    const attachment = entry.row;
    if (!input.blobNames.has(attachment.sha256)) {
      problems.push(
        problem("warning", "missing-blob", { path: `blobs/${attachment.sha256}`, detail: attachment.id }),
      );
    }
  }
  for (const entry of collections.dashboardSettings.entries) {
    const { backgroundHash, profileId } = entry.row;
    if (backgroundHash === null) continue;
    if (!input.blobNames.has(backgroundHash)) {
      problems.push(
        problem("warning", "missing-blob", { path: `blobs/${backgroundHash}`, detail: profileId }),
      );
    }
  }
  // The profile's picture (SET-001), on exactly the same terms — a warning, not
  // an error: the profile restores either way and simply comes back without a
  // picture, which is a far better answer than refusing a whole backup over one
  // lost image. Checked off the MANIFEST rather than off a row, because that is
  // where this one blob is named.
  if (
    manifest.profile.picture !== null &&
    !input.blobNames.has(manifest.profile.picture.hash)
  ) {
    problems.push(
      problem("warning", "missing-blob", {
        path: `blobs/${manifest.profile.picture.hash}`,
        detail: manifest.profile.id,
      }),
    );
  }

  // --- Reference integrity and cycles ------------------------------------------
  // One table (`referenceRules` / `cycleRules`), two policies: restore reports
  // and refuses, import resolves and salvages.
  if (ctx.mode === "import") {
    resolveReferencesForImport(collections, ctx);
  } else {
    for (const rule of referenceRules(collections)) rule.report(problems);
    for (const rule of cycleRules(collections)) rule.report(problems);
  }

  // Built only now, from the rows that survived: import mode's reference pass
  // can drop a note or a version after its state was read.
  const notes: ExportNote[] = collections.notes.entries.map((entry) => ({
    ...entry.row,
    snapshot: noteSnapshots.get(entry.row.id) ?? null,
  }));
  const noteVersions: ExportNoteVersion[] = [];
  for (const entry of collections.noteVersions.entries) {
    const snapshot = versionSnapshots.get(versionKey(entry.row.noteId, entry.row.coveredSeq));
    if (snapshot === undefined) continue; // already reported above (missing/invalid `.ydoc`)
    noteVersions.push({ ...entry.row, snapshot });
  }

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
        taskTemplates: rowsOf(collections.taskTemplates),
        taskDependencies: rowsOf(collections.taskDependencies),
        events: rowsOf(collections.events),
        // Empty both for a pre-1.15.0 archive and for a profile that never saved
        // an event as a template — indistinguishable on purpose, because they
        // mean the same thing: this profile has no event templates.
        eventTemplates: rowsOf(collections.eventTemplates),
        documents: rowsOf(collections.documents),
        renewals: rowsOf(collections.renewals),
        people: rowsOf(collections.people),
        // Empty for every pre-1.20.0 archive, which carries no such row at all
        // — and a restore reads that emptiness as "no term set", which is
        // exactly where the profile was (the Semestar view keeps sliding).
        calendarSettings: rowsOf(collections.calendarSettings),
        subjects: rowsOf(collections.subjects),
        subjectAttachments: rowsOf(collections.subjectAttachments),
        subjectNoteLinks: rowsOf(collections.subjectNoteLinks),
        exams: rowsOf(collections.exams),
        decks: rowsOf(collections.decks),
        cards: rowsOf(collections.cards),
        reviewLog: rowsOf(collections.reviewLog),
        plans: rowsOf(collections.plans),
        blocks: rowsOf(collections.blocks),
        focusSessions: rowsOf(collections.focusSessions),
        // Empty for every pre-1.13.0 archive, which carries no such row at all —
        // and a restore reads that emptiness as "leave the profile on the
        // scheduler's own defaults", which is exactly where it was.
        studySettings: rowsOf(collections.studySettings),
        notifications: rowsOf(collections.notifications),
        notes,
        noteFolders: rowsOf(collections.noteFolders),
        noteTags: rowsOf(collections.noteTags),
        noteTagLinks: rowsOf(collections.noteTagLinks),
        noteTemplates: rowsOf(collections.noteTemplates),
        noteAttachments: rowsOf(collections.noteAttachments),
        noteVersions,
        // Empty for every pre-1.9.0 archive, which carries no such file at all —
        // and a restore reads that emptiness as "leave the profile on the
        // dashboard's own defaults", which is exactly where it was.
        dashboardSettings: rowsOf(collections.dashboardSettings),
        // Empty both for a pre-1.21.0 archive and for a profile that never made
        // a named board — indistinguishable on purpose, because they mean the
        // same thing: only „Početna“, which is not a row (ADR-055).
        dashboardSets: rowsOf(collections.dashboardSets),
        // Empty both for a pre-1.11.0 archive and for a profile that never
        // rearranged its dashboard — indistinguishable on purpose, because they
        // mean the same thing: the default arrangement (`DashboardWidgetStore`
        // is get-or-default, so "no rows" IS that arrangement).
        dashboardWidgets: rowsOf(collections.dashboardWidgets),
      };

  return { problems, manifest, data, dropped: drops };
}
