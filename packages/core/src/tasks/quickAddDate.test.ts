import { describe, expect, it } from "vitest";

import { MAX_RELATIVE_DAYS, parseQuickAddDate } from "./quickAddDate.js";

// Fixed anchors — the parser is pure, so "today" is always spelled out.
const THU = "2026-07-30"; // Thursday
const FRI = "2026-07-31"; // Friday
/** One full week, Monday through Sunday, for the weekday arithmetic. */
const WEEK = {
  monday: "2026-08-03",
  tuesday: "2026-08-04",
  wednesday: "2026-08-05",
  thursday: "2026-08-06",
  friday: "2026-08-07",
  saturday: "2026-08-08",
  sunday: "2026-08-09",
} as const;

/** The resolved date only — the shape-level assertions live in their own blocks. */
function dateOf(input: string, today: string = THU): string | null {
  return parseQuickAddDate(input, today)?.date ?? null;
}

function expectTable(rows: readonly (readonly [string, string | null])[], today: string = THU): void {
  for (const [input, expected] of rows) {
    expect(dateOf(input, today), input).toBe(expected);
  }
}

describe("parseQuickAddDate — relative words", () => {
  it("resolves the Serbian and English relative days", () => {
    expectTable([
      ["danas", THU],
      ["sutra", "2026-07-31"],
      ["prekosutra", "2026-08-01"],
      ["today", THU],
      ["tomorrow", "2026-07-31"],
    ]);
  });

  it("is case-insensitive and keeps the input's casing in the phrase", () => {
    const match = parseQuickAddDate("Kupi mleko SUTRA", THU);
    expect(match?.date).toBe("2026-07-31");
    expect(match?.phrase).toBe("SUTRA");
  });

  it("matches Cyrillic through the shared search folding", () => {
    expect(dateOf("данас")).toBe(THU);
    expect(parseQuickAddDate("у четвртак", THU)?.date).toBe(THU);
  });

  it("never matches a phrase buried inside a longer word", () => {
    expectTable([
      ["sutrašnji plan", null],
      ["sutrasnji plan", null],
      ["danasnji dan", null],
      ["danassutra", null],
      ["todays plan", null],
      ["tomorrows plan", null],
      ["prekosutrašnji", null],
    ]);
  });

  it("reads prekosutra as itself, not as the sutra inside it", () => {
    const match = parseQuickAddDate("prekosutra", THU);
    expect(match?.phrase).toBe("prekosutra");
    expect(match?.date).toBe("2026-08-01");
  });
});

describe("parseQuickAddDate — Serbian weekdays", () => {
  it("resolves every weekday accusative to its next occurrence, today included", () => {
    expectTable([
      ["u ponedeljak", "2026-08-03"],
      ["u utorak", "2026-08-04"],
      ["u sredu", "2026-08-05"],
      ["u četvrtak", THU],
      ["u petak", "2026-07-31"],
      ["u subotu", "2026-08-01"],
      ["u nedelju", "2026-08-02"],
    ]);
  });

  it("resolves the diacritic-free spellings identically", () => {
    expectTable([
      ["u cetvrtak", THU],
      ["u ćetvrtak", THU],
    ]);
  });

  it("counts today as the next occurrence, and sledeći as a week past it", () => {
    expect(dateOf("u petak", FRI)).toBe(FRI);
    expect(dateOf("sledeći petak", FRI)).toBe("2026-08-07");
  });

  it("accepts every sledeći spelling, with or without the leading u", () => {
    expectTable([
      ["sledeći petak", "2026-08-07"],
      ["sledeci petak", "2026-08-07"],
      ["sledećeg petka", null], // genitive weekday is outside the grammar
      ["sledećeg petak", "2026-08-07"],
      ["sledeću sredu", "2026-08-12"],
      ["sledecu sredu", "2026-08-12"],
      ["sledeće subotu", "2026-08-08"],
      ["u sledeći petak", "2026-08-07"],
      ["u sledeću nedelju", "2026-08-09"],
    ]);
  });

  it("walks each weekday forward from every possible today", () => {
    expect(dateOf("u ponedeljak", WEEK.monday)).toBe(WEEK.monday);
    expect(dateOf("u ponedeljak", WEEK.tuesday)).toBe("2026-08-10");
    expect(dateOf("u ponedeljak", WEEK.wednesday)).toBe("2026-08-10");
    expect(dateOf("u ponedeljak", WEEK.thursday)).toBe("2026-08-10");
    expect(dateOf("u ponedeljak", WEEK.friday)).toBe("2026-08-10");
    expect(dateOf("u ponedeljak", WEEK.saturday)).toBe("2026-08-10");
    expect(dateOf("u ponedeljak", WEEK.sunday)).toBe("2026-08-10");
    expect(dateOf("u nedelju", WEEK.sunday)).toBe(WEEK.sunday);
    expect(dateOf("u nedelju", WEEK.monday)).toBe(WEEK.sunday);
    expect(dateOf("sledeću nedelju", WEEK.sunday)).toBe("2026-08-16");
  });

  it("requires the u — a bare Serbian weekday is an ordinary noun", () => {
    expectTable([
      ["petak", null],
      ["ponedeljak", null],
      ["nedelja", null],
      ["Neka bude petak", null],
    ]);
  });

  it("keeps the u out of a word that merely ends in one", () => {
    expect(dateOf("Predaju sredu")).toBe(null);
  });

  it("takes the u into the phrase, so nothing dangles in the title", () => {
    const match = parseQuickAddDate("Sastanak u petak", THU);
    expect(match?.phrase).toBe("u petak");
    expect(match?.strippedTitle).toBe("Sastanak");
  });
});

