import type { PuzzleId } from "../shared/ipc.js";

/** A puzzle the assistant asked this page to open: the puzzle, its grade, and whether the saved game is to be discarded first. */
export interface OpenRequest {
  readonly puzzle: PuzzleId;
  readonly variant: string;
  readonly fresh: boolean;
}

/**
 * The payload `puzzles.start` sends, read back by the page. The grades come from the
 * view (the store's own list), so a grade this build does not have is refused here as
 * it is in the tool. Null for anything else, which the page reports handled anyway.
 */
export function openRequestOf(
  payload: unknown,
  variants: Readonly<Record<PuzzleId, readonly string[]>>,
): OpenRequest | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { puzzle, variant, fresh } = payload as Record<string, unknown>;
  const id = (Object.keys(variants) as PuzzleId[]).find((candidate) => candidate === puzzle);
  if (id === undefined || typeof variant !== "string" || !variants[id].includes(variant)) return null;
  if (fresh !== undefined && typeof fresh !== "boolean") return null;
  return { puzzle: id, variant, fresh: fresh === true };
}
