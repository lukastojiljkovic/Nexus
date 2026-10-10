# The Make pack — `make-by-hand`

Mending and making things by hand: darning and patching, hand sewing, candles
and soap, the care of simple tools, and clay and its firing. The text is the
sources' own, verbatim; the conversion changes markup, the figure images and one
Source line per article, and nothing else.

| | |
|---|---|
| Pack id | `make-by-hand` |
| Kind | `content` (layout 1, `language: "en"`) |
| Notice | `safety` — fire, blades and hot wax |
| Version | `2026.10.0` |
| Articles | 31, in 5 chapters |
| Figures | 64 drawings, each with the source's own caption |
| Measured size | **1437.9 KiB (1,472,373 bytes) in 96 files** — the pack folder, `content.json` and `images/` included |
| Text | 280,790 characters of Markdown |
| Sources | 11 documents: 3 US government bulletins, 5 Project Gutenberg editions, 3 Wikibooks pages |
| Build | 22.7 s from an empty cache (10.9 s of it fetch+convert, the rest the 64 figure downloads); 0.2 s from the cache |

Builder: `scripts/packs/make/` — `build.mjs`, `lib/` (the three converters and
the block model), `sources.json`, `fixtures/`, `convert.test.mjs`,
`fidelity.test.mjs`.

## 1. What the pack contains

Every article is a span of the source between two of the source's own printed
headings. Nothing here duplicates the Survival pack: that pack ships FM 21-76's
chapter 12 (clay pots, utensils, cordage) and its fire and shelter chapters, and
this one is cut from none of them.

| Chapter | Articles | Source of the text | Figures |
|---|---|---|---|
| 1. Mending clothes | 15 | USDA Farmers' Bulletin No. 1925, *ABC's of Mending* (1942); USDA Miscellaneous Publication No. 482, *Mending Men's Suits* (1943); *Textiles and Clothing* (darning, patching, repairing); *Needlework Economies* (ten items: re-soling, re-footing, re-heeling, shirts, collars, worn garments, sheets, table linen, blanket hems, preventive mending) | 21 |
| 2. Candles and soap | 5 | USDA ACS-27, *Candle Making* (1940); *Soap-Making Manual* (the materials: what soap is, fats and oils, the alkalies, other materials) | 0 |
| 3. Tools and wood | 4 | *Carpentry for Boys* — tools and their uses, grinding and sharpening, the best woods, useful articles to make | 37 |
| 4. Clay and fire | 4 | *The Potter's Craft* — the nature and properties of clay, its preparation, building by hand, the fire | 0 |
| 5. Wikibooks pages (CC BY-SA 4.0) | 3 | Wikibooks: *Sewing/Hand sewing*, *Woodworking/Sharpening*, *Adventist Youth Honors Answer Book/Arts and Crafts/Candlemaking* | 0 |

Chapter 5 exists because those three pages are CC BY-SA 4.0 while everything
else in the pack is public domain. Keeping them in one labelled chapter is what
keeps the share-alike boundary a folder rather than a memory: the text that
carries the obligation sits together, unmodified, with its attribution in the
article's own Source line and in `content.json`.

## 2. Sources, and the sentence each licence was read from

Three licence bases carry the pack, and each is quoted from the page it was read
on. Every source's URL, size, SHA-256 and evidence sentence is in
`scripts/packs/make/sources.json`.

**Works of the U.S. Government** — the three bulletins. Basis: no copyright
subsists in them, and each scan prints its own Department of Agriculture
imprint.

> Copyright protection under this title is not available for any work of the United States Government, but the United States Government is not precluded from receiving and holding copyrights transferred to it by assignment, bequest, or otherwise.

