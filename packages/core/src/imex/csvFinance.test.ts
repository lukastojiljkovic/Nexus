import { describe, expect, it } from "vitest";
import { growthToFull, LINEAR_GROWTH } from "../testing/growth.js";
import {
  CSV_FINANCE_ACCOUNT_SOURCE_ID,
  CSV_FINANCE_COLUMN_ROLES,
  currencyMinorDigits,
  finImportKey,
  readCsvFinanceAmount,
  readCsvFinanceDate,
  sniffCsvFinanceAmountFormat,
  sniffCsvFinanceDateFormat,
  suggestCsvFinanceMapping,
  translateCsvFinance,
} from "./csvFinance.js";
import type { CsvFinanceColumnRole, CsvFinanceTarget } from "./csvFinance.js";

const NOW = "2026-08-01T09:00:00.000Z";

function target(overrides: Partial<CsvFinanceTarget> = {}): CsvFinanceTarget {
  return {
    profileId: "p1",
    now: NOW,
    accountId: "acc-1",
    currency: "RSD",
    signConvention: "negative-is-expense",
    knownKeys: new Map(),
    ...overrides,
  };
}

describe("currencyMinorDigits", () => {
  it("states ISO 4217's exponent rather than assuming two", () => {
    expect(currencyMinorDigits("RSD")).toBe(2);
    expect(currencyMinorDigits("EUR")).toBe(2);
    expect(currencyMinorDigits("JPY")).toBe(0);
    expect(currencyMinorDigits("KWD")).toBe(3);
    expect(currencyMinorDigits("CLF")).toBe(4);
  });

  it("falls back to ISO's own default of two for a code the table does not name", () => {
    expect(currencyMinorDigits("ZZZ")).toBe(2);
  });

  it("is case-insensitive, so a lower-case code cannot fail open to two", () => {
    expect(currencyMinorDigits("jpy")).toBe(0);
    expect(currencyMinorDigits("kwd")).toBe(3);
  });

  // THE REGRESSION THIS BLOCK EXISTS FOR.
  //
  // The exponent used to be read from `Intl.NumberFormat().resolvedOptions()`,
  // which answers a DISPLAY question out of whichever CLDR the process happens
  // to bundle. Node and Chromium disagree about exactly one currency that
  // matters here: Node resolves RSD to 2, and Chromium — where the app actually
  // runs — to 0, because Serbia has written dinars without para for years and
  // CLDR records the custom. So this suite passed under Node, agreed with ISO,
  // and the shipped app rendered every dinar figure ONE HUNDRED TIMES TOO LARGE
  // while a CSV import parsed one a hundred times too small.
  //
  // Pinning the answer AGAINST the runtime's is what makes the class
  // unrepresentable: an implementation that merely forwards whatever ICU says
  // cannot satisfy this and the RSD assertion above on both runtimes at once.
  it("does not ask the runtime, whose display convention may differ from the ISO exponent", () => {
    const displayDigits = new Intl.NumberFormat("sr-Latn", {
      style: "currency",
      currency: "RSD",
      currencyDisplay: "code",
    }).resolvedOptions().maximumFractionDigits;
    // Whatever this runtime's CLDR says — 0 on Chromium, 2 on Node — the stored
    // scale is ISO's, and it is 2.
    expect(currencyMinorDigits("RSD")).toBe(2);
    expect([0, 2]).toContain(displayDigits);
  });
});

