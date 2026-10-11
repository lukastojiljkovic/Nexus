/**
 * The page-selection grammar the PDF tools share: `1-3,5,8-`.
 *
 * **Why this is a parser and not a split on commas.** The same expression
 * answers four of the tool set's operations — extract, split into ranges,
 * rotate, delete — and every one of them needs the same three answers: which
 * pages, in which ORDER, and whether the expression is one a person could have
 * meant. A `split(",")` at each call site would give the order but not the
 * answers, and the answers are the half with a right and a wrong value: a page
 * number past the end of the document, a range written backwards, an empty
 * piece from a trailing comma. Each of those is refused HERE, by name, so the
 * screen can say which one it was instead of writing a file with the wrong
 * pages in it.
 *
 * **The order is the order as written.** `3,1` is pages 3 and 1 — that is how
 * a reader expresses "put 3 first", and it is the one reading under which an
 * expression can REORDER a document rather than only pick from it. A set would
 * lose it, and deduplication is the only reordering this parser performs:
 * `3,1,3` is `[3, 1]`, first occurrence wins, because a page named twice in one
 * expression is a typo rather than an instruction to copy it twice.
 *
 * **Pages are 1-based here and nowhere else.** A person types `1` for the first
 * page and every PDF tool says so; the 0-based index is the caller's private
 * business from this function's return value onward. `parsePageRanges` is also
 * the only place that has to know the page count, because "5" is a valid
 * expression for a ten-page document and a refusal for a three-page one.
 */

/** The most characters one page-selection expression may hold. */
export const PAGE_RANGE_MAX_LENGTH = 300;

/**
 * The most pages one expression may name.
 *
 * A cap rather than a policy about documents: an expression names its pages ONE
 * BY ONE (`8-` is the only shorthand, and it is bounded by the document), so
 * 500 is already a page number typed by hand for every other entry. The cap
 * exists because the expansion is what the caller then holds in memory and
 * feeds to pdf-lib, and "1-999999999" on a document that large would be an
 * out-of-memory rather than a refusal.
 */
export const PAGE_RANGE_MAX_PAGES = 500;

/**
 * Why an expression was refused, as a code rather than a sentence.
 *
 * Core carries no copy (`@nexus/core` is platform- and locale-free), so the
 * refusal travels as one of these and the screen words it — the same split the
 * rest of the tool set's refusals use.
 */
export type PageRangeRefusal =
  | "empty"
  | "too-long"
  | "syntax"
  | "reversed"
  | "out-of-range"
  | "too-many";

/** The pages an expression names, in the order it names them, or the reason it was refused. */
export type PageRangeResult =
  | { readonly ok: true; readonly pages: readonly number[] }
  | { readonly ok: false; readonly reason: PageRangeRefusal };

/** One `a`, `a-b` or `a-` piece: the two numbers are `null` when that end of the range was not written. */
interface RangePiece {
  readonly from: number;
  readonly to: number | null;
}

const DIGITS = /^\d+$/;

/**
 * One comma-separated piece, or `null` for anything this grammar does not read.
 *
 * A piece is digits, or digits-dash-digits, or digits-dash. `-3` is refused
 * rather than read as "the first three pages": an open START has no bound to be
 * checked against the document, and the two readings a person might intend —
 * "pages 1 to 3" and "the last three" — are different documents. `8-` has no
 * such ambiguity, because a document has exactly one end.
 */
function parsePiece(raw: string): RangePiece | null {
  const piece = raw.trim();
  const dash = piece.indexOf("-");
  if (dash === -1) {
    if (!DIGITS.test(piece)) return null;
    const page = Number(piece);
    return { from: page, to: page };
  }
  const from = piece.slice(0, dash).trim();
  const to = piece.slice(dash + 1).trim();
  if (!DIGITS.test(from)) return null;
  if (to.length === 0) return { from: Number(from), to: null };
  if (!DIGITS.test(to)) return null;
  return { from: Number(from), to: Number(to) };
}

/**
 * Reads `text` against a document of `pageCount` pages.
 *
 * Every refusal is decided in the order a person would want to hear it: an
 * expression that is merely too long never reaches the grammar, and a piece
 * that cannot be read is reported before any page number is compared against
 * the document — so `1-3,abc` says "syntax" rather than the first thing that
 * happened to be wrong. `pageCount` bounds BOTH ends of every piece, which is
 * what makes a range usable as a plan for an operation whose document the
 * caller has already read.
 */
export function parsePageRanges(text: string, pageCount: number): PageRangeResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (trimmed.length > PAGE_RANGE_MAX_LENGTH) return { ok: false, reason: "too-long" };

  const pages: number[] = [];
  const seen = new Set<number>();
  for (const raw of trimmed.split(",")) {
    const piece = parsePiece(raw);
    if (piece === null) return { ok: false, reason: "syntax" };
    const last = piece.to ?? pageCount;
    if (piece.from < 1 || last < 1 || piece.from > pageCount || last > pageCount) {
      return { ok: false, reason: "out-of-range" };
    }
    if (last < piece.from) return { ok: false, reason: "reversed" };
    for (let page = piece.from; page <= last; page += 1) {
      if (seen.has(page)) continue;
      seen.add(page);
      pages.push(page);
      if (pages.length > PAGE_RANGE_MAX_PAGES) return { ok: false, reason: "too-many" };
    }
  }
  return { ok: true, pages };
}
