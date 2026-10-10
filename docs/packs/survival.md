# The `survival` pack

**A `content` pack with `notice: "safety"`: survival craft, first aid and
disasters, in English, for the moment somebody is stranded with only this
laptop.** 541 articles and 417 figures from five sources — the current US Army
survival and first-aid publications, FM 21-76's plant and animal appendices,
FEMA's citizen guidance, USDA FSIS's food-safety chart and NOAA/NWS's cloud
material — converted from the sources' own words, with the fidelity of every
article proved by a test rather than asserted here.

It is built by `scripts/packs/survival/build.mjs`; nothing in the pack is
written by this project, and the Reader shows the safety notice the pack's
`notice` field asks for.

## What it contains

Medians of the sources' own structure: the ATP's chapters split at the ATP's own
headings, FM 21-76's appendices split one article per plant, snake or fish. The
counts are from the build log of the run recorded below.

| Topic | Articles | Source |
| --- | --- | --- |
| Survival | 114 | ATP 3-50.21 (overview, survival medicine, movement and navigation, equipment, knots and rope) |
| Water | 17 | ATP 3-50.21, chapter 3 |
| Fire | 14 | ATP 3-50.21, chapter 5 |
| Shelter and clothing | 14 | ATP 3-50.21, chapter 6 |
| Food: plants | 145 | FM 21-76 (survival use of plants, the edible-and-medicinal appendix, poisonous plants, the poisonous-plants appendix) |
| Food and dangerous animals | 122 | FM 21-76 (food procurement, dangerous animals, insects and arachnids, snakes and lizards, dangerous fish and mollusks) |
| Meat and food safety | 1 | USDA FSIS / FoodSafety.gov, safe minimum internal temperatures |
| Weather and clouds | 10 | NOAA/NWS JetStream; FM 21-76 Appendix G |
| Tools and craft | 15 | FM 21-76, chapter 12 (cordage, rucksacks, clothing and insulation, cooking and eating utensils) |
| First aid | 52 | ATP 4-02.11, selected for civilian use |
| Disasters | 37 | Ready.gov (16) and FEMA *Are You Ready?* (IS-22, 2004) |

