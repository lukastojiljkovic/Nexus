import { defineModuleCopy } from "../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * TRANSLATOR's live copy table (ADR-090).
 *
 * **This one line joins the module's copy to the locale machinery.**
 * `defineModuleCopy` returns ONE object whose identity never changes and whose
 * leaves are rewritten in place by the shell's `applyLocale` — the rule
 * `strings.ts` follows for the shell's own table, and for the same reason: a
 * component that took `const c = copy.search` at module scope would keep reading
 * a section that no longer moves with the interface.
 *
 * It runs when this chunk loads, which is when the page — and this table with it
 * — first arrives. The import path matters: `check:string-capture` recognises a
 * module-scope read of a live table by this import.
 */
export const copy = defineModuleCopy("translator", sr, en);
