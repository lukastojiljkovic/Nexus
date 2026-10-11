/**
 * The COOKBOOK module: finding a recipe, and reading one out.
 *
 * **The store is the app's own and the fold is the app's own.** `RecipeStore`
 * (migration 076) is what the module's page reads, and `foldSearchText` is the
 * one folding table in this repository — so „djuvec" finds „đuveč" here as it
 * does in the page's own search box, and a query typed without its accents is
 * not a query that misses.
 *
 * **The rule this file states is the ORDER, not the match.** The page's search
 * lives inside the module's main half and is not exported, so the match is
 * restated here over the same three fields the page matches on — a title, a tag
 * and an ingredient's name — and what this file adds is a rank a model can rely
 * on: a title match first, then the recipes that match through a tag or an
 * ingredient, each group in the app's own sr-Latn order. A search that answered
 * in the store's insertion order would look arbitrary to whoever read it.
 *
 * **A recipe is read, never summarised.** `cookbook.recipe` hands the model the
 * ingredients and the steps as the user wrote them, clamped once at a stated
 * limit and saying so when it clamps: an assistant that paraphrased a step would
 * be editing somebody's cooking.
 */

import { RecipeStore, type Recipe, type RecipeIngredient } from "@nexus/db";
import {
  foldSearchText,
  type AssistantLocale,
  type CookbookCourse,
  type IngredientUnit,
  type Tool,
} from "@nexus/core";
import { asArgs, asOptionalCount, asText } from "./args.js";
import {
  assertLive,
  clampText,
  collator,
  formatNumber,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface CookbookToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
}

/** How many recipes one search answers with when the model names no cap, and the ceiling it may ask for. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

/** The longest search a person types into the module's own box. */
const MAX_QUERY_CHARS = 120;

/** How much of one recipe a single result may carry — the page's own reading is a screen, not a book. */
const MAX_RECIPE_CHARS = 4_000;

/** The eleven courses as the page names them. */
const COURSE_WORDS: Readonly<Record<CookbookCourse, { readonly sr: string; readonly en: string }>> = {
  breakfast: { sr: "Doručak", en: "Breakfast" },
  starter: { sr: "Predjelo", en: "Starter" },
  soup: { sr: "Supa", en: "Soup" },
  main: { sr: "Glavno jelo", en: "Main course" },
  side: { sr: "Prilog", en: "Side" },
  salad: { sr: "Salata", en: "Salad" },
  dessert: { sr: "Dezert", en: "Dessert" },
  baking: { sr: "Pekara", en: "Baking" },
  drink: { sr: "Piće", en: "Drink" },
  preserve: { sr: "Zimnica", en: "Preserve" },
  other: { sr: "Ostalo", en: "Other" },
};

/** Every unit an ingredient line may carry, with the word the page prints beside it. */
const UNIT_WORDS: Readonly<Record<IngredientUnit, { readonly sr: string; readonly en: string }>> = {
  g: { sr: "g", en: "g" },
  kg: { sr: "kg", en: "kg" },
  ml: { sr: "ml", en: "ml" },
  l: { sr: "l", en: "l" },
  tsp: { sr: "kašičica", en: "tsp" },
  tbsp: { sr: "kašika", en: "tbsp" },
  cup: { sr: "šolja", en: "cup" },
  "fl_oz": { sr: "fl oz", en: "fl oz" },
  pinch: { sr: "prstohvat", en: "pinch" },
  dash: { sr: "prstohvat", en: "dash" },
  clove: { sr: "čen", en: "clove" },
  piece: { sr: "komad", en: "piece" },
  slice: { sr: "kriška", en: "slice" },
  sprig: { sr: "grančica", en: "sprig" },
  stalk: { sr: "stabljika", en: "stalk" },
  head: { sr: "glavica", en: "head" },
  bunch: { sr: "veza", en: "bunch" },
  handful: { sr: "šaka", en: "handful" },
  stick: { sr: "štapić", en: "stick" },
  sheet: { sr: "list", en: "sheet" },
  can: { sr: "konzerva", en: "can" },
  packet: { sr: "paket", en: "packet" },
  cube: { sr: "kocka", en: "cube" },
};

