/**
 * NLLB on a REAL pack folder, skipped by default: no CI machine has one, and a
 * load takes seconds to minutes. Point it at a built pack to run it:
 *
 *     $env:NEXUS_NLLB_DIR = "$HOME\.nexus-packs\nllb-3.3b"
 *     node ../../node_modules/vitest/vitest.mjs run src/modules/translator/main/nllb/inference.slow.test.ts
 *
 * It proves what the unit tests cannot: that the pack's files load with the
 * options `inference.ts` derives from them (the 3.3B decoder's weights in two
 * files among them), and that a sentence comes back in the target language.
 */

import { describe, expect, it } from "vitest";

import { loadTranslator } from "./inference.js";

const DIRECTORY = process.env["NEXUS_NLLB_DIR"];

describe.skipIf(DIRECTORY === undefined)("NLLB on a real pack", () => {
  it("translates a Serbian sentence into English and an English one into German", async () => {
    const translator = await loadTranslator(DIRECTORY ?? "");
    const english = await translator.translate("Где је најближа апотека?", "srp_Cyrl", "eng_Latn");
    const german = await translator.translate("The weather is nice today.", "eng_Latn", "deu_Latn");
    console.log(JSON.stringify({ english, german }));
    expect(english.toLowerCase()).toContain("pharmacy");
    expect(german.toLowerCase()).toContain("wetter");
  }, 600_000);
});
