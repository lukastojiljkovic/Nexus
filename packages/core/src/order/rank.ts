/**
 * Fractional ranks — the sort key for every scope a user can reorder by hand.
 *
 * **Why this replaced a sparse integer.** Until schema 62 an ordered scope was a
 * column of integers spaced 1024 apart, and an insert between two neighbours took
 * their midpoint. That works until the gap runs out, and the recovery was
 * `renumberScope`: rewrite EVERY row in the scope at fresh 1024 steps. On one
 * machine that is merely expensive. Across two machines it is lossy — a renumber
 * is a mass UPDATE that carries no information about what the user actually did,
 * so two devices that each reorder the same list produce two mass UPDATEs, and any
 * last-writer-wins merge keeps one and discards the other user's reordering
 * wholesale. There is no field-level merge that can rescue it, because the field
 * that changed on both sides is "every row's position".
 *
 * A rank has no gap to exhaust. Between any two distinct ranks there is always
 * another one — the string simply grows a digit — so a move is ALWAYS a single-row
 * write, and the only row two devices can disagree about is the one that moved.
 * That is a fact about the representation, not a promise about the code, which is
 * the whole reason for the change.
 *
 * **The representation** is the one the `fractional-indexing` literature settled
 * on, re-based onto a 36-character alphabet. A rank is
 *
 *     <head><integer digits><fraction digits>
 *
 * read as a base-36 number. `head` is a magnitude character that says how many
 * integer digits follow AND on which side of zero they sit; everything after the
 * integer part is the fraction. Ordering is plain lexicographic comparison, so
 * `ORDER BY rank` in SQLite and `a < b` in JavaScript agree without a collation, a
 * parse, or a comparator.
 *
 * The integer part is what keeps keys short. A pure fraction has to fit every new
 * row inside `(0, 1)`, so appending repeatedly converges on `zzz…` and costs a
 * character every five rows — a thousand appends produce a two-hundred-character
 * key. With an integer part an append is an increment, which is constant size:
 * `i0`, `i1`, … `iz`, `j00`, … Five characters cover a million rows.
 *
 * Two deliberate choices hold the ordering up:
 *
 * - **Digits and lowercase only.** The alphabet is ASCII-ascending, so JavaScript's
 *   UTF-16 comparison, SQLite's `BINARY`, and a UTF-8 byte comparison are the same
 *   order. Base 62 would give marginally shorter keys, but then a stray
 *   `COLLATE NOCASE` anywhere in the schema would silently fold `a` onto `A` and
 *   corrupt the order. With no uppercase in the alphabet, `NOCASE` and `BINARY`
 *   are indistinguishable, so that failure cannot happen.
 * - **No trailing `0` in the fraction.** `i0` and `i00` are the same number but
 *   different strings, and only one can be canonical. Forbidding the trailing zero
 *   makes each value exactly one string, which is what lets equality and ordering
 *   be string operations. Note this applies to the FRACTION only — a trailing zero
 *   inside the integer part is a digit, not padding, and `i0` is the integer zero.
 */

/** The rank digits, in ascending code-point order. Base 36; see the module note on why not 62. */
export const RANK_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

const BASE = RANK_ALPHABET.length;
const LAST_DIGIT = RANK_ALPHABET[BASE - 1] as string;

/**
 * Heads `i`…`z` are non-negative and hold 1…18 integer digits; heads `0`…`h` are
 * negative and hold 18…1. So every negative head sorts below every non-negative
 * one, a longer positive integer sorts above a shorter one, and a longer negative
 * integer sorts below a shorter one — which is exactly numeric order.
 */
const ZERO_HEAD_INDEX = 18;
const MAX_INTEGER_DIGITS = 18;

/** The integer 0, and so the rank of the only row in a fresh scope. */
export const FIRST_RANK = "i0";

/** The bottom of the integer space: `0` followed by eighteen zeros. Nothing sorts below it but its own fraction. */
const SMALLEST_INTEGER = RANK_ALPHABET[0]!.repeat(MAX_INTEGER_DIGITS + 1);

