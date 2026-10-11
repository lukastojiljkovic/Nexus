/**
 * PANTRY's model and its one gate — what a stock item IS, what a location IS,
 * and every way a caller can get one wrong.
 *
 * **One model for food and medicine, and the difference is one text field.**
 * A medicine is an item whose `category` is `medicine`; the only thing the two
 * do not share is `doseNote`, free text for how the thing is taken. There is
 * deliberately NO dosage field, no strength, no units-per-kilogram and no
 * arithmetic over any of them: Nexus stores what the box says and computes
 * nothing about it, because a number this app derived about somebody's medicine
 * would be a number it invented. If a future slice wants to print „how to take
 * it“, it prints `doseNote` verbatim — it does not parse it.
 *
 * **Quantity is a plain decimal number, not money-style minor units.** A
 * kilogram is 1,5 and half a litre is 0,5, and the column is a REAL. The one
 * thing that costs is exactness: a sum of many decimal quantities can drift in
 * the last bits, so the shopping list's `needed` and the waste report's totals
 * are doubles a surface should ROUND for display rather than print raw. What
 * this module refuses to do is round on the way in: a caller that types 0,25
 * gets back 0,25.
 *
 * **A barcode is digits, and it is stored as TEXT.** Leading zeros are part of a
 * code, so an INTEGER column would corrupt every EAN that starts with one. The
 * eight, twelve, thirteen and fourteen digit lengths are the real ones; a
 * padded or spaced value is REFUSED rather than trimmed, because
 * „ 12345678 “ is not a barcode somebody scanned — it is a paste, and trimming
 * it would store a code the user never confirmed.
 *
 * **`useWithinDays` and `openedDate` are independent, deliberately.** A packet
 * names its „use within 30 days of opening“ on the day it is bought, and the day
 * it is opened comes later; refusing the first until the second exists would
 * make the label unusable for exactly as long as it is useful. The effective
 * expiry is where the two meet (`pantryStock.ts`).
 *
 * **The log's reasons carry a sign, and the sign is a rule.** A purchase adds;
 * a use and an expiry removal subtract; a correction may go either way. It is
 * enforced here and mirrored in migration 075's own CHECK, because the waste
 * report adds „what was thrown away“ up: without it, a row reading
 * „expired, +2“ would make the report say that two kilos came back.
 *
 * The three validators return problems rather than throwing or repairing —
 * `validateFoodEntry`'s contract, so a caller that knows one knows the others.
 * The store turns them into one named error and stage 2's IPC layer refuses by
 * the same rule, which is the point of the validator living here instead of in
 * the store: one definition, or the wire and the store quietly disagree about
 * what a minimum quantity is.
 */

import { isValidDayKey } from "../calendar/calendarGrid.js";
import type { DayKey } from "../calendar/calendarGrid.js";
import { MAX_ID_LENGTH } from "../ids.js";

/** What a stock item is for (migration 075's CHECK, and the only list there is). */
export const PANTRY_CATEGORIES = [
  "food",
  "medicine",
  "hygiene",
  "emergency",
  "other",
] as const;
export type PantryCategory = (typeof PANTRY_CATEGORIES)[number];

/**
 * What a quantity counts. Six units and no seventh: they are the ones a
 * household actually writes down, and a free-text unit would make two items of
 * the same thing incomparable.
 */
export const PANTRY_UNITS = ["pcs", "g", "kg", "ml", "l", "pack"] as const;
export type PantryUnit = (typeof PANTRY_UNITS)[number];

/** Why a quantity moved. See the file header on the sign each one carries. */
export const PANTRY_LOG_REASONS = ["bought", "used", "expired", "correction"] as const;
export type PantryLogReason = (typeof PANTRY_LOG_REASONS)[number];

/** The four real barcode lengths — EAN-8, UPC-A, EAN-13, ITF-14. */
export const PANTRY_BARCODE_LENGTHS = [8, 12, 13, 14] as const;

/** Longest item name after trimming. A name is a label, not a description (the `note_folders` bound's reasoning). */
export const MAX_PANTRY_NAME_LENGTH = 80;
/** Longest location name after trimming — „Prva pomoć“ is short, and a shelf is not a sentence. */
export const MAX_PANTRY_LOCATION_NAME_LENGTH = 60;
/**
 * The ceiling on a quantity and on a minimum. Not a semantic limit — five kilos
 * of flour is an ordinary pantry — but an untrusted caller's number goes into a
 * REAL column every read sums, and a bound is cheaper than discovering the
 * absence of one. A million units is above any household by three orders of
 * magnitude.
 */
export const MAX_PANTRY_QUANTITY = 1_000_000;
/** The longest „use within N days“ — ten years, past which the number is a typo rather than a shelf life. */
export const MAX_PANTRY_USE_WITHIN_DAYS = 3_650;
/** Longest note. Free text, bounded so an archive cannot carry a novel in a notes column. */
export const MAX_PANTRY_NOTES_LENGTH = 500;
/** Longest „how to take it“ note. Long enough for „1 tableta ujutru uz obrok“, short enough to read on a card. */
export const MAX_PANTRY_DOSE_NOTE_LENGTH = 300;

