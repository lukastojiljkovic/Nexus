// The recipes converter's tests, on fixtures cut verbatim from the sources (see
// `fixtures/` and `sources.json` for where each byte came from). Every expected
// record below is the source's own text; the numbers are the counts the
// converter states, and the sharp cases are the ones that were wrong before:
// the sub-headings inside an Ingredients section, the Serbian category link
// that used to end up in the last step, and the two annotation lines Beeton
// puts between a title and its recipe number.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  WIKIBOOKS_ATTRIBUTION,
  categoriesOf,
  extractSections,
  parseBeeton,
  parseFarmer,
  parseWikibooksPage,
  slugify,
  stripBoilerplate,
  tagsFor,
  toPlain,
} from "./convert.mjs";

const FIXTURES = join(import.meta.dirname, "fixtures");
const read = (name) => readFileSync(join(FIXTURES, name), "utf8");
const json = (name) => JSON.parse(read(name));

const KINDS = new Map(Object.entries(json("wikibooks-category-kinds.json")));
const EN_PAGES = json("wikibooks-pages.json").pages;
const SR_PAGES = json("sr-wikibooks-pages.json").pages;

const page = (pages, title) => pages.find((entry) => entry.title === title);

const GUTENBERG_SOURCE = { title: "T", url: "https://example.org", licence: "Public domain", attribution: "A" };

describe("toPlain", () => {
  it("shows a link's display text, and a namespace-less target without one", () => {
    expect(toPlain("1 [[Cookbook:Cup|cup]] of [[Cookbook:White Wine|wine]]")).toBe("1 cup of wine");
    expect(toPlain("[[Cookbook:Salt]]")).toBe("Salt");
  });

  it("removes an image link and counts it", () => {
    const stats = {};
    expect(toPlain("text [[File:Pupusas.jpg|300px]]", stats)).toBe("text");
    expect(stats.files).toBe(1);
  });

  it("removes bold and italic marks, and the Serbian category namespace", () => {
    expect(toPlain("'''Bløtkake''' is a ''traditional'' dish")).toBe("Bløtkake is a traditional dish");
    expect(toPlain("[[Категорија:Јела од изнутрица]] {{DEFAULTSORT:B}}")).toBe("");
  });

  it("turns a fraction template into a fraction and drops a template it cannot render", () => {
    const stats = {};
    expect(toPlain("{{frac|1|2}} cup", stats)).toBe("1/2 cup");
    expect(stats.templates).toBeUndefined();
    expect(toPlain("{{convert|1|cup}} sugar", stats)).toBe("sugar");
    expect(stats.templates).toBe(1);
  });

  it("decodes entities, drops comments, refs and external links", () => {
    expect(toPlain("1&nbsp;cup &amp; 2&deg;C<!-- note --><ref name=a>src</ref>")).toBe("1 cup & 2°C");
    expect(toPlain("see [https://example.org the page]")).toBe("see the page");
  });
});

describe("extractSections", () => {
  it("splits on level-2 headings only, so a sub-heading stays inside its section", () => {
    const wikitext = "lead\n==Ingredients==\n=== Batter ===\n*4 eggs\n=== Filling ===\n*jam\n==Procedure==\n#Mix\n";
    expect(extractSections(wikitext).map((section) => section.heading)).toEqual(["", "Ingredients", "Procedure"]);
  });
});

describe("categories and tags", () => {
  it("reads every Category link once", () => {
    expect(categoriesOf("[[Category:French recipes]] text [[Category:French recipes|F]] [[Category:Vegan recipes]]"))
      .toEqual(["Category:French recipes", "Category:Vegan recipes"]);
  });

  it("keeps only the categories the wiki's own tree places, and sorts the tags", () => {
    const tags = tagsFor(
      ["Category:Recipes using wine", "Category:French recipes", "Category:Vegetarian recipes", "Category:Recipes for dessert"],
      KINDS,
      ["Salvadoran"],
    );
    expect(tags).toEqual(["course:dessert", "cuisine:french", "cuisine:salvadoran", "diet:vegetarian"]);
  });

  it("slugs a title with the letters English does not have", () => {
    expect(slugify("Bløtkake (Norwegian Berries and Cream Cake)")).toBe("blotkake-norwegian-berries-and-cream-cake");
    expect(slugify("Bubrezi u umaku")).toBe("bubrezi-u-umaku");
  });
});

