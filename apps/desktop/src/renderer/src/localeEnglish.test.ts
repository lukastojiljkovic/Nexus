import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatCalendarAgendaDay,
  formatCalendarDayLabel,
  formatCalendarDayMonth,
  formatCalendarMonthLabel,
  formatCalendarMonthName,
  formatCalendarSemesterLabel,
  formatCalendarWeekLabel,
  formatDashboardDate,
  formatDocumentDate,
  formatLedgerDay,
} from "./dateLabels.js";
import { formatExamDate } from "./examDates.js";
import { formatFileSize } from "./fileRows.js";
import { formatFinMonthLabel } from "./financeReport.js";
import { formatKcal, formatGrams, formatFitDay, gramsInputValue, parseAmountInput } from "./fitDay.js";
import { figureText, tonnageText } from "./fitWorkoutCopy.js";
import { formatFocusSessionWhen } from "./focusFormat.js";
import { collator, dateTimeFormat } from "./intl.js";
import {
  formatMoney,
  formatMoneyPlain,
  moneyInputValue,
  parseMoneyInput,
} from "./money.js";
import { formatNotificationWhen } from "./notificationFormat.js";
import { proNum, proParse } from "./pro/format.js";
import { applyLocale, DEFAULT_LOCALE } from "./strings.js";
import { formatArchiveInstant, formatClockTime } from "./timeFormat.js";
import { formatToolAmount, formatToolNumber } from "./toolFormat.js";

/**
 * The English half of the renderer's formatting.
 *
 * Every suite in this package runs in Serbian (the process default), which is
 * exactly why this file exists: it switches to English, asserts what an English
 * reader sees, and switches back so the rest of the package is unaffected. That
 * each formatter follows a RUNTIME switch is not a detail here — the modules
 * above were all imported before `applyLocale` ever ran, so a formatter captured
 * at module scope would fail these tests.
 *
 * The expected strings are `Intl`'s own output for `en-GB`, not a hand-written
 * template: „Friday 2 October" has no comma where the Serbian form has one, and
 * the money strings keep the non-breaking space before the ISO code that the
 * Serbian tests already pin.
 */

const NBSP = "\u00a0";

afterEach(() => {
  vi.unstubAllGlobals();
  applyLocale(DEFAULT_LOCALE);
});

describe("<html lang> follows the locale", () => {
  it("is the active locale's first tag on first serve and on every switch", () => {
    const element = { lang: "sr" };
    vi.stubGlobal("document", { documentElement: element });
    applyLocale("en");
    expect(element.lang).toBe("en-GB");
    applyLocale("sr");
    expect(element.lang).toBe("sr-Latn");
  });
});

/** A local wall-clock instant, so a test never depends on the machine's zone. */
function localInstant(): Date {
  return new Date(2026, 6, 8, 14, 32, 0, 0);
}