/**
 * One stock item's own fields — the shape `validatePantryItem` gates and the
 * fields `@nexus/db`'s `PantryItem` adds an id and three timestamps to.
 *
 * `locationId` is nullable on purpose: an item is still an item when the user
 * has not named a shelf yet, and refusing to record two kilos of flour because
 * there is no „Ostava“ row would be the tail wagging the dog. The shopping list
 * gives those items a group of their own (`pantryStock.ts`).
 */
export interface PantryItemFields {
  readonly locationId: string | null;
  readonly name: string;
  readonly category: PantryCategory;
  /** Decimal, never negative — an item that has run out is 0, not a debt. */
  readonly quantity: number;
  readonly unit: PantryUnit;
  /** Below this the item is „low“, or null when the user tracks no minimum. */
  readonly minQuantity: number | null;
  /** The date printed on the packet, or null when it carries none. */
  readonly expiryDate: string | null;
  /** The day the packet was opened, or null while it is still sealed. */
  readonly openedDate: string | null;
  /** „Use within N days after opening“, or null when the packet does not say. */
  readonly useWithinDays: number | null;
  readonly notes: string | null;
  /** Digits only, 8/12/13/14 of them, or null. Stored as text so leading zeros survive. */
  readonly barcode: string | null;
  /** Medicine only in practice: free text, never parsed and never computed from. */
  readonly doseNote: string | null;
}

/** One quantity change as the log records it. */
export interface PantryChange {
  readonly delta: number;
  readonly reason: PantryLogReason;
}

/**
 * What is wrong with a value, and where. `field` is the caller's own field name
 * so a form can point at the control; `code` says which rule it broke.
 */
export interface PantryProblem {
  readonly field: string;
  readonly code: PantryProblemCode;
}

export type PantryProblemCode =
  /** Missing, or the wrong kind of thing entirely. */
  | "shape"
  /** A number outside what it is allowed to be, or a text past its length. */
  | "range"
  /** Outside `PANTRY_CATEGORIES`. */
  | "category"
  /** Outside `PANTRY_UNITS`. */
  | "unit"
  /** Not 8, 12, 13 or 14 digits. */
  | "barcode"
  /** Not a real calendar day. */
  | "day"
  /** A day after the reference day — an opening date nobody has reached yet. */
  | "future"
  /** Outside `PANTRY_LOG_REASONS`. */
  | "reason";

export function isPantryCategory(value: unknown): value is PantryCategory {
  return typeof value === "string" && (PANTRY_CATEGORIES as readonly string[]).includes(value);
}

export function isPantryUnit(value: unknown): value is PantryUnit {
  return typeof value === "string" && (PANTRY_UNITS as readonly string[]).includes(value);
}

export function isPantryLogReason(value: unknown): value is PantryLogReason {
  return typeof value === "string" && (PANTRY_LOG_REASONS as readonly string[]).includes(value);
}

/** Digits only, and exactly one of the four real lengths — see the file header. */
export function isPantryBarcode(value: string): boolean {
  return (
    (PANTRY_BARCODE_LENGTHS as readonly number[]).includes(value.length) &&
    /^[0-9]+$/.test(value)
  );
}

/**
 * Everything wrong with `value` as a stock item, in a fixed order; an EMPTY
 * array means it passed.
 *
 * `today` is a PARAMETER because „an opening date in the future“ is only
 * knowable against a reference day, and this module reads no clock — the
 * `validateBodyMeasurement` arrangement, restated.
 */
export function validatePantryItem(value: unknown, today: DayKey): readonly PantryProblem[] {
  const problems: PantryProblem[] = [];
  if (!isRecord(value)) return [{ field: "<root>", code: "shape" }];

  nameProblems(value["name"], "name", MAX_PANTRY_NAME_LENGTH, problems);
  enumProblems(value["category"], PANTRY_CATEGORIES, "category", "category", problems);
  enumProblems(value["unit"], PANTRY_UNITS, "unit", "unit", problems);
  numberProblems(value["quantity"], "quantity", 0, MAX_PANTRY_QUANTITY, problems);
  positiveNumberProblems(value["minQuantity"], "minQuantity", MAX_PANTRY_QUANTITY, problems);
  dayProblems(value["expiryDate"], "expiryDate", null, problems);
  dayProblems(value["openedDate"], "openedDate", today, problems);
  integerProblems(value["useWithinDays"], "useWithinDays", 1, MAX_PANTRY_USE_WITHIN_DAYS, problems);
  textProblems(value["notes"], "notes", MAX_PANTRY_NOTES_LENGTH, problems);
  barcodeProblems(value["barcode"], problems);
  textProblems(value["doseNote"], "doseNote", MAX_PANTRY_DOSE_NOTE_LENGTH, problems);
  idProblems(value["locationId"], "locationId", problems);

  return problems;
}

