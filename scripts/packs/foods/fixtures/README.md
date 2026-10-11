# Foods converter fixtures

Small slices of the two USDA FoodData Central archives, cut verbatim so the
converter's tests run against the CSVs the pack is actually built from.

* `foundation/food.csv`, `foundation/food_nutrient.csv`,
  `foundation/nutrient.csv` — two Foundation Foods, out of
  `FoodData_Central_foundation_food_csv_2026-04-30.zip`: `321358` (Hummus,
  commercial) and `1750337` (Soy milk, unsweetened, plain, shelf stable, whose
  energy is stated only as the Atwater factors).
* `sr_legacy/food.csv`, `sr_legacy/food_nutrient.csv`,
  `sr_legacy/nutrient.csv` — one SR Legacy food, `167512` (Pillsbury Golden
  Layer Buttermilk Biscuits), out of
  `FoodData_Central_sr_legacy_food_csv_2018-04.zip`.

USDA FoodData Central data are in the public domain, published under CC0 1.0
Universal, and nothing in these slices was changed: each file is the archive's
own header row plus the rows for the foods named above. The full URLs, byte
counts, SHA-256 digests and the quoted licence evidence are in
`../sources.json`.
