import { defineModuleCopy } from "../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * MINI-APPS' live copy table (ADR-090).
 *
 * **This one line is what joins the module's copy to the locale machinery.**
 * `defineModuleCopy` returns ONE object whose identity never changes and whose
 * leaves are rewritten in place by the shell's `applyLocale`, so a component
 * that took `copy.dice` at module scope keeps reading the section being
 * rewritten. It runs when this chunk loads - which is when the module's page
 * first arrives - and before that the module's words are not in the process at
 * all.
 *
 * `copy.sr.ts` is the shape's source of truth and `copy.en.ts` is typed by it,
 * so the two cannot drift; the call site says `copy.dice.roll` and never names
 * a locale.
 */
export const copy = defineModuleCopy("miniapps", sr, en);