describe("suggestCsvFinanceMapping", () => {
  it("recognises the Serbian and English header names a bank export actually writes", () => {
    expect(
      suggestCsvFinanceMapping([
        "Datum",
        "Opis transakcije",
        "Zaduženje",
        "Odobrenje",
        "Valuta",
        "Primalac",
      ]),
    ).toEqual(["date", "note", "outflow", "inflow", "currency", "payee"]);
  });

  it("reads a signed amount column as `amount`", () => {
    expect(suggestCsvFinanceMapping(["Datum knjiženja", "Iznos"])).toEqual(["date", "amount"]);
  });

  it("gives each role to the FIRST column claiming it and ignores the rest", () => {
    expect(suggestCsvFinanceMapping(["Datum", "Datum valute", "Iznos"])).toEqual([
      "date",
      "ignore",
      "amount",
    ]);
  });

  it("suggests `ignore` for a header it cannot read and for a file with no header row", () => {
    expect(suggestCsvFinanceMapping(["Referentni broj naloga", null])).toEqual([
      "ignore",
      "ignore",
    ]);
  });

  it("offers `ignore` last, so the way out is never the first option", () => {
    expect(CSV_FINANCE_COLUMN_ROLES.at(-1)).toBe("ignore");
    expect(CSV_FINANCE_COLUMN_ROLES.at(0)).toBe("date");
  });
});

describe("sniffCsvFinanceAmountFormat", () => {
  it("reads the grouped Serbian convention from the column as a whole", () => {
    const reading = sniffCsvFinanceAmountFormat(["1.234,56", "-980,00", "12.000,00"], 2);
    expect(reading).toEqual({ kind: "format", format: "decimal-comma" });
  });

  it("reads the grouped English convention the same way", () => {
    const reading = sniffCsvFinanceAmountFormat(["1,234.56", "-980.00", "12,000.00"], 2);
    expect(reading).toEqual({ kind: "format", format: "decimal-dot" });
  });

  it("deduces the convention for a lone „1.234“ from the currency's own exponent", () => {
    // Under decimal-dot, „.234" would be three fraction digits, which RSD cannot
    // hold — so 1234 is the only reading the column admits, not a guess.
    expect(sniffCsvFinanceAmountFormat(["1.234"], 2)).toEqual({
      kind: "format",
      format: "decimal-comma",
    });
  });

  it("refuses „1.234“ when the currency CAN hold three fraction digits", () => {
    const reading = sniffCsvFinanceAmountFormat(["1.234"], 3);
    expect(reading).toEqual({ kind: "ambiguous", sample: "1.234" });
  });

  it("refuses a column whose two conventions read different halves of it", () => {
    expect(sniffCsvFinanceAmountFormat(["1,234", "5.678"], 2)).toEqual({
      kind: "ambiguous",
      sample: "1,234",
    });
  });

  it("settles a column of bare integers without a refusal — both readings agree", () => {
    expect(sniffCsvFinanceAmountFormat(["100", "-250", ""], 2)).toEqual({
      kind: "format",
      format: "decimal-comma",
    });
  });

  it("lets a majority outvote one unreadable cell rather than refusing the file for it", () => {
    // A totals footer („Ukupno") is a row the import drops by name; it must not
    // cost the column its format.
    expect(sniffCsvFinanceAmountFormat(["1.234,56", "980,00", "Ukupno"], 2)).toEqual({
      kind: "format",
      format: "decimal-comma",
    });
  });

  it("says so when no cell of the column reads as money at all", () => {
    expect(sniffCsvFinanceAmountFormat(["Ukupno", "n/a"], 2)).toEqual({
      kind: "unreadable",
      sample: "Ukupno",
    });
  });

  it("has nothing to settle for a wholly empty column", () => {
    expect(sniffCsvFinanceAmountFormat(["", "   "], 2)).toEqual({
      kind: "format",
      format: "decimal-comma",
    });
  });
});

