// The English → Bosnian translation pack.
//
//   node scripts/packs/translate-en-bs/build.mjs
//
// Downloads Mozilla's `base-memory` en→bs model (releaseStatus Release), checks
// every file against Mozilla's own record, and writes the pack folder plus the
// metadata file `scripts/pack-sign.mjs --meta` takes — both under `%TEMP%`. See
// `../translate/lib.mjs` for the hash rules.

import { fileURLToPath } from "node:url";
import { buildPack } from "../translate/lib.mjs";

await buildPack({
  id: "translate-en-bs",
  pair: "en-bs",
  from: "en",
  to: "bs",
  fromName: "English",
  toName: "Bosnian",
  version: "2.0",
  architecture: "base-memory",
  dir: "models/en-bs/hbs-topk10_HBBkp2ozSYaY9f7WVGRtpA",
  packVersion: "2026.10.0",
  title: { sr: "Prevod sa engleskog na bosanski", en: "English to Bosnian translation" },
  description: {
    sr: "Mozilin model za prevođenje sa engleskog na bosanski (verzija 2.0, base-memory). Radi bez interneta.",
    en: "Mozilla's English-to-Bosnian translation model (version 2.0, base-memory). Works offline.",
  },
  builderPath: fileURLToPath(import.meta.url),
});
