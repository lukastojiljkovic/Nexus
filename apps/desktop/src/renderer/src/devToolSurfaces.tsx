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

/**
 * Every „Programerske alatke" surface, by tool id — the renderer half of the
 * `ToolRegistration` contract, and the developer drawer's answer to
 * `TOOL_SURFACES`.
 *
 * **Composed from nine per-category files, never written here.** The map is the
 * one place every new tool must appear, so a single flat file would be both the
 * bottleneck and the merge conflict; splitting it by category means adding a
 * tool touches its own category's file and this one not at all.
 *
 * **A separate map from `TOOL_SURFACES` on purpose.** The two drawers are routed
 * by `TOOL_CATEGORY_DRAWER`, so one merged map would still render correctly —
 * and would also mean the everyday drawer's bundle pulls in a RISC-V assembler,
 * a QR encoder and a Reed-Solomon field for a profile that has the developer
 * module switched off. Two maps keep that cost with the module that incurs it.
 */
export const DEV_TOOL_SURFACES: Readonly<Record<string, ComponentType>> = {
  ...NUMBERS_SURFACES,
  ...RISCV_SURFACES,
  ...ENCODING_SURFACES,
  ...DATA_SURFACES,
  ...TEXT_SURFACES,
  ...DESIGN_SURFACES,
  ...CRYPTO_SURFACES,
  ...SYSTEM_SURFACES,
  ...TIME_SURFACES,
};
