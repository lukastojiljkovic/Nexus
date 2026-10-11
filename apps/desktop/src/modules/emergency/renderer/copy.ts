import { defineModuleCopy } from "../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * EMERGENCY's live copy table (ADR-090).
 *
 * One line, and it is what joins this module's copy to the locale machinery:
 * `defineModuleCopy` returns ONE object whose identity never changes and whose
 * leaves are rewritten in place by the shell's `applyLocale`, so a component that
 * took `const c = copy.form` at module scope would keep reading the section being
 * rewritten - which is why nothing here does (the reads are all inside the
 * functions that use them, and `check:string-capture` is what watches for one
 * that is not).
 *
 * It runs when this chunk loads, which is when the page first arrives; before
 * that, none of these words is in the process at all.
 */
export const copy = defineModuleCopy("emergency", sr, en);
