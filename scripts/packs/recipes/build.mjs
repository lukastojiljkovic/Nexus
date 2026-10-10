// No shebang, for the reason `scripts/pack-sign.mjs` gives: this module is a CLI
// (`node scripts/packs/recipes/build.mjs`) and an import target for its own test.
//
// WHAT THIS BUILDS. The `recipes-world` dataset pack: the English Wikibooks
// Cookbook (CC BY-SA 4.0), the seven Serbian Wikibooks `Kuvar:` pages (CC BY-SA
// 4.0), and the two public-domain Project Gutenberg cookbooks the research run
// named — Mrs Beeton's *Book of Household Management* and Fannie Farmer's
// *Boston Cooking-School Cook Book*. Everything lands in one `recipes.json`.
//
// HOW IT ASKS THE WIKI FOR THREE THOUSAND PAGES WITHOUT BEING RUDE ABOUT IT.
// The research run fetched one page per request with a 1.5 s back-off, which is
// about ninety minutes for the corpus. `action=query` takes fifty titles in one
// call, so the same corpus is 76 calls, and the polite 200 ms gap in
// `lib/source.mjs` keeps the whole walk inside a minute. The response is cached
// whole (`en-pages.json`), so a second run of this builder touches the network
// for nothing.
//
// THE TAG KINDS ARE THE WIKI'S OWN ANSWER. A recipe's tags come from its
// `[[Category:…]]` links, but only from categories the Cookbook's own tree
// places: the subcategories of `Category:Recipes by origin` are cuisines, of
// `… by meal or course` are courses, and of `… by diet` are diets. Nothing in
// this file decides what „French recipes" means; the wiki does, and the build
// walks that tree rather than carrying a list of its own.
//
//   node scripts/packs/recipes/build.mjs
//   node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\recipes-world \
//     --meta %TEMP%\nexus-packs\recipes-world.meta.json --key <release-key.pem>

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createSource, packsDir, printFetchLog, sha256 } from "../lib/source.mjs";
import {
  GUTENBERG_BOOKS,
  PUBLIC_DOMAIN_LICENCE,
  gutenbergAttribution,
  parseBeeton,
  parseFarmer,
  parseWikibooksPage,
  slugify,
  stripBoilerplate,
} from "./convert.mjs";

const PACK_ID = "recipes-world";
const VERSION = "2026.10.0";
/** The dataset readers for `layout: 1` arrive with the 2.0 wave; see the report. */
const MIN_APP_VERSION = "2.0.0";

const EN_HOST = "en.wikibooks.org";
const SR_HOST = "sr.wikibooks.org";
const api = (host) => `https://${host}/w/api.php`;

/**
 * The three roots whose subtree says what a category MEANS, in the order a
 * category that appears under more than one is classified.
 */
const CATEGORY_ROOTS = [
  ["diet", "Category:Recipes by diet"],
  ["course", "Category:Recipes by meal or course"],
  ["cuisine", "Category:Recipes by origin"],
];

/** How deep the tree walk goes. Four levels reaches „Provence recipes". */
const CATEGORY_DEPTH = 4;

/** How many titles one `prop=revisions` call may carry. MediaWiki's own cap. */
const TITLES_PER_REQUEST = 50;

const GUTENBERG_SOURCES = [
  {
    key: "beeton",
    file: "pg10136.txt",
    url: "https://www.gutenberg.org/cache/epub/10136/pg10136.txt",
    book: GUTENBERG_BOOKS.beeton,
    parse: parseBeeton,
  },
  {
    key: "farmer",
    file: "pg65061.txt",
    url: "https://www.gutenberg.org/cache/epub/65061/pg65061.txt",
    book: GUTENBERG_BOOKS.farmer,
    parse: parseFarmer,
  },
];

const LICENCE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";

