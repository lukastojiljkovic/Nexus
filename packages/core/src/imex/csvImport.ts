import { foldSearchText } from "../search/searchText.js";
import type {
  ExportTask,
  ExportTaskList,
  ExportTaskSection,
  ExportTaskTag,
  ExportTaskTagLink,
  ProfileData,
} from "./exportArchive.js";

/**
 * The CSV task import (ADR-062): a hand-kept spreadsheet — a Todoist export, a
 * shared „obaveze" table, a plain text file with semicolons — turned into the
 * `ProfileData` `planForeignImport` merges. A TRANSLATOR, like `ankiTranslate.ts`
 * and `llmPrompts.ts` before it: merge semantics (minted ids, additive-only,
 * named salvage, one-slot undo) are the planner's, decided once, and nothing
 * here re-decides them.
 *
 * What is NEW here is the MAPPING. A CSV has no fixed schema, so between the
 * preview and the apply the user says which column is which — a closed role
 * vocabulary, a SUGGESTED mapping from header names the user confirms (never a
 * silent guess), and a translation whose every loss is named per row so the
 * user can find the cell in their own spreadsheet.
 *
 * Three decisions shape everything below:
 *
 *  - **The reader is the writer's inverse.** `parseCsv` reads exactly what
 *    `csv.ts`'s `toCsv` writes (RFC 4180: quoted fields, doubled quotes,
 *    embedded line breaks) and is LENIENT about everything a spreadsheet tool
 *    might emit around that — a final line with or without its terminator, a
 *    lone CR, a stray quote mid-field. A CSV is somebody's data in the loosest
 *    format there is; refusing a readable file over a formality would be a
 *    loss with no name.
 *  - **A task without its date is still a task.** Every cell reading is
 *    lenient and every failure is NAMED per row: an unreadable due date
 *    imports the task WITHOUT a date and counts the drop (`bad-due-date`), a
 *    two-digit year is refused rather than century-guessed, and only an empty
 *    title costs a row its place (`empty-title`) — a refused row is a loss,
 *    so refusal is reserved for the one cell a task cannot exist without.
 *  - **ONE list.** Every planned task lands in one destination list — an
 *    existing list the user chose (seeded through the planner's `seededIds`,
 *    ADR-052's seam) or a new named list this import creates via the planner's
 *    own list handling. A column mapped `"list"` therefore cannot re-target
 *    rows: its non-empty cells are COUNTED as dropped (`listCellsDropped`) and
 *    the preview says so before anything is written. The role stays in the
 *    vocabulary so a „Lista" column is recognised for what it is rather than
 *    mis-suggested as something else.
 *
 * The v1 role vocabulary deliberately excludes startDate, reminders,
 * recurrence and subtask columns — a decision, not an oversight (ADR-062). A
 * reminder ladder or a recurrence rule read out of a spreadsheet cell would be
 * this import scheduling notifications nobody asked for, and a parent/child
 * column convention would be a guess about somebody else's table. The LLM
 * prompt pack (IMEX-005) is the path for arbitrary shapes.
 *
 * Pure, like every other module in `@nexus/core`: no clock (`now` is
 * injected), no id generator (the `csv:` ids below are deterministic
 * source-side names the planner mints over), no IO — the file is read by
 * `main/csvReader.ts` under its own stat-before-read cap.
 */

// --- Reader ------------------------------------------------------------------

/** The two delimiters this import reads: RFC 4180's comma, and the semicolon Serbian-locale Excel actually writes. */
export type CsvDelimiter = "," | ";";

/**
 * Parses one CSV text into rows of cells — the RFC-4180 inverse of `toCsv`
 * (`csv.ts`), lenient where the RFC is silent:
 *
 *  - Rows end at CRLF, LF or a lone CR outside quotes; the final row needs no
 *    terminator, and a trailing one produces no phantom empty row.
 *  - A field beginning with `"` is quoted: `""` inside it is one literal
 *    quote, and delimiters and line breaks inside it are content.
 *  - A quote NOT at the start of a field is a literal character; text after a
 *    closing quote is appended rather than lost; a quote never closed runs to
 *    the end of the text. Each of these is somebody's slightly-off file, and
 *    reading it plainly loses less than refusing it.
 *
 * One pass, no regex, no backtracking: the text is walked exactly once.
 */
