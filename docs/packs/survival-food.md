# `survival-food` and `recipes-preserving`

The Food chapter of the Survival set: how to preserve food safely, how to keep
food safe when the power goes out, and how to cook when there is no power — all
of it the sources' own text. It is built by `scripts/packs/survival-food/`, and
nothing in this repository is pack content except the fixtures the builder's
tests read.

Two packs come out of one builder:

| Pack | Kind | What it is |
|---|---|---|
| `survival-food` | `content` | 24 articles, `notice: "safety"`, `language: en` |
| `recipes-preserving` | `dataset` | 37 recipes in the Cookbook's `recipes.json` layout, version 1 |

The panel below is measured, not estimated, from a full run on 2026-10-10 (the
exact numbers are printed by the builder itself).

| | content pack | dataset pack |
|---|---|---|
| Files | 48 | 1 |
| Bytes | 7 089 297 | 55 846 |
| Articles | 24 (2 166 102 B) | — |
| Figures | 24 JPEG (4 914 313 B) | — |
| `content.json` | 8 882 B | — |
| Recipes | — | 37 (55 846 B) |

## What is in it

### Home canning — the USDA Complete Guide

Eight articles, one per part of *Complete Guide to Home Canning, Revised 2015*
(Agriculture Information Bulletin No. 539), which NCHFP hosts as eight PDFs:
Introduction, Guide 1 Principles of home canning, Guides 2–7 (fruit, tomatoes,
vegetables, poultry/red meats/seafoods, fermented foods and pickled vegetables,
jams and jellies). Converted from the PDF text layer with `pdfjs-dist`, tables
and all: **90 tables with 514 rows**, every cell of every table checked against
the glyph runs printed in it by the build itself before it writes a byte.

### Power outages, botulism, carbon monoxide

Ten federal pages, converted from their HTML: FSIS *Keep Your Food Safe During
Emergencies*, CDC *Keep Food Safe After a Disaster or Emergency*, FoodSafety.gov
*Food Safety During Power Outage*, CDC *About Botulism* and *Botulism
Prevention*, FSIS *Jerky and Food Safety*, CDC *About Carbon Monoxide
Poisoning*, Ready.gov *Power Outages*, *Food* and *Water*.

### Field cooking and historical rations

Four public-domain scans from the Internet Archive, shipped as their own text:
TM 10-405 *The Army Cook* (1941), *Manual for Army Cooks* (1914), *Extracts from
the Manual for Army Cooks* (1917) and *Hardtack and Coffee* (1887). Each article
begins at the work's own title page: the scans open with Google Books'
digitisation notice, which is the scanner's text and not the work's.

### Further reading (links, not shipped)

One article lists the sources that were researched and are **not** in the pack,
each with its licence named and quoted from the page that states it: the National
Center for Home Food Preservation (all rights reserved), the Sphere Handbook
(free reproduction for educational use only; written permission for online
reuse), WHO (CC BY-NC-SA 3.0 IGO, non-commercial), Solar Cookers International
and Aprovecho (both © with no open licence). A link is not a reproduction.

### Sources, licences and attribution

One article carries, for every work in the pack, its publisher, its licence and
the licence's own sentence quoted from the page that states it — plus the CDC's
attribution and non-endorsement lines, quoted, because the CDC's reuse policy
requires the disclaimer itself rather than a paraphrase of it.

### Preserving recipes

37 recipes out of Guide 6: the fermented foods and the pickled vegetables, with
**sauerkraut** among them. Each recipe is the guide's own ingredient lines and
the guide's own procedure sentences; nothing is translated, shortened or
reworded, and no recipe appears that the guide does not print.

There is deliberately **no ajvar, turšija, slatko or pekmez**: the research found
no Serbian preserving source with a licence that permits shipping, and a recipe
nobody sourced is exactly what must not be invented. A test asserts their
absence.

## Sources and licences

Every source, its URL, the date it was fetched, its SHA-256, its licence and the
licence evidence are in `scripts/packs/survival-food/sources.json`. The builder
fetches every licence-evidence page and **checks that the quoted sentence is on
it** before it writes anything; a licence claim it cannot verify stops the run.

| Source family | Works | Licence | Evidence |
|---|---|---|---|
| USDA (guide, FSIS, FoodSafety.gov) | 12 | US Government work; USDA asks for credit and carves out some third-party material | <https://www.usda.gov/about-usda/policies-and-links> |
| CDC | 5 | Public domain, with attribution, a non-endorsement disclaimer and no substantive change | <https://www.cdc.gov/other/agencymaterials.html> |
| Ready.gov / FEMA | 3 | Most material free of copyright; licensed photos and graphics excluded | <https://www.fema.gov/about/website-information> |
| Internet Archive scans | 4 | Public Domain Mark 1.0 / not in copyright (US Government Printing Office imprints) | <https://archive.org/metadata/TM10-405> |

The pack's own `pack.json` says `LicenseRef-Public-Domain-US-Government` and
carries the attribution the UI always shows.

## How to rebuild it

```
node scripts/packs/survival-food/build.mjs             # build both packs
node scripts/packs/survival-food/build.mjs --measure   # print the type-size and
                                                       # baseline-step measurements
node scripts/packs/survival-food/build.mjs --fixtures  # rewrite the test fixtures
```