function metadata(counts) {
  return {
    format: 1,
    id: PACK_ID,
    version: VERSION,
    kind: "dataset",
    title: {
      sr: "Recepti sveta",
      en: "World recipes",
    },
    description: {
      sr: `Recepti iz Vikiknjiga (kuvari sveta i srpski Kuvar) i iz dve javno-dostupne kuvarske knjige. `
        + `Ukupno ${String(counts.total)} recepata na engleskom i srpskom.`,
      en: `Recipes from Wikibooks (the world Cookbook and the Serbian Kuvar) and from two public-domain `
        + `cookbooks. ${String(counts.total)} recipes in English and Serbian.`,
    },
    licence: {
      spdx: "CC-BY-SA-4.0",
      attribution: "Wikibooks Cookbook and Serbian Kuvar contributors, CC BY-SA 4.0 "
        + "(https://creativecommons.org/licenses/by-sa/4.0/) — each record names its page and the page "
        + "history lists its authors. The Book of Household Management (Mrs Beeton) and The Boston "
        + "Cooking-School Cook Book (Fannie Merritt Farmer) are public-domain texts from Project Gutenberg; "
        + "their licence and every reference to it were removed from the text, as that licence requires.",
      url: LICENCE_URL,
    },
    source: {
      name: "Wikibooks Cookbook; The Book of Household Management (Mrs Beeton); "
        + "The Boston Cooking-School Cook Book (Fannie Merritt Farmer)",
      url: "https://en.wikibooks.org/wiki/Cookbook:Recipes",
    },
    minAppVersion: MIN_APP_VERSION,
  };
}

/** `[1, 2, …, 121]` into `[[1…50], [51…100], [101…121]]`. */
function chunk(items, size) {
  const chunks = [];
  for (let at = 0; at < items.length; at += size) chunks.push(items.slice(at, at + size));
  return chunks;
}

const apiUrl = (host, params) => `${api(host)}?${new URLSearchParams({ format: "json", formatversion: "2", ...params })}`;

/**
 * One cache file for however many requests a step needs.
 *
 * The builders' rule is that a second run costs seconds, and a step that is a
 * hundred requests — a category walk, a wikitext harvest — caches as one file
 * rather than a hundred. `describe` is what the report prints for it, so the
 * log still says what was downloaded rather than naming a file.
 */
async function cached(source, name, describe, produce) {
  const path = join(source.dir, name);
  const started = Date.now();
  if (existsSync(path)) {
    const bytes = readFileSync(path);
    source.log.push({ url: describe, name, bytes: bytes.byteLength, sha256: sha256(bytes), fromCache: true, ms: Date.now() - started });
    return JSON.parse(bytes.toString("utf8"));
  }
  const value = await produce();
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  writeFileSync(path, bytes);
  source.log.push({ url: describe, name, bytes: bytes.byteLength, sha256: sha256(bytes), fromCache: false, ms: Date.now() - started });
  return value;
}

const getJson = async (source, url) => JSON.parse((await source.raw(url)).toString("utf8"));

/**
 * `Category:X` -> `cuisine` | `course` | `diet`, by walking each root's subtree.
 *
 * Breadth-first, so a category reachable from two roots takes the first root
 * that reaches it at the shallowest depth, and the walk order (diet, course,
 * cuisine) is the tie-break the `CATEGORY_ROOTS` table states.
 */
async function fetchCategoryKinds(source) {
  const memberLists = await Promise.all(
    CATEGORY_ROOTS.map(async ([kind, root]) => {
      const found = new Map();
      let frontier = [root];
      found.set(root, kind);
      for (let depth = 0; depth < CATEGORY_DEPTH && frontier.length > 0; depth += 1) {
        const next = [];
        for (const title of frontier) {
          const json = await getJson(
            source,
            apiUrl(EN_HOST, { action: "query", list: "categorymembers", cmtitle: title, cmtype: "subcat", cmlimit: "500" }),
          );
          for (const member of json.query.categorymembers) {
            if (!found.has(member.title)) {
              found.set(member.title, kind);
              next.push(member.title);
            }
          }
        }
        frontier = next;
      }
      return found;
    }),
  );
  // The roots are disjoint in practice; if a category appears in more than one,
  // the first walk that reached it keeps it, which is why the walks are merged
  // in `CATEGORY_ROOTS` order rather than in whatever order they finished in.
  const kinds = new Map();
  for (const found of memberLists) {
    for (const [title, kind] of found) {
      if (!kinds.has(title)) kinds.set(title, kind);
    }
  }
  return kinds;
}

