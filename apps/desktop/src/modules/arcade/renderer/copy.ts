import { defineModuleCopy } from "../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * ARCADE's live copy table (ADR-090).
 *
 * **This one line joins the module's copy to the locale machinery.** `defineModuleCopy`
 * returns ONE object whose identity never changes and whose leaves are rewritten
 * in place by the shell's `applyLocale` - the same rule `strings.ts` follows for
 * the shell's own table, and for the same reason: a component that took
 * `const c = copy.stats` at module scope would keep reading the section being
 * rewritten, where a swapped object would leave it in the old language forever.
 *
 * `copy.sr.ts` is the shape's source of truth and `copy.en.ts` is typed by it, so
 * the two cannot drift; a call site says `copy.status.score` and never names a
 * locale.
 */
export const copy = defineModuleCopy("arcade", sr, en);