const SEARCH_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Recepti (${count}):`,
  en: (count) => `Recipes (${count}):`,
};

const SEARCH_NONE: AssistantPhrase<[query: string, total: number]> = {
  sr: (query, total) =>
    `Nijedan od ${total} recepata ne odgovara pretrazi „${query}“ (naziv, oznaka ili sastojak).`,
  en: (query, total) =>
    `None of the ${total} recipes matches the search “${query}” (a title, a tag or an ingredient).`,
};

/** A recipe with none of his own: the difference between "nothing matched" and "nothing is written down". */
const COOKBOOK_EMPTY: { readonly sr: string; readonly en: string } = {
  sr: "U kuvarici još nema recepata.",
  en: "The cookbook holds no recipe yet.",
};

const SEARCH_MORE: AssistantPhrase<[count: number]> = {
  sr: (count) => `…i još ${count}.`,
  en: (count) => `…and ${count} more.`,
};

const MATCHED_INGREDIENT: AssistantPhrase<[name: string]> = {
  sr: (name) => `sastojak „${name}“`,
  en: (name) => `ingredient “${name}”`,
};

const MATCHED_TAG: AssistantPhrase<[name: string]> = {
  sr: (name) => `oznaka „${name}“`,
  en: (name) => `tag “${name}”`,
};

/** The page's own label-with-a-number shape („Porcije" beside the count), for the reason `INGREDIENT_COUNT` states. */
const SERVINGS_WORD: AssistantPhrase<[count: number]> = {
  sr: (count) => `porcija: ${count}`,
  en: (count) => `servings: ${count}`,
};

const MINUTES_WORD: AssistantPhrase<[minutes: number]> = {
  sr: (minutes) => `${minutes} min`,
  en: (minutes) => `${minutes} min`,
};

/**
 * A label and a number rather than a sentence, on the page's own pattern
 * („Porcija" beside its count): Serbian has three plural forms, and
 * `1 sastojak`/`2 sastojka`/`5 sastojaka` is a rule this file has no business
 * restating for a figure a model only reads.
 */
const INGREDIENT_COUNT: AssistantPhrase<[count: number]> = {
  sr: (count) => `sastojaka: ${count}`,
  en: (count) => `ingredients: ${count}`,
};

const UNKNOWN_RECIPE: AssistantPhrase<[name: string, known: string]> = {
  sr: (name, known) => `Nema recepta „${name}“ u kuvarici. Recepti: ${known}.`,
  en: (name, known) => `No recipe “${name}” in the cookbook. The recipes: ${known}.`,
};

const RECIPE_HEADING: AssistantPhrase<[title: string]> = {
  sr: (title) => `${title}:`,
  en: (title) => `${title}:`,
};

const INGREDIENTS_HEADING: { readonly sr: string; readonly en: string } = {
  sr: "Sastojci:",
  en: "Ingredients:",
};

const STEPS_HEADING: { readonly sr: string; readonly en: string } = {
  sr: "Postupak:",
  en: "Steps:",
};

const NO_INGREDIENTS: { readonly sr: string; readonly en: string } = {
  sr: "Recept nema sastojke.",
  en: "The recipe lists no ingredients.",
};

const NO_STEPS: { readonly sr: string; readonly en: string } = {
  sr: "Recept nema korake.",
  en: "The recipe lists no steps.",
};

const TRUNCATED: { readonly sr: string; readonly en: string } = {
  sr: "…ispis je skraćen.",
  en: "…the text is cut short here.",
};

export function cookbookTools(deps: CookbookToolDeps): readonly Tool[] {
  const search: Tool = {
    name: "cookbook.search",
    description: {
      sr: "Traži recept po nazivu, oznaci ili sastojku — koristi ga i kada korisnik pita šta može da napravi sa onim što ima. Vraća naziv, vrstu jela, broj porcija i na šta se poklopilo.",
      en: "Searches the recipes by title, tag or ingredient — use it also when the user asks what they can make with what they have. It answers with the title, the course, the servings and what matched.",
    },
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: MAX_QUERY_CHARS,
          description: "A word from the title, a tag, or an ingredient the user has.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many recipes to list. Defaults to ${String(DEFAULT_LIMIT)}.`,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asText(args.query, "query", MAX_QUERY_CHARS);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;

        const recipes = deps.profileDb(context.profileId, (db, id) =>
          new RecipeStore(db, id).list(),
        );
        const matches = recipes
          .map((recipe) => ({ recipe, hit: matchOf(recipe, query) }))
          .filter((entry): entry is { recipe: Recipe; hit: RecipeHit } => entry.hit !== null)
          .sort(
            (left, right) =>
              rank(left.hit) - rank(right.hit) ||
              collator().compare(left.recipe.title, right.recipe.title),
          );

        if (recipes.length === 0) return okResult(text(context.locale, COOKBOOK_EMPTY));
        if (matches.length === 0) {
          return okResult(phrase(context.locale, SEARCH_NONE, query, recipes.length));
        }
        const shown = matches.slice(0, limit);
        const lines = [
          phrase(context.locale, SEARCH_HEADING, matches.length),
          ...shown.map((entry) => searchLine(context.locale, entry.recipe, entry.hit)),
        ];
        if (matches.length > shown.length) {
          lines.push(phrase(context.locale, SEARCH_MORE, matches.length - shown.length));
        }
        return okResult(lines.join("\n"));
      }),
  };

  const recipe: Tool = {
    name: "cookbook.recipe",
    description: {
      sr: "Čita jedan recept iz kuvarice: sastojke i korake, onako kako su upisani. Koristi ga kada korisnik traži recept koji već ima, ili posle cookbook.search da vidiš ceo recept.",
      en: "Reads one recipe from the cookbook: its ingredients and its steps, as they are written. Use it when the user asks for a recipe they already have, or after cookbook.search to read one in full.",
    },
    parameters: {
      type: "object",
      properties: {
        recipe: {
          type: "string",
          minLength: 1,
          maxLength: 200,
          description: "The recipe's id, or its title as the user said it.",
        },
      },
      required: ["recipe"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const wanted = asText(args.recipe, "recipe", 200);
        const recipes = deps.profileDb(context.profileId, (db, id) =>
          new RecipeStore(db, id).list(),
        );
        const found = resolveRecipe(recipes, wanted, context.locale);
        const body = recipeBody(context.locale, found);
        const clamped = clampText(body, MAX_RECIPE_CHARS);
        return okResult(
          clamped.truncated
            ? `${clamped.text}\n${text(context.locale, TRUNCATED)}`
            : clamped.text,
        );
      }),
  };

  return [search, recipe];
}

