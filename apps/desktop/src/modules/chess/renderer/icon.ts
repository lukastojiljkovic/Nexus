import type { IconName } from "@nexus/ui";

/**
 * CHESS' mark: the name of a glyph from `@nexus/ui`'s own icon set, which the
 * rail draws beside the module's name and the dashboard card wears on its corner.
 *
 * `grid`, and no glyph was added. The set's house rules — a 24 by 24 box,
 * content inside 3 to 21, stroke only, one weight, round caps and joins — are
 * what make the module marks read as one family, and `adding-a-module.md` asks
 * for a new glyph only when none fits. A board IS a grid (eight files against
 * eight ranks, drawn by that very figure), so the module takes the word rather
 * than widening the set with a second name for the same shape.
 */
export const iconName: IconName = "grid";