export function parseCsv(text: string, delimiter: CsvDelimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  /** True while inside an opening quote's field — only a quote at cell start opens one. */
  let quoted = false;
  /** True when the current cell has consumed any character (so `""` alone still yields a cell). */
  let started = false;

  const endCell = (): void => {
    row.push(cell);
    cell = "";
    quoted = false;
    started = false;
  };
  const endRow = (): void => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const ch = text.charAt(index);
    if (quoted) {
      if (ch === '"') {
        if (text.charAt(index + 1) === '"') {
          cell += '"';
          index += 1;
          continue;
        }
        // The closing quote. Anything before the next delimiter/terminator is
        // appended literally by the unquoted branch below.
        quoted = false;
        continue;
      }
      cell += ch;
      continue;
    }
    if (ch === '"' && !started) {
      quoted = true;
      started = true;
      continue;
    }
    if (ch === delimiter) {
      endCell();
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text.charAt(index + 1) === "\n") index += 1;
      endRow();
      continue;
    }
    cell += ch;
    started = true;
  }
  // The final row, when the text did not end on a terminator — including a
  // field whose quote never closed.
  if (started || cell.length > 0 || row.length > 0) endRow();

  return rows;
}

/** How many rows the delimiter sniff reads before deciding — enough to outvote one odd line, few enough that a huge file costs nothing. */
const SNIFF_ROWS = 10;

/**
 * Comma or semicolon, decided by counting BOTH outside quotes over the first
 * rows (Serbian-locale Excel writes `;` because the decimal comma takes `,`).
 * The semicolon wins only a clear majority; a tie — including a file with
 * neither — falls back to the RFC's own comma. Overridable in the mapping UI:
 * this is a suggestion's starting point, never a silent commitment.
 */
export function sniffCsvDelimiter(text: string): CsvDelimiter {
  let commas = 0;
  let semicolons = 0;
  let rowsSeen = 0;
  let quoted = false;
  for (let index = 0; index < text.length && rowsSeen < SNIFF_ROWS; index += 1) {
    const ch = text.charAt(index);
    if (quoted) {
      if (ch === '"') {
        if (text.charAt(index + 1) === '"') index += 1;
        else quoted = false;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") commas += 1;
    else if (ch === ";") semicolons += 1;
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text.charAt(index + 1) === "\n") index += 1;
      rowsSeen += 1;
    }
  }
  return semicolons > commas ? ";" : ",";
}

/** A cell that reads as a plain number — the one thing a header cell is never called. Decimal comma and point both count; a date does not. */
const NUMERIC_CELL = /^-?\d+(?:[.,]\d+)?$/;

/**
 * Whether the first row reads as a header: every cell non-empty and
 * non-numeric. A data row almost always carries an empty optional cell or a
 * number somewhere; a header never does. Overridable in the mapping UI, like
 * the delimiter — a suggestion the user confirms.
 */
export function sniffCsvHeader(firstRow: readonly string[]): boolean {
  if (firstRow.length === 0) return false;
  return firstRow.every((cell) => {
    const trimmed = cell.trim();
    return trimmed.length > 0 && !NUMERIC_CELL.test(trimmed);
  });
}

// --- Column roles ------------------------------------------------------------

/**
 * What one column can BE. Closed on purpose: every role here is one the
 * translation below actually honours, so there is no way to map a column onto
 * a promise nothing keeps. (The v1 exclusions are the module header's.)
 */
export type CsvColumnRole =
  | "title"
  | "description"
  | "dueDate"
  | "priority"
  | "status"
  | "list"
  | "section"
  | "tags"
  | "ignore";

/** Every role, in the order the mapping UI's selects offer them. `title` first because it is the one required role; `ignore` last because it is the way out. */
export const CSV_COLUMN_ROLES: readonly CsvColumnRole[] = [
  "title",
  "description",
  "dueDate",
  "priority",
  "status",
  "list",
  "section",
  "tags",
  "ignore",
];