describe("parseQuickAddDate — English weekdays", () => {
  it("resolves the full names, bare and after on", () => {
    expectTable([
      ["monday", "2026-08-03"],
      ["tuesday", "2026-08-04"],
      ["wednesday", "2026-08-05"],
      ["thursday", THU],
      ["friday", "2026-07-31"],
      ["saturday", "2026-08-01"],
      ["sunday", "2026-08-02"],
      ["on monday", "2026-08-03"],
      ["on sunday", "2026-08-02"],
    ]);
  });

  it("resolves the three-letter forms only after an explicit on/next", () => {
    expectTable([
      ["on mon", "2026-08-03"],
      ["on tue", "2026-08-04"],
      ["on wed", "2026-08-05"],
      ["on thu", THU],
      ["on fri", "2026-07-31"],
      ["on sat", "2026-08-01"],
      ["on sun", "2026-08-02"],
      ["next fri", "2026-08-07"],
    ]);
  });

  it("never matches a bare three-letter form — several are ordinary words", () => {
    expectTable([
      // Serbian: "sat" is an hour, not a Saturday task.
      ["popravi sat", null],
      ["za sat vremena pozovi", null],
      // English: sat/sun/wed are everyday words too.
      ["I sat down", null],
      ["enjoy the sun", null],
      ["they wed last week", null],
    ]);
  });

  it("prefers the longer phrase when next/on wraps a weekday", () => {
    const next = parseQuickAddDate("next monday", THU);
    expect(next?.phrase).toBe("next monday");
    expect(next?.date).toBe("2026-08-10");

    const on = parseQuickAddDate("on friday", THU);
    expect(on?.phrase).toBe("on friday");
    expect(on?.date).toBe("2026-07-31");
  });

  it("does not let a three-letter form shadow the full name it prefixes", () => {
    expect(parseQuickAddDate("monday", THU)?.phrase).toBe("monday");
    expect(parseQuickAddDate("sunday", THU)?.phrase).toBe("sunday");
    expect(parseQuickAddDate("next sunday", THU)?.date).toBe("2026-08-09");
  });

  it("never matches a weekday inside a longer word", () => {
    expectTable([
      ["mondays only", null],
      ["monkey", null],
      ["sunset", null],
      ["frisbee", null],
    ]);
  });
});

describe("parseQuickAddDate — day offsets", () => {
  it("resolves za N dana and in N days", () => {
    expectTable([
      ["za 1 dana", "2026-07-31"],
      ["za 3 dana", "2026-08-02"],
      ["za 10 dana", "2026-08-09"],
      ["za nedelju dana", "2026-08-06"],
      ["in 1 day", "2026-07-31"],
      ["in 1 days", "2026-07-31"],
      ["in 3 days", "2026-08-02"],
      ["in 30 days", "2026-08-29"],
    ]);
  });

  it("refuses a zero or negative count and caps the reach", () => {
    expectTable([
      ["za 0 dana", null],
      ["in 0 days", null],
      ["za -3 dana", null],
      [`za ${MAX_RELATIVE_DAYS + 1} dana`, null],
      [`in ${MAX_RELATIVE_DAYS + 1} days`, null],
      ["za 999999 dana", null],
    ]);
    expect(dateOf(`za ${MAX_RELATIVE_DAYS} dana`)).toBe("2036-07-27");
  });

  it("does not confuse za nedelju dana with the weekday nedelja", () => {
    const match = parseQuickAddDate("Rok za nedelju dana", THU);
    expect(match?.phrase).toBe("za nedelju dana");
    expect(match?.strippedTitle).toBe("Rok");
  });

  it("needs the whole phrase", () => {
    expectTable([
      ["za 3", null],
      ["za dana", null],
      ["in 3", null],
      ["3 dana", null],
    ]);
  });
});

