import { defineModuleCopy } from "../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * TIMERS' live copy table (ADR-090).
 *
 * **This one line is what joins the module's copy to the locale machinery.**
 * `defineModuleCopy` returns ONE object whose identity never changes and whose
 * leaves are rewritten in place by the shell's `applyLocale` — the same rule
 * `strings.ts` follows for the shell's own table, and for the same reason: a
 * component that took `const c = copy.countdowns` at module scope keeps reading
 * the section being rewritten, where a swapped object would leave it pointing at
 * the old language forever.
 *
 * It runs when this chunk loads, which is when the module's page - and this
 * table with it - first arrives; from that moment the module's words follow the
 * interface, and before that they are not in the process at all.
 *
 * `copy.sr.ts` is the shape's source of truth and `copy.en.ts` is typed by it,
 * so the two cannot drift; the call site says `copy.page.subtitle` and never
 * names a locale.
 */
export const copy = defineModuleCopy("timers", sr, en);
