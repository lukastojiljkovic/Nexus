# Dictionary pack fixtures

Small slices of the two real sources, plus the pack they convert to. The
converter tests (`../convert.test.mjs`) and the module's own tests read these
files, so both sides of the format are pinned to the same bytes.

## What is here

| File | What it is |
| --- | --- |
| `en.jsonl` | four real English records from the raw Wiktextract extract, each carrying Serbo-Croatian translations |
| `sh.jsonl` | four real Serbo-Croatian records, whose English definitions are the sr-to-en direction |
| `phrasebook.wiki` | the first 115 lines of the Wikivoyage Serbian phrasebook, exactly as the page serves them |
| `expected/` | the pack those fixtures convert to, byte for byte — what `writePack` must produce |

## Where they come from, and what was cut away

They were written by a real build (`node scripts/packs/dictionary/build.mjs
--fixtures <dir>`) from the sources `../sources.json` records, and then reduced:

- each record keeps only the fields the converter reads — `word`, `pos`,
  `lang_code`, `senses[].glosses`, `translations` and, when the source had one,
  `source_url`. A real Wiktextract record also carries etymology, sounds,
  categories and links, which is why one real line is three to eight kilobytes.
- the translation list keeps every Serbo-Croatian item (they are what the
  English side is built from) and the first two items of any other language, so
  a test can prove a translation into German is not taken for a Serbian one. A
  real record lists about two hundred languages.

Nothing else was changed: the words, the parts of speech, the glosses and the
phrases are the sources' own text.

## Licence

Both sources are CC BY-SA 4.0 (see `../sources.json`, which quotes the pages
that say so), so these slices are redistributed under the same licence with the
same attribution the pack carries — see `../convert.mjs`'s `ATTRIBUTION` and the
pack's own `NOTICE.txt`.

## Regenerating `expected/`

The golden pack is the converter's output for these fixtures, and the test
compares the two byte for byte. To write it again after an intentional format
change:

```bash
node scripts/packs/dictionary/write-fixtures.mjs
```

That script exists only for this, and it says so.