describe("parseWikibooksPage", () => {
  it("reads the infobox yield, the categories and the two lists of Beurre Blanc", () => {
    const { recipe } = parseWikibooksPage({
      title: "Cookbook:Beurre Blanc",
      wikitext: page(EN_PAGES, "Cookbook:Beurre Blanc").wikitext,
      host: "en.wikibooks.org",
      language: "en",
      kinds: KINDS,
    });
    expect(recipe).toEqual({
      title: "Beurre Blanc",
      language: "en",
      ingredients: [
        "1 cup of good white wine (dry aromatic white, preferably French, such as Pouilly-Fumé)",
        "1 lemon, juiced",
        "1–2 shallots, minced",
        "1 Tbsp heavy cream (optional and non-traditional)",
        "10–12 Tbsp unsalted butter, very cold and in cubes or lumps",
        "Salt",
        "White pepper",
      ],
      steps: [
        "Place the white wine in a non-reactive saucepan with the lemon juice and chopped shallots.",
        "Cook this mixture until reduced to about 2 tablespoons, and don't be shy about letting it boil—it will not adversely affect the sauce. Once reduced, the shallot should still be fairly moist. If you're looking at a dry pan, there's a good chance your sauce won't hold.",
        "Reduce heat to low flame. If you want to increase the holding power of your sauce, add the heavy cream at this juncture, but every authority on traditional French preparation would disapprove.",
        "Begin to add cubes of the cold butter while whisking vigorously. From a technical standpoint, the sauce should stay under 200°F (95°C), so do some of the whisking off the flame. Whisk in 1 or 2 cubes and add more, and continue until you've added all the butter.",
        "Season with salt and white pepper, and serve immediately. The sauce can be held in a vacuum container, such a Thermos, but this is not recommended for long periods of time.",
      ],
      tags: ["cuisine:french", "diet:vegetarian"],
      source: {
        title: "Cookbook:Beurre Blanc",
        url: "https://en.wikibooks.org/wiki/Cookbook:Beurre_Blanc",
        licence: "CC BY-SA 4.0",
        attribution: WIKIBOOKS_ATTRIBUTION,
      },
      servings: "4 portions",
    });
  });

  it("reads the ingredients of a page that keeps them in a table", () => {
    const { recipe } = parseWikibooksPage({
      title: "Cookbook:Pupusas",
      wikitext: page(EN_PAGES, "Cookbook:Pupusas").wikitext,
      host: "en.wikibooks.org",
      language: "en",
      kinds: KINDS,
    });
    expect(recipe.ingredients.slice(0, 5)).toEqual([
      "Corn masa",
      "Water",
      "3 cups of shredded cheese (use a combination of hard and soft cheese; you can mix frying cheese, mozzarella, and ricotta)",
      "3–4 tablespoons of heavy cream",
      "½–1 cup of loroco (this can be hard to source, so you can use very finely chopped green peppers or scallions instead)",
    ]);
    expect(recipe.steps).toHaveLength(12);
    expect(recipe.tags).toEqual(["course:main-course", "cuisine:salvadoran"]);
    expect(recipe.servings).toBeUndefined();
  });

  it("collects the ingredients under `=== Batter ===` rather than dropping the page", () => {
    const { recipe } = parseWikibooksPage({
      title: "Cookbook:Bløtkake (Norwegian Berries and Cream Cake)",
      wikitext: page(EN_PAGES, "Cookbook:Bløtkake (Norwegian Berries and Cream Cake)").wikitext,
      host: "en.wikibooks.org",
      language: "en",
      kinds: KINDS,
    });
    expect(recipe.ingredients).toEqual([
      "4 eggs",
      "100 g white granulated sugar",
      "100 g flour",
      "1 tsp baking powder",
      "Raspberry jam",
      "1 tin sliced peaches",
      "Vanilla custard",
      "Whipped cream",
      "1 tsp white granulated sugar",
      "Berries or other fruit (usually blueberries, redcurrants or other soft berries)",
    ]);
    expect(recipe.tags).toEqual(["course:dessert", "cuisine:norwegian"]);
  });

  it("reads a Serbian page whose steps are paragraphs, and leaves no markup on the last one", () => {
    const { recipe } = parseWikibooksPage({
      title: "Kuvar:Bubrezi u umaku",
      wikitext: page(SR_PAGES, "Kuvar:Bubrezi u umaku").wikitext,
      host: "sr.wikibooks.org",
      language: "sr",
      kinds: KINDS,
    });
    expect(recipe).toEqual({
      title: "Bubrezi u umaku",
      language: "sr",
      ingredients: ["2 mala teleća bubrega", "50 g maslaca", "2 kašike senfa", "2 dl pavlake", "2 kašike konjaka", "so", "biber"],
      steps: [
        "Bubrege narežite na kocke i ispržite na zagrejanom maslacu. Zalijte konjakom i mešajte da se otopi karamelizirana smesa na dnu posude.",
        "Zalijte mešavinom pavlake i senfa, začinite prema ukusu i kratko pirjajte.",
        "Poslužite s pireom od krompira.",
      ],
      tags: [],
      source: {
        title: "Kuvar:Bubrezi u umaku",
        url: "https://sr.wikibooks.org/wiki/Kuvar:Bubrezi_u_umaku",
        licence: "CC BY-SA 4.0",
        attribution: WIKIBOOKS_ATTRIBUTION,
      },
      servings: "Za broj osoba: 4",
    });
  });

  it("drops a page with no ingredients and a page with no procedure heading", () => {
    const base = { host: "en.wikibooks.org", language: "en", kinds: KINDS };
    expect(parseWikibooksPage({ ...base, title: "Cookbook:X", wikitext: "== Procedure ==\n# Stir.\n" }))
      .toEqual({ drop: "no-ingredients-heading" });
    expect(parseWikibooksPage({ ...base, title: "Cookbook:X", wikitext: "== Ingredients ==\n* Salt\n" }))
      .toEqual({ drop: "no-procedure-heading" });
    expect(parseWikibooksPage({ ...base, title: "Cookbook:X", wikitext: "== Ingredients ==\n== Procedure ==\n# Stir.\n" }))
      .toEqual({ drop: "no-ingredients" });
  });
});