/** Every page directly in `Category:Recipes` that is in the Cookbook namespace. */
async function fetchCategoryMembers(source) {
  const titles = [];
  let cont;
  do {
    const params = {
      action: "query",
      list: "categorymembers",
      cmtitle: "Category:Recipes",
      cmnamespace: "102",
      cmlimit: "500",
    };
    if (cont !== undefined) params.cmcontinue = cont;
    const json = await getJson(source, apiUrl(EN_HOST, params));
    for (const member of json.query.categorymembers) titles.push(member.title);
    cont = json.continue?.cmcontinue;
  } while (cont !== undefined);
  return titles;
}

/** `{ title, wikitext }` for every title, fifty titles per request. */
async function fetchWikitext(source, host, titles) {
  const pages = [];
  for (const batch of chunk(titles, TITLES_PER_REQUEST)) {
    const json = await getJson(
      source,
      apiUrl(host, {
        action: "query",
        prop: "revisions",
        rvprop: "content",
        rvslots: "main",
        titles: batch.join("|"),
      }),
    );
    for (const page of json.query.pages) {
      const content = page.revisions?.[0]?.slots?.main?.content;
      if (typeof content === "string") pages.push({ title: page.title, wikitext: content });
    }
  }
  return pages;
}

/** Every page whose title starts with `Kuvar:` on sr.wikibooks. */
async function fetchSerbianTitles(source) {
  const json = await getJson(
    source,
    apiUrl(SR_HOST, { action: "query", list: "allpages", apprefix: "Kuvar:", apnamespace: "0", aplimit: "100" }),
  );
  return json.query.allpages.map((page) => page.title);
}

