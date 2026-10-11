import { defineModuleCopy } from "../../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * The sentence translator's live copy table.
 *
 * The id is `translator.sentences`, not `translator`: the word-lookup surface of
 * the same module registers its own table under the module's own id, and
 * `defineModuleCopy` answers an already-registered id with the FIRST table it
 * was given. Two surfaces, two ids — otherwise whichever chunk loaded first
 * would hand the other an object with the wrong shape in it.
 *
 * Registering here is what joins these leaves to the locale machinery: from the
 * moment this chunk loads, an interface switch rewrites them in place, exactly
 * as it rewrites the shell's table.
 */
export const copy = defineModuleCopy("translator.sentences", sr, en);
