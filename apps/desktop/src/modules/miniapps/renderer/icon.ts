import type { IconName } from "@nexus/ui";

/**
 * MINI-APPS' mark (ADR-090): the name of a glyph from `@nexus/ui`'s own icon
 * set, which the rail draws beside the module's name and the page header
 * watermarks behind its title.
 *
 * **Why the name is here rather than in the manifest.** `@nexus/core` must not
 * learn about a renderer's icon set, and a manifest is core's document - so the
 * module's own folder is the right place for a file that is nothing but a
 * renderer-facing name.
 *
 * `grid` is the module's own subject rather than a metaphor: what the module IS
 * is a grid of small tools, and the set already draws a grid to one house
 * vocabulary (24x24 box, content inside 3..21, stroke only, round caps). A glyph
 * of its own would be the first exception to that vocabulary for no gain.
 *
 * Eager on purpose, and that is not a contradiction of the lazy-page rule: this
 * file exports a NAME and imports nothing but a type, and the rail needs every
 * module's mark at startup.
 */
export const iconName: IconName = "grid";
