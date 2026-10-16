/**
 * A reading goal: how many works a person means to finish in a year, for every
 * kind together or for one kind.
 *
 * **Progress is not stored.** A goal is a target and a scope; how far it has got
 * is `libraryYearStats`' own count for the year, read off the passes' finished
 * days (see `stats.ts`). A stored counter would drift the first time a pass was
 * edited or deleted, and the report already answers the question from the rows.
 */

import { LIBRARY_KINDS, type LibraryKind } from "./item.js";
import type { LibraryYearStats } from "./stats.js";

/** The smallest target: one work a year. */
export const LIBRARY_MIN_GOAL_TARGET = 1;

/**
 * The largest target. A policy bound, not a measurement: it keeps a typo (`10000`
 * for `100`) from becoming a goal nobody can reach or read at a glance.
 */
export const LIBRARY_MAX_GOAL_TARGET = 1000;

export interface LibraryGoal {
  readonly id: string;
  /** The kind the goal counts, or null for a goal over every kind. */
  readonly kind: LibraryKind | null;
  readonly target: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LibraryGoalProgress {
  /** Finished works in the year, of the goal's kind (or of every kind). May exceed the target. */
  readonly done: number;
  readonly target: number;
}

/** A whole number between `LIBRARY_MIN_GOAL_TARGET` and `LIBRARY_MAX_GOAL_TARGET`, inclusive. */
export function isLibraryGoalTarget(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= LIBRARY_MIN_GOAL_TARGET &&
    value <= LIBRARY_MAX_GOAL_TARGET
  );
}

/** How far a goal has got in the year `stats` describes. */
export function libraryGoalProgress(
  goal: Pick<LibraryGoal, "kind" | "target">,
  stats: LibraryYearStats,
): LibraryGoalProgress {
  const done =
    goal.kind === null
      ? LIBRARY_KINDS.reduce((sum, kind) => sum + stats.finished[kind], 0)
      : stats.finished[goal.kind];
  return { done, target: goal.target };
}
