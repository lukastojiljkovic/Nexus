import { suggestCsvRoles } from "./csvImport.js";
import type { ExportFinTransaction, ProfileData } from "./exportArchive.js";

/**
 * The bank-statement CSV import (FIN slice e) — a Serbian bank's exported
 * „izvod" turned into the `ProfileData` `planForeignImport` merges. The second
 * TRANSLATOR on the CSV stack, and deliberately only that: the reader
 * (`parseCsv`), the delimiter sniff, the header→role suggestion
 * (`suggestCsvRoles`) and the whole pick→preview→map→apply session are
 * ADR-062's, reused verbatim. What is new here is everything a STATEMENT is
 * that a task table is not.
 *
 * Four decisions shape the file, and each one exists because money read wrong
 * is the worst outcome this app can produce:
 *
 *  - **The account is the USER's answer, and its currency governs.** A
 *    statement names a bank account, never a Nexus one, so the destination is
 *    chosen in the mapping step and seeded through the planner's `seededIds`
 *    (`CSV_LIST_SOURCE_ID`'s seam, one module over). There is no „new account"
 *    option: an account carries a currency and an opening balance a statement
 *    cannot supply. A `currency` column that disagrees with the account REFUSES
 *    the file by name — there is no FX anywhere in this app, so a EUR statement
 *    landing in an RSD account would not be a conversion, it would be a lie.
 *  - **The number convention is established over the WHOLE column, never per
 *    row.** A statement legitimately writes „1.234,56", which the app's own
 *    amount field refuses on purpose (`parseMoneyInput`: grouping is not
 *    accepted, so „1.234" cannot mean two things). Here the grouping is the
 *    file's, so it has to be read — and the only honest way to read it is to
 *    decide once, from every cell of the column at once, and to REFUSE when two
 *    readings both fit and disagree. `sniffCsvFinanceAmountFormat` does exactly
 *    that; `readCsvFinanceAmount` then applies the settled convention with no
 *    further guessing. The currency's own minor-unit count does most of the
 *    work: „1.234" cannot be a decimal in RSD (three fraction digits RSD cannot
 *    hold), so the reading 1234 is a DEDUCTION, not a preference.
 *  - **The date convention likewise.** Four readings are offered — ISO, the
 *    Serbian `d.M.yyyy.`, and the two slashed orders — and the one that reads
 *    MORE of the column wins. `01/02/2026` beside `03/04/2026` is refused by
 *    name, because day-first and month-first both fit and disagree; the same
 *    file with one `13/02/2026` in it settles itself.
 *  - **A re-import must not duplicate.** Every planned row carries an
 *    `importKey` — the row's own facts plus its occurrence number among rows
 *    identical to it — and a key the ledger already holds SKIPS the row and
 *    names the skip. The occurrence number is what keeps two identical coffees
 *    on one day two coffees: they are ordinals 1 and 2, so both import, and the
 *    same statement read again recognises both. See `finImportKey`.
 *
 * Pure, like every module in `@nexus/core`: no clock (`now` is injected), no id
 * generator (the `csv:` ids below are deterministic source-side names the
 * planner mints over), no IO, and no database — the fingerprints the ledger
 * already holds arrive as `knownKeys`.
 */

// --- Column roles ------------------------------------------------------------

/**
 * What one column of a statement can BE. Closed, like the task import's, so no
 * column can be mapped onto a promise nothing keeps.
 *
 * The amount side has THREE members because Serbian bank exports genuinely come
 * both ways: one signed `amount` column, or a separate `outflow`/`inflow` pair.
 * The pair is named by MEANING — money leaving, money arriving — rather than by
 * the accounting words „duguje"/„potražuje", which mean opposite things
 * depending on whose books you are reading and are therefore exactly the guess
 * this vocabulary must not invite.
 *
 * There is deliberately no `category` role: a bank knows nothing about a Nexus
 * category, so every imported row lands uncategorized for the user to file —
 * a visible blank, never an invented label.
 */
export type CsvFinanceColumnRole =
  | "date"
  | "amount"
  | "outflow"
  | "inflow"
  | "payee"
  | "note"
  | "currency"
  | "ignore";

/** Every role, in the order the mapping dialog's selects offer them. `date` first because it is required of every statement; `ignore` last because it is the way out. */
export const CSV_FINANCE_COLUMN_ROLES: readonly CsvFinanceColumnRole[] = [
  "date",
  "amount",
  "outflow",
  "inflow",
  "payee",
  "note",
  "currency",
  "ignore",
];

/**
 * The bilingual header table behind the SUGGESTED mapping. Keys are FOLDED
 * (`foldSearchText`: lowercased, diacritics stripped) and matched exactly, so
 * „Zaduženje", „zaduzenje" and „ZADUŽENJE" all land while „Datum valute" does
 * not silently become the booking date of a file that also has one.
 */
