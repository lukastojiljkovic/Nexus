# Pack: `reference-en` — charters, constitutions and declarations (English)

A `content` pack (ADR-091): a book of articles the Reader shows, built by
`scripts/packs/reference/build.mjs`, signed by the maintainer with
`scripts/pack-sign.mjs` and nobody else. It carries the texts in English.

## What is in it

Fourteen documents, 189 articles, measured 1 552 634 bytes in the pack folder
(articles plus `content.json`; 1.48 MiB). The two consolidated treaties are
split into one article per PART or TITLE, which is where the article count comes
from; everything else is one article.

| # | Article ids | Document | Source used | Licence |
|---|---|---|---|---|
| 01 | `01-us-declaration-of-independence` | Declaration of Independence | archives.gov transcription | US Government work, no copyright |
| 02 | `02-us-constitution` | Constitution of the United States, Articles I–VII | archives.gov transcription | US Government work, no copyright |
| 03 | `03-us-bill-of-rights` | Bill of Rights, Amendments I–X | archives.gov transcription | US Government work, no copyright |
| 04 | `04-un-charter` | Charter of the United Nations | un.org full text | PD by UN policy ST/AI/189/Add.9/Rev.2 |
| 05 | `05-udhr` | Universal Declaration of Human Rights | un.org full text | PD by UN policy ST/AI/189/Add.9/Rev.2 |
| 06 | `06-iccpr` | International Covenant on Civil and Political Rights | en.wikisource transcription | CC BY-SA 4.0 + PD-UN |
| 07 | `07-icescr` | International Covenant on Economic, Social and Cultural Rights | en.wikisource transcription | CC BY-SA 4.0 + PD-UN |
| 08 | `08-genocide-convention` | Convention on the Prevention and Punishment of the Crime of Genocide | en.wikisource transcription | CC BY-SA 4.0 + PD-UN |
| 09 | `09-crc` | Convention on the Rights of the Child | en.wikisource transcription | CC BY-SA 4.0 + PD-UN |
| 10 | `10-eu-charter` | Charter of Fundamental Rights of the European Union (2007/C 303/01) | EU Publications Office, Cellar (the store EUR-Lex serves from) | CC BY 4.0, Decision 2011/833/EU |
| 11 | `11-eu-teu-*` (49 articles) | Consolidated version of the Treaty on European Union, OJ C 202 of 7 June 2016, pp. 1–46 | EU Publications Office, Cellar | CC BY 4.0, Decision 2011/833/EU |
| 12 | `12-eu-tfeu-*` (128 articles) | Consolidated version of the Treaty on the Functioning of the European Union, OJ C 202 of 7 June 2016, pp. 47–388 | EU Publications Office, Cellar | CC BY 4.0, Decision 2011/833/EU |
| 13 | `13-magna-carta` | Magna Carta, 1215 | en.wikisource: the translation by William Sharp McKechnie (1914), printed in *Source Problems in English History* (1915) | CC BY-SA 4.0 (transcription); translation public domain |
| 14 | `14-declaration-of-the-rights-of-man` | Declaration of the Rights of Man and of the Citizen, 1789 | en.wikisource: the translation by Frank Maloy Anderson (1908) | CC BY-SA 4.0 (transcription); translation public domain |

`scripts/packs/reference/sources.reference-en.json` is the licence record: for
every document, the URL the bytes were fetched from, the canonical URL the
article's Source line shows, the fetch date, the size, the SHA-256 of the bytes
the pack was built from, the licence, and the sentence on a real page that
states it.

## What is deliberately not in it

- **The UN's (and Wikisource's) own words about the documents.** Each source page
  carries navigation, a licence box, maintenance banners and, on the UN's pages,
  an introduction the UN wrote. None of that is the document; the build prunes
  it by selector or by the text the document begins with, and the fidelity check
  runs on what is left.
- **The UN's closing note on amendments** to Articles 23, 27, 61 and 109 on the
  Charter page: that note is UN commentary, and the UN asserts copyright over its
  website materials.
- **Link targets.** An anchor keeps its text and loses its `href`: the app has no
  vetted `shell.openExternal` wrapper yet (one is built after this wave's merge),
  so a URL in the body would be a URL the reader cannot open. The one URL an
  article shows is the Source line.
- **The General Assembly resolutions themselves** where their PDFs are image-only
  scans (`A/RES/260(III)`, `A/RES/44/25` are `/img/` on documents.un.org and
  yield no text), and the scanned UN Treaty Series volumes for the same reason.
  The Wikisource transcriptions carry the same texts with their own source
  pages.

## Rebuilding it

```bash
node scripts/packs/reference/build.mjs --id reference-en
```

- Fetches every source into `%TEMP%\nexus-pack-cache\reference-en\` (one file
  and one `.json` sidecar per URL, so a re-run reuses what it already has; add
  `--refresh` to re-fetch).
- Writes the pack folder to `%TEMP%\nexus-packs\reference-en\` and the metadata
  the signer takes to `%TEMP%\nexus-packs\reference-en.meta.json`.
- Rewrites `scripts/packs/reference/sources.reference-en.json`.
- Add `--fixtures` to re-cut the test fixtures in
  `scripts/packs/reference/fixtures/` from the same bytes.
- Fonts note: the build needs no network beyond the sources above, and the API
  is `%TEMP%`, so nothing it writes lands in the repository.

Signing (maintainer only, release key):

```bash
node scripts/pack-sign.mjs --dir "%TEMP%\nexus-packs\reference-en" \
  --meta "%TEMP%\nexus-packs\reference-en.meta.json" --key <private-key.pem>
```

## How it is kept honest

Four checks stop the build rather than producing a pack somebody would have to
notice was wrong:

1. **Fidelity.** For every article, the Markdown with its markup stripped and its
   whitespace normalised must equal the text of the region it was converted
   from, normalised the same way. Nothing is written when it does not.
2. **Coverage.** Every paragraph, heading, list item and table cell of the
   selected region must appear in the article, read back by a second, flatter
   walker. This is the check that catches a selector which dropped a paragraph.
3. **Selectors bite.** A container, furniture selector or boundary marker that
   matches nothing fails the build, because that is what a page redesign looks
   like from here.
4. **A source without licence evidence is not a source.**

`scripts/packs/reference/convert.test.mjs`, `fidelity.test.mjs` and
`pack.test.mjs` (46 tests) drive the same code over fixtures cut from these
sources: a UN page, an Official Journal file, and a Serbian gazette act.

## Measured

Build of 2026-10-10, this machine: 189 articles, 14 table-of-contents entries,
1 552 634 bytes of articles plus `content.json` (1.48 MiB); `content.json`
86 499 bytes; the metadata file 1 990 bytes; the licence record 21 071 bytes.
Biggest documents: the TFEU 740 324 bytes over 128 articles, the TEU 421 076
bytes over 49.

Licence of the pack as a whole: **CC BY-SA 4.0**, with the attribution in
`pack.json` naming the United States National Archives, the United Nations,
Wikisource contributors, the European Union (CC BY 4.0, Decision 2011/833/EU)
and the two public-domain translators. The public-domain texts stay
public-domain inside it.
