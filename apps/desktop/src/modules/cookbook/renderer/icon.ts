import type { IconName } from "@nexus/ui";

/**
 * COOKBOOK's mark (ADR-090): the name of a glyph from `@nexus/ui`'s own icon
 * set, which the rail draws beside the module's name and the dashboard card
 * wears on its corner.
 *
 * The drawing lives with the other drawings — `packages/ui`'s house rules (a
 * 24×24 box, content inside 3…21, stroke only, one weight, round caps and joins)
 * are what make the module marks read as one family — and this file brings only
 * the choice: a pot, because the glyph the cookbook would otherwise reach for is
 * a book, and a library module owns that one.
 *
 * Eager on purpose, and that is not a contradiction of the lazy-page rule: this
 * file exports a NAME and imports nothing but a type, and the rail needs every
 * module's mark at startup. What must stay out of the startup chunk is the
 * module's page and its page copy, not the word "cookbook".
 */
export const iconName: IconName = "cookbook";