const FINANCE_HEADER_ROLES: ReadonlyMap<string, CsvFinanceColumnRole> = new Map(
  Object.entries({
    // datum / date …
    datum: "date",
    "datum transakcije": "date",
    "datum knjizenja": "date",
    "datum valute": "date",
    "datum prometa": "date",
    date: "date",
    "transaction date": "date",
    "booking date": "date",
    "value date": "date",
    // iznos / amount — the SIGNED column
    iznos: "amount",
    "iznos transakcije": "amount",
    promet: "amount",
    amount: "amount",
    // isplata / debit — money LEAVING the account
    isplata: "outflow",
    zaduzenje: "outflow",
    "na teret": "outflow",
    duguje: "outflow",
    odliv: "outflow",
    rashod: "outflow",
    debit: "outflow",
    withdrawal: "outflow",
    // uplata / credit — money ARRIVING in the account
    uplata: "inflow",
    odobrenje: "inflow",
    "u korist": "inflow",
    potrazuje: "inflow",
    priliv: "inflow",
    prihod: "inflow",
    credit: "inflow",
    deposit: "inflow",
    // primalac / payee
    primalac: "payee",
    "naziv primaoca": "payee",
    nalogodavac: "payee",
    platilac: "payee",
    korisnik: "payee",
    payee: "payee",
    merchant: "payee",
    beneficiary: "payee",
    // opis / description
    opis: "note",
    "opis transakcije": "note",
    svrha: "note",
    "svrha placanja": "note",
    napomena: "note",
    description: "note",
    details: "note",
    narrative: "note",
    reference: "note",
    // valuta / currency
    valuta: "currency",
    currency: "currency",
    ccy: "currency",
  }) as [string, CsvFinanceColumnRole][],
);

/** A suggested role per column of a statement — `suggestCsvRoles` over the table above, on exactly the task import's terms. */
export function suggestCsvFinanceMapping(
  headers: readonly (string | null)[],
): CsvFinanceColumnRole[] {
  return suggestCsvRoles(headers, FINANCE_HEADER_ROLES, "ignore");
}

// --- The currency's own exponent ---------------------------------------------

/** One `Intl.NumberFormat` per currency, built on first use — constructing one is the expensive part, and a statement asks the same question once per file. */
const exponentFormatters = new Map<string, Intl.NumberFormat>();

/**
 * How many minor units make one major unit of `currency`, read from the
 * currency's own CLDR data rather than assumed: 2 for RSD and EUR, 0 for JPY,
 * 3 for KWD. A well-formed code the runtime has no data for answers 2, which is
 * ISO's own default and what `Intl` itself would use.
 *
 * The renderer's `money.ts` — the DISPLAY edge — reads the same fact from the
 * same source, and reading a statement is that edge's exact INVERSE: text in
 * major units becoming the integer minor units everything else in FIN speaks.
 * One definition, imported by both, so the two cannot drift; migration 051's
 * „the exponent is a display fact, never a schema one" is untouched, since
 * nothing here stores it.
 *
 * `currency` must be a validated ISO-4217 code (three upper-case ASCII
 * letters) — every code that reaches this module comes out of `fin_accounts`,
 * whose CHECK is exactly that rule.
 */
export function currencyMinorDigits(currency: string): number {
  let formatter = exponentFormatters.get(currency);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat("sr-Latn", {
      style: "currency",
      currency,
      currencyDisplay: "code",
    });
    exponentFormatters.set(currency, formatter);
  }
  // Always present for a CURRENCY formatter in practice: `Intl` resolves it from
  // the currency's own data (or ISO's default of 2) before this returns. The
  // fallback matches what would have been resolved anyway.
  return formatter.resolvedOptions().maximumFractionDigits ?? 2;
}

// --- The amount convention ---------------------------------------------------

/** The two ways a statement writes money. Named by the DECIMAL separator, because that is the character the whole reading turns on. */
export type CsvFinanceAmountFormat = "decimal-comma" | "decimal-dot";

const AMOUNT_FORMATS: readonly CsvFinanceAmountFormat[] = ["decimal-comma", "decimal-dot"];

/**
 * One grammar per convention: an optional sign, then either a GROUPED integer
 * (1–3 digits, then runs of exactly three) or a plain one, then an optional
 * fraction behind the decimal separator.
 *
 * The `{3}` is the load-bearing part. It is what makes „1.23" unreadable under
 * decimal-comma rather than quietly 123: a grouping separator followed by two
 * digits is not grouping, and reading it as a decimal anyway is precisely the
 * silent misreading this import exists to prevent.
 */
