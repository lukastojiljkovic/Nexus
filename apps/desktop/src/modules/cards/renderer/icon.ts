import type { IconName } from "@nexus/ui";

/**
 * CARDS' mark (ADR-090): the name of a glyph from `@nexus/ui`'s own icon set,
 * which the rail draws beside the module's name and the dashboard card wears on its
 * corner.
 *
 * **Why the glyph itself is drawn in `@nexus/ui` rather than in an SVG here.** The
 * set's house rules — a 24×24 box, content inside 3…21, stroke only, one weight,
 * round caps and joins — are what make the module marks read as one family, and a
 * module that shipped its own SVG would be the first exception to them. So a module
 * BRINGS the choice of glyph and the drawing lives with the other drawings; `cards`
 * is that glyph, added with the module: two playing cards laid on each other, which
 * names a card table rather than any one of the nine games on it.
 *
 * Eager on purpose, and that is not a contradiction of the lazy-page rule: this file
 * exports a NAME and imports nothing but a type, and the rail needs every module's
 * mark at startup.
 */
export const iconName: IconName = "cards";
