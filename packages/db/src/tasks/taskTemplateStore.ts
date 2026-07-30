import type Database from "better-sqlite3-multiple-ciphers";
import { validateRecurrenceRule } from "@nexus/core";
import type { RecurrenceRule } from "@nexus/core";
import { TaskTemplateNotFoundError, TaskTemplateValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { MAX_TASK_REMINDERS, MAX_TASK_REMINDER_DAYS, TASK_PRIORITIES } from "./taskStore.js";
import type { TaskPriority } from "./taskStore.js";
import { MAX_TASK_TAG_NAME_LENGTH } from "./taskTagStore.js";

type DatabaseHandle = Database.Database;

/**
 * The task-shaped body a template carries (ADR-035 / TASK-010) — everything
 * `apply` needs to build a task, and deliberately nothing else. It is stored as
 * JSON in one column (migration 027) and validated field for field on the way
 * in AND on the way out, since a JSON column has no CHECK to lean on.
 *
 * Two fields are relative rather than absolute, and that is the whole point of
 * the shape:
 *
 *  - `dueOffsetDays` counts days forward from the day the template is APPLIED,
 *    never a stored calendar date, which would rot the day after it was saved.
 *  - `tagNames` are names, not `task_tags` ids: a template outlives the tag rows
 *    it was captured from (migration 023's tags hard-delete), and apply
 *    re-resolves each name through `TaskTagStore`'s get-or-create.
 */
export interface TaskTemplatePayload {
  /** The created task's title. `TaskStore`'s own rule: trimmed, non-empty. */
  title: string;
  /** Trimmed to null when blank — `TaskStore.create`'s `normalizeOptional`, mirrored. */
  description: string | null;
  priority: TaskPriority;
  /**
   * Whole days from the apply date to the created task's due date, or null for
   * a task with no due date at all. `0` means "due today", which is a real due
   * date — the anchor a rule phases from and a ladder counts back from.
   */
  dueOffsetDays: number | null;
  /** Whole days before the computed due date, ascending. Requires `dueOffsetDays`. */
  reminderOffsets: number[];
  /** The rule the created task advances by, or null. Requires `dueOffsetDays`. */
  recurrence: RecurrenceRule | null;
  /** Tag names to get-or-create and attach at apply time; unique after trimming. */
  tagNames: string[];
  /** Titles of the DIRECT subtasks to create under the new task. Order is kept; duplicates are legal. */
  subtaskTitles: string[];
}

/** A task template as the store returns it (ADR-035 / TASK-010). */
export interface TaskTemplate {
  id: string;
  profileId: string;
  name: string;
  payload: TaskTemplatePayload;
  createdAt: string;
  updatedAt: string;
}

interface TaskTemplateRow {
  id: string;
  profile_id: string;
  name: string;
  payload: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, profile_id, name, payload, created_at, updated_at";

/**
 * Longest template name after trimming. Shorter than a note template's 100
 * because a task template is picked from a popover list rather than a pane, and
 * a name that wraps there stops being scannable. Exported (and re-exported from
 * the package barrel) so the IPC validator that guards this store bounds the
 * wire by the very same number.
 */
export const MAX_TASK_TEMPLATE_NAME_LENGTH = 80;

/**
 * The furthest ahead a template may place its task's due date — a year, matching
 * `MAX_TASK_REMINDER_DAYS`, so the offset and the ladder that counts back
 * through it live on the same scale.
 */
export const MAX_TASK_TEMPLATE_DUE_OFFSET_DAYS = 365;

/** How many tags one template may carry. */
export const MAX_TASK_TEMPLATE_TAGS = 20;

/** How many direct subtasks one template may carry. */
export const MAX_TASK_TEMPLATE_SUBTASKS = 30;

/** Accepts a full ISO-8601 date-time (the `now` every mutating method takes) — mirrors taskStore.ts / noteTemplateStore.ts. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Persistence for the TASK module's user-defined templates (ADR-035 /
 * TASK-010). `NoteTemplateStore`'s arrangement applied to tasks: construct one
 * per profile, reuse it, over prepared, parameterized statements (SEC-API-03 —
 * every value bound, never interpolated), every statement scoped by
 * `profile_id`. Inputs are revalidated here because the renderer is untrusted
 * (SEC-EL-02).
 *
 * `saveByName` is an upsert on `(profile_id, name)` — migration 027's UNIQUE
 * index — because naming IS the edit mechanism, exactly as it is for note
 * templates: a user changes a template by applying it, adjusting the task, and
 * saving it again under the same name. The select-then-write runs inside one
 * `db.transaction(...)` so a concurrent save under the same name can never slip
 * between the lookup and the write.
 *
 * Unlike `NoteTemplateStore` there is no `rename`, and therefore no
 * self-excluding collision statement: a task template is captured FROM a task,
 * so "rename" and "save again under the new name" are the same act, and the
 * second one is already here.
 *
 * The payload is validated by ONE function used by both directions
 * (`validatePayload`), which is what keeps a write and a read from ever
 * disagreeing about what a template is. On the way out a payload that fails is
 * corruption — a hand-edited file, a bad restore — and throws naming the row,
 * for the reason `TaskStore.parseStoredRecurrence` gives: reading it leniently
 * would silently hand the user a template that is not the one they saved.
 */
export class TaskTemplateStore {
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByName: Database.Statement;
  private readonly insert: Database.Statement;
  private readonly updatePayload: Database.Statement;
  private readonly deleteRow: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectAll = db.prepare(
      `SELECT ${COLUMNS} FROM task_templates WHERE profile_id = ? ORDER BY name`,
    );
    this.selectById = db.prepare(
      `SELECT ${COLUMNS} FROM task_templates WHERE id = ? AND profile_id = ?`,
    );
    this.selectByName = db.prepare(
      `SELECT ${COLUMNS} FROM task_templates WHERE profile_id = ? AND name = ?`,
    );
    this.insert = db.prepare(
      `INSERT INTO task_templates (id, profile_id, name, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.updatePayload = db.prepare(
      `UPDATE task_templates SET payload = ?, updated_at = ? WHERE id = ? AND profile_id = ?`,
    );
    this.deleteRow = db.prepare(`DELETE FROM task_templates WHERE id = ? AND profile_id = ?`);
  }

  /**
   * This profile's templates, alphabetical by `name` — SQLite's default binary
   * collation, which does not tailor Serbian Latin script correctly; the
   * renderer re-sorts with `Intl.Collator(["sr-Latn","sr"])`, the house pattern
   * `NoteTemplateStore.list` and every other alphabetical list already follow.
   */
  list(): TaskTemplate[] {
    const rows = this.selectAll.all(this.profileId) as TaskTemplateRow[];
    return rows.map((row) => toTaskTemplate(row));
  }

  /** Reads one template of this profile, or throws — the gate every reference by id goes through. */
  get(id: string): TaskTemplate {
    return toTaskTemplate(this.requireTemplate(id));
  }

  /**
   * Upserts on `(profile_id, name)`: an existing row with the trimmed name keeps
   * its `id`/`created_at` and takes the new payload, bumping `updated_at`;
   * otherwise a new row is inserted with a fresh `uuidv7()`. The lookup and the
   * write happen inside one transaction so a concurrent save under the same name
   * can never race between them.
   */
  saveByName(name: string, payload: TaskTemplatePayload, now: string): TaskTemplate {
    const validNow = validateDateTime(now, "now");
    const trimmedName = validateTemplateName(name);
    const validPayload = validatePayload(payload);
    const payloadText = JSON.stringify(validPayload);

    return this.db.transaction((): TaskTemplate => {
      const existing = this.selectByName.get(this.profileId, trimmedName) as
        | TaskTemplateRow
        | undefined;

      if (existing) {
        this.updatePayload.run(payloadText, validNow, existing.id, this.profileId);
        return {
          id: existing.id,
          profileId: this.profileId,
          name: trimmedName,
          payload: validPayload,
          createdAt: existing.created_at,
          updatedAt: validNow,
        };
      }

      const id = uuidv7();
      this.insert.run(id, this.profileId, trimmedName, payloadText, validNow, validNow);
      return {
        id,
        profileId: this.profileId,
        name: trimmedName,
        payload: validPayload,
        createdAt: validNow,
        updatedAt: validNow,
      };
    })();
  }

  /** Hard-deletes a template — no soft delete (migration 027: nothing references one, and the undo is to save it again). */
  delete(id: string): void {
    this.requireTemplate(id);
    this.deleteRow.run(id, this.profileId);
  }

  private requireTemplate(id: string): TaskTemplateRow {
    const row = this.selectById.get(id, this.profileId) as TaskTemplateRow | undefined;
    if (!row) {
      throw new TaskTemplateNotFoundError(`No task template "${id}" in this profile.`);
    }
    return row;
  }
}

function toTaskTemplate(row: TaskTemplateRow): TaskTemplate {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    payload: parseStoredPayload(row.payload, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Reads the stored column back through the SAME validator a write goes through.
 * Only this store writes the column, and it writes `validatePayload`'s output,
 * so anything that fails here is corruption rather than input to be coerced —
 * and a template silently reduced to the fields that still parse is not the
 * template the user saved (`TaskStore.parseStoredRecurrence`'s reasoning).
 */
function parseStoredPayload(text: string, id: string): TaskTemplatePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TaskTemplateValidationError(
      `Task template "${id}" carries a stored payload that is not valid JSON.`,
    );
  }
  try {
    return validatePayload(parsed);
  } catch (error) {
    if (error instanceof TaskTemplateValidationError) {
      throw new TaskTemplateValidationError(
        `Task template "${id}" carries a stored payload that is not valid: ${error.message}`,
      );
    }
    throw error;
  }
}

function validateTemplateName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TaskTemplateValidationError("A task template name must not be empty.");
  }
  if (trimmed.length > MAX_TASK_TEMPLATE_NAME_LENGTH) {
    throw new TaskTemplateValidationError(
      `A task template name must not exceed ${MAX_TASK_TEMPLATE_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateDateTime(value: string, field: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new TaskTemplateValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}

/**
 * The one payload validator, shared by every write and every read, returning the
 * CANONICAL form the column stores: trimmed strings, an ascending ladder, tag
 * names de-duplicated. Takes `unknown` because the stored-column reader has
 * exactly that and the typed caller loses nothing by going through the same
 * gate — a `TaskTemplatePayload` object says nothing about a priority of
 * `"urgent"` reaching it across the IPC boundary.
 */
function validatePayload(value: unknown): TaskTemplatePayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TaskTemplateValidationError("A task template payload must be an object.");
  }
  const raw: Record<string, unknown> = { ...value };

  const title = validateTitle(raw.title, "title");
  const description = normalizeOptional(raw.description);
  const priority = validatePriority(raw.priority);
  const dueOffsetDays = validateDueOffsetDays(raw.dueOffsetDays);
  const reminderOffsets = validateReminderOffsets(raw.reminderOffsets);
  const recurrence = validateRecurrence(raw.recurrence);
  const tagNames = validateTagNames(raw.tagNames);
  const subtaskTitles = validateSubtaskTitles(raw.subtaskTitles);

  // ADR-028/ADR-024's anchor rule, expressed against the RELATIVE offset: a
  // ladder counts days back from the due date and a rule phases from it, so the
  // template must describe one. `0` satisfies it — "due on the day it is
  // applied" is a date like any other, which is exactly why a past due date
  // clamps to 0 at capture rather than to null.
  if (reminderOffsets.length > 0 && dueOffsetDays === null) {
    throw new TaskTemplateValidationError(
      'A task template with reminders must have a "dueOffsetDays" to count back from.',
    );
  }
  if (recurrence !== null && dueOffsetDays === null) {
    throw new TaskTemplateValidationError(
      'A task template with a recurrence rule must have a "dueOffsetDays" to phase from.',
    );
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

/** `TaskStore.validateTitle`'s rule (trim, non-empty, no cap), applied to the template's title and to every subtask title. */
function validateTitle(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TaskTemplateValidationError(`"${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TaskTemplateValidationError(`"${field}" must not be empty.`);
  }
  return trimmed;
}

/** `TaskStore.normalizeOptional`, mirrored: absent/null/blank all collapse to null. */
function normalizeOptional(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new TaskTemplateValidationError('"description" must be a string or null.');
  }
  return value.trim().length === 0 ? null : value;
}

/** Membership against `TASK_PRIORITIES` itself — the store's own closed domain, imported rather than respelled. */
function validatePriority(value: unknown): TaskPriority {
  for (const candidate of TASK_PRIORITIES) {
    if (candidate === value) return candidate;
  }
  throw new TaskTemplateValidationError(`Unknown task priority "${String(value)}".`);
}

function validateDueOffsetDays(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_TASK_TEMPLATE_DUE_OFFSET_DAYS
  ) {
    throw new TaskTemplateValidationError(
      `"dueOffsetDays" must be null or a whole number of days between 0 and ${MAX_TASK_TEMPLATE_DUE_OFFSET_DAYS}.`,
    );
  }
  return value;
}

/**
 * `TaskStore.validateReminderOffsets`' rules against `MAX_TASK_REMINDERS` /
 * `MAX_TASK_REMINDER_DAYS` — the very constants that store exports, so a
 * template can never hold a ladder the task it creates would refuse.
 */
function validateReminderOffsets(value: unknown): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new TaskTemplateValidationError('"reminderOffsets" must be an array.');
  }
  const entries: readonly unknown[] = value;
  if (entries.length > MAX_TASK_REMINDERS) {
    throw new TaskTemplateValidationError(
      `A task template may carry at most ${MAX_TASK_REMINDERS} reminders (got ${entries.length}).`,
    );
  }
  const offsets: number[] = [];
  for (const entry of entries) {
    if (
      typeof entry !== "number" ||
      !Number.isInteger(entry) ||
      entry < 0 ||
      entry > MAX_TASK_REMINDER_DAYS
    ) {
      throw new TaskTemplateValidationError(
        `"reminderOffsets" must hold whole days between 0 and ${MAX_TASK_REMINDER_DAYS} (got ${String(entry)}).`,
      );
    }
    offsets.push(entry);
  }
  if (new Set(offsets).size !== offsets.length) {
    throw new TaskTemplateValidationError('"reminderOffsets" must not repeat the same lead time.');
  }
  return offsets.sort((a, b) => a - b);
}

/** `TaskStore.validateRecurrence`, mirrored: the engine's own validator is the grammar, and the canonical rule is what gets stored. */
function validateRecurrence(value: unknown): RecurrenceRule | null {
  if (value === undefined || value === null) return null;
  const rule = validateRecurrenceRule(value);
  if (rule === null) {
    throw new TaskTemplateValidationError('"recurrence" is not a valid recurrence rule.');
  }
  return rule;
}

/**
 * Tag NAMES, held to `TaskTagStore`'s own name rule (trimmed, non-empty, within
 * `MAX_TASK_TAG_NAME_LENGTH`) so every one of them is a name that store's
 * get-or-create will actually accept at apply time. De-duplicated after
 * trimming, because attaching the same tag twice is one attachment (migration
 * 023's PRIMARY KEY says so) and a template listing it twice is saying nothing
 * extra.
 */
function validateTagNames(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new TaskTemplateValidationError('"tagNames" must be an array.');
  }
  const entries: readonly unknown[] = value;
  if (entries.length > MAX_TASK_TEMPLATE_TAGS) {
    throw new TaskTemplateValidationError(
      `A task template may carry at most ${MAX_TASK_TEMPLATE_TAGS} tags (got ${entries.length}).`,
    );
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") {
      throw new TaskTemplateValidationError('"tagNames" must hold strings.');
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      throw new TaskTemplateValidationError('"tagNames" must not hold an empty name.');
    }
    if (trimmed.length > MAX_TASK_TAG_NAME_LENGTH) {
      throw new TaskTemplateValidationError(
        `A tag name must not exceed ${MAX_TASK_TAG_NAME_LENGTH} characters after trimming.`,
      );
    }
    if (!names.includes(trimmed)) names.push(trimmed);
  }
  return names;
}

/**
 * The DIRECT subtasks the template creates. Duplicates are deliberately kept,
 * unlike `tagNames`: two subtasks called „Pozovi“ are two things to do, while
 * two identical tags are one label.
 */
function validateSubtaskTitles(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new TaskTemplateValidationError('"subtaskTitles" must be an array.');
  }
  const entries: readonly unknown[] = value;
  if (entries.length > MAX_TASK_TEMPLATE_SUBTASKS) {
    throw new TaskTemplateValidationError(
      `A task template may carry at most ${MAX_TASK_TEMPLATE_SUBTASKS} subtasks (got ${entries.length}).`,
    );
  }
  return entries.map((entry, index) => validateTitle(entry, `subtaskTitles[${index}]`));
}
