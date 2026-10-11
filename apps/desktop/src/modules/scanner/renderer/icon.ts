import type { IconName } from "@nexus/ui";

/**
 * SKENER's mark (ADR-090): a name from `@nexus/ui`'s own icon set, which the
 * rail draws beside the module's name and the page header wears.
 *
 * **Why a new glyph rather than one of the existing ones.** The set already had
 * a photo (`image`), a search (`search`), an eye (`eye`) and a book (`book`),
 * and not one of them says "a machine is reading this rectangle": a photo is
 * what a camera took, and recognition is what happens to it afterwards. So the
 * set gains `scan` - the document frame with a reading line across it - drawn
 * in the set's own style (24x24 box, content inside 3..21, stroke only, one
 * weight, round caps and joins), which is the one shared file a module touches
 * by design.
 *
 * Eager on purpose: this file exports a NAME and imports nothing but a type.
 * What must stay out of the startup chunk is the module's page and its copy,
 * not the word "scan".
 */
export const iconName: IconName = "scan";
