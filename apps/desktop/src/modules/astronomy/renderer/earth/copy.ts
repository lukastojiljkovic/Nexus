import { defineModuleCopy } from "../../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * The map's live copy table.
 *
 * The one line that joins these words to the locale machinery: `defineModuleCopy`
 * returns ONE object whose identity never changes and whose leaves are rewritten
 * in place by the shell's `applyLocale`, so a component that took
 * `const c = copy.map` at module scope keeps reading the table being rewritten
 * rather than the language it loaded in.
 *
 * **The id is this component's, not the module's.** The astronomy corner is
 * assembled by a later run, whose page table will be registered under
 * `astronomy`; two tables under one id would silently become one (`defineModuleCopy`
 * returns the first and drops the second), so each of this corner's components
 * registers its own: `astronomy-earth` here and `astronomy-sunmoon` beside the
 * panel.
 */
export const copy = defineModuleCopy("astronomy-earth", sr, en);
