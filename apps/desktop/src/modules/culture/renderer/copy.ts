import { defineModuleCopy } from "../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * CULTURE's live copy table (ADR-090).
 *
 * **This one line is what joins the module's copy to the locale machinery.**
 * `defineModuleCopy` returns ONE object whose identity never changes and whose
 * leaves are rewritten in place by the shell's `applyLocale` - the same rule
 * `strings.ts` follows for the shell's own table, and for the same reason: a
 * component that took `const c = copy.visits` at module scope keeps reading the
 * section being rewritten, where a swapped object would leave it pointing at
 * the old language forever.
 *
 * The import of the live table as `./copy.js` is load-bearing:
 * `check:string-capture` recognises a module-scope read of a live table by that
 * path, so a table handed out of another file would be invisible to the gate.
 */
export const copy = defineModuleCopy("culture", sr, en);
