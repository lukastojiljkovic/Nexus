import { defineModuleCopy } from "../../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * The star map's live copy table.
 *
 * **This one line is what joins the map's words to the locale machinery**, and
 * it is the same line TIMERS' `copy.ts` writes: `defineModuleCopy` returns ONE
 * object whose identity never changes and whose leaves are rewritten in place
 * by the shell's `applyLocale`, so a component that read `copy.search.label` at
 * module scope would freeze the language it was loaded in - which is exactly
 * what `check:string-capture` refuses.
 *
 * It runs when this module's chunk loads, which is when the star map's page
 * first arrives.
 */
export const copy = defineModuleCopy("astronomy-stars", sr, en);