describe("parseQuickAddDate — numeric dates", () => {
  it("reads D.M, D.M. and D.M.YYYY day-first", () => {
    expectTable([
      ["1.8", "2026-08-01"],
      ["1.8.", "2026-08-01"],
      ["1. 8.", "2026-08-01"],
      ["1.8.2026", "2026-08-01"],
      ["1. 8. 2026", "2026-08-01"],
      ["30.7", THU],
      ["31.12", "2026-12-31"],
    ]);
  });

  it("rolls a year-less date into next year once this year's is past", () => {
    expectTable([
      ["1.1", "2027-01-01"],
      ["29.7", "2027-07-29"],
      ["30.7", THU], // today itself is not "past"
      ["31.7", "2026-07-31"],
    ]);
  });

  it("accepts an explicit year in range, past ones included", () => {
    expectTable([
      ["1.2.2026", "2026-02-01"],
      ["1.2.2020", "2020-02-01"],
      ["1.2.2000", "2000-02-01"],
      ["1.2.2100", "2100-02-01"],
      ["1.2.1999", null],
      ["1.2.2101", null],
    ]);
  });

  it("refuses a day that is not a real day, rather than guessing a near one", () => {
    expectTable([
      ["30.2", null],
      ["31.4", null],
      ["31.6", null],
      ["32.1", null],
      ["0.5", null],
      ["1.13", null],
      ["1.0", null],
      ["29.2.2027", null],
    ]);
  });

  it("reaches the next leap year for 29 February", () => {
    expect(dateOf("29.2")).toBe("2028-02-29");
    expect(dateOf("29.2.2028")).toBe("2028-02-29");
  });

  it("stays out of version strings and longer numbers", () => {
    expectTable([
      ["v1.2", null],
      ["verzija 1.2.3", null],
      ["1.2.3", null],
      ["1.2.20", null],
      ["123.4", null],
      ["1.234", null],
      ["Nexus v2.1 build", null],
    ]);
  });

  it("still reads a bare D.M as a Serbian date", () => {
    const match = parseQuickAddDate("Uplata 1.2", THU);
    expect(match?.date).toBe("2027-02-01");
    expect(match?.phrase).toBe("1.2");
  });
});

describe("parseQuickAddDate — month names", () => {
  it("resolves every Serbian month genitive", () => {
    expectTable([
      ["1. januara", "2027-01-01"],
      ["1. februara", "2027-02-01"],
      ["1. marta", "2027-03-01"],
      ["1. aprila", "2027-04-01"],
      ["1. maja", "2027-05-01"],
      ["1. juna", "2027-06-01"],
      ["1. jula", "2027-07-01"],
      ["1. avgusta", "2026-08-01"],
      ["1. septembra", "2026-09-01"],
      ["1. oktobra", "2026-10-01"],
      ["1. novembra", "2026-11-01"],
      ["1. decembra", "2026-12-01"],
    ]);
  });

  it("accepts the Serbian form with or without the dot and space", () => {
    expectTable([
      ["15. avgusta", "2026-08-15"],
      ["15.avgusta", "2026-08-15"],
      ["15 avgusta", "2026-08-15"],
    ]);
  });

  it("resolves every English month, both orders and both lengths", () => {
    expectTable([
      ["january 1", "2027-01-01"],
      ["jan 1", "2027-01-01"],
      ["february 1", "2027-02-01"],
      ["feb 1", "2027-02-01"],
      ["march 1", "2027-03-01"],
      ["mar 1", "2027-03-01"],
      ["april 1", "2027-04-01"],
      ["apr 1", "2027-04-01"],
      ["may 1", "2027-05-01"],
      ["june 1", "2027-06-01"],
      ["jun 1", "2027-06-01"],
      ["july 1", "2027-07-01"],
      ["jul 1", "2027-07-01"],
      ["august 1", "2026-08-01"],
      ["aug 1", "2026-08-01"],
      ["september 1", "2026-09-01"],
      ["sep 1", "2026-09-01"],
      ["october 1", "2026-10-01"],
      ["oct 1", "2026-10-01"],
      ["november 1", "2026-11-01"],
      ["nov 1", "2026-11-01"],
      ["december 1", "2026-12-01"],
      ["dec 1", "2026-12-01"],
      ["1 august", "2026-08-01"],
      ["1 aug", "2026-08-01"],
    ]);
  });

  it("accepts the ordinal suffixes", () => {
    expectTable([
      ["august 1st", "2026-08-01"],
      ["august 2nd", "2026-08-02"],
      ["august 3rd", "2026-08-03"],
      ["august 4th", "2026-08-04"],
      ["1st august", "2026-08-01"],
      ["22nd august", "2026-08-22"],
      ["aug. 5", "2026-08-05"],
    ]);
  });

  it("refuses an unreal day with a month name", () => {
    expectTable([
      ["feb 30", null],
      ["30 february", null],
      ["31. aprila", null],
      ["april 31", null],
    ]);
  });

  it("does not read an English month out of a Serbian one", () => {
    expect(parseQuickAddDate("1. marta", THU)?.phrase).toBe("1. marta");
    expect(parseQuickAddDate("1. juna", THU)?.phrase).toBe("1. juna");
    expect(dateOf("marta")).toBe(null);
    expect(dateOf("august")).toBe(null);
  });
});

