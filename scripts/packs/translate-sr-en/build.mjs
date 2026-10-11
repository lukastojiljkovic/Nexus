// The Serbian → English translation pack.
//
//   node scripts/packs/translate-sr-en/build.mjs
//
// Downloads Mozilla's `tiny` sr→en model, checks every file against Mozilla's
// own record, and writes the pack folder plus the metadata file
// `scripts/pack-sign.mjs --meta` takes — both under `%TEMP%`, never in the
// repository. Re-running verifies the cache instead of downloading it again.
// The model's object directory is pinned, so the pack cannot silently become a
// different build of the same pair; see `../translate/lib.mjs`.

import { fileURLToPath } from "node:url";
import { buildPack } from "../translate/lib.mjs";

await buildPack({
  id: "translate-sr-en",
  pair: "sr-en",
  from: "sr",
  to: "en",
  fromName: "Serbian",
  toName: "English",
  // The registry's sr-en entry: `tiny`, releaseStatus null, evaluated on
  // flores200-plus at BLEU 36.6054 / chrF2 64.7233 / COMET22 0.8501.
  version: "1.0",
  architecture: "tiny",
  dir: "models/sr-en/spring-2024_H5GCfsx4SnqOP4YFIQdkdA",
  packVersion: "2026.10.0",
  title: { sr: "Prevod sa srpskog na engleski", en: "Serbian to English translation" },
  description: {
    sr: "Mozilin model za prevođenje sa srpskog na engleski (verzija 1.0, tiny). Radi bez interneta.",
    en: "Mozilla's Serbian-to-English translation model (version 1.0, tiny). Works offline.",
  },
  builderPath: fileURLToPath(import.meta.url),
});
