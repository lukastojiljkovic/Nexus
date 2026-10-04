/**
 * FIT's food vocabulary: what a food IS, what makes one believable, and the two
 * pieces of arithmetic every surface that reads one shares.
 *
 * **`carbs` is carbohydrate BY DIFFERENCE, verbatim from the cited source, and
 * therefore INCLUDES `fiber`.** That single decision is what makes every number
 * in the catalogue re-checkable: the source carries a url, and a reader who
 * opens it must find the value that is written here — not one this module
 * derived by subtracting fibre out of it. Verified on the Foundation walnut
 * (FDC 2346394): `carbs 10.91` against `fiber 5.21`, the fibre a COMPONENT of
 * the carbohydrate figure rather than something to add to it. `fiber ≤ carbs` is
 * enforced below rather than left as folklore, and nothing anywhere adds the two
 * together.
 *
 * **Drinks are per 100 MILLILITRES.** There is no second unit and no density
 * column: a millilitre of a drink is logged as a gram, by stated convention, and
 * each drink entry says so in its own `notes`. Modelling volume properly would
 * mean a density per drink — a number nobody publishes for „domaći sok" — so the
 * convention is written down instead of guessed at.
 *
 * **The catalogue this vocabulary describes ships INSIDE the app and is not
 * database rows.** Several hundred Serbian and generic foods with sourced
 * values live in `data/catalogue.json`; seeding them into every profile's
 * encrypted database — and from there into every export archive — would make app
 * data masquerade as the user's own. Users add their own foods when something is
 * missing; that is a designed part of the product, and `@nexus/db`'s `fit_foods`
 * is the table for exactly those.
 *
 * Nothing here reads a clock, touches a DOM or imports `node:` anything: it is
 * the pure half, and the store, the page and the widget all sit on top of it.
 */

import { foldSearchText } from "../search/searchText.js";

/**
 * The closed set of shelves a food can sit on. Serbian keys, because they are
 * DATA rather than copy — the catalogue is a Serbian dataset and a key spelled
 * in English would need a second mapping nobody would keep in step.
 *
 * Closed on purpose: a category outside this list is refused rather than
 * absorbed, which is what keeps a page that groups by category from growing a
 * silent "ostalo" bucket the designer never drew.
 */
export const FOOD_CATEGORIES = [
  "zitarice",
  "pekarsko",
  "testenina",
  "mahunarke",
  "povrce",
  "voce",
  "meso",
  "riba",
  "jaja",
  "mlecno",
  "orasasti",
  "masti",
  "slatkisi",
  "grickalice",
  "pica",
  "jela",
  "zacini",
] as const;

export type FoodCategory = (typeof FOOD_CATEGORIES)[number];

/**
 * What 100 g of a food carries. Seven numbers and no eighth: `kcal` is the
 * stated energy, the three macros are grams, `fiber` and `sugar` are grams that
 * sit INSIDE `carbs` (see the file header), and `sodiumMg` is milligrams
 * because a gram figure for sodium would be four leading zeros on every label.
 *
 * Deliberately per 100 g rather than per serving: a serving is a presentation
 * choice that differs between two packets of the same thing, while 100 g is the
 * basis every European label and every USDA row already agrees on — so this is
 * the number that can be compared, scaled and summed without a conversion step
 * where a mistake could hide.
 */
export interface FoodMacros {
  readonly kcal: number;
  readonly protein: number;
  readonly carbs: number;
  readonly fat: number;
  readonly fiber: number;
  readonly sugar: number;
  readonly sodiumMg: number;
}

/** Zero of everything — what an empty sum and a zero-gram portion both come to. One shared value; nothing here mutates a `FoodMacros`. */
export const EMPTY_MACROS: FoodMacros = Object.freeze({
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: 0,
  sugar: 0,
  sodiumMg: 0,
});

/**
 * A household measure of one food — „1 kašika", „1 srednja", „1 kriška" — and
 * what it weighs. The label is Serbian and the grams are the number the log
 * actually uses: a serving is a shortcut for typing a gram weight, never a
 * second unit the arithmetic has to understand.
 *
 * An EMPTY list is a legitimate answer. Brašno and ulje are weighed and poured;
 * inventing „1 komad" for them would be inventing data.
 */
