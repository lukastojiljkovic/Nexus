import { foldSearchText, foldWithOffsets } from "@nexus/core";

/**
 * The pure half of „Pronađi u belešci" (NOTE-005): finding a query inside one
 * open note, and planning what „Zameni sve" must do about it. Nothing here
 * knows about ProseMirror — it takes plain text plus the position array a
 * textblock walk produces, and answers in document positions.
 *
 * The Serbian side is not this module's invention: matching folds through
 * `@nexus/core`'s `foldWithOffsets`, the very function the global search index
 * (ADR-021 / SRCH-002) folds every document and every query with. That is what
 * makes „Đorđe", „djordje" and „Ђорђе" one string here for exactly the same
 * reason they are one string there — one folding table, one set of rules, and
 * no second dialect of "Serbian-aware" to keep in step.
 *
 * Folding is inherently lossy and inherently lower-casing, so it answers only
 * the INSENSITIVE half of the „Aa" toggle. Turning „Aa" on means literal
 * matching: exact case, exact diacritics, exact script. Said plainly because it
 * is a real consequence rather than an oversight — a user who asks to tell
 * „nexus" from „Nexus" is asking for the string as written, and folding „Đ"
 * onto „dj" while refusing to fold „N" onto „n" would be an incoherent middle.
 */

/** One textblock's own text, plus where each of its UTF-16 units lives in the document. */
export interface NoteFindBlock {
  readonly text: string;
  /**
   * `positions[i]` is the document position of `text[i]` — same length as
   * `text`. Inline atoms (wiki-links, attachment images) contribute no text but
   * do occupy positions, so a block containing one has a GAP here; see
   * `toDocRange` for what this module does about that.
   */
  readonly positions: readonly number[];
}

/** A match as a half-open document range, exactly what a decoration or a replacement needs. */
export interface NoteFindMatch {
  readonly from: number;
  readonly to: number;
}

/** A half-open `[start, end)` range of one block's own text. */
interface SourceRange {
  readonly start: number;
  readonly end: number;
}

/** Literal, non-overlapping occurrences of `query` in `text` — the „Aa"-on path. */
function exactRanges(text: string, query: string): SourceRange[] {
  const found: SourceRange[] = [];
  let fromIndex = 0;
  for (;;) {
    const index = text.indexOf(query, fromIndex);
    if (index === -1) return found;
    found.push({ start: index, end: index + query.length });
    fromIndex = index + query.length; // matches never overlap
  }
}

/**
 * Where the source character that produced `folded[foldedEnd - 1]` ends.
 *
 * Usually just `offsets[foldedEnd]`, but a folded match can stop in the MIDDLE
 * of an expansion — „đ" folds to two characters, so querying „d" hits only the
 * first of them. There is no such thing as half of a „đ" in the document, so
 * the range snaps outward to the whole source character: walk forward to the
 * first offset that names a later source character, and take that. Running off
 * the end means the match reached the end of the text.
 */
function sourceEndOf(offsets: readonly number[], foldedEnd: number, textLength: number): number {
  const lastSource = offsets[foldedEnd - 1];
  if (lastSource === undefined) return textLength;
  for (let index = foldedEnd; index < offsets.length; index += 1) {
    const value = offsets[index];
    if (value !== undefined && value > lastSource) return value;
  }
  return textLength;
}

/** Folded, non-overlapping occurrences of `query` in `text` — the default path. */
function foldedRanges(text: string, query: string): SourceRange[] {
  const needle = foldSearchText(query);
  // A query that folds away entirely (a lone combining mark) must match
  // nothing rather than degenerate into an empty needle matching everywhere.
  if (needle.length === 0) return [];

  const { folded, offsets } = foldWithOffsets(text);
  const found: SourceRange[] = [];
  let fromIndex = 0;
  for (;;) {
    const index = folded.indexOf(needle, fromIndex);
    if (index === -1) return found;
    const start = offsets[index];
    if (start === undefined) return found; // unreachable: index < folded.length
    found.push({ start, end: sourceEndOf(offsets, index + needle.length, text.length) });
    fromIndex = index + needle.length;
  }
}

/**
 * A block-local range as a document range, or `null` when it cannot honestly be
 * one. The positions of a run of text are consecutive, so a range whose span in
 * `positions` is wider than its length in characters is a range that steps over
 * an inline atom — a wiki-link or an attachment image sitting between the two
 * halves of what looked like one word. Such a match is dropped rather than
 * decorated: highlighting it would draw over the atom, and replacing it would
 * delete the atom outright.
 */
function toDocRange(block: NoteFindBlock, range: SourceRange): NoteFindMatch | null {
  const from = block.positions[range.start];
  const last = block.positions[range.end - 1];
  if (from === undefined || last === undefined) return null;
  if (last - from !== range.end - range.start - 1) return null;
  return { from, to: last + 1 };
}

/**
 * Every match of `query` across the given blocks, in document order. An empty
 * query matches nothing — the find bar's own resting state, not a wildcard.
 */
export function findNoteMatches(
  blocks: readonly NoteFindBlock[],
  query: string,
  caseSensitive: boolean,
): NoteFindMatch[] {
  if (query.length === 0) return [];
  const matches: NoteFindMatch[] = [];
  for (const block of blocks) {
    const found = caseSensitive ? exactRanges(block.text, query) : foldedRanges(block.text, query);
    for (const range of found) {
      const match = toDocRange(block, range);
      if (match !== null) matches.push(match);
    }
  }
  return matches;
}

/**
 * Which match should become active given a document position: the first one
 * starting at or after it, wrapping round to the first when the position is
 * past them all. Used both when the query changes (anchored on the caret, so
 * the first hit found is the one nearest what the user was reading) and after
 * an edit (anchored on where the previously active match ended up).
 */
export function matchIndexAt(matches: readonly NoteFindMatch[], position: number): number {
  if (matches.length === 0) return -1;
  const index = matches.findIndex((match) => match.from >= position);
  return index === -1 ? 0 : index;
}

/**
 * Prev/next over the match list: wrapping in both directions, and entering the
 * list from whichever end the direction implies when nothing is active yet
 * (`current` is -1).
 */
export function stepMatchIndex(count: number, current: number, delta: number): number {
  if (count === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (((current + delta) % count) + count) % count;
}

/**
 * The order „Zameni sve" must apply its edits in: strictly back to front.
 *
 * Every match is a position in the document as it stands BEFORE any of them is
 * replaced, and a replacement of a different length moves everything after it.
 * Walking forwards would therefore invalidate every remaining match the moment
 * the first edit lands — off by the length delta, cumulatively. Walking
 * backwards, each edit only ever moves text that sits AFTER it, and every
 * position still to be visited is before it, so all of them stay exactly as
 * computed. That is what lets the whole run go into a single transaction (one
 * undo step, one Yjs batch) instead of a re-scan per replacement.
 *
 * A copy is returned; the caller's list — the plugin's live match state — is
 * never reordered under it.
 */
export function planNoteReplacements(matches: readonly NoteFindMatch[]): NoteFindMatch[] {
  return [...matches].sort((a, b) => b.from - a.from);
}
