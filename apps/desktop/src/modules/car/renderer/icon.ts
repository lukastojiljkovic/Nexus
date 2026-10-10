import type { IconName } from "@nexus/ui";

/**
 * CAR's mark (ADR-090): the name of a glyph from `@nexus/ui`'s own icon set,
 * which the rail draws beside the module's name, the page header watermarks, and
 * the dashboard card wears on its corner.
 *
 * **Why the name is here rather than in the manifest.** `moduleIcon.ts` records
 * the reason: `@nexus/core` must not learn about a renderer's icon set, and a
 * manifest is core's document. The module's own folder is the right place for a
 * file that is nothing but a renderer-facing name.
 *
 * **Why the glyph itself is drawn in `@nexus/ui`.** The set's house rules -- a
 * 24x24 box, content inside 3..21, stroke only, one weight -- are what make the
 * module marks read as one family, and a module that shipped its own SVG would
 * be the first exception to them. `car` is that glyph, added with this module:
 * the set had a wheel (in the sense of a repair) and a wallet, and neither says
 * what this module is about.
 *
 * Eager on purpose: this file exports a NAME and imports nothing but a type, and
 * the rail needs every module's mark at startup. What must stay out of the
 * startup chunk is the page and its copy, not the word "car".
 */
export const iconName: IconName = "car";