/**
 * The most rows one `rankSequence` call will lay out. Far above any real scope
 * (PRD §7 budgets 10k tasks per profile, across all lists) and well inside the
 * integer space, which holds 36^18 values on each side of zero.
 */
export const MAX_RANK_SEQUENCE = 1_000_000;

function digitValue(character: string): number {
  const value = RANK_ALPHABET.indexOf(character);
  if (value < 0) throw new RangeError(`Not a rank digit: ${JSON.stringify(character)}`);
  return value;
}

/** How many characters the integer part occupies, head included, or `null` for a character that is no head. */
function integerLength(head: string): number | null {
  const index = RANK_ALPHABET.indexOf(head);
  if (index < 0) return null;
  return index >= ZERO_HEAD_INDEX
    ? index - ZERO_HEAD_INDEX + 2
    : ZERO_HEAD_INDEX - 1 - index + 2;
}

/** The integer part of a well-formed rank, or `null` when the string is not one. */
function integerPart(rank: string): string | null {
  const head = rank[0];
  if (head === undefined) return null;
  const length = integerLength(head);
  if (length === null || rank.length < length) return null;
  const part = rank.slice(0, length);
  for (const character of part.slice(1)) {
    if (!RANK_ALPHABET.includes(character)) return null;
  }
  return part;
}

/**
 * The next integer after `part`, or `null` when the integer space is exhausted
 * upward. Carrying past the last digit widens the number, which on the
 * non-negative side means one more digit and on the negative side one fewer — a
 * negative integer gets closer to zero as it grows.
 */
function incrementInteger(part: string): string | null {
  const head = part[0] as string;
  const digits = part.slice(1).split("");

  let carry = true;
  for (let index = digits.length - 1; carry && index >= 0; index -= 1) {
    const next = digitValue(digits[index] as string) + 1;
    if (next === BASE) {
      digits[index] = RANK_ALPHABET[0] as string;
    } else {
      digits[index] = RANK_ALPHABET[next] as string;
      carry = false;
    }
  }
  if (!carry) return head + digits.join("");

  // The digits rolled over. `h` is the last negative head, so the number that
  // follows the largest negative integer is zero itself.
  if (head === RANK_ALPHABET[ZERO_HEAD_INDEX - 1]) return FIRST_RANK;
  const headIndex = digitValue(head);
  if (headIndex === BASE - 1) return null;
  const nextHead = RANK_ALPHABET[headIndex + 1] as string;
  if (headIndex + 1 > ZERO_HEAD_INDEX) digits.push(RANK_ALPHABET[0] as string);
  else digits.pop();
  return nextHead + digits.join("");
}