/**
 * The bilingual header table behind the SUGGESTED mapping — a suggestion the
 * user confirms in the mapping step, never a silent guess. Keys are folded
 * (`foldSearchText`: lowercased, diacritics stripped), so „Rok", „rok" and a
 * diacritic-less „sekcija" all land; matching is EXACT on the folded header,
 * because a substring rule would read „Rok završetka projekta" as a due date
 * on the strength of one word.
 */
const HEADER_ROLES: ReadonlyMap<string, CsvColumnRole> = new Map(
  Object.entries({
    // naziv/title/task …
    naziv: "title",
    naslov: "title",
    zadatak: "title",
    title: "title",
    task: "title",
    name: "title",
    content: "title",
    // opis/description/notes …
    opis: "description",
    beleska: "description",
    napomena: "description",
    detalji: "description",
    description: "description",
    notes: "description",
    note: "description",
    // rok/due/deadline …
    rok: "dueDate",
    datum: "dueDate",
    due: "dueDate",
    "due date": "dueDate",
    duedate: "dueDate",
    deadline: "dueDate",
    // prioritet/priority
    prioritet: "priority",
    priority: "priority",
    // status/done/gotovo
    status: "status",
    done: "status",
    gotovo: "status",
    zavrseno: "status",
    // lista/list
    lista: "list",
    spisak: "list",
    list: "list",
    project: "list",
    projekat: "list",
    // sekcija/section
    sekcija: "section",
    section: "section",
    // oznake/tags/labels
    oznake: "tags",
    oznaka: "tags",
    etikete: "tags",
    tags: "tags",
    tag: "tags",
    labels: "tags",
    label: "tags",
  }) as [string, CsvColumnRole][],
);

/**
 * A suggested role per column, from the header names alone. Each role is given
 * to the FIRST column whose header claims it — two „Title" columns cannot both
 * be the title, and the later one falls to `ignore` for the user to re-map. A
 * header this table cannot read, or a missing one (no header row), suggests
 * `ignore`: an unmapped column is a visible question, a mis-mapped one is a
 * silent answer.
 */
export function suggestCsvMapping(headers: readonly (string | null)[]): CsvColumnRole[] {
  const taken = new Set<CsvColumnRole>();
  return headers.map((header) => {
    if (header === null) return "ignore";
    const role = HEADER_ROLES.get(foldSearchText(header.trim()));
    if (role === undefined || taken.has(role)) return "ignore";
    taken.add(role);
    return role;
  });
}

// --- Cell readings -----------------------------------------------------------

/** ISO `YYYY-MM-DD`. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Serbian `d.M.yyyy`, with or without the terminal dot, tolerant of spaces after the dots („31. 8. 2026."). The four-digit year is the rule that keeps a two-digit one out. */
const SERBIAN_DATE = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\.?$/;

/** A real calendar day, not merely a parseable one: `Date` rolls 30 February into March, which is exactly the plausible-but-wrong value a typo produces. */
function isRealDay(year: number, month: number, day: number): boolean {
  const asDate = new Date(Date.UTC(year, month - 1, day));
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  );
}

/** One due-date cell's reading: no date at all, a normalized ISO day, or a NAMED failure the report counts per row. */
export type CsvDueDateReading =
  | { kind: "none" }
  | { kind: "date"; value: string }
  | { kind: "bad" };

/**
 * A due-date cell: ISO `YYYY-MM-DD` or Serbian `d.M.yyyy` / `d.M.yyyy.`, both
 * checked against the real calendar and normalized to ISO. An empty cell is NO
 * date (most spreadsheets leave the column blank far more often than they fill
 * it); anything else — a two-digit year included, which is refused rather than
 * century-guessed — is `bad`, and the caller imports the task without its date
 * and counts the drop by row.
 */
export function readCsvDueDate(cell: string): CsvDueDateReading {
  const trimmed = cell.trim();
  if (trimmed.length === 0) return { kind: "none" };

  const iso = ISO_DATE.exec(trimmed);
  if (iso !== null) {
    const [, year, month, day] = iso;
    if (!isRealDay(Number(year), Number(month), Number(day))) return { kind: "bad" };
    return { kind: "date", value: trimmed };
  }

  const serbian = SERBIAN_DATE.exec(trimmed);
  if (serbian !== null) {
    const day = Number(serbian[1]);
    const month = Number(serbian[2]);
    const year = Number(serbian[3]);
    if (!isRealDay(year, month, day)) return { kind: "bad" };
    const pad = (value: number): string => String(value).padStart(2, "0");
    return { kind: "date", value: `${year}-${pad(month)}-${pad(day)}` };
  }

  return { kind: "bad" };
}

