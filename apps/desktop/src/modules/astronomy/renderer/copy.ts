import { defineModuleCopy } from "../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * The astronomy corner's page copy table.
 *
 * The one line that joins these words to the locale machinery: `defineModuleCopy`
 * returns ONE object whose identity never changes and whose leaves are rewritten
 * in place by the shell's `applyLocale`, so a component that read
 * `copy.solar.scaleTrue` at module scope would freeze the language it loaded in —
 * which is exactly what `check:string-capture` refuses.
 *
 * The id is the MODULE's, and it is the one table under it: the four views
 * register their own words separately (`astronomy-earth`, `astronomy-stars`,
 * `astronomy-sunmoon`), so this file is what the page itself draws and nothing
 * else.
 */
export const copy = defineModuleCopy("astronomy", sr, en);