/** The previous integer, or `null` at the bottom of the space. The mirror of `incrementInteger`. */
function decrementInteger(part: string): string | null {
  const head = part[0] as string;
  const digits = part.slice(1).split("");

  let borrow = true;
  for (let index = digits.length - 1; borrow && index >= 0; index -= 1) {
    const next = digitValue(digits[index] as string) - 1;
    if (next < 0) {
      digits[index] = LAST_DIGIT;
    } else {
      digits[index] = RANK_ALPHABET[next] as string;
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join("");

  // Below zero is the largest negative integer: head `h`, one digit, at its top.
  if (head === RANK_ALPHABET[ZERO_HEAD_INDEX]) {
    return (RANK_ALPHABET[ZERO_HEAD_INDEX - 1] as string) + LAST_DIGIT;
  }
  const headIndex = digitValue(head);
  if (headIndex === 0) return null;
  const previousHead = RANK_ALPHABET[headIndex - 1] as string;
  if (headIndex - 1 < ZERO_HEAD_INDEX - 1) digits.push(LAST_DIGIT);
  else digits.pop();
  return previousHead + digits.join("");
}

/**
 * A fraction strictly between `lower` and `upper`, given as digit strings with no
 * trailing zero (`lower` may be `""` meaning 0, `upper` may be `null` meaning 1).
 *
 * The recursion is the schoolbook one: skip the digits the two share, then look at
 * the first digit where they differ. If those digits are two or more apart the
 * midpoint digit alone lands between them and the answer is one character long.
 * If they are adjacent there is no digit in between, so we borrow — either by
 * truncating `upper` to its first digit (which is below `upper` and above `lower`
 * whenever `upper` has more digits to give), or by keeping `lower`'s digit and
 * recursing into what follows it against the open upper bound.
 */
function midpoint(lower: string, upper: string | null): string {
  if (upper !== null) {
    let shared = 0;
    while (shared < upper.length && (lower[shared] ?? "0") === upper[shared]) shared += 1;
    // `shared` can never reach `upper.length`: that would mean `lower`'s digits,
    // zero-padded, spell `upper` exactly, so `lower >= upper` — excluded by the caller.
    if (shared > 0) {
      return upper.slice(0, shared) + midpoint(lower.slice(shared), upper.slice(shared));
    }
  }

  const low = lower === "" ? 0 : digitValue(lower[0] as string);
  const high = upper === null ? BASE : digitValue(upper[0] as string);

  if (high - low > 1) return RANK_ALPHABET[Math.round((low + high) / 2)] as string;
  if (upper !== null && upper.length > 1) return upper.slice(0, 1);
  return (RANK_ALPHABET[low] as string) + midpoint(lower.slice(1), null);
}

/**
 * True for a string this module would produce: a well-formed integer part, rank
 * digits throughout, and no trailing `0` in the fraction. Storage layers use it as
 * a boundary check — a rank arriving from an import, a restore or an IPC payload
 * is untrusted like any other string.
 */
export function isRank(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const part = integerPart(value);
  if (part === null) return false;
  const fraction = value.slice(part.length);
  if (fraction.endsWith("0")) return false;
  for (const character of fraction) {
    if (!RANK_ALPHABET.includes(character)) return false;
  }
  return true;
}

/**
 * The canonical spelling of a rank: trailing zeros dropped from the FRACTION,
 * because they change the string without changing the number it denotes. The
 * integer part is left alone — its zeros are digits, and `i0` is the integer zero,
 * not a padded `i`.
 *
 * Throws for anything that is not a rank at all. That is a corrupted column or a
 * caller passing a string that was never a rank, and guessing an order for it
 * would put a user's rows in the wrong places silently.
 */
export function normalizeRank(rank: string): string {
  const part = integerPart(rank);
  if (part === null) throw new RangeError(`Not a rank: ${JSON.stringify(rank)}`);
  for (const character of rank) digitValue(character);
  let end = rank.length;
  while (end > part.length && rank[end - 1] === "0") end -= 1;
  return rank.slice(0, end);
}

/**
 * The rank for a row placed between two neighbours, or `null` when the pair does
 * not describe a gap at all — the same row twice, or the two given the wrong way
 * round. `before` is the rank of the row that will sit immediately ABOVE and
 * `after` the one immediately BELOW, `null` meaning "nothing there": so
 * `(null, null)` is the only row in its scope, `(last, null)` is an append and
 * `(null, first)` is a prepend.
 *
 * `null` is returned rather than thrown so each store keeps its own error family —
 * the caller knows whether a bad pair is a validation failure the user caused or a
 * bug. Unlike the integer positions this replaced, there is no third outcome: a
 * well-ordered pair ALWAYS yields a rank, so no caller needs a renumber path and
 * none of them has one.
 */
export function rankBetween(before: string | null, after: string | null): string | null {
  const lower = before === null ? null : normalizeRank(before);
  const upper = after === null ? null : normalizeRank(after);
  if (lower !== null && upper !== null && lower >= upper) return null;

  if (lower === null) {
    if (upper === null) return FIRST_RANK;
    const part = integerPart(upper) as string;
    const fraction = upper.slice(part.length);
    if (part === SMALLEST_INTEGER) return fraction === "" ? null : part + midpoint("", fraction);
    // `upper` carries a fraction, so its own integer part already sits below it.
    if (part < upper) return part;
    const previous = decrementInteger(part);
    return previous ?? (fraction === "" ? null : part + midpoint("", fraction));
  }

  const lowerPart = integerPart(lower) as string;
  const lowerFraction = lower.slice(lowerPart.length);

  if (upper === null) {
    const next = incrementInteger(lowerPart);
    return next ?? lowerPart + midpoint(lowerFraction, null);
  }

  const upperPart = integerPart(upper) as string;
  if (lowerPart === upperPart) {
    return lowerPart + midpoint(lowerFraction, upper.slice(upperPart.length));
  }

  const next = incrementInteger(lowerPart);
  if (next !== null && next < upper) return next;
  return lowerPart + midpoint(lowerFraction, null);
}

/**
 * The rank whose value is the whole number `value` — the lossless conversion of
 * an old sparse integer sort key into a rank, and the reason the representation
 * has an integer part at all.
 *
 * Order-preserving and row-local: `n < m` implies `rankForInteger(n) <
 * rankForInteger(m)`, with no need to see the rest of the scope. That is what
 * lets an archive written before schema 62 be read one row at a time, and it is
 * why `rankAfter(rankForInteger(n))` is exactly `rankForInteger(n + 1)`.
 *
 * Negative values are as ordinary here as they were as positions: prepending
 * walked an integer sort key below zero, and the rank space is symmetric.
 */
export function rankForInteger(value: number): string {
  if (!Number.isInteger(value)) {
    throw new RangeError(`rankForInteger needs a whole number, got ${String(value)}`);
  }

  // Each width is a BAND, not plain base-36 notation: one digit covers the first
  // 36 values, two the next 36^2, three the next 36^3. So 36 is `j00`, not `j10`
  // — which is exactly what stepping `i0` forward 36 times produces, and the
  // reason the two agree is that both count ranks rather than write numerals.
  // Negatives are the mirror, counting DOWN from zero with the digits running
  // backwards inside each band: `hz` is -1 and `h0` is -36.
  const negative = value < 0;
  const magnitude = negative ? -value : value;

  let width = 1;
  let below = 0;
  let span = BASE;
  // The top of the current band: `below + span - 1` counting up from zero,
  // `below + span` counting down, because a magnitude below zero starts at 1.
  while (magnitude > below + span - (negative ? 0 : 1)) {
    below += span;
    width += 1;
    span *= BASE;
    if (width > MAX_INTEGER_DIGITS) throw new RangeError(`Integer out of rank space: ${value}`);
  }

  const head = RANK_ALPHABET[negative ? ZERO_HEAD_INDEX - width : ZERO_HEAD_INDEX + width - 1];
  if (head === undefined) throw new RangeError(`Integer out of rank space: ${value}`);

  let remaining = negative ? below + span - magnitude : magnitude - below;
  let digits = "";
  for (let index = 0; index < width; index += 1) {
    digits = (RANK_ALPHABET[remaining % BASE] as string) + digits;
    remaining = Math.floor(remaining / BASE);
  }
  return head + digits;
}

/**
 * The rank for a row appended to the end of a scope whose current maximum is
 * `max` — `null` when the scope is empty. Spelled out because an append is the
 * commonest write there is and, unlike a placement between two neighbours, it
 * always has room: there is no failure case for a caller to handle.
 */
export function rankAfter(max: string | null): string {
  return rankBetween(max, null) as string;
}

/**
 * `count` consecutive ranks in ascending order — what a fresh scope gets: a
 * migration back-filling an existing list, an importer laying down a file's rows,
 * a restore rebuilding a profile.
 *
 * These are exactly the ranks `count` appends would produce, walked directly
 * rather than through `rankBetween`, and they leave room on both sides and between
 * every pair.
 */
export function rankSequence(count: number): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`rankSequence needs a non-negative integer, got ${String(count)}`);
  }
  if (count > MAX_RANK_SEQUENCE) {
    throw new RangeError(`rankSequence is capped at ${MAX_RANK_SEQUENCE} rows, got ${count}`);
  }

  const ranks: string[] = [];
  let rank = FIRST_RANK;
  for (let index = 0; index < count; index += 1) {
    ranks.push(rank);
    const next = incrementInteger(rank);
    if (next === null) throw new RangeError("rankSequence exhausted the integer space");
    rank = next;
  }
  return ranks;
}
