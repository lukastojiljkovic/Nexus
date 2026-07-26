/**
 * Serbian-aware search folding and snippeting (ADR-021 / PRD 08 SRCH-002).
 * Every document indexed into the FTS5 table, and every query run against
 * it, is folded through `foldSearchText` first — that is what makes
 * "Đorđe", "djordje" (Latin, no diacritics) and "Ђорђе" (Cyrillic) land on
 * the identical string. SQLite's `unicode61 remove_diacritics 2` tokenizer
 * already handles the decomposable Latin diacritics (š č ć ž) but not đ
 * (U+0111, a letter with a stroke, not a combining-mark composition) and
 * nothing at all for Cyrillic — this module is what closes that gap, and it
 * runs identically on both sides so a folded index always meets a folded
 * query halfway.
 *
 * Folding is for MATCHING ONLY, never storage or display: it is lossy (č
 * and ć both fold to c), and a "dordje" typed without the dj is expected to
 * stay "dordje" rather than be coerced into matching "Đorđe".
 */

export interface FoldedText {
  /** The folded string. */
  readonly folded: string;
  /** `offsets[i]` is the index in the ORIGINAL input of the character that produced `folded[i]`. Same length as `folded`. */
  readonly offsets: readonly number[];
}

// Combining Diacritical Marks block bounds, checked by code point rather than
// a regex escape range: keeps the source file plain ASCII here, which is
// worth it given how easily a raw combining character pasted into a regex
// literal turns invisible/unreviewable.
const COMBINING_MARK_RANGE_START = 0x0300;
const COMBINING_MARK_RANGE_END = 0x036f;

function isCombiningMark(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code >= COMBINING_MARK_RANGE_START && code <= COMBINING_MARK_RANGE_END;
}

/**
 * Applied to each code point AFTER lower-casing and NFD diacritic-stripping,
 * so š/č/ć/ž (which NFD already reduces to plain s/c/c/z) need no entry
 * here. This table covers what step 2 cannot reach: đ (U+0111, not
 * decomposable), the precomposed dž/lj/nj digraphs (only compatibility-,
 * not canonically-, decomposable, so NFD leaves them whole), and the
 * Serbian Cyrillic alphabet transliterated to Latin and folded the same way
 * the Latin side ends up after stripping. Anything not listed here passes
 * through unchanged — non-Serbian scripts fold consistently (same table,
 * both index and query side) so they still match each other, even though
 * this module makes no attempt to cover every alphabet.
 */
const FOLD_TABLE: Readonly<Record<string, string>> = {
  đ: "dj",
  ǆ: "dz",
  ǅ: "dz",
  ǉ: "lj",
  ǈ: "lj",
  ǌ: "nj",
  ǋ: "nj",
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  ђ: "dj",
  е: "e",
  ж: "z",
  з: "z",
  и: "i",
  ј: "j",
  к: "k",
  л: "l",
  љ: "lj",
  м: "m",
  н: "n",
  њ: "nj",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  ћ: "c",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "c",
  џ: "dz",
  ш: "s",
};

export function foldWithOffsets(input: string): FoldedText {
  let folded = "";
  const offsets: number[] = [];
  let sourceIndex = 0;

  for (const char of input) {
    // NFD + combining-mark strip happens per code point, not over the whole
    // string, so a run of chars can never "borrow" a mark from a neighbour.
    const decomposed = char.toLowerCase().normalize("NFD");
    for (const piece of decomposed) {
      if (isCombiningMark(piece)) continue; // dropped: contributes no output char
      const mapped = FOLD_TABLE[piece] ?? piece;
      for (const outChar of mapped) {
        folded += outChar;
        offsets.push(sourceIndex);
      }
    }
    sourceIndex += char.length; // advance by UTF-16 units so surrogate pairs count once
  }

  return { folded, offsets };
}

export function foldSearchText(input: string): string {
  return foldWithOffsets(input).folded;
}

export interface SearchSnippet {
  /** An excerpt of the ORIGINAL source text, with a leading/trailing ellipsis when truncated. */
  readonly text: string;
  /** Half-open `[start, end)` ranges **into `text`** (not into the source) that matched a term. Sorted, non-overlapping. */
  readonly ranges: readonly (readonly [number, number])[];
}

/** Characters either side of the first match a snippet window reaches for, absent truncation. */
export const DEFAULT_SNIPPET_RADIUS = 60;

/** How far a window edge may travel to land on a word boundary before we give up and accept a mid-word cut. */
const BOUNDARY_SNAP_DISTANCE = 8;

const ELLIPSIS = "…";
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR_RE.test(char);
}

/** The char before `index` is absent or not a word char — where a term is allowed to start matching. */
function isTokenBoundary(text: string, index: number): boolean {
  return !isWordChar(text[index - 1]);
}

/** The earliest, leftmost token-boundary occurrence of any term, or null if none matches at all. */
function findFirstBoundaryMatch(
  folded: string,
  terms: readonly string[],
): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  for (const term of terms) {
    if (term.length === 0) continue; // an empty term must never match everywhere
    let fromIndex = 0;
    while (fromIndex <= folded.length - term.length) {
      const idx = folded.indexOf(term, fromIndex);
      if (idx === -1) break;
      if (isTokenBoundary(folded, idx)) {
        if (best === null || idx < best.start) best = { start: idx, end: idx + term.length };
        break; // this term's leftmost boundary hit is the best it can offer
      }
      fromIndex = idx + 1;
    }
  }
  return best;
}

