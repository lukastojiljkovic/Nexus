import { extname } from "node:path";
import {
  WORKSHOP_MAX_BATCH_BYTES,
  WORKSHOP_MAX_BATCH_FILES,
  WORKSHOP_MAX_FILE_BYTES,
  type WorkshopFileKind,
  type WorkshopPickedFile,
} from "../shared/workshopFiles.js";

/**
 * The pure half of the WORKSHOP module's file handlers: everything `files.ts`
 * decides that is not a dialog.
 *
 * **Why it is a separate file.** `files.ts` imports `electron`, and a module
 * that imports `electron` cannot be loaded by the test runner — so the parts of
 * it with a right and a wrong answer would be covered by nothing. Those parts
 * are exactly the ones a hostile renderer meets: what a payload may be, and
 * what a file on disk may be called. They live here, where `files.test.ts` can
 * drive them, and `files.ts` keeps only the dialog calls and the writes.
 */

/**
 * The longest name a written file may have, in characters.
 *
 * `attachments.ts`'s own `MAX_SANITIZED_NAME_LENGTH`, copied for the same
 * reason that module copies `MAX_NOTE_ATTACHMENT_BYTES`: this is one app-wide
 * rule about names, and a second number would be a second answer. The
 * sanitizer itself is NOT copied — `files.ts` imports it from `attachments.ts`
 * — because a security rule with two implementations is a rule that will
 * disagree with itself one day.
 */
export const WORKSHOP_NAME_MAX_LENGTH = 200;

/**
 * The `attempt`-th candidate name for a file: the name itself, then a numbered
 * sibling.
 *
 * The save-a-batch path never overwrites: it asks the filesystem for each
 * candidate with `wx` (create, fail if present) and takes the first that
 * exists-free, which is a check the OS performs atomically where a "list the
 * folder, then write" would be a race. This function is the naming half of
 * that loop, kept pure so the arithmetic (where the number goes, and what the
 * length cap does to a long base) has a test.
 *
 * The number goes before the extension — `report (2).pdf`, not
 * `report.pdf (2)` — because the extension is what the OS reads to decide
 * which application opens the file. A base that has to be truncated is
 * truncated so that the number and the extension both survive: those two are
 * the parts that make the name a usable file name rather than a description of
 * one.
 */
export function numberedFileName(name: string, attempt: number): string {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError("A file-name attempt is a whole number from one upwards.");
  }
  if (attempt === 1) return name;
  const extension = extname(name);
  const base = name.slice(0, name.length - extension.length);
  const suffix = ` (${attempt})`;
  const room = Math.max(1, WORKSHOP_NAME_MAX_LENGTH - extension.length - suffix.length);
  return `${base.slice(0, room)}${suffix}${extension}`;
}

/** The closed list of picks, as a value rather than a cast: anything else is `null` and refused by name. */
export function asFileKind(value: unknown): WorkshopFileKind | null {
  if (value === "pdf" || value === "image") return value;
  return null;
}

/**
 * Bytes off the wire: a genuine, non-empty `Uint8Array` no larger than the cap.
 *
 * `instanceof` rather than a duck-type, because what arrives over Electron's
 * structured clone IS a `Uint8Array` and nothing else is: a renderer sending
 * `{ 0: 37, 1: 80, byteLength: 2 }` has sent an object, and a validator that
 * accepted it would hand the writer something `fs.writeFile` will not take.
 */
export function asBytes(value: unknown, field: string, maxBytes: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new Error(`Invalid IPC payload: "${field}" must be a non-empty Uint8Array.`);
  }
  if (value.byteLength > maxBytes) {
    throw new Error(`Invalid IPC payload: "${field}" must not exceed ${maxBytes} bytes.`);
  }
  return value;
}

/** A name off the wire, before it is sanitized: a non-empty string, capped so no handler loops over megabytes of it. */
export function asSuggestedName(
  validators: { asString(value: unknown, field: string): string; asCappedChars(value: unknown, field: string, maxChars: number): string },
  value: unknown,
): string {
  return validators.asCappedChars(
    validators.asString(value, "suggestedName"),
    "suggestedName",
    WORKSHOP_NAME_MAX_LENGTH,
  );
}

/**
 * The three bounds one batch is checked against.
 *
 * Parameters with a default rather than constants read inside: the batch's own
 * totals are what a test has to be able to reach, and a test that had to
 * allocate 200 MB to prove the total is enforced would be a test nobody could
 * afford to run. `WORKSHOP_BATCH_LIMITS` is the real one and the handlers pass
 * nothing else.
 */
export interface BatchLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxBytes: number;
}

/** The caps the app actually uses, in one place so the handlers name them once. */
export const WORKSHOP_BATCH_LIMITS: BatchLimits = {
  maxFiles: WORKSHOP_MAX_BATCH_FILES,
  maxFileBytes: WORKSHOP_MAX_FILE_BYTES,
  maxBytes: WORKSHOP_MAX_BATCH_BYTES,
};

/**
 * The whole list a batch save carries, validated as one payload.
 *
 * Both caps are enforced here rather than per file, because they are the
 * interesting bounds: a renderer that sent 20 valid 50 MB files would have main
 * hold a gigabyte, and the batch's own total is what the user was told.
 */
export function asBatchFiles(
  value: unknown,
  limits: BatchLimits = WORKSHOP_BATCH_LIMITS,
): readonly WorkshopPickedFile[] {
  if (!Array.isArray(value)) {
    throw new Error('Invalid IPC payload: "files" must be an array.');
  }
  if (value.length === 0) {
    throw new Error('Invalid IPC payload: "files" must not be empty.');
  }
  if (value.length > limits.maxFiles) {
    throw new Error(
      `Invalid IPC payload: "files" must not hold more than ${limits.maxFiles} files.`,
    );
  }
  const files: WorkshopPickedFile[] = [];
  let total = 0;
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`Invalid IPC payload: "files[${index}]" must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const name = record.name;
    if (typeof name !== "string" || name.length === 0 || name.length > WORKSHOP_NAME_MAX_LENGTH) {
      throw new Error(
        `Invalid IPC payload: "files[${index}].name" must be a non-empty string of at most ${WORKSHOP_NAME_MAX_LENGTH} characters.`,
      );
    }
    const bytes = asBytes(record.bytes, `files[${index}].bytes`, limits.maxFileBytes);
    total += bytes.byteLength;
    if (total > limits.maxBytes) {
      throw new Error(
        `Invalid IPC payload: "files" must not hold more than ${limits.maxBytes} bytes.`,
      );
    }
    files.push({ name, bytes });
  }
  return files;
}
