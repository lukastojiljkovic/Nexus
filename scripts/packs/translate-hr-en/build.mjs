// The Croatian → English translation pack.
//
//   node scripts/packs/translate-hr-en/build.mjs
//
// Downloads Mozilla's `tiny` hr→en model, checks every file against Mozilla's
// own record, and writes the pack folder plus the metadata file
// `scripts/pack-sign.mjs --meta` takes — both under `%TEMP%`. See
// `../translate/lib.mjs` for the hash rules.

import { fileURLToPath } from "node:url";
import { buildPack } from "../translate/lib.mjs";

await buildPack({
  id: "translate-hr-en",
  pair: "hr-en",
  from: "hr",
  to: "en",
  fromName: "Croatian",
  toName: "English",
  // The registry's hr-en entry: `tiny`, releaseStatus null (it is the only
  // build Mozilla lists for the pair); BLEU 33.8937 / chrF2 61.3825.
  version: "1.0",
  architecture: "tiny",
  dir: "models/hr-en/spring-2024_eIcYjCedS26HE07kVyt5Qw",
  packVersion: "2026.10.0",
  title: { sr: "Prevod sa hrvatskog na engleski", en: "Croatian to English translation" },
  description: {
    sr: "Mozilin model za prevođenje sa hrvatskog na engleski (verzija 1.0, tiny). Radi bez interneta.",
    en: "Mozilla's Croatian-to-English translation model (version 1.0, tiny). Works offline.",
  },
  builderPath: fileURLToPath(import.meta.url),
});
