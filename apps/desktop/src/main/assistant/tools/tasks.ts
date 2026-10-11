/**
 * The TASK module through the assistant's eyes: what is on the list, and the
 * three writes someone actually asks for by voice — make one, finish one, move
 * one to another day.
 *
 * **Every read and write below is the store the IPC channel uses.** `tasks:list`
 * calls `TaskStore.listActive`, `tasks:create` calls `TaskStore.create` with the
 * same field names, `tasks:set-done` calls `setDone` — and the store's own
 * placement rules (a task lands in the Inbox unless a list is named, a subtask
 * inherits its parent's list) are the ones that decide, because they are the
 * store's and this file never restates them. That is the whole point of going
 * through the same functions: an assistant filing tasks by its own rules would
 * be a second definition of where a task goes, and the two would disagree the
 * first time a rule moved.
 *
 * **Why a project is a name the model may type.** Task lists are the app's
 * projects (`TaskListStore`, ADR-029), and a model talking to a person hears
 * „u Fakultet", not „listId 0192f…". So the argument is a name or an id, and the
 * name is resolved against this profile's own lists before anything is written —
 * with the real list names in the refusal, which is the one message that lets a
 * model correct itself instead of guessing again.
 *
 * **The clock is main's.** Every `at`/`now` below is built from the injected
 * `now()`, never from the model's arguments: when a task was finished is not
 * something a caller gets to say (SEC-EL-02), and a test can move the clock.
 */

import {
  MAX_TASK_LIST_NAME_LENGTH,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TaskListStore,
  TaskStore,
} from "@nexus/db";
import type { CreateTaskInput, Task, TaskList, TaskStatus } from "@nexus/db";
import { MAX_ID_LENGTH } from "@nexus/core";
import type { AssistantLocale, Citation, Tool } from "@nexus/core";
import {
  asArgs,
  asDay,
  asIdentifier,
  asNullableDay,
  asOptionalCount,
  asOptionalEnum,
  asOptionalText,
  asText,
} from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  formatDayInSentence,
  formatDayShort,
  guard,
  localDay,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface TaskToolDeps {
  readonly profileDb: ProfileDb;
  readonly now: () => number;
}

/** The status choices the schema offers: the store's own three, plus „any". */
const STATUS_FILTERS = ["any", ...TASK_STATUSES] as const;

/**
 * The due-date windows a list may be narrowed to. „week" is today plus the six
 * days after it, which is the window a person means by „this week".
 */
const DUE_FILTERS = ["any", "overdue", "today", "week", "none"] as const;

/** How many rows a list answers with when the model names no cap, and the most it may ask for. */
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

/** A task title's cap, mirroring the store's own refusal so the model is told before the store is asked. */
const MAX_TITLE_CHARS = 200;

/** A description is a paragraph, not a document. */
const MAX_DESCRIPTION_CHARS = 2_000;

/** The app's Serbian Latin ordering, never SQLite's BINARY one — plain `"sr"` mis-tailors š/č/ć/ž. */
const COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

const TASKS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Zadaci (${count}):`,
  en: (count) => `Tasks (${count}):`,
};

const NO_TASKS_MATCHING: AssistantPhrase<[filter: string]> = {
  sr: (filter) => `Nema zadataka koji odgovaraju filteru „${filter}“.`,
  en: (filter) => `No tasks match “${filter}”.`,
};

/** The unfiltered case, said as its own sentence: „no tasks match «any»" is a filter reading nobody wrote. */
const NO_TASKS_AT_ALL: { sr: string; en: string } = {
  sr: "Ovaj profil nema zadataka.",
  en: "This profile has no tasks.",
};

const TASK_ALREADY_DONE: AssistantPhrase<[title: string]> = {
  sr: (title) => `Zadatak „${title}“ je već završen.`,
  en: (title) => `The task “${title}” is already done.`,
};

const TASK_NOT_FOUND: AssistantPhrase<[id: string]> = {
  sr: (id) => `Ne postoji aktivan zadatak sa id-jem „${id}“.`,
  en: (id) => `No active task has the id “${id}”.`,
};

const LIST_NOT_FOUND: AssistantPhrase<[project: string, known: string]> = {
  sr: (project, known) => `Nepoznata lista „${project}“. Liste u ovom profilu: ${known}.`,
  en: (project, known) => `No list named “${project}”. This profile's lists: ${known}.`,
};

