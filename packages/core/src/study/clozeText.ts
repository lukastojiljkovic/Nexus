/**
 * The `{{…}}` cloze grammar, and the rendering of one deletion into plain
 * front/back text (STUDY-006 / ADR-042).
 *
 * This module is the SINGLE source of that grammar. It was private to
 * `notes/noteCards.ts` while a cloze card existed only as a note's by-product;
 * a first-class cloze card has four independent readers, and two of them are
 * nowhere near a note:
 *
 *   - the editor's decoration plugin (`noteFlashcard.ts`, via `parseCardBlock`),
 *   - the note-card generator (`collectNoteCards`),
 *   - `CardStore`, which RE-DERIVES a cloze row's stored `front`/`back` from
 *     `(cloze_text, cloze_ordinal)` on every write, and
 *   - the reviewer, which shows the blank in context and then the answer in
 *     its place (`splitClozeSegments`).
 *
 * They must never disagree about what a deletion is, so `noteCards.ts` imports
 * these back rather than keeping a second copy.
 *
 * Pure and platform-neutral: strings in, strings out, no clock, no IO.
 */

/** A `{{…}}` run; `[^{}]*` both bans nesting and lets a run's own inner text decide if it is empty. */
const CLOZE_RUN = /\{\{([^{}]*)\}\}/g;

/**
 * What a masked deletion renders as in derived text. A literal, stable token:
 * it is written into `cards.front`, so it is also what the search index, the
 * palette snippet, the deck list row and the CSV export all show for a cloze
 * card — changing it would silently rewrite every one of them.
 */
export const CLOZE_MASK = "[…]";

/** One `{{…}}` run whose inner text is non-empty after trimming — a cloze deletion, as half-open offsets. */
export interface ClozeRun {
  start: number;
  end: number;
  inner: string;
}

/**
 * Every non-overlapping `{{…}}` run with non-empty (trimmed) inner text, in
 * left-to-right order — the deletions of this text, and their ordinals by
 * position. A run whose inner text is empty or whitespace-only (`{{}}`,
 * `{{ }}`) is not a deletion: it is ignored, exactly as if it were not there,
 * rather than rendered as an empty hidden slot.
 */
export function findClozeRuns(text: string): ClozeRun[] {
  const runs: ClozeRun[] = [];
  for (const match of text.matchAll(CLOZE_RUN)) {
    if (match.index === undefined) continue; // matchAll always sets it; guard keeps strict mode happy
    const inner = match[1] ?? "";
    if (inner.trim().length === 0) continue;
    runs.push({ start: match.index, end: match.index + match[0].length, inner });
  }
  return runs;
}

/**
 * Rebuilds one side of a cloze card: the `target`-th run (0-based) is replaced
 * by `CLOZE_MASK` (Anki's "hide only this one" behaviour), every other run is
 * unwrapped to its own inner text. `target: null` unwraps every run — the one
 * back all of a text's cloze cards share.
 */
export function renderClozeSide(
  text: string,
  runs: readonly ClozeRun[],
  target: number | null,
): string {
  let result = "";
  let cursor = 0;
  runs.forEach((run, index) => {
    result += text.slice(cursor, run.start);
    result += index === target ? CLOZE_MASK : run.inner;
    cursor = run.end;
  });
  return result + text.slice(cursor);
}

/**
 * The ONE helper a cloze card's stored sides are derived by: the masked front
 * and the fully-unwrapped back of the `ordinal`-th deletion of `text`, both
 * trimmed exactly as the note generator has always trimmed them.
 *
 * `null` when `ordinal` names no deletion in `text` — including a negative or
 * fractional ordinal. That answer is load-bearing, not defensive: it is how
 * `CardStore.update` refuses an edit that would delete the very deletion the
 * row asks about, and how the archive parser rejects a cloze row whose ordinal
 * its own template does not contain.
 */
export function renderClozeCard(
  text: string,
  ordinal: number,
): { front: string; back: string } | null {
  const runs = findClozeRuns(text);
  if (runs[ordinal] === undefined) return null;
  return {
    front: renderClozeSide(text, runs, ordinal).trim(),
    back: renderClozeSide(text, runs, null).trim(),
  };
}

/**
 * One piece of a cloze line: ordinary text, or the single deletion this card
 * asks about, carrying its answer.
 */
export type ClozeSegment =
  | { kind: "text"; value: string }
  | { kind: "target"; value: string };

/**
 * The `ordinal`-th deletion's line, split so a renderer can show the blank and
 * the answer IN THE SAME PLACE: every other run is already unwrapped into the
 * surrounding `text` segments, and the one `target` segment carries the answer
 * for the caller to render either as a blank chip (before reveal) or as the
 * answer itself (after). Empty text segments are dropped rather than emitted.
 *
 * `null` when `ordinal` names no deletion — the caller falls back to the row's
 * stored `front`/`back`, which are plain strings and always renderable.
 */
export function splitClozeSegments(text: string, ordinal: number): ClozeSegment[] | null {
  const runs = findClozeRuns(text);
  const target = runs[ordinal];
  if (target === undefined) return null;

  const segments: ClozeSegment[] = [];
  const push = (value: string): void => {
    if (value.length > 0) segments.push({ kind: "text", value });
  };

  // Everything before the target, with its own runs unwrapped, is one text
  // segment; likewise everything after. Slicing the ALREADY-rendered sides
  // would need offsets the mask has shifted, so both halves are rebuilt from
  // the runs directly — the same walk `renderClozeSide` does.
  const before = runs.filter((run) => run.end <= target.start);
  const after = runs.filter((run) => run.start >= target.end);
  push(renderClozeSide(text.slice(0, target.start), before, null));
  segments.push({ kind: "target", value: target.inner });
  push(
    renderClozeSide(
      text.slice(target.end),
      after.map((run) => ({ ...run, start: run.start - target.end, end: run.end - target.end })),
      null,
    ),
  );

  return segments;
}
