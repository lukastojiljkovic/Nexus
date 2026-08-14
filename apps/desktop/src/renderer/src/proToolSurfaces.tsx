import type { ComponentType } from "react";

import { NUMBERS_SURFACES } from "./devtools/numbers.js";
import { RISCV_SURFACES } from "./devtools/riscv.js";
import { ENCODING_SURFACES } from "./devtools/encoding.js";
import { DATA_SURFACES } from "./devtools/data.js";
import { TEXT_SURFACES } from "./devtools/text.js";
import { DESIGN_SURFACES } from "./devtools/design.js";
import { CRYPTO_SURFACES } from "./devtools/crypto.js";
import { SYSTEM_SURFACES } from "./devtools/system.js";
import { TIME_SURFACES } from "./devtools/time.js";
import { GRADNJA_SURFACES } from "./pro/gradnja.js";
import { INZENJERING_SURFACES } from "./pro/inzenjering.js";
import { DIZAJN_SURFACES } from "./pro/dizajn.js";
import { FOTO_SURFACES } from "./pro/foto.js";
import { MUZIKA_SURFACES } from "./pro/muzika.js";
import { PROSVETA_SURFACES } from "./pro/prosveta.js";
import { TEKST_SURFACES } from "./pro/tekst.js";
import { TRENING_SURFACES } from "./pro/trening.js";
import { KUHINJA_SURFACES } from "./pro/kuhinja.js";
import { PRAVO_SURFACES } from "./pro/pravo.js";
import { RACUNOVODSTVO_SURFACES } from "./pro/racunovodstvo.js";
import { BIZNIS_SURFACES } from "./pro/biznis.js";
import { NEKRETNINE_SURFACES } from "./pro/nekretnine.js";
import { TRANSPORT_SURFACES } from "./pro/transport.js";
import { AGRO_SURFACES } from "./pro/agro.js";
import { ZANAT_SURFACES } from "./pro/zanat.js";
import { EVENT_SURFACES } from "./pro/event.js";

/**
 * Every „Stručne alatke" surface, by tool id — the renderer half of the
 * `ToolRegistration` contract, and the professional drawer's answer to
 * `TOOL_SURFACES`.
 *
 * **Composed from per-category files, never written here.** The map is the one
 * place every new tool must appear, so a single flat file would be both the
 * bottleneck and the merge conflict; splitting it by category means adding a
 * tool touches its own category's file and this one not at all.
 *
 * **The nine `devtools/` files are the developer PACK's tools and keep that
 * name.** The drawer stopped being „Programerske alatke" when the other
 * professions arrived, but those files did not stop being the developer
 * toolkit — renaming them would have said the tools changed, and only their
 * neighbours did.
 *
 * **A separate map from `TOOL_SURFACES` on purpose.** The drawers are routed by
 * `toolDrawer`, so one merged map would still render correctly — and would also
 * mean the everyday drawer's bundle pulls in a RISC-V assembler, a QR encoder
 * and a Reed-Solomon field for a profile that has the professional module
 * switched off. Two maps keep that cost with the module that incurs it.
 */
export const PRO_TOOL_SURFACES: Readonly<Record<string, ComponentType>> = {
  ...NUMBERS_SURFACES,
  ...RISCV_SURFACES,
  ...ENCODING_SURFACES,
  ...DATA_SURFACES,
  ...TEXT_SURFACES,
  ...DESIGN_SURFACES,
  ...CRYPTO_SURFACES,
  ...SYSTEM_SURFACES,
  ...TIME_SURFACES,
  // The professional toolkits, one file each — see the header on why these are
  // named after the PACK while the nine above are named after a category.
  ...GRADNJA_SURFACES,
  ...INZENJERING_SURFACES,
  ...DIZAJN_SURFACES,
  ...FOTO_SURFACES,
  ...MUZIKA_SURFACES,
  ...PROSVETA_SURFACES,
  ...TEKST_SURFACES,
  ...TRENING_SURFACES,
  ...KUHINJA_SURFACES,
  ...PRAVO_SURFACES,
  ...RACUNOVODSTVO_SURFACES,
  ...BIZNIS_SURFACES,
  ...NEKRETNINE_SURFACES,
  ...TRANSPORT_SURFACES,
  ...AGRO_SURFACES,
  ...ZANAT_SURFACES,
  ...EVENT_SURFACES,
};