/** The few words a row needs, in both languages. */
const ROW: {
  readonly due: { readonly sr: string; readonly en: string };
  readonly noDue: { readonly sr: string; readonly en: string };
  readonly list: { readonly sr: string; readonly en: string };
  readonly truncated: AssistantPhrase<[count: number]>;
} = {
  due: { sr: "rok", en: "due" },
  noDue: { sr: "bez roka", en: "no due date" },
  list: { sr: "lista", en: "list" },
  truncated: {
    sr: (count) => `Prikazani su samo prvi rezultati (${count}).`,
    en: (count) => `Showing only the first ${count} results.`,
  },
};

/** What a confirmation asks the user, in both languages — see `support.ts` on why these are records rather than ternaries. */
const CREATE_SUMMARY: AssistantPhrase<[title: string, due: string | null]> = {
  sr: (title, due) => `Napravi zadatak „${title}“${due === null ? "" : ` — rok ${due}`}`,
  en: (title, due) => `Create task “${title}”${due === null ? "" : ` — due ${due}`}`,
};

const COMPLETE_SUMMARY: AssistantPhrase<[title: string]> = {
  sr: (title) => `Označi zadatak „${title}“ kao završen`,
  en: (title) => `Mark the task “${title}” as done`,
};

const RESCHEDULE_SUMMARY: AssistantPhrase<[title: string, due: string]> = {
  sr: (title, due) => `Prebaci zadatak „${title}“ na ${due}`,
  en: (title, due) => `Reschedule the task “${title}” to ${due}`,
};

const CLEAR_DUE_SUMMARY: AssistantPhrase<[title: string]> = {
  sr: (title) => `Obriši rok zadatka „${title}“`,
  en: (title) => `Clear the due date of “${title}”`,
};

/** What each write answers with. The title and the id are the data; the sentence around them is the app's own. */
const DONE_WORDS = {
  created: {
    sr: (title: string, id: string) => `Napravljen zadatak „${title}“ (${id}).`,
    en: (title: string, id: string) => `Created task “${title}” (${id}).`,
  } satisfies AssistantPhrase<[title: string, id: string]>,
  completed: {
    sr: (title: string, id: string) => `Završen zadatak „${title}“ (${id}).`,
    en: (title: string, id: string) => `Completed task “${title}” (${id}).`,
  } satisfies AssistantPhrase<[title: string, id: string]>,
  rescheduled: {
    sr: (title: string, id: string, day: string) =>
      `Novi rok zadatka „${title}“ (${id}) je ${day}.`,
    en: (title: string, id: string, day: string) =>
      `The due date of “${title}” (${id}) is now ${day}.`,
  } satisfies AssistantPhrase<[title: string, id: string, day: string]>,
  dueCleared: {
    sr: (title: string, id: string) => `Rok zadatka „${title}“ (${id}) je obrisan.`,
    en: (title: string, id: string) => `The due date of “${title}” (${id}) was cleared.`,
  } satisfies AssistantPhrase<[title: string, id: string]>,
} as const;

