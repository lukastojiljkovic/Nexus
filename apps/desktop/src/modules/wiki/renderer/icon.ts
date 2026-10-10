import type { IconName } from "@nexus/ui";

/**
 * WIKI's mark (ADR-090): the name of a glyph from `@nexus/ui`'s own icon set,
 * which the rail draws beside the module's name and the dashboard card wears on
 * its corner.
 *
 * **Why `globe`, and why no new drawing.** The set already carries one, and it is
 * the right one: what this module holds IS Wikipedia and its siblings, and a
 * globe is what every reader in the world uses for them. The alternative was to
 * draw a fourth book-shaped glyph beside `book`, `study` and `notes` — three
 * shapes that would then be four, at sixteen pixels each, and all of them a
 * smudge apart. The set's house rules are what make the module marks read as one
 * family, and the way to keep them is to use one that is already in it.
 *
 * **Why the name is here rather than in the manifest.** `moduleIcon.ts` records
 * the reason: `@nexus/core` must not learn about a renderer's icon set, and a
 * manifest is core's document. The module's own folder is the right place for a
 * file that is nothing but a renderer-facing name.
 */
export const iconName: IconName = "globe";
