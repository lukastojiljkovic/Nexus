import { defineModuleCopy } from "../../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * The Sun-and-Moon panel's live copy table.
 *
 * A component of a module registers its own table under its own name, and the
 * map's `copy.ts` beside this one states why: the astronomy corner is assembled
 * by a later run, whose page table will take the `astronomy` id, and two tables
 * under one id would silently become one.
 */
export const copy = defineModuleCopy("astronomy-sunmoon", sr, en);