export function taskTools(deps: TaskToolDeps): readonly Tool[] {
  /** One profile's two stores, built the way `main/index.ts` builds them for a handler. */
  function stores(profileId: string): { tasks: TaskStore; lists: TaskListStore } {
    return deps.profileDb(profileId, (db, id) => ({
      tasks: new TaskStore(db, id),
      lists: new TaskListStore(db, id),
    }));
  }

  const list: Tool = {
    name: "tasks.list",
    description: {
      sr: "Izlistava zadatke iz profila, uz filter po statusu, roku i listi (projektu). Koristi ga pre nego što napišeš šta korisnik ima da uradi; za ono što kasni traži status „todo“ i rok „overdue“.",
      en: "Lists this profile's tasks, filtered by status, due date and list (project). Use it before telling the user what they have to do; for late work ask for status \"todo\" and due \"overdue\".",
    },
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: [...STATUS_FILTERS],
          description: "Task status to keep. Defaults to any.",
        },
        due: {
          type: "string",
          enum: [...DUE_FILTERS],
          description:
            "Due-date window: overdue (before today), today, week (today and the six days after it), none (undated). Defaults to any.",
        },
        project: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TASK_LIST_NAME_LENGTH,
          description: "A task list's name or id. Defaults to every list.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIST_LIMIT,
          description: `How many tasks to answer with. Defaults to ${DEFAULT_LIST_LIMIT}.`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const status = asOptionalEnum(args.status, "status", STATUS_FILTERS) ?? "any";
        const due = asOptionalEnum(args.due, "due", DUE_FILTERS) ?? "any";
        const project =
          args.project === undefined
            ? undefined
            : asText(args.project, "project", MAX_TASK_LIST_NAME_LENGTH);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIST_LIMIT) ?? DEFAULT_LIST_LIMIT;

        const { tasks, lists } = stores(context.profileId);
        const known = lists.listActive();
        const listId =
          project === undefined ? undefined : resolveList(known, project, context.locale).id;
        const today = localDay(deps.now());

        const rows = tasks
          .listActive()
          .filter((task) => status === "any" || task.status === status)
          .filter((task) => matchesDue(task, due, today))
          .filter((task) => listId === undefined || task.listId === listId)
          .sort(openFirst);

        const filter = describeFilter(status, due, project);
        if (rows.length === 0) {
          return okResult(
            filter === null
              ? text(context.locale, NO_TASKS_AT_ALL)
              : phrase(context.locale, NO_TASKS_MATCHING, filter),
          );
        }
        const shown = rows.slice(0, limit);
        const lines = shown.map((task) => taskLine(context.locale, task, nameOfList(known, task)));
        const content = [phrase(context.locale, TASKS_HEADING, shown.length), ...lines];
        if (shown.length < rows.length) {
          content.push(phrase(context.locale, ROW.truncated, shown.length));
        }
        return okResult(content.join("\n"), { citations: shown.map(taskCitation) });
      }),
  };

  const create: Tool = {
    name: "tasks.create",
    description: {
      sr: "Pravi jedan zadatak u profilu. Koristi ga kada korisnik traži da nešto zapamti ili uradi; ako je to možda već zapisano, prvo pozovi tasks.list. Rok je običan datum („2026-10-12“), bez vremena.",
      en: "Creates one task in this profile. Use it when the user asks to remember something or to get something done; if that may already be recorded, call tasks.list first. The due date is a plain calendar day (\"2026-10-12\"), with no time of day.",
    },
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TITLE_CHARS,
          description: "What the task is, in the user's own words.",
        },
        due: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "The day it is due, as YYYY-MM-DD.",
        },
        priority: {
          type: "string",
          enum: [...TASK_PRIORITIES],
          description: "Priority. Defaults to none.",
        },
        project: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TASK_LIST_NAME_LENGTH,
          description: "The list (project) it belongs to, by name or id. Defaults to the Inbox.",
        },
        description: {
          type: "string",
          maxLength: MAX_DESCRIPTION_CHARS,
          description: "Extra detail, when the user gave some.",
        },
      },
      required: ["title"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const title = asText(args.title, "title", MAX_TITLE_CHARS);
        const due = args.due === undefined ? undefined : asDay(args.due, "due");
        const priority = asOptionalEnum(args.priority, "priority", TASK_PRIORITIES);
        const project =
          args.project === undefined
            ? undefined
            : asText(args.project, "project", MAX_TASK_LIST_NAME_LENGTH);
        const description = asOptionalText(args.description, "description", MAX_DESCRIPTION_CHARS);

        const { tasks, lists } = stores(context.profileId);
        const listId =
          project === undefined
            ? undefined
            : resolveList(lists.listActive(), project, context.locale).id;

        const declined = await confirmOrDecline(
          context,
          "tasks.create",
          "write",
          phrase(
            context.locale,
            CREATE_SUMMARY,
            title,
            due === undefined ? null : formatDayShort(context.locale, due),
          ),
        );
        if (declined !== null) return declined;

        const input: CreateTaskInput = { title };
        if (due !== undefined) input.dueDate = due;
        if (priority !== undefined) input.priority = priority;
        if (description !== undefined) input.description = description;
        if (listId !== undefined) input.listId = listId;
        const created = tasks.create(input, instantOf(deps.now()));
        return okResult(phrase(context.locale, DONE_WORDS.created, created.title, created.id), {
          citations: [taskCitation(created)],
          navigateTo: { module: "tasks", item: created.id },
        });
      }),
  };

  const complete: Tool = {
    name: "tasks.complete",
    description: {
      sr: "Označava zadatak kao završen. Prvo pozovi tasks.list da dobiješ id zadatka; ako je zadatak već završen, alat samo kaže da ništa nije promenjeno.",
      en: "Marks a task done. Call tasks.list first to get the task's id; if it is already done, the tool reports that nothing changed.",
    },
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "The task id, exactly as tasks.list reports it.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const id = asIdentifier(args.id, "id");
        const { tasks } = stores(context.profileId);
        const task = requireTask(tasks, id, context.locale);
        if (task.done) {
          return okResult(phrase(context.locale, TASK_ALREADY_DONE, task.title), {
            citations: [taskCitation(task)],
          });
        }

        const declined = await confirmOrDecline(
          context,
          "tasks.complete",
          "write",
          phrase(context.locale, COMPLETE_SUMMARY, task.title),
        );
        if (declined !== null) return declined;

        const done = tasks.setDone(id, true, instantOf(deps.now()));
        return okResult(phrase(context.locale, DONE_WORDS.completed, done.title, done.id), {
          citations: [taskCitation(done)],
        });
      }),
  };

  const reschedule: Tool = {
    name: "tasks.reschedule",
    description: {
      sr: "Menja rok zadatka. Koristi ga kada korisnik traži da se zadatak pomeri na drugi dan; prvo pozovi tasks.list da dobiješ id. Rok je običan datum, a `null` briše rok.",
      en: "Moves a task's due date. Use it when the user asks to push a task to another day; call tasks.list first for the id. The date is a plain calendar day, and `null` clears the due date.",
    },
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "The task id, exactly as tasks.list reports it.",
        },
        due: {
          type: ["string", "null"],
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "The new due day as YYYY-MM-DD, or null to remove the due date.",
        },
      },
      required: ["id", "due"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const id = asIdentifier(args.id, "id");
        const due = asNullableDay(args.due, "due");
        const { tasks } = stores(context.profileId);
        const task = requireTask(tasks, id, context.locale);

        const declined = await confirmOrDecline(
          context,
          "tasks.reschedule",
          "write",
          due === null
            ? phrase(context.locale, CLEAR_DUE_SUMMARY, task.title)
            : phrase(
                context.locale,
                RESCHEDULE_SUMMARY,
                task.title,
                formatDayShort(context.locale, due),
              ),
        );
        if (declined !== null) return declined;

        const updated = tasks.update(id, { dueDate: due });
        return okResult(
          due === null
            ? phrase(context.locale, DONE_WORDS.dueCleared, updated.title, updated.id)
            : phrase(
                context.locale,
                DONE_WORDS.rescheduled,
                updated.title,
                updated.id,
                formatDayInSentence(context.locale, due),
              ),
          { citations: [taskCitation(updated)] },
        );
      }),
  };

  return [list, create, complete, reschedule];
}

