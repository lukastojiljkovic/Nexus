# `car-help` — what to do when the car stops

A `content` pack, `layout: 1`, `"notice": "safety"`, written in English: five
sections of a book for a driver who is not a mechanic. Everything in it is the
source's own text — American federal and US Army material that carries no
copyright — converted to CommonMark with nothing added but markup, one Source
line per article, and one provenance article per section.

It is a reference, not a manual for a particular car, and not a substitute for
professional help. Read the review list near the foot of this page before the
pack is signed.

## What it contains

```text
content.json
articles/<id>.md              one article, ending in a Source line
articles/<section>-sources.md the section's provenance block
```

The five sections, and the articles in each:

| Section | Article | Source | Blocks | Characters |
| --- | --- | --- | ---: | ---: |
| I am stranded | If your vehicle breaks down | FM 21-305, p. 11-5 | 5 | 915 |
| | The highway warning kit | FM 21-305, p. 13-3 | 12 | 3,481 |
| | The kit to keep in the car | Ready.gov, "Car Safety" | 6 | 616 |
| | Being stranded or caught by water | Ready.gov, "Car Safety" | 2 | 877 |
| Tyre | What this guidance is | NHTSA, "Tires" (TireWise) | 2 | 420 |
| | Checking tyre pressure | NHTSA, "Tires" | 9 | 3,505 |
| | Tread | NHTSA, "Tires" | 3 | 734 |
| | A blowout while driving | NHTSA, "Tires" | 7 | 1,457 |
| | The tyre pressure monitoring system | NHTSA, "Tires" | 14 | 3,026 |
| | The spare tyre | NHTSA, "Tires" | 2 | 346 |
| Battery | Jump starting a vehicle | FM 21-305, p. 17-4 | 11 | 1,812 |
| Overheating | Why an engine has to be cooled | TM 9-8000, p. 9-1 | 18 | 3,672 |
| | What to check when it is hot and dusty | FM 21-305, p. 21-4 | 2 | 904 |
| Lights on the dashboard | The oil pressure warning light | TM 9-8000, p. 17-8 | 2 | 878 |
| | The temperature warning light | TM 9-8000, p. 17-10 | 2 | 1,444 |

**Measured in the 2026-10-10 build:** 15 articles and 5 provenance articles,
24,087 characters of article text, 34 OCR corrections applied, and a pack of
43.2 KiB in 21 files. The whole build — six downloads, 28 MB read, every article
converted and every fidelity comparison run — took **18.1 s with an empty
cache** and **0.7 s with a full one**, on this machine.

## Sources and licences

All six are public-domain US Government works: 17 U.S.C. 105(a) says copyright
protection "is not available for any work of the United States Government", and
the sentence is quoted in full in `sources.json`, checked by the build against
the page that states it. Nothing in this pack is licensed from a third party and
nothing carries an attribution or share-alike obligation; the attribution below
is the pack saying where its text comes from, not a licence condition.

| Source | What it is | Pinned by | Bytes |
| --- | --- | --- | ---: |
| `nhtsa-tires` | NHTSA, "Tires" (TireWise), snapshot 2024-12-31 — the consumer tyre page | the page's article element | 197,554 |
| `ready-car` | Ready.gov (FEMA), "Car Safety", snapshot 2024-12-31 | the page's article element | 3,692 |
| `fm-21-305` | FM 21-305 / AFMAN 24-306, *Manual for the Wheeled Vehicle Driver* (US Army, 1993), OCR text layer | the file | 7,549,800 |
| `fm-21-305-metadata` | the Internet Archive item's metadata (its public-domain marking and creator) | the fields the pack cites | 265 |
| `tm-9-8000` | TM 9-8000, *Principles of Automotive Vehicles* (US Army, 1985, with Change 1), OCR text layer | the file | 20,311,948 |
| `us-code-105` | 17 U.S.C. 105, the statute that makes the rest public domain | the file | 17,016 |

`bytes` and `sha256` in `sources.json` are about the PINNED bytes, and `pinned`
says which part that is: the article element of a page, the Internet Archive
metadata fields this pack cites, or the whole file. Both pages were pinned
because the thing that moves between fetches of an unchanged snapshot is the
Wayback envelope, not the page: the NHTSA page came back as 262,243, 262,242 and
262,240 bytes across three fetches and Ready.gov's as 65,053 and 65,046, while
the article elements were byte-identical every time. The item metadata was
pinned to its cited fields for the same reason, because its `item_last_updated`
moves when archive.org re-curates an item. The build refuses a source whose
pinned bytes do not match, and `--evidence` is the one mode that re-measures
instead.