describe("readCsvFinanceAmount", () => {
  it("reads grouped decimals into exact minor units", () => {
    expect(readCsvFinanceAmount("1.234,56", "decimal-comma", 2)).toBe(123456);
    expect(readCsvFinanceAmount("-1.234,56", "decimal-comma", 2)).toBe(-123456);
    expect(readCsvFinanceAmount("1,234.56", "decimal-dot", 2)).toBe(123456);
  });

  it("reads a whole number as whole MAJOR units", () => {
    expect(readCsvFinanceAmount("1234", "decimal-comma", 2)).toBe(123400);
    expect(readCsvFinanceAmount("1234", "decimal-comma", 0)).toBe(1234);
  });

  it("treats every kind of space as grouping, including the invisible ones", () => {
    expect(readCsvFinanceAmount("1 234,56", "decimal-comma", 2)).toBe(123456);
    // U+00A0 (no-break) and U+202F (narrow no-break): what a spreadsheet
    // actually writes, and what a reader of this file would never see.
    expect(readCsvFinanceAmount("1\u00a0234,56", "decimal-comma", 2)).toBe(123456);
    expect(readCsvFinanceAmount("1\u202f234,56", "decimal-comma", 2)).toBe(123456);
  });

  it("refuses a grouping run that is not three digits, rather than reading it as a decimal", () => {
    expect(readCsvFinanceAmount("1.23", "decimal-comma", 2)).toBeNull();
    expect(readCsvFinanceAmount("1.2345", "decimal-comma", 2)).toBeNull();
  });

  it("refuses a fraction longer than the currency can hold — never rounds money", () => {
    expect(readCsvFinanceAmount("12,345", "decimal-comma", 2)).toBeNull();
    expect(readCsvFinanceAmount("12,3", "decimal-comma", 0)).toBeNull();
  });

  it("pads a short fraction rather than reading it as the wrong magnitude", () => {
    expect(readCsvFinanceAmount("12,5", "decimal-comma", 2)).toBe(1250);
  });

  it("refuses anything that is not a plain signed number", () => {
    expect(readCsvFinanceAmount("1.234,56 RSD", "decimal-comma", 2)).toBeNull();
    expect(readCsvFinanceAmount("(1.234,56)", "decimal-comma", 2)).toBeNull();
    expect(readCsvFinanceAmount("", "decimal-comma", 2)).toBeNull();
  });

  it("refuses an amount past the safe-integer bound instead of storing a different number", () => {
    expect(readCsvFinanceAmount("99999999999999999999", "decimal-comma", 2)).toBeNull();
  });
});

describe("sniffCsvFinanceDateFormat", () => {
  it("reads the Serbian norm, trailing dot and all", () => {
    expect(sniffCsvFinanceDateFormat(["31.08.2026.", "1. 9. 2026."])).toEqual({
      kind: "format",
      format: "dmy-dot",
    });
  });

  it("reads ISO", () => {
    expect(sniffCsvFinanceDateFormat(["2026-08-31", "2026-09-01"])).toEqual({
      kind: "format",
      format: "iso",
    });
  });

  it("refuses a slashed column every reading fits and the two disagree about", () => {
    expect(sniffCsvFinanceDateFormat(["01/02/2026", "03/04/2026"])).toEqual({
      kind: "ambiguous",
      sample: "01/02/2026",
    });
  });

  it("settles the same column the moment one day is past the twelfth", () => {
    expect(sniffCsvFinanceDateFormat(["01/02/2026", "13/02/2026"])).toEqual({
      kind: "format",
      format: "dmy-slash",
    });
    expect(sniffCsvFinanceDateFormat(["02/13/2026", "02/01/2026"])).toEqual({
      kind: "format",
      format: "mdy-slash",
    });
  });

  it("drops a trailing time rather than refusing the cell for it", () => {
    expect(sniffCsvFinanceDateFormat(["31.08.2026. 14:32", "01.09.2026 09:05:11"])).toEqual({
      kind: "format",
      format: "dmy-dot",
    });
  });

  it("lets a majority outvote one unreadable cell", () => {
    expect(sniffCsvFinanceDateFormat(["31.08.2026.", "01.09.2026.", "Ukupno"])).toEqual({
      kind: "format",
      format: "dmy-dot",
    });
  });

  it("says so when no reading fits any cell", () => {
    expect(sniffCsvFinanceDateFormat(["avgust 2026", "n/a"])).toEqual({
      kind: "unreadable",
      sample: "avgust 2026",
    });
  });
});

