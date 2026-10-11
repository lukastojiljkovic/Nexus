import type { IconName } from "@nexus/ui";

/**
 * TIMERS' mark (ADR-090): the name of a glyph from `@nexus/ui`'s own icon set,
 * which the rail draws beside the module's name and the dashboard card wears on
 * its corner.
 *
 * **Why the name is here rather than in the manifest.** `moduleIcon.ts` records
 * the reason: `@nexus/core` must not learn about a renderer's icon set, and a
 * manifest is core's document. The module's own folder is the right place for a
 * file that is nothing but a renderer-facing name.
 *
 * **Why the glyph itself is drawn in `@nexus/ui` rather than in an SVG here.**
 * The set's house rules - a 24×24 box, content inside 3…21, stroke only, one
 * weight, round caps and joins - are what make fourteen module marks read as one
 * family, and a module that shipped its own SVG would be the first exception to
 * them. So a module BRINGS the choice of glyph and the drawing lives with the
 * other drawings; `timer` is that glyph, added with the module.
 *
 * Eager on purpose, and that is not a contradiction of the lazy-page rule: this
 * file exports a NAME and imports nothing but a type, and the rail needs every
 * module's mark at startup. What must stay out of the startup chunk is the
 * module's page and its page copy, not the word "timer".
 */
export const iconName: IconName = "timer";