/** Every token-boundary occurrence of every term whose match lies fully inside `[rangeStart, rangeEnd)`. */
function collectBoundaryMatches(
  folded: string,
  terms: readonly string[],
  rangeStart: number,
  rangeEnd: number,
): Array<{ start: number; end: number }> {
  const matches: Array<{ start: number; end: number }> = [];
  for (const term of terms) {
    if (term.length === 0) continue;
    let fromIndex = rangeStart;
    while (fromIndex <= rangeEnd - term.length) {
      const idx = folded.indexOf(term, fromIndex);
      if (idx === -1 || idx + term.length > rangeEnd) break;
      // Boundary check reads the FULL folded text, not the sub-range: a window
      // edge that lands mid-word must not be mistaken for a boundary just
      // because it happens to be the first character we're looking at.
      if (isTokenBoundary(folded, idx)) matches.push({ start: idx, end: idx + term.length });
      fromIndex = idx + 1;
    }
  }
  return matches;
}

/** First folded index whose source offset is >= sourceIndex (binary search: offsets is non-decreasing). */
function sourceIndexToFoldedIndex(offsets: readonly number[], sourceIndex: number): number {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const value = offsets[mid];
    if (value !== undefined && value < sourceIndex) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Moves `start` earlier to the beginning of the word it cuts into, within `maxDistance`; gives up otherwise. */
function snapStartOutward(text: string, start: number, maxDistance: number): number {
  if (start <= 0) return 0;
  if (!isWordChar(text[start - 1]) || !isWordChar(text[start])) return start; // not a mid-word cut
  const limit = Math.max(0, start - maxDistance);
  for (let pos = start; pos > limit; pos--) {
    if (!isWordChar(text[pos - 1])) return pos;
  }
  return limit === 0 ? 0 : start;
}

/** Moves `end` later to the end of the word it cuts into, within `maxDistance`; gives up otherwise. */
function snapEndOutward(text: string, end: number, maxDistance: number): number {
  if (end >= text.length) return text.length;
  if (!isWordChar(text[end - 1]) || !isWordChar(text[end])) return end; // not a mid-word cut
  const limit = Math.min(text.length, end + maxDistance);
  for (let pos = end; pos < limit; pos++) {
    if (!isWordChar(text[pos])) return pos;
  }
  return limit === text.length ? text.length : end;
}

function mergeRanges(
  ranges: readonly (readonly [number, number])[],
): Array<readonly [number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

function fallbackSnippet(source: string, radius: number): SearchSnippet {
  const limit = 2 * radius;
  if (source.length <= limit) return { text: source, ranges: [] };
  return { text: source.slice(0, limit) + ELLIPSIS, ranges: [] };
}

/**
 * Builds a display excerpt around the first match, with highlight ranges.
 * `terms` are assumed ALREADY FOLDED (the query parser's job) — only
 * `source` is folded here.
 */
export function buildSearchSnippet(
  source: string,
  terms: readonly string[],
  options?: { readonly radius?: number },
): SearchSnippet {
  const radius = options?.radius ?? DEFAULT_SNIPPET_RADIUS;
  const { folded, offsets } = foldWithOffsets(source);

  const firstMatch = findFirstBoundaryMatch(folded, terms);
  if (!firstMatch) return fallbackSnippet(source, radius);

  const foldedWinStart = Math.max(0, firstMatch.start - radius);
  const foldedWinEnd = Math.min(folded.length, firstMatch.end + radius);
  const rawSourceStart = offsets[foldedWinStart] ?? 0;
  const rawSourceEnd =
    foldedWinEnd < folded.length ? (offsets[foldedWinEnd] ?? source.length) : source.length;

  const sourceStart = snapStartOutward(source, rawSourceStart, BOUNDARY_SNAP_DISTANCE);
  const sourceEnd = snapEndOutward(source, rawSourceEnd, BOUNDARY_SNAP_DISTANCE);

  const hasPrefix = sourceStart > 0;
  const hasSuffix = sourceEnd < source.length;
  const prefixLength = hasPrefix ? ELLIPSIS.length : 0;
  const text =
    (hasPrefix ? ELLIPSIS : "") + source.slice(sourceStart, sourceEnd) + (hasSuffix ? ELLIPSIS : "");

  const finalFoldedStart = sourceIndexToFoldedIndex(offsets, sourceStart);
  const finalFoldedEnd = sourceIndexToFoldedIndex(offsets, sourceEnd);
  const foldedMatches = collectBoundaryMatches(folded, terms, finalFoldedStart, finalFoldedEnd);

  const ranges = mergeRanges(
    foldedMatches
      .map(({ start, end }): [number, number] => {
        const matchSourceStart = offsets[start] ?? source.length;
        const matchSourceEnd = end < folded.length ? (offsets[end] ?? source.length) : source.length;
        return [matchSourceStart - sourceStart + prefixLength, matchSourceEnd - sourceStart + prefixLength];
      })
      .filter(([start, end]) => start >= 0 && end <= text.length && start < end),
  );

  return { text, ranges };
}