/** The instant a store writes, from main's clock. */
function instantOf(atMs: number): string {
  return new Date(atMs).toISOString();
}

/**
 * The task a write names, or a refusal the model can act on.
 *
 * Read from `listActive` rather than from a store getter, because this is also
 * where an id belonging to another profile, to a soft-deleted task or to nothing
 * at all becomes one single answer — and because the title in the confirmation
 * sentence is a fact this tool needs before it asks.
 */
function requireTask(tasks: TaskStore, id: string, locale: AssistantLocale): Task {
  const task = tasks.listActive().find((row) => row.id === id);
  if (task === undefined) throw new Error(phrase(locale, TASK_NOT_FOUND, id));
  return task;
}

/**
 * A project name or id into the list it names.
 *
 * Exact on the id and case-insensitive on the name, with the profile's own names
 * in the refusal: a model that typed „fakultet" for „Fakultet" must be told what
 * the list is really called rather than left to guess again.
 */
function resolveList(lists: readonly TaskList[], project: string, locale: AssistantLocale): TaskList {
  const folded = project.trim().toLocaleLowerCase(["sr-Latn", "sr"]);
  const match =
    lists.find((entry) => entry.id === project) ??
    lists.find((entry) => entry.name.toLocaleLowerCase(["sr-Latn", "sr"]) === folded);
  if (match === undefined) {
    throw new Error(
      phrase(locale, LIST_NOT_FOUND, project, lists.map((entry) => entry.name).join(", ")),
    );
  }
  return match;
}

