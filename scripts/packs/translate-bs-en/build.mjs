// The Bosnian → English translation pack.
//
//   node scripts/packs/translate-bs-en/build.mjs
//
// WHY THIS PINS `hbs-en`. Mozilla's registry calls the released Bosnian→English
// build `hbs-en` — the macrolanguage code — and its objects are
// `model.hbsen.*` / `lex.50.50.hbsen.*` / `vocab.hbsen.spm`, while the delivery
// collection records the same three files under `bs`. The pair key and the
// record's language code therefore differ, and the builder checks the hash that
// proves they are one build. The `bs-en` tiny entry (releaseStatus Nightly) is
// deliberately NOT shipped: the released build is the one Mozilla delivers, and
// it is the larger `base-memory` model. See `docs/packs/translate-bs-en.md`.

import { fileURLToPath } from "node:url";
import { buildPack } from "../translate/lib.mjs";

await buildPack({
  id: "translate-bs-en",
  pair: "hbs-en",
  from: "bs",
  to: "en",
  fromName: "Bosnian",
  toName: "English",
  version: "2.0",
  architecture: "base-memory",
  dir: "models/hbs-en/hbs_d85wHYN_SUmGIqekvLSNjA",
  packVersion: "2026.10.0",
  title: { sr: "Prevod sa bosanskog na engleski", en: "Bosnian to English translation" },
  description: {
    sr: "Mozilin model za prevođenje sa bosanskog na engleski (verzija 2.0, base-memory). Radi bez interneta.",
    en: "Mozilla's Bosnian-to-English translation model (version 2.0, base-memory). Works offline.",
  },
  builderPath: fileURLToPath(import.meta.url),
});
