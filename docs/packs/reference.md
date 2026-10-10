# Packs: `reference-en` and `reference-sr` — charters, constitutions, laws

Two `content` packs built by one builder, `scripts/packs/reference/`. This file
is the builder's own record: what it produces, what it is allowed to produce,
how to rebuild it, and the measured sizes of the last build. The two per-pack
pages — [reference-en.md](reference-en.md), [reference-sr.md](reference-sr.md) —
list every document and every source URL.

## The builder

```bash
node scripts/packs/reference/build.mjs [--id reference-en|reference-sr] [--refresh] [--fixtures]
```

| File | What it is |
|---|---|
| `build.mjs` | Fetches the sources, converts them, checks them, writes the packs, the metadata for the signer and `sources.<pack>.json`. |
| `sources.mjs` | The source table: per document, the URL, the selector that marks the document on the page, the furniture to prune, the boundary markers, and the licence with its evidence. |
| `lib/html.mjs` | A small HTML/XHTML reader: implicit `<p>`/`<li>`/`<td>` closing, entities, `class`/`id` selectors, byte offsets. |
| `lib/convert.mjs` | Region in, blocks out, blocks in, CommonMark out — plus the fidelity check and the guards that refuse a page which changed shape. |
| `lib/pdf.mjs` | A PDF's text layer as lines, through `pdfjs-dist` (the one root dev dependency this file needs). |
| `lib/net.mjs` | The cached fetcher, `%TEMP%\nexus-pack-cache\<pack>\`. |
| `lib/pack.mjs` | Article text, table of contents, `content.json`, the signer's metadata, `sources.json`. |
| `convert.test.mjs`, `fidelity.test.mjs`, `pack.test.mjs` | 46 tests over fixtures cut from the real sources. |
| `fixtures/` | 5 080 B of a UN page, 7 236 B of an Official Journal file, 5 978 B of a Serbian gazette act — the three source families, small enough to keep in the repository. |

Each fixture comes from the same source family the packs take their text from, so
the licence that lets a pack ship a document also lets the repository keep a few
kilobytes of it: a UN document in the public domain, an Official Journal file
under CC BY 4.0, and a Serbian act that is not a work of authorship. The gazette
fixture is the act this builder verified as a gazette original — it is a fixture
and not a packed document because it is not one of the five laws the task names.

Nothing is written into the repository except `sources.<pack>.json`, the
fixtures, and the article files' measured sizes below. The packs themselves go
to `%TEMP%\nexus-packs\<id>\` and are signed by the maintainer:

```bash
node scripts/pack-sign.mjs --dir "%TEMP%\nexus-packs\reference-en" \
  --meta "%TEMP%\nexus-packs\reference-en.meta.json" --key <private-key.pem>
```

`minAppVersion` is `1.5.0` — the build that reads `kind: "content"` is the one
this wave adds; the field is the pack's own statement that it needs a build with
a Reader.

## What the two packs hold, measured on 2026-10-10

| | `reference-en` | `reference-sr` |
|---|---|---|
| Documents in the source table | 14 | 2 |
| Articles written | 189 | 2 |
| Table-of-contents entries | 14 (2 with children) | 2 |
| Articles plus `content.json` | 1 552 634 B (1.48 MiB) | 224 667 B (219 KiB) |
| `content.json` | 86 499 B | 904 B |
| Signer metadata | 1 990 B | 1 420 B |
| `sources.<pack>.json` | 21 071 B | 3 432 B |
| Build time from a warm cache | 0.6 s | 0.0 s |

The English pack's size is dominated by the two consolidated treaties, which are
printed in parts and therefore become many articles: the Treaty on the
Functioning of the European Union is 740 324 B over 128 articles and the Treaty
on European Union 421 076 B over 49. Everything else is one article per
document, between 3 228 B (the Bill of Rights) and 57 806 B (the UN Charter).

Every article ends with a Source line naming the work, its section and its URL.
An article whose document is EU law also carries, at the top, the line that only
the Official Journal is authentic and this is a convenience copy; an article
whose document is an official Serbian text carries the three lines the wave's
brief requires — check the Official Gazette for amendments, the state as of a
date, and which gazette numbers that copy is made of.

## Licences

Each pack's `pack.json` names one licence, its attribution and its address, as
ADR-091 requires; both packs are `CC-BY-SA-4.0`, because part of what they carry
is a Wikisource transcription, and the attribution names every rightsholder.
Inside, each document keeps its own basis, recorded with evidence in
`sources.<pack>.json`:

- **United States Government works** — no copyright (17 U.S.C. § 105), quoted
  from govinfo's own edition of the section.
- **United Nations documents** — in the public domain under the UN's own
  Administrative Instruction ST/AI/189/Add.9/Rev.2, which is what makes the UN's
  website copyright notice inapplicable to them.
- **European Union documents** — reuse permitted under Commission Decision
  2011/833/EU and CC BY 4.0, quoted from the Commission's legal notice, with the
  authenticity caveat in every article.
- **Wikisource transcriptions** — CC BY-SA 4.0, which Wikimedia's terms of use
  confirm allows commercial use; the transcribed documents underneath are
  public domain (a UN instrument, or a 1908/1914 translation).
- **Serbian official texts** — not works of authorship (Art. 6, *Zakon o
  autorskom i srodnim pravima*), quoted from the WIPO Lex record where the
  exclusion can be read.

## What this builder will not do

- **Consolidate.** A law ships as the act as published, never as a text that
  merges amendments; no tool here joins an original with the acts that changed
  it.
- **Take a consolidated or commercial text as a source.** The Serbian legal
  information system (PIS) is a JavaScript application that returns no document,
  and commercial consolidated texts are excluded by the task's rules and by the
  database right a publisher of a collection can hold.
- **Take a scan.** A PDF with no text layer yields no text, and the build refuses
  it rather than shipping an empty article.
- **Carry figures, images or links.** Articles are CommonMark text: an `img`, a
  figure's caption aside, is not converted, and an anchor keeps its text and
  loses its target, because the app has no vetted external-link wrapper until
  after this wave's merge.
