import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { autoUpdater } from "electron-updater";
import type { NotificationSource } from "@nexus/core";
import {
  CARD_RATINGS,
  CardStore,
  DeckStore,
  DOCUMENT_TYPES,
  DocumentStore,
  EventStore,
  EXAM_TYPES,
  ExamStore,
  FocusStore,
  NotificationStore,
  openDatabase,
  PlanStore,
  SqliteFlagStore,
  StatsStore,
  STUDY_BLOCK_STATUSES,
  SUBJECT_COLORS,
  SubjectStore,
  TaskStore,
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
  type CreatePlanInput,
  type CreateSubjectInput,
  type CreateTaskInput,
  type Deck,
  type DeckCounts,
  type DocumentRenewal,
  type DocumentType,
  type Event,
  type Exam,
  type ExamType,
  type FocusSession,
  type NexusDatabase,
  type NotificationRecord,
  type NotificationSettings,
  type PreviewIntervals,
  type StudyBlock,
  type StudyBlockStatus,
  type StudyBlockWithExam,
  type StudyPlan,
  type Subject,
  type SubjectColor,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type TrackedDocument,
  type UpdateCardFields,
  type UpdateDeckFields,
  type UpdateDocumentFields,
  type UpdateEventFields,
  type UpdateExamFields,
  type UpdateNotificationSettingsInput,
  type UpdatePlanFields,
  type UpdateSubjectFields,
  type UpdateTaskFields,
} from "@nexus/db";
import { localToday } from "./clock.js";
import { handleExport } from "./imex.js";
import { startNotificationScheduler, stopNotificationScheduler } from "./notifications.js";
import {
  IpcChannel,
  type AppInfo,
  type ExportResult,
  type FlagState,
  type Profile,
  type RunningFocusSession,
  type SnoozePreset,
  type StudyStats,
} from "../shared/ipc.js";

const isSmoke = process.argv.includes("--smoke");

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
 */
function seedFirstRunProfile(database: NexusDatabase): void {
  const { count } = database.raw
    .prepare("SELECT count(*) AS count FROM profiles")
    .get() as { count: number };
  if (count > 0) return;
  database.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(uuidv7(), "personal", "", new Date().toISOString());
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
  return input;
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
  return patch;
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
 * The three NTF source kinds (mirrors `@nexus/core`'s `NotificationSource`).
 * Not re-exported from `@nexus/db`, so the closed set is declared here, the
 * same division of labour as every other closed-enum validator in this file.
 */
const NOTIFICATION_SOURCES: readonly NotificationSource[] = ["document", "exam", "study-day"];

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
  if (!db) throw new Error("Database is not open.");
  return db;
}

function taskStore(profileId: string): TaskStore {
  return new TaskStore(requireDb().raw, profileId);
}

function eventStore(profileId: string): EventStore {
  return new EventStore(requireDb().raw, profileId);
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

function flagStore(profileId: string): SqliteFlagStore {
  return new SqliteFlagStore(requireDb().raw, profileId);
}

function registerIpc(): void {
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

  // IMEX slice a1 (PRD 14 IMEX-001): gathers this profile's data and streams a
  // `.nexus.zip` to a path the native save dialog returns — never a path the
  // renderer supplies (SEC-EL).
  ipcMain.handle(IpcChannel.imexExport, (event, payload): Promise<ExportResult> => {
    assertTrustedSender(event);
    const profileId = asNonEmptyString(asRecord(payload).profileId, "profileId");
    const profile = requireProfile(requireDb(), profileId);
    return handleExport(
      {
        taskStore,
        eventStore,
        documentStore,
        subjectStore,
        examStore,
        deckStore,
        cardStore,
        planStore,
        focusStore,
        notificationStore,
        flagStore,
        getMainWindow: () => mainWindow,
      },
      profile,
    );
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

app.whenReady().then(() => {
  try {
    // ADR-001 / SEC-EL: the database lives ONLY in the main process; the renderer
    // reaches it exclusively through the typed IPC allowlist above.
    // ADR-004: PIN/keystore-derived key derivation is not built yet, so the file
    // is opened WITHOUT an encryptionKey. This is the honest current state, not a
    // placeholder — encryption at rest (SEC-DAR-01) lands with ADR-004.
    db = openDatabase({ path: databasePath() });
    seedFirstRunProfile(db);
    registerIpc();
    mainWindow = createWindow();

    // Never in dev, never during the smoke run — only a real packaged install.
    if (app.isPackaged && !isSmoke) checkForUpdates();

    // NTF piece a2: the periodic reminder check. Never during the smoke run —
    // a scheduled check firing an OS notification mid-smoke would make the
    // deterministic exit flaky and is pointless noise for a CI run anyway.
    if (!isSmoke) {
      startNotificationScheduler({
        listProfiles: () => listProfiles(requireDb()),
        documentStore,
        examStore,
        subjectStore,
        planStore,
        notificationStore,
        getMainWindow: () => mainWindow,
      });
    }

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
  try {
    db?.close();
  } catch {
    // ignore
  }
});
