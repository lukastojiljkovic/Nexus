import type { IconName } from "@nexus/ui";

/**
 * CULTURE's mark (ADR-090): the name of a glyph from `@nexus/ui`'s own icon
 * set, which the rail draws beside the module's name and the page header wears
 * as its watermark.
 *
 * `museum` is the glyph this module brought: a pediment over a colonnade, drawn
 * to the set's house rules. None of the existing marks fits - `book` is STUDY's
 * and a library shelf, `star` and `palette` say nothing about going somewhere -
 * and a culture corner's own mark should be the building a person goes into.
 *
 * Eager on purpose: this file exports a NAME and imports nothing but a type, so
 * the rail can wear every module's mark at startup without loading a page.
 */
export const iconName: IconName = "museum";
