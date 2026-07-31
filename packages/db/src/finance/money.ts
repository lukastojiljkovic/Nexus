/**
 * The FIN module's money and currency rules, in one place because all three
 * stores lean on them and a second spelling of "what an amount is" would be the
 * beginning of the drift this module exists to avoid.
 *
 * **Money is an INTEGER in minor units, and nothing here ever produces a
 * decimal.** 1234 in an RSD account is 12,34 RSD; in a JPY account it is 1234
 * JPY. The number of minor units in a major unit is a DISPLAY fact — it decides
 * where the separator goes and nothing else — so it lives at the display edge
 * (a later slice), never in the schema, never in a store, never in a sum. Every
 * total this module computes is therefore an integer sum of integers, which is
 * exact by construction; a float would start losing cents at the third
 * transaction and never say so.
 *
 * `Number.isSafeInteger` is the bound rather than the column's implicit
 * 64-bit range: JavaScript reads a SQLite INTEGER back as a `number`, so
 * anything past 2^53-1 would come out of the database as a different value than
 * went in — a silent corruption the CHECK on the column cannot catch, because
 * the row is perfectly valid SQL. 2^53-1 minor units is ~90 trillion of any
 * major unit, so the bound costs nothing real.
 */

/** ISO-4217: exactly three upper-case ASCII letters. Nothing here knows which codes exist — that is a display-time list, not a storage rule. */
const ISO_4217 = /^[A-Z]{3}$/;

/** Whether `value` is a currency code this module will store (migration 051's own CHECK, restated for the store's named refusal). */
export function isCurrencyCode(value: string): boolean {
  return ISO_4217.test(value);
}

/** Whether `value` is an amount of minor units that survives the round trip through SQLite and back into a `number`. */
export function isMinorUnits(value: number): boolean {
  return Number.isSafeInteger(value);
}

/** Exactly `YYYY-MM-DD`, AND a real calendar day — `Date.parse` alone accepts `2026-02-30` by rolling it into March, which is precisely the corrupt-but-parseable value a ledger must refuse. */
export function isBareDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const asDate = new Date(Date.UTC(year, month - 1, day));
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  );
}

/** The ISO-8601 date-time shape every `now` this module accepts must have — main stamps the clock, so a malformed one is a caller bug worth naming. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

export function isDateTime(value: string): boolean {
  return ISO_8601_DATETIME.test(value);
}

/**
 * Serbian Latin ordering for every alphabetical FIN list (CLAUDE.md's house
 * rule). Plain `"sr"` mis-tailors the Latin digraphs and diacritics — š, č, ć,
 * ž — so the locale list names the script explicitly.
 *
 * Sorted HERE rather than by SQLite (whose BINARY collation would put „Šoping"
 * after „Zdravlje") and rather than deferred to the renderer, which is what the
 * older stores do: FIN has no renderer yet, and a store that hands back an order
 * nobody fixes is a bug waiting for slice b to inherit.
 */
export const FIN_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** A total that is meaningful only together with the currency it is in — the shape every FIN aggregate answers with, so no caller can accidentally sum across currencies. */
export interface FinCurrencyTotal {
  currency: string;
  minorUnits: number;
}
