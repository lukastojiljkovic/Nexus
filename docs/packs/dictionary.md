# `dictionary-sr-en` — the Serbian and English dictionary

A `dataset` pack for the **Translator** module (`apps/desktop/src/modules/translator/`):
English words with their Serbian translations, Serbian words with their English
meanings, and the Wikivoyage Serbian phrasebook by topic. It is built by
`scripts/packs/dictionary/build.mjs`, signed with the release key
(`scripts/pack-sign.mjs`) and installed the way every pack is (ADR-091).

**Licence: CC BY-SA 4.0**, because everything in it is Wikimedia text. The
application stays Apache-2.0; the pack carries its own licence, and its
attribution is shown on the module's page and in its own `NOTICE.txt`.

## What it measures

Measured on 2026-10-10 on this machine, by one full build (the second column is
the same build again, from the cache):

| | |
| --- | --- |
| Sources downloaded | 2 981 058 381 B (the extract) + 47 086 B (the phrasebook) = **2.98 GB** |
| Decompressed and filtered | 25 614 284 530 B = 24 427.7 MiB (the size kaikki.org states), 10 913 997 lines |
| Time | **358 s** for the first build (download included), **110 s** for the same build again from the cache |
| Pack, on disk | **15 721 367 B = 15.0 MiB** |

| File | Bytes | What it holds |
| --- | ---: | --- |
| `index/en/keys.txt` | 175 851 | 17 969 folded English keys, sorted |
| `index/en/group.bin` | 71 880 | uint32 per key (plus a sentinel): its first entry |
| `index/en/lines.bin` | 77 076 | uint32 per entry: its byte offset in the entries file |
| `index/en/entries.jsonl` | 4 438 483 | 19 269 English entries |
| `index/sr/keys.txt` | 340 441 | 39 539 folded Serbian keys, sorted |
| `index/sr/group.bin` | 158 160 | the same, per key |
| `index/sr/lines.bin` | 279 868 | the same, per entry |
| `index/sr/entries.jsonl` | 10 136 626 | 69 967 Serbian entries |
| `phrases.json` | 41 211 | 331 phrases in 17 topics |
| `NOTICE.txt` | 524 | the attribution below, verbatim |
| `about.json` | 1 247 | the pack's own counts, sizes and source digests |

What the caps dropped: nothing on the English side, and 7 Serbian entries whose
key already held twelve.

Looking a word up costs, measured by
`apps/desktop/src/modules/translator/main/pack.slow.test.ts` (run with
`$env:NEXUS_SLOW_DICTIONARY = "1"`, then `node node_modules/vitest/vitest.mjs run
--configLoader runner --maxWorkers=1 apps/desktop/src/modules/translator/main/pack.slow.test.ts`):

| | |
| --- | --- |
| Opening both indexes | 17.7 ms — 1 103 276 B of keys and offset tables, read once; the entry files stay closed until a hit |
| 2 000 lookups, both directions | mean **0.051 ms**, median 0.021 ms, max 0.608 ms (a second run measured mean 0.029 ms) |
| The widest query (`a`, 20 results) | 0.366 ms, 21 entries read |
| The whole phrasebook | 3.5 ms for 17 topics and 331 phrases |

## Where it comes from

Every source, its byte count, its SHA-256, the date it was fetched and the
**licence evidence** — the page that states the licence and the sentence on it,
quoted verbatim — are in [`scripts/packs/dictionary/sources.json`](../../scripts/packs/dictionary/sources.json).
Two sources, and both are Wikimedia:

| Source | What it supplies | Licence |
| --- | --- | --- |
| `https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz` — the raw Wiktextract extract of the **English** Wiktionary edition | both directions: the English records, with their Serbo-Croatian translation lists, and the Serbo-Croatian records, whose English definitions are the other direction | CC BY-SA 4.0 (and GFDL, unversioned) |
| `https://en.wikivoyage.org/w/index.php?title=Serbian_phrasebook&action=raw` | the phrasebook, by topic | CC BY-SA 4.0 |

