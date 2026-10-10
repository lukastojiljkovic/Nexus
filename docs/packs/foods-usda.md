# `foods-usda` — the food composition table

A `dataset` pack, `layout: 1`, one file: `foods.json`. It is the table the
Cookbook module reads when a recipe needs per-100 g nutrition, and it is built
only from USDA FoodData Central, which is CC0.

## What it contains

`{ "layout": 1, "foods": [ { "id", "name": { "en" }, "per100g": { … } } ] }`

* `id` is the FoodData Central `fdc_id` as a decimal string. Nothing is derived
  and nothing is invented: the id is the key the source itself uses, so a value
  in this pack can be looked up in the archive the pack records below.
* `name.en` is the source's own description, verbatim.
* `name.sr` is deliberately absent. USDA states no Serbian name for anything in
  the table, and a machine-translated food name would be a claim this pack
  cannot support.
* `per100g` carries `energyKcal`, `proteinG`, `fatG` and `carbsG`, plus
  `fibreG`, `sugarsG` and `saltG` **when the source states them**. A nutrient
  with no value is left out rather than written as `0` — „no data" and „none"
  are different claims and the table must not conflate them.
* `saltG` is computed, and it is the only computed number in the pack:
  `salt = sodium × 2.5`, from sodium in mg per 100 g to salt in g per 100 g.
  The factor is Regulation (EU) No 1169/2011, Annex I, point 11:

  > ‘salt’ means the salt equivalent content calculated using the formula:
  > salt = sodium × 2,5;

  (quoted from <https://www.legislation.gov.uk/eur/2011/1169/annex/I>, the
  regulation's Annex I; the `fdc_id` and the raw sodium value are both still
  recoverable from the archive, so the arithmetic can be redone from source.)

### Measured contents of the 2026-10-10 build

| Dataset | Release | Rows of its own `data_type` | Foods in the pack |
| --- | --- | ---: | ---: |
| Foundation Foods | April 2026 | 469 | 377 |
| SR Legacy | April 2018 (final release) | 7,793 | 7,793 |
| **Total** | | 8,262 | **8,170** |

`foods.json` is 1,568,559 bytes; the two archives it is built from total
9,900,333 bytes. Dropped: 71 Foundation Foods without all four of energy,
protein, fat and carbohydrate; 21 with no nutrient rows at all; and 87,521 rows
of the Foundation ZIP's own `food.csv` that belong to its supporting tables
(`sample_food`, `market_acquisition`, `sub_sample_food`,
`agricultural_acquisition`) and are laboratory or market samples rather than
foods. Nothing in SR Legacy was dropped. All of those counts are printed by the
build.

Energy is nutrient 1008 (`Energy`, KCAL) where the source has it, and otherwise
2047 or 2048 (the Atwater general and specific factors), which is the case for
most Foundation Foods. Which one was used is not recorded in the pack; the
archive is.

## Sources and licences

USDA FoodData Central data are in the public domain and published under CC0 1.0
Universal; USDA asks to be named as the source, which `pack.json`'s `licence`
does. The exact URLs, byte counts, SHA-256 digests, licence and the quoted
licence evidence are in [`scripts/packs/foods/sources.json`](../../scripts/packs/foods/sources.json).

The salt conversion is cited, not shipped: the pack carries the computed number
and the citation above.

## How to rebuild it

```text
node scripts/packs/foods/build.mjs
node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\foods-usda \
  --meta %TEMP%\nexus-packs\foods-usda.meta.json --key <release-key.pem>
```

The build downloads the two archives into
`%TEMP%\nexus-pack-cache\foods-usda\`, reuses them on a second run, unzips them
with [`scripts/packs/lib/zip.mjs`](../../scripts/packs/lib/zip.mjs) (no new
dependency), and writes the pack folder and its metadata file. It prints what it
fetched, what it dropped and how long it took. The 2026-10-10 run took 2,679 ms
with both archives already cached and 4,835 ms on the first run, with both
downloaded.

Its tests are `scripts/packs/foods/convert.test.mjs`, which converts the small
CSV slices in `scripts/packs/foods/fixtures/` — two Foundation Foods and one SR
Legacy food cut verbatim out of the two archives — and pins the exact expected
records.
