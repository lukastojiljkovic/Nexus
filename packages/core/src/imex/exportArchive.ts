/**
 * Pure builder for the IMEX full-export archive (PRD 14 IMEX-001, ADR-009's
 * container layout). Takes plain data arrays plus everything time/version-ish
 * the caller already knows (`createdAt`, `appVersion`, a `hash` function) and
 * returns the archive's files as an in-memory map — no clock reads, no file
 * IO, no `node:` imports. `apps/desktop`'s main process is the only caller: it
 * gathers rows from `@nexus/db`'s stores, stamps `createdAt`/`appVersion`,
 * injects a real sha256 `hash`, and streams the returned files into a
 * `.nexus.zip` with `yazl`.
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

import { toCsv } from "./csv.js";

/** IMEX-004: the archive's own semver — the first public interchange version. */
const SCHEMA_VERSION = "1.0.0";

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

export interface ExportArchiveInput {
  profile: { id: string; name: string };
  /** `app.getVersion()` — stamped by the caller, never read from here. */
  appVersion: string;
  /** ISO-8601, stamped by the caller — this module never reads a clock. */
  createdAt: string;
  settings: ExportSettings;
  data: {
    tasks: readonly ExportTask[];
    events: readonly ExportEvent[];
    documents: readonly ExportDocument[];
    renewals: readonly ExportRenewal[];
    subjects: readonly ExportSubject[];
    exams: readonly ExportExam[];
    decks: readonly ExportDeck[];
    cards: readonly ExportCard[];
    reviewLog: readonly ExportReviewLogEntry[];
    plans: readonly ExportStudyPlan[];
    blocks: readonly ExportStudyBlock[];
    focusSessions: readonly ExportFocusSession[];
    notifications: readonly ExportNotification[];
  };
  /** sha256 hex over a UTF-8 string, injected so this module never imports `node:crypto`. */
  hash: (content: string) => string;
}

/** The built archive: every file's exact content, plus the counts the manifest itself also carries (for the caller's own reporting, e.g. the Settings page's confirmation line). */
export interface ExportArchive {
  files: Map<string, string>;
  totalRecords: number;
  byModule: Record<string, number>;
}

const DATA_FILES = [
  "data/tasks.ndjson",
  "data/calendar.ndjson",
  "data/study.ndjson",
  "data/notifications.ndjson",
] as const;

/** Builds the full `.nexus.zip` contents in memory (IMEX-001). Deterministic: identical input always yields identical file content and checksums. */
export function buildExportArchive(input: ExportArchiveInput): ExportArchive {
  const files = new Map<string, string>();

  const tasksNdjson = toNdjson(input.data.tasks.map((row) => ({ type: "task", ...row })));
  const calendarNdjson = toNdjson([
    ...input.data.events.map((row) => ({ type: "event", ...row })),
    ...input.data.documents.map((row) => ({ type: "document", ...row })),
    ...input.data.renewals.map((row) => ({ type: "renewal", ...row })),
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

  files.set("data/tasks.ndjson", tasksNdjson);
  files.set("data/calendar.ndjson", calendarNdjson);
  files.set("data/study.ndjson", studyNdjson);
  files.set("data/notifications.ndjson", notificationsNdjson);

  files.set("tables/tasks.csv", tasksCsv(input.data.tasks));
  files.set("tables/events.csv", eventsCsv(input.data.events));
  files.set("tables/documents.csv", documentsCsv(input.data.documents));
  files.set("tables/subjects.csv", subjectsCsv(input.data.subjects));
  files.set("tables/exams.csv", examsCsv(input.data.exams));
  files.set("tables/cards.csv", cardsCsv(input.data.cards));
  files.set("tables/study-plans.csv", plansCsv(input.data.plans));
  files.set("tables/study-blocks.csv", blocksCsv(input.data.blocks));
  files.set("tables/focus-sessions.csv", focusSessionsCsv(input.data.focusSessions));

  const byModule: Record<string, number> = {
    tasks: input.data.tasks.length,
    calendar: input.data.events.length + input.data.documents.length + input.data.renewals.length,
    study:
      input.data.subjects.length +
      input.data.exams.length +
      input.data.decks.length +
      input.data.cards.length +
      input.data.reviewLog.length +
      input.data.plans.length +
      input.data.blocks.length +
      input.data.focusSessions.length,
    notifications: input.data.notifications.length,
  };
  const totalRecords = Object.values(byModule).reduce((sum, count) => sum + count, 0);

  const checksums: Record<string, string> = {};
  for (const path of DATA_FILES) {
    checksums[path] = input.hash(files.get(path) ?? "");
  }

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    appVersion: input.appVersion,
    createdAt: input.createdAt,
    profile: input.profile,
    settings: input.settings,
    modules: [
      { id: "tasks", records: byModule.tasks },
      { id: "calendar", records: byModule.calendar },
      { id: "study", records: byModule.study },
      { id: "notifications", records: byModule.notifications },
    ],
    checksums,
  };
  files.set("manifest.json", JSON.stringify(manifest, null, 2));

  return { files, totalRecords, byModule };
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