Three facts about the first one, because each is load-bearing:

- **Wiktionary files Serbian under `Serbo-Croatian` (`sh`).** There is no
  `Serbian` or `Croatian` extract at kaikki.org, and the codes `sr`, `hr`, `bs`
  and `cnr` return nothing; the research behind this pack measured 15 388 English
  pages carrying a `{{t|sh|…}}` call.
- **One download holds both directions**, which is why the build fetches one
  archive: the English records carry the Serbian words, and the Serbo-Croatian
  records carry the English definitions (they have no translation lists into
  English at all — the research measured zero).
- **The per-language postprocessed files are marked DEPRECATED** on kaikki.org
  ("will be removed in the near future"), so this build reads the raw extract
  instead. That is also the route kaikki.org recommends, and the one its own
  page states the licence for.

## What is kept, and what is dropped

- **English side**: a record whose own language is English, that carries at
  least one Serbo-Croatian translation with a non-empty word, and that has an
  English definition. Everything else in a 25.6-gigabyte extract — every other
  language, and every English word nobody has translated into Serbo-Croatian —
  is dropped. The Cyrillic and Latin spellings of one Serbian word, which the
  source carries as two items, become **one** entry under one key.
- **Serbian side**: a record whose own language is Serbo-Croatian and that has
  at least one English definition, of which up to three are kept.
- **Phrases**: the phrasebook's own lines, with their wikitext markup removed
  and nothing else changed. Rows inside a `{{…}}` template are skipped whole —
  the page's "Common signs" infobox is a sign list rather than phrases, and a
  colon inside a template is not the phrase separator.

Counts come out at **19 269 English entries** (17 969 keys) and **69 967 Serbian
entries** (39 539 keys) — a real count, not an estimate: the research could only
estimate the English side from samples, and one of its two methods was 7× off,
which is why it asked for the build to be run before the pack was sized.

## The format, and why

Each direction is four files (`keys.txt`, `group.bin`, `lines.bin`,
`entries.jsonl`), described in `scripts/packs/dictionary/convert.mjs`. They are
what lets the module answer a keystroke without reading the pack:

1. `keys.txt` and the two offset tables are read once (a few hundred kilobytes,
   17.7 ms for both directions) and held.
2. A query is folded to a key and **binary-searched** in `keys.txt`
   (`matchDictionaryKeys` in `@nexus/core`).
3. Only the entry lines the match names are read, each with one `read` at the
   byte offset `lines.bin` gives.

### The key

A key is the word lowercased, with the Serbian Cyrillic alphabet transliterated
to Latin and the diacritics removed — `search/searchText.ts`'s `foldSearchText`,
which the app already folds every search query through (ADR-021), reused rather
than re-derived. So `ćevapčići`, its Cyrillic spelling and `cevapcici` are one
key, and `djordje` finds `Đorđe`.

The builder cannot import TypeScript, so it carries a port of that fold
(`scripts/packs/dictionary/fold.mjs`) — and `fold.test.mjs` folds a word list
through **both** implementations, failing the build on any disagreement. A key
that stopped matching would be invisible otherwise: a miss looks exactly like a
word the dictionary does not have.

Two consequences, stated because they are deliberate:

- The fold is **lossy** (`č` and `ć` both become `c`), so the index is a lookup
  key and never the word itself: every entry keeps the source's own spelling,
  and two headwords that fold together stay two entries under one key.
- The index is sorted by **code unit**, not by the Serbian collator, because a
  binary search needs an order the writer and the reader compute identically. The
  lists a person reads — results, recent lookups, phrasebook topics — are ordered
  with `Intl.Collator(["sr-Latn", "sr"])` at the surface, where sorting is for a
  reader.

## Rebuilding it