/** Where a query matched a recipe, and what it matched. */
type RecipeHit =
  | { readonly on: "title" }
  | { readonly on: "tag"; readonly name: string }
  | { readonly on: "ingredient"; readonly name: string };

/** Title first, then a tag, then an ingredient — see the file header for why this is this file's decision. */
function rank(hit: RecipeHit): number {
  if (hit.on === "title") return 0;
  return hit.on === "tag" ? 1 : 2;
}

/** The folded match the page's own search box uses, over the same three fields. */
function matchOf(recipe: Recipe, query: string): RecipeHit | null {
  const needle = foldSearchText(query.trim());
  if (needle.length === 0) return null;
  if (foldSearchText(recipe.title).includes(needle)) return { on: "title" };
  const tag = recipe.tags.find((entry) => foldSearchText(entry).includes(needle));
  if (tag !== undefined) return { on: "tag", name: tag };
  const line = recipe.ingredients.find((entry) => foldSearchText(entry.name).includes(needle));
  if (line !== undefined) return { on: "ingredient", name: line.name };
  return null;
}

/** One search result: what it is, how much of it, and what put it on the list. */
function searchLine(locale: AssistantLocale, recipe: Recipe, hit: RecipeHit): string {
  const parts = [
    text(locale, COURSE_WORDS[recipe.course]),
    phrase(locale, SERVINGS_WORD, recipe.servings),
  ];
  const minutes = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);
  if (minutes > 0) parts.push(phrase(locale, MINUTES_WORD, minutes));
  parts.push(phrase(locale, INGREDIENT_COUNT, recipe.ingredients.length));
  if (hit.on === "ingredient") parts.push(phrase(locale, MATCHED_INGREDIENT, hit.name));
  if (hit.on === "tag") parts.push(phrase(locale, MATCHED_TAG, hit.name));
  return `- ${recipe.title} (${parts.join(", ")})`;
}

/** One recipe in full: the facts, the ingredient lines and the numbered steps. */
function recipeBody(locale: AssistantLocale, recipe: Recipe): string {
  const facts = [text(locale, COURSE_WORDS[recipe.course])];
  if (recipe.cuisine.trim().length > 0) facts.push(recipe.cuisine.trim());
  facts.push(phrase(locale, SERVINGS_WORD, recipe.servings));
  const lines = [phrase(locale, RECIPE_HEADING, recipe.title), facts.join(", ")];
  if (recipe.description.trim().length > 0) lines.push("", recipe.description.trim());
  lines.push("", text(locale, INGREDIENTS_HEADING));
  lines.push(
    ...(recipe.ingredients.length === 0
      ? [text(locale, NO_INGREDIENTS)]
      : recipe.ingredients.map((line) => `- ${ingredientLine(locale, line)}`)),
  );
  lines.push("", text(locale, STEPS_HEADING));
  lines.push(
    ...(recipe.steps.length === 0
      ? [text(locale, NO_STEPS)]
      : recipe.steps.map((step, index) => `${String(index + 1)}. ${step.text}`)),
  );
  if (recipe.notes.trim().length > 0) lines.push("", recipe.notes.trim());
  return lines.join("\n");
}

/** „2 kašike brašna", and a line that states no amount as just its name. */
function ingredientLine(locale: AssistantLocale, line: RecipeIngredient): string {
  const unit = line.unit === null ? "" : ` ${text(locale, UNIT_WORDS[line.unit])}`;
  const amount = line.quantity === null ? "" : `${formatNumber(locale, line.quantity)}${unit} `;
  const preparation = line.preparation === null ? "" : ` (${line.preparation})`;
  return `${amount}${line.name}${preparation}`;
}

/** A recipe the user named: its id, its exact title folded, or a refusal listing the titles that exist. */
function resolveRecipe(
  recipes: readonly Recipe[],
  wanted: string,
  locale: AssistantLocale,
): Recipe {
  const needle = foldSearchText(wanted.trim());
  const found =
    recipes.find((entry) => entry.id === wanted) ??
    recipes.find((entry) => foldSearchText(entry.title) === needle);
  if (found !== undefined) return found;
  throw new Error(
    phrase(
      locale,
      UNKNOWN_RECIPE,
      wanted,
      recipes
        .map((entry) => entry.title)
        .sort((left, right) => collator().compare(left, right))
        .join(", "),
    ),
  );
}

