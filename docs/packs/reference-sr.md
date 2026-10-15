# Pack: `reference-sr` — Constitution of Serbia and the Universal Declaration (Serbian)

Pack of kind `content` (ADR-091): a book of articles that the reader displays. It
is built by `scripts/packs/reference/build.mjs`, signed by the maintainer with the
release key (`scripts/pack-sign.mjs`), and by nobody else. The texts are in
Serbian; sources that are in Cyrillic stay in Cyrillic.

## What the pack contains

Two documents, two articles, measured at 224 667 bytes in the pack folder (the
articles and `content.json`; 219 KiB).

| # | Article id | Document | Source | Licence |
| --- | --- | --- | --- | --- |
| 01 | `01-udhr-sr` | Universal Declaration of Human Rights (*Opšta deklaracija o pravima čoveka*), General Assembly Resolution 217 A (III) | Wikisource in Serbian | CC BY-SA 4.0; the document itself is in the public domain (ST/AI/189/Add.9/Rev.2) |
| 02 | `02-ustav-republike-srbije` | Constitution of the Republic of Serbia (*Ustav Republike Srbije*) | Constitutional Court of the Republic of Serbia | official text, not a copyright work (Art. 6 of the Serbian Copyright Act, ZASP) |

`scripts/packs/reference/sources.reference-sr.json` is the licence register. For
each document it records the URL the bytes were taken from, the canonical URL in
the Source column, the download date, the size, the SHA-256 of the bytes the pack
was built from, the licence, and the sentence from the source page that states
that licence.

Each statute carries three lines at its head, as this wave's rule requires:

```
> Proveri izmene i dopune u Službenom glasniku.
> Stanje na dan <datum građenja>.
> Obuhvaćeni brojevi: <brojevi glasnika>.
```

In English: "Check the amendments and supplements in the Official Gazette",
"Status on the day of the build <date>", and "Issues covered: <numbers>".

The Gazette numbers are taken from the source page itself. For the Constitution
they are *Službeni glasnik RS* nos. 98/2006, 115/2021 (the decision promulgating
it) and 16/2022 (the Constitutional Law, amendments I–XXIX). The date is the day
the pack was built, because it is the only claim the pack can honestly make: on
that day the text was this. If the Constitution changes, a new number is added to
the source table and the pack is rebuilt.

## What is deliberately not in the pack

**Five laws the task asked for — the Labour Act, the Consumer Protection Act, the
Road Traffic Safety Act, the Family Act and the Act on Obligations — are not in the
pack, because their original text from the Gazette could not be downloaded as
text.** The task's rule is that a law is left out when its original cannot be
downloaded from the Gazette, and that is what was done. The reason, per source:

- **Pravno-informacioni sistem (PIS)** is the source the task forbids, and it is a
  JavaScript application as well: a plain request returns only the application
  shell, not the document.
- **Consolidated texts from commercial publishers (paragraf.rs and similar)** are
  forbidden, and an independent regulation browser (slglasnik.info) takes exactly
  such text from PIS ("Official source: Pravno-informacioni sistem RS").
- **slglasnik.com**, the Gazette's publisher, cannot be reached from this
  environment: its TLS chain is incomplete (`unable to verify the first
  certificate`), so Node cannot verify the certificate, and the script must not
  ignore that.
- **PDFs on ministry websites** that were inspected are sometimes Gazette pages
  (for example *Zakon o socijalnoj zaštiti*, *Službeni glasnik RS* no. 24/2011),
  but for the requested laws they are either `docx` exports from a database (a
  name such as `24_2005-3, 61_2005-69` is PIS's own labelling) or copies bearing
  the paragraf.rs watermark. None of them is a source from the Gazette.

The same verified Gazette PDF (*Zakon o socijalnoj zaštiti*, *Službeni glasnik RS*
no. 24/2011) serves as a **fixture** for the converter tests: it is a real Gazette
page with the promulgation decree, in Cyrillic, with a text layer.

**Nothing is merged into a consolidated text.** Neither the pack nor any tool
assembles a law from the original and its amendments. The pack contains the text
as the source publishes it.

## How the pack is rebuilt

```bash
node scripts/packs/reference/build.mjs --id reference-sr
```

- Downloads the sources into `~\.nexus-pack-cache\reference-sr\` and reuses what
  is already there; `--refresh` downloads them again.
- Writes the pack folder to `~\.nexus-packs\reference-sr\` and the signing metadata
  to `~\.nexus-packs\reference-sr.meta.json`.
- Rewrites `scripts/packs/reference/sources.reference-sr.json`.
- `--fixtures` regenerates the test fixtures in `scripts/packs/reference/fixtures/`
  from the same bytes.

```bash
node scripts/pack-sign.mjs --dir "~\.nexus-packs\reference-sr" \
  --meta "~\.nexus-packs\reference-sr.meta.json" --key <private-key.pem>
```

## How the pack is kept honest

The same four checks as in the English pack stop the build, rather than producing
a pack that someone would later have to notice was wrong:

1. **Fidelity.** For each article, the Markdown with its markup removed and the
   whitespace normalised must equal the text of the part of the source it was
   converted from, normalised the same way.
2. **Coverage.** Every paragraph, heading, list item and table cell of the selected
   part must appear in the article. A second, flatter pass over the structure reads
   them, which catches a selector that dropped a paragraph.
3. **Selectors must catch something.** A container, page-furniture selector or
   boundary marker that catches nothing fails the build.
4. **A source without licence evidence is not a source.**

`scripts/packs/reference/convert.test.mjs`, `fidelity.test.mjs` and `pack.test.mjs`
(47 tests, run on 2026-10-15) run the same code over fixtures cut from these
sources: a UN page, an EU Official Journal file and a Gazette act.

## Measured

A build on 10 October 2026 on this machine: 2 articles, 2 entries in the table of
contents, 224 667 bytes of articles and `content.json` (219 KiB); `content.json`
904 bytes; metadata 1 420 bytes; licence register 3 432 bytes. The Constitution
205 851 bytes, the Declaration 17 912 bytes. The pack folder is not on this machine
today, so these are the figures of that build, not a fresh measurement.

Pack licence: **CC BY-SA 4.0**, with attribution in `pack.json` that names the
Constitutional Court of the Republic of Serbia (the official text), Wikisource in
Serbian and the United Nations. Official texts remain official texts in the pack.
