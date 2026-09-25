# ADR-078 — The FIT nutrition layer: provenance, snapshots, and a catalogue that is not a table

**Status:** accepted (2026-08-01) · **Owner:** supervisor · **Implements:** the
PRD's „Fitness (FIT) — Should": *track food and training against a real food
database… curated food data with provenance and a „report incorrect data" flow;
nutrition data reference-only with a disclaimer.* **Unblocked by the founder on
2026-08-01** — see STATUS §5: we licence nothing, we build the catalogue
ourselves from public-domain sources, and the user extends it. **Arc:** (a) core
+ database + interchange, (b) the „Ishrana" page and its IPC, (c) training.

## 1. The founder's answer, and what it forces

> *„Nećemo ništa da licenciramo, šta oni nađu to je, pa korisnik može da unosi
> svoje podatke ako mu nešto fali."*

Three consequences, all binding:

- **Public-domain sources only.** USDA FoodData Central is a US-government work
  in the public domain and carries no obligations; it is the backbone. **Open
  Food Facts is excluded** even though it is the obvious shortcut — ODbL is
  share-alike, which is exactly the licence obligation this answer rules out.
- **Nothing is guessed.** Every entry is either read off a fetched source, or
  *derived* from such sources by a recipe we publish. An entry we cannot source
  is **dropped and reported**, never invented. The house rule against fabricated
  data has never had higher stakes than here: these are numbers people eat by.
- **User-added foods are the design, not a workaround.** Branded Serbian retail
  products (a specific spread, a specific biscuit) are label data we are not
  scraping; the catalogue ships the *generic* food and the user adds their exact
  brand. The founder named this as the intended behaviour.

## 2. Provenance is a field, not a footnote

```
source: { kind: "usda" | "official"; ref; url }
      | { kind: "derived"; yieldGrams; recipe: { what; grams; per100g; url }[] }
```

A derived dish — sarma, pljeskavica, burek; no composition table on earth has a
row for them — publishes **its full recipe, each component's own sourced values,
and the cooked yield it divided by**. Anyone can redo the arithmetic and get our
number. That is the difference between a derivation and a guess, and it is why
`derived` is a first-class kind rather than an apology.

The yield is called out explicitly because it is the single biggest error source
in derived dishes: roasting loses water, beans and rice absorb it, frying adds
oil. Dividing by the raw ingredient weight instead of the cooked weight produces
numbers that look reasonable and are wrong by a third.

`validateFoodEntry` enforces the gates the data was produced under, and **a test
runs it over every entry in the shipped catalogue file**. That test is the point
of the exercise: it is what makes it safe to drop several hundred
agent-produced entries into the file wholesale, because the gate travels with
the data instead of living in the process that produced it.

**Two of the four gates I originally specified were wrong, and the data lanes
disproved them against the source tables.** Both corrections are recorded here
because both look like bugs to anyone who reasons about nutrition from first
principles:

- **Fibre must not be added to the macro sum.** USDA's *carbohydrate, by
  difference* **already contains** fibre — verified on Foundation walnut
  (FDC 2346394): `carbs 10.91`, `fiber 5.21`, the fibre being a component of the
  carbohydrate figure. The naive `P + C + F + fibre ≤ 100` double-counts and
  rejects sixteen perfectly ordinary foods — walnut, hazelnut, almond, all three
  chocolates, cocoa, popcorn. The correct pair is `P + C + F ≤ 100` **and**
  `fiber ≤ carbs`, the second expressing the containment the first was blind to.
- **`4P + 4C + 9F` is an estimate, not the truth.** USDA publishes food-specific
  Atwater factors, so in one category alone **68 of 126 entries** fall outside
  ±10% without a single one being wrong. Foundation broccoli (FDC 747447)
  publishes *both* numbers — `Atwater general 39` and `Atwater specific 32` —
  and our recomputation reproduces the general one while the catalogue carries
  the published specific one. Pear (63 vs 57) and spinach (26.6 vs 20.7) behave
  identically; lemon deviates by **+52.8%**, its carbohydrate-by-difference
  being largely citric acid rather than sugar. Editing `kcal` until the identity
  closed would mean shipping a number USDA does not publish — fabrication in
  arithmetic's clothing.

So the energy check became a rule about *self-explanation* rather than about
tolerance:

> An entry may deviate from `4P + 4C + 9F` by more than 10% **only if its
> `notes` field is non-empty.** The explanation is the licence to deviate.

This is stricter than a widened tolerance and carries more information. It
guarantees no entry silently holds an implausible number, and the sentence
survives into the export and onto the screen when a user asks where a value came
from. The `tolerance: "wide"` flag it replaced was dropped entirely: a flag set
by hand during assembly says less than a sentence written by whoever checked the
source.

**How the numbers were actually obtained matters as much as the gates.** The
public FDC API allows ten requests an hour on a demo key — useless at this
scale — so the lanes pulled USDA's official bulk CSV distributions and read
values out of `food_nutrient.csv` / `food_portion.csv` **by script**. No number
was typed by hand, and an independent second script read every published value
back to the source CSV. Serving sizes are USDA `food_portion` rows rather than
invented household measures.