describe("readCsvFinanceDate", () => {
  it("normalizes every reading to a bare ISO day", () => {
    expect(readCsvFinanceDate("31.08.2026.", "dmy-dot")).toBe("2026-08-31");
    expect(readCsvFinanceDate("1. 9. 2026", "dmy-dot")).toBe("2026-09-01");
    expect(readCsvFinanceDate("2026-08-31", "iso")).toBe("2026-08-31");
    expect(readCsvFinanceDate("31/08/2026", "dmy-slash")).toBe("2026-08-31");
    expect(readCsvFinanceDate("08/31/2026", "mdy-slash")).toBe("2026-08-31");
  });

  it("refuses a day the calendar does not have, rather than rolling it into the next month", () => {
    expect(readCsvFinanceDate("30.02.2026.", "dmy-dot")).toBeNull();
    expect(readCsvFinanceDate("2026-02-30", "iso")).toBeNull();
  });

  it("refuses a two-digit year rather than guessing the century", () => {
    expect(readCsvFinanceDate("31.08.26.", "dmy-dot")).toBeNull();
  });
});

describe("finImportKey", () => {
  it("is the row's own facts, and identical facts give an identical key", () => {
    const one = finImportKey({ date: "2026-08-31", amount: -35000, payee: "KAFETERIJA", note: null, ordinal: 1 });
    const two = finImportKey({ date: "2026-08-31", amount: -35000, payee: "KAFETERIJA", note: null, ordinal: 1 });
    expect(one).toBe(two);
  });

  it("separates two genuinely identical rows by their occurrence number", () => {
    const first = finImportKey({ date: "2026-08-31", amount: -35000, payee: "KAFETERIJA", note: null, ordinal: 1 });
    const second = finImportKey({ date: "2026-08-31", amount: -35000, payee: "KAFETERIJA", note: null, ordinal: 2 });
    expect(first).not.toBe(second);
  });

  it("names no account: the account is a column of its own on the row", () => {
    expect(finImportKey({ date: "2026-08-31", amount: -1, payee: null, note: null, ordinal: 1 })).not.toContain(
      "acc-1",
    );
  });
});