describe("parseQuickAddDate — choosing between candidates", () => {
  it("lets the last phrase win", () => {
    const match = parseQuickAddDate("Sastanak sutra ili u petak", THU);
    expect(match?.date).toBe("2026-07-31");
    expect(match?.phrase).toBe("u petak");
    expect(match?.strippedTitle).toBe("Sastanak sutra ili");
  });

  it("lets an earlier phrase win when the later one is not a real date", () => {
    const match = parseQuickAddDate("Rok 5. avgusta pa 30.2", THU);
    expect(match?.date).toBe("2026-08-05");
    expect(match?.phrase).toBe("5. avgusta");
    expect(match?.strippedTitle).toBe("Rok pa 30.2");
  });

  it("returns null when nothing at all matches", () => {
    expectTable([
      ["", null],
      ["Kupi mleko", null],
      ["   ", null],
      ["std::vector refaktor", null],
      ["Poziv u 15h", null],
    ]);
  });
});

describe("parseQuickAddDate — span, phrase and stripping", () => {
  it("reports the phrase's span in the original input", () => {
    const match = parseQuickAddDate("Kupi mleko sutra", THU);
    expect(match?.start).toBe(11);
    expect(match?.end).toBe(16);
    expect(match?.phrase).toBe("sutra");
    expect(match?.strippedTitle).toBe("Kupi mleko");
  });

  it("maps the span back across folding that changes length", () => {
    const input = "Pošalji Đorđu poruku sutra";
    const match = parseQuickAddDate(input, THU);
    expect(match?.phrase).toBe("sutra");
    expect(input.slice(match?.start ?? 0, match?.end ?? 0)).toBe("sutra");
    expect(match?.strippedTitle).toBe("Pošalji Đorđu poruku");
  });

  it("collapses the seam the phrase leaves behind", () => {
    expect(parseQuickAddDate("Kupi mleko sutra ujutru", THU)?.strippedTitle).toBe(
      "Kupi mleko ujutru",
    );
    expect(parseQuickAddDate("Kupi  sutra  mleko", THU)?.strippedTitle).toBe("Kupi mleko");
    expect(parseQuickAddDate("Sutra kupi mleko", THU)?.strippedTitle).toBe("kupi mleko");
    expect(parseQuickAddDate("  sutra  kupi  ", THU)?.strippedTitle).toBe("kupi");
  });

  it("strips to an empty title when the phrase is the whole input", () => {
    expect(parseQuickAddDate("sutra", THU)?.strippedTitle).toBe("");
    expect(parseQuickAddDate("  u petak  ", THU)?.strippedTitle).toBe("");
    expect(parseQuickAddDate("1.8.2026", THU)?.strippedTitle).toBe("");
  });

  it("keeps the original casing and diacritics in the phrase", () => {
    const match = parseQuickAddDate("Sastanak U ČETVRTAK sa timom", THU);
    expect(match?.phrase).toBe("U ČETVRTAK");
    expect(match?.date).toBe(THU);
    expect(match?.strippedTitle).toBe("Sastanak sa timom");
  });
});

describe("parseQuickAddDate — contract", () => {
  it("rejects a today that is not a real calendar day", () => {
    expect(() => parseQuickAddDate("sutra", "2026-02-30")).toThrow(TypeError);
    expect(() => parseQuickAddDate("sutra", "not-a-day")).toThrow(TypeError);
  });

  it("is pure — the same input resolves identically however often it is scanned", () => {
    const first = parseQuickAddDate("Sastanak u petak", THU);
    const second = parseQuickAddDate("Sastanak u petak", THU);
    expect(second).toEqual(first);
  });
});
