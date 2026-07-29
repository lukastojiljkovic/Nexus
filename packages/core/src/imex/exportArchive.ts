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
 * IMEX-004: the archive's own semver. `1.2.0` adds `reminderOffsets` to the
 * `task` record (ADR-028) — a new field, so a MINOR bump by the same honesty
 * that made `1.1.0` (the `person` record type, CAL-007 / ADR-026) one: an
 * archive this build writes is refused by a 1.1 reader, which would otherwise
 * parse every task and silently drop the reminder ladder the user set. Kept in
 * step with
 * `INTERCHANGE_SCHEMA_VERSION` (`importArchive.ts`) — two constants rather than
 * one import, since the reader already imports from this module and the cycle
 * would be worse than the duplication; `importArchive.test.ts` pins them equal.
 */
const SCHEMA_VERSION = "1.2.0";

// --- Row shapes (the interchange contract; see file header) -----------------

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

/** The five checksummed NDJSON files, in manifest order. Exported so `importArchive.ts` verifies checksums against exactly the list this module produces them from — never a second, hand-copied literal that could drift. */
export const DATA_FILES = [
  "data/tasks.ndjson",
  "data/calendar.ndjson",
  "data/study.ndjson",
  "data/notifications.ndjson",
  "data/notes.ndjson",
] as const;

/** The manifest's five module ids, in manifest order — the grouping `countProfileModules` counts by and `buildExportArchive` builds `manifest.modules` from, so the two can never disagree. */
export const ARCHIVE_MODULE_IDS = ["tasks", "calendar", "study", "notifications", "notes"] as const;
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
    tasks: data.tasks.length,
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
  };
}

/** Builds the full `.nexus.zip` contents in memory (IMEX-001). Deterministic: identical input always yields identical file content and checksums. */
export function buildExportArchive(input: ExportArchiveInput): ExportArchive {
  const files = new Map<string, string>();

  // Read once and named locally — the note section below reaches for these
  // often enough that `input.data.` on every line only adds noise.
  const { notes, noteFolders, noteTags, noteTagLinks, noteTemplates, noteAttachments, noteVersions } =
    input.data;

  const tasksNdjson = toNdjson(input.data.tasks.map((row) => ({ type: "task", ...row })));
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

  files.set("data/tasks.ndjson", tasksNdjson);
  files.set("data/calendar.ndjson", calendarNdjson);
  files.set("data/study.ndjson", studyNdjson);
  files.set("data/notifications.ndjson", notificationsNdjson);
  files.set("data/notes.ndjson", notesNdjson);

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
  // Blobs are content-addressed and deduplicated: two attachment rows
  // sharing a hash (even across notes) declare ONE binary entry, not two.
  const blobSizeBySha = new Map<string, number>();
  for (const attachment of noteAttachments) {
    if (blobSizeBySha.has(attachment.sha256)) continue;
    blobSizeBySha.set(attachment.sha256, attachment.sizeBytes);
    binaries.push({
      kind: "attachment",
      path: `blobs/${attachment.sha256}`,
      sha256: attachment.sha256,
      sizeBytes: attachment.sizeBytes,
    });
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
