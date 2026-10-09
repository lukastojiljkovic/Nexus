/**
 * The structural payload validators every IPC handler shares (SEC-EL-02).
 *
 * **Why they are here rather than in `index.ts`.** They were local to it, and
 * that was fine while every handler lived there too. A module built on the module
 * kit registers its own handlers from its own folder, and the rule is that it gets
 * "the existing validators" - the same functions, with the same rules, not a second
 * set that agrees today. One definition, two importers.
 *
 * Nothing about their behaviour changed in the move: the bodies and the comments
 * below are the ones that stood in `index.ts`, and every handler there imports them
 * from this file.
 *
 * Only the GENERIC ones live here - the checks that are about the wire and about
 * nothing in particular. A validator that knows what a task is, or what a card
 * rating is, stays beside the handlers that use it.
 */

import { MAX_ID_LENGTH } from "@nexus/core";

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid IPC payload: expected an object.");
  }
  return value as Record<string, unknown>;
}
export function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid IPC payload: "${field}" must be a non-empty string.`);
  }
  return value;
}
/**
 * An IDENTIFIER off the wire — a row's own id, a foreign key, a registry key —
 * bounded on `MAX_ID_LENGTH`'s terms.
 *
 * **Every id here used to be a bare `asNonEmptyString`, which caps nothing.** An
 * id is the field nobody thinks of as untrusted input, so it got the check that
 * asks whether the string exists and nothing about what it is. The renderer IS
 * untrusted (SEC-EL), no id column in any migration carries a CHECK past
 * `NOT NULL`, and several handlers write a renderer-supplied key rather than
 * minting one — so the wire is the only bound those values ever meet.
 *
 * Same three questions as the archive reader's `idStr`, because it is the same
 * rule at the other boundary: non-empty, no outer whitespace (nothing in this
 * codebase mints an id with a space on either end, and trimming would forge a
 * key rather than refuse one), and inside `MAX_ID_LENGTH`. `check:ids` is what
 * keeps the next handler from reaching for `asNonEmptyString` again.
 */
export function asId(value: unknown, field: string): string {
  const id = asNonEmptyString(value, field);
  if (id !== id.trim() || id.length > MAX_ID_LENGTH) {
    throw new Error(`Invalid IPC payload: "${field}" is not a well-formed id.`);
  }
  return id;
}
export function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid IPC payload: "${field}" must be a boolean.`);
  }
  return value;
}
/** A plain string field that may be empty (structural check only; semantics stay in the store). */
export function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  return value;
}
/** A nullable optional string field: either a string or an explicit null. */
export function asNullableString(value: unknown, field: string): string | null {
  if (value === null || typeof value === "string") return value;
  throw new Error(`Invalid IPC payload: "${field}" must be a string or null.`);
}
/**
 * The CHARACTER-counting sibling of `asCappedString`, for the caps a store
 * defines in characters rather than bytes.
 *
 * The distinction is not pedantry in this app: every Serbian letter carrying a
 * diacritic — š, č, ć, ž, đ — is two bytes in UTF-8, so a byte cap applied to a
 * character limit refuses legal input, and refuses it *only for text written in
 * the product's own language*. `CARD_TEXT_MAX_LENGTH` is documented as mirroring
 * `CardStore`'s cap, and that cap is 10 000 CHARACTERS (`trimmed.length`), so
 * byte-capping it made the wire stricter than the store it claims to mirror and
 * produced a „must not exceed 10000 bytes" refusal for a card the store would
 * have taken. Found while reviewing UTIL slice b, whose `asFocusLabel` had to
 * dodge the same trap.
 *
 * Rule: match the unit the STORE measures in. A cap named `_BYTES` keeps
 * `asCappedString`; a cap the store checks with `.length` comes here.
 */
export function asCappedChars(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid IPC payload: "${field}" must be a string.`);
  }
  if (value.length > maxChars) {
    throw new Error(`Invalid IPC payload: "${field}" must not exceed ${maxChars} characters.`);
  }
  return value;
}
/** A plain integer field (structural check only; range validation stays in the store). */
export function asInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Invalid IPC payload: "${field}" must be an integer.`);
  }
  return value;
}
/** A `coveredSeq` field: an integer, and additionally ≥ 1 — seq 0 never names a version (ADR-015). */
export function asPositiveInteger(value: unknown, field: string): number {
  const int = asInteger(value, field);
  if (int < 1) {
    throw new Error(`Invalid IPC payload: "${field}" must be a positive integer.`);
  }
  return int;
}
export function asBoundedInteger(value: unknown, field: string, min: number, max: number): number {
  const int = asInteger(value, field);
  if (int < min || int > max) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a whole number between ${min} and ${max}.`,
    );
  }
  return int;
}
