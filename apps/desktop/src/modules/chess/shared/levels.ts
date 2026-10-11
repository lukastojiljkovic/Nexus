/**
 * The two facts about this module's engine pack that BOTH halves need (ADR-094).
 *
 * They live in `shared/` because neither process owns them: main decides which
 * levels it asks the pack for, and the page marks the same levels in the picker
 * and names the same Settings card when the pack is missing. A threshold written
 * down twice is a threshold that drifts once, and the drift here would be a
 * picker promising something main will not do.
 */

/**
 * The first level the pack plays.
 *
 * Six of eight, and the number is a decision rather than a measurement: levels 1
 * to 5 exist to LOSE to a person learning the game, which is what the window and
 * the blunder chance in `@nexus/core`'s `levels.ts` are for, and an engine at
 * full strength cannot do that. The top three are the levels somebody picks to
 * be beaten by.
 */
export const PACK_FIRST_LEVEL = 6;

/**
 * Where a user installs the pack: the app's own Packs card, under Settings.
 *
 * A POINTER, not a URL, and the same value the drawings module sends for its own
 * pack: a signed pack is a folder the user installs through that card, and a kit
 * page has no navigation of its own (ADR-090 hands a page a profile id and
 * nothing else), so the page names that card in words and the pointer rides the
 * wire as data for whichever surface can act on it.
 */
export const PACK_CATALOGUE_ENTRY = "settings:packs";
