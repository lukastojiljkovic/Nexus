import { defineModuleCopy } from "../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * CAR's live copy table (ADR-090).
 *
 * `defineModuleCopy` returns ONE object whose identity never changes and whose
 * leaves are rewritten in place by the shell's `applyLocale` -- the same rule
 * `strings.ts` follows for the shell's own table, and for the same reason: a
 * component that took `const c = copy.due` at module scope would keep reading
 * the section being rewritten while a swapped object would leave it pointing at
 * the old language forever.
 *
 * It runs when this chunk loads, which is when the module's page -- and this
 * table with it -- first arrives.
 */
export const copy = defineModuleCopy("car", sr, en);