export interface FoodServing {
  /** The Serbian label the catalogue ships. */
  readonly label: string;
  /**
   * The same label in English, or undefined for a serving the user typed
   * themselves. Optional rather than required because a profile's own food
   * (a different type, sharing this shape) has no English to carry.
   */
  readonly labelEn?: string;
  readonly grams: number;
}

/**
 * One ingredient of a derived food, carrying its OWN numbers and its own url.
 * That is what makes a computed dish checkable: a reader can open each
 * component's source, weigh the recipe themselves and arrive at the same
 * per-100 g figures, which no single citation on the dish could ever give them.
 */
export interface RecipeComponent {
  /** What went in, named the way the recipe names it. */
  readonly what: string;
  /** How much of it, in grams, before cooking. */
  readonly grams: number;
  readonly per100g: FoodMacros;
  readonly url: string;
}

/**
 * Where a food's numbers came from. Three shapes, and the third is a documented
 * exception rather than a loophole.
 *
 * The two ordinary ones: somebody measured this food (`usda`/`official`, and the
 * url is the row they published), or somebody computed it from foods that were
 * measured (`derived`, and the recipe plus every component's own url is the
 * working).
 *
 * **`stated` is a number the founder decided to ship where no public source
 * pins one down**, and it exists because of one food. Kajmak appears in no
 * public-domain composition table; published Serbian figures span 40–55% fat
 * young and 60–70% ripened, the standard sets only floors, and kajmak is
 * neither sour cream nor butter, so there is nothing honest to substitute. The
 * data lane's correct answer was to DROP it, and it did. The founder overruled
 * that — „stavi da je kajmak 50% masti uz napomenu da varira" — because a food
 * this common being simply absent serves the user worse than a labelled
 * midpoint does.
 *
 * The standing rule („a number nobody can re-check is a number this app does not
 * ship") is not weakened by this, because a `stated` food does not pretend to be
 * measured: it carries no url to imply one, and it must declare `basis` (who
 * decided, on what) and `range` (the published spread the single figure sits
 * inside). **The uncertainty is a FIELD, not a footnote** — the same principle
 * that made provenance a field. A `stated` entry is a prompt to the user to
 * enter their own if they weigh it, which the module already supports.
 *
 * Adding a `stated` food is a founder decision each time, never a lane's
 * shortcut when sourcing turns out to be hard.
 *
 * A USDA `url` is the `fdc.nal.usda.gov/food-details/{id}/nutrients` form, which
 * opens correctly in a browser but answers a SOFT 404 to a plain HTTP client
 * (the site serves its single-page shell under a 404 status). Never point an
 * automated link checker at these: it would report every citation in the
 * catalogue as dead.
 */
export type FoodSource =
  | { readonly kind: "usda" | "official"; readonly ref: string; readonly url: string }
  | {
      readonly kind: "derived";
      /** What the recipe yields, in grams — cooked, since that is what gets eaten and weighed. */
      readonly yieldGrams: number;
      readonly recipe: readonly RecipeComponent[];
    }
  | {
      readonly kind: "stated";
      /** Who decided this figure and on what basis — never blank. */
      readonly basis: string;
      /** The published spread the figure sits inside, so the uncertainty ships with the value. */
      readonly range: string;
    };

const SOURCE_KINDS: readonly string[] = ["usda", "official", "derived", "stated"];

/**
 * One catalogue food.
 *
 * `id` is a stable kebab-case ASCII slug and is what a logged meal REFERS to
 * (`catalogue:<id>`), so renaming a food is free and re-slugging one is not —
 * the log would stop finding it. ASCII rather than the Serbian name folded,
 * because a slug that changed when the folding table changed would silently
 * orphan history.
 *
 * There is no field, flag or override for „this number looks odd". `notes` is
 * that field: it is the ONE thing that licenses an entry whose calories its
 * macros cannot explain (see `validateFoodEntry`), and being a sentence rather
 * than a boolean it also survives the export and can be shown to a user asking
 * where a number came from.
 */
export interface FoodEntry {
  readonly id: string;
  readonly name: string;
  /**
   * The English name, beside the Serbian one for the same reason `strings.en`
   * sits beside `strings.sr`: the renderer picks by the active locale, and the
   * catalogue gate proves every shipped entry carries it.
   */
  readonly nameEn: string;
  readonly category: FoodCategory;
  readonly per100g: FoodMacros;
  readonly servings: readonly FoodServing[];
  readonly source: FoodSource;
  /**
   * Free Serbian prose: what the entry covers, how it was prepared, why a
   * per-100 ml drink is logged in grams — and, when the Atwater estimate misses
   * the published calories by more than 10 %, WHY. That last use is not
   * decoration: it is what makes the deviation pass the gate.
   */
  readonly notes: string;
  /** The English note. Mirrors `notes`; empty exactly when `notes` is empty. */
  readonly notesEn: string;
}

