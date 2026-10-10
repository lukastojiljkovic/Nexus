import type { IconName } from "@nexus/ui";

/**
 * DRAWINGS' mark (ADR-090): a name from `@nexus/ui`'s own icon set, which the
 * rail draws beside the module's name and the page header watermarks.
 *
 * `drawing` is the set's drafting compass, added with this module: the obvious
 * draws - a sheet, a frame with a stroke in it - are `notes` and `canvas` at
 * 16px, and a mark that cannot be told from a neighbour's is not carrying an
 * identity. What is drawn instead is the instrument, in the set's own house
 * style (24x24 box, content inside 3..21, stroke only, one weight).
 */
export const iconName: IconName = "drawing";
