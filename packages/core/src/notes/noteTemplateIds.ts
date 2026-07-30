/**
 * The ids of the five built-in note templates (ADR-016 / NOTE-009), lifted out
 * of the renderer so more than one package can name them without respelling
 * them (ADR-036).
 *
 * A built-in template is code, not a row: it has no `note_templates` record to
 * point a foreign key at, which is exactly why `note_folders.default_template_id`
 * (migration 028) is deliberately NOT a foreign key — it may name one of these
 * constants OR a stored row's id. `NoteOrgStore.setDefaultTemplate` validates a
 * candidate against the union of the two, and it must check these ids against
 * the same list the renderer builds its templates from; two hand-written copies
 * of five string literals could only ever drift apart, and the drift would be
 * silent (a folder whose default template simply never applies).
 *
 * Only the ids live here. The templates' Serbian names and their ProseMirror
 * bodies stay in the renderer, where the editor that has to render them lives.
 */

export const BUILTIN_NOTE_TEMPLATE_IDS = [
  "builtin:sastanak",
  "builtin:dnevnik",
  "builtin:recept",
  "builtin:predmet",
  "builtin:projekat",
] as const;

export type BuiltinNoteTemplateId = (typeof BUILTIN_NOTE_TEMPLATE_IDS)[number];

/** Narrows an arbitrary string to a built-in template id — never an `as` cast. */
export function isBuiltinNoteTemplateId(value: string): value is BuiltinNoteTemplateId {
  return BUILTIN_NOTE_TEMPLATE_IDS.some((id) => id === value);
}