describe("date labels in English", () => {
  it("writes the dashboard's date line in English", () => {
    applyLocale("en");
    expect(formatDashboardDate(new Date(2026, 9, 2))).toBe("Friday 2 October");
    applyLocale("sr");
    expect(formatDashboardDate(new Date(2026, 9, 2))).toBe("petak, 2. oktobar");
  });

  it("writes exam and document dates in English", () => {
    applyLocale("en");
    expect(formatExamDate("2026-07-08")).toBe("8 July 2026");
    expect(formatDocumentDate("2026-07-08")).toBe("8 July 2026");
    applyLocale("sr");
    expect(formatExamDate("2026-07-08")).toBe("8. jul 2026.");
    expect(formatDocumentDate("2026-07-08")).toBe("8. jul 2026.");
  });

  it("writes the calendar's month, week, semester and day labels in English", () => {
    applyLocale("en");
    expect(formatCalendarMonthLabel("2026-07-01")).toBe("July 2026");
    expect(formatCalendarMonthName("2026-08-01")).toBe("August");
    expect(formatCalendarDayMonth("2026-08-09")).toBe("9 August");
    expect(
      formatCalendarWeekLabel([
        "2026-08-03",
        "2026-08-04",
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
        "2026-08-08",
        "2026-08-09",
      ]),
    ).toBe("3 — 9 August 2026");
    expect(formatCalendarSemesterLabel(["2026-07-01", "2026-10-01"])).toBe("July — October 2026");
    expect(formatCalendarDayLabel("2026-07-08")).toBe("Wednesday, 8 July 2026");
    expect(formatCalendarAgendaDay("2026-07-08")).toBe("Wednesday 8 July");

    applyLocale("sr");
    expect(formatCalendarMonthLabel("2026-07-01")).toBe("jul 2026.");
    expect(
      formatCalendarWeekLabel([
        "2026-08-03",
        "2026-08-04",
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
        "2026-08-08",
        "2026-08-09",
      ]),
    ).toBe("3 — 9. avgust 2026");
    expect(formatCalendarSemesterLabel(["2026-07-01", "2026-10-01"])).toBe("jul — oktobar 2026");
    expect(formatCalendarDayLabel("2026-07-08")).toBe("sreda, 8. jul 2026.");
  });

  it("writes the ledger's day and the finance report's month in English", () => {
    applyLocale("en");
    expect(formatLedgerDay("2026-08-07")).toBe("Fri, 7 Aug 2026");
    expect(formatFinMonthLabel("2026-07")).toBe("July 2026");
    applyLocale("sr");
    expect(formatLedgerDay("2026-08-07")).toBe("pet, 7. avg 2026.");
    expect(formatFinMonthLabel("2026-07")).toBe("jul 2026.");
  });

  it("writes the focus row, the clock, the archive stamp and the notification stamp in English", () => {
    const instant = localInstant().toISOString();
    applyLocale("en");
    expect(formatFocusSessionWhen(instant)).toBe("Wednesday 8 July, 14:32");
    expect(formatClockTime(instant)).toBe("14:32");
    expect(formatArchiveInstant(instant)).toBe("8 July 2026 14:32");
    expect(formatNotificationWhen(new Date(2020, 6, 8, 14, 32).toISOString())).toBe("8 Jul, 14:32");
    applyLocale("sr");
    expect(formatFocusSessionWhen(instant)).toBe("sreda, 8. jul, 14:32");
    expect(formatArchiveInstant(instant)).toBe("8. jul 2026. 14:32");
  });

  it("keeps a date in the requested locale when one is passed explicitly", () => {
    expect(dateTimeFormat({ month: "long" }, "en").format(new Date(2026, 7, 1))).toBe("August");
    expect(dateTimeFormat({ month: "long" }, "sr").format(new Date(2026, 7, 1))).toBe("avgust");
  });
});

describe("numbers, sizes and money in English", () => {
  it("writes file sizes with the English decimal point and grouping", () => {
    applyLocale("en");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(2_621_440)).toBe("2.5 MB");
    applyLocale("sr");
    expect(formatFileSize(1536)).toBe("1,5 KB");
  });

  it("writes money in two currencies, including a negative amount", () => {
    applyLocale("en");
    expect(formatMoney(123_456_789, "RSD")).toBe(`RSD${NBSP}1,234,567.89`);
    expect(formatMoney(1234, "EUR")).toBe(`EUR${NBSP}12.34`);
    expect(formatMoney(-1234, "RSD")).toBe(`-RSD${NBSP}12.34`);
    expect(formatMoneyPlain(123_456_789, "EUR")).toBe("1,234,567.89");
    applyLocale("sr");
    expect(formatMoney(123_456_789, "RSD")).toBe(`1.234.567,89${NBSP}RSD`);
    expect(formatMoney(1234, "EUR")).toBe(`12,34${NBSP}EUR`);
    expect(formatMoney(-1234, "RSD")).toBe(`-12,34${NBSP}RSD`);
    expect(formatMoneyPlain(123_456_789, "EUR")).toBe("1.234.567,89");
  });

  it("writes fitness figures in English", () => {
    applyLocale("en");
    expect(formatKcal(1234)).toBe("1,234");
    expect(formatGrams(87.5)).toBe("87.5");
    expect(figureText(1234.5)).toBe("1,234.5");
    expect(tonnageText(4280)).toBe("4,280");
    expect(formatFitDay("2026-08-05")).toBe("5 Aug 2026");
    applyLocale("sr");
    expect(formatKcal(1234)).toBe("1.234");
    expect(formatGrams(87.5)).toBe("87,5");
    expect(figureText(1234.5)).toBe("1.234,5");
    expect(tonnageText(4280)).toBe("4.280");
    expect(formatFitDay("2026-08-05")).toBe("5. avg 2026.");
  });

  it("writes the tool drawer's figures in English", () => {
    applyLocale("en");
    expect(formatToolNumber(1234.5)).toBe("1,234.5");
    expect(formatToolAmount(1234.5)).toBe("1,234.50");
    applyLocale("sr");
    expect(formatToolNumber(1234.5)).toBe("1.234,5");
    expect(formatToolAmount(1234.5)).toBe("1.234,50");
  });
});