/**
 * What a logged meal item POINTS AT. Two kinds, because there are two places a
 * food can live: the catalogue that ships inside the app, and the profile's own
 * `fit_foods` table.
 *
 * It travels as text (`catalogue:jaje-celo-sirovo`, `user:<uuid>`) and is
 * deliberately NOT a foreign key: the catalogue is not a table at all, and a
 * user food may be soft-deleted while the meal that used it stays true. The item
 * carries the food's name and its macros as a snapshot beside this, so the
 * reference is provenance — „which food was this" — rather than the thing that
 * makes the row readable.
 *
 * The grammar lives here, in `@nexus/core`, so the store that writes it and the
 * interchange reader that re-validates it share ONE definition rather than two
 * copies that could drift on what a legal reference is.
 */
export type FoodRef =
  | { readonly kind: "catalogue"; readonly id: string }
  | { readonly kind: "user"; readonly id: string };

/** Longest reference this grammar admits — a bound on an untrusted string that goes into an indexed column. */
export const MAX_FOOD_REF_LENGTH = 80;

/** A user food's id is a UUIDv7 as `@nexus/db` mints them; the character class is deliberately wider than that and still narrow enough to be a token. */
const USER_FOOD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The text a `fit_meal_items.food_ref` column holds. The ONE place that spelling is decided. */
export function foodRefText(ref: FoodRef): string {
  return `${ref.kind}:${ref.id}`;
}

/**
 * Reads a stored or transmitted reference, or null when it is not one. A
 * `catalogue:` id must be a real catalogue SLUG (`FOOD_ID_RE`) rather than any
 * token — the two halves of this union are checked by the rules their own side
 * uses, so a reference that could never resolve is refused where it enters
 * rather than where it is read.
 */
export function parseFoodRef(text: string): FoodRef | null {
  if (text.length > MAX_FOOD_REF_LENGTH) return null;
  const separator = text.indexOf(":");
  if (separator <= 0) return null;
  const id = text.slice(separator + 1);
  switch (text.slice(0, separator)) {
    case "catalogue":
      return FOOD_ID_RE.test(id) ? { kind: "catalogue", id } : null;
    case "user":
      return USER_FOOD_ID_RE.test(id) ? { kind: "user", id } : null;
    default:
      return null;
  }
}

/**
 * What is wrong with one entry, in the vocabulary the catalogue's own gate
 * speaks. `field` is a path into the entry (`"per100g.sugar"`,
 * `"source.recipe[0].per100g.fat"`) so a failing test names the number rather
 * than the row.
 */
export interface FoodEntryProblem {
  readonly field: string;
  readonly code: FoodProblemCode;
}

export type FoodProblemCode =
  /** Missing, or the wrong kind of thing entirely (a string where a number belongs, an unknown source kind). */
  | "shape"
  /** A number outside what it is allowed to be — negative, non-finite, or a gram weight that must be positive and is not. */
  | "range"
  /** Not a kebab-case ASCII slug. */
  | "id"
  /** Outside `FOOD_CATEGORIES`. */
  | "category"
  /** `4·protein + 4·carbs + 9·fat` misses `kcal` by more than 10 % AND `notes` says nothing about why. */
  | "energy"
  /** `protein + carbs + fat` weighs more than the 100 g they are measured in. */
  | "mass"
  /** `sugar` exceeds `carbs`, which contains it. */
  | "sugar"
  /** `fiber` exceeds `carbs`, which contains it (carbohydrate BY DIFFERENCE — see the file header). */
  | "fiber";

/** Atwater factors: the energy the three macros are billed at, 4/4/9 kcal per gram. */
const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARBS = 4;
const KCAL_PER_G_FAT = 9;

/** How far the Atwater ESTIMATE may sit from the published calories before the entry owes an explanation — either side. */
export const FOOD_ENERGY_TOLERANCE = 0.1;

