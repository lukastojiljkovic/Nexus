/**
 * The argument readers every tool's `run` uses — the second validation a tool
 * owes, because a JSON schema is advice to a model and nothing more.
 *
 * **They are the app's own validators.** `main/ipcValidators.ts` is where
 * `main/index.ts` and every kit module get their payload checks (SEC-EL-02), and
 * these wrappers call the same functions rather than a second set that agrees
 * today: a tool therefore accepts exactly what the channel the app draws
 * accepts, and the day one bound moves both move. What is added here is only the
 * three questions the wire has no need to ask — a closed vocabulary the model
 * must spell one way, a bare calendar day, and a number inside a range.
 *
 * **An id is an id.** `asId` bounds what it reads (`MAX_ID_LENGTH`, and no
 * surrounding whitespace), which is the rule `check:ids` exists to keep: every
 * id that reaches a store on this path came from a model's argument string, and
 * a store's prepared statement will happily carry a ten-megabyte one.
 */

import { isValidDayKey } from "@nexus/core";
import {
  asBoundedInteger,
  asCappedChars,
  asId,
  asNonEmptyString,
  asRecord,
} from "../../ipcValidators.js";

/**
 * Accepts ISO-8601 date ('2026-07-08') or date-time, optionally zoned — the
 * pattern `EventStore` and `TaskStore` both state, restated so a start the store
 * would refuse is refused here with a sentence naming the field.
 */
const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/;

/** The single argument object a tool's `run` is handed. */
export function asArgs(value: unknown): Record<string, unknown> {
  return asRecord(value);
}

/** An identifier — a row's own id, a module id, a module-qualified settings key. */
export function asIdentifier(value: unknown, field: string): string {
  return asId(value, field);
}

/**
 * A line of the model's own prose: trimmed, non-empty, capped in CHARACTERS.
 *
 * Characters rather than bytes, because the caps it is used with are the
 * stores' own `.length` checks (`asCappedChars`'s rule): every Serbian
 * diacritic is two UTF-8 bytes, so a byte cap would refuse legal Serbian input
 * and only Serbian input.
 */
export function asText(value: unknown, field: string, maxChars: number): string {
  const trimmed = asCappedChars(asNonEmptyString(value, field), field, maxChars).trim();
  if (trimmed.length === 0) {
    throw new Error(`"${field}" must be a non-empty string.`);
  }
  return trimmed;
}

/** The same reader for a field the model may leave out entirely. */
export function asOptionalText(
  value: unknown,
  field: string,
  maxChars: number,
): string | undefined {
  return value === undefined ? undefined : asText(value, field, maxChars);
}

/** One member of a closed vocabulary — the shape a JSON schema's `enum` promises and a tool must still enforce. */
export function asEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value === "string") {
    for (const candidate of allowed) {
      if (candidate === value) return candidate;
    }
  }
  throw new Error(`"${field}" must be one of: ${allowed.join(", ")}.`);
}

/** The same reader for a field the model may leave out entirely. */
export function asOptionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | undefined {
  return value === undefined ? undefined : asEnum(value, field, allowed);
}

/**
 * A bare calendar day, `YYYY-MM-DD`, a real day — core's `isValidDayKey`, the
 * same check the stores apply to every date column they hold, so „2026-02-30"
 * is refused here rather than becoming a row.
 */
export function asDay(value: unknown, field: string): string {
  const day = asNonEmptyString(value, field);
  if (!isValidDayKey(day)) {
    throw new Error(`"${field}" must be a calendar day in YYYY-MM-DD form.`);
  }
  return day;
}

/** The same reader for a field the model may leave out entirely. */
export function asOptionalDay(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : asDay(value, field);
}

/** A date the model may also clear: a day, or an explicit `null`. */
export function asNullableDay(value: unknown, field: string): string | null {
  return value === null ? null : asDay(value, field);
}

/** An ISO-8601 date or date-time — the shape `EventStore` accepts for a start or an end (`PRD` §7). */
export function asInstant(value: unknown, field: string): string {
  const instant = asNonEmptyString(value, field);
  if (!ISO_8601.test(instant) || Number.isNaN(Date.parse(instant))) {
    throw new Error(`"${field}" must be an ISO-8601 date or date-time.`);
  }
  return instant;
}

/** The same reader for a field the model may leave out entirely. */
export function asOptionalInstant(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : asInstant(value, field);
}

/** A boolean the model may leave out entirely. */
export function asOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`"${field}" must be a boolean.`);
  }
  return value;
}

/** A whole number inside a range — the bounds a store's own CHECK carries, so the refusal reaches the model before the store sees it. */
export function asCount(value: unknown, field: string, min: number, max: number): number {
  return asBoundedInteger(value, field, min, max);
}

/**
 * A number inside a range, fractions included — for the quantities a person
 * really writes down (half a kilo, 1,5 litres). The store's own CHECK is the
 * same interval, so a value this refuses is one the store would refuse too.
 */
export function asNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`"${field}" must be a number between ${String(min)} and ${String(max)}.`);
  }
  return value;
}

/** The same reader for a field the model may leave out entirely. */
export function asOptionalNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number | undefined {
  return value === undefined ? undefined : asNumber(value, field, min, max);
}

/** The same reader for a field the model may leave out entirely. */
export function asOptionalCount(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number | undefined {
  return value === undefined ? undefined : asCount(value, field, min, max);
}

/**
 * A short list of short strings — the shape several stores take for creators,
 * tags and the like — bounded in BOTH directions, because a model can send a
 * thousand entries as easily as one and every store behind this caps the count
 * and the length itself.
 */
export function asTextList(
  value: unknown,
  field: string,
  maxItems: number,
  maxChars: number,
): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`"${field}" must be a list of strings.`);
  }
  if (value.length > maxItems) {
    throw new Error(`"${field}" may hold at most ${String(maxItems)} entries.`);
  }
  return value.map((entry) => asText(entry, field, maxChars));
}

/** The same reader for a list the model may leave out entirely. */
export function asOptionalTextList(
  value: unknown,
  field: string,
  maxItems: number,
  maxChars: number,
): string[] | undefined {
  return value === undefined ? undefined : asTextList(value, field, maxItems, maxChars);
}