The two scanned manuals are read through their OCR text layers, which is what
the Internet Archive publishes beside the scans. **Their OCR is not
proofread text**, and every defect this pack ships has to be one this pack can
name: the corrections below are the whole of what was changed, and each scanned
source's provenance article names the pages used and where its scans are, so a
reader can go and look at every one of them.

## The OCR corrections

The safety rules say the pack ships the OCR's own text, corrected only through
an explicit table — the page, the wrong text, the right text, each read off the
scan — applied before the fidelity test, and listed so a human can check every
entry. `scripts/packs/car-help/corrections.mjs` is that table; the build applies
it and prints these rows (`node scripts/packs/car-help/build.mjs
--corrections`), and a correction whose wrong text is not on its page stops the
build rather than shipping uncorrected text.

Two smaller repairs in the builder are not corrections and are not in this
table, because they are facts about the extraction rather than about what the
page says: a running head or a printed page number is removed (it is furniture
of the page, not of the section), and a word the compositor broke at a line end
is joined (`injur-\ning` is one word). Each is listed in `scripts/packs/car-help/ocr.mjs`
and `scripts/packs/car-help/text.mjs`, and it moves both sides of the fidelity
test.

### FM 21-305 (US Army, 1993)

| Page | The OCR text | What the scan prints | How it was checked |
| --- | --- | --- | --- |
| 11-5 | `necessary to avoid greater came When your` | `necessary to avoid greater danger. When your` | the scan reads “greater danger.” — the OCR dropped the word's tail and the full stop with it. |
| 11-5 | `vehicle is disabled at night, always leave yee parking` | `vehicle is disabled at night, always leave your parking` | the scan prints “your”. |
| 13-3 | `where warning is necessary (Figure he All Air` | `where warning is necessary (Figure 13-1). All Air` | the scan prints “(Figure 13-1).”; the OCR lost the figure number and the closing bracket. |
| 13-3 | `highway warning kits. Vehicles of lesser capacit` | `highway warning kits. Vehicles of lesser capacity` | the scan prints “capacity” — the OCR dropped the final letter at the line break. |
| 13-3 | `ways. Additional kits aré stored in post/base` | `ways. Additional kits are stored in post/base` | the scan prints “are”; the OCR read a Latin e with an acute accent. |
| 13-3 | `lace a reflector in the obstructed lane, or on` | `place a reflector in the obstructed lane, or on` | the scan prints “place”; the OCR lost the initial p. |
| 13-3 | `reflectors’ as follows:` | `reflectors as follows:` | the scan prints no apostrophe after “reflectors”. |
| 13-3 | `if the direction of traffic approaching in that ⏎ ane.` | `in the direction of traffic approaching in that ⏎ lane.` | the scan prints “in the direction of traffic approaching in that lane.”; the OCR read the n as an f and dropped the initial l of the short final line. |
| 13-3 | `Ifthe motor vehicle is stopped within 300` | `If the motor vehicle is stopped within 300` | the scan prints “If the”. |
| 13-3 | `pace 0 feet behind the vehicle will have no` | `placed 20 feet behind the vehicle will have no` | the scan prints “placed 20 feet”; the OCR produced “pace 0”. |
| 13-3 | `ag mounted on it.)` | `flag mounted on it.)` | the scan prints “flag mounted on it.)”. |
| 13-3 | `flares in the kit. However, vehicles transportin` | `flares in the kit. However, vehicles transporting` | the scan prints “transporting”. |
| 17-4 | `responsible for the arall of your troops, both on and` | `responsible for the safety of your troops, both on and` | the scan prints “safety”; the research run recorded the same slip (its evidence E27). |
| 17-4 | `connect the negative terminal of the jum` | `connect the negative terminal of the jump` | the scan prints “jump”; the OCR lost the final letter at the line break. |
| 17-4 | `terminal (1) of the ump starting vehicle and the` | `terminal (1) of the jump starting vehicle and the` | the scan prints “jump”; the OCR lost the first letter after the column break. |
| 17-4 | `tact other jumper cable clamps or ter- ⏎ ailure to do so may cause ⏎ minals. ⏎ batteries to explode, injuring or killing` | `tact other jumper cable clamps or ter- ⏎ minals. Failure to do so may cause ⏎ batteries to explode, injuring or killing` | the scan reads “...clamps or terminals. Failure to do so may cause batteries to explode...”; the OCR read the box's second column out of order, so the sentence arrived split across four lines. |

Scans: https://archive.org/download/fm-21-305-manual-for-the-wheeled-vehicle-driver-1993/page/n<leaf>.jpg (replace the leaf number in the URL to open another page).

### TM 9-8000 (US Army, 1985)

