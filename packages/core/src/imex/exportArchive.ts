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
 */

import type { RecurrenceRule } from "../recurrence/recurrence.js";
import { claimUniqueName, sanitizePathSegment, UNTITLED_NOTE_NAME } from "./archivePaths.js";
import { toCsv } from "./csv.js";
import { renderNoteMarkdown } from "./noteMarkdown.js";
import type { NoteMarkdownAttachment, NoteMarkdownContext } from "./noteMarkdown.js";

/**
 * IMEX-004: the archive's own semver. `1.12.0` adds a card's `problemSteps` —
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
 * otherwise parse every problem card and restore it as a plain front/back card
 * whose steps — the only text its owner can edit, and the thing the reviewer
 * reveals one at a time — are gone; the same honesty `1.11.0` owed the
 * arranged dashboard and `1.10.0` owed every cloze template. Kept in step
 * with `INTERCHANGE_SCHEMA_VERSION` (`importArchive.ts`) — two constants
 * rather than one import, since the reader already imports from this module
 * and the cycle would be worse than the duplication; `importArchive.test.ts`
 * pins them equal.
 *
 * SUPERVISOR NOTE: `1.11.0` belongs to the sibling lane (dashboard layout) and
 * is not in this worktree; this lane writes `1.12.0` directly, leaving the gap
 * for the supervisor to reconcile at merge.
 */
const SCHEMA_VERSION = "1.12.0";

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
}

