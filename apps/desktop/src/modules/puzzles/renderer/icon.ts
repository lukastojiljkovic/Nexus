import type { IconName } from "@nexus/ui";

/**
 * PUZZLES' mark (ADR-090): a glyph from `@nexus/ui`'s own icon set, drawn beside
 * the module's name in the rail and watermarked on the page header.
 *
 * **No glyph was added for this module, and the reason is the set's own.** The
 * house rules a module mark is drawn to — a 24×24 box, content inside 3…21,
 * stroke only, one weight, round caps and joins — describe a vocabulary of
 * geometry, and a sudoku board, a nonogram and the turtle are all grids of
 * squares. `grid` already says that, and it is the same shape at the one scale a
 * 16px rail row can carry. Adding a second grid-shaped glyph would be the first
 * exception to a family that exists precisely because nobody made one.
 *
 * Eager on purpose, and that is not a contradiction of the lazy-page rule: this
 * file exports a NAME and imports nothing but a type, and the rail needs every
 * module's mark at startup. What stays out of the startup chunk is the module's
 * page and its page copy, not the word „grid".
 */
export const iconName: IconName = "grid";