describe("every parser reads what its own locale's formatter wrote", () => {
  it("money round-trips in Serbian and English", () => {
    for (const locale of ["sr", "en"] as const) {
      applyLocale(locale);
      for (const [minorUnits, currency] of [
        [1234, "RSD"],
        [-1234, "RSD"],
        [0, "RSD"],
        [5, "EUR"],
        [1234, "JPY"],
      ] as const) {
        const text = moneyInputValue(minorUnits, currency);
        expect(parseMoneyInput(text, currency), `${locale} ${text}`).toBe(minorUnits);
      }
    }
  });

  it("money reads BOTH shipped decimal marks, whichever the locale is", () => {
    applyLocale("en");
    expect(moneyInputValue(1234, "RSD")).toBe("12.34");
    expect(parseMoneyInput("12.34", "RSD")).toBe(1234);
    expect(parseMoneyInput("12,34", "RSD")).toBe(1234);
    applyLocale("sr");
    expect(moneyInputValue(1234, "RSD")).toBe("12,34");
    expect(parseMoneyInput("12,34", "RSD")).toBe(1234);
    expect(parseMoneyInput("12.34", "RSD")).toBe(1234);
  });

  it("the grams field round-trips in both locales", () => {
    applyLocale("en");
    expect(gramsInputValue(12.5)).toBe("12.5");
    expect(parseAmountInput(gramsInputValue(12.5))).toBe(12.5);
    expect(parseAmountInput("12,5")).toBe(12.5);
    applyLocale("sr");
    expect(gramsInputValue(12.5)).toBe("12,5");
    expect(parseAmountInput(gramsInputValue(12.5))).toBe(12.5);
  });

  it("the professional drawer round-trips in both locales", () => {
    applyLocale("en");
    expect(proNum(1234.5, 2)).toBe("1,234.50");
    expect(proParse(proNum(1234.5, 2))).toBe(1234.5);
    expect(proParse("1.234,56")).toBe(1234.56);
    applyLocale("sr");
    expect(proNum(1234.5, 2)).toBe("1.234,50");
    expect(proParse(proNum(1234.5, 2))).toBe(1234.5);
  });
});

describe("a formatter follows a switch made after its module was imported", () => {
  it("re-formats after an applyLocale that happens later in the process", () => {
    // `fileRows`, `money`, `toolFormat` and the rest were imported at the top of
    // THIS file, i.e. before any `applyLocale` ran in it. A formatter captured at
    // module scope would be Serbian forever; these change with the table.
    applyLocale("sr");
    const serbian = formatFileSize(1536);
    const serbianTool = formatToolNumber(1234.5);
    const serbianCollator = collator();

    applyLocale("en");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatToolNumber(1234.5)).toBe("1,234.5");
    expect(formatFileSize(1536)).not.toBe(serbian);
    expect(formatToolNumber(1234.5)).not.toBe(serbianTool);
    // The collator is keyed by locale too, so an alphabetical list re-sorts.
    expect(collator()).not.toBe(serbianCollator);
  });
});
