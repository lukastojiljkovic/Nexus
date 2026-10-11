import { defineModuleCopy } from "../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * COOKBOOK's live copy table (ADR-090).
 *
 * This one line is what joins the module's copy to the locale machinery:
 * `defineModuleCopy` returns ONE object whose identity never changes and whose
 * leaves are rewritten in place by the shell's `applyLocale` — the same rule the
 * shell's own `strings` table follows, and for the same reason. A component that
 * read `copy.detail.title` into a module-scope constant would freeze one
 * language forever, which is the defect `check:string-capture` exists to catch;
 * every read here happens at call time.
 */
export const copy = defineModuleCopy("cookbook", sr, en);
