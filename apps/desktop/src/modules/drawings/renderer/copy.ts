import { defineModuleCopy } from "../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * DRAWINGS' live copy table (ADR-090): one object whose identity never changes
 * and whose leaves `applyLocale` rewrites in place, registered the moment this
 * module's chunk loads. The import path is the kit's convention and is how
 * `check:string-capture` and `check:copy` find this table at all.
 */
export const copy = defineModuleCopy("drawings", sr, en);
