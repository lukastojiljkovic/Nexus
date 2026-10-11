import type { IconName } from "@nexus/ui";

/**
 * RADIONICA's mark (ADR-090): a name from `@nexus/ui`'s own icon set.
 *
 * **Why `grid` rather than a new glyph.** The set's mark for this errand has to
 * survive three viewers that share nothing else - a printed model, a toolpath
 * and a board - and the one thing they all are is something MEASURED ON A GRID:
 * the STL view stands on one, a board's copper is drawn against one, and a
 * toolpath is a grid of layers. The house rule is that a module adds a glyph
 * only when none fits, and the set already draws that grid; the four glyphs that
 * would say one of the three better (`tools`, `canvas`, `electronics`,
 * `printer`) are each another module's own mark.
 */
export const iconName: IconName = "grid";
