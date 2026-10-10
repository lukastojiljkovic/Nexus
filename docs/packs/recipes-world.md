# `recipes-world` — world and historical recipes

A `dataset` pack, `layout: 1`, one file: `recipes.json`. Everything a recipe
needs to be cooked from — title, ingredients, steps — from three openly licensed
or public-domain families, each record carrying its own source, licence and
attribution.

## What it contains

`{ "layout": 1, "recipes": [ { "id", "title", "language", "servings"?, "ingredients", "steps", "tags", "source" } ] }`

* `id` is kebab-case and unique in the pack. A Wikibooks page becomes
  `wikibooks-<slug>` (or `kuvar-<slug>` for the Serbian ones), a Beeton recipe
  keeps its number (`beeton-104`), and a Farmer recipe is
  `farmer-<slug>`. Where two titles slugify the same, the second gets `-2`.
* `title` is the source's own heading — the page title without its `Cookbook:`
  or `Kuvar:` prefix, the capitalised line above Beeton's recipe number, or
  Farmer's centred heading.
* `language` is `en` or `sr`. Seven records are Serbian.
* `servings` is present only where the source states a yield, and is that
  statement verbatim: Wikibooks' `Yield` infobox field („4 portions"), the
  Serbian pages' `sastojci: Za broj osoba: 4`, or Beeton's `_Sufficient_` line
  („Allow 6 eggs for 3 persons"). Nothing here is computed.
* `ingredients` and `steps` are the source's own lines. Wikitext links become
  their display text, bold and italic marks and templates are removed, hard
  wrapping is unwrapped, and nothing is rewritten, summarised or translated.
* `tags` are the kinds of category the Cookbook's own tree places — the
  subcategories of `Category:Recipes by origin`, `… by meal or course` and
  `… by diet` — as `cuisine:french`, `course:dessert`, `diet:vegetarian`. The
  wiki decides which category means what; the builder walks that tree (201
  categories) rather than carrying a list.
* `source` names the page (or book), its URL, its licence and its attribution.
  For Wikibooks the attribution quotes the Wikimedia Terms of Use sentence that
  a reuser satisfies by linking to the page, and carries the modification notice
  CC BY-SA 4.0 section 3(a)(1)(B) requires. For the two books it names Project
  Gutenberg as the source and records that its licence and name were stripped
  from the text, as that licence requires.

### Measured contents of the 2026-10-10 build

| Source | Seen | In the pack | Dropped, and why |
| --- | ---: | ---: | --- |
| en.wikibooks.org Cookbook, `Category:Recipes` | 3,796 | 3,761 | 26 pages with no procedure heading, 7 with no ingredients heading, 2 with an empty ingredients section |
| sr.wikibooks.org, the seven `Kuvar:` pages | 7 | 7 | — |
| Mrs Beeton, *The Book of Household Management* | 1,298 | 1,274 | 24 numbered recipes with no `_Mode_.--` paragraph |
| Fannie Farmer, *The Boston Cooking-School Cook Book* | 862 | 810 | 42 headings whose ingredient list was empty, 10 with no method paragraph |
| **Total** | 5,963 | **5,852** | 111 |

`recipes.json` is 8,758,784 bytes. 5,845 records are English and 7 are Serbian;
3,014 carry at least one tag. 416 templates the converter does not understand
and 848 image links were removed, and the build prints those two counts so the
loss is visible rather than quiet.

Beeton's 1,298 is exact: a recipe is a numbered paragraph that begins
`INGREDIENTS.--`. Farmer's 862 is a heuristic count — the book gives no total,
and the test the research run measured is „a centred heading followed within
eight lines by an indented quantity", which 611 ingredient lines also pass;
those are consumed by the recipe that owns them rather than published as
records of their own. The research run's own Farmer figure was an estimate from
layout, and the pack reports what it actually kept.

Farmer's book is parsed between its own `CHAPTER I` and `CHAPTER XXXVIII`
headings, so the contents, the prefaces, the menus chapter, the glossary and the
index are not searched for recipes.

## Sources and licences

* **Wikibooks Cookbook** (3,796 pages) and the **Serbian Wikibooks Kuvar** (7
  pages): CC BY-SA 4.0, dual-licensed with the GFDL; this pack takes the
  CC BY-SA 4.0 half only. The pack carries the same licence.
* **The Book of Household Management** (Mrs Beeton, d. 1865) and **The Boston
  Cooking-School Cook Book** (Fannie Merritt Farmer, d. 1915): public domain in
  the United States and out of copyright in the EU. Both are Project Gutenberg
  texts whose licence and name were stripped from the text, as that licence
  requires; the credit is in `source.attribution`.

Exact URLs, byte counts, SHA-256 digests, licences and the quoted licence
evidence — including the catalogue rows that state both authors' life years —
are in [`scripts/packs/recipes/sources.json`](../../scripts/packs/recipes/sources.json).

## How to rebuild it

```text
node scripts/packs/recipes/build.mjs
node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\recipes-world \
  --meta %TEMP%\nexus-packs\recipes-world.meta.json --key <release-key.pem>
```

The build downloads the two books and the two wiki harvests into
`%TEMP%\nexus-pack-cache\recipes-world\` and reuses them on a second run. The
MediaWiki API takes fifty titles per request, so the 3,796 pages are 76 calls
with a 200 ms gap rather than 3,796 calls with a back-off; the whole corpus
costs under a minute. The 2026-10-10 run took 98,345 ms with an empty cache and
670 ms with a full one, and prints everything it fetched, everything it dropped
and the time.

Its tests are `scripts/packs/recipes/convert.test.mjs`, which converts the
fixtures in `scripts/packs/recipes/fixtures/`: three Cookbook pages (one with
`=== Batter ===` sub-headings, one that keeps its ingredients in a wikitable,
one with an infobox yield), two `Kuvar:` pages, two Beeton recipes, two Farmer
recipes, and the two ends of the Project Gutenberg wrapper.