## 2a. The one exception: `stated`, and why it is not a loophole

**Founder decision, 2026-08-01:** *„stavi da je kajmak 50% masti uz napomenu da
varira."*

The data lane dropped kajmak, correctly. No public-domain table measures it;
published Serbian figures span **40–55% fat young and 60–70% ripened**; the
standard sets only floors; and kajmak is neither sour cream nor butter, so
nothing honest substitutes. The founder overruled the drop on the grounds that a
staple simply missing serves the user worse than a labelled midpoint does — and
that is a product judgement, which is his to make.

The question this ADR has to answer is *where such a number lives*. `FoodSource`
had two kinds and a comment saying there is deliberately no third: „a number
nobody can re-check is a number this app does not ship." Filing kajmak as `usda`
would have been a lie with a URL attached. Filing it as `derived` would have
meant inventing a recipe and a yield. So the kind is **declared rather than
disguised**:

```ts
{ kind: "stated"; basis: string; range: string }
```

No `url` — inventing one is precisely the pretence the kind exists to avoid —
and the validator refuses it without **both** halves. `basis` says who decided
and on what; `range` carries the published spread the single figure sits inside.
**The uncertainty is a field, not a footnote**, the same principle that made
provenance a field. Stripped of either half, a stated number is
indistinguishable from a measured one, and that is the only way this exception
could quietly become the loophole its own doc comment promises it is not.

Only the fat is decided. Everything else follows from that fat level rather than
being invented alongside it: a cream-skin product at 50% runs about 6 g protein
and 1.5 g lactose with water as the balance, and the 480 kcal is Atwater over
those three, because no published energy figure exists to quote. The note tells
the user the fat is a set value rather than a measurement, gives both ranges, and
points at what the module already supports — enter your own kajmak as a user food
and it will beat any average. That is the founder's own design for the whole
catalogue, not a consolation prize.

The catalogue test pins the exception rather than tolerating it: exactly one
stated food today, non-empty basis and range, no url, and a note that actually
says the value varies. **Adding a `stated` food stays a founder decision each
time** — never a lane's shortcut when sourcing turns out to be hard. Ajvar, the
other known hole, has not been given one.

## 3. The catalogue is app data, not database rows

It ships as JSON inside `packages/core` and is never seeded into a profile's
database. Seeding several hundred identical rows into every profile — and from
there into every export archive — would make **app data masquerade as user
data**: the archive would claim to contain foods the user never entered, and a
catalogue correction would require a migration per profile.

This is the same call the „Datoteke" page made in ADR-075, where a union read
across three tables beat materialising a fourth index. The read is a merge of
two sources; only one of them is the user's.

## 4. A logged meal snapshots the macros it used

Every `fit_meal_items` row carries `food_ref` (`catalogue:<id>` or
`user:<uuid>`), a `label` snapshot, the grams, **and the seven per-100 g values
in force at the time**.

The catalogue ships with the app and will change between versions — a better
source, a corrected yield, a dropped entry. A food log that silently rewrites
yesterday's calories when the app updates is a lying log, and the lie is
invisible: nothing on screen would ever say the number changed. The snapshot
costs seven columns and buys a history that stays true.

It also means the store **never reads the catalogue**. The caller resolves the
food and hands in what to record; the database layer keeps no dependency on
app-shipped data.

## 5. There is no `fit_meals` table

A meal is a `(meal_date, slot)` grouping of items — `dorucak`, `uzina1`,
`rucak`, `uzina2`, `vecera`. A container table would buy nothing and would
introduce a state nobody can see or clean up: the empty meal, created when you
add an item and delete it again, invisible in every view and yet present in
every count.

## 6. Serbian search, and the letter that breaks folding

`searchFoods` folds diacritics so `sarg` finds `Šargarepa`, ranks prefix matches
above substring matches, and breaks ties with `Intl.Collator(["sr-Latn","sr"])`
— plain `"sr"` mis-tailors Latin š/č/ć, a defect this repo has already been
bitten by.

**`đ` is the exception that needs a hand-written map.** NFD decomposition plus
combining-mark stripping handles š, č, ć, ž — but `đ` (U+0111) is a single code
point with no decomposition, so it survives the fold untouched and `djuvec`
finds nothing. Pinned by test in both directions.

## 7. Deliberate exclusions, with reasons

- **No barcode scanning, no label OCR, no moderation queue** in this arc. The
  PRD lists them under a *submissions* flow that presumes a server to moderate
  into; cloud is out of scope. Local-only label entry is just the user-food form
  we already ship.
- **No micronutrients beyond sodium.** Vitamins and minerals are where
  public-domain coverage gets patchiest, and a nutrient that is present for a
  third of the catalogue and blank for the rest teaches users the number means
  nothing. Sodium is in every source we use.
- **Nutrition data is reference-only**, and the page will say so in Serbian, per
  the PRD. We are shipping a well-sourced catalogue, not medical advice, and the
  distinction is stated to the user rather than assumed.
