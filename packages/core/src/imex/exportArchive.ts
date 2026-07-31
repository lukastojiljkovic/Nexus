/**
 * Pure builder for the IMEX full-export archive (PRD 14 IMEX-001, ADR-009's
 * container layout). Takes plain data arrays plus everything time/version-ish
 * the caller already knows (`createdAt`, `appVersion`, a `hash` function) and
 * returns the archive's text files as an in-memory map, plus a DECLARED
 * inventory of its binary entries — no clock reads, no file IO, no `node:`
 * imports. `apps/desktop`'s main process is the only caller: it gathers rows
 * from `@nexus/db`'s stores, stamps `createdAt`/`appVersion`, injects a real
 * sha256 `hash`, and streams the result into a `.nexus.zip` with `yazl`,
 * resolving each declared binary entry (reading and decrypting attachment
 * blobs one at a time) as it goes — see `ExportBinaryEntry`.
 *
 * Row shapes are declared as minimal structural interfaces (only the fields
 * this module serializes) rather than imported from `@nexus/db` — `@nexus/core`
 * must stay platform-neutral and dependency-free of `@nexus/db`. TypeScript's
 * structural typing means the caller's real store rows (which carry these
 * fields and more) satisfy these interfaces without adapting. The field list
 * and order of each interface IS the interchange contract (ADR-009: "the
 * interchange schema becomes the de-facto public API of Nexus data") — changed
 * deliberately, not incidentally.
 *
 * IMEX-003 lets the caller name WHICH modules ride (`ExportArchiveInput.modules`,
 * absent = all). The result is a real archive of fewer modules, not a partial
 * one: see `filterProfileData` for the module↔collection mapping and the three
 * cross-module references it repairs so nothing in a subset archive dangles.
 */

import type { RecurrenceRule } from "../recurrence/recurrence.js";
import type { TaskViewConfig } from "../tasks/taskViewConfig.js";
import { claimUniqueName, sanitizePathSegment, UNTITLED_NOTE_NAME } from "./archivePaths.js";
import { toCsv } from "./csv.js";
import { buildIcsCalendar } from "./icsExport.js";
import { renderNoteMarkdown } from "./noteMarkdown.js";
import type { NoteMarkdownAttachment, NoteMarkdownContext } from "./noteMarkdown.js";

/**
 * IMEX-004: the archive's own semver. NOT bumped by `data/calendar.ics`
 * (CAL-008): the archive gained a FILE, not a record type. Nothing parses it on
 * the way back in — `archiveReader.ts`'s allowlist ignores every entry that is
 * not the manifest, a `DATA_FILES` NDJSON, a `.ydoc` or a blob, and
 * `parseImportArchive` walks only `DATA_FILES` ∪ the manifest's own checksums —
 * so it is a convenience copy for the user's other calendar, exactly as
 * `tables/*.csv` is for their spreadsheet, and it is checksummed by neither. An
 * older reader handed a newer archive is therefore no worse off for its
 * presence, which is precisely what a version bump would otherwise be claiming.
 *
 * `1.24.0` adds a task list's kanban column arrangement (ADR-060): two OPTIONAL
 * members INSIDE the `task-list` row's existing `viewConfig` object —
 * `kanban.hiddenColumns` and `kanban.columnOrder`, both absent meaning "every
 * column drawn, in natural order", which is what every earlier archive's boards
 * were. Not a new record type, not even a new top-level field — and a MINOR
 * bump all the same, because the interchange does NOT carry the stored JSON
 * verbatim: the exporter serializes the config from the store's PARSED,
 * leniently-read form (`TaskListStore` reads the column through
 * `parseStoredTaskViewConfig`, which drops what it does not recognize), and the
 * reader re-validates it STRICTLY against its own grammar
 * (`parseTaskList` → `validateTaskViewConfig`, which refuses what it does not
 * recognize). An older build handed this archive would therefore not round-trip
 * the arrangement blind — it would refuse the row as a malformed `viewConfig`,
 * a baffling field error on a perfectly honest file. The version gate turns
 * that into the truthful answer an older reader owes a newer archive, exactly
 * as `1.16.0` did when `viewConfig` itself arrived.
 *
 * `1.23.0` adds private notes (PRIV v1, ADR-057 §6): the record types
 * `private-note` and `private-note-version`, riding in their OWN
 * `data/private-notes.ndjson` — a new `DATA_FILES` entry, checksummed like the
 * six before it — each carrying the DECRYPTED envelope (`ExportPrivateNote`):
 * the archive's own passphrase is the protection, the same trust everything
 * else in it already rides on, and a sealed-forever export would be unreadable
 * the moment the profile's Recovery Kit is regenerated. Private attachment
 * BYTES travel decrypted as `private-blobs/<attachment id>` entries — their own
 * zip directory, deliberately NOT the content-addressed `blobs/` union, because
 * no sha256 identity exists for a private attachment by design (`privEnvelope.ts`'s
 * no-existence-oracle rule) — and are listed in the manifest's `privateBlobs`
 * exactly as the blob list is. Markdown mirrors live under
 * `notes-private/<id>.md`, keyed by ID and never by title (see the mirror loop's
 * comment). Neither record type needs an `ArchiveEra` flag (the parser's own
 * precedent: a whole absent type is never ambiguous — an older archive simply
 * carries none). Whether private notes ride AT ALL is the writer's gate, not
 * this builder's: main supplies `ExportArchiveInput.privateNotes` only while
 * the PRIV section is unlocked and the export is encrypted (NXA1) — a locked
 * section or a plaintext export excludes them with a named skip in the export
 * result. A MINOR bump by the same honesty every entry below made: an older
 * reader handed an archive carrying someone's most private notes would restore
 * a profile in which they are simply gone.
 *
 * `1.22.0` adds the profile's `kind` (ADR-058, business profiles): one field on
 * the manifest's own `profile` object, ALWAYS written — what kind of profile an
 * archive is OF is never something a reader should infer. A manifest fact
 * rather than a record for `1.18.0`'s reason: the kind is the profile's
 * identity, exactly as its name and picture are. A MINOR bump by the same
 * honesty every entry below made: an older reader handed a business profile's
 * archive would restore it into a personal profile as if the two were the same
 * thing — and refusing is the truthful answer to a file whose identity it
 * cannot read. On the way back in the field is OPTIONAL with the default
 * `"personal"` (the ADR-028 rule): the only kind any earlier archive could be
 * of, so its absence is never ambiguous.
 *
 * `1.21.0` adds named dashboards (DASH-008 / ADR-055, migration 043): the
 * `dashboard-set` record type — one row per named board, riding in
 * `data/dashboard.ndjson` between the settings row and the widgets — plus an
 * OPTIONAL `setId` on `dashboard-widget` (absent = the default board, which is
 * what every widget in every earlier archive was) and an OPTIONAL `activeSetId`
 * on `dashboard-settings` (absent = the default board is showing). A MINOR
 * bump by the same honesty every entry below made: an older reader handed this
 * archive would restore a profile whose named boards are simply gone —
 * arrangements their owner built by hand and nothing else in the archive can
 * reconstruct.
 *
 * `1.20.0` adds the `calendar-settings` record type (CAL-010 / ADR-054,
 * migration 042): the profile's fixed semester dates, zero-or-one row riding
 * FIRST in `data/calendar.ndjson` exactly as `study-settings` leads its own
 * file. A MINOR bump by the same honesty every settings row below made: an
 * older reader handed this archive would restore a profile whose Semestar view
 * silently slid back to the current four months, losing the term its owner
 * anchored it to — and refusing is the truthful answer to a file it cannot
 * fully read.
 *
 * `1.19.0` adds the profile's default snooze preset (NTF-009, migration 041):
 * one field in the manifest's `settings.notifications` object, beside the quiet
 * hours it is a sibling preference of. Optional-with-a-default on the way in
 * (absence means „10 min“, which is what every earlier build's snooze button
 * did), and a MINOR bump all the same, by the honesty every entry below made:
 * an older reader handed this archive would restore the profile with a snooze
 * default it silently reset, and refusing is the truthful answer to a file it
 * cannot fully read. The same reasoning `1.17.0` made for a folder's default
 * view — a small preference is still the user's choice.
 *
 * `1.18.0` adds a profile's picture (SET-001, migration 040): three fields on
 * the manifest's own `profile` object, declaring a blob that travels in the
 * `blobs/` union like any other. The manifest rather than a record, because the
 * picture is a fact about the PROFILE — precisely what `profile.name` beside it
 * already is — and every `ProfileData` collection belongs to exactly one archive
 * MODULE, which a profile's own identity does not; filing it under `dashboard`
 * (its nearest neighbour) would mean a tasks-only export loses the user's
 * picture while a dashboard-only export carries it, which is a mapping that says
 * something untrue. Being a manifest fact, it is also not subject to the module
 * choice (IMEX-003), on the same terms as `settings` below.
 *
 * `1.17.0` adds a note folder's `defaultView` — the shape its notes are drawn in
 * (NOTE-002, migration 039) — after
 * `1.16.0` added a task list's `viewConfig` — what it remembers about each of its
 * four views (ADR-050, migration 038) — after
 * `1.15.0` added the `event-template` record type — a saved SHAPE of one event
 * (CAL-009, migration 036), riding in the data file the CAL module already had —
 * after `1.14.0` added the `subject-attachment` and `subject-note-link` record
 * types — a subject's materials and the notes filed under it (STUDY-001,
 * migration 035) — after `1.13.0` added the `study-settings` record
 * type — the profile's FSRS target retention and its two daily caps (STUDY-007,
 * migration 034) — after `1.12.0` added a card's `problemSteps` —
 * the worked solution a problem card's `back` is derived from (ADR-046) —
 * after `1.11.0` added the `dashboard-widget` record type — the profile's
 * dashboard layout (DASH-002 / ADR-045, migration 032) — `1.10.0` a card's
 * `kind` and, for a cloze card, the `clozeText`/`clozeOrdinal` it is derived
 * from (STUDY-006 / ADR-042), `1.9.0` the `dashboard-settings` record type (SET-006
 * / ADR-041), `1.8.0` the `task-dependency` record type (migration 029 /
 * ADR-037), `1.5.0`-`1.7.0` task attachments, task templates and the NOTE
 * folder preferences (each landing on its own lane), `1.4.0` the
 * `task-tag`/`task-tag-link` types (migration 023), `1.3.0` the
 * `task-list`/`task-section` types and the `listId`/`sectionId`/`position` a
 * task carries into them (TASK-004 / ADR-029), `1.2.0` a task's
 * `reminderOffsets` (ADR-028) and `1.1.0` the `person` record type (CAL-007 /
 * ADR-026). Additive, so a MINOR bump by the same honesty each of those made
 * one: an archive this build writes is refused by an older reader, which would
 * otherwise restore a profile with every list and every folder opening on the
 * wrong shape, every
 * event template simply gone and every
 * course material missing — shapes their owner built by hand and files nothing
 * else in the archive can reconstruct; the same honesty `1.14.0` owed the
 * subject materials, `1.13.0` owed the study preferences, `1.12.0` owed every
 * problem card's steps, `1.11.0` owed the arranged dashboard and `1.10.0` owed
 * every cloze template. Kept in step
 * with `INTERCHANGE_SCHEMA_VERSION` (`importArchive.ts`) — two constants
 * rather than one import, since the reader already imports from this module
 * and the cycle would be worse than the duplication; `importArchive.test.ts`
 * pins them equal.
 *
 */