/** Everything the manifest's "settings" section carries (founder decision #11: flags + NTF settings ship with the export). */
export interface ExportSettings {
  flags: Record<string, boolean>;
  notifications: {
    quietFrom: string | null;
    quietTo: string | null;
    morningHour: string;
    enabledSources: readonly string[];
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
  documents: readonly ExportDocument[];
  renewals: readonly ExportRenewal[];
  people: readonly ExportPerson[];
  subjects: readonly ExportSubject[];
  exams: readonly ExportExam[];
  decks: readonly ExportDeck[];
  cards: readonly ExportCard[];
  reviewLog: readonly ExportReviewLogEntry[];
  plans: readonly ExportStudyPlan[];
  blocks: readonly ExportStudyBlock[];
  focusSessions: readonly ExportFocusSession[];
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
   * The profile's dashboard layout (DASH-002 / ADR-045) — one row per placed
   * widget, in position order. Required, like every field above and for the same
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

export interface ExportArchiveInput {
  profile: { id: string; name: string };
  /** `app.getVersion()` — stamped by the caller, never read from here. */
  appVersion: string;
  /** ISO-8601, stamped by the caller — this module never reads a clock. */
  createdAt: string;
  settings: ExportSettings;
  data: ProfileData;
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
  | { kind: "attachment"; path: string; sha256: string; sizeBytes: number };

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
    calendar:
      data.events.length + data.documents.length + data.renewals.length + data.people.length,
    study:
      data.subjects.length +
      data.exams.length +
      data.decks.length +
      data.cards.length +
      data.reviewLog.length +
      data.plans.length +
      data.blocks.length +
      data.focusSessions.length,
    notifications: data.notifications.length,
    notes:
      data.notes.length +
      data.noteFolders.length +
      data.noteTags.length +
      data.noteTagLinks.length +
      data.noteTemplates.length +
      data.noteAttachments.length +
      data.noteVersions.length,
    // The background row (zero or one) plus every placed widget, counted like
    // any other rows rather than folded into a neighbouring module: a restore
    // preview that showed "Kontrolna tabla: 6" against "0" is telling the user
    // something true about what is about to change, which is the entire job of
    // that table.
    dashboard: data.dashboardSettings.length + data.dashboardWidgets.length,
  };
}

/** Builds the full `.nexus.zip` contents in memory (IMEX-001). Deterministic: identical input always yields identical file content and checksums. */
export function buildExportArchive(input: ExportArchiveInput): ExportArchive {
  const files = new Map<string, string>();

  // Read once and named locally — the note section below reaches for these
  // often enough that `input.data.` on every line only adds noise.
  const { notes, noteFolders, noteTags, noteTagLinks, noteTemplates, noteAttachments, noteVersions } =
    input.data;

  // Dependency order, as in `data/notes.ndjson`: the containers and labels a
  // task points at come first and the joins that need BOTH ends come last, so
  // a reader that streamed the file could resolve every reference as it went.
  const tasksNdjson = toNdjson([
    ...input.data.taskLists.map((row) => ({ type: "task-list", ...row })),
    ...input.data.taskSections.map((row) => ({ type: "task-section", ...row })),
    ...input.data.taskTags.map((row) => ({ type: "task-tag", ...row })),
    ...input.data.tasks.map((row) => ({ type: "task", ...row })),
    ...input.data.taskTagLinks.map((row) => ({ type: "task-tag-link", ...row })),
    ...input.data.taskAttachments.map((row) => ({ type: "task-attachment", ...row })),
    // Last: a template points at no row in this file (its tags are NAMES), so it
    // constrains nothing and sits after the join that needed both its ends.
    ...input.data.taskTemplates.map((row) => ({ type: "task-template", ...row })),
    ...input.data.taskDependencies.map((row) => ({ type: "task-dependency", ...row })),
  ]);
  const calendarNdjson = toNdjson([
    ...input.data.events.map((row) => ({ type: "event", ...row })),
    ...input.data.documents.map((row) => ({ type: "document", ...row })),
    ...input.data.renewals.map((row) => ({ type: "renewal", ...row })),
    ...input.data.people.map((row) => ({ type: "person", ...row })),
  ]);
  const studyNdjson = toNdjson([
    ...input.data.subjects.map((row) => ({ type: "subject", ...row })),
    ...input.data.exams.map((row) => ({ type: "exam", ...row })),
    ...input.data.decks.map((row) => ({ type: "deck", ...row })),
    ...input.data.cards.map((row) => ({ type: "card", ...row })),
    ...input.data.reviewLog.map((row) => ({ type: "review", ...row })),
    ...input.data.plans.map((row) => ({ type: "plan", ...row })),
    ...input.data.blocks.map((row) => ({ type: "block", ...row })),
    ...input.data.focusSessions.map((row) => ({ type: "focus-session", ...row })),
  ]);
  const notificationsNdjson = toNdjson(
    input.data.notifications.map((row) => ({ type: "notification", ...row })),
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

  // The background row first and the layout after it, in the order the two
  // shipped. Neither references the other — a dashboard with no picture still
  // has its widgets, and a widget names no settings row — so the order here is
  // readability, not a dependency.
  const dashboardNdjson = toNdjson([
    ...input.data.dashboardSettings.map((row) => ({ type: "dashboard-settings", ...row })),
    ...input.data.dashboardWidgets.map((row) => ({ type: "dashboard-widget", ...row })),
  ]);

  files.set("data/tasks.ndjson", tasksNdjson);
  files.set("data/calendar.ndjson", calendarNdjson);
  files.set("data/study.ndjson", studyNdjson);
  files.set("data/notifications.ndjson", notificationsNdjson);
  files.set("data/notes.ndjson", notesNdjson);
  files.set("data/dashboard.ndjson", dashboardNdjson);

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
  for (const attachment of [...noteAttachments, ...input.data.taskAttachments]) {
    declareBlob(attachment.sha256, attachment.sizeBytes);
  }
  for (const dashboard of input.data.dashboardSettings) {
    // Both non-null together (migration 030's CHECK, re-checked by the reader),
    // so one guard covers the pair without the other needing a non-null claim.
    if (dashboard.backgroundHash === null || dashboard.backgroundSizeBytes === null) continue;
    declareBlob(dashboard.backgroundHash, dashboard.backgroundSizeBytes);
  }

  files.set("tables/tasks.csv", tasksCsv(input.data.tasks));
  files.set("tables/events.csv", eventsCsv(input.data.events));
  files.set("tables/documents.csv", documentsCsv(input.data.documents));
  files.set("tables/subjects.csv", subjectsCsv(input.data.subjects));
  files.set("tables/exams.csv", examsCsv(input.data.exams));
  files.set("tables/cards.csv", cardsCsv(input.data.cards));
  files.set("tables/study-plans.csv", plansCsv(input.data.plans));
  files.set("tables/study-blocks.csv", blocksCsv(input.data.blocks));
  files.set("tables/focus-sessions.csv", focusSessionsCsv(input.data.focusSessions));

  const byModule = countProfileModules(input.data);
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