```bash
node scripts/packs/dictionary/build.mjs --update-sources   # once, to record a new source's digest
node scripts/packs/dictionary/build.mjs                    # the build itself
node scripts/pack-sign.mjs --dir "%TEMP%\nexus-packs\dictionary-sr-en" \
  --meta "%TEMP%\nexus-packs\dictionary-sr-en.meta.json" --key <release-key.pem>
```

- The sources are cached in `%TEMP%\nexus-pack-cache\dictionary-sr-en\` and
  reused, so a rebuild costs no download; an interrupted download resumes with
  HTTP `Range`.
- The build **refuses to run** when a cached source's SHA-256 differs from the
  one `sources.json` records: a source that changed under a pack is a new pack,
  and `--update-sources` is the deliberate way to say so.
- Nothing is ever held whole: the download is written straight to disk, the
  gunzip is piped, and one line at a time is inspected — a substring test first,
  and `JSON.parse` only for a line that could be a record this pack carries.
- `--source-dir`, `--out-dir` and `--fixtures <dir>` move the cache, the output,
  and the small slices `scripts/packs/dictionary/*.test.mjs` run against.
- `--fixtures` writes **trimmed** records (the fields the converter reads, every
  Serbo-Croatian translation but only two of any other language): a real
  Wiktextract line is three to eight kilobytes, and a committed fixture has to be
  a few. `fixtures/README.md` says exactly what was cut.

The builder prints every size, count and elapsed time it measures, and it writes
no signature and reads no key: signing is the maintainer's, with the release key.

## Deliberately not in this pack

- **FreeDict** (`srp-eng` 395 headwords, `eng-srp` 590; `hrv-eng`/`eng-hrv`
  60–80 k) — GPL-2.0-or-later, a different licence from this pack's, and the
  Serbian pair is negligible. Merging it would need legal advice, not a build
  flag.
- **Apertium** `hbs-eng` (16 265 entries, GPL-3.0, no reverse direction) — the
  same licence problem, and it is rule-based MT data rather than a dictionary.
- **OPUS parallel corpora** — sentence-aligned, for training translation models
  rather than for a lookup, and their licences are per corpus and absent from
  the API.
- **PanLex** (CC BY-NC-SA, written permission needed for commercial use) and
  **Wikidata lexemes** (CC0, but about a thousand Serbian entries).
- Any sentence translation: that is the sentence-translation run's pack, and this
  pack carries words and phrases only.

## Attribution

Shipped verbatim in the pack's `NOTICE.txt`, in `about.json`'s `attribution`
field, and on the module's page:

> Dictionary data derived from Wiktionary (en.wiktionary.org), created by
> Wiktionary contributors, licensed under CC BY-SA 4.0. Source per entry: the url
> field in each record (or https://en.wiktionary.org/wiki/<word>); full licence
> list at https://en.wiktionary.org/wiki/Wiktionary:Copyrights.
> Phrasebook text derived from Wikivoyage (en.wikivoyage.org), licensed CC BY-SA
> 4.0. Extracted with Wiktextract (MIT). This pack is licensed CC BY-SA 4.0; it is
> not part of, and does not change the licence of, the Nexus application.

The Wikimedia Terms of Use allow the hyperlink route for attribution and the pack
takes it: **every entry carries its own Wiktionary URL**, which the module shows
under the entry as its source.

## Open questions

- The raw extract is 2.98 GB compressed and 25.6 GB decompressed, and it
  is re-extracted "at least once a week" — a rebuild is a download and a few
  minutes, not a patch. `sources.json` pins the digest so a rebuild cannot
  silently pick up a different vintage, but nothing here decides *when* to
  rebuild.
- The extract's own vintage is whatever kaikki.org last published (the 2026-10-10
  build read a file whose `Last-Modified` was 2026-10-03). The pack's version is
  the month of the build (`2026.10.0`); whether that should instead be the
  extract's vintage is a maintainer's call.
- Serbian is digraphic, and the pack keeps the source's spelling with its Latin
  transliteration beside it. A future pack could prefer one script; this one
  shows both, in the source's own form.