/** The priority cell's closed reading table (ADR-062): Serbian, English and Todoist-style numbers. Everything else — the empty cell included — is `none`, leniently, so no priority spelling can cost a row anything. */
const PRIORITY_CELLS: ReadonlyMap<string, "high" | "medium" | "low"> = new Map([
  ["visok", "high"],
  ["high", "high"],
  ["1", "high"],
  ["srednji", "medium"],
  ["medium", "medium"],
  ["2", "medium"],
  ["nizak", "low"],
  ["low", "low"],
  ["3", "low"],
]);

/** One priority cell, case-insensitively, else `none` — a total function, so a priority cell can never produce a drop. */
export function readCsvPriority(cell: string): "none" | "low" | "medium" | "high" {
  return PRIORITY_CELLS.get(cell.trim().toLowerCase()) ?? "none";
}

/** The spellings that mean "this row is finished" (ADR-062), matched case-insensitively. `x` is what a hand-kept table actually puts in its done column. */
const DONE_CELLS = new Set(["done", "završeno", "gotovo", "true", "1", "x"]);

/** One status cell: `done` for the closed table above, else `open` — a total function, like the priority's, and for the same reason. */
export function readCsvStatus(cell: string): "open" | "done" {
  return DONE_CELLS.has(cell.trim().toLowerCase()) ? "done" : "open";
}

/**
 * One tags cell, split on `,` or `;` INSIDE the already-unquoted cell — the
 * quoting protected the cell from the ROW's delimiter, so both characters are
 * separators again in here. Parts are trimmed, empties dropped, duplicates
 * within the one cell collapsed. Exact strings otherwise: „Posao" and „posao"
 * stay two tags, exactly as the planner's own tag merge treats them.
 */
export function splitCsvTags(cell: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of cell.split(/[,;]/)) {
    const name = part.trim();
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    tags.push(name);
  }
  return tags;
}

// --- Translation -------------------------------------------------------------

/**
 * The source-side id the ONE destination list goes by — `APKG_SUBJECT_SOURCE_ID`'s
 * twin (ADR-052's seam, reused verbatim). For an EXISTING list the planner
 * pre-populates its id map with this one entry and mints nothing; for a NEW
 * one this is the planned list row's own name, minted over like any other row's.
 */
export const CSV_LIST_SOURCE_ID = "csv:list";

/**
 * Where every imported task lands: a list the profile already has, or one this
 * import names into being. `ApkgSubjectChoice`'s shape, one module over — the
 * same one decision only the user can make, because a CSV names no Nexus list.
 */
export type CsvListChoice = { kind: "existing"; id: string } | { kind: "new"; name: string };

export interface CsvTranslateTarget {
  /** The profile every row is stamped with. */
  profileId: string;
  /** ISO-8601, injected: this module reads no clock. Every row's `createdAt`/`updatedAt`, and a done row's `completedAt`. */
  now: string;
  list: CsvListChoice;
}

/**
 * Why one row lost something, each with the 1-based row number (header
 * excluded) so the user can find the cell in their spreadsheet. Two codes,
 * deliberately: the title is the one cell a task cannot exist without
 * (`empty-title` skips the row), and the due date is the one lenient reading
 * that can actually fail (`bad-due-date` costs the DATE, never the task).
 * Priority and status readings are total functions, so they have no code.
 */
export type CsvRowDropCode = "empty-title" | "bad-due-date";

export interface CsvRowDrop {
  /** 1-based data-row number, header excluded — the row's own line in the user's spreadsheet view. */
  row: number;
  code: CsvRowDropCode;
}

/**
 * One translation's arithmetic. It balances:
 * `rows === tasks + (empty-title drops) + blankRows` — every data row either
 * became a task, was skipped by name, or was a wholly blank line (skipped
 * silently: a blank spreadsheet line is not a loss). `bad-due-date` drops
 * overlap `tasks`, since that row still arrives.
 */