/**
 * The due-date window, as a fact about the row's `dueDate` alone.
 *
 * „overdue" therefore means „its day has passed", finished or not — the model
 * combines it with `status: "todo"` when it wants open late work, and the
 * description says so. Filtering on status here instead would make one argument
 * silently do two jobs.
 */
function matchesDue(task: Task, due: (typeof DUE_FILTERS)[number], today: string): boolean {
  switch (due) {
    case "any":
      return true;
    case "none":
      return task.dueDate === null;
    case "today":
      return task.dueDate === today;
    case "overdue":
      return task.dueDate !== null && task.dueDate < today;
    case "week":
      return task.dueDate !== null && task.dueDate >= today && task.dueDate <= shiftDays(today, 6);
  }
}

/** Bare-day arithmetic on UTC midnights, so a shifted day never drifts by one across a DST boundary. */
function shiftDays(day: string, days: number): string {
  const at = Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
  );
  const moved = new Date(at + days * 86_400_000);
  const month = String(moved.getUTCMonth() + 1).padStart(2, "0");
  const date = String(moved.getUTCDate()).padStart(2, "0");
  return `${moved.getUTCFullYear()}-${month}-${date}`;
}

/**
 * Open work first, then the nearest deadline, then the title in the app's own
 * Serbian ordering.
 *
 * „Open first" is the one ordering decision here, and it is the one the question
 * deserves: a list that interleaves finished rows with live ones answers „what
 * is left" worse than one that does not, and a done task's date no longer says
 * anything about what to do next.
 */
function openFirst(left: Task, right: Task): number {
  if (left.done !== right.done) return left.done ? 1 : -1;
  const leftDue = left.dueDate ?? "";
  const rightDue = right.dueDate ?? "";
  if (leftDue !== rightDue) {
    if (leftDue === "") return 1;
    if (rightDue === "") return -1;
    return leftDue < rightDue ? -1 : 1;
  }
  return COLLATOR.compare(left.title, right.title);
}

/** The list a task sits in, by name; empty when this profile has no such row (every task has one — this is for a database that lost it). */
function nameOfList(lists: readonly TaskList[], task: Task): string {
  return lists.find((entry) => entry.id === task.listId)?.name ?? "";
}

/** One task as a line: the id first, because that is what a follow-up write needs, then the reading a person would give. */
function taskLine(locale: AssistantLocale, task: Task, listName: string): string {
  const due =
    task.dueDate === null
      ? text(locale, ROW.noDue)
      : `${text(locale, ROW.due)} ${formatDayInSentence(locale, task.dueDate)}`;
  const parts: string[] = [task.status, due];
  if (listName.length > 0) parts.push(`${text(locale, ROW.list)} ${listName}`);
  if (task.priority !== "none") parts.push(task.priority);
  return `- ${task.id} ${task.title} [${parts.join(", ")}]`;
}

/** The words the model sent, for the „nothing matched" sentence — so it can see which one to change — or null when it asked for everything. */
function describeFilter(
  status: TaskStatus | "any",
  due: (typeof DUE_FILTERS)[number],
  project: string | undefined,
): string | null {
  const parts = [status, due, project ?? ""].filter((part) => part.length > 0 && part !== "any");
  return parts.length === 0 ? null : parts.join(", ");
}

/** A task the answer drew on, so the page can open what the assistant read. */
function taskCitation(task: Task): Citation {
  return {
    kind: "task",
    id: task.id,
    title: task.title,
    location: { module: "tasks", item: task.id },
  };
}
