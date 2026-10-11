import type { IconName } from "@nexus/ui";

/**
 * BIBLIOTEKA's mark (ADR-090): the name of a glyph from `@nexus/ui`'s own icon
 * set, which the rail draws beside the module's name and the dashboard card
 * wears on its corner.
 *
 * **Why the name is here rather than in the manifest.** `moduleIcon.ts` records
 * the reason: `@nexus/core` must not learn about a renderer's icon set, and a
 * manifest is core's document. The module's own folder is the right place for a
 * file that is nothing but a renderer-facing name.
 *
 * **Why `book` and no new glyph.** The set already draws one for a book, in the
 * shape the module's subject has: this module is about what a person reads, and
 * a second glyph for "the library" drawn beside it would be two marks for one
 * thing. The three kinds are told apart on the page by a word each (`copy.kinds`),
 * not by a glyph, so nothing here needs a film or a series mark either.
 *
 * Eager on purpose: this file exports a NAME and imports nothing but a type, and
 * the rail needs every module's mark at startup.
 */
export const iconName: IconName = "book";