— [17 U.S.C. 105(a)](https://www.govinfo.gov/content/pkg/USCODE-2023-title17/html/USCODE-2023-title17-chap1-sec105.htm)
(read 2026-10-10).

| Source | Imprint the scan prints | URL |
|---|---|---|
| Farmers' Bulletin No. 1925, *ABC's of Mending* | United States Department of Agriculture, Bureau of Home Economics; by Clarice L. Scott | `https://archive.org/download/CAT87203517/farmbul1925_djvu.txt` |
| Miscellaneous Publication No. 482, *Mending Men's Suits* | United States Department of Agriculture, Bureau of Home Economics; by Clarice L. Scott and Anne F. Hagood, issued January 1943 | `https://archive.org/download/mendingmenssuits482scot/mendingmenssuits482scot_djvu.txt` |
| ACS-27, *Candle Making* | United States Departments, Bureau of Agricultural Chemistry and Engineering, Carbohydrate Research Division, 1940 | `https://archive.org/download/candlemaking27unit/candlemaking27unit_djvu.txt` |

The Internet Archive items also carry a contributor's statement ("The
contributing institution believes that this item is not in copyright"), which is
**not** the evidence this pack rests on: an uploader's tag is metadata, not a
determination. The statutory base and the printed imprint are what the pack
relies on, and both are quoted above.

**Project Gutenberg editions** — the five books. Basis: Gutenberg's own rights
statement for each ebook is `Public domain in the USA.` (read from each ebook's
`.opds` record on 2026-10-10).

> The vast majority of Project Gutenberg eBooks are in the public domain in the US.

— [Project Gutenberg, *Permissions and licensing*](https://www.gutenberg.org/policy/permission.html)
(read 2026-10-10).

| Ebook | Work | URL pinned |
|---|---|---|
| 20763 | *Carpentry for Boys*, J. S. Zerbe, New York Book Company, 1914 | `https://www.gutenberg.org/cache/epub/20763/pg20763-images.html` |
| 21534 | *Textiles and Clothing*, Kate Heintz Watson, American School of Home Economics | `https://www.gutenberg.org/cache/epub/21534/pg21534-images.html` |
| 48050 | *Needlework Economies: A Book of Mending and Making with Oddments and Scraps*, 1919 | `https://www.gutenberg.org/cache/epub/48050/pg48050-images.html` |
| 34114 | *Soap-Making Manual*, E. G. Thomssen, D. Van Nostrand Company, 1922 | `https://www.gutenberg.org/cache/epub/34114/pg34114-images.html` |
| 40411 | *The Potter's Craft*, Charles F. Binns, D. Van Nostrand Company, second edition 1922 | `https://www.gutenberg.org/cache/epub/40411/pg40411-images.html` |

The **HTML** edition of each is pinned rather than the plain-text one, and the
reason is the figures: a plain-text edition of a 1914 book carries
`[Illustration: …]` markers where the drawings are, and a pack about sharpening
a saw with no saw in it is a weaker pack. The HTML edition names each drawing
(`images/fig13.jpg`) and prints its caption in its own `span.caption`, so every
figure in this pack carries the source's caption and not one this builder wrote.

**Wikibooks** — the three pages. Basis: CC BY-SA 4.0 (with the GNU Free
Documentation License), used verbatim and unmodified.

> Wikibooks is a collection of free content books licensed under the terms of the GNU Free Documentation License and Creative Commons Attribution-ShareAlike 4.0 License

— [Wikibooks:Copyrights](https://en.wikibooks.org/wiki/Wikibooks:Copyrights)
(read 2026-10-10). Each page's credit line in `sources.json` and in every
article's Source line names the page and the licence.

## 3. The candidate list, and why each was taken or left

Written before the build, from the research in `research/survival/report.md`,
`research/editions/report.md` and `research/preserve/report.md` plus the searches
recorded below. A candidate without a licence sentence was not used, however
good it looked.

**Taken.**

| Candidate | Licence evidence | Verdict |
|---|---|---|
| USDA Farmers' Bulletin No. 1925, *ABC's of Mending* (1942) | 17 U.S.C. 105(a) + the Department of Agriculture imprint on the scan | Taken — the pack's mending spine: planning, the mending basket, darning, patching, buttons |
| USDA Miscellaneous Publication No. 482, *Mending Men's Suits* (1943) | as above | Taken — wool, thread, beeswax, pressing supplies, thin elbows, relining sleeves, worn edges |
| USDA ACS-27, *Candle Making* (1940) | as above | Taken — the only federal candle-making document found, and short enough to ship whole |
| PG 48050, *Needlework Economies* (1919) | `Public domain in the USA.` | Taken — ten whole items on mending and re-making, with the edition's own captioned figures |
| PG 21534, *Textiles and Clothing* | as above | Taken — its darning, patching and repairing sections |
| PG 20763, *Carpentry for Boys* (1914) | as above | Taken — tools, sharpening, woods, and articles to make, 37 captioned drawings |
| PG 40411, *The Potter's Craft* (1922) | as above | Taken — clay, hand-building and firing (glazes excluded, see §4) |
| PG 34114, *Soap-Making Manual* (1922) | as above | Taken in part — the materials chapters only, see §4 |
| Wikibooks *Sewing/Hand sewing*, *Woodworking/Sharpening*, *Adventist Youth Honors Answer Book/…/Candlemaking* | CC BY-SA 4.0 sentence above | Taken, verbatim, in their own labelled chapter |

**Left, with the reason.** Each of these was looked at and rejected on licence,
on subject, or on quality; a rejection recorded is a rejection somebody else does
not have to repeat.

| Candidate | Why not |
|---|---|
| FM 3-05.70, *Survival* (2002) | Its cover restricts distribution to U.S. Government agencies and their contractors. Copyright is clear (a US Government work), the dissemination control is a different regime, and the Survival pack reached the same conclusion. Not needed here in any case. |
| iFixit | CC BY-NC-SA 3.0 and explicitly closed to AI/ML training. The pack is a separate free download so NC is permissible under the founder's rules, but the repair guides are screens-and-devices material, not hand work, and the survival of the NC obligation across a merged repository is not worth it for content this pack does not need. |
| Stack Exchange (Home Improvement, The Great Outdoors) | CC BY-SA and large; a Q&A corpus is not a book, and an article made of one answer would be a selection this builder invented. Left out. |
| wikiHow | Its terms do not permit reuse outside the site (the reuse right is limited to the Service). Unusable. |
| Red Cross of Serbia | All rights reserved; no written licence. |
| *The Pocumtuc Housewife* (1897) — candle dipping and soap making | Public domain by date, but the only "evidence" available was the Internet Archive item's own tag, which is uploader metadata and not a determination. The 1940 federal candle circular covers the subject with a statutory base, so this was not needed. |
| *Household Discoveries* (Morse, 1909 and later) | Same problem: no publisher's statement found to quote, and its soap and candle recipes are the same 19th-century trade practice with the same lye problem. |
| Michael Faraday, *The Chemical History of a Candle* (PG 14474) | A lecture on combustion, not on making candles. Rejected on subject. |
| *A Select Collection of Valuable and Curious Arts* (PG 38067) | Candles appear only as laboratory props in chemical experiments. Rejected on subject. |
| Wikibooks *Do-It-Yourself/Soap* | CC BY-SA, so licensable — but its "How to do" section mixes lye with a Bunsen burner and glassware, and one line is a Lua parser function (`{{#invoke:temperature|f|110}}`) whose value is not in the wikitext. A page whose text cannot be shipped verbatim, and whose procedure is handled better by a modern tested source, is not a source for this pack. |
| Wikibooks *Sewing/Seams* | Contains a `[[File:…]]` link: the caption is the page's own text and the image is not in this pack, so the converter **refuses** the page rather than silently dropping either. The hand-sewing page covers the same ground without one. |
| PG 43604, *Wood-working for Beginners* | A good candidate; not taken because *Carpentry for Boys* covers the same ground (tools, sharpening, joints) and one woodworking voice is enough for the first edition of this pack. |
| PG 38248, *Pottery, for Artists, Craftsmen & Teachers* | Same subject as *The Potter's Craft*; the second was taken because its chapters are addressed to a studio rather than a works. |
| USDA Farmers' Bulletin 1944, *Sewing Machines: Cleaning and Adjusting* (1943); FB 1960, *Carpet and Rug Repair* (1944); FB 1917, *Removal of Stains from Clothing*; FB 1920, *Selection and Care of Clothing*; the *Care and Repair of Farm Implements* series (1918) | All federal and all usable. Left out of v1 on scope: the pack is about hand work, and each of these is a subject of its own (a machine, a floor covering, a stain, a wardrobe, a plow). |

## 4. What was left out, and why

Old manuals carry practice that is unsafe or outlawed, and the rule for a safety
pack is to leave such passages out and say which. The build enforces this: it
refuses to write an article whose text matches a pattern for lead in a glaze,
asbestos, arsenic, mercury, hydrofluoric acid or a drug dose, and it verifies
that every omission listed here is really present in the source it names — a
list of what was left out is checked, never trusted.

**Whole chapters not shipped, from the soap manual** (all present in the source,
and all verified by the build):

| What | Why |
|---|---|
| Chapter II, *Construction and Equipment of a Soap Plant* | A factory's plant and machinery. |
| Chapter III, *Classification of Soap-Making Methods* | Full-boiled, cold and carbonate saponification: caustic lye handled at works scale, with no safe-handling instructions for a kitchen. |
| Chapter V, *Glycerine Recovery* | Industrial chemistry; works reagents. |
| Chapter VI, *Analytical Methods* | A laboratory's methods and apparatus. |
| Chapter VII, *Standard Methods for the Sampling and Analysis of Commercial Fats and Oils* | The same, for fats and oils bought by the tank car. |

**What that leaves of soap making, stated plainly.** The pack ships what soap is
made of — saponification, the fats and oils, the alkalies, the other materials —
and **no procedure at all**. Every soap-making procedure in every source this
run could licence (this manual, the Wikibooks page) dissolves caustic soda
without the instructions a person needs in a kitchen: add the lye to the water
and not the water to the lye, wear eye protection and gloves, work where a spill
can be washed, and know what to do on contact. Writing those instructions here
would be this pack authoring safety text, which the pack rules forbid, so the
procedures are left out and this paragraph says why rather than shipping a
weaker version quietly.

**From *The Potter's Craft*:**

| What | Why |
|---|---|
| Chapter XV, *Glazes and Glazing* | Lead glazes. The chapter's recipes are the historic practice — white lead, litharge, red lead — and lead in a glaze is poison in a workshop that fires pots by hand. The pack ships how a pot is made and how it is fired, and no glaze recipe at all. |
| Chapter XIII, *Casting* | Slip casting and plaster work: a pottery's work rather than a home workshop's, and its material is fine plaster dust. |
| One sentence, in *The Fire*: "The kiln having arrived it is mounted on the platform and the asbestos-lined pipe is securely connected with the chimney." | Asbestos. The chapter's kiln is joined to its chimney with an asbestos-lined pipe; the sentence is removed from the source before conversion (so the article and the fidelity oracle never disagree about it), and what the chapter says about fuelling, stacking and drawing a kiln is either side of it. |

**Drawings not shipped, and the captions kept.** In *Carpentry for Boys* and
*Needlework Economies* some drawings are set as two-up plates inside a table
(`<table data-summary="Fig 17/18">`): an image, and its caption in a paragraph
in the row below. The pack keeps the caption — it is the source's own text and it
travels through the converter like any other paragraph — and does not ship those
drawings, because they are laid out as table cells rather than as the edition's
figure containers. The count is printed by every build: 66 images in *Carpentry
for Boys* (which has 143 captioned figures in figure containers), 9 in
*Needlework Economies*, 47 uncaptioned plates in *The Potter's Craft*.

**The OCR layer's own errors are shipped as they are.** Two of the three
bulletins are scans, and their text layer is what the scan says — `Uiendipg` for
`Mending`, `CANDLE MANING` for `CANDLE MAKING`, `Oarbohydrate` for
`Carbohydrate`. They are kept, because "verbatim" for a scan means the OCR's
words, and a builder that silently repaired them would be editing the source.
The National Agricultural Library's own banner and the stamps of the libraries
that scanned the copies are taken out, and every build prints how many lines each
furniture pattern removed, so a pattern that stops matching is visible.

## 5. Rebuilding the pack

```
node scripts/packs/make/build.mjs              # build the pack
node scripts/packs/make/build.mjs --fixtures   # re-cut the test fixtures
node node_modules/vitest/vitest.mjs run --configLoader runner --maxWorkers=1 scripts/packs/make
```

The build downloads every source `sources.json` names into
`%TEMP%\nexus-pack-cache\make-by-hand\`, verifies each download against the size
and SHA-256 that file records, converts, proves the fidelity of every article,
writes the figures, and writes the pack to `%TEMP%\nexus-packs\make-by-hand\`
with the metadata for the signing tool beside it:

```
node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\make-by-hand \
  --meta %TEMP%\nexus-packs\make-by-hand.meta.json --key <release-key.pem>
```

Nothing here is signed by this run, and no key is read by anything in
`scripts/packs/make/`. Re-running reuses the cache; a cached file whose digest no
longer matches the evidence is discarded and fetched again. A source that has
changed under a rebuild — a Wikibooks page is edited most weeks — stops the build
with the digest it found, so the evidence is updated deliberately rather than a
silently different article being shipped.

The figures are pinned as a set rather than one at a time: `figuresSha256` in
`sources.json` is the SHA-256 of the newline-joined `name space digest` lines of
the figures a book ships, sorted by name. A mismatch prints the digest that was
computed, so re-pinning is one copy.

## 6. What was measured

| Measure | Value |
|---|---|
| Pack folder | 1437.9 KiB (1,472,373 bytes), 96 files — `content.json`, 31 articles, 64 images |
| Articles | 31 (15 + 5 + 4 + 4 + 3) |
| Text | 280,790 characters of Markdown |
| Figures | 64: 37 from *Carpentry for Boys*, 21 from *Needlework Economies*, 6 from *Textiles and Clothing* |
| Source bytes downloaded | 2,174,198 bytes of documents (11 sources) and 1,477,594 bytes of figure images — 3,651,792 bytes in all |
| Cold build | 22.7 s wall on this machine; 10.9 s of that is fetch+convert, the rest the figure downloads |
| Cached rebuild | 0.2 s of fetch+convert |
| Tests | `convert.test.mjs` 17, `fidelity.test.mjs` 14, `plan.test.mjs` 10 — 41 tests, 861 ms for the three files |

## 7. Two things a reader of this pack should know

**The Source line is outside the fidelity comparison.** Every article ends with
`*Source: … Section: … url*`, which is the pack's own attribution rather than
something the source prints; the fidelity test compares the article's body with
the source's span, and the Source line is appended after it passes. That is the
same line the brief asks for on every article, and it is the only text in the
pack that is not the source's.

**A Wikibooks page prints no title of its own.** An HTML book and a scanned
bulletin print their own headings, and the pack marks the source's own heading as
the article's title. A wiki page's name lives in its URL, so the article's first
heading is the page's own first heading and the pack adds nothing; where a page
opens with prose, the Reader falls back to the title it derives from the file
name.