const SCHEMA_VERSION = "1.24.0";

// --- Row shapes (the interchange contract; see file header) -----------------

/**
 * A task list (TASK-004 / ADR-029): the nestable container tasks live in, with
 * `isInbox` marking the one every profile always has. Rides in
 * `data/tasks.ndjson` ahead of the tasks that reference it.
 */
export interface ExportTaskList {
  id: string;
  profileId: string;
  parentId: string | null;
  name: string;
  isInbox: boolean;
  defaultView: string;
  /**
   * What this list remembers about each of its four views — grouping, sort and
   * filters (ADR-050, migration 038). OPTIONAL with a default, like a card's
   * `problemSteps`: absent or null means "no preferences", which is exactly what
   * every list in every archive written before this field had, so no
   * `ArchiveEra` flag is involved. A nested object rather than a JSON STRING,
   * for the reason a task's `recurrence` is one: the interchange is JSON, and a
   * string here would be a second encoding nobody can read in the file.
   */
  viewConfig?: TaskViewConfig | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** A heading inside one list. No `profileId`: a section is scoped through its list, exactly as a renewal is through its document. */
export interface ExportTaskSection {
  id: string;
  listId: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A task tag (migration 023): a per-profile label, unique by (profile, name).
 * Field for field `ExportNoteTag` — task tags are that feature applied to
 * tasks, so the interchange row is the same row with a different owner. Rides in
 * `data/tasks.ndjson` ahead of the tasks that carry it.
 */
export interface ExportTaskTag {
  id: string;
  profileId: string;
  name: string;
  createdAt: string;
}

/** One task-tag attachment — `ExportNoteTagLink` with a task on the other end. */
export interface ExportTaskTagLink {
  taskId: string;
  tagId: string;
}

/**
 * A file hanging off a task (migration 024): the index row only, exactly as
 * `ExportNoteAttachment` is, with the bytes declared as a binary entry and
 * content-addressed by `sha256`. The two tables share ONE `blobs/<sha256>`
 * namespace in the archive, because they share one blob store on disk — a file
 * attached to both a task and a note travels once.
 */
export interface ExportTaskAttachment {
  id: string;
  taskId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

/**
 * The task-shaped body a template carries (ADR-035 / TASK-010) — the interchange
 * twin of `@nexus/db`'s `TaskTemplatePayload`, declared structurally here for
 * the reason every row shape in this file is (see the file header).
 *
 * A nested object rather than eight flattened `payload*` keys: the payload is
 * one value in one column, it is validated as a unit on both sides, and
 * flattening it would put eight task-ish field names at the top level of a row
 * that is NOT a task — where the next reader would reasonably expect them to
 * mean what they mean on a `task` row, which they do not (`dueOffsetDays` is
 * relative, `tagNames` are names, `subtaskTitles` are not rows).
 */
export interface ExportTaskTemplatePayload {
  title: string;
  description: string | null;
  priority: string;
  /**
   * Whole days from the day the template is APPLIED to the created task's due
   * date, or null for no due date. Relative on purpose: an absolute date in a
   * template rots the day after it is saved (ADR-035).
   */
  dueOffsetDays: number | null;
  /** Whole days before the computed due date, ascending; empty unless `dueOffsetDays` is set. */
  reminderOffsets: number[];
  /** The rule the created task advances by, or null; non-null only with a `dueOffsetDays` to phase from. */
  recurrence: RecurrenceRule | null;
  /**
   * Tag NAMES, never `task_tags` ids — which is what lets a template survive the
   * deletion of a tag it was captured with, and restore into a profile whose tag
   * ids are entirely different. Apply re-resolves each through get-or-create.
   */
  tagNames: string[];
  /** Titles of the direct subtasks the template creates. Duplicates are legal — two identical chores are two chores. */
  subtaskTitles: string[];
}

/**
 * A task template (migration 027 / ADR-035). Rides in `data/tasks.ndjson`.
 * Deliberately last among the TASK types there: it references nothing — not a
 * list, not a section, not a tag ROW — so it constrains no ordering, and putting
 * it after the join keeps the "everything a row points at came before it"
 * reading of that file intact.
 *
 * No `tables/*.csv` mirror, for `ExportPerson`'s reason: those are a curated
 * subset for a human with a spreadsheet, and a nested payload is precisely what
 * a flat table cannot show. The NDJSON is the lossless layer (ADR-009).
 */
export interface ExportTaskTemplate {
  id: string;
  profileId: string;
  name: string;
  payload: ExportTaskTemplatePayload;
  createdAt: string;
  updatedAt: string;
}

/**
 * One dependency edge (migration 029 / ADR-037): `blockerId` must finish before
 * `blockedId` can be worked on. Two ids and nothing else, like the tag link
 * above — an edge has no identity of its own to name and no moment to
 * time-stamp; it is either there or it is not.
 *
 * DIRECTED, and that direction is the whole record: the reverse pair is a
 * different edge, and an archive carrying both is a cycle, which the reader
 * refuses outright (`importArchive.ts`). Rides in `data/tasks.ndjson` after the
 * tasks, since it needs BOTH ends resolved.
 */
export interface ExportTaskDependency {
  blockerId: string;
  blockedId: string;
}

export interface ExportTask {
  id: string;
  profileId: string;
  parentId: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  done: boolean;
  dueDate: string | null;
  startDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /**
   * The rule this task advances by when an occurrence is completed (ADR-024),
   * or null for a one-off. Required, like every field above: a recurring task
   * restored without its rule is a task the user would silently stop being
   * reminded of, and a required field makes forgetting it a type error rather
   * than a quiet omission.
   */
  recurrence: RecurrenceRule | null;
  /**
   * Whole DAYS before `dueDate` at which the user is reminded (ADR-028),
   * ascending; always empty when `dueDate` is null. Days rather than an event's
   * minutes because a task's deadline is a day, not an instant. Required, for
   * exactly the reason the rule above is: a task restored without its ladder
   * goes quiet, and quiet is the one failure a reminder feature cannot report.
   */
  reminderOffsets: number[];
  /**
   * The list this task lives in (TASK-004 / ADR-029). `null` ONLY when the
   * archive predates `1.3.0` and the reader defaulted it (see `ArchiveEra`) — a
   * writer at `1.3.0` or later always names a list, and a `1.3` archive that
   * carries `null` here is refused rather than quietly re-filed. A restore maps
   * an era-defaulted `null` onto the target profile's Inbox, which is where
   * those tasks were before lists existed.
   */
  listId: string | null;
  /** The section of `listId` this task sits under, or null for the list body. Era-defaults to null. */
  sectionId: string | null;
  /** Sparse sort key within the task's (list, section) scope; may be negative. Era-defaults to 0, which a restore then re-spaces. */
  position: number;
}

export interface ExportEvent {
  id: string;
  profileId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
  /** The rule that makes this row a series master the calendar expands (ADR-024), or null for a one-off. Required, for the same reason as a task's. */
  recurrence: RecurrenceRule | null;
  /** Bare `YYYY-MM-DD` occurrence dates removed from the series, ascending; always empty when `recurrence` is null. */
  recurrenceExdates: string[];
  /**
   * Whole minutes before an occurrence's start at which the user is reminded
   * (CAL-006), ascending. Required, like every field above: an event restored
   * without its ladder is an event the user would silently stop being reminded
   * of — and a required member makes a forgotten gather a type error rather
   * than a quiet omission.
   */
  reminderOffsets: number[];
}

/**
 * The event-shaped body a template carries (CAL-009) — the interchange twin of
 * `@nexus/db`'s `EventTemplatePayload`, declared structurally here for the
 * reason every row shape in this file is (see the file header).
 *
 * A nested object rather than nine flattened `payload*` keys, exactly as
 * `ExportTaskTemplatePayload` is: the payload is one value in one column, it is
 * validated as a unit on both sides, and flattening it would put nine event-ish
 * field names at the top level of a row that is NOT an event — where the next
 * reader would reasonably expect `startTime` to be an instant and a duration to
 * be an end.
 */
export interface ExportEventTemplatePayload {
  title: string;
  allDay: boolean;
  /**
   * Wall-clock `HH:MM` the created event starts at, or null on an all-day
   * template. Relative on purpose, like every field here: a template carries a
   * time of day and a length, never a date — an absolute start rots the morning
   * after it is saved (CAL-009).
   */
  startTime: string | null;
  /** Whole minutes the created event lasts, or null for one with no end. Timed templates only, and always ending inside its own day. */
  durationMinutes: number | null;
  location: string | null;
  description: string | null;
  category: string | null;
  /** Whole minutes before the created event's start at which to remind (CAL-006), ascending. */
  reminderOffsets: number[];
  /** The rule the created event's series runs on (ADR-024), or null. UNANCHORED — apply phases it from the day the template is applied to. */
  recurrence: RecurrenceRule | null;
}

/**
 * An event template (migration 036 / CAL-009). Rides in
 * `data/calendar.ndjson`, deliberately last among the CAL types there: it
 * references nothing — not an event, not a person — so it constrains no
 * ordering, and putting it after the rows that DO reference each other keeps the
 * "everything a row points at came before it" reading of that file intact. The
 * same placement `task-template` has in `data/tasks.ndjson`.
 *
 * No `tables/*.csv` mirror, for `ExportTaskTemplate`'s reason: those are a
 * curated subset for a human with a spreadsheet, and a nested payload is
 * precisely what a flat table cannot show. The NDJSON is the lossless layer
 * (ADR-009).
 */
export interface ExportEventTemplate {
  id: string;
  profileId: string;
  name: string;
  payload: ExportEventTemplatePayload;
  createdAt: string;
  updatedAt: string;
}

/** Only the persisted fields — `status`/`daysUntilExpiry` are derived at read time, never stored, so they are not part of the interchange row. */
export interface ExportDocument {
  id: string;
  profileId: string;
  docType: string;
  label: string;
  expiryDate: string;
  reminderOffsets: readonly number[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportRenewal {
  id: string;
  documentId: string;
  previousExpiry: string;
  renewedAt: string;
}

/**
 * A birthday or anniversary (CAL-007 / ADR-026). `month`/`day` travel as the
 * two integers the column holds rather than as a date string, for the reason
 * migration 020 gives: the recurring fact has no year, and inventing one to
 * fill a date's slot would put a lie in the interchange contract. `year` is
 * the separately-known birth/start year, null when unknown.
 *
 * No `tables/*.csv` mirror: those are a curated subset for a human opening the
 * archive in a spreadsheet (renewals have none either), and the NDJSON is the
 * lossless layer (ADR-009).
 */
export interface ExportPerson {
  id: string;
  profileId: string;
  name: string;
  kind: string;
  month: number;
  day: number;
  year: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One profile's fixed semester dates (CAL-010 / ADR-054, migration 042): the
 * closed day range the Semestar view anchors to, or both null for "no term
 * set". Rides in `data/calendar.ndjson`, FIRST — it references nothing and
 * nothing references it, so its position is readability (the term the rest of
 * the module is read under, before the rows), exactly as `study-settings`
 * leads its own file.
 *
 * Both bare `YYYY-MM-DD` day keys, both-or-neither (the store's rule,
 * re-checked by the reader — migration 042's table tolerates a half so one
 * upsert can stage it), and never start > end.
 */
export interface ExportCalendarSettings {
  profileId: string;
  semesterStart: string | null;
  semesterEnd: string | null;
}

export interface ExportSubject {
  id: string;
  profileId: string;
  name: string;
  color: string;
  semester: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A file hanging off a subject (STUDY-001, migration 035): the index row only,
 * exactly as `ExportTaskAttachment` and `ExportNoteAttachment` are, with the
 * bytes declared as a binary entry and content-addressed by `sha256`. All three
 * tables share ONE `blobs/<sha256>` namespace in the archive, because they share
 * one blob store on disk — a file attached to a subject, a task AND a note
 * travels once. Rides in `data/study.ndjson` after the subjects it hangs off.
 */
export interface ExportSubjectAttachment {
  id: string;
  subjectId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

/**
 * One subject↔note link (STUDY-001, migration 035): the pair, plus when it was
 * made — the order the subject panel lists its notes in, and the only field a
 * pair-keyed row has of its own. `ExportTaskDependency`'s shape with a
 * timestamp, and pair-identified for the same reason (migration 035's PRIMARY
 * KEY). Rides in `data/study.ndjson` after the subjects, and needs the NOTES of
 * `data/notes.ndjson` too — which the reader resolves across files, since
 * nothing here constrains the writing order of the other file.
 */
export interface ExportSubjectNoteLink {
  subjectId: string;
  noteId: string;
  createdAt: string;
}

export interface ExportExam {
  id: string;
  profileId: string;
  subjectId: string;
  examType: string;
  examDate: string;
  scope: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportDeck {
  id: string;
  profileId: string;
  subjectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Full FSRS scheduling state — the NDJSON is the lossless layer (ADR-009); the CSV mirror below drops these fields deliberately. */
export interface ExportCard {
  id: string;
  profileId: string;
  deckId: string;
  front: string;
  back: string;
  /**
   * The note that generated this card, and the block key it reconciles
   * against (NOTE-006/ADR-017) — both null for a hand-made card, and never
   * one without the other.
   *
   * Declared late (this contract shipped without them) because a card's
   * origin is not decoration: `syncFromNote` reconciles a note's cards by
   * `sourceBlockKey`, so a restore that dropped these would leave every
   * note-sourced card orphaned, and the next time the user opened that note
   * it would generate a second card per block — the original's FSRS history
   * stranded on a row nothing points at any more.
   */
  sourceNoteId: string | null;
  sourceBlockKey: string | null;
  /**
   * What kind of card this is (STUDY-006 / ADR-042). OPTIONAL with a default:
   * absent means `"basic"`, which is exactly what every archive written before
   * this field existed contained, so it needs no `ArchiveEra` flag (the ADR-028
   * rule — an era flag exists only for a field whose absence is ambiguous). A
   * key that IS present is validated strictly, in every era.
   */
  kind?: string;
  /**
   * A cloze card's raw `{{…}}` template and the deletion this row asks.
   * Required together exactly when `kind` is `"cloze"`, absent or null
   * otherwise — the same pair rule the `cards` CHECK constraints enforce, and
   * the reader additionally re-runs the `{{…}}` grammar to confirm the ordinal
   * is actually IN the template. Without them a restored cloze card would keep
   * its rendered sides but lose the only text its owner can edit.
   */
  clozeText?: string | null;
  clozeOrdinal?: number | null;
  /**
   * A problem card's worked solution in the `--` grammar of `problemSteps.ts`,
   * the SOURCE its `back` is derived from (ADR-046). OPTIONAL with a default,
   * like `kind`: absent or null means "no worked solution", which is what every
   * card in every archive written before this field contained, so no
   * `ArchiveEra` flag is involved. Only a `"basic"` card may carry it — a
   * problem card is a basic card with steps, not a third kind — and the reader
   * refuses it on a cloze card, whose `back` already has a source.
   */
  problemSteps?: string | null;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportReviewLogEntry {
  id: string;
  profileId: string;
  cardId: string;
  rating: number;
  state: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  lastElapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  review: string;
  createdAt: string;
}

export interface ExportStudyPlan {
  id: string;
  profileId: string;
  examId: string;
  dailyMinutes: number;
  startDate: string;
  examWeekBoost: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExportStudyBlock {
  id: string;
  planId: string;
  profileId: string;
  blockDate: string;
  minutes: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One profile's study-scheduling preferences (STUDY-007, migration 034): the
 * FSRS target retention plus the two daily caps. Rides in `data/study.ndjson`,
 * FIRST — it references nothing and nothing references it, so its position is
 * readability (the settings the rest of the module is studied under, before the
 * rows), exactly as `dashboard-settings` leads its own file.
 *
 * `maxReviewsPerDay` is `null` for "no cap at all", never 0 — the distinction
 * the column itself makes, carried through the interchange rather than
 * flattened into a sentinel a reader would have to know about.
 */
export interface ExportStudySettings {
  profileId: string;
  targetRetention: number;
  newPerDay: number;
  maxReviewsPerDay: number | null;
}

export interface ExportFocusSession {
  id: string;
  profileId: string;
  subjectId: string;
  startedAt: string;
  endedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExportNotification {
  id: string;
  profileId: string;
  source: string;
  entityId: string;
  occurrenceKey: string;
  title: string;
  body: string;
  status: string;
  snoozedUntil: string | null;
  deliveredAt: string;
  createdAt: string;
  updatedAt: string;
}

/** A note's metadata row (ADR-022 section 3 / NOTE). */
export interface ExportNote {
  id: string;
  profileId: string;
  title: string;
  folderId: string | null;
  pinned: boolean;
  cardDeckId: string | null;
  createdAt: string;
  updatedAt: string;
  /** The note's merged Yjs state, or null when it has never been edited. Emitted as `data/notes/<id>.ydoc`; stripped from the NDJSON row (bytes are not JSON) and used as the Markdown mirror's source. */
  snapshot: Uint8Array | null;
}

export interface ExportNoteFolder {
  id: string;
  profileId: string;
  parentId: string | null;
  name: string;
  color: string | null;
  /**
   * The template a note created in this folder opens with (ADR-036). A
   * built-in template's constant id or a `note_templates` row's id — the two
   * are indistinguishable here on purpose, exactly as in the column (migration
   * 028 deliberately declares no foreign key), and a dangling id quietly means
   * "no template" rather than refusing to create the note.
   */
  defaultTemplateId: string | null;
  /** Whether a context-free "Nova beleška" (the palette's) files into this folder. At most one folder per profile carries it. */
  isCaptureDefault: boolean;
  /**
   * The shape this folder's notes are drawn in — `"list"` or `"cards"`
   * (NOTE-002, migration 039). OPTIONAL with a default, like a task list's
   * `viewConfig`: absent means `"list"`, which is what every folder in every
   * archive written before this field actually opened as, so no `ArchiveEra`
   * flag is involved. A PRESENT value is validated strictly against the closed
   * set, in every era.
   */
  defaultView?: "list" | "cards";
  createdAt: string;
  updatedAt: string;
}

export interface ExportNoteTag {
  id: string;
  profileId: string;
  name: string;
  createdAt: string;
}

/** One note-tag attachment. */
export interface ExportNoteTagLink {
  noteId: string;
  tagId: string;
}

/** `content` is a JSON-encoded ProseMirror document (ADR-016) — a template is not a note and carries no Yjs state. */
export interface ExportNoteTemplate {
  id: string;
  profileId: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/** The index row only; the bytes are declared as a binary entry, content-addressed by `sha256`. */
export interface ExportNoteAttachment {
  id: string;
  noteId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface ExportNoteVersion {
  noteId: string;
  coveredSeq: number;
  title: string;
  createdAt: string;
  /** The checkpoint's Yjs state — emitted as `data/note-versions/<noteId>/<coveredSeq>.ydoc`, stripped from the NDJSON row. */
  snapshot: Uint8Array;
}

/**
 * One profile's dashboard background choice and dim (SET-006 / ADR-041).
 *
 * A record rather than a manifest section, unlike the flags and notification
 * preferences below, because it names a BLOB: the image travels in the
 * archive's `blobs/` union exactly as a note attachment does, and a row that
 * points at one belongs where the other blob-bearing rows are — in the NDJSON,
 * checksummed, one line per profile.
 *
 * `backgroundHash`/`backgroundMime`/`backgroundSizeBytes` are all null or all
 * set (migration 030's CHECK): a hash with no mime is a blob nothing can decide
 * how to serve, and a hash with no size would make the manifest's blob
 * inventory only partly true. The mime is whatever main sniffed from the file's
 * own bytes at pick time (SEC-FILE-02), never a guess from its name.
 */
export interface ExportDashboardSettings {
  profileId: string;
  backgroundHash: string | null;
  backgroundMime: string | null;
  backgroundSizeBytes: number | null;
  backgroundDim: number;
  /**
   * The named board the profile is currently looking at (DASH-008 / ADR-055),
   * naming a `dashboard-set` row of this archive, or null for the default
   * board. OPTIONAL with a default, like a card's `kind`: absent means null,
   * which is the only board any archive written before `1.21.0` could have
   * been showing, so no `ArchiveEra` flag is involved. A PRESENT id is
   * reference-checked against the archive's own sets.
   */
  activeSetId?: string | null;
}

/**
 * One named dashboard („tabla“, DASH-008 / ADR-055, migration 043). Rides in
 * `data/dashboard.ndjson` between the settings row and the widgets: after the
 * preferences that lead the file (the `study-settings` idiom), before the rows
 * whose `setId` names it — so the file still reads as "everything a row points
 * at came before it", with the one exception of the settings row's own
 * `activeSetId`, which the reader resolves in the reference pass exactly as it
 * resolves a `subject-note-link` across files.
 *
 * The DEFAULT board is deliberately NOT among these rows: `set_id NULL` is the
 * default dashboard, named „Početna“ in copy only, so an archive of a profile
 * that never made a named board carries no `dashboard-set` at all — which is
 * also what every pre-`1.21.0` archive is.
 */
export interface ExportDashboardSet {
  id: string;
  profileId: string;
  name: string;
  /** Sparse sort key among the profile's boards; may be negative. */
  position: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One placed widget of a profile's dashboard layout (DASH-002 / ADR-045,
 * migration 032). Rides in `data/dashboard.ndjson` beside `dashboard-settings`,
 * after it — the two share a module and reference each other not at all.
 *
 * `widgetId` is a `moduleId:widgetId` slug a module's MANIFEST publishes: a code
 * constant, in no table (migration 032 declares no foreign key for it, on
 * migration 028's argument). It is carried across unchanged by every path here,
 * including a foreign import, precisely because it does not name a row.
 *
 * `position` is the sparse sort key, not an index: it may be negative, it is
 * never assumed contiguous, and the ORDER it expresses is the layout. `config`
 * is per-widget JSON text, opaque — no widget publishes a config schema yet, so
 * the reader checks only that a non-null value parses as JSON at all.
 */
export interface ExportDashboardWidget {
  instanceId: string;
  profileId: string;
  widgetId: string;
  size: string;
  position: number;
  config: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * The named board this placement belongs to (DASH-008 / ADR-055), naming a
   * `dashboard-set` row of this archive, or null for the default board.
   * OPTIONAL with a default, like a card's `kind` (the ADR-028 rule — no
   * `ArchiveEra` flag): absent means null, because the default board is the
   * only one any widget in any pre-`1.21.0` archive could have been on. A
   * PRESENT id is reference-checked against the archive's own sets.
   */
  setId?: string | null;
}

/**
 * Everything the manifest's "settings" section carries (founder decision #11:
 * flags + NTF settings ship with the export).
 *
 * NOT subject to a module choice (IMEX-003), and deliberately so: this is a
 * MANIFEST section, not rows — `countProfileModules` counts none of it, so it
 * has no module home in the one mapping that exists, and inventing one for it
 * would be the second mapping this whole arrangement avoids. The three
 * settings-SHAPED things that ARE rows do have homes and are filtered by them:
 * `studySettings` into study, `dashboardSettings` and `dashboardWidgets` into
 * dashboard. Note the resulting split on notifications, which is the honest one:
 * the `notifications` module is the delivered LEDGER, while the quiet hours and
 * per-source toggles below are preferences, and a user who unticks „Obaveštenja“
 * is asking not to export a history of what was shown — not to forget when they
 * like being disturbed.
 */
export interface ExportSettings {
  flags: Record<string, boolean>;
  notifications: {
    quietFrom: string | null;
    quietTo: string | null;
    morningHour: string;
    enabledSources: readonly string[];
    /**
     * Which snooze preset the notification center's plain „Odloži“ button means
     * (NTF-009, migration 041). Always WRITTEN, and OPTIONAL on the way back in
     * — an archive from before `1.19.0` simply has no key here and reads as
     * `"10m"`, which is what that button did in every one of those builds.
     */
    snoozeDefault: string;
  };
}

/**
 * Every non-derived row of one profile: what an archive carries, what the
 * exporter gathers, and what a restore writes. One shape, deliberately shared
 * by all three, so a module that one of them forgets is a type error in the
 * other two rather than a silent omission.
 */
export interface ProfileData {
  tasks: readonly ExportTask[];
  // Required, like `tasks` itself: a task names the list it lives in, so an
  // archive that carried the tasks but not the lists would restore a profile
  // whose every task points at a container that is not there.
  taskLists: readonly ExportTaskList[];
  taskSections: readonly ExportTaskSection[];
  // Required for the same reason, one step further along: a link names a tag,
  // so an archive carrying the links but not the tags would restore a profile
  // whose every label points at a row that is not there.
  taskTags: readonly ExportTaskTag[];
  taskTagLinks: readonly ExportTaskTagLink[];
  // Required, and for the sharpest reason of the three: an attachment row is
  // the ONLY thing that names a blob, so an archive that forgot them would not
  // merely lose the index — it would leave the user's files out of the zip
  // entirely, with nothing in the manifest to say they ever existed.
  taskAttachments: readonly ExportTaskAttachment[];
  // Required like every field above (ADR-035): a template is the only record of
  // a shape the user built by hand, and nothing else in the archive can be used
  // to reconstruct it — an export that quietly omitted them would restore a
  // profile whose templates are simply gone.
  taskTemplates: readonly ExportTaskTemplate[];
  // Required, like every field around it: a dependency is the ORDER the user put
  // their work in, and an archive that dropped it would restore a plan whose
  // "do this first" is gone with nothing on screen to say so.
  taskDependencies: readonly ExportTaskDependency[];
  events: readonly ExportEvent[];
  // Required, for `taskTemplates`' reason exactly (CAL-009): a template is the
  // only record of a shape the user built by hand, and nothing else in the
  // archive can be used to reconstruct it — an export that quietly omitted them
  // would restore a profile whose event templates are simply gone.
  eventTemplates: readonly ExportEventTemplate[];
  documents: readonly ExportDocument[];
  renewals: readonly ExportRenewal[];
  people: readonly ExportPerson[];
  /**
   * Zero or one row (CAL-010 / ADR-054) — the profile's fixed semester dates.
   * Required, like every field above and for the same reason: a module the
   * caller forgets must be a type error, not a quiet omission. An EMPTY array
   * is the honest shape for "this archive carries no such row", which is
   * exactly what every pre-`1.20.0` archive is, and what a restore then reads
   * as "leave the profile with no term set".
   */
  calendarSettings: readonly ExportCalendarSettings[];
  subjects: readonly ExportSubject[];
  // Required, for `taskAttachments`' sharpest-of-reasons: a material row is the
  // ONLY thing that names its blob, so an archive that forgot them would not
  // merely lose the index — it would leave the user's course files out of the
  // zip entirely, with nothing in the manifest to say they ever existed.
  subjectAttachments: readonly ExportSubjectAttachment[];
  // Required like every field around it: a link is which note belongs to which
  // course, and an archive that dropped it would restore a subject panel whose
  // notes are simply gone with nothing on screen to say so.
  subjectNoteLinks: readonly ExportSubjectNoteLink[];
  exams: readonly ExportExam[];
  decks: readonly ExportDeck[];
  cards: readonly ExportCard[];
  reviewLog: readonly ExportReviewLogEntry[];
  plans: readonly ExportStudyPlan[];
  blocks: readonly ExportStudyBlock[];
  focusSessions: readonly ExportFocusSession[];
  /**
   * Zero or one row (STUDY-007) — the profile's target retention and daily
   * caps. Required, like every field above and for the same reason: a module
   * the caller forgets must be a type error, not a quiet omission. An EMPTY
   * array is the honest shape for "this archive carries no such row", which is
   * exactly what every pre-`1.13.0` archive is, and what a restore then reads as
   * "leave the profile on the store's own defaults".
   */
  studySettings: readonly ExportStudySettings[];
  notifications: readonly ExportNotification[];
  // Required, like every field above, and deliberately so: this archive
  // shipped for two weeks writing zero notes because the export simply had
  // no place to put them and nobody's compiler ever said a word. A module
  // the caller forgets must be a type error, not a quiet omission.
  notes: readonly ExportNote[];
  noteFolders: readonly ExportNoteFolder[];
  noteTags: readonly ExportNoteTag[];
  noteTagLinks: readonly ExportNoteTagLink[];
  noteTemplates: readonly ExportNoteTemplate[];
  noteAttachments: readonly ExportNoteAttachment[];
  noteVersions: readonly ExportNoteVersion[];
  /**
   * Zero or one row (SET-006 / ADR-041) — the profile's dashboard background
   * and dim. Required, like every field above and for the same reason: a module
   * the caller forgets must be a type error, not a quiet omission. An EMPTY
   * array is the honest shape for "this archive carries no such row", which is
   * exactly what every pre-`1.9.0` archive is, and what a restore then reads as
   * "leave the profile on the store's own defaults".
   */
  dashboardSettings: readonly ExportDashboardSettings[];
  /**
   * The profile's named boards (DASH-008 / ADR-055), in board order. Required,
   * like every field above and for the same reason: a module the caller forgets
   * must be a type error, not a quiet omission. EMPTY both for a pre-`1.21.0`
   * archive and for a profile that never made a named board — indistinguishable
   * on purpose, because they mean the same thing: only „Početna“, which is not
   * a row and therefore not carried.
   */
  dashboardSets: readonly ExportDashboardSet[];
  /**
   * The profile's dashboard layouts (DASH-002 / ADR-045; per-board since
   * ADR-055) — one row per placed widget, each naming its board, in position
   * order. Required, like every field above and for the same
   * reason: a module the caller forgets must be a type error, not a quiet
   * omission.
   *
   * EMPTY is a meaningful value here, not merely the pre-`1.11.0` shape: a
   * profile that has never rearranged its dashboard stores no rows at all
   * (`DashboardWidgetStore` is get-or-default), so an empty array says "this
   * profile is on the default arrangement" — which is exactly what a restore
   * then leaves the target on.
   */
  dashboardWidgets: readonly ExportDashboardWidget[];
}

// --- Private notes (PRIV v1, ADR-057 §6) ------------------------------------

/**
 * One private attachment's reference as the interchange carries it — the
 * decrypted envelope's own `PrivAttachmentRef` (`priv/privEnvelope.ts`), field
 * for field. `id` is the random id the sealed blob was named by on disk AND the
 * name of the archive's decrypted `private-blobs/<id>` entry; it is NOT a
 * content address, by design (no sha256 identity exists for a private
 * attachment — `privEnvelope.ts`'s no-existence-oracle rule), and a restore
 * re-seals the bytes under an entirely fresh id anyway.
 */
export interface ExportPrivateAttachment {
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
}

/**
 * One private note, DECRYPTED (ADR-057 §6): the envelope's own fields plus the
 * row's cleartext timestamps. Rides as a `private-note` record in
 * `data/private-notes.ndjson` — and ONLY when the writer's gate lets private
 * notes into the archive at all (see `SCHEMA_VERSION`'s `1.23.0` entry). The
 * archive's passphrase is the protection: inside the container this row enjoys
 * exactly the trust every other record does, and carrying the envelope sealed
 * instead would make the export unreadable after any kit regeneration.
 */
export interface ExportPrivateNote {
  id: string;
  title: string;
  /** The note's whole Yjs state, base64 (`base64ToBytes` is the codec both sides use). */
  yjsState: string;
  /** The flat text mirror the in-memory private search folds at unlock. */
  plaintext: string;
  attachments: readonly ExportPrivateAttachment[];
  createdAt: string;
  updatedAt: string;
}

/**
 * One surviving version of a private note: the decrypted envelope it holds,
 * at the sequence its container was sealed under — a restore re-seals it at
 * that same `seq`, so the live row's `maxSeq + 1` arithmetic survives the trip.
 */
export interface ExportPrivateNoteVersion {
  noteId: string;
  seq: number;
  title: string;
  yjsState: string;
  plaintext: string;
  attachments: readonly ExportPrivateAttachment[];
  createdAt: string;
}

/** The private section's whole interchange payload — what `ExportArchiveInput.privateNotes` supplies and `parseImportArchive` reads back. */
export interface ExportPrivateNotes {
  notes: readonly ExportPrivateNote[];
  versions: readonly ExportPrivateNoteVersion[];
}

/** The empty section every export without private notes writes — one shared value, never mutated. */
const EMPTY_PRIVATE_NOTES: ExportPrivateNotes = { notes: [], versions: [] };

/**
 * The interchange's base64 codec for `yjsState`, WebCrypto-era platform-neutral
 * (no `node:` import, no `Buffer` — `privEnvelope.ts`'s discipline): `atob`
 * exists in every environment this package runs in. Throws on input that is not
 * base64 at all; the caller decides what that means (the reader refuses the
 * row, the builder never sees one — its input came out of an authenticated
 * envelope).
 */
export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * A profile's picture as the manifest carries it (SET-001, migration 040): the
 * blob store's plaintext sha256, the mime the bytes are served as, and their
 * length. A NESTED object rather than three nullable siblings on `profile`, for
 * the reason a task template's payload is one: the three are meaningless apart —
 * migration 040's CHECKs allow all-three or none — and nesting makes "all three
 * or nothing" a fact of the TYPE, so neither the writer nor the reader needs a
 * pair rule to enforce what the shape already says.
 *
 * The bytes travel in the archive's `blobs/` namespace exactly as a note
 * attachment's do, deduplicated in the same union: a picture the user also
 * attached to a note travels once, and either reference alone carries it.
 *
 * `mime` is whatever main sniffed from the bytes it produced itself
 * (SEC-FILE-02) — in practice always `image/png`, since main re-encodes every
 * picture, which is what strips the original's EXIF — and never a guess from a
 * file name.
 */
export interface ArchiveProfilePicture {
  hash: string;
  mime: string;
  sizeBytes: number;
}

/**
 * The profile kinds an archive's manifest may declare (ADR-058, `1.22.0`) —
 * migration 001's own CHECK domain, restated here structurally because
 * `@nexus/core` never imports `@nexus/db` (the file-header rule).
 */
export const ARCHIVE_PROFILE_KINDS = ["personal", "business"] as const;
export type ArchiveProfileKind = (typeof ARCHIVE_PROFILE_KINDS)[number];

export interface ExportArchiveInput {
  /**
   * The profile this archive is OF: its id, name and kind (`1.22.0` — always
   * written; see `SCHEMA_VERSION`'s entry), plus the picture it carries
   * (`1.18.0`) or null for none. The whole object is written into the
   * manifest verbatim, so a caller must build it explicitly rather than hand
   * over a wider profile row — a column the app's own `Profile` type gains later
   * would otherwise appear in every archive's manifest without anyone deciding
   * it should.
   */
  profile: {
    id: string;
    name: string;
    kind: ArchiveProfileKind;
    picture: ArchiveProfilePicture | null;
  };
  /** `app.getVersion()` — stamped by the caller, never read from here. */
  appVersion: string;
  /** ISO-8601, stamped by the caller — this module never reads a clock. */
  createdAt: string;
  settings: ExportSettings;
  data: ProfileData;
  /**
   * Which of the archive's modules ride (IMEX-003). ABSENT means all of them —
   * the whole-profile export this builder has always written, and what every
   * caller that does not offer the choice keeps getting.
   *
   * A subset is a real, complete archive of fewer modules, not a truncated one:
   * `data` is filtered through `filterProfileData` (which also repairs the
   * three cross-module references, see there), the manifest's per-module counts
   * report the filtered reality, only the surviving rows' blobs are declared,
   * and `data/calendar.ics` rides only with the calendar. A restore of it is a
   * restore like any other — it wipes the target profile whole and writes what
   * the archive carries, so an omitted module simply comes back empty
   * (`RestoreStore.replaceProfileData`, ADR-023).
   */
  modules?: ReadonlySet<ArchiveModuleId>;
  /**
   * The profile's private notes, DECRYPTED (ADR-057 §6) — a parallel input
   * beside `data`, deliberately NOT a `ProfileData` member: `ProfileData` is
   * the shape `gatherProfileData` reads, a restore's undo snapshot captures and
   * `RestoreStore` replaces, and private notes travel through none of those
   * paths (they are sealed rows the gather cannot open and the undo must carry
   * as bytes). ABSENT whenever they do not ride — a locked section, a plaintext
   * export, a section never set up, or a caller (the scheduled backup) that
   * never carries them — which writes an empty `data/private-notes.ndjson`,
   * indistinguishable from a profile with no private notes, on purpose.
   *
   * Also deliberately OUTSIDE the module choice (IMEX-003), like `settings`
   * and the profile picture: the private section belongs to no archive module,
   * and inventing one for it would be the second module↔collection mapping this
   * whole arrangement avoids.
   */
  privateNotes?: ExportPrivateNotes;
  /** sha256 hex over a UTF-8 string, injected so this module never imports `node:crypto`. */
  hash: (content: string) => string;
}

/**
 * An archive entry whose content is bytes rather than text. `buildExportArchive`
 * DECLARES these; it never holds their content beyond what its input already
 * carries — an attachment can be 50 MB of encrypted bytes on disk, so it is
 * named by hash and left for the writer to read, decrypt and stream one at a
 * time (ADR-022).
 */
export type ExportBinaryEntry =
  | { kind: "bytes"; path: string; bytes: Uint8Array }
  | { kind: "attachment"; path: string; sha256: string; sizeBytes: number }
  /** A private attachment's decrypted bytes (ADR-057 §6), resolved by the writer's own private-blob reader — named by the envelope's random id, never by a content hash (none exists for it, by design). */
  | { kind: "private-blob"; path: string; id: string; sizeBytes: number };

/** The built archive: every file's exact content, plus the counts the manifest itself also carries (for the caller's own reporting, e.g. the Settings page's confirmation line). */
export interface ExportArchive {
  files: Map<string, string>;
  totalRecords: number;
  byModule: Record<ArchiveModuleId, number>;
  binaries: ExportBinaryEntry[];
}

/** The checksummed NDJSON files, in manifest order. Exported so `importArchive.ts` verifies checksums against exactly the list this module produces them from — never a second, hand-copied literal that could drift. An older archive legitimately carries fewer of them; the reader's checksum walk iterates the UNION of this list and what the manifest declares, which is what makes appending one here backward-compatible. */
export const DATA_FILES = [
  "data/tasks.ndjson",
  "data/calendar.ndjson",
  "data/study.ndjson",
  "data/notifications.ndjson",
  "data/notes.ndjson",
  "data/dashboard.ndjson",
  // Private notes (ADR-057 §6, `1.23.0`): their own file, ALWAYS written —
  // empty whenever they do not ride, which is also what a profile with no
  // private notes writes, indistinguishable on purpose. Appending here is what
  // the union-walk comment above promises stays backward-compatible: a pre-1.23
  // archive neither carries the file nor declares its checksum, and
  // absent-and-undeclared is nothing at all.
  "data/private-notes.ndjson",
] as const;

/** The manifest's module ids, in manifest order — the grouping `countProfileModules` counts by and `buildExportArchive` builds `manifest.modules` from, so the two can never disagree. */
export const ARCHIVE_MODULE_IDS = [
  "tasks",
  "calendar",
  "study",
  "notifications",
  "notes",
  "dashboard",
] as const;
export type ArchiveModuleId = (typeof ARCHIVE_MODULE_IDS)[number];

/**
 * Counts one profile's rows into the manifest's five module buckets — the
 * exact grouping `buildExportArchive` reports in `manifest.modules` and
 * `ExportArchive.byModule`. Extracted to its own function (ADR-023) so a
 * restore preview can count a profile and an archive by the SAME rule: two
 * independently-written tallies (one here, one in a restore module) could
 * only ever drift apart, and a preview that miscounts is worse than no
 * preview at all.
 */
export function countProfileModules(data: ProfileData): Record<ArchiveModuleId, number> {
  return {
    // Lists, sections, tags, tag links, attachments, templates and
    // dependencies are all TASK module rows, so they count into the tasks
    // bucket beside the tasks themselves — the same way a folder, a tag, a tag
    // link, an attachment and a note template count into notes.
    tasks:
      data.tasks.length +
      data.taskLists.length +
      data.taskSections.length +
      data.taskTags.length +
      data.taskTagLinks.length +
      data.taskAttachments.length +
      data.taskTemplates.length +
      data.taskDependencies.length,
    // Event templates are CAL module rows, so they count into the calendar
    // bucket beside the events themselves — the same way a task template counts
    // into tasks. The semester-dates row (zero or one, ADR-054) counts here for
    // the reason `study-settings` counts into STUDY: a restore preview that
    // showed one number too few would be telling the user something untrue
    // about what is about to change.
    calendar:
      data.events.length +
      data.eventTemplates.length +
      data.documents.length +
      data.renewals.length +
      data.people.length +
      data.calendarSettings.length,
    // The scheduling-preferences row (zero or one) counts into STUDY beside the
    // rows it governs, for the reason the dashboard's background row counts into
    // its own module: a restore preview that showed one number too few would be
    // telling the user something untrue about what is about to change.
    study:
      data.subjects.length +
      data.subjectAttachments.length +
      data.subjectNoteLinks.length +
      data.exams.length +
      data.decks.length +
      data.cards.length +
      data.reviewLog.length +
      data.plans.length +
      data.blocks.length +
      data.focusSessions.length +
      data.studySettings.length,
    notifications: data.notifications.length,
    notes:
      data.notes.length +
      data.noteFolders.length +
      data.noteTags.length +
      data.noteTagLinks.length +
      data.noteTemplates.length +
      data.noteAttachments.length +
      data.noteVersions.length,
    // The background row (zero or one) plus every named board plus every
    // placed widget, counted like any other rows rather than folded into a
    // neighbouring module: a restore preview that showed "Kontrolna tabla: 6"
    // against "0" is telling the user something true about what is about to
    // change, which is the entire job of that table.
    dashboard:
      data.dashboardSettings.length + data.dashboardSets.length + data.dashboardWidgets.length,
  };
}

/** Every module — what an export that names no subset carries (IMEX-003). Read-only by construction: nothing here ever mutates it. */
const ALL_ARCHIVE_MODULES: ReadonlySet<ArchiveModuleId> = new Set(ARCHIVE_MODULE_IDS);

/** The empty array every dropped module's field becomes. One shared value, since nothing ever mutates a `ProfileData` field. */
const NO_ROWS: readonly never[] = [];

/**
 * One profile's rows narrowed to `modules` (IMEX-003) — `countProfileModules`'
 * twin, and deliberately grouped by the SAME module↔collection mapping: a
 * module the counter puts in one bucket and the filter in another would make
 * the manifest lie about its own contents.
 *
 * A module's rows drop as a unit. What that cannot do on its own is the three
 * references that cross a module boundary, each of which would otherwise be
 * left dangling — and a dangling reference is precisely what `parseImportArchive`
 * refuses outright in restore mode, so an archive carrying one would be a backup
 * that cannot be restored:
 *
 * - `subject-note-link.noteId` (STUDY→NOTES) — DROPPED when its note is not
 *   carried. The row IS the pair; without the note there is nothing left of it.
 *   The reverse needs no rule: the link is a STUDY row, so dropping STUDY takes
 *   it along.
 * - `card.sourceNoteId`/`sourceBlockKey` (STUDY→NOTES) — DETACHED, both nulled
 *   together (the parser refuses one without the other). A note-derived card and
 *   its FSRS history are STUDY data the user asked for; the note is gone by
 *   their own choice, so the honest archive is the card without its origin, not
 *   a study export quietly missing the cards its owner made from notes.
 * - `note.cardDeckId` (NOTES→STUDY) — DETACHED, for the reason the interchange
 *   contract makes it nullable at all: the deck a note generates cards into is
 *   decoration on the note, and losing the note over it would be the opposite
 *   of what the user asked for. The same policy `importArchive.ts`'s reference
 *   table already gives both detached edges.
 *
 * Nothing else crosses. Every other reference in that table has both ends inside
 * ONE module: a task's parent, list, section, tags, files and dependencies; a
 * renewal's document; an exam's, deck's, material's, link's and focus session's
 * subject; a card's deck; a review's card; a plan's exam; a block's plan; a
 * note's folder, parent folder, tags, files and versions. Nor is anything else
 * on a row a reference this archive resolves: a folder's `defaultTemplateId` is
 * a NOTES-module id or a built-in constant and deliberately carries no foreign
 * key (migration 028); a notification's `entityId` is checked by no rule and
 * constrained by no column, because a delivered notification is ledger history
 * that already outlives the row it names; a dashboard widget's `widgetId` names
 * a module manifest's slug, not a row; a task template's `tagNames` and an event
 * template's payload name no row at all; and a note's wiki-links live inside its
 * Yjs state, are re-derived at restore time, and already tolerate a target that
 * is not there.
 *
 * BLOBS need no rule of their own: every blob a ROW names (`taskAttachments`,
 * `subjectAttachments`, `noteAttachments`, `dashboardSettings.backgroundHash`)
 * is named by a row living in exactly one module, so `buildExportArchive`
 * declaring blobs off the FILTERED rows already carries exactly the ones a
 * chosen module needs — including the deduplication that lets one file shared
 * across two modules travel once when both ride. The profile's picture
 * (`1.18.0`) is the one blob no row names: it hangs off the manifest, so it is
 * declared outside this filter entirely and rides with every subset.
 */
export function filterProfileData(
  data: ProfileData,
  modules: ReadonlySet<ArchiveModuleId>,
): ProfileData {
  const only = <T>(module: ArchiveModuleId, rows: readonly T[]): readonly T[] =>
    modules.has(module) ? rows : NO_ROWS;

  // Read off the SURVIVING rows, so each repair below asks the one question
  // that matters: is the row this points at still in the archive?
  const notes = only("notes", data.notes);
  const decks = only("study", data.decks);
  const noteIds = new Set(notes.map((note) => note.id));
  const deckIds = new Set(decks.map((deck) => deck.id));

  return {
    tasks: only("tasks", data.tasks),
    taskLists: only("tasks", data.taskLists),
    taskSections: only("tasks", data.taskSections),
    taskTags: only("tasks", data.taskTags),
    taskTagLinks: only("tasks", data.taskTagLinks),
    taskAttachments: only("tasks", data.taskAttachments),
    taskTemplates: only("tasks", data.taskTemplates),
    taskDependencies: only("tasks", data.taskDependencies),
    events: only("calendar", data.events),
    eventTemplates: only("calendar", data.eventTemplates),
    documents: only("calendar", data.documents),
    renewals: only("calendar", data.renewals),
    people: only("calendar", data.people),
    calendarSettings: only("calendar", data.calendarSettings),
    subjects: only("study", data.subjects),
    subjectAttachments: only("study", data.subjectAttachments),
    subjectNoteLinks: only("study", data.subjectNoteLinks).filter((link) => noteIds.has(link.noteId)),
    exams: only("study", data.exams),
    decks,
    cards: only("study", data.cards).map((card) =>
      card.sourceNoteId === null || noteIds.has(card.sourceNoteId)
        ? card
        : { ...card, sourceNoteId: null, sourceBlockKey: null },
    ),
    reviewLog: only("study", data.reviewLog),
    plans: only("study", data.plans),
    blocks: only("study", data.blocks),
    focusSessions: only("study", data.focusSessions),
    studySettings: only("study", data.studySettings),
    notifications: only("notifications", data.notifications),
    notes: notes.map((note) =>
      note.cardDeckId === null || deckIds.has(note.cardDeckId) ? note : { ...note, cardDeckId: null },
    ),
    noteFolders: only("notes", data.noteFolders),
    noteTags: only("notes", data.noteTags),
    noteTagLinks: only("notes", data.noteTagLinks),
    noteTemplates: only("notes", data.noteTemplates),
    noteAttachments: only("notes", data.noteAttachments),
    noteVersions: only("notes", data.noteVersions),
    dashboardSettings: only("dashboard", data.dashboardSettings),
    // The sets and the widgets that name them drop AS ONE module with the
    // settings row above, so `dashboard-widget.setId` and
    // `dashboard-settings.activeSetId` can never dangle across this filter —
    // no repair rule is needed, unlike the three genuinely cross-module
    // references documented in the header.
    dashboardSets: only("dashboard", data.dashboardSets),
    dashboardWidgets: only("dashboard", data.dashboardWidgets),
  };
}

/** Builds the full `.nexus.zip` contents in memory (IMEX-001). Deterministic: identical input always yields identical file content and checksums. */
export function buildExportArchive(input: ExportArchiveInput): ExportArchive {
  const files = new Map<string, string>();

  // The module choice, resolved once (IMEX-003). One code path rather than a
  // branch: an export that named no subset filters against every module, which
  // changes nothing at all.
  const modules = input.modules ?? ALL_ARCHIVE_MODULES;
  const data = filterProfileData(input.data, modules);

  // Read once and named locally — the note section below reaches for these
  // often enough that `data.` on every line only adds noise.
  const { notes, noteFolders, noteTags, noteTagLinks, noteTemplates, noteAttachments, noteVersions } =
    data;

  // Dependency order, as in `data/notes.ndjson`: the containers and labels a
  // task points at come first and the joins that need BOTH ends come last, so
  // a reader that streamed the file could resolve every reference as it went.
  const tasksNdjson = toNdjson([
    ...data.taskLists.map((row) => ({ type: "task-list", ...row })),
    ...data.taskSections.map((row) => ({ type: "task-section", ...row })),
    ...data.taskTags.map((row) => ({ type: "task-tag", ...row })),
    ...data.tasks.map((row) => ({ type: "task", ...row })),
    ...data.taskTagLinks.map((row) => ({ type: "task-tag-link", ...row })),
    ...data.taskAttachments.map((row) => ({ type: "task-attachment", ...row })),
    // Last: a template points at no row in this file (its tags are NAMES), so it
    // constrains nothing and sits after the join that needed both its ends.
    ...data.taskTemplates.map((row) => ({ type: "task-template", ...row })),
    ...data.taskDependencies.map((row) => ({ type: "task-dependency", ...row })),
  ]);
  const calendarNdjson = toNdjson([
    // The term's dates lead, exactly as `study-settings` leads its own file:
    // the row points at nothing, so this is how the file reads, not what it
    // requires.
    ...data.calendarSettings.map((row) => ({ type: "calendar-settings", ...row })),
    ...data.events.map((row) => ({ type: "event", ...row })),
    ...data.documents.map((row) => ({ type: "document", ...row })),
    ...data.renewals.map((row) => ({ type: "renewal", ...row })),
    ...data.people.map((row) => ({ type: "person", ...row })),
    // Last, for the reason `task-template` is last in the tasks file: a template
    // points at no row here, so it constrains nothing and sits after everything
    // that does.
    ...data.eventTemplates.map((row) => ({ type: "event-template", ...row })),
  ]);
  // The preferences row leads, then the rows themselves in dependency order —
  // the shape `data/dashboard.ndjson` already has. It points at nothing, so
  // this is how the file reads, not what it requires.
  const studyNdjson = toNdjson([
    ...data.studySettings.map((row) => ({ type: "study-settings", ...row })),
    ...data.subjects.map((row) => ({ type: "subject", ...row })),
    // Straight after the subjects they hang off, exactly as `task-attachment`
    // follows its tasks. The links' other end is a NOTE, which lives in a
    // different file entirely — so their position here is readability, and the
    // reader resolves that reference across files rather than in order.
    ...data.subjectAttachments.map((row) => ({ type: "subject-attachment", ...row })),
    ...data.subjectNoteLinks.map((row) => ({ type: "subject-note-link", ...row })),
    ...data.exams.map((row) => ({ type: "exam", ...row })),
    ...data.decks.map((row) => ({ type: "deck", ...row })),
    ...data.cards.map((row) => ({ type: "card", ...row })),
    ...data.reviewLog.map((row) => ({ type: "review", ...row })),
    ...data.plans.map((row) => ({ type: "plan", ...row })),
    ...data.blocks.map((row) => ({ type: "block", ...row })),
    ...data.focusSessions.map((row) => ({ type: "focus-session", ...row })),
  ]);
  const notificationsNdjson = toNdjson(
    data.notifications.map((row) => ({ type: "notification", ...row })),
  );
  // Bytes are not JSON: `snapshot` is destructured off before the row joins
  // the NDJSON (it travels instead as a `bytes` binary entry below, keyed by
  // the same id/coveredSeq the path encodes).
  const notesNdjson = toNdjson([
    ...noteFolders.map((row) => ({ type: "note-folder", ...row })),
    ...noteTags.map((row) => ({ type: "note-tag", ...row })),
    ...notes.map((row) => {
      const { snapshot: _snapshot, ...rest } = row;
      return { type: "note", ...rest };
    }),
    ...noteTagLinks.map((row) => ({ type: "note-tag-link", ...row })),
    ...noteAttachments.map((row) => ({ type: "note-attachment", ...row })),
    ...noteVersions.map((row) => {
      const { snapshot: _snapshot, ...rest } = row;
      return { type: "note-version", ...rest };
    }),
    ...noteTemplates.map((row) => ({ type: "note-template", ...row })),
  ]);

  // The background row first (the preferences lead the file, the
  // `study-settings` idiom), then the named boards, then the widgets whose
  // `setId` names them — dependency order for the widgets, and the one forward
  // reference (`activeSetId` on the settings row) is resolved by the reader's
  // reference pass, never by file order (see `ExportDashboardSet`).
  const dashboardNdjson = toNdjson([
    ...data.dashboardSettings.map((row) => ({ type: "dashboard-settings", ...row })),
    ...data.dashboardSets.map((row) => ({ type: "dashboard-set", ...row })),
    ...data.dashboardWidgets.map((row) => ({ type: "dashboard-widget", ...row })),
  ]);

  // Private notes (ADR-057 §6): notes first, then the versions that reference
  // them — the "everything a row points at came before it" reading every other
  // data file keeps. Absent input writes the empty file, exactly what a profile
  // with no private notes writes.
  const privateNotes = input.privateNotes ?? EMPTY_PRIVATE_NOTES;
  const privateNotesNdjson = toNdjson([
    ...privateNotes.notes.map((row) => ({ type: "private-note", ...row })),
    ...privateNotes.versions.map((row) => ({ type: "private-note-version", ...row })),
  ]);

  files.set("data/tasks.ndjson", tasksNdjson);
  files.set("data/calendar.ndjson", calendarNdjson);
  files.set("data/study.ndjson", studyNdjson);
  files.set("data/notifications.ndjson", notificationsNdjson);
  files.set("data/notes.ndjson", notesNdjson);
  files.set("data/dashboard.ndjson", dashboardNdjson);
  files.set("data/private-notes.ndjson", privateNotesNdjson);

  // --- Notes: Markdown mirror + binary entries (ADR-022 section 3) -------
  const binaries: ExportBinaryEntry[] = [];
  const notePaths = buildNotePaths(notes, noteFolders);
  const attachmentsByNote = groupAttachmentsByNote(noteAttachments);

  for (const note of notes) {
    const pathInfo = notePaths.get(note.id);
    if (!pathInfo) continue; // buildNotePaths assigns one entry per input note; defensive
    const context: NoteMarkdownContext = {
      attachments: attachmentsByNote.get(note.id) ?? EMPTY_NOTE_ATTACHMENTS,
      rootPrefix: pathInfo.rootPrefix,
    };
    files.set(pathInfo.path, note.snapshot !== null ? renderNoteMarkdown(note.snapshot, context) : "");
    if (note.snapshot !== null) {
      binaries.push({ kind: "bytes", path: `data/notes/${note.id}.ydoc`, bytes: note.snapshot });
    }
  }
  for (const version of noteVersions) {
    binaries.push({
      kind: "bytes",
      path: `data/note-versions/${version.noteId}/${version.coveredSeq}.ydoc`,
      bytes: version.snapshot,
    });
  }
  // Blobs are content-addressed and deduplicated: two attachment rows sharing
  // a hash declare ONE binary entry, not two — across notes, across tasks, and
  // across the two MODULES alike, because `blobs/` is one namespace over one
  // on-disk store (migration 024). A dashboard background (ADR-041) is a blob
  // like any other and joins the SAME union — a background the user also
  // attached to a note travels once, and either row alone is enough to carry
  // it. Notes lead only because they shipped first; the entry a hash lands
  // under is identical either way.
  const blobSizeBySha = new Map<string, number>();
  const declareBlob = (sha256: string, sizeBytes: number): void => {
    if (blobSizeBySha.has(sha256)) return;
    blobSizeBySha.set(sha256, sizeBytes);
    binaries.push({ kind: "attachment", path: `blobs/${sha256}`, sha256, sizeBytes });
  };
  for (const attachment of [
    ...noteAttachments,
    ...data.taskAttachments,
    ...data.subjectAttachments,
  ]) {
    declareBlob(attachment.sha256, attachment.sizeBytes);
  }
  for (const dashboard of data.dashboardSettings) {
    // Both non-null together (migration 030's CHECK, re-checked by the reader),
    // so one guard covers the pair without the other needing a non-null claim.
    if (dashboard.backgroundHash === null || dashboard.backgroundSizeBytes === null) continue;
    declareBlob(dashboard.backgroundHash, dashboard.backgroundSizeBytes);
  }
  // The profile's picture (SET-001), joining the same union — and deliberately
  // OUTSIDE the module filter above it, unlike every other blob here: this one
  // is named by the manifest rather than by a row, so it rides with the archive
  // itself exactly as `profile.name` and `settings` do. A tasks-only export
  // still carries the picture of the profile it is an export of.
  if (input.profile.picture !== null) {
    declareBlob(input.profile.picture.hash, input.profile.picture.sizeBytes);
  }

  // --- Private notes (ADR-057 §6): Markdown mirrors + decrypted blob entries.
  //
  // The mirror path is `notes-private/<id>.md` — the ID, never the title,
  // deliberately DIVERGING from public notes' titled `notes/**` paths: a zip's
  // entry listing is readable without the archive passphrase in some tools'
  // metadata views, and even inside the sealed container a title has no
  // business existing anywhere the note's content does not. Attachments have no
  // Markdown story at all (an empty context — no `blobs/` link could name a
  // private blob anyway), so an attachment image simply renders nothing.
  for (const note of privateNotes.notes) {
    const state = base64ToBytes(note.yjsState);
    files.set(
      `notes-private/${note.id}.md`,
      state.length > 0
        ? renderNoteMarkdown(state, { attachments: EMPTY_NOTE_ATTACHMENTS, rootPrefix: "../" })
        : "",
    );
  }
  // The decrypted attachment bytes, declared by the envelope's own random id —
  // their OWN `private-blobs/` namespace, never the content-addressed `blobs/`
  // union (no sha256 identity exists for them, by design). Deduplicated by id
  // across the live envelopes and every version that still references the same
  // attachment, so one file travels once however many envelopes name it.
  const privateBlobSizeById = new Map<string, number>();
  for (const row of [...privateNotes.notes, ...privateNotes.versions]) {
    for (const ref of row.attachments) {
      if (privateBlobSizeById.has(ref.id)) continue;
      privateBlobSizeById.set(ref.id, ref.sizeBytes);
      binaries.push({
        kind: "private-blob",
        path: `private-blobs/${ref.id}`,
        id: ref.id,
        sizeBytes: ref.sizeBytes,
      });
    }
  }
  // Id-sorted for the reason the blob list is sha-sorted: the manifest must
  // read identically regardless of which envelope happened to name an
  // attachment first.
  const privateBlobs = [...privateBlobSizeById.entries()]
    .map(([id, sizeBytes]) => ({ id, sizeBytes }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // The calendar as a standards-honest `.ics` beside the lossless NDJSON
  // (IMEX-001's "ICS for calendar" clause, CAL-008). A convenience copy for
  // whatever else the user keeps a calendar in — a restore reads the NDJSON and
  // ignores this file entirely (see `SCHEMA_VERSION`'s note). Stamped with the
  // archive's own `createdAt`, so it reads no clock either and two exports of
  // the same profile at the same moment are byte-identical.
  //
  // ABSENT when the calendar is not among the chosen modules (IMEX-003), unlike
  // the NDJSON files, which are always written: an empty `data/calendar.ndjson`
  // is what a profile with no events produces and the format expects, while an
  // empty `VCALENDAR` is a file the user would open in their other calendar and
  // find nothing in — a promise of a calendar they did not ask us to export.
  if (modules.has("calendar")) {
    files.set("data/calendar.ics", buildIcsCalendar(data.events, { now: input.createdAt }).text);
  }

  files.set("tables/tasks.csv", tasksCsv(data.tasks));
  files.set("tables/events.csv", eventsCsv(data.events));
  files.set("tables/documents.csv", documentsCsv(data.documents));
  files.set("tables/subjects.csv", subjectsCsv(data.subjects));
  files.set("tables/exams.csv", examsCsv(data.exams));
  files.set("tables/cards.csv", cardsCsv(data.cards));
  files.set("tables/study-plans.csv", plansCsv(data.plans));
  files.set("tables/study-blocks.csv", blocksCsv(data.blocks));
  files.set("tables/focus-sessions.csv", focusSessionsCsv(data.focusSessions));

  const byModule = countProfileModules(data);
  const totalRecords = Object.values(byModule).reduce((sum, count) => sum + count, 0);

  const checksums: Record<string, string> = {};
  for (const path of DATA_FILES) {
    checksums[path] = input.hash(files.get(path) ?? "");
  }

  // Sha256-sorted so the manifest reads identically regardless of which note
  // happened to reference a given blob first.
  const blobs = [...blobSizeBySha.entries()]
    .map(([sha256, sizeBytes]) => ({ sha256, sizeBytes }))
    .sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: input.appVersion,
    createdAt: input.createdAt,
    profile: input.profile,
    settings: input.settings,
    modules: ARCHIVE_MODULE_IDS.map((id) => ({ id, records: byModule[id] })),
    checksums,
    blobs,
    // The private attachments' inventory (ADR-057 §6), beside the blob list it
    // mirrors — always written, empty whenever no private notes ride.
    privateBlobs,
  };
  files.set("manifest.json", JSON.stringify(manifest, null, 2));

  return { files, totalRecords, byModule, binaries };
}

// --- Notes: path resolution ------------------------------------------------

/** One note's resolved Markdown mirror path plus the `rootPrefix` its image links need. */
interface NotePathInfo {
  path: string;
  rootPrefix: string;
}

const EMPTY_NOTE_ATTACHMENTS: ReadonlyMap<string, NoteMarkdownAttachment> = new Map();

/**
 * Resolves every note's Markdown mirror path (ADR-022 section 3). Folder
 * segments are claimed first, in `folders`' own input order, then note file
 * names in `notes`' own input order — this makes the archive deterministic:
 * the same input always claims the same names in the same order. Each
 * directory's name registry (via `claimUniqueName`) is shared between its
 * subfolders and its `.md` files, so a folder named "Plan" and a note titled
 * "Plan" in the same parent cannot both become `Plan`.
 *
 * A note whose `folderId` is null, or points at a folder absent from
 * `folders`, lands directly under `notes/`. A folder's own `parentId` chain
 * is resolved (and memoized) recursively; a cycle — never produced by
 * `NoteOrgStore`, but defensive here — is broken by treating the re-entrant
 * folder as a root folder rather than recursing forever.
 */
function buildNotePaths(
  notes: readonly ExportNote[],
  folders: readonly ExportNoteFolder[],
): Map<string, NotePathInfo> {
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const registries = new Map<string, Set<string>>();
  const folderDirs = new Map<string, string>();
  const resolving = new Set<string>();

  function registryFor(dir: string): Set<string> {
    let registry = registries.get(dir);
    if (registry === undefined) {
      registry = new Set<string>();
      registries.set(dir, registry);
    }
    return registry;
  }

  function resolveFolderDir(folderId: string): string {
    const cached = folderDirs.get(folderId);
    if (cached !== undefined) return cached;

    const folder = folderById.get(folderId);
    if (folder === undefined || resolving.has(folderId)) return "notes";

    resolving.add(folderId);
    const parentDir = folder.parentId !== null ? resolveFolderDir(folder.parentId) : "notes";
    const name = claimUniqueName(registryFor(parentDir), sanitizePathSegment(folder.name, "Fascikla"), "");
    const dir = `${parentDir}/${name}`;
    resolving.delete(folderId);

    folderDirs.set(folderId, dir);
    return dir;
  }

  for (const folder of folders) resolveFolderDir(folder.id);

  const notePaths = new Map<string, NotePathInfo>();
  for (const note of notes) {
    const dir =
      note.folderId !== null && folderById.has(note.folderId)
        ? resolveFolderDir(note.folderId)
        : "notes";
    const fileName = claimUniqueName(
      registryFor(dir),
      sanitizePathSegment(note.title, UNTITLED_NOTE_NAME),
      ".md",
    );
    const path = `${dir}/${fileName}`;
    const depth = path.split("/").length - 1; // directory segments only, not the file name
    notePaths.set(note.id, { path, rootPrefix: "../".repeat(depth) });
  }
  return notePaths;
}

/** Attachment rows grouped by their note, in the shape `renderNoteMarkdown`'s context wants. */
function groupAttachmentsByNote(
  attachments: readonly ExportNoteAttachment[],
): Map<string, Map<string, NoteMarkdownAttachment>> {
  const byNote = new Map<string, Map<string, NoteMarkdownAttachment>>();
  for (const attachment of attachments) {
    let forNote = byNote.get(attachment.noteId);
    if (forNote === undefined) {
      forNote = new Map<string, NoteMarkdownAttachment>();
      byNote.set(attachment.noteId, forNote);
    }
    forNote.set(attachment.id, { fileName: attachment.fileName, sha256: attachment.sha256 });
  }
  return byNote;
}

/** One JSON object per line, `\n`-joined with a trailing newline; zero rows renders as the empty string (predictable "empty module" shape). */
function toNdjson(records: ReadonlyArray<Record<string, unknown>>): string {
  if (records.length === 0) return "";
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function tasksCsv(rows: readonly ExportTask[]): string {
  return toCsv(
    ["id", "parentId", "title", "description", "status", "priority", "dueDate", "startDate", "completedAt", "createdAt", "updatedAt"],
    rows.map((row) => [
      row.id, row.parentId, row.title, row.description, row.status, row.priority,
      row.dueDate, row.startDate, row.completedAt, row.createdAt, row.updatedAt,
    ]),
  );
}

function eventsCsv(rows: readonly ExportEvent[]): string {
  return toCsv(
    ["id", "title", "description", "startAt", "endAt", "allDay", "location", "category", "createdAt", "updatedAt"],
    rows.map((row) => [
      row.id, row.title, row.description, row.startAt, row.endAt, row.allDay,
      row.location, row.category, row.createdAt, row.updatedAt,
    ]),
  );
}

function documentsCsv(rows: readonly ExportDocument[]): string {
  return toCsv(
    ["id", "docType", "label", "expiryDate", "reminderOffsets", "notes", "createdAt", "updatedAt"],
    rows.map((row) => [
      row.id, row.docType, row.label, row.expiryDate, row.reminderOffsets.join(";"),
      row.notes, row.createdAt, row.updatedAt,
    ]),
  );
}

function subjectsCsv(rows: readonly ExportSubject[]): string {
  return toCsv(
    ["id", "name", "color", "semester", "archived", "createdAt", "updatedAt"],
    rows.map((row) => [row.id, row.name, row.color, row.semester, row.archived, row.createdAt, row.updatedAt]),
  );
}

function examsCsv(rows: readonly ExportExam[]): string {
  return toCsv(
    ["id", "subjectId", "examType", "examDate", "scope", "createdAt", "updatedAt"],
    rows.map((row) => [row.id, row.subjectId, row.examType, row.examDate, row.scope, row.createdAt, row.updatedAt]),
  );
}

/** Front/back + state columns only — no FSRS internals (stability/difficulty/etc); the NDJSON keeps everything (ADR-009). */
function cardsCsv(rows: readonly ExportCard[]): string {
  return toCsv(
    ["id", "deckId", "front", "back", "state", "due", "createdAt", "updatedAt"],
    rows.map((row) => [row.id, row.deckId, row.front, row.back, row.state, row.due, row.createdAt, row.updatedAt]),
  );
}

function plansCsv(rows: readonly ExportStudyPlan[]): string {
  return toCsv(
    ["id", "examId", "dailyMinutes", "startDate", "examWeekBoost", "createdAt", "updatedAt"],
    rows.map((row) => [row.id, row.examId, row.dailyMinutes, row.startDate, row.examWeekBoost, row.createdAt, row.updatedAt]),
  );
}

function blocksCsv(rows: readonly ExportStudyBlock[]): string {
  return toCsv(
    ["id", "planId", "blockDate", "minutes", "status", "createdAt", "updatedAt"],
    rows.map((row) => [row.id, row.planId, row.blockDate, row.minutes, row.status, row.createdAt, row.updatedAt]),
  );
}

function focusSessionsCsv(rows: readonly ExportFocusSession[]): string {
  return toCsv(
    ["id", "subjectId", "startedAt", "endedAt", "createdAt", "updatedAt"],
    rows.map((row) => [row.id, row.subjectId, row.startedAt, row.endedAt, row.createdAt, row.updatedAt]),
  );
}
