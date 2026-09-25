# Research: Nutrition Data Sourcing (food DB, Serbia-first)

**Domain:** food-composition data sources, licenses, acquisition strategy,
and data-quality models for the Fitness Hub's food database.
**Session:** 2026-07-05 (research phase 1, session 6).
**Nexus context:** founder decision #7 — hybrid acquisition (open datasets +
LLM-assisted collection + user corrections); all nutrition data
**reference-only** with in-app disclaimer and a "report incorrect data"
action; Serbian retail chains (LIDL, Maxi, Roda, Idea…) are the
differentiating coverage; saved meals ("jelo br. 1") are the logging UX.

## 1. Conclusions

1. **USDA FoodData Central is the free, no-strings foundation for generic
   foods.** 400k+ entries, public domain (CC0 — explicitly fine for
   commercial use), full downloadable dumps, ~8k Foundation Foods with
   deep lab-analyzed profiles (150+ nutrients)
   ([FDC](https://fdc.nal.usda.gov/), [API guide](https://fdc.nal.usda.gov/api-guide/)).
   Generic ingredients ("chicken breast, raw") come from here; localization
   maps Serbian names onto them.
2. **An official Serbian food-composition DB exists — pursue it.** The
   Institute for Medical Research (IMR) Belgrade / CAPNUTRA maintain a
   EuroFIR-harmonized Serbian FCDB: 1,046 foods + 129 traditional Serbian
   composite dishes, extended into a Balkan FCDB with 2,000+ items, EFSA
   FoodEx2-coded ([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0308814615001223),
   [CAPNUTRA](https://www.capnutra.org/food-and-nutritional-tools/)).
   Licensing/access terms are not public — this is a **contact-and-license
   conversation**, not a download. For sarma, gibanica, and pasulj-class
   traditional dishes, this is the authoritative source and likely cheap or
   free for a domestic product. Action item for the founder when FIT
   development approaches.
3. **Open Food Facts is valuable but its ODbL license is a design
   constraint.** 3M+ barcoded products, free API, commercial use allowed —
   but **share-alike**: improvements to the database must be shared back
   under ODbL ([OFF data](https://world.openfoodfacts.org/data)).
   If OFF data is merged into our curated DB, the combined database
   arguably becomes ODbL — giving away the founder's intended moat.
   Recommendation: **keep OFF as a separate, clearly-attributed lookup
   source** (point-of-use queries, great with barcode scanning on Android
   later), never merged into the proprietary curated store. Founder
   sign-off needed on this isolation strategy.
4. **Accuracy is the battleground — curated beats crowdsourced, and the
   founder's reference-only decision is validated by data.** Cronometer's
   curated DB reaches ~3–5% calorie accuracy; MyFitnessPal's unverified
   crowdsourced entries exceed 20% error in published research (a 2024 BMJ
   study), with duplicates and wrong macros as the norm
   ([Nutrola comparison](https://nutrola.app/en/blog/every-calorie-tracking-app-compared-2026),
   [Hoot on Cronometer](https://www.hootfitness.com/blog/cronometer-alternatives-find-the-best-fit-for-your-tracking-style)).
   Nexus model: **moderated contributions, not open crowdsourcing** — user
   submissions and corrections enter a moderation queue (founder decision
   #7's "report incorrect data"), verified entries get a visible badge,
   and duplicates are merged by moderation, not multiplied.
5. **The cleanest path to Serbian retail coverage is user-submitted label
   photos, not scraping.** Nutrition facts themselves are facts (not
   copyrightable), a user photographing the label of a product they bought
   involves no retailer ToS at all, and LLM/OCR extraction turns a photo
   into a structured entry for the moderation queue in seconds. Bulk
   scraping of retailer sites is legally murky even when data is
   unprotected: the EU's sui generis database right protects
   substantial-investment databases for 15 years, and the Ryanair ruling
   lets sites enforce anti-scraping terms as *contract* even over
   unprotected data ([Pinsent Masons on Ryanair](https://www.pinsentmasons.com/out-law/news/website-operators-can-prohibit-screen-scraping-of-unprotected-data-via-terms-and-conditions-says-eu-court-in-ryanair-case),
   [Stanford working paper](https://law.stanford.edu/publications/no-124-legality-and-challenges-of-web-scraping-databases-in-the-european-union-focus-on-non-personal-data-and-copyright/)).
   LLM-assisted collection (decision #7) therefore targets **manufacturer/
   producer public product pages** (with per-source ToS check and source
   citation stored per entry) — not retailer catalogs.
6. **Provenance is a first-class field.** Every food entry stores: source
   (USDA / IMR-licensed / producer page / user label photo / manual),
   source link or photo, verification status, and last-verified date. This
   is what makes "reference-only + report incorrect" operationally real,
   and it future-proofs against any licensing question.

## 2. Source landscape

| Source | Coverage | License | Role for Nexus |
| --- | --- | --- | --- |
| USDA FoodData Central | 400k+ foods, ~8k deep generic profiles | CC0 (public domain) | Foundation for generic ingredients |
| IMR/CAPNUTRA Serbian FCDB | 1,046 foods + 129 traditional dishes, Balkan ext. 2,000+ | Unknown — contact required | Authoritative Serbian/traditional dishes |
| Open Food Facts | 3M+ barcoded products, ~150 countries | ODbL (share-alike!) | Isolated lookup source + barcode scan; never merged |
| User label submissions | Serbian retail reality (LIDL, Maxi, Roda, Idea…) | Ours, moderated | The differentiating coverage, grows with users |
| Producer public pages (LLM-assisted) | Serbian brands | Facts; per-source ToS check | Gap-filling into moderation queue |

## 3. Data model implications (for FIT PRD)

- Entry types: generic ingredient, branded product (with barcode where
  known), user's custom food, **saved meal/recipe** (composition of entries —
  the founder's "jelo br. 1" one-tap logging), and restaurant/homemade
  estimate (clearly badged as estimate).
- Per-entry: macro + micro nutrients per 100g/ml plus package/serving sizes;
  provenance block (conclusion #6); verification badge; localization
  (Serbian + English names, EFSA FoodEx2 code where available for future
  interop).
- Moderation queue with dedup merge; "report incorrect data" from every
  entry view; reference-only disclaimer surfaced at first use of nutrition
  features, not buried in settings.

## 4. Pitfalls

- **ODbL contamination** — one careless merge of OFF rows into the curated
  store and the moat is legally open-source. The isolation must be
  structural (separate store, separate attribution UI), not a convention.
- **Crowdsourcing without moderation** recreates MyFitnessPal's 20%-error
  swamp; moderation effort must be budgeted (founder time initially, then
  trusted-user tier).
- **Stale products:** Serbian retail assortments rotate (especially LIDL);
  last-verified dates and user reports handle decay — never present data as
  current-by-guarantee (reference-only framing again).
- **Micronutrient false precision:** label data covers macros; don't render
  80 micronutrients from a source that only had 8 — show what the source
  actually provided.
- **Scraping shortcuts:** tempting, legally fragile in the EU/Serbia
  context; the label-photo pipeline is slower to bootstrap but clean and
  community-building.

## 5. Open questions → FIT PRD / founder

1. Contact IMR/CAPNUTRA about licensing the Serbian FCDB — founder action
   when FIT development starts (their terms may reshape this strategy).
2. Sign off on the OFF isolation strategy (separate lookup, never merged).
3. Moderation model: founder-only initially → trusted contributors later —
   at what user count does this need tooling?
4. Barcode scanning is Android-first value (camera) — how much does the
   desktop MVP need the food DB vs manual/saved-meal entry only?
   (Recommendation: FIT is (S), post-MVP anyway; desktop starts with
   saved meals + generic foods, barcode comes with Android.)
5. Label-photo OCR pipeline: ships with FIT v1 or fast-follow? (It's the
   growth engine for Serbian coverage — recommend v1.)