**Measured, one full build on 2026-10-10:** 541 articles and 417 figures,
1 154 397 characters of text, **38 020.0 KiB (37.1 MiB) in 959 files**, written
to `%TEMP%\nexus-packs\survival\` in 197.4 s with every source already in the
cache. Six articles were refused by the safety sweep and are listed under
"What is left out" below.

### What a figure is

Most figures are the line drawings the sources print, cropped out of a render of
the page they sit on (`pdftoppm` at 150 dpi, cropped to the box the page's
content stream draws the image in, re-encoded as a palette PNG at 820 pixels
wide at most). An image is treated as a figure when it is at least 120 by 80
points and is not the page itself: measured, ATP 3-50.21 draws 312 images of
which 143 qualify — the rest are its 21.5-by-8.6-point change bars in the
margin — FM 21-76 draws 4 400 and 438 qualify (the rest are its decorative
rules), and ATP 4-02.11 draws 179 and 108 qualify.

Each figure keeps the caption and figure number the source prints for it, as
the image's alt text and at the point in the text where the source prints it. A
source that numbers no figure keeps none: FM 21-76's 1992 reprint captions none
of its plant and animal illustrations, and this pack writes no caption of its
own rather than invent one.

## Sources, licences and attribution

Every source is a work of the U.S. Government and is not subject to copyright in
the United States (17 U.S.C. 105(a)); each Army publication also prints its own
distribution statement. The exact sentence each licence was read from, on the
page it was read from, is in
[`scripts/packs/survival/sources.json`](../../scripts/packs/survival/sources.json),
which is also what the builder verifies every download against. The pack's
manifest carries:

> US Government works, not subject to copyright in the United States
> (17 U.S.C. 105(a)): US Army ATP 3-50.21 Survival (2018), FM 21-76 Survival
> (1992), ATP 4-02.11 (2026); FEMA Are You Ready? (IS-22, 2004) and Ready.gov;
> USDA FSIS / FoodSafety.gov; NOAA/NWS JetStream. Per-article attribution and
> the full licence evidence: docs/packs/survival.md.

and every article ends with the attribution string the research gives for its
source, its own section and the source's URL:

| Source | Licence evidence |
| --- | --- |
| **US Army ATP 3-50.21, Survival, 2018** | *"DISTRIBUTION RESTRICTION: Approved for public release; distribution is unlimited."* — printed on the document, read at `archive.org/download/survival-atp-3-50-21/Survival (ATP 3-50.21)_djvu.txt` |
| **US Army FM 21-76, Survival, 5 June 1992** | *"Approved for public release; distribution is unlimited."* — the authentication page of the PDF itself |
| **US Army ATP 4-02.11, Casualty Response, Tactical Combat Casualty Care and First Aid, March 2026** | *"Distribution Restriction: Approved for public release, distribution is unlimited."* — printed on the document |
| **FEMA, Are You Ready? An In-depth Guide to Citizen Preparedness (IS-22, August 2004)** | 17 U.S.C. 105(a), quoted from `govinfo.gov` |
| **Ready.gov hazard pages (FEMA)** | 17 U.S.C. 105(a), quoted from `govinfo.gov`; the attribution adds that reference to FEMA/DHS material does not imply endorsement by the U.S. Government |
| **USDA FSIS / FoodSafety.gov, Safe Minimum Internal Temperatures** | 17 U.S.C. 105(a), quoted from `govinfo.gov`; the page was reviewed 21 November 2024 |
| **NOAA/NWS JetStream, clouds** | *"The information on National Weather Service (NWS) Web pages are in the public domain, unless specifically noted otherwise …"* — `weather.gov/disclaimer`; the attribution adds that the material is reproduced unmodified and that the pack is not endorsed by NOAA or NWS |

FM 21-76 is served over http only, so its integrity rests on the SHA-256 this
builder pins rather than on the transport. Where a licence sentence is the
document's own statement, the build asserts it is in the document's extracted
text and prints whether it found it.

### The sources the research rejected, and are not here

**FM 3-05.70 (2002)** is a US Government work, but its cover restricts
distribution to U.S. Government agencies and their contractors; the current,
unrestricted successors are shipped instead (ATP 3-50.21, and FM 21-76 for the
appendices it carried). **wikiHow** grants no reuse outside its own site.
**Red Cross of Serbia** material reserves all rights. The **NWS Cloud Chart**
(March 2023) is a one-page poster whose caption runs are set rotated in the
page's own coordinate frame (measured: 354 of its 361 text runs, in a page whose
unrotated space is 858 by 1 902 points against a 1 902-by-858 viewport), so the
pack ships the cloud material from NWS JetStream's pages instead of shipping
text it cannot prove faithful.

## A Serbian edition

**The pack is English, and a Serbian edition is not made by translation.** The
sources are English; a Serbian edition waits for a licensed Serbian source or a
human translator who can be named, because machine translation of first-aid and
plant-identification text is how a reference becomes a hazard. The pack's own
metadata (its title and description) is Serbian and English, as every pack's is.

## What is left out, and why

Two kinds. Everything below is the build's own report, not a second list kept by
hand.

### Refused by the safety sweep (6 articles)

An article whose text carries a drug dose, or names three or more distinct items
of weapons doctrine, is not written at all:

| Article | Rule | What it matched |
| --- | --- | --- |
| `medicine-illness-infection-soft-tissue-trauma` (ATP 3-50.21, chapter 2) | drug dose | `500 mg` |
| `dangerous-to-eat` (FM 21-76, Appendix C) | drug dose | `28 milligrams` — a poison's dose, which is the same hazard out of context |
| `circulation-control-expedient` (ATP 4-02.11, chapter 7) | drug dose | `0.15 milligrams` |
| `hypothermia-control-expedient` (ATP 4-02.11, chapter 8) | drug dose | `500mg` |
| `eye-trauma-tier-2` (ATP 4-02.11, chapter 10) | drug dose | `400mg` |
| `impalement-injuries` (ATP 4-02.11, chapter 14) | weapons doctrine | `grenade`, `artillery` |

The drug-dose rule is deliberately narrow: **mass in grams and volume in
millilitres are not doses in these sources** (FM 21-76 describes plants by their
starch content, ATP 3-50.21 by how much blood an adult has), and a first version
of the rule that fired on them refused the edible-plants appendix and the
circulation chapter. The weapons rule requires three DISTINCT terms, because
these manuals are written for soldiers: a single mention is the source's voice,
not its subject (measured: FM 21-76's cooking chapter names `ammunition` three
times, for the cans a reader can cook in; ATP 4-02.11's impalement section names
`grenade` and `artillery` as mechanisms of injury).

### Not selected (the gaps the build reports)

The text between two articles of a source is not shipped, and the builder prints
each gap with the headings inside it. By source, and with the source's own
section numbers:

| Source and printed line count | What it is | Why |
| --- | --- | --- |
| ATP 3-50.21, 266 lines | cover, authentication page, contents, preface, introduction | front matter, not guidance |
| ATP 3-50.21, 1 238 lines | **chapter 4, Food** (FOOD CONSIDERATIONS, NUTRITION, FOOD AVAILABILITY, BASIC FOOD PREPARATION, BASIC COOKING AND PRESERVATION METHODS, LEACHING, BOILING, and on to paragraph 4-32) | this pack's plant and animal material is FM 21-76's, which the research asks for by name; the ATP's chapter covers the same ground for soldiers, and two versions of the same subject would be a section the reader has to choose between |
| ATP 3-50.21, 261 lines | Glossary (acronyms, terms), References, Index | reference apparatus |
| FM 21-76, 2 280 lines | preface, introduction, **chapter 1 Survival Actions**, **chapter 2 Psychology of Survival**, **chapter 3 Survival Planning and Survival Kits**, **chapter 4 Basic Survival Medicine**, **chapter 5 Shelters**, **chapter 6 Water Procurement**, **chapter 7 Firecraft** | the ATP's chapters 1 and 2 are the current text for the first three; first aid ships from ATP 4-02.11 and shelters, water and fire from ATP 3-50.21, exactly as the research's section 3 assigns them |
| FM 21-76, 4 238 lines | **chapters 13 to 23** (DESERT, TROPICAL, COLD WEATHER, SEA, expedient water crossings, direction finding, SIGNALING TECHNIQUES, movement in hostile areas, CAMOUFLAGE, contact with people, man-made hazards), **Appendix A Survival Kits**, **Appendix H Contingency Plan of Action Format** | the desert, jungle, arctic and sea chapters are region-specific material (the pack is not a regional guide and says so); chapters 20 to 22 are the evasion, camouflage and stalking doctrine the brief excludes; Appendix A is a kit list whose subject Ready.gov's pages cover, and Appendix H is a military reporting format |
| FM 21-76, 336 lines | Glossary, references, authorization letter, index, Appendix H's tail | reference apparatus |
| ATP 4-02.11, 2 102 lines | cover, authentication page, contents, preface, introduction, **Part One chapter 1 Casualty Response**, **chapter 2 Casualty Extraction and Movement**, **chapter 3 Fundamentals of TCCC**, **chapter 9 Secondary Injury Assessment Using Pain, Antibiotics, Wounds, Splinting…** (paragraphs 9-1 to 9-43), **chapter 15 Casualty Monitoring and Evacuation Preparation** | unit organisation, evacuation and medical-supply doctrine (Part One, chapters 3 and 15), and a chapter whose treatment is antibiotics and pain medication (chapter 9). The research's basis for shipping this publication at all is a selection for civilian use |
| ATP 4-02.11, 1 919 lines | **chapter 18 Sickle Cell Trait**, **chapter 19 First Aid in a Chemical, Biological, Radiological and Nuclear Environment**, **chapter 20 Combat and Operational Stress Control**, **Appendix A First Aid Case and Kits, Authorized Medical Allowance List**, **Appendix B Rescue Equipment**, Glossary, References, Index | chapter 18 is a condition rather than a first-aid subject; chapter 19's treatment is antidotes and its subject is a weapons environment, and radiation as a civilian emergency ships from Ready.gov and FEMA instead; chapter 20 is combat-stress doctrine; Appendix A is a medical allowance list and Appendix B is equipment |
| FEMA IS-22, 146 lines | preface, CERT, Citizen Corps, Certificate of Completion, Facilitator Guide | front matter, and course material for the guide's own training |
| FEMA IS-22, 1 255 lines | **Part 4, Terrorism** (4.1 General Information about Terrorism to 4.7 Homeland Security Advisory System), **Part 5, Recovering from Disaster**, **Appendix A Water Conservation Tips**, **Appendix B Disaster Supplies Checklists**, **Appendix C Family Communications Plan** | Part 4 is about attacks rather than hazards a person prepares for; Part 5 and the appendices are forms and checklists a reader fills in, and the supplies checklist's subject ships from Ready.gov |

Within the chapters that ARE shipped, the sections that carry a drug dose were
refused article by article by the sweep above (ATP 4-02.11's **Tier 2 skills**
in circulation, hypothermia and eye trauma; the medicine chapter's
antibiotics section; the poisonous-plants entry that gives a toxin's dose). What
ships is the `Tier 1` and `Expedient` skills, which is what a person without a
medical kit can do.

### Omitted by rule, not by gap

* **The Morse code table.** The research's open question (section 2.7): neither
  FM 21-76 (1992) nor ATP 3-50.21 contains a code table, and the ITU
  recommendation it would come from was not reachable to check its reuse terms.
  The Signals module carries Morse, so this pack does not need to.
* **`region-serbia`.** No Serbia- or Balkans-specific source for edible and
  poisonous plants or dangerous animals was found with licence evidence, and
  this pack does not write or translate safety text. The plant and animal
  chapters it does ship are **world-wide US Army reference written for
  soldiers, not a regional identification guide**; the pack's own description
  says so in both languages, and the doc says it here.
* **Drug doses and weapons doctrine**, above.

## How it is built

```sh
node scripts/packs/survival/build.mjs              # build the pack
node scripts/packs/survival/build.mjs --fixtures   # re-cut the test fixtures
```

The builder downloads every source `sources.json` names into
`%TEMP%\nexus-pack-cache\survival\` (re-using the cache on the next run,
discarding a cached file whose digest no longer matches the evidence, and
refusing a download that does not match it), extracts the text with
**pdfjs-dist** and the figures with **Poppler**, converts every article to
CommonMark, proves the fidelity of every article, and writes the pack to
`%TEMP%\nexus-packs\survival\` with the metadata `pack-sign.mjs` takes BESIDE
that folder.

**Poppler is fetched into the cache and never shipped.** The pinned build is
`oschwartz10612/poppler-windows` Release 26.09.0-0 (GPL-2.0-or-later), 43 709 956
bytes, SHA-256 `7a6f256a…56c8d0`; the builder unpacks it under
`%TEMP%\nexus-pack-cache\survival\poppler-26.09.0-0\` and runs `pdfimages` and
`pdftoppm` from there. Nothing of it is linked into Nexus, and what it produces
is images of pages that are themselves public domain. `pdfimages -list` is what
says a page really embeds an image at figure size; `pdftoppm` renders the page
the figure is cropped from. Extraction with `pdfimages -extract` was tried first
and refused on measurement: on ATP 4-02.11 it reports 179 images where the
content stream draws 127, because an image with a soft mask is written as two
images of identical pixel size, and the two cannot be told apart — so a builder
that paired them would sometimes ship a figure's alpha channel as the figure.

**The federal pages answer HTTP 403 to a programmatic agent** (measured on
Ready.gov, FoodSafety.gov and NOAA), so the builder sends a desktop browser's
User-Agent for those fetches and its own name for the archives. For an HTML
source the digest it pins is that of the page's own `<article>` element rather
than of the whole response, because the envelope of a federal page can move
between two fetches while the element does not (measured on FoodSafety.gov).

Then the maintainer signs it — this run never has the key:

```sh
node scripts/pack-sign.mjs \
  --dir %TEMP%/nexus-packs/survival \
  --meta %TEMP%/nexus-packs/survival.meta.json \
  --key <release-key.pem>
