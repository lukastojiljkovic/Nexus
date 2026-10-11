/**
 * The pure half of the Reader's page: turning a hit's ranges into the segments a
 * `<mark>` is painted from, and the few decisions the reading view makes about
 * where a book opens.
 *
 * It lives outside the component for the reason the timers module's `timing.ts`
 * does: it is the part that can be tested without a DOM, and the part where an
 * off-by-one is invisible on screen (a range that starts one character late
 * highlights "oda" and nobody notices a missing letter).
 */

export interface HighlightSegment {
  readonly text: string;
  /** True for the part a term matched. */
  readonly match: boolean;
}

/**
 * One string, split at the ranges a search reported.
 *
 * The ranges come from `buildSearchSnippet` and index into THIS string, which is
 * the whole reason no mapping is done here. They are assumed sorted and
 * non-overlapping (that helper merges them); a range that is out of bounds or
 * inverted is skipped rather than trusted, so a malformed range costs a highlight
 * and never a broken page.
 */
export function highlightSegments(
  text: string,
  ranges: readonly (readonly [number, number])[],
): readonly HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start < at || end <= start || end > text.length) continue;
    if (start > at) segments.push({ text: text.slice(at, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    at = end;
  }
  if (at < text.length) segments.push({ text: text.slice(at), match: false });
  if (segments.length === 0) segments.push({ text, match: false });
  return segments;
}