| Page | The OCR text | What the scan prints | How it was checked |
| --- | --- | --- | --- |
| 9-1 | `СНАРТЕН 9` | `CHAPTER 9` | the scan prints “CHAPTER 9”; the OCR produced four Cyrillic letters and read the A as an A. |
| 9-1 | `Section |. COOLING ESSENTIALS` | `Section I. COOLING ESSENTIALS` | the scan prints “Section I.”; the OCR read the capital I as a pipe. |
| 9-1 | `Section Il. LIQUID COOLING SYSTEMS` | `Section II. LIQUID COOLING SYSTEMS` | the scan prints “Section II.”; the OCR read the second capital I as a lower-case l. |
| 9-1 | `b. Аш. Air cooling is most practical for small` | `b. Air. Air cooling is most practical for small` | the scan prints “b. Air.”; the OCR produced a Cyrillic A and sh. |
| 9-1 | `the air through radiation from ће engine.` | `the air through radiation from the engine.` | the scan prints “the engine”; the OCR produced a Cyrillic tshe and e. |
| 9-1 | `9-3. Flow of Coolant [(Еїа. 9-1). A simple liquid-cooled` | `9-3. Flow of Coolant (Fig. 9-1). A simple liquid-cooled` | the scan prints “(Fig. 9-1).”; the OCR produced three Cyrillic letters and a stray bracket. |
| 9-1 | `which the coolant circulates. Some engines аге` | `which the coolant circulates. Some engines are` | the scan prints “are”; the OCR produced three Cyrillic letters. |
| 17-8 | `d. Indicator Lamp The oil pressure` | `d. Indicator Lamp (Fig. 17-12). The oil pressure` | the scan prints “d. Indicator Lamp (Fig. 17-12).”; the OCR dropped the figure reference. |
| 17-8 | `warning light Is used In place of a gage on many` | `warning light is used in place of a gage on many` | the scan prints lower-case “is” and “in”; the OCR read the lower-case l as a capital I. |
| 17-8 | `indicator, Is valuable because of Its high visibility in the` | `indicator, is valuable because of its high visibility in the` | the scan prints lower-case “is” and “its”. |
| 17-8 | `often Is used as a backup for a gage to attract Instant` | `often is used as a backup for a gage to attract instant` | the scan prints lower-case “is” and “instant”. |
| 17-8 | `The sender switch consists of а pressure-sensitive` | `The sender switch consists of a pressure-sensitive` | the scan prints a Latin “a”; the OCR produced a Cyrillic a. |
| 17-10 | `d. Indicator Lights The tem- perature` | `d. Indicator Lights (Fig. 17-15). The temperature` | the scan prints “d. Indicator Lights (Fig. 17-15).” and sets “temperature” whole; the OCR dropped the figure reference and broke the word. |
| 17-10 | `gage, Is valuable because of its high visibility in the event` | `gage, is valuable because of its high visibility in the event` | the scan prints lower-case “is”. |
| 17-10 | `to attract Instant attention to a malfunction. The warning` | `to attract instant attention to a malfunction. The warning` | the scan prints lower-case “instant”. |
| 17-10 | `2300F (1100C). Some models also utilize а cold` | `230°F (110°C). Some models also utilize a cold` | the scan prints “230 degrees F (110 degrees C)”; the OCR read the degree sign as a zero. The arithmetic confirms it: (230 - 32) / 1.8 = 110. |
| 17-10 | `1500F (65.60C). The strip then will open the cold light` | `150°F (65.6°C). The strip then will open the cold light` | the scan prints “150 degrees F (65.6 degrees C)”; the OCR read the degree sign as a zero and the decimal point as another zero. (150 - 32) / 1.8 = 65.6. |
| 17-10 | `circuit. As long as the temperature of the engine Is` | `circuit. As long as the temperature of the engine is` | the scan prints lower-case “is”. |

Scans: https://archive.org/download/tm-9-8000-principles-of-automotive-vehicles-1985/page/n<leaf>.jpg (replace the leaf number in the URL to open another page).

## What a qualified mechanic must review before this pack is signed