/** The ids, made unique in the order the sources are merged. */
function uniqueId(used, wanted) {
  const base = wanted === "" ? "recipe" : wanted;
  let candidate = base;
  for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${base}-${suffix}`;
  used.add(candidate);
  return candidate;
}

export async function build() {
  const started = Date.now();
  const source = createSource(PACK_ID);
  const stats = {};
  const used = new Set();
  const recipes = [];
  const report = [];

  // A `Map` is not JSON, so the walk caches as its entries and is rebuilt here:
  // caching the `Map` itself would write `{}` and load an empty tag table.
  const kinds = new Map(
    await cached(source, "en-category-kinds.json", `category tree walk (${EN_HOST})`, async () => [...(await fetchCategoryKinds(source))]),
  );
  const members = await cached(source, "en-category-pages.json", `Category:Recipes members (${EN_HOST})`, () => fetchCategoryMembers(source));
  const enPages = await cached(source, "en-pages.json", `wikitext of ${String(members.length)} Cookbook pages (${EN_HOST})`, () =>
    fetchWikitext(source, EN_HOST, members));

  let dropped = new Map();
  let kept = 0;
  for (const page of enPages) {
    const result = parseWikibooksPage({ title: page.title, wikitext: page.wikitext, host: EN_HOST, language: "en", kinds, stats });
    if (result.recipe === undefined) {
      dropped.set(result.drop, (dropped.get(result.drop) ?? 0) + 1);
      continue;
    }
    const id = uniqueId(used, `wikibooks-${slugify(result.recipe.title)}`);
    recipes.push({ id, ...result.recipe });
    kept += 1;
  }
  report.push({ name: "en.wikibooks.org Cookbook", fetched: enPages.length, kept, dropped: [...dropped] });

  const srTitles = await cached(source, "sr-pages.json", `Kuvar: pages (${SR_HOST})`, async () =>
    fetchWikitext(source, SR_HOST, await fetchSerbianTitles(source)));
  dropped = new Map();
  kept = 0;
  for (const page of srTitles) {
    const result = parseWikibooksPage({ title: page.title, wikitext: page.wikitext, host: SR_HOST, language: "sr", kinds, stats });
    if (result.recipe === undefined) {
      dropped.set(result.drop, (dropped.get(result.drop) ?? 0) + 1);
      continue;
    }
    const id = uniqueId(used, `kuvar-${slugify(result.recipe.title)}`);
    recipes.push({ id, ...result.recipe });
    kept += 1;
  }
  report.push({ name: `${SR_HOST} Kuvar`, fetched: srTitles.length, kept, dropped: [...dropped] });

  for (const gutenberg of GUTENBERG_SOURCES) {
    const raw = await source.text(gutenberg.url, gutenberg.file);
    const stripped = stripBoilerplate(raw);
    const parsed = gutenberg.parse(stripped.text, {
      title: gutenberg.book.title,
      url: gutenberg.book.url,
      licence: PUBLIC_DOMAIN_LICENCE,
      attribution: gutenbergAttribution(gutenberg.book),
    });
    for (const recipe of parsed.recipes) {
      // Beeton's parser numbers its recipes (`beeton-104`); Farmer's does not,
      // and a slug of the heading is what the book itself gives to name one.
      const { id: parsedId, ...rest } = recipe;
      const wanted = parsedId ?? `farmer-${slugify(recipe.title)}`;
      recipes.push({ id: uniqueId(used, wanted), ...rest });
    }
    const droppedTotal = [...parsed.dropped.values()].reduce((sum, count) => sum + count, 0);
    report.push({
      name: gutenberg.book.title,
      fetched: parsed.recipes.length + droppedTotal,
      kept: parsed.recipes.length,
      dropped: [...parsed.dropped],
      note: `boilerplate stripped: ${String(stripped.headerLines)} header + ${String(stripped.footerLines)} footer lines, `
        + `${String(stripped.removedLines)} remaining „Project Gutenberg" lines in the body`,
    });
  }

  const pack = { layout: 1, recipes };
  const folder = packsDir(PACK_ID);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(pack)}\n`, "utf8");
  writeFileSync(join(folder, "recipes.json"), bytes);
  const metaPath = `${folder}.meta.json`;
  writeFileSync(metaPath, `${JSON.stringify(metadata({ total: recipes.length }), null, 2)}\n`, "utf8");

  printFetchLog(source.log, bytes.byteLength);
  for (const row of report) {
    console.log(`  ${row.name}: ${String(row.kept)}/${String(row.fetched)} kept, dropped ${JSON.stringify(row.dropped)}`);
    if (row.note !== undefined) console.log(`      ${row.note}`);
  }
  console.log(`  category kinds: ${String(kinds.size)} categories across diet/course/cuisine`);
  console.log(`  templates dropped as untranslatable: ${String(stats.templates ?? 0)}, files removed: ${String(stats.files ?? 0)}`);
  console.log(`  recipes: ${String(recipes.length)} (en ${String(recipes.filter((r) => r.language === "en").length)}, sr ${String(recipes.filter((r) => r.language === "sr").length)}), tags on ${String(recipes.filter((r) => r.tags.length > 0).length)}`);
  console.log(`  recipes.json: ${String(bytes.byteLength)} B -> ${join(folder, "recipes.json")}`);
  console.log(`  metadata: ${metaPath}`);
  console.log(`  took ${String(Date.now() - started)} ms`);
  return { folder, metaPath, recipes: recipes.length, bytes: bytes.byteLength };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await build();
}