describe("stripBoilerplate", () => {
  it("drops everything before the start line", () => {
    const stripped = stripBoilerplate(read("gutenberg-start.txt"));
    expect(stripped.headerLines).toBe(11);
    expect(stripped.text.startsWith("\n[Illustration:")).toBe(true);
  });

  it("drops everything from the end line onward", () => {
    const stripped = stripBoilerplate(read("gutenberg-end.txt"));
    expect(stripped.footerLines).toBe(12);
    expect(stripped.text.endsWith("e.g. H_{2}O.\n\n\n")).toBe(true);
    // Neither slice has a line naming Project Gutenberg inside the body, which
    // is why the whole-file run reported 0 removed lines too.
    expect(stripped.removedLines).toBe(0);
  });
});

describe("parseBeeton", () => {
  it("reads two numbered recipes, their title line and their semicolon groups", () => {
    const { recipes, dropped } = parseBeeton(read("beeton-slice.txt"), GUTENBERG_SOURCE);
    expect([...dropped]).toEqual([]);
    expect(recipes.map((recipe) => recipe.id)).toEqual(["beeton-104", "beeton-105"]);
    expect(recipes[0]).toEqual({
      id: "beeton-104",
      title: "RICH STRONG STOCK",
      language: "en",
      ingredients: [
        "4 lbs. of shin of beef, 4 lbs. of knuckle of veal, 3/4 lb. of good lean ham",
        "any poultry trimmings",
        "3 small onions, 3 small carrots, 3 turnips (the latter should be omitted in summer, lest they ferment), 1 head of celery, a few chopped mushrooms, when obtainable",
        "1 tomato, a bunch of savoury herbs, not forgetting parsley",
        "1-1/2 oz. of salt, 12 white peppercorns, 6 cloves, 3 small blades of mace, 4 quarts of water",
      ],
      steps: [
        "Line a delicately clean stewpan with the ham cut in thin broad slices, carefully trimming off all its rusty fat; cut up the beef and veal in pieces about 3 inches square, and lay them on the ham; set it on the stove, and draw it down, and stir frequently. When the meat is equally browned, put in the beef and veal bones, the poultry trimmings, and pour in the cold water. Skim well, and occasionally add a little cold water, to stop its boiling, until it becomes quite clear; then put in all the other ingredients, and simmer very slowly for 5 hours. Do not let it come to a brisk boil, that the stock be not wasted, and that its colour may be preserved. Strain through a very fine hair sieve, or tammy, and it will be fit for use.",
      ],
      tags: [],
      source: GUTENBERG_SOURCE,
    });
    // The second recipe's mode has two paragraphs, and each is one step.
    expect(recipes[1].steps).toHaveLength(2);
    expect(recipes[1].title).toBe("MEDIUM STOCK");
  });
});

describe("parseFarmer", () => {
  it("reads two centred headings with their indented ingredient lists", () => {
    const { recipes, dropped } = parseFarmer(read("farmer-slice.txt"), GUTENBERG_SOURCE);
    expect([...dropped]).toEqual([]);
    expect(recipes.map((recipe) => recipe.title)).toEqual(["Black Bean Soup", "Baked Bean Soup"]);
    expect(recipes[0].ingredients).toEqual([
      "1 pint black beans",
      "2 quarts cold water",
      "1 small onion",
      "2 stalks celery, or",
      "¼ teaspoon celery salt",
      "½ tablespoon salt",
      "⅛ teaspoon pepper",
      "¼ teaspoon mustard",
      "Few grains cayenne",
      "3 tablespoons butter",
      "1½ tablespoons flour",
      "2 “hard-boiled” eggs",
      "1 lemon",
    ]);
    expect(recipes[0].steps).toEqual([
      "Soak beans over night; in the morning drain and add cold water. Slice onion, and cook five minutes with half the butter, adding to beans, with celery stalks broken in pieces. Simmer three or four hours, or until beans are soft; add more water as water boils away. Rub through a sieve, reheat to the boiling-point, and add salt, pepper, mustard, and cayenne well mixed. Bind with remaining butter and flour cooked together. Cut eggs in thin slices, and lemon in thin slices, removing seeds. Put in tureen, and strain the soup over them.",
    ]);
    // `Salt` and `Pepper` are ingredients that pass the heading test — the blank
    // line, not the heading test, is what ends the list.
    expect(recipes[1].ingredients.at(-2)).toBe("Salt");
    expect(recipes[1].source).toEqual(GUTENBERG_SOURCE);
  });
});