describe("translateCsvFinance", () => {
  const roles: CsvFinanceColumnRole[] = ["date", "note", "amount"];

  it("turns a signed-amount statement into ledger rows on the chosen account", () => {
    const result = translateCsvFinance(
      [
        ["31.08.2026.", "KUPOVINA MAXI", "-1.234,56"],
        ["01.09.2026.", "PLATA", "85.000,00"],
      ],
      roles,
      target(),
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.data.finTransactions).toEqual([
      expect.objectContaining({
        accountId: CSV_FINANCE_ACCOUNT_SOURCE_ID,
        profileId: "p1",
        counterAccountId: null,
        categoryId: null,
        date: "2026-08-31",
        amount: -123456,
        payee: null,
        note: "KUPOVINA MAXI",
      }),
      expect.objectContaining({ date: "2026-09-01", amount: 8500000, note: "PLATA" }),
    ]);
    expect(result.seededIds.get(CSV_FINANCE_ACCOUNT_SOURCE_ID)).toBe("acc-1");
    expect(result.report).toMatchObject({ rows: 2, transactions: 2, blankRows: 0, drops: [], skips: [] });
    expect(result.formats).toEqual({ amount: "decimal-comma", date: "dmy-dot" });
  });

  it("flips every sign when the user says a POSITIVE amount is the expense", () => {
    const result = translateCsvFinance(
      [["31.08.2026.", "KUPOVINA", "1.234,56"]],
      roles,
      target({ signConvention: "positive-is-expense" }),
    );
    if (result.status !== "ready") throw new Error(result.status);
    expect(result.data.finTransactions[0]?.amount).toBe(-123456);
  });

  it("reads separate outflow and inflow columns, each as a magnitude", () => {
    const result = translateCsvFinance(
      [
        ["31.08.2026.", "KUPOVINA", "1.234,56", "0,00"],
        ["01.09.2026.", "PLATA", "", "85.000,00"],
      ],
      ["date", "note", "outflow", "inflow"],
      target(),
    );
    if (result.status !== "ready") throw new Error(result.status);
    expect(result.data.finTransactions.map((row) => row.amount)).toEqual([-123456, 8500000]);
  });

  it("takes an outflow's own minus sign as emphasis, never as a second negation", () => {
    const result = translateCsvFinance(
      [["31.08.2026.", "KUPOVINA", "-1.234,56", ""]],
      ["date", "note", "outflow", "inflow"],
      target(),
    );
    if (result.status !== "ready") throw new Error(result.status);
    expect(result.data.finTransactions[0]?.amount).toBe(-123456);
  });

  it("names a row that fills BOTH sides rather than choosing one", () => {
    const result = translateCsvFinance(
      [["31.08.2026.", "?", "100,00", "200,00"]],
      ["date", "note", "outflow", "inflow"],
      target(),
    );
    if (result.status !== "ready") throw new Error(result.status);
    expect(result.report.drops).toEqual([{ row: 1, code: "both-amounts" }]);
    expect(result.data.finTransactions).toHaveLength(0);
  });

  it("names a row with no amount, no date or an unreadable amount, and keeps the rest", () => {
    const result = translateCsvFinance(
      [
        ["31.08.2026.", "OK", "-100,00"],
        ["", "BEZ DATUMA", "-100,00"],
        ["01.09.2026.", "BEZ IZNOSA", ""],
        ["02.09.2026.", "UKUPNO", "n/a"],
        ["03.09.2026.", "NULA", "0,00"],
      ],
      roles,
      target(),
    );
    if (result.status !== "ready") throw new Error(result.status);
    expect(result.report.drops).toEqual([
      { row: 2, code: "bad-date" },
      { row: 3, code: "no-amount" },
      { row: 4, code: "bad-amount" },
      { row: 5, code: "no-amount" },
    ]);
    expect(result.report.transactions).toBe(1);
  });

  it("skips blank spreadsheet lines silently and still balances its arithmetic", () => {
    const result = translateCsvFinance(
      [["31.08.2026.", "OK", "-100,00"], ["", "", ""]],
      roles,
      target(),
    );
    if (result.status !== "ready") throw new Error(result.status);
    expect(result.report).toMatchObject({ rows: 2, transactions: 1, blankRows: 1, drops: [] });
  });

  it("truncates an over-long description to what the ledger holds, and names the loss", () => {
    const long = "X".repeat(600);
    const result = translateCsvFinance([["31.08.2026.", long, "-100,00"]], roles, target());
    if (result.status !== "ready") throw new Error(result.status);
    expect(result.data.finTransactions[0]?.note).toHaveLength(500);
    expect(result.report.drops).toEqual([{ row: 1, code: "text-truncated" }]);
  });

  // --- refusals -------------------------------------------------------------

  it("refuses the whole file when the amount column admits two readings", () => {
    const result = translateCsvFinance(
      [["31.08.2026.", "A", "1,234"], ["01.09.2026.", "B", "5.678"]],
      roles,
      target(),
    );
    expect(result).toEqual({
      status: "refused",
      refusal: { code: "ambiguous-amount-format", column: 2, sample: "1,234" },
    });
  });

  it("refuses the whole file when the date column admits two readings", () => {
    const result = translateCsvFinance(
      [["01/02/2026", "A", "-100,00"], ["03/04/2026", "B", "-100,00"]],
      roles,
      target(),
    );
    expect(result).toEqual({
      status: "refused",
      refusal: { code: "ambiguous-date-format", column: 0, sample: "01/02/2026" },
    });
  });

  it("refuses a file whose amount column reads as money nowhere", () => {
    const result = translateCsvFinance([["31.08.2026.", "A", "n/a"]], roles, target());
    expect(result).toEqual({
      status: "refused",
      refusal: { code: "unreadable-amount-format", column: 2, sample: "n/a" },
    });
  });

  it("refuses a file whose date column reads as a day nowhere", () => {
    const result = translateCsvFinance([["avgust", "A", "-100,00"]], roles, target());
    expect(result).toEqual({
      status: "refused",
      refusal: { code: "unreadable-date-format", column: 0, sample: "avgust" },
    });
  });

  it("refuses a statement in a currency the chosen account does not hold", () => {
    const result = translateCsvFinance(
      [["31.08.2026.", "A", "-100,00", "EUR"]],
      ["date", "note", "amount", "currency"],
      target(),
    );
    expect(result).toEqual({
      status: "refused",
      refusal: { code: "foreign-currency", column: 3, sample: "EUR" },
    });
  });

  it("accepts the account's own currency, however the file spells its case", () => {
    const result = translateCsvFinance(
      [["31.08.2026.", "A", "-100,00", "rsd."]],
      ["date", "note", "amount", "currency"],
      target(),
    );
    expect(result.status).toBe("ready");
  });

  it("refuses a mapping with no date column and one with no amount at all", () => {
    expect(() => translateCsvFinance([["a"]], ["note"], target())).toThrow(/date/i);
    expect(() => translateCsvFinance([["a"]], ["date"], target())).toThrow(/amount/i);
  });

  it("refuses a mapping that names a signed amount AND a split pair", () => {
    expect(() =>
      translateCsvFinance([["a", "b", "c"]], ["date", "amount", "outflow"], target()),
    ).toThrow(/signed|split/i);
  });

  // --- re-import ------------------------------------------------------------

  it("skips a row the ledger already imported, and names the skip", () => {
    const key = finImportKey({
      date: "2026-08-31",
      amount: -123456,
      payee: null,
      note: "KUPOVINA MAXI",
      ordinal: 1,
    });
    const result = translateCsvFinance(
      [["31.08.2026.", "KUPOVINA MAXI", "-1.234,56"]],
      roles,
      target({ knownKeys: new Map([[key, true]]) }),
    );
    if (result.status !== "ready") throw new Error(result.status);
    expect(result.data.finTransactions).toHaveLength(0);
    expect(result.report.skips).toEqual([{ row: 1, code: "already-imported" }]);
  });

  it("says when the row it is skipping was imported and then DELETED — it stays deleted", () => {
    const key = finImportKey({
      date: "2026-08-31",
      amount: -123456,
      payee: null,
      note: "KUPOVINA MAXI",
      ordinal: 1,
    });
    const result = translateCsvFinance(
      [["31.08.2026.", "KUPOVINA MAXI", "-1.234,56"]],
      roles,
      target({ knownKeys: new Map([[key, false]]) }),
    );
    if (result.status !== "ready") throw new Error(result.status);
    expect(result.report.skips).toEqual([{ row: 1, code: "already-imported-deleted" }]);
  });

  it("keeps two genuinely identical rows apart — two coffees on one day are two coffees", () => {
    const rows = [
      ["31.08.2026.", "KAFA", "-350,00"],
      ["31.08.2026.", "KAFA", "-350,00"],
    ];
    const first = translateCsvFinance(rows, roles, target());
    if (first.status !== "ready") throw new Error(first.status);
    expect(first.data.finTransactions).toHaveLength(2);
    const keys = first.data.finTransactions.map((row) => row.importKey);
    expect(new Set(keys).size).toBe(2);

    // The SAME file again, against the ledger the first import produced: both
    // rows are recognised, neither is duplicated.
    const known = new Map(keys.map((key) => [key ?? "", true]));
    const second = translateCsvFinance(rows, roles, target({ knownKeys: known }));
    if (second.status !== "ready") throw new Error(second.status);
    expect(second.data.finTransactions).toHaveLength(0);
    expect(second.report.skips).toHaveLength(2);

    // A statement that genuinely holds a THIRD coffee brings exactly one row.
    const third = translateCsvFinance([...rows, ["31.08.2026.", "KAFA", "-350,00"]], roles, target({
      knownKeys: known,
    }));
    if (third.status !== "ready") throw new Error(third.status);
    expect(third.data.finTransactions).toHaveLength(1);
    expect(third.report.skips).toHaveLength(2);
  });

  it("plans no row of any other module — a bank statement is a ledger and nothing else", () => {
    const result = translateCsvFinance([["31.08.2026.", "A", "-100,00"]], roles, target());
    if (result.status !== "ready") throw new Error(result.status);
    const { finTransactions, ...rest } = result.data;
    expect(finTransactions).toHaveLength(1);
    for (const [name, rows] of Object.entries(rest)) {
      expect(rows, name).toEqual([]);
    }
  });

  it("reads a ragged row as if its missing cells were empty", () => {
    const result = translateCsvFinance([["31.08.2026."]], roles, target());
    if (result.status !== "ready") throw new Error(result.status);
    expect(result.report.drops).toEqual([{ row: 1, code: "no-amount" }]);
  });
});