/** Lower-case ASCII words joined by single hyphens: no leading, trailing or doubled separator, no diacritics, no underscores. */
const FOOD_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A citation has to be openable. `http(s)` only — a `javascript:` or `data:` "source" is not provenance, it is a hole. */
const HTTP_URL_RE = /^https?:\/\/\S+$/;

/**
 * Everything wrong with `value`, in a fixed order; an EMPTY array means it
 * passed. Takes `unknown` on purpose — its main caller is the test that guards
 * `data/catalogue.json`, and that file is replaced wholesale by a dataset this
 * module never typechecked.
 *
 * **The energy rule: `notes` is the licence to deviate.** `4·protein + 4·carbs +
 * 9·fat` is an ESTIMATE, not the authority — USDA publishes food-specific
 * Atwater factors rather than the generic 4/4/9, and says so out loud: broccoli
 * (FDC 747447) carries BOTH „Energy (Atwater General Factors) 39" and „Energy
 * (Atwater Specific Factors) 32", and it is the specific one the catalogue
 * ships. Pear (FDC 746773) publishes the same pair, 63 against 57; lemon (FDC
 * 167746) misses the generic estimate by 53 % because its carbohydrate by
 * difference is largely citric acid rather than sugar. In one category alone 68
 * of 126 real entries
 * fall outside ±10 %, and almost none of them are wrong. Rewriting `kcal` to the
 * estimate would ship a number USDA does not publish — fabrication wearing
 * arithmetic's clothes.
 *
 * So the estimate does not decide; it decides who has to SPEAK. Inside ±10 % an
 * entry passes silently. Outside it, the entry passes only if `notes` says
 * something — a sentence a reviewer can read and a user can be shown. Outside it
 * with an empty `notes`, it fails. Nothing can then carry an implausible number
 * in silence, which is the property the flat ±10 % band was reaching for, without
 * the band pretending to be ground truth.
 *
 * There is no flag. A boolean set by hand during assembly would say only „a
 * human looked at this"; the sentence says WHAT they saw, survives into the
 * export, and is the same text a „odakle ovaj broj" answer would need anyway.
 *
 * **The mass gate is `protein + carbs + fat ≤ 100`, deliberately WITHOUT
 * `fiber`.** Fibre is already inside carbohydrate by difference, so adding it
 * would double-count and refuse ordinary foods — walnut, hazelnut, almond, all
 * three chocolates, cocoa and popcorn among them. `fiber ≤ carbs` is checked
 * separately and is the rule that actually expresses the containment, and the one
 * that catches a fibre figure copied off the wrong row.
 */
export function validateFoodEntry(value: unknown): readonly FoodEntryProblem[] {
  const problems: FoodEntryProblem[] = [];
  if (!isRecord(value)) return [{ field: "<root>", code: "shape" }];

  if (typeof value["id"] !== "string" || !FOOD_ID_RE.test(value["id"])) {
    problems.push({ field: "id", code: "id" });
  }
  if (typeof value["name"] !== "string" || value["name"].trim().length === 0) {
    problems.push({ field: "name", code: "shape" });
  }
  // Every shipped entry carries English beside the Serbian, and the gate is
  // where that claim is proved rather than assumed: a missing translation is a
  // blank row in an English interface, which is exactly what this catches.
  if (typeof value["nameEn"] !== "string" || value["nameEn"].trim().length === 0) {
    problems.push({ field: "nameEn", code: "shape" });
  }
  if (!(FOOD_CATEGORIES as readonly unknown[]).includes(value["category"])) {
    problems.push({ field: "category", code: "category" });
  }
  const notes = value["notes"];
  if (typeof notes !== "string") {
    problems.push({ field: "notes", code: "shape" });
  }
  // `notesEn` mirrors `notes`, so an empty Serbian note has an empty English
  // one; the key itself must be present, which is what a translation being
  // forgotten would remove.
  if (typeof value["notesEn"] !== "string") {
    problems.push({ field: "notesEn", code: "shape" });
  }

  // Read before the macros, because an explanation is what licenses a deviation.
  // A missing/blank `notes` licenses nothing, which is also the honest reading of
  // a `notes` that is not a string at all.
  const explained = typeof notes === "string" && notes.trim().length > 0;

  problems.push(...macroProblems(value["per100g"], "per100g", !explained));
  problems.push(...servingProblems(value["servings"]));
  problems.push(...sourceProblems(value["source"]));

  return problems;
}

