import type { IconName } from "@nexus/ui";

/**
 * READER's mark (ADR-090): a name from `@nexus/ui`'s own icon set, which the rail
 * draws beside the module's name and the dashboard card wears on its corner.
 *
 * **`book`, and no new drawing.** The set already carries a closed book, drawn in
 * its house style by the same hand as the other module marks; a reader that
 * shipped its own SVG would be the first exception to the rules that make the set
 * read as one family. `study` is the open book and belongs to the Study module, and
 * modules with the same glyph would be the one thing a module mark cannot be.
 *
 * Eager on purpose: this file exports a NAME and imports nothing but a type, and
 * the rail needs every module's mark at startup. What stays out of the startup
 * chunk is the page and its copy, not the word "book".
 */
export const iconName: IconName = "book";