Sources are cached under `%TEMP%\nexus-pack-cache\survival-food\` with an
`index.json` holding each file's URL, redirect target, SHA-256 and fetch date, so
a rebuild costs no network at all. The packs are written to
`%TEMP%\nexus-packs\survival-food\` and `%TEMP%\nexus-packs\recipes-preserving\`,
along with:

- `scripts/packs/survival-food/sources.json` — the evidence record;
- `scripts/packs/survival-food/pack.survival-food.meta.json` and
  `pack.recipes-preserving.meta.json` — the metadata `pack-sign.mjs` takes.

The maintainer signs with the release key, which this repository never holds:

```
node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\survival-food \
  --meta scripts/packs/survival-food/pack.survival-food.meta.json --key <release key>
node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\recipes-preserving \
  --meta scripts/packs/survival-food/pack.recipes-preserving.meta.json --key <release key>
```

`minAppVersion` is `1.6.0`: the release that carries content packs (ADR-091) and
the Reader's safety notice. The maintainer sets the final number when signing.

## What the build proves before it writes anything

1. **Every licence claim is on the page it cites**, sentence by sentence.
2. **Every glyph run of every USDA guide is in exactly one block** of the
   converted document, checked run by run (`documentFindings`).
3. **Every table cell holds the runs printed in it**, checked cell by cell
   (`tableFindings`) — 90 tables and 514 rows in this run, no findings.
4. **Every article's Markdown, with its markup stripped, is the source's text**,
   compared after whitespace normalisation. A run that fails stops the build.

The tests in `scripts/packs/survival-food/*.test.mjs` run the same three checks
over fixtures cut from the real sources: Guide 6's page 6-15 as its positioned
glyph runs (12.5 KB) and 20 KB of the FSIS power-outage page.

## What the converter does to the text, and why

Markup only. The list below is the whole of it, and each entry is a decision a
reader can check against the source:

- **Page furniture is dropped**: the guide's running heads and its page-number
  stamps (`6-16`). They are positions in a printed book, not part of its
  instructions. The rule is measured — a single-run line in a page margin,
  repeated across the pages — not a list of strings.
- **A page's chrome is dropped**: navigation, asides and footers by their tag or
  ARIA role, and a *short* container whose class or id names a menu, a share bar
  or a language switcher. The size bound is measured on both sides — Ready.gov's
  language switcher holds 415 characters and the smallest article here 3 442 —
  because the rule that deleted chrome by class name alone also deleted this
  page's whole content, its layout wrapper being called `l-sidebar`.
- **Unmapped word spaces are restored.** The guide's table fonts leave the word
  space without a Unicode mapping, so `pdfjs` reports U+FFFD where the page
  prints a space. Measured over all eight guides: 1 824 runs contain it and
  every one has it between two word characters (`Style␣of␣Pack`, `5␣min`), and
  rendering page 6-15 shows `Style of Pack`.
- **Wrapped table cells are joined**, because `Style` and `of Pack` are two lines
  of one cell, and a table is the only honest rendering of a processing time.
  The rule is measured, not guessed: table lines step 10.3 pt within a cell and
  13.6 pt and up between rows, and 11.5 pt sits in the empty part of that
  histogram.
- **Markdown-significant characters are escaped** — `*`, `_`, `` ` ``, `[`, `]`,
  `|`, `<`, `&` — and unescaped again when the text is compared. Guide 2 prints
  a footnote `**` that read as emphasis without this, and the OCR of the Army
  manuals has bare `<` where a letter was misread.

## What is **not** converted, and what a human must still check

- **49 pages of the eight guides are kept as verbatim lines rather than read as
  tables** (Guide 1: 2, Guide 2: 20, Guide 3: 2, Guide 4: 3, Guide 5: 1,
  Guide 6: 15, Guide 7: 6). The guide's PDFs carry **hidden copies of tables**
  in their text layer — page 6-8's text layer holds a complete Sauerkraut process
  table threaded through the prose, and the printed page shows no such table
  (checked by rendering it) — and on those pages the layout alone cannot say
  which copy is printed. Rather than guess at a page where a wrong column is the
  one dangerous error this pack can carry, the page is emitted as its own lines
  in a fenced block: every character, no claimed structure.
- **Figures are the guide's own embedded images, and their credits are not in
  the text layer.** The USDA's own policy carves out material it does not own,
  and the research run flagged this: **the 24 figures must be checked page by
  page by a human before the pack is signed.** If any of them turns out to be
  third-party, delete it from the article and the image from the pack; nothing
  else depends on them.
- **A word broken at a column edge reads with a space after its hyphen**
  (`tem- peratures`). The hyphen is the guide's; joining the halves would delete
  a character the page prints, and joining every trailing hyphen would also
  mangle `3- to 4-inch`.
- **The Serbian zimnica (ajvar, turšija, slatko, pekmez) is not in the pack**:
  no openly licensed Serbian preserving source was found (the research's §2.9),
  and the pointers to modern Serbian sources live outside this pack.
- **NCHFP, Sphere, WHO, Solar Cookers International and Aprovecho are linked,
  not shipped**, because their licences do not permit redistribution.

## The fixtures

`scripts/packs/survival-food/fixtures/` holds two cuts of real sources, both
public domain: `usda-guide6-p15.items.json` (one page of Guide 6 as pdfjs reads
it: every glyph run with where it was printed) and `fsis-power-outage.html` (the
article section of the FSIS page). They are a few kilobytes each and are
regenerated by `build.mjs --fixtures`. No other pack content is in this
repository; ADR-091's pack is signed from `%TEMP%` and installed by the app.
