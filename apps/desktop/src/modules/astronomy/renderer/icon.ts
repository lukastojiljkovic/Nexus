import type { IconName } from "@nexus/ui";

/**
 * ASTRONOMY's mark (ADR-090): the name of a glyph from `@nexus/ui`'s own icon
 * set, which the rail draws beside the module's name and which the page header
 * watermarks behind the title.
 *
 * **Why the name is here and the drawing is not.** `moduleIcon.ts` records the
 * reason a manifest may not name an icon — `@nexus/core` must not learn about a
 * renderer's icon set — and the kit's rule is that a module BRINGS the name
 * while the drawing lives with the other drawings, so every module mark stays one
 * family (24×24 box, content inside 3…21, stroke only, one weight). `planet` is
 * that glyph, drawn with this module: a disc with a ring, because the corner is
 * about the sky rather than about one body in it (`globe` is the Earth, `sun` and
 * `moon` are two of the bodies this module draws).
 *
 * Eager on purpose: this file exports a NAME and imports nothing but a type, and
 * the rail needs every module's mark at startup. What must stay out of the
 * startup chunk is the page and its copy, not the word „planet".
 */
export const iconName: IconName = "planet";
