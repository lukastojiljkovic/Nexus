import type { IconName } from "@nexus/ui";

/**
 * TRANSLATOR's mark (ADR-090): a name from `@nexus/ui`'s own icon set, which the
 * rail draws beside the module's name and the page header watermarks.
 *
 * `book` is the set's closed book, drawn to the same house rules as the other
 * marks. It is deliberately NOT a new glyph: a dictionary is a book, the set
 * already has one, and adding a second drawing of the same idea is how an icon
 * set stops reading as one family.
 */
export const iconName: IconName = "book";
