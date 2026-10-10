import { defineModuleCopy } from "../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * SKENER's live copy table (ADR-090).
 *
 * `defineModuleCopy` returns ONE object whose identity never changes and whose
 * leaves are rewritten in place by the shell's `applyLocale` - the rule
 * `strings.ts`'s own header explains and `check:string-capture` enforces for
 * both tables. It runs when this chunk loads, which is the first time the page
 * (and this table with it) arrives; before that the module is not in the
 * process at all.
 */
export const copy = defineModuleCopy("scanner", sr, en);