/**
 * #9 and #10: the trailing clock and the trailing dots.
 *
 * Both were matched with a pattern that re-walked the run from every place a
 * match could start, which is quadratic on a cell of spaces or of dots. Pinned
 * on the values first - including the cells the trims around the call make
 * equal - and then on the run itself.
 */
describe("the date and currency cells give up their tail in one pass", () => {
  const PUMP = 50_000;

  it("still reads a date with the clock a statement appends", () => {
    expect(readCsvFinanceDate("31.08.2026. 14:32", "dmy-dot")).toBe("2026-08-31");
    expect(readCsvFinanceDate("31.08.2026. 14:32:07", "dmy-dot")).toBe("2026-08-31");
    expect(readCsvFinanceDate("31.08.2026.\u00a014:32", "dmy-dot")).toBe("2026-08-31");
    // Several spaces, because the run is what the old pattern ate and the new
    // one leaves to the trim either side of it.
    expect(readCsvFinanceDate("  31.08.2026.    14:32  ", "dmy-dot")).toBe("2026-08-31");
  });

  it("still refuses a cell that is nothing but a clock", () => {
    // The old pattern required a whitespace BEFORE the clock, so a cell of only
    // `14:32` was never a date, and the reading must not change.
    expect(readCsvFinanceDate("14:32", "dmy-dot")).toBeNull();
    expect(readCsvFinanceDate("31.08.2026.", "dmy-dot")).toBe("2026-08-31");
  });

  it("answers 50,000 spaces mid-cell without re-walking the run", () => {
    const cell = (count: number): string => "x" + " ".repeat(count) + "y";
    const read = (text: string) => readCsvFinanceDate(text, "dmy-dot");
    expect(growthToFull(cell, read, PUMP)).toBeLessThan(LINEAR_GROWTH);
    expect(read(cell(PUMP))).toBeNull();
  });

  it("strips every trailing dot from a currency code", () => {
    const roles: CsvFinanceColumnRole[] = ["date", "note", "amount", "currency"];
    expect(
      translateCsvFinance([["31.08.2026.", "A", "-100,00", "RSD.."]], roles, target()).status,
    ).toBe("ready");
    // A cell of nothing but dots is an EMPTY code, which this reader skips
    // rather than refuses - the branch the pattern's reach decided.
    expect(
      translateCsvFinance([["31.08.2026.", "A", "-100,00", "..."]], roles, target()).status,
    ).toBe("ready");
  });

  it("answers 50,000 dots in a currency cell without re-walking the run", () => {
    const cell = (count: number): string => ".".repeat(count) + "X";
    const translate = (currency: string) =>
      translateCsvFinance(
        [["31.08.2026.", "A", "-100,00", currency]],
        ["date", "note", "amount", "currency"],
        target(),
      );
    expect(growthToFull(cell, translate, PUMP)).toBeLessThan(LINEAR_GROWTH);
    const result = translate(cell(PUMP));
    // The dots are stripped and the code that is left is not this account's.
    expect(result.status).toBe("refused");
  });
});
