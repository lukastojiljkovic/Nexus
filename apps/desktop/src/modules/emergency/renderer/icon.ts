import type { IconName } from "@nexus/ui";

/**
 * EMERGENCY's mark (ADR-090): the name of a glyph from `@nexus/ui`'s own icon
 * set, which the rail draws beside the module's name and the dashboard card wears
 * on its corner.
 *
 * **Why the name is here rather than in the manifest.** `moduleIcon.ts` records
 * the reason: `@nexus/core` must not learn about a renderer's icon set, and a
 * manifest is core's document.
 *
 * **Why `medkit` is a new glyph.** The set had no medical shape at all - the
 * nearest were `person` (a contact, not a patient) and `warning` (a status, not a
 * module) - and a first-aid case is what a card read by a stranger in a hurry is.
 * The drawing lives in the set, with the other drawings, in that file's own house
 * style (24×24 box, content inside 3…21, stroke only, one weight, round caps and
 * joins).
 */
export const iconName: IconName = "medkit";
