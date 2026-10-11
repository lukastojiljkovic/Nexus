import { defineModuleCopy } from "../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * ASISTENT's live copy table (ADR-090).
 *
 * **This one line is what joins the module's copy to the locale machinery.**
 * `defineModuleCopy` returns ONE object whose identity never changes and whose
 * leaves are rewritten in place by the shell's `applyLocale` — the same rule
 * `strings.ts` follows, and for the same reason: a component that took
 * `const c = copy.thread` at module scope keeps reading the section being
 * rewritten, where a swapped object would leave it pointing at the old language
 * forever.
 *
 * It runs when this chunk loads, which is when the module's page first arrives.
 */
export const copy = defineModuleCopy("assistant", sr, en);