export interface CsvTranslateReport {
  /** Data rows read (header excluded), blank lines included. */
  rows: number;
  /** Task rows planned. */
  tasks: number;
  /** Rows whose every cell was empty — skipped without a name, and counted so the balance above still holds. */
  blankRows: number;
  drops: readonly CsvRowDrop[];
  /**
   * Non-empty cells of a column mapped `"list"`. Counted, never honoured: the
   * import targets ONE list (see the module header), so these cells are the
   * one mapped thing the translation drops — and a drop nobody is told about
   * is indistinguishable from a bug.
   */
  listCellsDropped: number;
}

export interface CsvTranslation {
  /** Ready for `planForeignImport`, whose id map re-mints every id below. */
  data: ProfileData;
  /** `ForeignImportTarget.seededIds` — one entry exactly when an EXISTING list was chosen. */
  seededIds: ReadonlyMap<string, string>;
  report: CsvTranslateReport;
}

/**
 * The sparse sort-key step imported rows are spaced by — `TASK_ORDER_GAP` in
 * `@nexus/db`'s `taskListStore.ts`, spelled here for `llmPrompts.ts`'s stated
 * reason: `@nexus/core` does not depend on `@nexus/db`, and one integer is not
 * worth inverting that.
 */
const TASK_ORDER_GAP = 1024;

/** The `defaultView` a NEW list is created with — `TaskListStore.create`'s own default, so an imported list opens exactly as a hand-made one does. */
const NEW_LIST_VIEW = "list";

/** The one non-ignore role a mapping may repeat... none. Ignore may repeat freely; every other role means ONE column, or the mapping is ambiguous. */
function assertMappingSound(roles: readonly CsvColumnRole[]): void {
  const seen = new Set<CsvColumnRole>();
  for (const role of roles) {
    if (role === "ignore") continue;
    if (seen.has(role)) {
      throw new Error(`CSV mapping names the role "${role}" twice; every role maps one column.`);
    }
    seen.add(role);
  }
  if (!seen.has("title")) {
    throw new Error("CSV mapping has no title column; a task cannot exist without one.");
  }
}

/**
 * Turns parsed CSV rows into the profile data an import inserts.
 *
 * `rows` are DATA rows — the caller (main's session) has already taken the
 * header off, so row numbers here are the 1-based numbers the report promises.
 * A ragged row reads as if its missing cells were empty, because that is what
 * the spreadsheet the user is looking at shows them as.
 *
 * The shape of the answer is deliberately narrow, exactly as `translateApkg`'s
 * and `translateLlmRecords`' are: a CSV of tasks touches the TASK tables and
 * nothing else, and every other member of `ProfileData` is planned empty —
 * written as one object literal typed `ProfileData`, so a member added to that
 * interface later fails to compile here rather than silently arriving absent.
 *
 * Tags ride as planned `taskTags` rows plus links: the PLANNER then merges a
 * name the target already has onto the target's own tag (`mintTags`), which is
 * exactly the merge column the preview shows. Sections are created inside the
 * one destination list, existing or new — the planner's id map points their
 * `listId` at whichever the choice named.
 */
