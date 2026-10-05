import type Database from "better-sqlite3-multiple-ciphers";
import {
  isValidDayKey,
  TIME_GRID_MAX_END_MINUTES,
  TIME_GRID_MIN_EVENT_MINUTES,
  validateRecurrenceRule,
} from "@nexus/core";
import type { RecurrenceRule } from "@nexus/core";
import { EventNotFoundError, EventTemplateNotFoundError, EventTemplateValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { EventStore, MAX_EVENT_REMINDERS, MAX_EVENT_REMINDER_MINUTES } from "./eventStore.js";
import type { Event } from "./eventStore.js";

type DatabaseHandle = Database.Database;

/**
 * The event-shaped body a template carries (CAL-009) — everything `apply` needs
 * to build an event, and deliberately nothing else. It is stored as JSON in one
 * column (migration 036) and validated field for field on the way in AND on the
 * way out, since a JSON column has no CHECK to lean on. `TaskTemplatePayload`'s
 * arrangement (ADR-035), one module over.
 *
 * **No field here is a date, and that is the whole point of the shape.** A
 * template describes a time of day and a length; the DAY comes from wherever the
 * user applies it. An absolute start would rot the morning after it was saved,
 * and a recurrence rule pinned to its capture day would keep phasing from a
 * Tuesday no matter which day it was dropped on.
 */
export interface EventTemplatePayload {
  /** The created event's title. `EventStore`'s own rule: trimmed, non-empty. */
  title: string;
  /** Whether the created event occupies whole days rather than a span of clock time. */
  allDay: boolean;
  /**
   * Wall-clock `HH:MM` the created event starts at. REQUIRED on a timed
   * template and forbidden on an all-day one — an all-day event's start is the
   * bare day key, which has no clock part to remember.
   */
  startTime: string | null;
  /**
   * How long the created event lasts, in whole minutes, or null for an event
   * with no end at all. Timed templates only, bounded so the span always ends
   * inside its own day (see `validatePayload`).
   */
  durationMinutes: number | null;
  /** Trimmed to null when blank — `EventStore.normalizeOptional`, mirrored. */
  location: string | null;
  description: string | null;
  category: string | null;
  /** Whole minutes before the created event's start, ascending (CAL-006). Independent of `allDay`: an all-day event reminds too. */
  reminderOffsets: number[];
  /**
   * The rule the created event's series runs on (ADR-024), or null for a
   * one-off. Stored UNANCHORED — `apply` phases it from the day the template is
   * applied to, which is what makes a captured weekly rule mean "weekly from
   * here" rather than "weekly from the Tuesday I saved it on".
   */
  recurrence: RecurrenceRule | null;
}

/** An event template as the store returns it (CAL-009). */
export interface EventTemplate {
  id: string;
  profileId: string;
  name: string;
  payload: EventTemplatePayload;
  createdAt: string;
  updatedAt: string;
}

interface EventTemplateRow {
  id: string;
  profile_id: string;
  name: string;
  payload: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, profile_id, name, payload, created_at, updated_at";

/**
 * Longest template name after trimming — `MAX_TASK_TEMPLATE_NAME_LENGTH`'s 80,
 * for the same reason: an event template is picked from a popover list, and a
 * name that wraps there stops being scannable. Exported (and re-exported from
 * the package barrel) so the IPC validator that guards this store bounds the
 * wire by the very same number.
 */
export const MAX_EVENT_TEMPLATE_NAME_LENGTH = 80;

/**
 * Shortest span a template may carry, and the longest end it may reach — the
 * calendar's OWN constants (`timeGridDrag.ts`), re-exported under this module's
 * names rather than restated, so a template can never describe a span the hour
 * grid could not draw or a drag could not have produced. The upper bound is
 * 23:59: times travel as zone-less `YYYY-MM-DDTHH:MM` strings and a timed event
 * keeps its end on its own day, so 24:00 is not a thing this app can write down.
 */
export const MIN_EVENT_TEMPLATE_DURATION_MINUTES = TIME_GRID_MIN_EVENT_MINUTES;
export const MAX_EVENT_TEMPLATE_END_MINUTES = TIME_GRID_MAX_END_MINUTES;

/** Accepts a full ISO-8601 date-time (the `now` every mutating method takes) — mirrors taskTemplateStore.ts. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/** Exactly `HH:MM` on a 24-hour clock — the shape a wall-clock start travels as everywhere in this app. */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const MINUTES_PER_HOUR = 60;

/**
 * Persistence for the CAL module's user-defined event templates (CAL-009).
 * `TaskTemplateStore`'s arrangement applied to the calendar: construct one per
 * profile, reuse it, over prepared, parameterized statements (SEC-API-03 — every
 * value bound, never interpolated), every statement scoped by `profile_id`.
 * Inputs are revalidated here because the renderer is untrusted (SEC-EL-02).
 *
 * `saveByName` is an upsert on `(profile_id, name)` — migration 036's UNIQUE
 * index — because naming IS the edit mechanism: a user changes a template by
 * applying it, adjusting the event, and capturing it again under the same name.
 * The select-then-write runs inside one `db.transaction(...)` so a concurrent
 * save under the same name can never slip between the lookup and the write.
 *
 * Unlike `TaskTemplateStore`, the two ENDS of the feature live here rather than
 * in main: `captureFromEvent` reads an event and relativizes it, and `apply`
 * creates one on a named day. A task template needed three stores (tasks, tags,
 * subtasks) to be applied, which is why main owns that half; an event template
 * needs exactly one — `EventStore`, constructed here over the same handle and
 * the same profile — so keeping both directions beside the shape they operate on
 * costs nothing and puts the relativizing rules next to the payload that states
 * them.
 *
 * The payload is validated by ONE function used by every direction
 * (`validatePayload`), which is what keeps a write, a read and an apply from
 * ever disagreeing about what a template is. On the way out a payload that fails
 * is corruption — a hand-edited file, a bad restore — and throws naming the row,
 * for the reason `EventStore.parseStoredRecurrence` gives: reading it leniently
 * would silently hand the user a template that is not the one they saved.
 */
export class EventTemplateStore {
  private readonly events: EventStore;
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
    this.events = new EventStore(db, profileId);
    this.selectAll = db.prepare(
      `SELECT ${COLUMNS} FROM event_templates WHERE profile_id = ? ORDER BY name`,
    );
    this.selectById = db.prepare(
      `SELECT ${COLUMNS} FROM event_templates WHERE id = ? AND profile_id = ?`,
    );
    this.selectByName = db.prepare(
      `SELECT ${COLUMNS} FROM event_templates WHERE profile_id = ? AND name = ?`,
    );
    this.insert = db.prepare(
      `INSERT INTO event_templates (id, profile_id, name, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.updatePayload = db.prepare(
      `UPDATE event_templates SET payload = ?, updated_at = ? WHERE id = ? AND profile_id = ?`,
    );
    this.deleteRow = db.prepare(`DELETE FROM event_templates WHERE id = ? AND profile_id = ?`);
  }

  /**
   * This profile's templates, alphabetical by `name` — SQLite's default binary
   * collation, which does not tailor Serbian Latin script correctly; the
   * renderer re-sorts with `Intl.Collator` in the active interface locale, the
   * house pattern `TaskTemplateStore.list` and every other alphabetical list
   * already follow.
   */
  list(): EventTemplate[] {
    const rows = this.selectAll.all(this.profileId) as EventTemplateRow[];
    return rows.map((row) => toEventTemplate(row));
  }

  /** Reads one template of this profile, or throws — the gate every reference by id goes through. */
  get(id: string): EventTemplate {
    return toEventTemplate(this.requireTemplate(id));
  }

  /**
   * Upserts on `(profile_id, name)`: an existing row with the trimmed name keeps
   * its `id`/`created_at` and takes the new payload, bumping `updated_at`;
   * otherwise a new row is inserted with a fresh `uuidv7()`. The lookup and the
   * write happen inside one transaction so a concurrent save under the same name
   * can never race between them.
   */
  saveByName(name: string, payload: EventTemplatePayload, now: string): EventTemplate {
    const validNow = validateDateTime(now, "now");
    const trimmedName = validateTemplateName(name);
    const validPayload = validatePayload(payload);
    const payloadText = JSON.stringify(validPayload);

    return this.db.transaction((): EventTemplate => {
      const existing = this.selectByName.get(this.profileId, trimmedName) as
        | EventTemplateRow
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

  /** Hard-deletes a template — no soft delete (migration 036: nothing references one, and the undo is to save it again). */
  delete(id: string): void {
    this.requireTemplate(id);
    this.deleteRow.run(id, this.profileId);
  }

  /**
   * Creates a real event from a template, on `dayKey`. The day is the CALLER's,
   * never the template's — a template that carried its own date would file
   * events into a week nobody is looking at, and would rot the moment that date
   * passed. Everything else comes from the payload, and `EventStore.create` owns
   * every rule about it (the title, the range, the ladder, the rule's anchor), so
   * nothing is re-checked here.
   *
   * A recurring template phases from `dayKey` itself, which is why the anchor is
   * always a real calendar day: `isValidDayKey` is checked before a start string
   * is ever assembled, so `2026-02-30` is refused here rather than becoming an
   * event nobody can expand.
   */
  apply(templateId: string, dayKey: string): Event {
    const { payload } = this.get(templateId);
    if (!isValidDayKey(dayKey)) {
      throw new EventTemplateValidationError(
        `"dayKey" must be a bare calendar date (got "${dayKey}").`,
      );
    }

    if (payload.allDay) {
      return this.events.create({
        title: payload.title,
        startAt: dayKey,
        allDay: true,
        location: payload.location,
        description: payload.description,
        category: payload.category,
        recurrence: payload.recurrence,
        reminderOffsets: payload.reminderOffsets,
      });
    }

    // Non-null on a timed payload: `validatePayload` refuses one without it, and
    // a stored row goes through the same validator on the way out.
    const startTime = payload.startTime ?? "00:00";
    const endAt =
      payload.durationMinutes === null
        ? null
        : `${dayKey}T${formatClock(clockToMinutes(startTime) + payload.durationMinutes)}`;

    return this.events.create({
      title: payload.title,
      startAt: `${dayKey}T${startTime}`,
      endAt,
      allDay: false,
      location: payload.location,
      description: payload.description,
      category: payload.category,
      recurrence: payload.recurrence,
      reminderOffsets: payload.reminderOffsets,
    });
  }

  /**
   * Saves an existing event's SHAPE under `name`, RELATIVIZED: the date is
   * dropped and what survives is the time of day, the length, the reminder
   * ladder, the recurrence rule and the three text fields. Saving under a name
   * that already exists replaces that template, which is the edit mechanism
   * (`saveByName`).
   *
   * Three honest losses, each of them a shape a one-day template cannot state:
   * an all-day event's multi-day SPAN, a timed event whose end is on another
   * day, and a span so late in the day that no legal duration still fits inside
   * it. Each becomes "no duration" — an open-ended event — rather than a value
   * quietly moved to a day the user did not name.
   */
  captureFromEvent(eventId: string, name: string, now: string): EventTemplate {
    const event = this.events.listActive().find((row) => row.id === eventId);
    if (!event) {
      throw new EventNotFoundError(`No active event "${eventId}" in this profile.`);
    }
    return this.saveByName(name, relativizeEvent(event), now);
  }

  private requireTemplate(id: string): EventTemplateRow {
    const row = this.selectById.get(id, this.profileId) as EventTemplateRow | undefined;
    if (!row) {
      throw new EventTemplateNotFoundError(`No event template "${id}" in this profile.`);
    }
    return row;
  }
}

function toEventTemplate(row: EventTemplateRow): EventTemplate {
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
 * An event as a template's payload — the one place the relativizing rules live.
 * A timed event's duration is the distance between its two clock parts, and only
 * when both land on the SAME day: `EventStore` happily stores a multi-day timed
 * event, but a template is applied onto one day, so a span that crossed midnight
 * would come back as a different event than the one captured.
 */
function relativizeEvent(event: Event): EventTemplatePayload {
  const base = {
    title: event.title,
    location: event.location,
    description: event.description,
    category: event.category,
    reminderOffsets: [...event.reminderOffsets],
    recurrence: event.recurrence,
  };
  if (event.allDay) {
    return { ...base, allDay: true, startTime: null, durationMinutes: null };
  }
  const startTime = event.startAt.slice(11, 16);
  return {
    ...base,
    allDay: false,
    startTime,
    durationMinutes: capturedDuration(event, clockToMinutes(startTime)),
  };
}

/**
 * A timed event's length as a template may carry it, or null when it cannot:
 * no end at all, an end on another day, or a start so late that not even the
 * shortest legal span fits before 23:59. A span the user did draw but that falls
 * below the grid's minimum is CLAMPED up rather than dropped — the taskTemplate
 * capture's own reasoning (a clamp keeps the fact, a null throws it away).
 */
function capturedDuration(event: Event, startMinutes: number): number | null {
  if (event.endAt === null) return null;
  if (event.endAt.slice(0, 10) !== event.startAt.slice(0, 10)) return null;
  const longest = MAX_EVENT_TEMPLATE_END_MINUTES - startMinutes;
  if (longest < MIN_EVENT_TEMPLATE_DURATION_MINUTES) return null;
  const span = clockToMinutes(event.endAt.slice(11, 16)) - startMinutes;
  return Math.min(Math.max(span, MIN_EVENT_TEMPLATE_DURATION_MINUTES), longest);
}

/**
 * Reads the stored column back through the SAME validator a write goes through.
 * Only this store writes the column, and it writes `validatePayload`'s output,
 * so anything that fails here is corruption rather than input to be coerced —
 * and a template silently reduced to the fields that still parse is not the
 * template the user saved (`EventStore.parseStoredRecurrence`'s reasoning).
 */
function parseStoredPayload(text: string, id: string): EventTemplatePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EventTemplateValidationError(
      `Event template "${id}" carries a stored payload that is not valid JSON.`,
    );
  }
  try {
    return validatePayload(parsed);
  } catch (error) {
    if (error instanceof EventTemplateValidationError) {
      throw new EventTemplateValidationError(
        `Event template "${id}" carries a stored payload that is not valid: ${error.message}`,
      );
    }
    throw error;
  }
}

function validateTemplateName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new EventTemplateValidationError("An event template name must not be empty.");
  }
  if (trimmed.length > MAX_EVENT_TEMPLATE_NAME_LENGTH) {
    throw new EventTemplateValidationError(
      `An event template name must not exceed ${MAX_EVENT_TEMPLATE_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateDateTime(value: string, field: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new EventTemplateValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}

/**
 * The one payload validator, shared by every write, every read and every apply,
 * returning the CANONICAL form the column stores: trimmed strings, an ascending
 * ladder, a canonical recurrence rule. Takes `unknown` because the stored-column
 * reader has exactly that and the typed caller loses nothing by going through
 * the same gate — an `EventTemplatePayload` object says nothing about a
 * `startTime` of `"25:00"` reaching it across the IPC boundary.
 */
function validatePayload(value: unknown): EventTemplatePayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EventTemplateValidationError("An event template payload must be an object.");
  }
  const raw: Record<string, unknown> = { ...value };

  const title = validateTitle(raw.title);
  const allDay = validateAllDay(raw.allDay);
  const startTime = validateStartTime(raw.startTime, allDay);
  const durationMinutes = validateDuration(raw.durationMinutes, allDay, startTime);
  const location = normalizeOptional(raw.location, "location");
  const description = normalizeOptional(raw.description, "description");
  const category = normalizeOptional(raw.category, "category");
  const reminderOffsets = validateReminderOffsets(raw.reminderOffsets);
  const recurrence = validateRecurrence(raw.recurrence);

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

/** `EventStore.validateTitle`'s rule (trim, non-empty, no cap). */
function validateTitle(value: unknown): string {
  if (typeof value !== "string") {
    throw new EventTemplateValidationError('"title" must be a string.');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new EventTemplateValidationError('"title" must not be empty.');
  }
  return trimmed;
}

/** Absent means `false` — `EventStore.create`'s own default for an omitted `allDay`. */
function validateAllDay(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") {
    throw new EventTemplateValidationError('"allDay" must be a boolean.');
  }
  return value;
}

/**
 * A timed template MUST name the minute it starts at, and an all-day one must
 * not: the two are the same statement from either side, because an all-day
 * event's start is a bare day key with no clock part to put one in.
 */
function validateStartTime(value: unknown, allDay: boolean): string | null {
  if (allDay) {
    if (value === undefined || value === null) return null;
    throw new EventTemplateValidationError('An all-day event template must not carry a "startTime".');
  }
  if (typeof value !== "string" || !HHMM.test(value)) {
    throw new EventTemplateValidationError(
      `A timed event template's "startTime" must be an HH:MM wall-clock time (got "${String(value)}").`,
    );
  }
  return value;
}

/**
 * The span, held to the hour grid's own bounds: at least
 * `MIN_EVENT_TEMPLATE_DURATION_MINUTES`, and never reaching past
 * `MAX_EVENT_TEMPLATE_END_MINUTES` from the template's own start. That upper
 * check is a CROSS-FIELD rule — it is about the pair, not the number — and it is
 * what keeps a template from describing an event that would have to end on a day
 * it was never applied to.
 */
function validateDuration(value: unknown, allDay: boolean, startTime: string | null): number | null {
  if (value === undefined || value === null) return null;
  if (allDay || startTime === null) {
    throw new EventTemplateValidationError(
      'An all-day event template must not carry a "durationMinutes".',
    );
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new EventTemplateValidationError('"durationMinutes" must be a whole number of minutes.');
  }
  if (value < MIN_EVENT_TEMPLATE_DURATION_MINUTES) {
    throw new EventTemplateValidationError(
      `"durationMinutes" must be at least ${MIN_EVENT_TEMPLATE_DURATION_MINUTES} (got ${value}).`,
    );
  }
  if (clockToMinutes(startTime) + value > MAX_EVENT_TEMPLATE_END_MINUTES) {
    throw new EventTemplateValidationError(
      `An event template must end inside its own day: "${startTime}" + ${value} min runs past ` +
        `${formatClock(MAX_EVENT_TEMPLATE_END_MINUTES)}.`,
    );
  }
  return value;
}

/** `EventStore.normalizeOptional`, mirrored: absent/null/blank all collapse to null, and a non-blank value is kept verbatim. */
function normalizeOptional(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new EventTemplateValidationError(`"${field}" must be a string or null.`);
  }
  return value.trim().length === 0 ? null : value;
}

/**
 * `EventStore.validateReminderOffsets`' rules against `MAX_EVENT_REMINDERS` /
 * `MAX_EVENT_REMINDER_MINUTES` — the very constants that store exports, so a
 * template can never hold a ladder the event it creates would refuse.
 */
function validateReminderOffsets(value: unknown): number[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new EventTemplateValidationError('"reminderOffsets" must be an array.');
  }
  const entries: readonly unknown[] = value;
  if (entries.length > MAX_EVENT_REMINDERS) {
    throw new EventTemplateValidationError(
      `An event template may carry at most ${MAX_EVENT_REMINDERS} reminders (got ${entries.length}).`,
    );
  }
  const offsets: number[] = [];
  for (const entry of entries) {
    if (
      typeof entry !== "number" ||
      !Number.isInteger(entry) ||
      entry < 0 ||
      entry > MAX_EVENT_REMINDER_MINUTES
    ) {
      throw new EventTemplateValidationError(
        `"reminderOffsets" must hold whole minutes between 0 and ${MAX_EVENT_REMINDER_MINUTES} (got ${String(entry)}).`,
      );
    }
    offsets.push(entry);
  }
  if (new Set(offsets).size !== offsets.length) {
    throw new EventTemplateValidationError('"reminderOffsets" must not repeat the same lead time.');
  }
  return offsets.sort((a, b) => a - b);
}

/**
 * `EventStore.validateRecurrence`, mirrored: the engine's own validator is the
 * grammar, and the canonical rule is what gets stored. Deliberately WITHOUT the
 * anchor check that store performs — a template has no start day to anchor on,
 * and `apply` supplies a real one (`isValidDayKey`) before `EventStore` sees it.
 */
function validateRecurrence(value: unknown): RecurrenceRule | null {
  if (value === undefined || value === null) return null;
  const rule = validateRecurrenceRule(value);
  if (rule === null) {
    throw new EventTemplateValidationError('"recurrence" is not a valid recurrence rule.');
  }
  return rule;
}

/** `HH:MM` as minutes from midnight. Only ever called on a value `HHMM` has already accepted. */
function clockToMinutes(clock: string): number {
  return Number(clock.slice(0, 2)) * MINUTES_PER_HOUR + Number(clock.slice(3, 5));
}

/** Minutes from midnight as `HH:MM` — the twin of `clockToMinutes`, and the shape every wall-clock string in this app takes. */
function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  return `${String(hours).padStart(2, "0")}:${String(minutes % MINUTES_PER_HOUR).padStart(2, "0")}`;
}
