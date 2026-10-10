// The English → Serbian translation pack.
//
//   node scripts/packs/translate-en-sr/build.mjs
//
// Downloads Mozilla's `base-memory` en→sr model (releaseStatus Release),
// checks every file against Mozilla's own record, and writes the pack folder
// plus the metadata file `scripts/pack-sign.mjs --meta` takes — both under
// `%TEMP%`. See `../translate/lib.mjs` for the hash rules.

import { fileURLToPath } from "node:url";
import { buildPack } from "../translate/lib.mjs";

await buildPack({
  id: "translate-en-sr",
  pair: "en-sr",
  from: "en",
  to: "sr",
  fromName: "English",
  toName: "Serbian",
  // The registry's en-sr entry: `base-memory`, Release; flores200-plus BLEU
  // 36.9971 / chrF2 63.9165 / COMET22 0.885.
  version: "2.0",
  architecture: "base-memory",
  dir: "models/en-sr/hbs-topk10_KZK68xhrQWWeK6xcMRtd9A",
  packVersion: "2026.10.0",
  title: { sr: "Prevod sa engleskog na srpski", en: "English to Serbian translation" },
  description: {
    sr: "Mozilin model za prevođenje sa engleskog na srpski (verzija 2.0, base-memory). Radi bez interneta.",
    en: "Mozilla's English-to-Serbian translation model (version 2.0, base-memory). Works offline.",
  },
  builderPath: fileURLToPath(import.meta.url),
});
