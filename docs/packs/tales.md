# The fairy-tale packs: `tales-sr` and `tales-en`

Two `content` packs (ADR-091) built by [`scripts/packs/tales/build.mjs`](../../scripts/packs/tales/build.mjs):
Vuk Stefanović Karadžić's Serbian folk prose from Serbian Wikisource, and four
public-domain Project Gutenberg ebooks in English. This file is the pack's
provenance, its measured size, and the record of what it leaves out and why.

## What is in them

Measured on 2026-10-10 by running the builder (the numbers below are its output,
not estimates):

| Pack | Collection | Articles | Pack size |
| --- | --- | --- | --- |
| `tales-sr` | Српске народне приповијетке, друго умножено издање (Беч, 1870) | 71 | 786,818 bytes in 73 files |
| `tales-sr` | Српске народне пословице (Београд, 1900) | 1 | (included above) |
| `tales-en` | Household Tales by Brothers Grimm (#5314) | 211 | 4,339,696 bytes in 640 files |
| `tales-en` | Andersen's Fairy Tales (#1597) | 18 | (included above) |
| `tales-en` | Fairy Tales of Hans Christian Andersen (#27200) | 126 | (included above) |
| `tales-en` | Aesop's Fables; a new translation (#11339) | 284 | (included above) |

Each collection is one `toc` entry and each tale an article under it, so the
Reader draws four shelves in the English pack and two in the Serbian one.

The Serbian tales are between 2,045 and 53,612 bytes of article text (median
8,540). The proverbs article is 19,786 bytes and carries the transcription's 109
numbered proverbs together with the collection's two prefaces; Wikisource's
transcription of that page numbers its proverbs up to 1,596 and stops at the
letter З, so the letters И–Ш stand there as empty headings — that is the source,
not a conversion result.

## How to rebuild

```
node scripts/packs/tales/build.mjs                 # both packs, network + cache
node scripts/packs/tales/build.mjs --pack tales-sr  # one of them
node scripts/packs/tales/build.mjs --offline        # from the cache, no socket
node scripts/packs/tales/build.mjs --write-sources  # rewrite sources.json
```

Sources are cached under `%TEMP%\nexus-pack-cache\<pack id>\` and re-running
reuses them, so the second run is seconds. The pack folder is written to
`%TEMP%\nexus-packs\<pack id>\` — `content.json` and `articles/…` — with the
metadata `pack-sign.mjs` takes beside it as `%TEMP%\nexus-packs\<pack id>.meta.json`.

**The maintainer signs the packs**, not this builder:

```
node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\tales-sr \
  --meta %TEMP%\nexus-packs\tales-sr.meta.json --key <release-key.pem>
```

The builder never sees the private key and never writes `pack.json`.

## Sources, licences and the evidence for them

`sources.json` in this folder is the machine-readable form: every source with its
URL, the date it was fetched, its SHA-256, its licence, and the exact sentence
that states the licence, quoted from the page it was read on. The builder checks
each quote against the fetched bytes on every run, so a source that changes its
terms fails the build instead of quietly staying in the pack.

### Serbian Wikisource (`tales-sr`)

The works are public domain and the *page text* is Wikimedia's, licensed
CC BY-SA 4.0. Both are named, because they are two different things: the pack
reproduces a 19th-century work through a 21st-century transcription.

- **Public domain of the works.** Every page carries the wiki's own notice, and
  the pack quotes the one it carries for these tales: „Овај текст је у јавном
  власништву у Србији, Сједињеним државама и свим осталим земљама са периодом
  заштите ауторских права од живота аутора плус 70 година јер је његов аутор,
  Вук Стефановић Караџић, умро 1864, пре 162 године." (Vuk Stefanović Karadžić,
  1787–1864; the notice is read from the pages themselves and its last clause is
  a template that counts the years, which is why the fetched page is kept beside
  the quote.)
- **Licence of the page text.** The site's footer: „Текст је доступан под
  лиценцом Creative Commons Ауторство—Делити под истим условима; могући су и
  додатни услови." and the Wikimedia Foundation's terms: „When you submit text
  to which you hold the copyright, you agree to license it under: Creative
  Commons Attribution-ShareAlike 4.0 International License (\"CC BY-SA 4.0\")".
  The pack's manifest therefore carries `CC-BY-SA-4.0` with the attribution
  naming both the author and Wikimedia.

### Project Gutenberg (`tales-en`)

The four ebooks are public domain in the United States, and the pack uses them
the way Project Gutenberg's own terms describe. Their licence page divides an
ebook into two parts, the book text and the Project Gutenberg trademark and
licence that surrounds it, and says of the first
(<https://www.gutenberg.org/policy/license.html>):

- „If you strip the Project Gutenberg license and all references to Project
  Gutenberg from the text, you are left with a text unrestricted by U.S.
  intellectual property law."
- „you may only distribute verbatim copies of the ebooks. No changes are allowed
  to the ebook contents. (Though reformatting the ebook to a different file
  format is considered okay)." — which is what this builder does: markup only,
  no rewriting, no abridging, no translation.

Each ebook's landing page states „Public domain in the USA."; two of the five
ebooks considered publish a separate `LICENSE.txt` (#2591, #1597) and it carries the notice
„This book, including all associated images, markup, improvements, metadata, and
any other content or labor, has been confirmed to be in the PUBLIC DOMAIN IN THE
UNITED STATES."

The texts are fetched from `gutenberg.pglaf.org`, a mirror of their public
repository of ebooks, because their terms of use ask bulk reusers to use a mirror
rather than the main site, and they ask reusers not to deep-link into it. The
Project Gutenberg name and ebook numbers live in this file, in `sources.json`
and in the manifest's `attribution` — which is where a credit belongs — and
never in an article: the wrapper is cut at the `*** START/END OF THE PROJECT
GUTENBERG EBOOK … ***` markers, and the article holds the book's text alone.

### Why Margaret Hunt's Household Tales (#5314) and not Grimms' Fairy Tales (#2591)

Both are public domain in the United States; the choice is about the
translation:

- **#5314 is the complete translation.** Margaret Hunt's 1884 *Household Tales*
  is the whole collection — the splitter reads 211 tales out of it — while
  #2591's own preparatory note says its text „is based on translations from the
  Grimms' Kinder und Hausmärchen by Edgar Taylor and Marian Edwardes", and about
  Taylor it adds: „who made the first English translation in 1823, selecting
  about fifty stories 'with the amusement of some young friends principally in
  view.'" A pack of tales for a reader is better served by all of them.
- **A measured second reason.** Run over #2591, the same splitter refuses the
  file rather than guessing: its contents list prints „THE JUNIPER-TREE" and
  then, lower-cased, „the juniper-tree." (read as a duplicate and reported), and
  „THE ADVENTURES OF CHANTICLEER AND PARTLET" is a section header whose three
  parts are separate entries, which leaves the header with no text of its own.
  Both are errors here, not silent repairs.

### What is *not* in the Serbian pack, and why

The category „Категорија:Српске народне приповетке" holds 207 pages and they are
not one collection. A page is included when its own `Извор` section names Vuk
Stefanović Karadžić — the same field the article's Source line is built from, so
the selection and the credit cannot drift apart. Of the 207, **136 are left
out**, each named in the build's output:

| Left out | Pages | Why |
| --- | --- | --- |
| Vuk Vrčević, „Српске народне приповијетке…" (1868) | 86 | A different collector's book, not Vuk Karadžić's. |
| „Босанска вила" (magazine) | 23 | Magazine pieces, no Vuk Karadžić attribution. |
| „Луча" (magazine) | 18 | The magazine's own late-19th-century pieces. |
| No `Извор` section at all | 7 | Dictionary entries, index pages and one unattributed tale. |
| Росић, „Најлепше српске народне бајке" (2002) | 1 | A 21st-century anthology, not Vuk's text. |
| „Словинац" (magazine, 1881) | 1 | A magazine piece. |

**Riddles are not in the pack because Wikisource does not have them.** Vuk's
1821 collection index links „Народне српске загонетке" and „Одгонетљаји", but
both are red links on `sr.wikisource.org` (checked 2026-10-10). The proverbs
collection does exist, as one page, and it is in the pack.

**No Serbian Grimm or Andersen.** No public-domain Serbian translation of either
was found — the same finding the research run recorded — so the English pack
carries them in English and the Serbian pack carries Serbian folk material
instead. A translation made after 1955 is protected for seventy years after the
translator's death, whatever the age of the tale.

### Illustrations

There are none. The only ebook in the set whose plate images are published
alongside the text is Aesop's #11339 (113 image files, 4,496,623 bytes
measured), and attaching a plate to a tale means a second parser over the
HTML edition to find where each `<img>` sits, plus a caption the plain-text
edition does not carry — which is exactly the kind of added text the
article-level fidelity check exists to refuse. The Serbian pages carry no
illustrations in their content region at all: the only images on them are the
public-domain icon and the Wikipedia mark inside the licence box, which is cut.
A later run can add plates with a parser of its own and per-image evidence.

## Verbatim, and how that is proved

The text of every article is the source's own, converted at the markup level
only. The builder proves it for every article at build time, and the proof fails
the build rather than the reader:

1. **The oracle.** For Wikisource, the oracle is the wiki's own rendered page
   (`action=parse&prop=text`) with the tags taken off; for Gutenberg, it is the
   slice of the plain-text file each tale was cut from.
2. **The comparison.** `stripMarkup(article)` with whitespace normalised must
   equal the oracle normalised. The stripper removes exactly the constructs the
   converter emits — headings, emphasis, hard breaks, list markers, escapes —
   and nothing else, so a dropped sentence, a doubled paragraph, a reordered
   passage or a changed word fails the build with the first difference printed.
3. **The guards around it.** A split that would leave a tale's heading inside
   another tale's article is refused
   (`assertNothingRanTogether`), because that is a wrong pack the text
   comparison cannot see: the text really is the source's text, all of it, under
   the wrong title. It happened while this builder was written — an unmatched
   contents entry ended a list early and 1.3 MB of Grimms was filed as
   „Rapunzel" — and it is the reason the guard exists.
4. **The markup that is *not* free.** The one thing the converter reformats
   knowingly is Project Gutenberg's own typographic convention: an underscored
   pair (`_much_ bigger`) is emphasis in the file, so it becomes Markdown
   emphasis and the oracle folds the same pair away. A `*` the book really
   printed (`151*`, a centred row of asterisks) is escaped so it stays a `*`.

Extracted from the Serbian pages' region, but not part of any article — because
these are the wiki's apparatus rather than the tale, and the region cut is where
the article ends: the `Извор` section (it becomes the article's Source line), the
`Референце` notes, `Види још` links, and the licence box (which is evidence, and
is quoted in `sources.json`). Everything left over is converted verbatim,
including the wiki's own „Википедија" link box that stands inside the proverbs
page's text.

## The Source line

Every article ends with one, as the layout requires: for the Serbian pack the
page's own `Извор` citation followed by the page URL, for the English pack the
book, its translator and the ebook's landing page. The URL is plain text, not a
link: it is the attribution a reader copies rather than a control, and the pages
that draw a link do it through the app's one door (ADR-107) — the builder writes
text, which is what a document holds.

## Tests and fixtures

`scripts/packs/tales/*.test.mjs` holds 57 tests, all of them converter, layout
and text tests on real bytes; the whole set runs in about a second.

| Fixture | Where it was cut from | Size |
| --- | --- | --- |
| `fixtures/wikisource-page.html` | the whole parser output of „Ко је то? – Никола!", the shortest tale of Vuk's 1870 edition | 3,899 bytes |
| `fixtures/wikisource-poem-slice.html` | a contiguous slice of „Златна јабука и девет пауница" around an `<i>` that ends after a space and a `<br />` between sentences | 4,502 bytes |
| `fixtures/gutenberg-1597-slice.txt` | the first 240 lines of ebook #1597 as the mirror serves it, with the ebook's own end marker appended so the wrapper is complete | 11,448 bytes |

The fixtures are verbatim copies with their source's licence; the pack's own
sources are not committed anywhere, and neither is any article.
