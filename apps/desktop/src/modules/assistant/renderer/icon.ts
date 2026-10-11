import type { IconName } from "@nexus/ui";

/**
 * The ASSISTANT's mark (ADR-090): the name of a glyph from `@nexus/ui`'s own
 * icon set - a speech bubble with a spark inside it, which is what this module
 * is: something that talks, and knows what it read.
 *
 * The NAME lives here and the drawing lives with the other drawings, on the
 * `timer` glyph's terms: a module that shipped its own SVG would be the first
 * exception to the set's house rules (a 24×24 box, content inside 3…21, stroke
 * only, one weight, round caps and joins), and the whole point of the set is that
 * fifteen module marks read as one family.
 *
 * Eager on purpose, and that is not a contradiction of the lazy-page rule: this
 * file exports a NAME and imports nothing but a type, and the rail needs every
 * module's mark at startup.
 */
export const iconName: IconName = "assistant";