/**
 * Reads the seven numbers and runs every rule that is about them alone.
 *
 * `energyGate` asks for the ±10 % band to be ENFORCED — true only for an entry
 * that has not explained itself. It is skipped entirely when a number is missing
 * or out of range: one honest problem beats two, the second derived from the
 * first.
 */
function macroProblems(value: unknown, path: string, energyGate: boolean): FoodEntryProblem[] {
  if (!isRecord(value)) return [{ field: path, code: "shape" }];

  const problems: FoodEntryProblem[] = [];
  const read: Record<string, number> = {};
  for (const field of ["kcal", "protein", "carbs", "fat", "fiber", "sugar", "sodiumMg"] as const) {
    const raw = value[field];
    if (typeof raw !== "number") {
      problems.push({ field: `${path}.${field}`, code: "shape" });
      continue;
    }
    if (!Number.isFinite(raw) || raw < 0) {
      problems.push({ field: `${path}.${field}`, code: "range" });
      continue;
    }
    read[field] = raw;
  }
  if (problems.length > 0) return problems;

  const kcal = read["kcal"] ?? 0;
  const protein = read["protein"] ?? 0;
  const carbs = read["carbs"] ?? 0;
  const fat = read["fat"] ?? 0;
  const fiber = read["fiber"] ?? 0;
  const sugar = read["sugar"] ?? 0;

  if (energyGate) {
    const atwater =
      KCAL_PER_G_PROTEIN * protein + KCAL_PER_G_CARBS * carbs + KCAL_PER_G_FAT * fat;
    if (Math.abs(atwater - kcal) > FOOD_ENERGY_TOLERANCE * kcal) {
      problems.push({ field: path, code: "energy" });
    }
  }
  if (protein + carbs + fat > 100) {
    problems.push({ field: path, code: "mass" });
  }
  if (sugar > carbs) {
    problems.push({ field: `${path}.sugar`, code: "sugar" });
  }
  if (fiber > carbs) {
    problems.push({ field: `${path}.fiber`, code: "fiber" });
  }
  return problems;
}

function servingProblems(value: unknown): FoodEntryProblem[] {
  if (!Array.isArray(value)) return [{ field: "servings", code: "shape" }];

  const problems: FoodEntryProblem[] = [];
  value.forEach((serving: unknown, index) => {
    const path = `servings[${index}]`;
    if (!isRecord(serving)) {
      problems.push({ field: path, code: "shape" });
      return;
    }
    if (typeof serving["label"] !== "string" || serving["label"].trim().length === 0) {
      problems.push({ field: `${path}.label`, code: "shape" });
    }
    if (typeof serving["labelEn"] !== "string" || serving["labelEn"].trim().length === 0) {
      problems.push({ field: `${path}.labelEn`, code: "shape" });
    }
    const grams = serving["grams"];
    if (typeof grams !== "number") {
      problems.push({ field: `${path}.grams`, code: "shape" });
    } else if (!Number.isFinite(grams) || grams <= 0) {
      problems.push({ field: `${path}.grams`, code: "range" });
    }
  });
  return problems;
}

