/**
 * What a recipe IS as a document: its course, where it came from, and the
 * attribution an imported one must carry. The line shapes it is built from —
 * ingredients and steps — live beside it in this folder; the store is what puts
 * them together and validates length.
 *
 * **Licence is provenance, not decoration, and it is a FIELD rather than a
 * note.** Nexus ships its own recipes and, later, well-known recipes from openly
 * licensed sources; the licence identifier is the one fact that decides whether a
 * recipe may travel in an export, be shown beside its attribution, or be edited
 * at all. Modelled as a sentence in a notes column it would be unqueryable, and
 * a source whose licence was recorded in prose is a source nobody can re-check.
 *
 * **`imported` and `own` are the whole of the vocabulary.** A recipe the user
 * typed is theirs, and has no attribution to show; one that came from a source
 * carries that source's title, author, url, licence and attribution sentence, all
 * five of them (the store refuses a partial one). There is deliberately no third
 * kind such as „unknown" — a recipe whose licence is not recorded is exactly the
 * state the licence columns exist to make unrepresentable, and inventing a
 * mid-state would let one be written.
 *
 * Nothing here reads a clock, touches a DOM or imports `node:` anything.
 */

/**
 * The closed set of courses — what a recipe is FOR in a meal. Closed for the
 * reason `FOOD_CATEGORIES` gives: a course outside this list is refused rather
 * than absorbed, which is what stops a page that groups by course from growing a
 * silent „ostalo" bucket the designer never drew. `other` is present and last
 * because a real recipe does sometimes belong to none of the ten.
 */
export const COOKBOOK_COURSES = [
  "breakfast",
  "starter",
  "soup",
  "main",
  "side",
  "salad",
  "dessert",
  "baking",
  "drink",
  "preserve",
  "other",
] as const;

export type CookbookCourse = (typeof COOKBOOK_COURSES)[number];

/** Where a recipe came from: the user typed it, or it was imported from a source that has a licence. */
export const RECIPE_SOURCES = ["own", "imported"] as const;

export type RecipeSource = (typeof RECIPE_SOURCES)[number];

/**
 * The identifier a work with no licence to cite is recorded under. Not an SPDX
 * identifier — SPDX has no term for a work whose copyright has simply expired,
 * and the module's own name for it is honest about being the module's own.
 */
export const PUBLIC_DOMAIN_LICENCE_ID = "public-domain";

/**
 * Where an imported recipe came from, and the sentence the licence obliges the
 * app to show. All five fields are required for an imported recipe, because a
 * source that named no author, or a licence nobody recorded, is a source the
 * user cannot check — and the attribution is what most open licences actually
 * require in exchange for the recipe.
 */
export interface RecipeLicence {
  /** The work the recipe was imported from. */
  readonly title: string;
  /** Who wrote it — a person or an organisation, as the source states it. */
  readonly author: string;
  /** Where to find it. */
  readonly url: string;
  /** An SPDX identifier (`CC-BY-SA-4.0`) or `public-domain`. */
  readonly licenceId: string;
  /** The attribution line the licence requires the app to show beside the recipe. */
  readonly attribution: string;
}

/**
 * One ordered step of a recipe, with an optional timer the page can run. The
 * timer is minutes because that is what a recipe prints; the renderer converts
 * to seconds at the one place a clock is read.
 */
export interface RecipeStep {
  readonly text: string;
  /** How long this step takes, in whole minutes, or null when the step has no duration to time. */
  readonly timerMinutes: number | null;
}

/**
 * The longest identifier this module accepts. Real SPDX identifiers are far
 * shorter — the longest is well under half this — and the bound exists so an
 * untrusted string cannot be an essay stored under the name of a licence.
 */
const MAX_LICENCE_ID_LENGTH = 64;

/**
 * `[A-Za-z0-9]` first, then letters, digits, `.`, `+` and `-`. That is SPDX's
 * own idstring grammar (an id may not begin with a separator), and it is checked
 * by shape rather than against a list of identifiers: SPDX adds licences every
 * year, and a hand-kept list beside a standard fails by omission.
 */
const LICENCE_ID = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;

/**
 * Whether a string is a licence identifier this module records: an SPDX idstring
 * or `public-domain`. Case is the source's business and is only shape-checked —
 * SPDX identifiers are matched case-insensitively, and lower-casing somebody
 * else's identifier would be editing a citation.
 */
export function isRecipeLicenceId(value: string): boolean {
  if (value.length === 0 || value.length > MAX_LICENCE_ID_LENGTH) return false;
  return value === PUBLIC_DOMAIN_LICENCE_ID || LICENCE_ID.test(value);
}
