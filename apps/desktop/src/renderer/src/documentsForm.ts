import type { DocumentFieldChanges, DocumentType, NewDocumentFields } from "../../shared/ipc.js";

// --- The document form's own logic, without the panel ----------------------
//
// `DocumentsPanel` draws the form and holds its drafts; this module owns what
// the form MEANS — the ladder a type defaults to, what a chip click does to
// that ladder, and the two payloads the wires carry. It is here rather than in
// the panel because React components are not covered by this repository's test
// setup on purpose (`vitest.config.ts`: no DOM library), and `reminderOffsets`
// is exactly the field this form once failed to send at all — a bug that a
// test over these functions would have caught, and that watching the form by
// eye did not.

/**
 * Per-type default reminder ladders, mirrored from `@nexus/db` (SEC-EL-02: the
 * renderer imports no DB code). This is what the chips show while the form is
 * still following the type — shown rather than merely known because the store
 * applies this very table when a create carries no `reminderOffsets`. Touch no
 * chip and the store writes its own copy of this; a drift between the two
 * tables is then a chip row promising a lead time the document will not have.
 */
export const DEFAULT_REMINDER_LADDERS: Record<DocumentType, readonly number[]> = {
  licna_karta: [90, 30, 7],
  pasos: [90, 30, 7],
  vozacka: [90, 30, 7],
  registracija: [30, 14, 3],
  kartica: [30, 7],
  polisa: [30, 7],
  custom: [30, 7],
};

/**
 * The offered lead times, in whole DAYS before the rok — the union of every
 * value the per-type defaults use (3, 7, 14, 30, 90) plus 1. It differs from
 * TASK's ladder in exactly one place, and deliberately: there is no 0 chip. A
 * warning on the day a document expires arrives when there is nothing left to do
 * about it, and a task's due day is the day the task is about.
 */
export const REMINDER_LADDER: readonly number[] = [1, 3, 7, 14, 30, 90];

/**
 * The chips to draw: the fixed ladder plus every offset the edited document
 * carries that the ladder cannot say, in ascending order. Without that union an
 * edit would silently drop a lead time merely because no chip could express it.
 */
export function reminderChoices(selected: readonly number[]): number[] {
  const extra = selected.filter((days) => !REMINDER_LADDER.includes(days));
  return [...new Set([...REMINDER_LADDER, ...extra])].sort((a, b) => a - b);
}

/**
 * The ladder the chips draw and the form will send: the user's own once a chip
 * has been touched (`null` is the untouched state), the type's default until
 * then. The same rule `DocumentStore.create` applies, where the default is used
 * only when the create carries no `reminderOffsets` — so the untouched state IS
 * the store's default, and the chips show it as their SELECTION rather than
 * leaving every chip unlit: a new pasoš has to read as 90, 30 and 7 days,
 * because that is what it is about to be created with.
 */
export function ladderFor(chosen: readonly number[] | null, docType: DocumentType): readonly number[] {
  return chosen ?? DEFAULT_REMINDER_LADDERS[docType];
}

/**
 * One chip. The first click is what makes the ladder the user's: up to it the
 * form was SHOWING the type's default, and from it the chips and the record are
 * one list. Un-ticking a chip is therefore also a decision — the result becomes
 * `[]`, which is a real answer („no warning at all“) and not the same thing as
 * the `null` above.
 */
export function toggleReminder(
  chosen: readonly number[] | null,
  docType: DocumentType,
  days: number,
): number[] {
  const current = ladderFor(chosen, docType);
  return current.includes(days)
    ? current.filter((offset) => offset !== days)
    : [...current, days];
}

/** What the shared form has collected, before either payload is shaped from it. */
export interface DocumentFormValues {
  docType: DocumentType;
  label: string;
  expiryDate: string;
  /** Already trimmed; an empty one means „no notes“, not an empty string. */
  notes: string;
  /** Already resolved through `ladderFor`, so this is what the user sees. */
  ladder: readonly number[];
}

/**
 * The create payload. The ladder always travels, touched or not: untouched,
 * `values.ladder` IS the type's default, which the chips above are showing as
 * their selection — so this is not the form second-guessing the store's own
 * table, it is the form writing the row the user was looking at while they made
 * it. (The two agree today, and the moment they stop agreeing, the one that must
 * win is the one on screen: a document created under a chip row that promised
 * 90/30/7 and got something else is a record nobody can account for.)
 *
 * Notes are only sent when present (`exactOptionalPropertyTypes`), and absent
 * means the store's own null.
 */
export function newDocumentFields(values: DocumentFormValues): NewDocumentFields {
  const fields: NewDocumentFields = {
    docType: values.docType,
    label: values.label,
    expiryDate: values.expiryDate,
    reminderOffsets: [...values.ladder],
  };
  if (values.notes.length > 0) fields.notes = values.notes;
  return fields;
}

/**
 * The edit payload. The ladder travels here too, and in edit mode it IS the
 * record's own — the panel loaded it when the row was opened — so a type change
 * made on this form cannot overwrite the lead times the document was stored
 * with. An empty ladder is how the last warning is cleared, which is why it is
 * sent as `[]` rather than left out.
 */
export function documentFieldChanges(values: DocumentFormValues): DocumentFieldChanges {
  return {
    docType: values.docType,
    label: values.label,
    expiryDate: values.expiryDate,
    reminderOffsets: [...values.ladder],
    // Empty notes clear the stored value; a non-empty one sets it.
    notes: values.notes.length > 0 ? values.notes : null,
  };
}
