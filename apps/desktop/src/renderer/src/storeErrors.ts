/**
 * The two things every module's error mapper was re-deriving.
 *
 * `financeErrorMessage`, `fitTrainingError` and `planErrorMessage` all begin the
 * same way — pull the message text out of an unknown rejection, then match the
 * store's own wording, which crosses IPC intact — and the substring they most
 * often needed was the same one. Five stores refuse a duplicate name with
 * „already exists in this profile" (`FinCategoryStore`, `NoteOrgStore` twice,
 * `NoteTemplateStore`, `TaskTagStore`), and until now exactly ONE of the five
 * had a renderer that said so; the other four told the user to „pokušaj
 * ponovo", which is the one action that fails identically forever against a
 * UNIQUE index.
 *
 * These stay predicates rather than a mapper: the SENTENCE belongs to the
 * module, because „a category with that name already exists" and „a template
 * with that name already exists" are different facts about different things.
 * What is shared is how the refusal is recognised.
 */

/** The message text of an unknown rejection — "" when there is none to read. */
export function storeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

/**
 * Whether a store refused because the name is taken. Matched on the store's own
 * wording, which is deliberately identical across the five stores that enforce
 * a per-profile unique name — a shape worth keeping, since it is what makes one
 * predicate enough.
 */
export function isDuplicateNameError(error: unknown): boolean {
  return storeErrorMessage(error).includes("already exists in this profile");
}