export function translateCsvTasks(
  rows: readonly (readonly string[])[],
  roles: readonly CsvColumnRole[],
  target: CsvTranslateTarget,
): CsvTranslation {
  assertMappingSound(roles);

  const column = (role: CsvColumnRole): number => roles.indexOf(role);
  const cellOf = (row: readonly string[], role: CsvColumnRole): string => {
    const index = column(role);
    return index === -1 ? "" : (row[index] ?? "");
  };

  const tasks: ExportTask[] = [];
  const sections: ExportTaskSection[] = [];
  const sectionIdByName = new Map<string, string>();
  const tags: ExportTaskTag[] = [];
  const tagIdByName = new Map<string, string>();
  const tagLinks: ExportTaskTagLink[] = [];
  const drops: CsvRowDrop[] = [];
  let blankRows = 0;
  let listCellsDropped = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    if (row.every((cell) => cell.trim().length === 0)) {
      blankRows += 1;
      return;
    }

    // Counted whether or not the row survives: the cell is in the spreadsheet
    // either way, and the count is about what the mapping cannot honour.
    if (cellOf(row, "list").trim().length > 0) listCellsDropped += 1;

    const title = cellOf(row, "title").trim();
    if (title.length === 0) {
      drops.push({ row: rowNumber, code: "empty-title" });
      return;
    }

    const dateReading = readCsvDueDate(cellOf(row, "dueDate"));
    if (dateReading.kind === "bad") drops.push({ row: rowNumber, code: "bad-due-date" });
    const dueDate = dateReading.kind === "date" ? dateReading.value : null;

    const status = readCsvStatus(cellOf(row, "status"));
    const done = status === "done";

    const sectionName = cellOf(row, "section").trim();
    let sectionId: string | null = null;
    if (sectionName.length > 0) {
      const existing = sectionIdByName.get(sectionName);
      if (existing !== undefined) {
        sectionId = existing;
      } else {
        sectionId = `csv:section:${sections.length}`;
        sectionIdByName.set(sectionName, sectionId);
        sections.push({
          id: sectionId,
          listId: CSV_LIST_SOURCE_ID,
          name: sectionName,
          position: (sections.length + 1) * TASK_ORDER_GAP,
          createdAt: target.now,
          updatedAt: target.now,
        });
      }
    }

    const description = cellOf(row, "description").trim();
    const taskId = `csv:task:${rowNumber}`;
    tasks.push({
      id: taskId,
      profileId: target.profileId,
      parentId: null,
      title,
      description: description.length === 0 ? null : description,
      status: done ? "done" : "todo",
      priority: readCsvPriority(cellOf(row, "priority")),
      done,
      dueDate,
      startDate: null,
      createdAt: target.now,
      updatedAt: target.now,
      // Migration 002's own CHECK: a done row and its completion timestamp
      // exist together or not at all.
      completedAt: done ? target.now : null,
      // A one-off with no ladder, for `translateLlmRecords`' stated reason: a
      // rule or a reminder schedule read out of a spreadsheet would be this
      // import scheduling notifications nobody asked for.
      recurrence: null,
      reminderOffsets: [],
      listId: CSV_LIST_SOURCE_ID,
      sectionId,
      position: tasks.length * TASK_ORDER_GAP + TASK_ORDER_GAP,
    });

    for (const name of splitCsvTags(cellOf(row, "tags"))) {
      let tagId = tagIdByName.get(name);
      if (tagId === undefined) {
        tagId = `csv:tag:${tags.length}`;
        tagIdByName.set(name, tagId);
        tags.push({ id: tagId, profileId: target.profileId, name, createdAt: target.now });
      }
      tagLinks.push({ taskId, tagId });
    }
  });

  const list = target.list;
  let taskLists: ExportTaskList[] = [];
  let seededIds: ReadonlyMap<string, string> = new Map();
  if (list.kind === "existing") {
    // ADR-052's seam: the planner resolves `csv:list` onto the chosen row and
    // no list row is created at all.
    seededIds = new Map([[CSV_LIST_SOURCE_ID, list.id]]);
  } else {
    const name = list.name.trim();
    if (name.length === 0) {
      throw new Error("A CSV import's new list needs a name.");
    }
    taskLists = [
      {
        id: CSV_LIST_SOURCE_ID,
        profileId: target.profileId,
        parentId: null,
        name,
        isInbox: false,
        defaultView: NEW_LIST_VIEW,
        viewConfig: null,
        position: TASK_ORDER_GAP,
        createdAt: target.now,
        updatedAt: target.now,
      },
    ];
  }

  const data: ProfileData = {
    tasks,
    taskLists,
    taskSections: sections,
    taskTags: tags,
    taskTagLinks: tagLinks,
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
    plans: [],
    blocks: [],
    focusSessions: [],
    studySettings: [],
    notifications: [],
    notes: [],
    noteFolders: [],
    noteTags: [],
    noteTagLinks: [],
    noteTemplates: [],
    noteAttachments: [],
    noteVersions: [],
    dashboardSettings: [],
    dashboardSets: [],
    dashboardWidgets: [],
  };

  return {
    data,
    seededIds,
    report: {
      rows: rows.length,
      tasks: tasks.length,
      blankRows,
      drops,
      listCellsDropped,
    },
  };
}