This list follows section 3 of the research run that produced this pack (its
report is the wave's `research/carhelp/report.md`, outside this repository); the
first item is not optional.

1. **Every emergency procedure, by a qualified mechanic.** A wrong jacking or
   jump-start step injures people. The sources disagree in places (a four-try
   limit before notifying a supervisor is Army doctrine, not a repair
   diagnosis), and the OCR is demonstrably wrong in places that this pack's
   corrections do not cover, because they fall outside the spans it ships.
2. **The list of corrections above, against the scans.** Every row names a page
   and a scan URL; a row that does not match the page is a defect in this pack.
3. **What the pack does not say.** "Overheating" carries *why* an engine is
   cooled and a list of driver checks; it does **not** carry a coolant-failure
   procedure, because no public-domain, driver-level procedure was found. A
   reader who needs one is being sent to a mechanic by omission, and the reviewer
   should decide whether that is acceptable for the audience.
4. **The warning lights.** The two articles are a 1985 textbook's explanation of
   what an oil-pressure and a temperature indicator lamp mean and the
   approximate pressures and temperatures that switch them on. They are the
   "why"; they are not a per-vehicle lamp chart, and the figures are the
   source's own.
5. **The localisation note below**, and whether a Serbian-language layer is
   wanted at all.
6. **A legal read** on the practical reach of 17 U.S.C. 105 outside the United
   States. The research run flagged this and this pack does not resolve it.

## Localisation: these procedures follow US practice

Nothing here is localised. The warning triangle, the reflective vest, the hard
shoulder, the emergency number and what a driver may legally do at the roadside
are national rules, and **none of them is covered by this pack** — the research
run found no openly licensed Serbian source (the road-safety agency's site
reserves all rights) and did not find a public-domain EU source for those rules
either. FM 21-305 also speaks to soldiers ("your troops", "notify your unit
maintenance personnel"); those paragraphs were left out where they were
separable, and what remains says plainly what its own vehicle and doctrine are.

## What the pack leaves out, and why

* **High-voltage and EV batteries.** No competent open source for driver-level high-voltage procedure was found (the research run reached the same conclusion); only the 12-volt jumper-cable procedure ships

* **The NHTSA page's images and the two NHTSA tyre brochures (PDF).** A federal page's figures are the usual third-party exception to 17 U.S.C. 105 and their rights are not stated in the page, so no image ships; the brochures are separate PDFs whose text is not part of the page the pack is pinned to

* **The NHTSA recall snapshot.** The recall lookup is a US-only service reachable only online (api.nhtsa.gov), and the pack must work with the network off

* **Wikibooks' Automobile Repair pages.** Their licence (CC BY-SA 4.0) allows a verbatim reprint, but the research run found the Flat tyre page unsafe wording and the warning-light page garbled, and this pack ships text it can prove is the source's own — so nothing from them is used

* **FM 21-305's NATO slave-cable procedure, and its Army/Air Force reporting paragraphs.** Military-only equipment and reporting chains; the pages themselves are named in `sources.json` so a reader can go and read them

* **FM 21-305 chapter 22's field repairs (a punctured radiator, a fan belt made from rope).** A rope drive belt is a combat expedient, not something to hand a driver who can telephone for help

* **Serbian and EU breakdown law (the warning triangle, the reflective vest, the hard shoulder).** The research run found no openly licensed Serbian source (the road-safety agency's site is all rights reserved), so every procedure here follows US practice and none of it is localised

## How to rebuild it

```text
node scripts/packs/car-help/build.mjs
node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\car-help \
  --meta %TEMP%\nexus-packs\car-help.meta.json --key <release-key.pem>
```

The build downloads the six sources into
`%TEMP%\nexus-pack-cache\car-help\` and reuses them on a second run, verifies
each against the pinned digest and size, converts the sources, proves the
fidelity of every article, and writes the pack folder plus the metadata file to
`%TEMP%\nexus-packs\`. It prints what it fetched (and whether each came from the
network or the cache), every article's size, the omission list, the corrections
it applied, the pack's size and the time. `--evidence` re-measures the sources
and rewrites their digests, `--fixtures` re-cuts the test fixtures, and
`--corrections` prints the table above.

The pack is never committed: only the builder, its evidence, its small fixtures
and this page are. The maintainer signs the folder with the release key; this
builder never sees the key.

## Tests

`scripts/packs/car-help/convert.test.mjs` converts the fixtures in
`scripts/packs/car-help/fixtures/` — one page of FM 21-305's OCR text as the
extractor's own lines and boxes, and three byte slices of the two web pages —
and `scripts/packs/car-help/plan.test.mjs` checks the pack's own shape: kebab-case
ids unique in the pack, a Source line at the end of every article, the plan's
sources and pages, the manifest's closed key set, and that every correction in
the table is applied to the text the table says is there. 28 tests in
`convert.test.mjs` and 12 in `plan.test.mjs`, all under a second each on this
machine.

The fidelity test is the one that matters: for every article, the Markdown with
its markup stripped and whitespace collapsed equals the source span it was cut
from, and the block list equals the same span read out of the page — for a web
page, the characters between the first and the last block of the slice, which
the converter does not write. A dropped word, a reordered word and a word the
Markdown lost each fail it, and the tests prove that with three articles that
are wrong on purpose.
