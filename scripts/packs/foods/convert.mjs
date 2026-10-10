// No shebang — this module is both the foods builder's converter and its test's
// import target, exactly like `scripts/pack-sign.mjs`.
//
// WHAT IS BEING CONVERTED, AND THE ONE DECISION IN IT. FoodData Central ships
// two relational extracts as CSV: `food.csv` names a food, `food_nutrient.csv`
// says how much of each nutrient 100 g of it holds, and `nutrient.csv` is the
// dictionary that says which id is which nutrient. The only derived number in
// this pack is salt, and the brief fixes its source: salt = sodium × 2.5, the
// conversion Regulation (EU) No 1169/2011 Annex I gives for the „salt" value on
// a nutrition declaration. Sodium arrives in MILLIGRAMS per 100 g and salt is
// wanted in GRAMS per 100 g, so the factor carries a ÷1000 with it — the single
// place this converter can be wrong by a thousand, which is why `saltFromSodium`
// is its own exported function with its own test.
//
// NOTHING IS INVENTED. A nutrient the source does not state is left out of the
// record rather than written as zero („no data" and „none" are different
// claims), and a food that does not state the four required values is dropped
// and counted rather than shipped half-filled.

/**
 * The nutrient ids, read off the two archives' own `nutrient.csv` rather than
 * remembered: 1003 Protein, 1004 Total lipid (fat), 1005 Carbohydrate by
 * difference, 1008 Energy (KCAL), 1079 Fiber total dietary, 1093 Sodium (MG),
 * 2000 Total Sugars. 2047 and 2048 are Energy by the Atwater general and
 * specific factors, which Foundation Foods carries where it states no 1008.
 */
export const NUTRIENT_IDS = {
  protein: 1003,
  fat: 1004,
  carbs: 1005,
  energy: 1008,
  energyAtwaterGeneral: 2047,
  energyAtwaterSpecific: 2048,
  fibre: 1079,
  sodium: 1093,
  sugars: 2000,
};

/** Regulation (EU) No 1169/2011, Annex I, point 11. */
export const SALT_FROM_SODIUM = 2.5;

