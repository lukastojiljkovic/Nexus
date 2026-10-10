import type { IconName } from "@nexus/ui";

/**
 * BOARDS' mark (ADR-090): the name of a glyph from `@nexus/ui`'s own icon set,
 * which the rail draws beside the module's name and the dashboard card wears on
 * its corner.
 *
 * **Why this is `grid` and not a glyph drawn for the module.** The set's house
 * rules — a 24×24 box, content inside 3…21, stroke only, one weight, round caps
 * and joins — are what make the module marks read as one family, so a new one is
 * added only when nothing in the set fits. `grid` is a two-by-two arrangement of
 * four boxes: it is the board itself, the thing all six games are played on, and
 * it already exists. A drawn „dice" or „disc" would say what ONE of the six games
 * is, which is the wrong claim for a module that ships six.
 *
 * Eager on purpose, and that is not a contradiction of the lazy-page rule: this
 * file exports a NAME and imports nothing but a type, and the rail needs every
 * module's mark at startup. What must stay out of the startup chunk is the
 * module's page and its page copy, not the word „grid".
 */
export const iconName: IconName = "grid";
