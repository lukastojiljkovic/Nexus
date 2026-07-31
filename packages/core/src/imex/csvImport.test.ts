import { describe, expect, it } from "vitest";
import { toCsv } from "./csv.js";
import {
  CSV_COLUMN_ROLES,
  CSV_LIST_SOURCE_ID,
  parseCsv,
  readCsvDueDate,
  readCsvPriority,
  readCsvStatus,
  sniffCsvDelimiter,
  sniffCsvHeader,
  splitCsvTags,
  suggestCsvMapping,
  translateCsvTasks,
  type CsvColumnRole,
  type CsvTranslateTarget,
} from "./csvImport.js";

const NOW = "2026-07-31T12:00:00.000Z";

function target(overrides?: Partial<CsvTranslateTarget>): CsvTranslateTarget {
  return {
    profileId: "profile-1",
    now: NOW,
    list: { kind: "new", name: "Uvoz" },
    ...overrides,
  };
}

// --- Reader (the RFC-4180 inverse of csv.ts) ---------------------------------

describe("parseCsv", () => {
  it("splits plain rows on the delimiter and on line breaks", () => {
    expect(parseCsv("a,b\r\nc,d\r\n", ",")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("reads a final line without a terminator", () => {
    expect(parseCsv("a,b\r\nc,d", ",")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("does not produce an extra empty row for a trailing terminator", () => {
    expect(parseCsv("a\r\n", ",")).toEqual([["a"]]);
    expect(parseCsv("a\n", ",")).toEqual([["a"]]);
  });

  it("accepts bare LF and lone CR as row terminators", () => {
    expect(parseCsv("a\nb\rc", ",")).toEqual([["a"], ["b"], ["c"]]);
  });

  it("reads a quoted field containing the delimiter", () => {
    expect(parseCsv('"one,two",three', ",")).toEqual([["one,two", "three"]]);
  });

  it("reads doubled quotes inside a quoted field as one literal quote", () => {
    expect(parseCsv('"say ""hi"""', ",")).toEqual([['say "hi"']]);
  });

  it("keeps CRLF and LF inside a quoted field as content", () => {
    expect(parseCsv('"line1\r\nline2",x\r\n"a\nb"', ",")).toEqual([
      ["line1\r\nline2", "x"],
      ["a\nb"],
    ]);
  });

  it("treats a quote not at the start of a field as a literal character", () => {
    expect(parseCsv('a"b,c', ",")).toEqual([['a"b', "c"]]);
  });

  it("appends text after a closing quote rather than losing it", () => {
    expect(parseCsv('"ab"cd,e', ",")).toEqual([["abcd", "e"]]);
  });

  it("reads an unterminated quote as the rest of the text", () => {
    expect(parseCsv('"never closed,still here', ",")).toEqual([["never closed,still here"]]);
  });

  it("reads empty fields, leading and trailing", () => {
    expect(parseCsv(",a,\r\n,,", ",")).toEqual([
      ["", "a", ""],
      ["", "", ""],
    ]);
  });

  it("splits on semicolons when told to, leaving commas as content", () => {
    expect(parseCsv("a;b,c\r\nd;e", ";")).toEqual([
      ["a", "b,c"],
      ["d", "e"],
    ]);
  });

  it("returns no rows for empty text", () => {
    expect(parseCsv("", ",")).toEqual([]);
  });

  it("round-trips the csv.ts writer's own output", () => {
    const headers = ["naziv", "opis", "rok"] as const;
    const rows = [
      ["Kupiti \"sveske\"", "linija1\nlinija2", "2026-08-01"],
      ["Zarez, unutra", "", "31.8.2026."],
    ];
    const written = toCsv(headers, rows);
    expect(parseCsv(written, ",")).toEqual([[...headers], ...rows]);
  });
});

// --- Sniffing ----------------------------------------------------------------

describe("sniffCsvDelimiter", () => {
  it("picks the comma for a comma-separated file", () => {
    expect(sniffCsvDelimiter("a,b,c\r\nd,e,f\r\n")).toBe(",");
  });

  it("picks the semicolon for a Serbian-Excel file", () => {
    expect(sniffCsvDelimiter("naziv;rok;prioritet\r\nZadatak;31.8.2026.;visok\r\n")).toBe(";");
  });

  it("never counts a delimiter inside quotes", () => {
    // Three commas, all quoted content; two semicolons, both structure.
    expect(sniffCsvDelimiter('"a,b,c,d";x\r\n"e";y\r\n')).toBe(";");
  });

  it("falls back to the comma when neither appears", () => {
    expect(sniffCsvDelimiter("naziv\r\nZadatak\r\n")).toBe(",");
  });
});

describe("sniffCsvHeader", () => {
  it("calls a row of non-numeric, non-empty cells a header", () => {
    expect(sniffCsvHeader(["naziv", "rok", "prioritet"])).toBe(true);
  });

  it("refuses a row with an empty cell", () => {
    expect(sniffCsvHeader(["naziv", "", "prioritet"])).toBe(false);
  });

  it("refuses a row with a numeric cell", () => {
    expect(sniffCsvHeader(["naziv", "3", "prioritet"])).toBe(false);
    expect(sniffCsvHeader(["naziv", "3,5", "prioritet"])).toBe(false);
    expect(sniffCsvHeader(["naziv", "-2.5", "prioritet"])).toBe(false);
  });

  it("refuses an empty row", () => {
    expect(sniffCsvHeader([])).toBe(false);
  });
});

// --- The suggested mapping ---------------------------------------------------

describe("suggestCsvMapping", () => {
  it("suggests roles from Serbian headers", () => {
    expect(suggestCsvMapping(["Naziv", "Opis", "Rok", "Prioritet", "Status", "Oznake"])).toEqual([
      "title",
      "description",
      "dueDate",
      "priority",
      "status",
      "tags",
    ]);
  });

  it("suggests roles from English headers, case-insensitively", () => {
    expect(suggestCsvMapping(["Title", "Notes", "Due Date", "PRIORITY", "Done", "Labels"])).toEqual([
      "title",
      "description",
      "dueDate",
      "priority",
      "status",
      "tags",
    ]);
  });

  it("matches Serbian headers typed without diacritics", () => {
    expect(suggestCsvMapping(["Sekcija", "Oznake", "Lista"])).toEqual(["section", "tags", "list"]);
    expect(suggestCsvMapping(["Beleška", "Beleska"])).toEqual(["description", "ignore"]);
  });

  it("gives a role to the FIRST matching column only; later matches fall to ignore", () => {
    expect(suggestCsvMapping(["Naziv", "Title", "Rok"])).toEqual(["title", "ignore", "dueDate"]);
  });

  it("suggests ignore for a header it cannot read, and for a missing one", () => {
    expect(suggestCsvMapping(["Nepoznato", null])).toEqual(["ignore", "ignore"]);
  });

  it("offers the closed vocabulary in a stable order", () => {
    expect(CSV_COLUMN_ROLES).toEqual([
      "title",
      "description",
      "dueDate",
      "priority",
      "status",
      "list",
      "section",
      "tags",
      "ignore",
    ]);
  });
});

// --- Cell readings -----------------------------------------------------------

describe("readCsvDueDate", () => {
  it("reads ISO YYYY-MM-DD", () => {
    expect(readCsvDueDate("2026-08-01")).toEqual({ kind: "date", value: "2026-08-01" });
  });

  it("reads Serbian d.M.yyyy with and without the terminal dot, normalized to ISO", () => {
    expect(readCsvDueDate("31.8.2026")).toEqual({ kind: "date", value: "2026-08-31" });
    expect(readCsvDueDate("1.12.2026.")).toEqual({ kind: "date", value: "2026-12-01" });
    expect(readCsvDueDate("05.09.2026.")).toEqual({ kind: "date", value: "2026-09-05" });
  });

  it("tolerates spaces after the dots, as Serbian dates are commonly typed", () => {
    expect(readCsvDueDate("31. 8. 2026.")).toEqual({ kind: "date", value: "2026-08-31" });
  });

  it("treats an empty or whitespace cell as no date, never as a failure", () => {
    expect(readCsvDueDate("")).toEqual({ kind: "none" });
    expect(readCsvDueDate("   ")).toEqual({ kind: "none" });
  });

  it("refuses a two-digit year rather than guessing the century", () => {
    expect(readCsvDueDate("31.8.26")).toEqual({ kind: "bad" });
    expect(readCsvDueDate("31.8.26.")).toEqual({ kind: "bad" });
  });

  it("refuses a day the calendar does not have", () => {
    expect(readCsvDueDate("2026-02-30")).toEqual({ kind: "bad" });
    expect(readCsvDueDate("31.2.2026.")).toEqual({ kind: "bad" });
  });

  it("refuses anything else by name", () => {
    expect(readCsvDueDate("sutra")).toEqual({ kind: "bad" });
    expect(readCsvDueDate("08/31/2026")).toEqual({ kind: "bad" });
  });
});

describe("readCsvPriority", () => {
  it("maps the Serbian, English and numeric spellings, case-insensitively", () => {
    expect(readCsvPriority("visok")).toBe("high");
    expect(readCsvPriority("HIGH")).toBe("high");
    expect(readCsvPriority("1")).toBe("high");
    expect(readCsvPriority("Srednji")).toBe("medium");
    expect(readCsvPriority("medium")).toBe("medium");
    expect(readCsvPriority("2")).toBe("medium");
    expect(readCsvPriority("nizak")).toBe("low");
    expect(readCsvPriority("low")).toBe("low");
    expect(readCsvPriority("3")).toBe("low");
  });

  it("reads everything else as none", () => {
    expect(readCsvPriority("")).toBe("none");
    expect(readCsvPriority("urgent")).toBe("none");
    expect(readCsvPriority("4")).toBe("none");
  });
});

describe("readCsvStatus", () => {
  it("maps the done spellings, case-insensitively", () => {
    for (const cell of ["done", "DONE", "završeno", "Gotovo", "true", "1", "x", "X"]) {
      expect(readCsvStatus(cell)).toBe("done");
    }
  });

  it("reads everything else as open", () => {
    for (const cell of ["", "todo", "open", "0", "false", "u toku"]) {
      expect(readCsvStatus(cell)).toBe("open");
    }
  });
});

describe("splitCsvTags", () => {
  it("splits on commas and semicolons inside the already-unquoted cell", () => {
    expect(splitCsvTags("posao, hitno;kuća")).toEqual(["posao", "hitno", "kuća"]);
  });

  it("trims parts, drops empties and de-duplicates within one cell", () => {
    expect(splitCsvTags("  posao ,, posao ; ")).toEqual(["posao"]);
  });

  it("reads an empty cell as no tags", () => {
    expect(splitCsvTags("")).toEqual([]);
    expect(splitCsvTags("  ")).toEqual([]);
  });
});

// --- Translation -------------------------------------------------------------

describe("translateCsvTasks", () => {
  const ROLES: CsvColumnRole[] = ["title", "dueDate", "priority", "status", "tags", "section"];

  const ROWS = [
    ["Prijaviti ispit", "2026-09-01", "visok", "", "faks, hitno", "Avgust"],
    ["Kupiti sveske", "31.8.2026.", "", "done", "faks", ""],
    ["", "2026-09-02", "", "", "", ""],
    ["Bez roka", "kad stignem", "srednji", "", "", "Avgust"],
  ];

  it("plans one task per readable row, all in the ONE chosen list", () => {
    const { data, report } = translateCsvTasks(ROWS, ROLES, target());

    expect(data.tasks).toHaveLength(3);
    expect(data.tasks.every((task) => task.listId === CSV_LIST_SOURCE_ID)).toBe(true);
    expect(report.rows).toBe(4);
    expect(report.tasks).toBe(3);
  });

  it("skips an empty-title row by name, with its 1-based row number", () => {
    const { report } = translateCsvTasks(ROWS, ROLES, target());
    expect(report.drops).toContainEqual({ row: 3, code: "empty-title" });
  });

  it("imports a task whose due date is unreadable WITHOUT the date, and counts the drop by row", () => {
    const { data, report } = translateCsvTasks(ROWS, ROLES, target());
    const bezRoka = data.tasks.find((task) => task.title === "Bez roka");
    expect(bezRoka).toMatchObject({ dueDate: null, priority: "medium" });
    expect(report.drops).toContainEqual({ row: 4, code: "bad-due-date" });
  });

  it("normalizes the Serbian date and stamps a done row as completed", () => {
    const { data } = translateCsvTasks(ROWS, ROLES, target());
    const done = data.tasks.find((task) => task.title === "Kupiti sveske");
    expect(done).toMatchObject({
      dueDate: "2026-08-31",
      status: "done",
      done: true,
      completedAt: NOW,
    });
    const open = data.tasks.find((task) => task.title === "Prijaviti ispit");
    expect(open).toMatchObject({ status: "todo", done: false, completedAt: null });
  });

  it("creates each distinct tag once and links tasks to it", () => {
    const { data } = translateCsvTasks(ROWS, ROLES, target());
    expect(data.taskTags.map((tag) => tag.name)).toEqual(["faks", "hitno"]);
    const byTask = new Map(data.tasks.map((task) => [task.id, task.title]));
    const links = data.taskTagLinks.map((link) => `${byTask.get(link.taskId)}→${
      data.taskTags.find((tag) => tag.id === link.tagId)?.name
    }`);
    expect(links.sort()).toEqual(["Kupiti sveske→faks", "Prijaviti ispit→faks", "Prijaviti ispit→hitno"]);
  });

  it("creates each distinct section once, inside the one list, and files rows under it", () => {
    const { data } = translateCsvTasks(ROWS, ROLES, target());
    expect(data.taskSections).toHaveLength(1);
    expect(data.taskSections[0]).toMatchObject({ name: "Avgust", listId: CSV_LIST_SOURCE_ID });
    const inSection = data.tasks.filter((task) => task.sectionId === data.taskSections[0]?.id);
    expect(inSection.map((task) => task.title).sort()).toEqual(["Bez roka", "Prijaviti ispit"]);
    const loose = data.tasks.find((task) => task.title === "Kupiti sveske");
    expect(loose?.sectionId).toBeNull();
  });

  it("plans a NEW list row for the new-list arm and seeds nothing", () => {
    const { data, seededIds } = translateCsvTasks(ROWS, ROLES, target({ list: { kind: "new", name: "Uvoz" } }));
    expect(data.taskLists).toHaveLength(1);
    expect(data.taskLists[0]).toMatchObject({ id: CSV_LIST_SOURCE_ID, name: "Uvoz", isInbox: false });
    expect(seededIds.size).toBe(0);
  });

  it("seeds the EXISTING-list arm onto the chosen row and plans no list at all", () => {
    const { data, seededIds } = translateCsvTasks(
      ROWS,
      ROLES,
      target({ list: { kind: "existing", id: "list-77" } }),
    );
    expect(data.taskLists).toHaveLength(0);
    expect(seededIds.get(CSV_LIST_SOURCE_ID)).toBe("list-77");
  });

  it("skips a wholly blank row silently — a blank spreadsheet line is not a loss", () => {
    const { report } = translateCsvTasks(
      [["Zadatak", "", "", "", "", ""], ["", "", "", "", "", ""]],
      ROLES,
      target(),
    );
    expect(report.tasks).toBe(1);
    expect(report.blankRows).toBe(1);
    expect(report.drops).toEqual([]);
  });

  it("balances: rows = tasks + empty-title drops + blank rows", () => {
    const { report } = translateCsvTasks(ROWS, ROLES, target());
    const emptyTitles = report.drops.filter((drop) => drop.code === "empty-title").length;
    expect(report.rows).toBe(report.tasks + emptyTitles + report.blankRows);
  });

  it("counts non-empty cells of a column mapped 'list' as dropped — every row still lands in the ONE chosen list", () => {
    const roles: CsvColumnRole[] = ["title", "list"];
    const { data, report } = translateCsvTasks(
      [
        ["Prvi", "Posao"],
        ["Drugi", ""],
        ["Treći", "Kuća"],
      ],
      roles,
      target(),
    );
    expect(data.tasks).toHaveLength(3);
    expect(data.taskLists.map((list) => list.name)).toEqual(["Uvoz"]);
    expect(report.listCellsDropped).toBe(2);
  });

  it("reads a ragged row as if its missing cells were empty", () => {
    const { data } = translateCsvTasks([["Kratak red"]], ROLES, target());
    expect(data.tasks[0]).toMatchObject({ title: "Kratak red", dueDate: null, sectionId: null });
  });

  it("ignores columns mapped 'ignore' and reads 'description' whole", () => {
    const roles: CsvColumnRole[] = ["ignore", "title", "description"];
    const { data } = translateCsvTasks(
      [["x", "Zadatak", "Detalji, sa zarezom"]],
      roles,
      target(),
    );
    expect(data.tasks[0]).toMatchObject({ title: "Zadatak", description: "Detalji, sa zarezom" });
  });

  it("plans every non-task collection empty and spaces positions sparsely", () => {
    const { data } = translateCsvTasks(ROWS, ROLES, target());
    expect(data.events).toEqual([]);
    expect(data.notes).toEqual([]);
    expect(data.decks).toEqual([]);
    expect(data.tasks.map((task) => task.position)).toEqual([1024, 2048, 3072]);
  });

  it("refuses a mapping without a title column — the caller's bug, not a row's", () => {
    expect(() => translateCsvTasks(ROWS, ["dueDate"], target())).toThrow(/title/);
  });

  it("refuses a mapping that names one role twice", () => {
    expect(() => translateCsvTasks(ROWS, ["title", "title"], target())).toThrow(/twice/);
  });

  it("refuses a new-list name that is empty after trimming", () => {
    expect(() =>
      translateCsvTasks(ROWS, ROLES, target({ list: { kind: "new", name: "   " } })),
    ).toThrow(/name/);
  });
});