/** Everything wrong with `value` as a location — a name, and nothing else it owns. */
export function validatePantryLocation(value: unknown): readonly PantryProblem[] {
  const problems: PantryProblem[] = [];
  if (!isRecord(value)) return [{ field: "<root>", code: "shape" }];
  nameProblems(value["name"], "name", MAX_PANTRY_LOCATION_NAME_LENGTH, problems);
  return problems;
}

/**
 * Everything wrong with `value` as a quantity change. The SIGN rule is here
 * rather than in the store because stage 2's wire has to refuse by the same
 * rule the store does — see the file header.
 */
export function validatePantryChange(value: unknown): readonly PantryProblem[] {
  const problems: PantryProblem[] = [];
  if (!isRecord(value)) return [{ field: "<root>", code: "shape" }];

  const reason = value["reason"];
  const knownReason = typeof reason === "string" && isPantryLogReason(reason) ? reason : null;
  if (typeof reason !== "string") problems.push({ field: "reason", code: "shape" });
  else if (knownReason === null) problems.push({ field: "reason", code: "reason" });

  const delta = value["delta"];
  if (typeof delta !== "number") {
    problems.push({ field: "delta", code: "shape" });
  } else if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > MAX_PANTRY_QUANTITY) {
    problems.push({ field: "delta", code: "range" });
  } else if (knownReason !== null) {
    // „bought“ must add, „used“ and „expired“ must subtract; a correction is the
    // one reason that carries no sign of its own.
    const wrongSign =
      (knownReason === "bought" && delta < 0) ||
      ((knownReason === "used" || knownReason === "expired") && delta > 0);
    if (wrongSign) problems.push({ field: "delta", code: "range" });
  }

  return problems;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Trims first, so „   “ is a missing name rather than a two-character one. */
function nameProblems(
  value: unknown,
  field: string,
  max: number,
  problems: PantryProblem[],
): void {
  if (typeof value !== "string") {
    problems.push({ field, code: "shape" });
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) problems.push({ field, code: "shape" });
  else if (trimmed.length > max) problems.push({ field, code: "range" });
}

function enumProblems<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  code: PantryProblemCode,
  problems: PantryProblem[],
): void {
  if (typeof value !== "string") problems.push({ field, code: "shape" });
  else if (!(allowed as readonly string[]).includes(value)) problems.push({ field, code });
}

function numberProblems(
  value: unknown,
  field: string,
  min: number,
  max: number,
  problems: PantryProblem[],
): void {
  if (typeof value !== "number") {
    problems.push({ field, code: "shape" });
    return;
  }
  // `Number.isFinite` refuses NaN and the infinities, which a „>= 0 and <= max“
  // test alone would let through for +Infinity's own reason.
  if (!Number.isFinite(value) || value < min || value > max) problems.push({ field, code: "range" });
}

/** Absent (null/undefined) passes; anything else must be a number strictly above zero. */
function positiveNumberProblems(
  value: unknown,
  field: string,
  max: number,
  problems: PantryProblem[],
): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "number") {
    problems.push({ field, code: "shape" });
    return;
  }
  if (!Number.isFinite(value) || value <= 0 || value > max) problems.push({ field, code: "range" });
}

/** Absent passes; anything else must be a whole number in range. */
function integerProblems(
  value: unknown,
  field: string,
  min: number,
  max: number,
  problems: PantryProblem[],
): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "number") {
    problems.push({ field, code: "shape" });
    return;
  }
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    problems.push({ field, code: "range" });
  }
}

/** Absent passes; a value must be a real bare day, and — when `notAfter` is given — not past it. */
function dayProblems(
  value: unknown,
  field: string,
  notAfter: DayKey | null,
  problems: PantryProblem[],
): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "string") {
    problems.push({ field, code: "shape" });
    return;
  }
  if (!isValidDayKey(value)) {
    problems.push({ field, code: "day" });
    return;
  }
  if (notAfter !== null && value > notAfter) problems.push({ field, code: "future" });
}

/** Absent, empty and whitespace-only all pass — they are the same absence. */
function textProblems(
  value: unknown,
  field: string,
  max: number,
  problems: PantryProblem[],
): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "string") {
    problems.push({ field, code: "shape" });
    return;
  }
  if (value.trim().length > max) problems.push({ field, code: "range" });
}

function barcodeProblems(value: unknown, problems: PantryProblem[]): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "string") {
    problems.push({ field: "barcode", code: "shape" });
    return;
  }
  // Deliberately NOT trimmed: a spaced code is refused, not repaired.
  if (!isPantryBarcode(value)) problems.push({ field: "barcode", code: "barcode" });
}

/**
 * An id is bounded, on `MAX_ID_LENGTH`'s terms, and a padded one is refused
 * rather than trimmed — the archive reader's own rule for the same field.
 */
function idProblems(value: unknown, field: string, problems: PantryProblem[]): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "string") {
    problems.push({ field, code: "shape" });
    return;
  }
  if (value !== value.trim() || value.trim().length === 0 || value.length > MAX_ID_LENGTH) {
    problems.push({ field, code: value.length > MAX_ID_LENGTH ? "range" : "shape" });
  }
}
