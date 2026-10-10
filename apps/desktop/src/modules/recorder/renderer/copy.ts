import { defineModuleCopy } from "../../../renderer/src/strings.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * The RECORDER's live copy table (ADR-090).
 *
 * One object whose identity never changes, its leaves rewritten in place by the
 * shell's `applyLocale` — the same rule `strings.ts` follows for its own table,
 * and for the same reason: a component that took `const c = copy.list` at module
 * scope keeps reading the section being rewritten, where a swapped object would
 * leave it pointing at the old language forever.
 *
 * It runs when this chunk loads, which is when the module's page — and this
 * table with it — first arrives. `copy.sr.ts` is the shape's source of truth and
 * `copy.en.ts` is typed by it, so the two cannot drift, and a call site says
 * `copy.list.title` and never names a locale.
 */
export const copy = defineModuleCopy("recorder", sr, en);
