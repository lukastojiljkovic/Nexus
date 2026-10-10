// The English → Croatian translation pack.
//
//   node scripts/packs/translate-en-hr/build.mjs
//
// THE ONE CHOICE WORTH READING. Mozilla's registry lists two en→hr builds: a
// `base-memory` one marked Release, and the older `tiny` one this pack pins. The
// Release build's model hash is published in the registry but its shortlist and
// vocabulary appear in NO record — the delivery collection carries only the tiny
// build's — so pinning the Release build would mean hashing its shortlist and
// vocabulary against nothing. This builder refuses exactly that (`assertSameBuild`
// in `../translate/lib.mjs` refuses to pair a Release directory with the version
// label the record actually has), so the pack ships the build whose three files
// Mozilla's own record states, and the pack's NOTICE says which one it is. The
// alternative is a pack that ships an unverified model, which this project may
// not do. See `docs/packs/translate-en-hr.md`.

import { fileURLToPath } from "node:url";
import { buildPack } from "../translate/lib.mjs";

await buildPack({
  id: "translate-en-hr",
  pair: "en-hr",
  from: "en",
  to: "hr",
  fromName: "English",
  toName: "Croatian",
  version: "1.0",
  architecture: "tiny",
  dir: "models/en-hr/spring-2024_NcLX56D4SuSpByVVfuAHJQ",
  packVersion: "2026.10.0",
  title: { sr: "Prevod sa engleskog na hrvatski", en: "English to Croatian translation" },
  description: {
    sr: "Mozilin model za prevođenje sa engleskog na hrvatski (verzija 1.0, tiny). Radi bez interneta.",
    en: "Mozilla's English-to-Croatian translation model (version 1.0, tiny). Works offline.",
  },
  builderPath: fileURLToPath(import.meta.url),
});