function sourceProblems(value: unknown): FoodEntryProblem[] {
  if (!isRecord(value) || typeof value["kind"] !== "string" || !SOURCE_KINDS.includes(value["kind"])) {
    return [{ field: "source.kind", code: "shape" }];
  }
  // A `stated` food has no url by design — inventing one would be the very
  // pretence the kind exists to avoid. What it must carry instead is BOTH the
  // basis and the published range, each non-empty: a stated number with its
  // uncertainty stripped off is indistinguishable from a measured one, which is
  // the only way this kind could become the loophole its doc says it is not.
  if (value["kind"] === "stated") {
    const problems: FoodEntryProblem[] = [];
    for (const field of ["basis", "range"] as const) {
      const text = value[field];
      if (typeof text !== "string" || text.trim().length === 0) {
        problems.push({ field: `source.${field}`, code: "shape" });
      }
    }
    return problems;
  }

  if (value["kind"] !== "derived") {
    const problems: FoodEntryProblem[] = [];
    if (typeof value["ref"] !== "string" || value["ref"].trim().length === 0) {
      problems.push({ field: "source.ref", code: "shape" });
    }
    if (typeof value["url"] !== "string" || !HTTP_URL_RE.test(value["url"])) {
      problems.push({ field: "source.url", code: "shape" });
    }
    return problems;
  }

  const problems: FoodEntryProblem[] = [];
  const yieldGrams = value["yieldGrams"];
  if (typeof yieldGrams !== "number") {
    problems.push({ field: "source.yieldGrams", code: "shape" });
  } else if (!Number.isFinite(yieldGrams) || yieldGrams <= 0) {
    problems.push({ field: "source.yieldGrams", code: "range" });
  }

  const recipe = value["recipe"];
  if (!Array.isArray(recipe) || recipe.length === 0) {
    // An empty recipe is refused rather than tolerated: a derived food whose
    // working is missing is exactly the unverifiable number this kind exists to
    // rule out.
    problems.push({ field: "source.recipe", code: "shape" });
    return problems;
  }
  recipe.forEach((component: unknown, index) => {
    const path = `source.recipe[${index}]`;
    if (!isRecord(component)) {
      problems.push({ field: path, code: "shape" });
      return;
    }
    if (typeof component["what"] !== "string" || component["what"].trim().length === 0) {
      problems.push({ field: `${path}.what`, code: "shape" });
    }
    const grams = component["grams"];
    if (typeof grams !== "number") {
      problems.push({ field: `${path}.grams`, code: "shape" });
    } else if (!Number.isFinite(grams) || grams <= 0) {
      problems.push({ field: `${path}.grams`, code: "range" });
    }
    if (typeof component["url"] !== "string" || !HTTP_URL_RE.test(component["url"])) {
      problems.push({ field: `${path}.url`, code: "shape" });
    }
    // A component gets every macro rule EXCEPT the energy band. It is a
    // published row like any other — so food-specific Atwater factors apply to
    // it exactly as they do to a food — but it carries no `notes` of its own to
    // explain a deviation with, and borrowing the dish's would be one sentence
    // vouching for numbers it was not written about. The containment rules
    // (`fiber ≤ carbs`, `sugar ≤ carbs`) are the ones that catch a misread
    // source anyway, and they are enforced here in full.
    problems.push(...macroProblems(component["per100g"], `${path}.per100g`, false));
  });
  return problems;
}

/**
 * Serbian Latin ordering for every food list — the app's one collator spelling
 * (`Intl.Collator(["sr-Latn", "sr"])`), because plain `"sr"` mis-tailors the
 * Latin š/č/ć/ž a Serbian food catalogue is full of.
 */
const FOOD_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** A match and how good it is: Serbian name first, then the English name beside it. */
const RANK_PREFIX = 0;
const RANK_SUBSTRING = 1;
const RANK_EN_PREFIX = 2;
const RANK_EN_SUBSTRING = 3;

/** The least a thing must be for `searchFoods` to rank it: a name to match, and an id to break a tie by. */
export interface SearchableFood {
  readonly id: string;
  readonly name: string;
  /** The English name, when there is one. User foods have none, so this is optional. */
  readonly nameEn?: string;
}

/**
 * The foods whose names match `query`, best first, at most `limit` of them.
 *
 * Folding is `foldSearchText`'s — the app's ONE folding table, shared with the
 * search index and `nx_fold` in SQL — rather than a second one written for this
 * module. That is what makes „djuvec" find „Đuveč": đ is a single code point
 * with a stroke rather than a composition, so NFD leaves it whole and only an
 * explicit entry in that table reaches it. A private copy here would be a second
 * table to keep in step, and the day the two disagreed the food picker and the
 * global search would start answering differently about the same word.
 *
 * Prefix matches outrank substring matches because that is what a typing user
 * means: „sar" while reaching for „Sarma" should not be led by „Kisela
 * šargarepa". Within a rank the order is sr-Latn alphabetical, then by `id` so
 * the result is TOTAL — two foods with the same name would otherwise swap places
 * between two identical queries.
 *
 * A blank query answers NOTHING rather than everything. A picker with an empty
 * box has nothing to rank, and handing back the first `limit` foods alphabetically
 * would dress „the top of the catalogue" up as „your best matches".
 *
 * **Generic over anything with an id and a name, and that is what makes the
 * picker possible** (FIT slice b). A food picker ranks ONE list assembled from
 * two sources — the catalogue that ships in the app and the profile's own
 * `fit_foods` — and those are different types by construction: a user's food has
 * no `source`, deliberately (`FitFoodStore`). Two ranked lists merged by the
 * caller would be a SECOND definition of „best match", and the day it drifted
 * the picker would start ordering results by where the food happened to live.
 * So the caller hands this whatever pool it has and gets one ranking back.
 */
