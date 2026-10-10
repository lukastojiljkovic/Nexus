import type { IconName } from "@nexus/ui";

/**
 * ARCADE's mark (ADR-090): the name of a glyph from `@nexus/ui`'s own set, which
 * the rail draws beside the module's name.
 *
 * **Why the name is here rather than in the manifest.** `moduleIcon.ts` records
 * the reason: `@nexus/core` must not learn about a renderer's icon set, and a
 * manifest is core's document. The module's own folder is the right place for a
 * file that is nothing but a renderer-facing name.
 *
 * **Why a new glyph was drawn rather than borrowed.** The set had no mark for
 * "something to play", and every candidate it did have named one of the five
 * games - `grid` is a board, `target` is a goal, `repeat` is a loop. So `arcade`
 * was added to the set's own file, in its own style (24x24 box, content inside
 * 3...21, stroke only, one weight, a circle and two straight shapes), which is
 * the one shared file a module edits by design.
 *
 * Eager on purpose: this file exports a NAME and imports nothing but a type, and
 * the rail needs every module's mark at startup. What must stay out of the
 * startup chunk is the module's page and its page copy, not the word "arcade".
 */
export const iconName: IconName = "arcade";
