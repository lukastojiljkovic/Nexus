import { defineModuleCopy } from "../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * RADIONICA's live copy table (ADR-090): one object whose identity never changes
 * and whose leaves are rewritten in place when the language switches, so a
 * component that took a subtree alias keeps reading the section being
 * rewritten. It registers with the locale machinery when this chunk loads -
 * which is when somebody first opens the module - and it is not in the process
 * before that.
 */
export const copy = defineModuleCopy("workshop", sr, en);
