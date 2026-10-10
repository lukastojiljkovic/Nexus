import type { IconName } from "@nexus/ui";

/**
 * SIGNALS' mark (ADR-090): the name of a glyph from `@nexus/ui`'s own icon set,
 * which the rail draws beside the module's name and the page header watermarks.
 *
 * **Why the name is here and the drawing is not.** `moduleIcon.ts` records the
 * reason a manifest may not name an icon - `@nexus/core` must not learn about a
 * renderer's icon set - and the kit's rule is that a module BRINGS the name
 * while the drawing lives in the set, so fourteen module marks stay one family
 * (24x24 box, content inside 3…21, stroke only, one weight, round caps and
 * joins). `signal` is that glyph, drawn with this module.
 *
 * Eager on purpose: this file exports a NAME and imports nothing but a type, and
 * the rail needs every module's mark at startup. What must stay out of the
 * startup chunk is the page and its copy, not the word „signal".
 */
export const iconName: IconName = "signal";