/**
 * Both names are searched, as `searchExercises` searches both of its own: an
 * English interface has to find "Potato chips" by its English name, and a
 * Serbian one has to keep finding the same entry by "Čips, od krompira". The
 * Serbian name ranks ahead of the English one so the result does not depend on
 * which language is active; the active one decides only what is DISPLAYED.
 */
export function searchFoods<T extends SearchableFood>(
  entries: readonly T[],
  query: string,
  limit: number,
): readonly T[] {
  const needle = foldSearchText(query.trim());
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (needle.length === 0 || cap === 0) return [];

  const hits: { entry: T; rank: number }[] = [];
  for (const entry of entries) {
    const folded = foldSearchText(entry.name);
    if (folded.startsWith(needle)) {
      hits.push({ entry, rank: RANK_PREFIX });
    } else if (folded.includes(needle)) {
      hits.push({ entry, rank: RANK_SUBSTRING });
    } else {
      // Part B item 4: an English interface finds the entry by its English name,
      // and the Serbian name stays searchable too. The English name ranks below
      // the Serbian one so the order does not depend on which language is
      // active, exactly as `searchExercises` ranks `nameEn`.
      const english = entry.nameEn;
      if (english === undefined) continue;
      const foldedEn = foldSearchText(english);
      if (foldedEn.startsWith(needle)) hits.push({ entry, rank: RANK_EN_PREFIX });
      else if (foldedEn.includes(needle)) hits.push({ entry, rank: RANK_EN_SUBSTRING });
    }
  }

  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      FOOD_COLLATOR.compare(a.entry.name, b.entry.name) ||
      a.entry.id.localeCompare(b.entry.id),
  );
  return hits.slice(0, cap).map((hit) => hit.entry);
}

/**
 * What `grams` of a food carries, scaled off its per-100 g figures. THE place
 * that arithmetic lives — the picker, the day total and the store's snapshot
 * arithmetic all come through here, so there is exactly one answer to „how many
 * calories is 180 g of this".
 *
 * Takes the MACROS rather than the whole entry, deliberately: a logged meal
 * snapshots the seven numbers it used and no longer has the food (the food may
 * be a catalogue entry `@nexus/db` cannot see, or a user food since deleted), so
 * a signature that demanded a `FoodEntry` would force the store to write its own
 * copy of this — which is the one thing this function exists to prevent.
 *
 * Refuses a negative or non-finite `grams` rather than coercing it: every caller
 * validates its input first, so a bad weight arriving here is a programming
 * error, and quietly answering zero would hide it inside a total.
 */
export function macrosFor(per100g: FoodMacros, grams: number): FoodMacros {
  if (!Number.isFinite(grams) || grams < 0) {
    throw new RangeError(`"grams" must be a finite, non-negative number (got ${String(grams)}).`);
  }
  if (grams === 0) return EMPTY_MACROS;
  const factor = grams / 100;
  return {
    kcal: per100g.kcal * factor,
    protein: per100g.protein * factor,
    carbs: per100g.carbs * factor,
    fat: per100g.fat * factor,
    fiber: per100g.fiber * factor,
    sugar: per100g.sugar * factor,
    sodiumMg: per100g.sodiumMg * factor,
  };
}

/**
 * Field-by-field total of already-scaled macros — a meal, a day, a week. An
 * empty list totals to `EMPTY_MACROS`, which is what a day with nothing logged
 * genuinely carries.
 *
 * Nothing is rounded here. Rounding is a display decision that belongs where the
 * number is drawn; a total rounded on the way through would make the day's
 * figure disagree with the rows above it by a little, every time.
 */
export function sumMacros(list: readonly FoodMacros[]): FoodMacros {
  let kcal = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let fiber = 0;
  let sugar = 0;
  let sodiumMg = 0;
  for (const macros of list) {
    kcal += macros.kcal;
    protein += macros.protein;
    carbs += macros.carbs;
    fat += macros.fat;
    fiber += macros.fiber;
    sugar += macros.sugar;
    sodiumMg += macros.sodiumMg;
  }
  return { kcal, protein, carbs, fat, fiber, sugar, sodiumMg };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
