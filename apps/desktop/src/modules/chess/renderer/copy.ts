import { defineModuleCopy } from "../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * CHESS' live copy table (ADR-090).
 *
 * One line, and it is what joins the module's copy to the locale machinery:
 * `defineModuleCopy` returns one object whose identity never changes and whose
 * leaves are rewritten in place by the shell's `applyLocale`, so a component
 * that read `copy.board.title` at module scope keeps reading the section being
 * rewritten rather than the language that was active when the chunk loaded.
 *
 * It runs when this chunk loads — when the module's page and this table first
 * arrive — and from that moment the module's words follow the interface.
 */
export const copy = defineModuleCopy("chess", sr, en);
