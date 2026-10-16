/**
 * The figures the drawer's tools compute for the assistant, keyed by the tool's
 * registration id. A tool that has no runner cannot be run from a chat: the
 * drawer's own page is the only place it computes.
 *
 * **One file per category**, so two runs can add categories without touching the
 * same file; a category joins by spreading its map into `TOOL_RUNNERS` below. The
 * shape of a runner and its formatting helpers are in `shared.ts`.
 *
 * A `Map`, not an object: an id such as `constructor` must be a missing entry,
 * never a property the prototype answers.
 */

import type { ToolRunner } from "./shared.js";
import { EVERYDAY_RUNNERS } from "./everyday.js";

export type { ToolRunner } from "./shared.js";

export const TOOL_RUNNERS: ReadonlyMap<string, ToolRunner> = new Map<string, ToolRunner>([
  ...Object.entries(EVERYDAY_RUNNERS),
]);