```

The metadata's `minAppVersion` is read out of `apps/desktop/package.json` at
build time rather than typed here, and its `kind` is `content`.

## The fidelity rule, and the normaliser's five repairs

**The text is the source's own**, and the build proves it for every article:
the Markdown with its markup stripped and whitespace collapsed equals the source
span the article was cut from, whitespace collapsed, and the same comparison is
run again inside the writer (the Markdown read back equals the blocks it was
written from). Anything else fails the build.

Two things are outside that comparison, and both are the pack's own rather than
the source's: each article's closing `*Source: …*` line, and the image file
names.

Where PDF extraction mangles text, the normaliser undoes exactly these five
things, each one listed and tested in
[`normalise.test.mjs`](../../scripts/packs/survival/normalise.test.mjs):

| Rule | What it undoes | Measured example |
| --- | --- | --- |
| R1, glyph mapping | a glyph the extraction keeps as one character that is not the character the reader sees: a ligature, the Symbol-font bullet that arrives as a lone `z`, a control character where the page prints a space, a non-breaking space | `z Look for the chest to rise and fall.` → a list item; `2-6 ATP 3-50.21 \u0003\u0014\u001B6HSWHPEHU` → a footer |
| R2, letter spacing | a heading the source sets with tracking | `F O O D  P R O C U R E M E N T` → `FOOD PROCUREMENT` |
| R3, running heads and page numbers | the furniture every page repeats, by the margin it sits in and by the publication's own tokens and page labels | `Chapter 2`, `2-6 ATP 3-50.21 …`, `B-8`, `Are You Ready? Floods` |
| R4, line-end hyphenation | a word the compositor broke across two lines | `contamina- tion` → `contamination` |
| R5, invisible runs | text the page does not draw: ATP 4-02.11 is a Word export whose headings carry the Word bookmark label as a run drawn at one point of an eleven-point heading | `322B` in front of `Tier 2 Skills for Army Personnel`, 1 521 runs on that source's pages |

**R5 is a fifth rule, and the brief names four.** It is here because the
alternative is shipping `322BTier 2 Skills for Army Personnel` as a heading on
every such page of ATP 4-02.11; it removes text the page does not draw, and it
removes it from both sides of the fidelity comparison, so it cannot hide a
change to anything a reader would see. Nothing in the normaliser rewrites a
word, fixes an OCR slip or cleans up grammar: a malformed run that is not one of
the five stays exactly as extracted.

Two safeguards the build runs on itself: a line the margin band would drop that
reads like prose (more than eight words) stops the build unless the source's own
vocabulary names it as furniture, and a heading the plan names but the source
does not print stops the build rather than shifting every article after it.

## The tests, and the fixtures

`normalise.test.mjs`, `convert.test.mjs` and `build.test.mjs` — 47 tests, 0.5 s
on this machine. They read five fixture files, 59 KB together, cut from the real
sources by `--fixtures` and described in
[`fixtures/README.md`](../../scripts/packs/survival/fixtures/README.md):
two real PDF pages (ATP 3-50.21 page 2-6, FM 21-76 page B-8) with the RAW text
runs and image placements the normaliser and the converter are driven with, the
two figures the build crops out of them, and one real HTML page's article
element.

The normaliser's five rules are asserted one by one with hand-calculated
expectations; the converter is asserted on the fixtures' own awkward cases (a
caption printed under its figure, an illustration printed above its entry, a
table with a header row, a wrapped list item, a paragraph beginning with a
hyphen) and on the fidelity of each; the builder is asserted on the plan's
contract (ids, groups, the topic list the research recommends, the sources it
must not name), on `pack-sign.mjs`'s own `checkMeta` for the metadata, and on
the one measured defect the first full build exposed (nine articles whose
derived ids collided, which now take a number).

## Known limits

* **FEMA's guide ships as text only.** Its 204 pages are a scan whose text layer
  carries no caption for any of its images, so the pack takes its words and
  leaves the pictures; the words are the Internet Archive's OCR of that scan
  (ABBYY FineReader 8.0), which is what the archive serves beside it.
* **FM 21-76's 1992 reprint is a re-typeset text**, not a photograph of the
  book: its page geometry varies from page to page (measured: 397 by 612, 412 by
  595, 413 by 595 points), which is why the normaliser's margins are read per
  page and not written down once.
* **A page of ATP 3-50.21's water tables sets its first column at heading size**
  (an `X` in the wide table); the entry splitter treats a lone letter as the
  source's own list marker rather than as a heading, so those rows stay in the
  article they belong to.
* **The pack is large for a reader** (37 MiB, 417 images). The images are the
  sources' own line drawings re-encoded at 820 pixels wide; a smaller cap is a
  change to `FIGURE_MAX_PIXELS` in `build.mjs` and a re-build.