const round = (value, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/**
 * Salt in grams per 100 g, from sodium in MILLIGRAMS per 100 g.
 *
 * `25 mg × 2.5 = 62.5 mg = 0.0625 g` — the hand calculation the test pins.
 */
export function saltFromSodium(sodiumMg) {
  return round((sodiumMg * SALT_FROM_SODIUM) / 1000);
}

/**
 * A whole CSV file as an array of rows of strings.
 *
 * Written by hand because the fields genuinely contain what a `split(",")`
 * cannot survive: quoted commas, doubled `""` quotes, and — in
 * `food_nutrient.csv`'s footnote column — newlines inside a quoted field. The
 * character loop is the only shape that gets all three right, and it is the
 * same shape on every CSV this repository will ever read.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let index = 0;
  // A trailing newline would otherwise produce one empty row at the end.
  const source = text.endsWith("\r\n") ? text.slice(0, -2) : text.endsWith("\n") ? text.slice(0, -1) : text;
  while (index < source.length) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      index += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

/** `[{ header: value }]`, from the first row as the header. */
export function parseCsvObjects(text) {
  const rows = parseCsv(text);
  const header = rows[0];
  if (header === undefined) return [];
  return rows.slice(1).map((row) => {
    const record = {};
    for (let column = 0; column < header.length; column += 1) {
      record[header[column]] = row[column] ?? "";
    }
    return record;
  });
}

/**
 * The nutrient ids the archives actually define, so the converter fails loudly
 * if a future release renumbers one instead of quietly writing a pack full of
 * nulls. The names are not asserted — USDA has renamed „Sugars, Total" between
 * releases — only the units, which are what the arithmetic depends on.
 */
export function nutrientUnits(nutrientCsv) {
  const units = new Map();
  for (const row of parseCsvObjects(nutrientCsv)) {
    const id = Number.parseInt(row.id, 10);
    if (Number.isFinite(id)) units.set(id, row.unit_name);
  }
  return units;
}

const REQUIRED_UNITS = new Map([
  [NUTRIENT_IDS.energy, "KCAL"],
  [NUTRIENT_IDS.protein, "G"],
  [NUTRIENT_IDS.fat, "G"],
  [NUTRIENT_IDS.carbs, "G"],
  [NUTRIENT_IDS.fibre, "G"],
  [NUTRIENT_IDS.sugars, "G"],
  [NUTRIENT_IDS.sodium, "MG"],
]);

/**
 * One archive's CSVs into the pack's `foods` array.
 *
 * `dataType` filters `food.csv` down to the rows this archive is *for*: the
 * Foundation Foods ZIP also carries its supporting tables (sample foods, market
 * acquisitions, sub-samples), and a pack built from all 88 000 of those rows
 * would be a pack of laboratory samples rather than of foods.
 */
export function convertFoods({ foodCsv, foodNutrientCsv, nutrientCsv, dataType }) {
  const units = nutrientUnits(nutrientCsv);
  for (const [id, unit] of REQUIRED_UNITS) {
    if (units.get(id) !== unit) {
      throw new Error(`foods: nutrient ${String(id)} is not in ${unit} but ${String(units.get(id))}`);
    }
  }

  const names = new Map();
  const order = [];
  const dropped = { otherDataType: 0, unnamed: 0, incomplete: 0, noNutrients: 0 };
  for (const row of parseCsvObjects(foodCsv)) {
    if (row.data_type !== dataType) {
      dropped.otherDataType += 1;
      continue;
    }
    const description = row.description.trim();
    if (row.fdc_id === "" || description === "") {
      dropped.unnamed += 1;
      continue;
    }
    names.set(row.fdc_id, description);
    order.push(row.fdc_id);
  }

  // Only the eight nutrients in the layout are kept, which is what makes a
  // 36 MB `food_nutrient.csv` fit in memory beside the food list.
  const wanted = new Set(Object.values(NUTRIENT_IDS));
  const amounts = new Map();
  for (const row of parseCsvObjects(foodNutrientCsv)) {
    if (!names.has(row.fdc_id)) continue;
    const nutrientId = Number.parseInt(row.nutrient_id, 10);
    if (!wanted.has(nutrientId)) continue;
    const amount = Number.parseFloat(row.amount);
    if (!Number.isFinite(amount)) continue;
    const entry = amounts.get(row.fdc_id) ?? new Map();
    // The first row wins, because FDC repeats a nutrient when it was derived
    // twice and the file's own order is the only tie-break it offers.
    if (!entry.has(nutrientId)) entry.set(nutrientId, amount);
    amounts.set(row.fdc_id, entry);
  }

  const foods = [];
  for (const fdcId of order) {
    const entry = amounts.get(fdcId);
    if (entry === undefined) {
      dropped.noNutrients += 1;
      continue;
    }
    const energy = entry.get(NUTRIENT_IDS.energy) ?? entry.get(NUTRIENT_IDS.energyAtwaterGeneral) ?? entry.get(NUTRIENT_IDS.energyAtwaterSpecific);
    const protein = entry.get(NUTRIENT_IDS.protein);
    const fat = entry.get(NUTRIENT_IDS.fat);
    const carbs = entry.get(NUTRIENT_IDS.carbs);
    if (energy === undefined || protein === undefined || fat === undefined || carbs === undefined) {
      dropped.incomplete += 1;
      continue;
    }
    const per100g = {
      energyKcal: round(energy),
      proteinG: round(protein),
      fatG: round(fat),
      carbsG: round(carbs),
    };
    const fibre = entry.get(NUTRIENT_IDS.fibre);
    if (fibre !== undefined) per100g.fibreG = round(fibre);
    const sugars = entry.get(NUTRIENT_IDS.sugars);
    if (sugars !== undefined) per100g.sugarsG = round(sugars);
    const sodium = entry.get(NUTRIENT_IDS.sodium);
    if (sodium !== undefined) per100g.saltG = saltFromSodium(sodium);
    foods.push({ id: fdcId, name: { en: names.get(fdcId) }, per100g });
  }
  return { foods, dropped };
}
