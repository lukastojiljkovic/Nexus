// No shebang, the reason `scripts/pack-sign.mjs` gives: this module is a CLI
// (`node scripts/packs/foods/build.mjs`) and an import target for its own test.
//
// WHAT THIS BUILDS. The `foods-usda` dataset pack: USDA FoodData Central's
// Foundation Foods and SR Legacy, per 100 g, as `foods.json`. It downloads the
// two archives into `%TEMP%\nexus-pack-cache\foods-usda\` (reused on a second
// run), unzips them with `lib/zip.mjs`, converts with `convert.mjs`, and writes
// the finished pack folder to `%TEMP%\nexus-packs\foods-usda\` together with
// the metadata file `scripts/pack-sign.mjs --meta` takes.
//
// WHY THE METADATA IS NOT INSIDE THE PACK FOLDER. `pack-sign.mjs` lists every
// file it finds under `--dir` in the manifest, and the pack's invariant is that
// the folder holds the manifest, its signature, and the content — and nothing
// else. A metadata file left in there would be signed as content and the pack
// would carry its own build recipe.
//
//   node scripts/packs/foods/build.mjs
//   node scripts/pack-sign.mjs --dir %TEMP%\nexus-packs\foods-usda \
//     --meta %TEMP%\nexus-packs\foods-usda.meta.json --key <release-key.pem>

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createSource, packsDir, printFetchLog } from "../lib/source.mjs";
import { entryNamed, readZip } from "../lib/zip.mjs";
import { SALT_FROM_SODIUM, convertFoods } from "./convert.mjs";

const PACK_ID = "foods-usda";
const VERSION = "2026.10.0";
/** The dataset readers for `layout: 1` arrive with the 2.0 wave; see the report. */
const MIN_APP_VERSION = "2.0.0";

const LICENCE_URL = "https://creativecommons.org/publicdomain/zero/1.0/";
const SOURCE_URL = "https://fdc.nal.usda.gov/download-datasets.html";
/** Quoted from USDA's own API guide, which the pack's `sources.json` records. */
const ATTRIBUTION =
  "USDA FoodData Central (Agricultural Research Service), Foundation Foods and SR Legacy. "
  + "USDA: \"USDA FoodData Central data are in the public domain and they are not copyrighted. "
  + "They are published under CC0 1.0 Universal (CC0 1.0) No permission is needed for their use, "
  + "but we request that users list FoodData Central as the source of the data\" "
  + "(https://fdc.nal.usda.gov/api-guide.html). Salt is computed from sodium as "
  + `sodium x ${String(SALT_FROM_SODIUM)} (Regulation (EU) No 1169/2011, Annex I, point 11).`;

/**
 * The two archives, with the URL each was measured at, the `data_type` that
 * selects this archive's own rows out of `food.csv`, and the dataset's name.
 */
const ARCHIVES = [
  {
    name: "foundation_food.zip",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip",
    dataType: "foundation_food",
    dataset: "Foundation Foods (April 2026)",
  },
  {
    name: "sr_legacy_food.zip",
    url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip",
    dataType: "sr_legacy_food",
    dataset: "SR Legacy (April 2018, final release)",
  },
];

function metadata() {
  return {
    format: 1,
    id: PACK_ID,
    version: VERSION,
    kind: "dataset",
    title: {
      sr: "Namirnice (USDA)",
      en: "Foods (USDA)",
    },
    description: {
      sr: "Hranljive vrednosti USDA FoodData Central baze, na 100 g: energija, proteini, masti, "
        + "ugljeni hidrati, vlakna, šećeri i so izračunata iz natrijuma.",
      en: "Nutrient values from USDA FoodData Central, per 100 g: energy, protein, fat, "
        + "carbohydrate, fibre, sugars, and salt computed from sodium.",
    },
    licence: { spdx: "CC0-1.0", attribution: ATTRIBUTION, url: LICENCE_URL },
    source: {
      name: "USDA FoodData Central (Foundation Foods and SR Legacy)",
      url: SOURCE_URL,
    },
    minAppVersion: MIN_APP_VERSION,
  };
}

export async function build() {
  const started = Date.now();
  const source = createSource(PACK_ID);
  const foods = [];
  const dropped = { otherDataType: 0, unnamed: 0, incomplete: 0, noNutrients: 0 };
  const perDataset = [];

  for (const archive of ARCHIVES) {
    const buffer = await source.bytes(archive.url, archive.name);
    const entries = readZip(buffer);
    const result = convertFoods({
      foodCsv: entryNamed(entries, "food.csv").toString("utf8"),
      foodNutrientCsv: entryNamed(entries, "food_nutrient.csv").toString("utf8"),
      nutrientCsv: entryNamed(entries, "nutrient.csv").toString("utf8"),
      dataType: archive.dataType,
    });
    foods.push(...result.foods);
    for (const key of Object.keys(dropped)) dropped[key] += result.dropped[key];
    perDataset.push({ dataset: archive.dataset, foods: result.foods.length, dropped: result.dropped });
  }

  const pack = { layout: 1, foods };
  const folder = packsDir(PACK_ID);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(pack)}\n`, "utf8");
  writeFileSync(join(folder, "foods.json"), bytes);

  const metaPath = `${folder}.meta.json`;
  writeFileSync(metaPath, `${JSON.stringify(metadata(), null, 2)}\n`, "utf8");

  printFetchLog(source.log, bytes.byteLength);
  for (const row of perDataset) {
    console.log(
      `  ${row.dataset}: ${String(row.foods)} foods (dropped ${String(row.dropped.incomplete)} incomplete, `
      + `${String(row.dropped.noNutrients)} with no nutrient rows, ${String(row.dropped.unnamed)} unnamed, `
      + `${String(row.dropped.otherDataType)} rows of another data type)`,
    );
  }
  console.log(
    `  dropped in total: ${String(dropped.incomplete)} without all of energy/protein/fat/carbohydrate, `
    + `${String(dropped.noNutrients)} with no nutrient rows, ${String(dropped.unnamed)} unnamed, `
    + `${String(dropped.otherDataType)} rows of another data type`,
  );
  console.log(`  foods: ${String(foods.length)} across ${String(perDataset.length)} datasets`);
  console.log(`  foods.json: ${String(bytes.byteLength)} B -> ${join(folder, "foods.json")}`);
  console.log(`  metadata: ${metaPath}`);
  console.log(`  took ${String(Date.now() - started)} ms`);
  return { folder, metaPath, foods: foods.length, bytes: bytes.byteLength };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await build();
}
