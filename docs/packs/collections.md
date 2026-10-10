# The suggested collections pack (`collections-wikidata`)

Twenty-five curated lists for the Library module, built from objective Wikidata
statements and shipped as a `dataset` pack. The pack holds one file,
`collections.json`, in the layout the Library module's reader consumes
(`apps/desktop/src/modules/library/main/packCollections.ts`, layout 1), and
nothing else. It carries `CC0-1.0`, the licence of everything the Wikidata Query
Service returns; the pack records that licence, its evidence and a SHA-256 for
every fetched response in `scripts/packs/collections/sources.json`.

The content is not written by hand: `scripts/packs/collections/build.mjs` runs
the twenty-five SPARQL queries in `scripts/packs/collections/queries/` against
`https://query.wikidata.org/sparql` (cached under
`%TEMP%\nexus-pack-cache\collections-wikidata\`), converts the responses and
writes the pack to `%TEMP%\nexus-packs\collections-wikidata\` together with the
metadata file `scripts/pack-sign.mjs` takes.

## What it holds

Measured on 2026-10-10, from the build this repository last ran:

| | |
|---|---|
| collections | 25 (13 book, 9 film, 3 series) |
| entries | 1,761 — an entry is one work in one collection |
| unique Wikidata works | 1,681 (a work appears in several collections) |
| entries with a year | 1,454 |
| entries with at least one creator | 1,623 |
| entries with a Serbian label | 1,119 |
| entries with an English label | 1,419 (777 entries carry both) |
| rows dropped for having neither label | 156 of 1,917 |
| `collections.json` | 466,413 bytes, 61,051 bytes gzip -9 |
| pack version | `2026.10.10` (the day the data was fetched) |

| collection | kind | rows | entries | rows without a title | small |
|---|---|---|---|---|---|
| `booker-prize` | book | 47 | 47 | 0 | — |
| `international-booker-prize` | book | 10 | 10 | 0 | — |
| `pulitzer-prize-fiction` | book | 57 | 57 | 0 | — |
| `hugo-award-best-novel` | book | 76 | 75 | 1 | — |
| `nebula-award-best-novel` | book | 62 | 62 | 0 | — |
| `prix-goncourt` | book | 105 | 59 | 46 | — |
| `womens-prize-fiction` | book | 8 | 8 | 0 | yes |
| `german-book-prize` | book | 22 | 13 | 9 | — |
| `harvard-classics` | book | 28 | 28 | 0 | — |
| `nin-prize-winners-books` | book | 282 | 257 | 25 | — |
| `works-of-ivo-andric` | book | 63 | 58 | 5 | — |
| `isidora-sekulic-books` | book | 30 | 28 | 2 | yes |
| `kresnik-books` | book | 59 | 15 | 44 | yes |
| `academy-award-best-picture` | film | 98 | 98 | 0 | — |
| `palme-dor` | film | 84 | 83 | 1 | — |
| `golden-lion` | film | 67 | 67 | 0 | — |
| `golden-bear` | film | 90 | 90 | 0 | — |
| `studio-ghibli-films` | film | 57 | 55 | 2 | — |
| `films-by-emir-kusturica` | film | 19 | 17 | 2 | — |
| `yugoslav-black-wave-films` | film | 43 | 43 | 0 | — |
| `serbian-films` | film | 569 | 550 | 19 | — |
| `big-golden-arena-best-film` | film | 5 | 5 | 0 | yes |
| `emmy-outstanding-drama-series` | series | 11 | 11 | 0 | — |
| `emmy-outstanding-comedy-series` | series | 9 | 9 | 0 | — |
| `golden-globe-drama-series` | series | 16 | 16 | 0 | — |

## How each collection's membership is decided

Every list is one SPARQL query, and the query is the rule: `P166` *award
received* for the prize lists, `P50` *author* for the works of an author,
`P57` *director* for a director's films, `P272` *production company* for Studio
Ghibli, `P495` *country of origin* for Serbian films, and `P179` *part of the
series* for the Harvard Classics. Each query file begins with a comment naming
the criterion. The three award lists whose prize Wikidata records on the AUTHOR
rather than on the work — NIN, Isidora Sekulić, Kresnik — are queries for
"works by winners", and their collection titles say so in both languages; the
one list whose scope is a judgement rather than a statement is
`yugoslav-black-wave-films`, whose header names the three directors it selects.

The converter then applies the layout's own bounds and one rule that is worth
knowing before reading a count: **a work whose Wikidata entry carries no English
and no Serbian label is left out.** The reader requires at least one title
language and refuses the WHOLE file if an entry has neither, so a pack that kept
such an entry would offer none of its lists. That is why `kresnik-books` ships 15
entries from 59 rows; every build prints the number it dropped, per collection.
A label longer than 300 characters loses that language (and the work, if both
are over), a year outside 1..9999 is omitted rather than rounded, a credit over
120 characters is dropped rather than shrinking the list to nothing, credit
lists are de-duplicated, sorted with `Intl.Collator(["sr-Latn", "sr"])` and
capped at the layout's twenty, and two rows for one Wikidata id are folded into
one entry.

Items are ordered by year, with a work Wikidata gives no year for last, and by
title inside a year. Rebuilding from the cache writes the same bytes.

## Source, licence and evidence

The source is the Wikidata Query Service; the responses are Wikidata's own
structured data, dedicated to the public domain under **CC0 1.0**. CC0 asks for
nothing — no attribution, no share-alike, no source offer — and
`scripts/packs/collections/sources.json` records the two pages that state it,
quoted verbatim and re-fetched on 2026-10-10: `Wikidata:Copyright`
("All structured data from the main, Property, Lexeme, and EntitySchema
namespaces is available under the Creative Commons CC0 License…") and
`Wikidata:SPARQL query service/Copyright` ("Wikidata Query Service provides
information from Wikidata, which is available under CC0."). Each of the 25
records carries its query file, its URL, the day it was fetched, its size, its
row count and the SHA-256 of the response bytes.

No federated endpoint is touched: the queries contain no `SERVICE` clause, so the
responses are plain Wikidata and not the third-party data the query service's
copyright page warns about.

**A courtesy attribution travels with every collection** in its `description`
("Data from Wikidata, dedicated to the public domain under CC0 1.0." in both
languages), because layout 1 has no field of its own for one and its reader
refuses a key the layout does not define.

## What it deliberately does not contain

**No cover images.** The research measured a Wikidata image (`P18`) for 187 of
the 1,836 bundled works; 56 of those 187 carry attribution or share-alike terms
and nine works in ten have none, so a grid of covers would be mostly empty and
would stop the pack being CC0.

**No rewritten source data.** Labels are carried as Wikidata has them. Most
Serbian labels on Wikidata are written in Cyrillic — 987 of the pack's 1,119
Serbian labels — and the pack does not transliterate them: rewriting the
source's own data is not this builder's business. The pack's OWN Serbian copy
(collection titles, the pack title and description) is Latin script, like the
rest of the application.

## Rebuilding it

```text
node scripts/packs/collections/build.mjs              # reuse the cache, fetch only what is missing
node scripts/packs/collections/build.mjs --refresh    # fetch all 25 queries again
node scripts/packs/collections/build.mjs --offline    # cache only; fail rather than fetch
```

The build prints one line per collection (rows, entries, rows without a title,
whether it came from the cache) and a summary with the file size and the elapsed
time; it writes the pack folder and the metadata file, then prints the
`pack-sign` command to run. The maintainer signs it with the release key:

```text
node scripts/pack-sign.mjs \
  --dir "%TEMP%\nexus-packs\collections-wikidata" \
  --meta "%TEMP%\nexus-packs\collections-wikidata.meta.json" \
  --key <private-key.pem>
```

The refresh is 25 queries sent one at a time with an 8-second pause between
them and a descriptive `User-Agent` naming this project and the repository, which
is the pace the query service's usage policy asks for. The measured full build of
2026-10-10 took **328.3 seconds** (two of the queries, `prix-goncourt` and
`academy-award-best-picture`, took ~37 s and ~35 s; everything else was under
12 s), and a second run from the warm cache fetches nothing.

Checking a refresh against the research's 2026-10-09 harvest: 13 of the 25
responses are byte-identical, 11 differ only in the order of names inside a
`GROUP_CONCAT` (which the converter sorts away), and `kresnik-books` differs
because two of its labels were edited on Wikidata in between — `Q7242979` from
"Prikrita harmonija" to "Hidden Harmony" and `Q12797666`, which gained an English
label. Nothing else in the item sets moved.

## To be proofread by a native speaker before release

The research that chose these collections wrote their Serbian titles in Cyrillic
and flagged them as unreviewed; they are carried here transliterated into the
application's Latin script, letter for letter, and they are still unreviewed.
The same goes for the pack's own title and description, which this run wrote.
Native-speaker pass on all of them before release:

| collection | Serbian title as shipped |
|---|---|
| `booker-prize` | Dobitnici Bukerove nagrade |
| `international-booker-prize` | Dobitnici Međunarodne Bukerove nagrade |
| `pulitzer-prize-fiction` | Dobitnici Pulicerove nagrade za fikciju |
| `hugo-award-best-novel` | Dobitnici nagrade Hjugo za najbolji roman |
| `nebula-award-best-novel` | Dobitnici nagrade Nebula za najbolji roman |
| `prix-goncourt` | Dobitnici Gonkurove nagrade |
| `womens-prize-fiction` | Dobitnice Nagrade za fikciju za žene |
| `german-book-prize` | Dobitnici Nemačke nagrade za knjigu |
| `harvard-classics` | Harvardska klasika |
| `nin-prize-winners-books` | Romani dobitnika NIN-ove nagrade |
| `works-of-ivo-andric` | Dela Ive Andrića |
| `isidora-sekulic-books` | Knjige dobitnika nagrade Isidore Sekulić |
| `kresnik-books` | Knjige dobitnika nagrade Kresnik |
| `academy-award-best-picture` | Dobitnici Oskara za najbolji film |
| `palme-dor` | Dobitnici Zlatne palme |
| `golden-lion` | Dobitnici Zlatnog lava |
| `golden-bear` | Dobitnici Zlatnog medveda |
| `studio-ghibli-films` | Filmovi studija Gibli |
| `films-by-emir-kusturica` | Filmovi Emira Kusturice |
| `yugoslav-black-wave-films` | Filmovi jugoslovenskog crnog talasa |
| `serbian-films` | Srpski filmovi |
| `big-golden-arena-best-film` | Dobitnici Velike zlatne arene |
| `emmy-outstanding-drama-series` | Dobitnici Emija za najbolju dramsku seriju |
| `emmy-outstanding-comedy-series` | Dobitnici Emija za najbolju komediju |
| `golden-globe-drama-series` | Dobitnici Zlatnog globusa za najbolju dramsku seriju |

Pack title: „Predložene zbirke za biblioteku". Pack description: „25 predloženih
zbirki sa Vikipodataka: književne nagrade, filmske nagrade, televizijske serije i
regionalne liste. … Bez korica."