const AMOUNT_GRAMMARS: Record<CsvFinanceAmountFormat, RegExp> = {
  "decimal-comma": /^([+-]?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/,
  "decimal-dot": /^([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/,
};

/**
 * Every space a spreadsheet uses for grouping — the ordinary one, the no-break
 * space (U+00A0), the narrow no-break space (U+202F) and the thin space
 * (U+2009) — plus any stray padding. Removed before the grammar runs.
 *
 * Written as ESCAPES rather than as the characters themselves: a raw NBSP in
 * source is invisible, and an invisible character inside the money parser is
 * not something this file is willing to contain.
 */
const AMOUNT_SPACES = /[\s\u00a0\u202f\u2009]/g;

/**
 * One amount cell as exact minor units under a SETTLED convention, or `null`
 * when the cell is not money this currency can hold.
 *
 * Three refusals, each deliberate and none of them a rounding:
 *
 *  - a grouping run that is not three digits long (see `AMOUNT_GRAMMARS`);
 *  - a fraction longer than the currency's own minor-unit count — „12,345 RSD"
 *    is not 12,34 and not 12,35, it is a cell this import will not read;
 *  - a value past `Number.isSafeInteger`, which SQLite would hand back as a
 *    different number than went in.
 *
 * A cell with NO fraction is whole MAJOR units: „1234" in an RSD column is
 * 1.234,00 RSD, not 12,34. That is the only reading a statement admits — a bank
 * writes „1.234,00", never a bare count of paras — and it is the same reading
 * the app's own amount field gives a bare integer.
 */
export function readCsvFinanceAmount(
  cell: string,
  format: CsvFinanceAmountFormat,
  minorDigits: number,
): number | null {
  const text = cell.replace(AMOUNT_SPACES, "");
  if (text.length === 0) return null;

  const match = AMOUNT_GRAMMARS[format].exec(text);
  if (match === null) return null;
  const [, sign = "", whole = "", fraction] = match;
  if (fraction !== undefined && fraction.length > minorDigits) return null;

  const scale = 10 ** minorDigits;
  const digits = whole.replace(/[.,]/g, "");
  const minorUnits =
    Number(digits) * scale +
    (fraction === undefined ? 0 : Number(fraction.padEnd(minorDigits, "0")));
  if (!Number.isSafeInteger(minorUnits)) return null;
  return sign === "-" ? -minorUnits : minorUnits;
}

/**
 * What a column of amounts turned out to be: a settled convention, an
 * AMBIGUITY (two readings fit and disagree — refused, never guessed), or a
 * column no reading fits at all.
 */
export type CsvFinanceAmountReading =
  | { kind: "format"; format: CsvFinanceAmountFormat }
  | { kind: "ambiguous"; sample: string }
  | { kind: "unreadable"; sample: string };

/**
 * Settles one column's number convention over ALL of its cells at once — the
 * decision the module header argues for, and the reason a per-row guess is
 * never made anywhere below.
 *
 * The rule, in order:
 *
 *  1. An empty column settles nothing and refuses nothing.
 *  2. If NO reading parses a single cell, the column is `unreadable` and names
 *     its first cell — the mapping is pointing at the wrong column.
 *  3. If the two readings produce the IDENTICAL result for every cell (a column
 *     of bare integers), there is nothing to choose between them.
 *  4. Otherwise the reading that parses MORE of the column wins. This is a
 *     deduction rather than a preference: a cell the other reading cannot parse
 *     is a cell that reading is WRONG about, and the currency's own exponent
 *     makes the counts lopsided in practice („1.234" is unreadable as a decimal
 *     in any two-decimal currency).
 *  5. A TIE between two readings that disagree is refused by name, with the
 *     first cell they disagree about — that is the case where reading on would
 *     mean picking a number out of two.
 */
export function sniffCsvFinanceAmountFormat(
  cells: readonly string[],
  minorDigits: number,
): CsvFinanceAmountReading {
  const filled = cells.filter((cell) => cell.trim().length > 0);
  if (filled.length === 0) return { kind: "format", format: "decimal-comma" };

  const readings = AMOUNT_FORMATS.map((format) =>
    filled.map((cell) => readCsvFinanceAmount(cell, format, minorDigits)),
  );
  const [comma = [], dot = []] = readings;
  const counts = readings.map((values) => values.filter((value) => value !== null).length);
  const [commaCount = 0, dotCount = 0] = counts;

  if (commaCount === 0 && dotCount === 0) return { kind: "unreadable", sample: filled[0] ?? "" };

  const disagreement = filled.findIndex((_, index) => comma[index] !== dot[index]);
  if (disagreement === -1) return { kind: "format", format: "decimal-comma" };
  if (commaCount > dotCount) return { kind: "format", format: "decimal-comma" };
  if (dotCount > commaCount) return { kind: "format", format: "decimal-dot" };
  return { kind: "ambiguous", sample: filled[disagreement] ?? "" };
}

// --- The date convention -----------------------------------------------------

/** The four readings a statement's date column is offered. The last two are the ambiguity `sniffCsvFinanceDateFormat` exists to refuse. */
export type CsvFinanceDateFormat = "iso" | "dmy-dot" | "dmy-slash" | "mdy-slash";

const DATE_FORMATS: readonly CsvFinanceDateFormat[] = ["iso", "dmy-dot", "dmy-slash", "mdy-slash"];

/**
 * One grammar per reading, with the position each part occupies in its capture
 * groups. The four-digit year is common to all of them and is what keeps a
 * two-digit one out: a century is not something this import guesses, exactly as
 * ADR-062 decided for a task's due date. `dmy-slash` and `mdy-slash` share a
 * grammar and differ ONLY in which group is the day — which is precisely why
 * the sniff above has to settle between them rather than the parser.
 */
const DATE_PARTS: Record<CsvFinanceDateFormat, { pattern: RegExp; day: 1 | 2 | 3; month: 1 | 2 | 3; year: 1 | 2 | 3 }> = {
  iso: { pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, year: 1, month: 2, day: 3 },
  // The Serbian norm, tolerant of the spaces a hand-typed „1. 9. 2026." carries
  // and of the terminal dot the ordinal number takes.
  "dmy-dot": { pattern: /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\.?$/, day: 1, month: 2, year: 3 },
  "dmy-slash": { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, day: 1, month: 2, year: 3 },
  "mdy-slash": { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, month: 1, day: 2, year: 3 },
};

/** A trailing clock a statement often appends to its booking date („31.08.2026. 14:32"). Dropped: FIN stores a bare LOCAL day, so the time is not a fact this ledger keeps. */
const TRAILING_TIME = /\s+\d{1,2}:\d{2}(?::\d{2})?$/;

/** A real calendar day, not merely a parseable one: `Date` rolls 30 February into March, which is exactly the plausible-but-wrong value a typo produces. */
function isRealDay(year: number, month: number, day: number): boolean {
  const asDate = new Date(Date.UTC(year, month - 1, day));
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  );
}

/** One date cell as a bare ISO day under a SETTLED reading, or `null` when this reading does not fit the cell. */
export function readCsvFinanceDate(cell: string, format: CsvFinanceDateFormat): string | null {
  const text = cell.trim().replace(TRAILING_TIME, "").trim();
  if (text.length === 0) return null;

  const spec = DATE_PARTS[format];
  const match = spec.pattern.exec(text);
  if (match === null) return null;

  const year = Number(match[spec.year]);
  const month = Number(match[spec.month]);
  const day = Number(match[spec.day]);
  if (!isRealDay(year, month, day)) return null;

  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** What a column of dates turned out to be — `CsvFinanceAmountReading`'s shape, for the same three outcomes. */
export type CsvFinanceDateReading =
  | { kind: "format"; format: CsvFinanceDateFormat }
  | { kind: "ambiguous"; sample: string }
  | { kind: "unreadable"; sample: string };

/**
 * Settles one column's date reading over ALL of its cells, on exactly
 * `sniffCsvFinanceAmountFormat`'s rule: the reading that fits MORE of the
 * column wins, a tie between readings that disagree is refused by name with the
 * cell they disagree about, and a column no reading fits at all says so.
 *
 * This is what turns `01/02/2026` beside `03/04/2026` into an honest refusal —
 * day-first and month-first both fit every cell and mean different days — while
 * the same file with one `13/02/2026` in it settles itself, because a
 * thirteenth month is a cell month-first is demonstrably wrong about.
 */
export function sniffCsvFinanceDateFormat(cells: readonly string[]): CsvFinanceDateReading {
  const filled = cells.filter((cell) => cell.trim().length > 0);
  if (filled.length === 0) return { kind: "format", format: "iso" };

  const readings = DATE_FORMATS.map((format) => ({
    format,
    values: filled.map((cell) => readCsvFinanceDate(cell, format)),
  }));
  const best = readings.reduce(
    (max, entry) => Math.max(max, entry.values.filter((value) => value !== null).length),
    0,
  );
  if (best === 0) return { kind: "unreadable", sample: filled[0] ?? "" };

  const leaders = readings.filter(
    (entry) => entry.values.filter((value) => value !== null).length === best,
  );
  const [first] = leaders;
  if (first === undefined) return { kind: "unreadable", sample: filled[0] ?? "" };
  if (leaders.length === 1) return { kind: "format", format: first.format };

  const disagreement = filled.findIndex((_, index) =>
    leaders.some((entry) => entry.values[index] !== first.values[index]),
  );
  if (disagreement === -1) return { kind: "format", format: first.format };
  return { kind: "ambiguous", sample: filled[disagreement] ?? "" };
}

// --- The import fingerprint --------------------------------------------------

/**
 * One transaction's IMPORT FINGERPRINT — what makes importing the same
 * statement twice add nothing (migration 052).
 *
 * **Its inputs are the row's own facts, and only those**: the local day, the
 * signed minor units, and the two texts the row carries as it is STORED (payee
 * and note, already trimmed and capped). Nothing about the file is in it — not
 * its name, not its line number, not the mapping that read it — because the
 * same row can perfectly well arrive next month in a differently-shaped export
 * of an overlapping period, and it must be recognised then too. Nor is the
 * ACCOUNT in it: the row names its account in a column of its own, and the
 * uniqueness migration 052 declares is `(profile_id, account_id, import_key)`.
 * That is what lets a foreign import carry a fingerprint into another profile
 * unchanged while the planner re-mints the account around it.
 *
 * **`ordinal` is the fifth input, and it is the whole reason this is not a
 * naive hash.** Two identical coffees on one day are TWO coffees — a real case,
 * and a fingerprint over the four facts alone would silently drop the second
 * one forever. So identical rows are numbered as they are read: ordinals 1 and
 * 2, two different keys, both imported. Reading the same statement again
 * numbers them the same way, so both are recognised and neither is duplicated;
 * a later statement that genuinely holds a THIRD one gives it ordinal 3, which
 * no key matches, and exactly one row arrives.
 *
 * The composition is `JSON.stringify` of an array — `finBudgetKey`'s own device
 * and for its stated reason: no separator can be forged out of the values,
 * because the encoder escapes them.
 */
export function finImportKey(row: {
  date: string;
  amount: number;
  payee: string | null;
  note: string | null;
  /** 1-based occurrence among rows identical in the four facts above. */
  ordinal: number;
}): string {
  return JSON.stringify([row.date, row.amount, row.payee ?? "", row.note ?? "", row.ordinal]);
}

// --- Translation -------------------------------------------------------------

/**
 * The source-side id the ONE destination account goes by — `CSV_LIST_SOURCE_ID`'s
 * twin (ADR-052's seam, reused verbatim). The planner pre-populates its id map
 * with this one entry, so every planned row resolves onto the account the user
 * chose and no account row is ever created by an import.
 */
export const CSV_FINANCE_ACCOUNT_SOURCE_ID = "csv:fin-account";

/**
 * Which way a SIGNED amount column points. Stated by the user in the mapping
 * step rather than sniffed, deliberately: both conventions are common, a column
 * of nothing but expenses looks identical under either, and being wrong means
 * every balance on the screen is inverted.
 */
export type CsvFinanceSignConvention = "negative-is-expense" | "positive-is-expense";

export interface CsvFinanceTarget {
  /** The profile every row is stamped with. */
  profileId: string;
  /** ISO-8601, injected: this module reads no clock. Every row's `createdAt`/`updatedAt`. */
  now: string;
  /** The account the user chose. Seeded into the planner's id map, never created. */
  accountId: string;
  /** That account's currency — the one the statement must be in, and whose exponent scales every amount. */
  currency: string;
  signConvention: CsvFinanceSignConvention;
  /**
   * Every import fingerprint this profile's chosen account already carries,
   * mapped to whether that row is still LIVE (`false` = imported once and since
   * deleted). Supplied by the caller because `@nexus/core` reads no database;
   * a row whose key is in here is skipped and the skip is named.
   */
  knownKeys: ReadonlyMap<string, boolean>;
}

/** Why the whole FILE is refused. Every one of these is a case where reading on would mean choosing a number out of two — the one thing a ledger import must never do. */
export type CsvFinanceRefusalCode =
  | "ambiguous-amount-format"
  | "unreadable-amount-format"
  | "ambiguous-date-format"
  | "unreadable-date-format"
  | "foreign-currency";

export interface CsvFinanceRefusal {
  code: CsvFinanceRefusalCode;
  /** The 0-based column the refusal is about — the screen names it from the preview's own headers. */
  column: number;
  /** The offending cell verbatim, so the user can find it in their own spreadsheet. */
  sample: string;
}

/**
 * Why one row lost something. `text-truncated` is the only one that does not
 * cost the row its place: an over-long bank description is capped to what the
 * ledger holds and the loss is named, because a statement's „opis" routinely
 * runs past `MAX_FIN_NOTE_LENGTH` and refusing the row over it would throw away
 * the money to save the words.
 */
export type CsvFinanceRowDropCode =
  | "bad-date"
  | "no-amount"
  | "both-amounts"
  | "bad-amount"
  | "text-truncated";

export interface CsvFinanceRowDrop {
  /** 1-based data-row number, header excluded — the row's own line in the user's spreadsheet view. */
  row: number;
  code: CsvFinanceRowDropCode;
}

/** Why one row is already in the ledger. Two codes, because „you already have this" and „you already had this and deleted it" are different sentences and only one of them sounds like a bug. */
export type CsvFinanceRowSkipCode = "already-imported" | "already-imported-deleted";

export interface CsvFinanceRowSkip {
  row: number;
  code: CsvFinanceRowSkipCode;
}

/**
 * One translation's arithmetic. It balances:
 * `rows === transactions + blankRows + (rows dropped by name) + skips` — every
 * data row either became a transaction, was a blank line, was dropped by name,
 * or was recognised as one the ledger already holds. `text-truncated` drops
 * overlap `transactions`, since that row still arrives.
 */
export interface CsvFinanceReport {
  /** Data rows read (header excluded), blank lines included. */
  rows: number;
  /** Ledger rows planned. */
  transactions: number;
  /** Rows whose every cell was empty — skipped without a name, and counted so the balance above still holds. */
  blankRows: number;
  drops: readonly CsvFinanceRowDrop[];
  skips: readonly CsvFinanceRowSkip[];
}

/** The two conventions this file was read under, so the preview can SAY them rather than leave the user to trust them. */
export interface CsvFinanceFormats {
  amount: CsvFinanceAmountFormat;
  date: CsvFinanceDateFormat;
}

export type CsvFinanceTranslation =
  | { status: "refused"; refusal: CsvFinanceRefusal }
  | {
      status: "ready";
      /** Ready for `planForeignImport`, whose id map re-mints every id below. */
      data: ProfileData;
      /** `ForeignImportTarget.seededIds` — the one entry that points `csv:fin-account` at the chosen account. */
      seededIds: ReadonlyMap<string, string>;
      report: CsvFinanceReport;
      formats: CsvFinanceFormats;
    };

/** `MAX_FIN_PAYEE_LENGTH` / `MAX_FIN_NOTE_LENGTH` from `@nexus/db`'s transaction store, spelled here for `TASK_ORDER_GAP`'s stated reason: `@nexus/core` does not depend on `@nexus/db`, and two integers are not worth inverting that. */
const MAX_PAYEE_LENGTH = 120;
const MAX_NOTE_LENGTH = 500;

/**
 * The one mapping rule set, checked before a cell is read: a role names ONE
 * column, a date column is required (migration 051's `tx_date` is NOT NULL),
 * and the amount arrives EITHER as one signed column OR as an outflow/inflow
 * pair — never both, because a row that carried each would have two amounts and
 * no rule for choosing.
 *
 * Thrown rather than returned, exactly as `translateCsvTasks`' own soundness
 * check is: an unsound mapping is a caller bug (the wire validated the shape and
 * the dialog disables its confirm button), not a fact about the user's file.
 */
function assertFinanceMappingSound(roles: readonly CsvFinanceColumnRole[]): void {
  const seen = new Set<CsvFinanceColumnRole>();
  for (const role of roles) {
    if (role === "ignore") continue;
    if (seen.has(role)) {
      throw new Error(`CSV mapping names the role "${role}" twice; every role maps one column.`);
    }
    seen.add(role);
  }
  if (!seen.has("date")) {
    throw new Error("CSV mapping has no date column; a transaction cannot exist without one.");
  }
  const signed = seen.has("amount");
  const split = seen.has("outflow") || seen.has("inflow");
  if (signed && split) {
    throw new Error(
      "CSV mapping names a signed amount column AND a split outflow/inflow pair; a statement is one or the other.",
    );
  }
  if (!signed && !split) {
    throw new Error(
      "CSV mapping has no amount column: name either one signed amount column or an outflow/inflow pair.",
    );
  }
}

/** One column's cells, ragged rows read as if their missing cells were empty — which is what the spreadsheet the user is looking at shows them as. */
function columnCells(rows: readonly (readonly string[])[], index: number): string[] {
  return rows.map((row) => row[index] ?? "");
}

/** Trims to the ledger's own cap; `truncated` is what the report names, never a silent shortening. */
function cappedText(cell: string, max: number): { value: string | null; truncated: boolean } {
  const trimmed = cell.trim();
  if (trimmed.length === 0) return { value: null, truncated: false };
  if (trimmed.length <= max) return { value: trimmed, truncated: false };
  return { value: trimmed.slice(0, max), truncated: true };
}

/**
 * Turns parsed statement rows into the ledger rows an import inserts.
 *
 * `rows` are DATA rows — the caller (main's session) has already taken the
 * header off, so row numbers here are the 1-based numbers the report promises.
 *
 * The shape of the answer is deliberately narrow, exactly as `translateCsvTasks`'
 * is: a bank statement touches `fin_transactions` and nothing else, and every
 * other member of `ProfileData` is planned empty — written as one object literal
 * typed `ProfileData`, so a member added to that interface later fails to
 * compile here rather than silently arriving absent.
 *
 * Every planned row is an ordinary income/expense row: `counterAccountId` is
 * always null, because a bank statement describes ONE account and cannot know
 * that the other side of a payment is another Nexus account of the same user.
 * `categoryId` is always null for the reason `CsvFinanceColumnRole` gives.
 */
export function translateCsvFinance(
  rows: readonly (readonly string[])[],
  roles: readonly CsvFinanceColumnRole[],
  target: CsvFinanceTarget,
): CsvFinanceTranslation {
  assertFinanceMappingSound(roles);

  const column = (role: CsvFinanceColumnRole): number => roles.indexOf(role);
  const cellOf = (row: readonly string[], index: number): string =>
    index === -1 ? "" : (row[index] ?? "");

  const dateColumn = column("date");
  const amountColumn = column("amount");
  const outflowColumn = column("outflow");
  const inflowColumn = column("inflow");
  const payeeColumn = column("payee");
  const noteColumn = column("note");
  const currencyColumn = column("currency");

  // 1. The currency, first: an amount read perfectly in the wrong money is
  //    worse than one not read at all. A code is compared case-insensitively
  //    and without the terminal dot an export sometimes carries; anything else
  //    refuses the FILE, because there is no rate anywhere in this app that
  //    could honestly turn it into the account's own currency.
  if (currencyColumn !== -1) {
    for (const cell of columnCells(rows, currencyColumn)) {
      const code = cell.trim().replace(/\.+$/, "").toUpperCase();
      if (code.length === 0 || code === target.currency) continue;
      return {
        status: "refused",
        refusal: { code: "foreign-currency", column: currencyColumn, sample: cell.trim() },
      };
    }
  }

  // 2. The number convention, settled over every amount cell in the file. An
  //    outflow column and an inflow column are ONE population deliberately:
  //    they were written by one exporter in one convention, and a column of
  //    „0,00" padding carries too little evidence to settle anything alone.
  const amountColumns = amountColumn !== -1 ? [amountColumn] : [outflowColumn, inflowColumn];
  const present = amountColumns.filter((index) => index !== -1);
  const amountSamples: { cell: string; column: number }[] = [];
  for (const index of present) {
    for (const cell of columnCells(rows, index)) amountSamples.push({ cell, column: index });
  }
  const minorDigits = currencyMinorDigits(target.currency);
  const amountReading = sniffCsvFinanceAmountFormat(
    amountSamples.map((sample) => sample.cell),
    minorDigits,
  );
  if (amountReading.kind !== "format") {
    const offender = amountSamples.find(
      (sample) => sample.cell.trim() === amountReading.sample.trim(),
    );
    return {
      status: "refused",
      refusal: {
        code:
          amountReading.kind === "ambiguous"
            ? "ambiguous-amount-format"
            : "unreadable-amount-format",
        column: offender?.column ?? (present[0] ?? 0),
        sample: amountReading.sample,
      },
    };
  }

  // 3. The date convention, on exactly the same terms.
  const dateReading = sniffCsvFinanceDateFormat(columnCells(rows, dateColumn));
  if (dateReading.kind !== "format") {
    return {
      status: "refused",
      refusal: {
        code:
          dateReading.kind === "ambiguous" ? "ambiguous-date-format" : "unreadable-date-format",
        column: dateColumn,
        sample: dateReading.sample,
      },
    };
  }

  const amountFormat = amountReading.format;
  const dateFormat = dateReading.format;
  const flip = target.signConvention === "positive-is-expense";

  const transactions: ExportFinTransaction[] = [];
  const drops: CsvFinanceRowDrop[] = [];
  const skips: CsvFinanceRowSkip[] = [];
  /** How many rows identical in (date, amount, payee, note) have been read so far — `finImportKey`'s `ordinal`. */
  const occurrences = new Map<string, number>();
  let blankRows = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    if (row.every((cell) => cell.trim().length === 0)) {
      blankRows += 1;
      return;
    }

    const date = readCsvFinanceDate(cellOf(row, dateColumn), dateFormat);
    if (date === null) {
      drops.push({ row: rowNumber, code: "bad-date" });
      return;
    }

    // The amount, whichever shape the statement writes it in. A split pair is
    // read as two MAGNITUDES: an outflow's own minus sign (some exports carry
    // one) is emphasis, never a second negation, so `Math.abs` before the sign
    // this side of the ledger decides.
    let amount: number | null;
    if (amountColumn !== -1) {
      const raw = cellOf(row, amountColumn);
      amount = readCsvFinanceAmount(raw, amountFormat, minorDigits);
      if (amount === null) {
        drops.push({ row: rowNumber, code: raw.trim().length === 0 ? "no-amount" : "bad-amount" });
        return;
      }
      if (flip) amount = -amount;
    } else {
      const outRaw = cellOf(row, outflowColumn);
      const inRaw = cellOf(row, inflowColumn);
      const out = readCsvFinanceAmount(outRaw, amountFormat, minorDigits);
      const into = readCsvFinanceAmount(inRaw, amountFormat, minorDigits);
      // A padding „0,00" is an EMPTY side, not a zero movement — which is the
      // only reading under which a statement that fills both columns on every
      // row is readable at all.
      const outFilled = out !== null && out !== 0;
      const inFilled = into !== null && into !== 0;
      if (outFilled && inFilled) {
        drops.push({ row: rowNumber, code: "both-amounts" });
        return;
      }
      if (!outFilled && !inFilled) {
        const unreadable =
          (out === null && outRaw.trim().length > 0) || (into === null && inRaw.trim().length > 0);
        drops.push({ row: rowNumber, code: unreadable ? "bad-amount" : "no-amount" });
        return;
      }
      amount = outFilled ? -Math.abs(out ?? 0) : Math.abs(into ?? 0);
    }
    // Migration 051's own CHECK: a movement of nothing is not a movement.
    if (amount === 0) {
      drops.push({ row: rowNumber, code: "no-amount" });
      return;
    }

    const payee = cappedText(cellOf(row, payeeColumn), MAX_PAYEE_LENGTH);
    const note = cappedText(cellOf(row, noteColumn), MAX_NOTE_LENGTH);
    if (payee.truncated || note.truncated) drops.push({ row: rowNumber, code: "text-truncated" });

    // The occurrence number is taken BEFORE the known-key check, and a skipped
    // row still consumes it: that is what makes the second import of a
    // two-coffee day recognise both coffees rather than skip one and add one.
    const bucket = JSON.stringify([date, amount, payee.value ?? "", note.value ?? ""]);
    const ordinal = (occurrences.get(bucket) ?? 0) + 1;
    occurrences.set(bucket, ordinal);
    const importKey = finImportKey({
      date,
      amount,
      payee: payee.value,
      note: note.value,
      ordinal,
    });

    const known = target.knownKeys.get(importKey);
    if (known !== undefined) {
      skips.push({
        row: rowNumber,
        code: known ? "already-imported" : "already-imported-deleted",
      });
      return;
    }

    transactions.push({
      id: `csv:fin-tx:${rowNumber}`,
      profileId: target.profileId,
      accountId: CSV_FINANCE_ACCOUNT_SOURCE_ID,
      counterAccountId: null,
      categoryId: null,
      date,
      amount,
      payee: payee.value,
      note: note.value,
      importKey,
      createdAt: target.now,
      updatedAt: target.now,
    });
  });

  const data: ProfileData = {
    tasks: [],
    taskLists: [],
    taskSections: [],
    taskTags: [],
    taskTagLinks: [],
    taskAttachments: [],
    taskTemplates: [],
    taskDependencies: [],
    events: [],
    eventTemplates: [],
    documents: [],
    renewals: [],
    people: [],
    calendarSettings: [],
    subjects: [],
    subjectAttachments: [],
    subjectNoteLinks: [],
    exams: [],
    decks: [],
    cards: [],
    reviewLog: [],
    examTopics: [],
    plans: [],
    blocks: [],
    focusSessions: [],
    studySettings: [],
    notifications: [],
    notes: [],
    noteFolders: [],
    noteTags: [],
    noteCategories: [],
    noteTagLinks: [],
    noteTemplates: [],
    noteAttachments: [],
    noteVersions: [],
    dashboardSettings: [],
    dashboardSets: [],
    dashboardWidgets: [],
    // A statement names no account of its own and no category: the account is
    // the user's answer (seeded below) and every row lands uncategorized.
    finAccounts: [],
    finCategories: [],
    finTransactions: transactions,
    finBudgets: [],
    finRecurring: [],
    // A bank statement carries no habits (migration 055): empty, like every
    // other module this importer does not read.
    habits: [],
    habitEntries: [],
    // Nor any food log (migration 058): a bank statement records what was paid
    // for, never what was eaten.
    fitFoods: [],
    fitMealItems: [],
    fitTargets: [],
    // Nor any training log (migration 060) — same reason.
    fitExercises: [],
    fitRoutines: [],
    fitRoutineItems: [],
    fitWorkouts: [],
    fitWorkoutSets: [],
    fitMeasurements: [],
    fitBodyProfile: [],
    canvasBoards: [],
  };

  return {
    status: "ready",
    data,
    seededIds: new Map([[CSV_FINANCE_ACCOUNT_SOURCE_ID, target.accountId]]),
    report: { rows: rows.length, transactions: transactions.length, blankRows, drops, skips },
    formats: { amount: amountFormat, date: dateFormat },
  };
}
