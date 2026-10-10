import type { IconName } from "@nexus/ui";

/**
 * MAPS' mark (ADR-090): the name of a glyph from `@nexus/ui`'s own icon set,
 * which the rail draws beside the module's name.
 *
 * **Why the name `globe` and not a new drawing.** The set's house rules — a
 * 24×24 box, content inside 3…21, stroke only, one weight, round caps and joins
 * — are what make the module marks read as one family, and a module that shipped
 * its own SVG would be the first exception to them. `globe` is the set's own
 * mark for a map of a region (the meridian-and-parallel circle), it is already
 * drawn to those rules, and the set has no other glyph this module could
 * honestly borrow: `pin` means a dropped pin, which is what the PAGE draws
 * rather than what the module is.
 *
 * Eager on purpose, and that is not a contradiction of the lazy-page rule: this
 * file exports a NAME and imports nothing but a type, and the rail needs every
 * module's mark at startup.
 */
export const iconName: IconName = "globe";
