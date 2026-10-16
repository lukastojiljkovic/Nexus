/**
 * The TASK module through the assistant's eyes: what is on the list, and the
 * writes someone actually asks for by voice — make one, change one, finish one,
 * move one to another day, put it in a project, tag it, make it wait on another,
 * or repeat it.
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
 * model correct itself instead of guessing again. The same rule holds for a
 * task (its id or its exact title), a tag, a template, a section.
 *
 * **The clock is main's.** Every `at`/`now` below is built from the injected
 * `now()`, never from the model's arguments: when a task was finished is not
 * something a caller gets to say (SEC-EL-02), and a test can move the clock.
 */

import type Database from "better-sqlite3-multiple-ciphers";
import {
  MAX_TASK_BULK_IDS,
  MAX_TASK_LIST_NAME_LENGTH,
  MAX_TASK_REMINDER_DAYS,
  MAX_TASK_REMINDERS,
  MAX_TASK_TAG_NAME_LENGTH,
  MAX_TASK_TEMPLATE_DUE_OFFSET_DAYS,
  MAX_TASK_TEMPLATE_NAME_LENGTH,
  TASK_LIST_VIEWS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TaskDependencyStore,
  TaskListStore,
  TaskStore,
  TaskTagStore,
  TaskTemplateStore,
} from "@nexus/db";
import type {
  CreateTaskInput,
  DeleteListMode,
  Task,
  TaskList,
  TaskListView,
  TaskStatus,
  TaskTemplatePayload,
  UpdateTaskFields,
} from "@nexus/db";
import {
  MAX_ID_LENGTH,
  MAX_RECURRENCE_COUNT,
  MAX_RECURRENCE_INTERVAL,
  dayKeyToUtcMs,
  isValidDayKey,
  validateRecurrenceRule,
} from "@nexus/core";
import type {
  AssistantLocale,
  Citation,
  RecurrenceEnd,
  RecurrenceFreq,
  RecurrenceRule,
  RecurrenceWeekday,
  Tool,
} from "@nexus/core";
import {
  asArgs,
  asCount,
  asDay,
  asEnum,
  asNullableDay,
  asOptionalCount,
  asOptionalEnum,
  asOptionalText,
  asText,
  asTextList,
} from "./args.js";
import { applyTaskTemplate } from "../../taskTemplates.js";
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

/** Every store one profile's task tools write through, built the way `main/index.ts` builds them for a handler. */
interface ProfileStores {
  readonly db: Database.Database;
  readonly tasks: TaskStore;
  readonly lists: TaskListStore;
  readonly tags: TaskTagStore;
  readonly templates: TaskTemplateStore;
  readonly dependencies: TaskDependencyStore;
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

/** A calendar day as the schema states it. */
const DAY_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

/** How often a task repeats, as a model says it. `workday` is Monday to Friday. */
const REPEAT_UNITS = ["day", "workday", "week", "month", "year"] as const;

/** Weekday names, Monday-first: the index of a name is the `RecurrenceWeekday` it stands for. */
const WEEKDAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const PROJECT_ACTIONS = [
  "create",
  "rename",
  "move",
  "delete",
  "restore",
  "section-add",
  "section-rename",
  "section-delete",
] as const;

/** What a list's tasks do when the list is deleted: the store's two answers, with the safe one as the default. */
const DELETE_MODES = ["move-to-inbox", "delete-tasks"] as const satisfies readonly DeleteListMode[];

const TAG_ACTIONS = ["attach", "detach", "create", "rename", "delete"] as const;
const TEMPLATE_ACTIONS = ["save", "apply", "delete"] as const;
const DEPEND_ACTIONS = ["add", "remove"] as const;
const BULK_ACTIONS = ["move", "priority", "due"] as const;

/** One calendar day in epoch milliseconds: the unit every day offset in this file is counted in. */
const MS_PER_DAY = 86_400_000;

/** The Serbian plural of a counted noun, from its three forms: 1, 2–4, and the rest. */
function serbianForm(count: number, forms: readonly [one: string, few: string, many: string]): string {
  const ones = count % 10;
  const tens = count % 100;
  if (ones === 1 && tens !== 11) return forms[0];
  if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return forms[1];
  return forms[2];
}

const TASKS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Zadaci (${count}):`,
  en: (count) => `Tasks (${count}):`,
};

const DEPENDENCIES_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Zavisnosti (${count}):`,
  en: (count) => `Dependencies (${count}):`,
};

/** The word a confirmation carries when the task repeats, and the reminder clause it carries when it has reminders. */
const REPEATS_WORD: { readonly sr: string; readonly en: string } = {
  sr: "ponavlja se",
  en: "repeats",
};

const REMINDER_PART: AssistantPhrase<[days: string]> = {
  sr: (days) => `podsetnik ${days} d. pre roka`,
  en: (days) => `reminder ${days} day(s) before due`,
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

const TASK_NOT_FOUND: AssistantPhrase<[ref: string]> = {
  sr: (ref) => `Ne postoji aktivan zadatak sa id-jem ili naslovom „${ref}“.`,
  en: (ref) => `No active task has the id or title “${ref}”.`,
};

/** A name or id that two rows of one kind share: the refusal lists them, so the model can name one by its id. */
const AMBIGUOUS: AssistantPhrase<[ref: string, candidates: string]> = {
  sr: (ref, candidates) =>
    `„${ref}“ odgovara većem broju stavki: ${candidates}. Navedi id jedne od njih.`,
  en: (ref, candidates) =>
    `“${ref}” matches more than one item: ${candidates}. Name one of them by its id.`,
};

const LIST_NOT_FOUND: AssistantPhrase<[project: string, known: string]> = {
  sr: (project, known) => `Nepoznata lista „${project}“. Liste u ovom profilu: ${known}.`,
  en: (project, known) => `No list named “${project}”. This profile's lists: ${known}.`,
};

const SECTION_NOT_FOUND: AssistantPhrase<[section: string, known: string]> = {
  sr: (section, known) => `Nepoznat odeljak „${section}“ u toj listi. Odeljci: ${known}.`,
  en: (section, known) => `No section named “${section}” in that list. Its sections: ${known}.`,
};

const TAG_NOT_FOUND: AssistantPhrase<[tag: string, known: string]> = {
  sr: (tag, known) => `Nepoznata oznaka „${tag}“. Oznake u ovom profilu: ${known}.`,
  en: (tag, known) => `No tag named “${tag}”. This profile's tags: ${known}.`,
};

const TEMPLATE_NOT_FOUND: AssistantPhrase<[template: string, known: string]> = {
  sr: (template, known) => `Nepoznat šablon „${template}“. Šabloni u ovom profilu: ${known}.`,
  en: (template, known) => `No template named “${template}”. This profile's templates: ${known}.`,
};

const BULK_NOT_FOUND: AssistantPhrase<[id: string]> = {
  sr: (id) => `Ne postoji aktivan zadatak sa id-jem „${id}“. Nijedan zadatak nije promenjen.`,
  en: (id) => `No active task has the id “${id}”. Nothing was changed.`,
};

/** A repeat rule's refusals, one per way the model can ask for something the store cannot hold. */
const REPEAT_REFUSAL: {
  readonly needsDue: AssistantPhrase<[]>;
  readonly remindersNeedDue: AssistantPhrase<[]>;
  readonly weekdays: AssistantPhrase<[]>;
  readonly endTwice: AssistantPhrase<[]>;
  readonly invalid: AssistantPhrase<[]>;
} = {
  needsDue: {
    sr: () => "Ponavljanje traži rok. Dodaj rok pa ponavljanje.",
    en: () => "A repeat needs a due date. Add the due date with the repeat.",
  },
  remindersNeedDue: {
    sr: () => "Podsetnici traže rok. Dodaj rok pa podsetnike.",
    en: () => "Reminders need a due date. Add the due date with the reminders.",
  },
  weekdays: {
    sr: () => "Dani u nedelji važe samo za ponavljanje po nedeljama.",
    en: () => "Weekdays apply only to a weekly repeat.",
  },
  endTwice: {
    sr: () => "Ponavljanje se završava ili datumom ili brojem ponavljanja, ne oba.",
    en: () => "A repeat ends by a date or by a count, not both.",
  },
  invalid: {
    sr: () => "Ponavljanje nije važeće.",
    en: () => "That repeat is not valid.",
  },
};

/** The few words a row needs, in both languages. */
const ROW: {
  readonly due: { readonly sr: string; readonly en: string };
  readonly noDue: { readonly sr: string; readonly en: string };
  readonly list: { readonly sr: string; readonly en: string };
  readonly under: { readonly sr: string; readonly en: string };
  readonly waitsOn: { readonly sr: string; readonly en: string };
  readonly yes: { readonly sr: string; readonly en: string };
  readonly none: { readonly sr: string; readonly en: string };
  readonly truncated: AssistantPhrase<[count: number]>;
} = {
  due: { sr: "rok", en: "due" },
  noDue: { sr: "bez roka", en: "no due date" },
  list: { sr: "lista", en: "list" },
  under: { sr: "pod", en: "under" },
  waitsOn: { sr: "čeka na", en: "waits on" },
  yes: { sr: "da", en: "yes" },
  none: { sr: "nema", en: "none" },
  truncated: {
    sr: (count) => `Prikazani su samo prvi rezultati (${count}).`,
    en: (count) => `Showing only the first ${count} results.`,
  },
};

/** A count of tasks in the language's own grammar: „1 zadatak", „3 zadatka", „5 zadataka". */
const TASK_COUNT: AssistantPhrase<[count: number]> = {
  sr: (count) => `${count} ${serbianForm(count, ["zadatak", "zadatka", "zadataka"])}`,
  en: (count) => `${count} ${count === 1 ? "task" : "tasks"}`,
};

/** What a confirmation asks the user, in both languages — see `support.ts` on why these are records rather than ternaries. */
const CREATE_SUMMARY: AssistantPhrase<[title: string, due: string | null]> = {
  sr: (title, due) => `Napravi zadatak „${title}“${due === null ? "" : ` — rok ${due}`}`,
  en: (title, due) => `Create task “${title}”${due === null ? "" : ` — due ${due}`}`,
};

const COMPLETE_SUMMARY: AssistantPhrase<[title: string, occurrence: boolean]> = {
  sr: (title, occurrence) =>
    occurrence
      ? `Završi ovo ponavljanje zadatka „${title}“`
      : `Označi zadatak „${title}“ kao završen`,
  en: (title, occurrence) =>
    occurrence
      ? `Complete this occurrence of “${title}”`
      : `Mark the task “${title}” as done`,
};

const RESCHEDULE_SUMMARY: AssistantPhrase<[title: string, due: string]> = {
  sr: (title, due) => `Prebaci zadatak „${title}“ na ${due}`,
  en: (title, due) => `Reschedule the task “${title}” to ${due}`,
};

const CLEAR_DUE_SUMMARY: AssistantPhrase<[title: string]> = {
  sr: (title) => `Obriši rok zadatka „${title}“`,
  en: (title) => `Clear the due date of “${title}”`,
};

/** The words an update names as changed: the field, then its new value. */
const FIELD_NAME: Record<keyof UpdateTaskFields, { readonly sr: string; readonly en: string }> = {
  title: { sr: "naslov", en: "title" },
  description: { sr: "opis", en: "description" },
  status: { sr: "status", en: "status" },
  priority: { sr: "prioritet", en: "priority" },
  dueDate: { sr: "rok", en: "due" },
  startDate: { sr: "početak", en: "start" },
  recurrence: { sr: "ponavljanje", en: "repeat" },
  reminderOffsets: { sr: "podsetnici", en: "reminders" },
};

const CHANGE_SUMMARY: AssistantPhrase<[title: string, changes: string]> = {
  sr: (title, changes) => `Izmeni zadatak „${title}“ — ${changes}`,
  en: (title, changes) => `Change the task “${title}” — ${changes}`,
};

const NOTHING_CHANGED: AssistantPhrase<[title: string, id: string]> = {
  sr: (title, id) => `Zadatak „${title}“ (${id}) već ima te vrednosti; ništa nije promenjeno.`,
  en: (title, id) => `The task “${title}” (${id}) already has those values; nothing changed.`,
};

const DELETE_SUMMARY: AssistantPhrase<[title: string]> = {
  sr: (title) => `Obriši zadatak „${title}“ — može da se vrati`,
  en: (title) => `Delete the task “${title}” — you can undo this`,
};

const RESTORE_SUMMARY: AssistantPhrase<[id: string]> = {
  sr: (id) => `Vrati obrisani zadatak (${id})`,
  en: (id) => `Restore the deleted task (${id})`,
};

/** What each write answers with. The title and the id are the data; the sentence around them is the app's own. */
const DONE_WORDS = {
  created: {
    sr: (title: string, id: string) => `Napravljen zadatak „${title}“ (${id}).`,
    en: (title: string, id: string) => `Created task “${title}” (${id}).`,
  } satisfies AssistantPhrase<[title: string, id: string]>,
  createdFromTemplate: {
    sr: (title: string, id: string, template: string) =>
      `Napravljen zadatak „${title}“ (${id}) iz šablona „${template}“.`,
    en: (title: string, id: string, template: string) =>
      `Created task “${title}” (${id}) from the template “${template}”.`,
  } satisfies AssistantPhrase<[title: string, id: string, template: string]>,
  completed: {
    sr: (title: string, id: string) => `Završen zadatak „${title}“ (${id}).`,
    en: (title: string, id: string) => `Completed task “${title}” (${id}).`,
  } satisfies AssistantPhrase<[title: string, id: string]>,
  occurrenceAdvanced: {
    sr: (title: string, id: string, day: string) =>
      `Završeno je ovo ponavljanje zadatka „${title}“ (${id}); sledeći rok je ${day}.`,
    en: (title: string, id: string, day: string) =>
      `Completed this occurrence of “${title}” (${id}); the next due date is ${day}.`,
  } satisfies AssistantPhrase<[title: string, id: string, day: string]>,
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
  updated: {
    sr: (title: string, id: string, changes: string) => `Izmenjen zadatak „${title}“ (${id}): ${changes}.`,
    en: (title: string, id: string, changes: string) => `Updated task “${title}” (${id}): ${changes}.`,
  } satisfies AssistantPhrase<[title: string, id: string, changes: string]>,
  deleted: {
    sr: (title: string, id: string) => `Obrisan zadatak „${title}“ (${id}). Može da se vrati.`,
    en: (title: string, id: string) => `Deleted task “${title}” (${id}). It can be restored.`,
  } satisfies AssistantPhrase<[title: string, id: string]>,
  restored: {
    sr: (id: string) => `Vraćen zadatak (${id}).`,
    en: (id: string) => `Restored task (${id}).`,
  } satisfies AssistantPhrase<[id: string]>,
} as const;

const CREATE_LIST: AssistantPhrase<[name: string]> = {
  sr: (name) => `Napravi listu „${name}“`,
  en: (name) => `Create the list “${name}”`,
};

const UNDER_LIST: AssistantPhrase<[parent: string]> = {
  sr: (parent) => `pod „${parent}“`,
  en: (parent) => `under “${parent}”`,
};

/** A list operation's confirmation and answer, one record each so the two languages cannot drift. */
const PROJECT_WORDS = {
  renameSummary: {
    sr: (from: string, to: string) => `Preimenuj listu „${from}“ u „${to}“`,
    en: (from: string, to: string) => `Rename the list “${from}” to “${to}”`,
  } satisfies AssistantPhrase<[from: string, to: string]>,
  moveSummary: {
    sr: (name: string, parent: string | null) =>
      parent === null ? `Premesti listu „${name}“ na vrh` : `Premesti listu „${name}“ pod „${parent}“`,
    en: (name: string, parent: string | null) =>
      parent === null ? `Move the list “${name}” to the top` : `Move the list “${name}” under “${parent}”`,
  } satisfies AssistantPhrase<[name: string, parent: string | null]>,
  deleteMoveSummary: {
    sr: (name: string) => `Obriši listu „${name}“ — zadaci idu u Inbox`,
    en: (name: string) => `Delete the list “${name}” — its tasks move to the Inbox`,
  } satisfies AssistantPhrase<[name: string]>,
  deleteTasksSummary: {
    sr: (name: string, count: string) => `Obriši listu „${name}“ zajedno sa ${count}`,
    en: (name: string, count: string) => `Delete the list “${name}” with its ${count}`,
  } satisfies AssistantPhrase<[name: string, count: string]>,
  restoreSummary: {
    sr: (id: string) => `Vrati obrisanu listu (${id})`,
    en: (id: string) => `Restore the deleted list (${id})`,
  } satisfies AssistantPhrase<[id: string]>,
  sectionAddSummary: {
    sr: (name: string, list: string) => `Dodaj odeljak „${name}“ u listu „${list}“`,
    en: (name: string, list: string) => `Add the section “${name}” to the list “${list}”`,
  } satisfies AssistantPhrase<[name: string, list: string]>,
  sectionRenameSummary: {
    sr: (from: string, to: string) => `Preimenuj odeljak „${from}“ u „${to}“`,
    en: (from: string, to: string) => `Rename the section “${from}” to “${to}”`,
  } satisfies AssistantPhrase<[from: string, to: string]>,
  sectionDeleteSummary: {
    sr: (name: string) => `Obriši odeljak „${name}“ — zadaci ostaju u listi`,
    en: (name: string) => `Delete the section “${name}” — its tasks stay in the list`,
  } satisfies AssistantPhrase<[name: string]>,
  created: {
    sr: (name: string, id: string) => `Napravljena lista „${name}“ (${id}).`,
    en: (name: string, id: string) => `Created the list “${name}” (${id}).`,
  } satisfies AssistantPhrase<[name: string, id: string]>,
  renamed: {
    sr: (from: string, to: string, id: string) => `Lista „${from}“ je preimenovana u „${to}“ (${id}).`,
    en: (from: string, to: string, id: string) => `The list “${from}” is now “${to}” (${id}).`,
  } satisfies AssistantPhrase<[from: string, to: string, id: string]>,
  moved: {
    sr: (name: string, id: string) => `Lista „${name}“ je premeštena (${id}).`,
    en: (name: string, id: string) => `The list “${name}” was moved (${id}).`,
  } satisfies AssistantPhrase<[name: string, id: string]>,
  deleted: {
    sr: (name: string, id: string) => `Obrisana lista „${name}“ (${id}). Može da se vrati.`,
    en: (name: string, id: string) => `Deleted the list “${name}” (${id}). It can be restored.`,
  } satisfies AssistantPhrase<[name: string, id: string]>,
  restored: {
    sr: (id: string) => `Vraćena lista (${id}).`,
    en: (id: string) => `Restored the list (${id}).`,
  } satisfies AssistantPhrase<[id: string]>,
  sectionAdded: {
    sr: (name: string, list: string, id: string) => `Dodat odeljak „${name}“ u listi „${list}“ (${id}).`,
    en: (name: string, list: string, id: string) => `Added the section “${name}” to “${list}” (${id}).`,
  } satisfies AssistantPhrase<[name: string, list: string, id: string]>,
  sectionRenamed: {
    sr: (from: string, to: string, id: string) => `Odeljak „${from}“ je preimenovan u „${to}“ (${id}).`,
    en: (from: string, to: string, id: string) => `The section “${from}” is now “${to}” (${id}).`,
  } satisfies AssistantPhrase<[from: string, to: string, id: string]>,
  sectionDeleted: {
    sr: (name: string, id: string) => `Obrisan odeljak „${name}“ (${id}); zadaci su ostali u listi.`,
    en: (name: string, id: string) => `Deleted the section “${name}” (${id}); its tasks stayed in the list.`,
  } satisfies AssistantPhrase<[name: string, id: string]>,
} as const;

const LISTS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Liste (${count}):`,
  en: (count) => `Lists (${count}):`,
};

const NO_LISTS: { sr: string; en: string } = {
  sr: "Ovaj profil nema lista.",
  en: "This profile has no lists.",
};

const TAGS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Oznake (${count}):`,
  en: (count) => `Tags (${count}):`,
};

const NO_TAGS: { sr: string; en: string } = {
  sr: "Ovaj profil nema oznaka.",
  en: "This profile has no tags.",
};

const TAG_WORDS = {
  attachSummary: {
    sr: (task: string, tag: string) => `Označi zadatak „${task}“ oznakom „${tag}“`,
    en: (task: string, tag: string) => `Tag the task “${task}” with “${tag}”`,
  } satisfies AssistantPhrase<[task: string, tag: string]>,
  detachSummary: {
    sr: (task: string, tag: string) => `Ukloni oznaku „${tag}“ sa zadatka „${task}“`,
    en: (task: string, tag: string) => `Remove the tag “${tag}” from the task “${task}”`,
  } satisfies AssistantPhrase<[task: string, tag: string]>,
  createSummary: {
    sr: (tag: string) => `Napravi oznaku „${tag}“`,
    en: (tag: string) => `Create the tag “${tag}”`,
  } satisfies AssistantPhrase<[tag: string]>,
  renameSummary: {
    sr: (from: string, to: string) => `Preimenuj oznaku „${from}“ u „${to}“`,
    en: (from: string, to: string) => `Rename the tag “${from}” to “${to}”`,
  } satisfies AssistantPhrase<[from: string, to: string]>,
  deleteSummary: {
    sr: (tag: string) => `Obriši oznaku „${tag}“ sa svih zadataka`,
    en: (tag: string) => `Delete the tag “${tag}” from every task`,
  } satisfies AssistantPhrase<[tag: string]>,
  attached: {
    sr: (task: string, tag: string, id: string) => `Zadatak „${task}“ (${id}) ima oznaku „${tag}“.`,
    en: (task: string, tag: string, id: string) => `The task “${task}” (${id}) has the tag “${tag}”.`,
  } satisfies AssistantPhrase<[task: string, tag: string, id: string]>,
  detached: {
    sr: (task: string, tag: string, id: string) => `Oznaka „${tag}“ je uklonjena sa zadatka „${task}“ (${id}).`,
    en: (task: string, tag: string, id: string) => `The tag “${tag}” was removed from “${task}” (${id}).`,
  } satisfies AssistantPhrase<[task: string, tag: string, id: string]>,
  created: {
    sr: (tag: string, id: string) => `Oznaka „${tag}“ (${id}).`,
    en: (tag: string, id: string) => `The tag “${tag}” (${id}).`,
  } satisfies AssistantPhrase<[tag: string, id: string]>,
  renamed: {
    sr: (from: string, to: string, id: string) => `Oznaka „${from}“ je sada „${to}“ (${id}).`,
    en: (from: string, to: string, id: string) => `The tag “${from}” is now “${to}” (${id}).`,
  } satisfies AssistantPhrase<[from: string, to: string, id: string]>,
  deleted: {
    sr: (tag: string) => `Obrisana oznaka „${tag}“.`,
    en: (tag: string) => `Deleted the tag “${tag}”.`,
  } satisfies AssistantPhrase<[tag: string]>,
  alreadyAttached: {
    sr: (task: string, tag: string) => `Zadatak „${task}“ već ima oznaku „${tag}“; ništa nije promenjeno.`,
    en: (task: string, tag: string) => `The task “${task}” already has the tag “${tag}”; nothing changed.`,
  } satisfies AssistantPhrase<[task: string, tag: string]>,
} as const;

const TEMPLATES_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Šabloni (${count}):`,
  en: (count) => `Templates (${count}):`,
};

const NO_TEMPLATES: { sr: string; en: string } = {
  sr: "Ovaj profil nema šablona.",
  en: "This profile has no templates.",
};

const TEMPLATE_WORDS = {
  saveSummary: {
    sr: (task: string, template: string) => `Sačuvaj zadatak „${task}“ kao šablon „${template}“`,
    en: (task: string, template: string) => `Save the task “${task}” as the template “${template}”`,
  } satisfies AssistantPhrase<[task: string, template: string]>,
  applySummary: {
    sr: (template: string, list: string) => `Napravi zadatak iz šablona „${template}“ u listi „${list}“`,
    en: (template: string, list: string) => `Create a task from the template “${template}” in “${list}”`,
  } satisfies AssistantPhrase<[template: string, list: string]>,
  deleteSummary: {
    sr: (template: string) => `Obriši šablon „${template}“`,
    en: (template: string) => `Delete the template “${template}”`,
  } satisfies AssistantPhrase<[template: string]>,
  saved: {
    sr: (template: string, id: string) => `Šablon „${template}“ je sačuvan (${id}).`,
    en: (template: string, id: string) => `The template “${template}” was saved (${id}).`,
  } satisfies AssistantPhrase<[template: string, id: string]>,
  deleted: {
    sr: (template: string) => `Obrisan šablon „${template}“.`,
    en: (template: string) => `Deleted the template “${template}”.`,
  } satisfies AssistantPhrase<[template: string]>,
  subtasks: {
    sr: (count: number) => `${count} ${serbianForm(count, ["podzadatak", "podzadatka", "podzadataka"])}`,
    en: (count: number) => `${count} ${count === 1 ? "subtask" : "subtasks"}`,
  } satisfies AssistantPhrase<[count: number]>,
} as const;

const NO_DEPENDENCIES: { sr: string; en: string } = {
  sr: "Nijedan zadatak ne čeka na drugi.",
  en: "No task waits on another.",
};

const DEPENDENCY_WORDS = {
  addSummary: {
    sr: (task: string, on: string) => `Zadatak „${task}“ čeka na „${on}“`,
    en: (task: string, on: string) => `The task “${task}” waits on “${on}”`,
  } satisfies AssistantPhrase<[task: string, on: string]>,
  removeSummary: {
    sr: (task: string, on: string) => `Ukloni zavisnost: „${task}“ više ne čeka na „${on}“`,
    en: (task: string, on: string) => `Remove the dependency: “${task}” no longer waits on “${on}”`,
  } satisfies AssistantPhrase<[task: string, on: string]>,
  added: {
    sr: (task: string, on: string) => `Zadatak „${task}“ sada čeka na „${on}“.`,
    en: (task: string, on: string) => `The task “${task}” now waits on “${on}”.`,
  } satisfies AssistantPhrase<[task: string, on: string]>,
  removed: {
    sr: (task: string, on: string) => `Zadatak „${task}“ više ne čeka na „${on}“.`,
    en: (task: string, on: string) => `The task “${task}” no longer waits on “${on}”.`,
  } satisfies AssistantPhrase<[task: string, on: string]>,
  alreadyWaits: {
    sr: (task: string, on: string) => `Zadatak „${task}“ već čeka na „${on}“; ništa nije promenjeno.`,
    en: (task: string, on: string) => `The task “${task}” already waits on “${on}”; nothing changed.`,
  } satisfies AssistantPhrase<[task: string, on: string]>,
  noSuchWait: {
    sr: (task: string, on: string) => `Zadatak „${task}“ ne čeka na „${on}“; ništa nije promenjeno.`,
    en: (task: string, on: string) => `The task “${task}” does not wait on “${on}”; nothing changed.`,
  } satisfies AssistantPhrase<[task: string, on: string]>,
} as const;

/** A list's view, as the person would name it. */
const VIEW_NAME: Record<TaskListView, { readonly sr: string; readonly en: string }> = {
  list: { sr: "lista", en: "list" },
  kanban: { sr: "tabla (kanban)", en: "board (kanban)" },
  cards: { sr: "kartice", en: "cards" },
  calendar: { sr: "kalendar", en: "calendar" },
};

const VIEW_WORDS = {
  summary: {
    sr: (list: string, view: string) => `Otvaraj listu „${list}“ kao: ${view}`,
    en: (list: string, view: string) => `Open the list “${list}” as: ${view}`,
  } satisfies AssistantPhrase<[list: string, view: string]>,
  changed: {
    sr: (list: string, view: string, id: string) => `Lista „${list}“ (${id}) se sada otvara kao: ${view}.`,
    en: (list: string, view: string, id: string) => `The list “${list}” (${id}) now opens as: ${view}.`,
  } satisfies AssistantPhrase<[list: string, view: string, id: string]>,
  already: {
    sr: (list: string, view: string) => `Lista „${list}“ se već otvara kao: ${view}; ništa nije promenjeno.`,
    en: (list: string, view: string) => `The list “${list}” already opens as: ${view}; nothing changed.`,
  } satisfies AssistantPhrase<[list: string, view: string]>,
} as const;

const BULK_WORDS = {
  moveSummary: {
    sr: (count: string, list: string) => `Premesti ${count} u listu „${list}“`,
    en: (count: string, list: string) => `Move ${count} to the list “${list}”`,
  } satisfies AssistantPhrase<[count: string, list: string]>,
  prioritySummary: {
    sr: (count: string, priority: string) => `Postavi prioritet „${priority}“ za ${count}`,
    en: (count: string, priority: string) => `Set the priority “${priority}” for ${count}`,
  } satisfies AssistantPhrase<[count: string, priority: string]>,
  dueSummary: {
    sr: (count: string, day: string) => `Prebaci ${count} na ${day}`,
    en: (count: string, day: string) => `Move ${count} to ${day}`,
  } satisfies AssistantPhrase<[count: string, day: string]>,
  dueClearSummary: {
    sr: (count: string) => `Obriši rok za ${count}`,
    en: (count: string) => `Clear the due date of ${count}`,
  } satisfies AssistantPhrase<[count: string]>,
  done: {
    sr: (count: string) => `Izmenjeno: ${count}.`,
    en: (count: string) => `Changed: ${count}.`,
  } satisfies AssistantPhrase<[count: string]>,
} as const;

/** The repeat schema every write that takes one shares. A model says „every week on Monday", and this is that sentence in fields. */
const REPEAT_SCHEMA = {
  type: "object",
  description:
    "Omit for a one-off task.",
  properties: {
    every: {
      type: "string",
      enum: [...REPEAT_UNITS],
      description: "day, workday, week, month or year.",
    },
    interval: {
      type: "integer",
      minimum: 1,
      maximum: MAX_RECURRENCE_INTERVAL,
      description: "Every N units.",
    },
    weekdays: {
      type: "array",
      items: { type: "string", enum: [...WEEKDAY_NAMES] },
      minItems: 1,
      maxItems: 7,
      description: "Weekly: the days.",
    },
    until: {
      type: "string",
      pattern: DAY_PATTERN,
      description: "Last day, YYYY-MM-DD.",
    },
    count: {
      type: "integer",
      minimum: 1,
      maximum: MAX_RECURRENCE_COUNT,
      description: "Occurrences in all.",
    },
  },
  required: ["every"],
  additionalProperties: false,
} as const;

const REMINDERS_SCHEMA = {
  type: "array",
  items: { type: "integer", minimum: 0, maximum: MAX_TASK_REMINDER_DAYS },
  maxItems: MAX_TASK_REMINDERS,
  description:
    "Days before due, e.g. [3].",
} as const;

/** A single task named by its id or its exact title, as every one-task tool takes it. */
const TASK_REF = {
  type: "string",
  minLength: 1,
  maxLength: MAX_TITLE_CHARS,
  description: "The task's id, or its exact title, as tasks.list reports it.",
} as const;

export function taskTools(deps: TaskToolDeps): readonly Tool[] {
  /** One profile's stores, built the way `main/index.ts` builds them for a handler. */
  function stores(profileId: string): ProfileStores {
    return deps.profileDb(profileId, (db, id) => ({
      db,
      tasks: new TaskStore(db, id),
      lists: new TaskListStore(db, id),
      tags: new TaskTagStore(db, id),
      templates: new TaskTemplateStore(db, id),
      dependencies: new TaskDependencyStore(db, id),
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
          description: "A task list's name or id, or \"any\" for every list. Defaults to any.",
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
        const named =
          args.project === undefined
            ? undefined
            : asText(args.project, "project", MAX_TASK_LIST_NAME_LENGTH);
        // „any" is how status and due say „no filter", and a model sends it here too.
        const project = named?.trim().toLowerCase() === "any" ? undefined : named;
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
      sr: "Pravi jedan zadatak. Koristi ga kada korisnik traži da nešto zapamti ili uradi; ako je to možda već zapisano, prvo pozovi tasks.list. Rok je datum („2026-10-12“), bez vremena. Može biti podzadatak, ponavljanje ili podsetnik.",
      en: "Creates one task in this profile. Use it when the user asks to remember something or to get something done; if that may already be recorded, call tasks.list first. The due date is a plain calendar day (\"2026-10-12\"), with no time of day. It can be a subtask, repeat, or carry reminders.",
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
          pattern: DAY_PATTERN,
          description: "Due day, YYYY-MM-DD.",
        },
        start: {
          type: "string",
          pattern: DAY_PATTERN,
          description: "Start day, YYYY-MM-DD.",
        },
        status: {
          type: "string",
          enum: [...TASK_STATUSES],
          description: "todo, doing or done; default todo.",
        },
        priority: {
          type: "string",
          enum: [...TASK_PRIORITIES],
          description: "Priority; default none.",
        },
        project: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TASK_LIST_NAME_LENGTH,
          description: "List (project), by name or id; default Inbox.",
        },
        section: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TASK_LIST_NAME_LENGTH,
          description: "Section of that list, by name or id.",
        },
        parent: {
          ...TASK_REF,
          description: "Parent task, by id or title.",
        },
        description: {
          type: "string",
          maxLength: MAX_DESCRIPTION_CHARS,
          description: "Extra detail.",
        },
        repeat: REPEAT_SCHEMA,
        remindDaysBefore: REMINDERS_SCHEMA,
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
        const start = args.start === undefined ? undefined : asDay(args.start, "start");
        const status = asOptionalEnum(args.status, "status", TASK_STATUSES);
        const priority = asOptionalEnum(args.priority, "priority", TASK_PRIORITIES);
        const project =
          args.project === undefined
            ? undefined
            : asText(args.project, "project", MAX_TASK_LIST_NAME_LENGTH);
        const section =
          args.section === undefined
            ? undefined
            : asText(args.section, "section", MAX_TASK_LIST_NAME_LENGTH);
        const parentRef =
          args.parent === undefined ? undefined : asText(args.parent, "parent", MAX_TITLE_CHARS);
        const description = asOptionalText(args.description, "description", MAX_DESCRIPTION_CHARS);
        const reminders =
          args.remindDaysBefore === undefined ? undefined : asReminderDays(args.remindDaysBefore);

        const { tasks, lists } = stores(context.profileId);
        const parent =
          parentRef === undefined ? undefined : requireTask(tasks, parentRef, context.locale);
        const listId =
          project === undefined
            ? undefined
            : resolveNamed(lists.listActive(), project, context.locale, LIST_NOT_FOUND).id;
        const sectionId =
          section === undefined || listId === undefined
            ? undefined
            : resolveNamed(lists.listSections(listId), section, context.locale, SECTION_NOT_FOUND).id;
        const recurrence =
          args.repeat === undefined ? undefined : repeatRuleOf(args.repeat, due ?? null, context.locale);
        if (reminders !== undefined && reminders.length > 0 && due === undefined) {
          throw new Error(phrase(context.locale, REPEAT_REFUSAL.remindersNeedDue));
        }

        const extras: string[] = [];
        if (recurrence !== undefined) extras.push(text(context.locale, REPEATS_WORD));
        if (reminders !== undefined && reminders.length > 0) {
          extras.push(phrase(context.locale, REMINDER_PART, reminders.join(", ")));
        }
        const declined = await confirmOrDecline(
          context,
          "tasks.create",
          "write",
          [
            phrase(
              context.locale,
              CREATE_SUMMARY,
              title,
              due === undefined ? null : formatDayShort(context.locale, due),
            ),
            ...extras,
          ].join(" — "),
        );
        if (declined !== null) return declined;

        const input: CreateTaskInput = { title };
        if (due !== undefined) input.dueDate = due;
        if (start !== undefined) input.startDate = start;
        if (status !== undefined) input.status = status;
        if (priority !== undefined) input.priority = priority;
        if (description !== undefined) input.description = description;
        if (recurrence !== undefined) input.recurrence = recurrence;
        if (reminders !== undefined) input.reminderOffsets = reminders;
        if (parent !== undefined) {
          input.parentId = parent.id;
        } else {
          if (listId !== undefined) input.listId = listId;
          if (sectionId !== undefined) input.sectionId = sectionId;
        }
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
      sr: "Označava zadatak kao završen. Kod ponavljajućeg zadatka završava se samo ovo ponavljanje. Ako je zadatak već završen, kaže da ništa nije promenjeno.",
      en: "Marks a task done. A recurring task completes only this occurrence. Already done: reports that nothing changed.",
    },
    parameters: {
      type: "object",
      properties: {
        id: {
          ...TASK_REF,
          description: "The task's id, or its exact title, as tasks.list reports it.",
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
        const ref = asText(args.id, "id", MAX_TITLE_CHARS);
        const { tasks } = stores(context.profileId);
        const task = requireTask(tasks, ref, context.locale);
        if (task.done) {
          return okResult(phrase(context.locale, TASK_ALREADY_DONE, task.title), {
            citations: [taskCitation(task)],
          });
        }

        const declined = await confirmOrDecline(
          context,
          "tasks.complete",
          "write",
          phrase(context.locale, COMPLETE_SUMMARY, task.title, task.recurrence !== null),
        );
        if (declined !== null) return declined;

        // The Tasks page's own path: a recurring task advances, a one-off is set done.
        const done = tasks.completeOccurrence(task.id, instantOf(deps.now()));
        if (done.done) {
          return okResult(phrase(context.locale, DONE_WORDS.completed, done.title, done.id), {
            citations: [taskCitation(done)],
          });
        }
        return okResult(
          phrase(
            context.locale,
            DONE_WORDS.occurrenceAdvanced,
            done.title,
            done.id,
            formatDayInSentence(context.locale, done.dueDate ?? ""),
          ),
          { citations: [taskCitation(done)] },
        );
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
          ...TASK_REF,
          description: "The task's id, or its exact title, as tasks.list reports it.",
        },
        due: {
          type: ["string", "null"],
          pattern: DAY_PATTERN,
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
        const ref = asText(args.id, "id", MAX_TITLE_CHARS);
        const due = asNullableDay(args.due, "due");
        const { tasks } = stores(context.profileId);
        const task = requireTask(tasks, ref, context.locale);

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

        const updated = tasks.update(task.id, { dueDate: due });
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

  const update: Tool = {
    name: "tasks.update",
    description: {
      sr: "Menja polja zadatka (naslov, status, prioritet, rok, ponavljanje, podsetnike). Menja samo ono što navedeš; `null` briše polje.",
      en: "Changes a task's fields (title, status, priority, due, repeat, reminders). Only named fields change; `null` clears one.",
    },
    parameters: {
      type: "object",
      properties: {
        id: {
          ...TASK_REF,
          description: "The task's id, or its exact title, as tasks.list reports it.",
        },
        title: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TITLE_CHARS,
          description: "The new title.",
        },
        description: {
          type: ["string", "null"],
          maxLength: MAX_DESCRIPTION_CHARS,
          description: "New description, or null.",
        },
        status: {
          type: "string",
          enum: [...TASK_STATUSES],
          description: "todo, doing or done.",
        },
        priority: {
          type: "string",
          enum: [...TASK_PRIORITIES],
          description: "The new priority.",
        },
        due: {
          type: ["string", "null"],
          pattern: DAY_PATTERN,
          description: "New due day, or null.",
        },
        start: {
          type: ["string", "null"],
          pattern: DAY_PATTERN,
          description: "Start day, or null.",
        },
        repeat: { ...REPEAT_SCHEMA, type: ["object", "null"], description: "New repeat, or null." },
        remindDaysBefore: {
          ...REMINDERS_SCHEMA,
          type: ["array", "null"],
          description: "New reminder days, or null.",
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
        const { tasks } = stores(context.profileId);
        const task = requireTask(tasks, asText(args.id, "id", MAX_TITLE_CHARS), context.locale);
        const { fields, lines } = changedFields(args, task, context.locale);
        if (lines.length === 0) {
          return okResult(phrase(context.locale, NOTHING_CHANGED, task.title, task.id), {
            citations: [taskCitation(task)],
          });
        }

        const changes = lines.join(", ");
        const declined = await confirmOrDecline(
          context,
          "tasks.update",
          "write",
          phrase(context.locale, CHANGE_SUMMARY, task.title, changes),
        );
        if (declined !== null) return declined;

        const updated = tasks.update(task.id, fields);
        return okResult(
          phrase(context.locale, DONE_WORDS.updated, updated.title, updated.id, changes),
          { citations: [taskCitation(updated)] },
        );
      }),
  };

  const remove: Tool = {
    name: "tasks.delete",
    description: {
      sr: "Briše jedan zadatak; brisanje može da se poništi.",
      en: "Deletes one task; the deletion can be undone.",
    },
    parameters: {
      type: "object",
      properties: { id: { ...TASK_REF } },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const { tasks } = stores(context.profileId);
        const task = requireTask(tasks, asText(args.id, "id", MAX_TITLE_CHARS), context.locale);

        const declined = await confirmOrDecline(
          context,
          "tasks.delete",
          "write",
          phrase(context.locale, DELETE_SUMMARY, task.title),
        );
        if (declined !== null) return declined;

        tasks.softDelete(task.id, instantOf(deps.now()));
        return okResult(phrase(context.locale, DONE_WORDS.deleted, task.title, task.id), {
          navigateTo: { module: "tasks" },
        });
      }),
  };

  const restore: Tool = {
    name: "tasks.restore",
    description: {
      sr: "Vraća zadatak obrisan malo pre, sa id-jem koji je brisanje vratilo.",
      en: "Restores a task deleted just before, by the id the deletion reported.",
    },
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "The id of the deleted task.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const id = asText(asArgs(rawArgs).id, "id", MAX_ID_LENGTH);
        const declined = await confirmOrDecline(
          context,
          "tasks.restore",
          "write",
          phrase(context.locale, RESTORE_SUMMARY, id),
        );
        if (declined !== null) return declined;

        stores(context.profileId).tasks.restore(id, instantOf(deps.now()));
        return okResult(phrase(context.locale, DONE_WORDS.restored, id), {
          navigateTo: { module: "tasks", item: id },
        });
      }),
  };

  const overview: Tool = {
    name: "tasks.lists",
    description: {
      sr: "Izlistava liste (projekte) i odeljke, sa id-jevima. Koristi ga pre premeštanja zadatka.",
      en: "Lists task lists (projects) and their sections, with ids. Use it before moving a task.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const { lists } = stores(context.profileId);
        const active = lists.listActive();
        if (active.length === 0) return okResult(text(context.locale, NO_LISTS));
        const lines = active.flatMap((entry) => {
          const parent = active.find((candidate) => candidate.id === entry.parentId);
          const where = parent === undefined ? "" : `, ${text(context.locale, ROW.under)} ${parent.name}`;
          const inbox = entry.isInbox ? ", Inbox" : "";
          const head = `- ${entry.id} ${entry.name} [${VIEW_NAME[entry.defaultView][context.locale]}${inbox}${where}]`;
          const sections = lists
            .listSections(entry.id)
            .map((section) => `  - ${section.id} ${section.name}`);
          return [head, ...sections];
        });
        return okResult([phrase(context.locale, LISTS_HEADING, active.length), ...lines].join("\n"));
      }),
  };

  const project: Tool = {
    name: "tasks.project",
    description: {
      sr: "Pravi, preimenuje, premešta, briše ili vraća listu; dodaje, preimenuje ili briše odeljak. Brisanje šalje zadatke u Inbox.",
      en: "Creates, renames, moves, deletes or restores a list, or adds, renames or deletes a section. Delete sends tasks to the Inbox.",
    },
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...PROJECT_ACTIONS], description: "What to do." },
        project: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "The list's name or id. For restore, its id.",
        },
        name: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TASK_LIST_NAME_LENGTH,
          description: "The new name for create or rename, or the section's name for section-add.",
        },
        section: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TASK_LIST_NAME_LENGTH,
          description: "A section of the list, by name or id, for section-rename and section-delete.",
        },
        parent: {
          type: ["string", "null"],
          minLength: 1,
          maxLength: MAX_TASK_LIST_NAME_LENGTH,
          description: "The list it sits under, by name or id. Omit or null for the top level.",
        },
        mode: {
          type: "string",
          enum: [...DELETE_MODES],
          description: "For delete: move-to-inbox (the default) or delete-tasks.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const action = asEnum(args.action, "action", PROJECT_ACTIONS);
        const { tasks, lists } = stores(context.profileId);
        const locale = context.locale;

        if (action === "create") {
          const name = asText(args.name, "name", MAX_TASK_LIST_NAME_LENGTH);
          const parent = optionalList(lists, args.parent, "parent", locale);
          const declined = await confirmOrDecline(
            context,
            "tasks.project",
            "write",
            parent === undefined
              ? phrase(locale, CREATE_LIST, name)
              : `${phrase(locale, CREATE_LIST, name)} ${phrase(locale, UNDER_LIST, parent.name)}`,
          );
          if (declined !== null) return declined;
          const created = lists.createList(
            { name, parentId: parent?.id ?? null },
            instantOf(deps.now()),
          );
          return okResult(phrase(locale, PROJECT_WORDS.created, created.name, created.id), {
            navigateTo: { module: "tasks", item: created.id },
          });
        }

        if (action === "restore") {
          const id = asText(args.project, "project", MAX_ID_LENGTH);
          const declined = await confirmOrDecline(
            context,
            "tasks.project",
            "write",
            phrase(locale, PROJECT_WORDS.restoreSummary, id),
          );
          if (declined !== null) return declined;
          lists.restoreList(id, instantOf(deps.now()));
          return okResult(phrase(locale, PROJECT_WORDS.restored, id), {
            navigateTo: { module: "tasks", item: id },
          });
        }

        const target = resolveNamed(
          lists.listActive(),
          asText(args.project, "project", MAX_TASK_LIST_NAME_LENGTH),
          locale,
          LIST_NOT_FOUND,
        );

        if (action === "rename") {
          const name = asText(args.name, "name", MAX_TASK_LIST_NAME_LENGTH);
          const declined = await confirmOrDecline(
            context,
            "tasks.project",
            "write",
            phrase(locale, PROJECT_WORDS.renameSummary, target.name, name),
          );
          if (declined !== null) return declined;
          lists.renameList(target.id, name, instantOf(deps.now()));
          return okResult(phrase(locale, PROJECT_WORDS.renamed, target.name, name, target.id), {
            navigateTo: { module: "tasks", item: target.id },
          });
        }

        if (action === "move") {
          const parent = optionalList(lists, args.parent, "parent", locale);
          const declined = await confirmOrDecline(
            context,
            "tasks.project",
            "write",
            phrase(locale, PROJECT_WORDS.moveSummary, target.name, parent?.name ?? null),
          );
          if (declined !== null) return declined;
          lists.moveList(target.id, parent?.id ?? null, null, null, instantOf(deps.now()));
          return okResult(phrase(locale, PROJECT_WORDS.moved, target.name, target.id), {
            navigateTo: { module: "tasks", item: target.id },
          });
        }

        if (action === "delete") {
          const mode = asOptionalEnum(args.mode, "mode", DELETE_MODES) ?? "move-to-inbox";
          const count = tasks.listActive().filter((task) => task.listId === target.id).length;
          const summary =
            mode === "move-to-inbox"
              ? phrase(locale, PROJECT_WORDS.deleteMoveSummary, target.name)
              : phrase(
                  locale,
                  PROJECT_WORDS.deleteTasksSummary,
                  target.name,
                  phrase(locale, TASK_COUNT, count),
                );
          const declined = await confirmOrDecline(context, "tasks.project", "write", summary);
          if (declined !== null) return declined;
          lists.deleteList(target.id, mode, instantOf(deps.now()));
          return okResult(phrase(locale, PROJECT_WORDS.deleted, target.name, target.id), {
            navigateTo: { module: "tasks" },
          });
        }

        // The three section actions all work inside the list named above.
        if (action === "section-add") {
          const name = asText(args.name, "name", MAX_TASK_LIST_NAME_LENGTH);
          const declined = await confirmOrDecline(
            context,
            "tasks.project",
            "write",
            phrase(locale, PROJECT_WORDS.sectionAddSummary, name, target.name),
          );
          if (declined !== null) return declined;
          const section = lists.createSection(target.id, name, instantOf(deps.now()));
          return okResult(
            phrase(locale, PROJECT_WORDS.sectionAdded, section.name, target.name, section.id),
            { navigateTo: { module: "tasks", item: target.id } },
          );
        }

        const section = resolveNamed(
          lists.listSections(target.id),
          asText(args.section, "section", MAX_TASK_LIST_NAME_LENGTH),
          locale,
          SECTION_NOT_FOUND,
        );
        if (action === "section-rename") {
          const name = asText(args.name, "name", MAX_TASK_LIST_NAME_LENGTH);
          const declined = await confirmOrDecline(
            context,
            "tasks.project",
            "write",
            phrase(locale, PROJECT_WORDS.sectionRenameSummary, section.name, name),
          );
          if (declined !== null) return declined;
          lists.renameSection(section.id, name, instantOf(deps.now()));
          return okResult(
            phrase(locale, PROJECT_WORDS.sectionRenamed, section.name, name, section.id),
            { navigateTo: { module: "tasks", item: target.id } },
          );
        }

        const declined = await confirmOrDecline(
          context,
          "tasks.project",
          "write",
          phrase(locale, PROJECT_WORDS.sectionDeleteSummary, section.name),
        );
        if (declined !== null) return declined;
        lists.deleteSection(section.id, instantOf(deps.now()));
        return okResult(phrase(locale, PROJECT_WORDS.sectionDeleted, section.name, section.id), {
          navigateTo: { module: "tasks", item: target.id },
        });
      }),
  };

  const tagList: Tool = {
    name: "tasks.tags",
    description: {
      sr: "Izlistava oznake (tagove) sa id-jevima.",
      en: "Lists the tags with their ids.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const tags = stores(context.profileId).tags.listTags();
        if (tags.length === 0) return okResult(text(context.locale, NO_TAGS));
        const lines = tags.map((tag) => `- ${tag.id} ${tag.name}`);
        return okResult([phrase(context.locale, TAGS_HEADING, tags.length), ...lines].join("\n"));
      }),
  };

  const tag: Tool = {
    name: "tasks.tag",
    description: {
      sr: "Označava zadatak oznakom, skida oznaku, pravi, preimenuje ili briše oznaku.",
      en: "Tags a task, untags it, or creates, renames or deletes a tag.",
    },
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...TAG_ACTIONS], description: "What to do." },
        task: {
          ...TASK_REF,
          description: "The task, by id or exact title, for attach and detach.",
        },
        tag: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TASK_TAG_NAME_LENGTH,
          description: "The tag's name or id; for create, the new tag's name.",
        },
        name: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TASK_TAG_NAME_LENGTH,
          description: "The new name, for rename.",
        },
      },
      required: ["action", "tag"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const action = asEnum(args.action, "action", TAG_ACTIONS);
        const label = asText(args.tag, "tag", MAX_TASK_TAG_NAME_LENGTH);
        const { tasks, tags } = stores(context.profileId);
        const locale = context.locale;

        if (action === "create") {
          const declined = await confirmOrDecline(
            context,
            "tasks.tag",
            "write",
            phrase(locale, TAG_WORDS.createSummary, label),
          );
          if (declined !== null) return declined;
          const created = tags.createTag(label, instantOf(deps.now()));
          return okResult(phrase(locale, TAG_WORDS.created, created.name, created.id));
        }

        if (action === "attach") {
          const task = requireTask(tasks, asText(args.task, "task", MAX_TITLE_CHARS), locale);
          const existing = tags
            .listTags()
            .find((entry) => entry.id === label || foldName(entry.name) === foldName(label));
          const named = existing?.name ?? label;
          const attached = existing !== undefined && tags.listTagLinks().some(
            (link) => link.taskId === task.id && link.tagId === existing.id,
          );
          if (attached) {
            return okResult(phrase(locale, TAG_WORDS.alreadyAttached, task.title, named), {
              citations: [taskCitation(task)],
            });
          }
          const declined = await confirmOrDecline(
            context,
            "tasks.tag",
            "write",
            phrase(locale, TAG_WORDS.attachSummary, task.title, named),
          );
          if (declined !== null) return declined;
          const target = existing ?? tags.createTag(label, instantOf(deps.now()));
          tags.attachTag(task.id, target.id);
          return okResult(phrase(locale, TAG_WORDS.attached, task.title, target.name, task.id), {
            citations: [taskCitation(task)],
            navigateTo: { module: "tasks", item: task.id },
          });
        }

        const existing = resolveNamed(tags.listTags(), label, locale, TAG_NOT_FOUND);
        if (action === "detach") {
          const task = requireTask(tasks, asText(args.task, "task", MAX_TITLE_CHARS), locale);
          const declined = await confirmOrDecline(
            context,
            "tasks.tag",
            "write",
            phrase(locale, TAG_WORDS.detachSummary, task.title, existing.name),
          );
          if (declined !== null) return declined;
          tags.detachTag(task.id, existing.id);
          return okResult(phrase(locale, TAG_WORDS.detached, task.title, existing.name, task.id), {
            citations: [taskCitation(task)],
          });
        }

        if (action === "rename") {
          const name = asText(args.name, "name", MAX_TASK_TAG_NAME_LENGTH);
          const declined = await confirmOrDecline(
            context,
            "tasks.tag",
            "write",
            phrase(locale, TAG_WORDS.renameSummary, existing.name, name),
          );
          if (declined !== null) return declined;
          tags.renameTag(existing.id, name);
          return okResult(phrase(locale, TAG_WORDS.renamed, existing.name, name, existing.id));
        }

        const declined = await confirmOrDecline(
          context,
          "tasks.tag",
          "write",
          phrase(locale, TAG_WORDS.deleteSummary, existing.name),
        );
        if (declined !== null) return declined;
        tags.deleteTag(existing.id);
        return okResult(phrase(locale, TAG_WORDS.deleted, existing.name));
      }),
  };

  const templateList: Tool = {
    name: "tasks.templates",
    description: {
      sr: "Izlistava šablone zadataka sa brojem podzadataka.",
      en: "Lists task templates with their subtask counts.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const templates = stores(context.profileId).templates.list();
        if (templates.length === 0) return okResult(text(context.locale, NO_TEMPLATES));
        const lines = templates.map(
          (template) =>
            `- ${template.id} ${template.name} [${phrase(context.locale, TEMPLATE_WORDS.subtasks, template.payload.subtaskTitles.length)}]`,
        );
        return okResult(
          [phrase(context.locale, TEMPLATES_HEADING, templates.length), ...lines].join("\n"),
        );
      }),
  };

  const template: Tool = {
    name: "tasks.template",
    description: {
      sr: "Čuva zadatak kao šablon, pravi zadatak iz šablona ili briše šablon.",
      en: "Saves a task as a template, makes a task from one, or deletes a template.",
    },
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...TEMPLATE_ACTIONS], description: "What to do." },
        template: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TASK_TEMPLATE_NAME_LENGTH,
          description: "The template's name or id; for save, the name to keep it under.",
        },
        task: {
          ...TASK_REF,
          description: "For save: the task to keep, by id or exact title.",
        },
        project: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TASK_LIST_NAME_LENGTH,
          description: "For apply: the list the new task lands in. Defaults to the Inbox.",
        },
        section: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TASK_LIST_NAME_LENGTH,
          description: "For apply: a section of that list, by name or id.",
        },
      },
      required: ["action", "template"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const action = asEnum(args.action, "action", TEMPLATE_ACTIONS);
        const name = asText(args.template, "template", MAX_TASK_TEMPLATE_NAME_LENGTH);
        const s = stores(context.profileId);
        const locale = context.locale;

        if (action === "save") {
          const task = requireTask(s.tasks, asText(args.task, "task", MAX_TITLE_CHARS), locale);
          const declined = await confirmOrDecline(
            context,
            "tasks.template",
            "write",
            phrase(locale, TEMPLATE_WORDS.saveSummary, task.title, name),
          );
          if (declined !== null) return declined;
          const saved = s.db.transaction(() =>
            s.templates.saveByName(
              name,
              templatePayload(s, task, localDay(deps.now())),
              instantOf(deps.now()),
            ),
          )();
          return okResult(phrase(locale, TEMPLATE_WORDS.saved, saved.name, saved.id), {
            citations: [taskCitation(task)],
          });
        }

        const chosen = resolveNamed(s.templates.list(), name, locale, TEMPLATE_NOT_FOUND);
        if (action === "delete") {
          const declined = await confirmOrDecline(
            context,
            "tasks.template",
            "write",
            phrase(locale, TEMPLATE_WORDS.deleteSummary, chosen.name),
          );
          if (declined !== null) return declined;
          s.templates.delete(chosen.id);
          return okResult(phrase(locale, TEMPLATE_WORDS.deleted, chosen.name));
        }

        const target =
          optionalList(s.lists, args.project, "project", locale) ??
          defaultList(s.lists, instantOf(deps.now()));
        const section =
          args.section === undefined
            ? undefined
            : resolveNamed(
                s.lists.listSections(target.id),
                asText(args.section, "section", MAX_TASK_LIST_NAME_LENGTH),
                locale,
                SECTION_NOT_FOUND,
              );
        const declined = await confirmOrDecline(
          context,
          "tasks.template",
          "write",
          phrase(locale, TEMPLATE_WORDS.applySummary, chosen.name, target.name),
        );
        if (declined !== null) return declined;
        const made = applyTaskTemplate(
          s.db,
          s,
          chosen,
          { listId: target.id, sectionId: section?.id ?? null },
          localDay(deps.now()),
          instantOf(deps.now()),
        );
        return okResult(
          phrase(locale, DONE_WORDS.createdFromTemplate, made.title, made.id, chosen.name),
          { citations: [taskCitation(made)], navigateTo: { module: "tasks", item: made.id } },
        );
      }),
  };

  const dependencyList: Tool = {
    name: "tasks.dependencies",
    description: {
      sr: "Izlistava zadatke koji čekaju na druge zadatke.",
      en: "Lists the tasks that wait on other tasks.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const s = stores(context.profileId);
        const links = s.dependencies.listLinks();
        if (links.length === 0) return okResult(text(context.locale, NO_DEPENDENCIES));
        const byId = new Map(s.tasks.listActive().map((task) => [task.id, task]));
        const lines = links.flatMap((link) => {
          const blocked = byId.get(link.blockedId);
          const blocker = byId.get(link.blockerId);
          if (blocked === undefined || blocker === undefined) return [];
          return [
            `- ${blocked.id} ${blocked.title} [${text(context.locale, ROW.waitsOn)} ${blocker.id} ${blocker.title}]`,
          ];
        });
        return okResult(
          [phrase(context.locale, DEPENDENCIES_HEADING, lines.length), ...lines].join("\n"),
        );
      }),
  };

  const depend: Tool = {
    name: "tasks.depend",
    description: {
      sr: "Dodaje ili uklanja zavisnost: zadatak čeka na drugi. Krug se odbija.",
      en: "Adds or removes a dependency: a task waits on another. Loops are refused.",
    },
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...DEPEND_ACTIONS], description: "add or remove." },
        task: { ...TASK_REF, description: "The task that waits, by id or exact title." },
        on: { ...TASK_REF, description: "The task it waits on, by id or exact title." },
      },
      required: ["action", "task", "on"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const action = asEnum(args.action, "action", DEPEND_ACTIONS);
        const s = stores(context.profileId);
        const waiting = requireTask(s.tasks, asText(args.task, "task", MAX_TITLE_CHARS), context.locale);
        const on = requireTask(s.tasks, asText(args.on, "on", MAX_TITLE_CHARS), context.locale);
        const existing = s.dependencies
          .listLinks()
          .some((link) => link.blockedId === waiting.id && link.blockerId === on.id);
        const locale = context.locale;

        if (action === "add") {
          if (existing) {
            return okResult(phrase(locale, DEPENDENCY_WORDS.alreadyWaits, waiting.title, on.title));
          }
          const declined = await confirmOrDecline(
            context,
            "tasks.depend",
            "write",
            phrase(locale, DEPENDENCY_WORDS.addSummary, waiting.title, on.title),
          );
          if (declined !== null) return declined;
          s.dependencies.addDependency(on.id, waiting.id);
          return okResult(phrase(locale, DEPENDENCY_WORDS.added, waiting.title, on.title), {
            citations: [taskCitation(waiting)],
          });
        }

        if (!existing) {
          return okResult(phrase(locale, DEPENDENCY_WORDS.noSuchWait, waiting.title, on.title));
        }
        const declined = await confirmOrDecline(
          context,
          "tasks.depend",
          "write",
          phrase(locale, DEPENDENCY_WORDS.removeSummary, waiting.title, on.title),
        );
        if (declined !== null) return declined;
        s.dependencies.removeDependency(on.id, waiting.id);
        return okResult(phrase(locale, DEPENDENCY_WORDS.removed, waiting.title, on.title), {
          citations: [taskCitation(waiting)],
        });
      }),
  };

  const view: Tool = {
    name: "tasks.view",
    description: {
      sr: "Menja prikaz liste: lista, tabla, kartice ili kalendar.",
      en: "Changes the view a list opens in: list, board, cards or calendar.",
    },
    parameters: {
      type: "object",
      properties: {
        project: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TASK_LIST_NAME_LENGTH,
          description: "The list's name or id.",
        },
        view: { type: "string", enum: [...TASK_LIST_VIEWS], description: "The view to open in." },
      },
      required: ["project", "view"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const chosen = asEnum(args.view, "view", TASK_LIST_VIEWS);
        const { lists } = stores(context.profileId);
        const target = resolveNamed(
          lists.listActive(),
          asText(args.project, "project", MAX_TASK_LIST_NAME_LENGTH),
          context.locale,
          LIST_NOT_FOUND,
        );
        const viewName = VIEW_NAME[chosen][context.locale];
        if (target.defaultView === chosen) {
          return okResult(phrase(context.locale, VIEW_WORDS.already, target.name, viewName));
        }
        const declined = await confirmOrDecline(
          context,
          "tasks.view",
          "write",
          phrase(context.locale, VIEW_WORDS.summary, target.name, viewName),
        );
        if (declined !== null) return declined;
        lists.setDefaultView(target.id, chosen, instantOf(deps.now()));
        return okResult(phrase(context.locale, VIEW_WORDS.changed, target.name, viewName, target.id), {
          navigateTo: { module: "tasks", item: target.id },
        });
      }),
  };

  const bulk: Tool = {
    name: "tasks.bulk",
    description: {
      sr: "Premešta, menja prioritet ili rok većem broju zadataka. Ili se menjaju svi, ili nijedan.",
      en: "Moves, re-prioritises or re-dates several tasks at once; all change or none does.",
    },
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...BULK_ACTIONS], description: "move, priority or due." },
        ids: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: MAX_ID_LENGTH },
          minItems: 1,
          maxItems: MAX_TASK_BULK_IDS,
          description: "The task ids, exactly as tasks.list reports them.",
        },
        project: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TASK_LIST_NAME_LENGTH,
          description: "For move: the list, by name or id.",
        },
        section: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TASK_LIST_NAME_LENGTH,
          description: "For move: a section of that list, by name or id.",
        },
        priority: {
          type: "string",
          enum: [...TASK_PRIORITIES],
          description: "For priority: the new priority.",
        },
        due: {
          type: ["string", "null"],
          pattern: DAY_PATTERN,
          description: "For due: the new day as YYYY-MM-DD, or null to clear it.",
        },
      },
      required: ["action", "ids"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const action = asEnum(args.action, "action", BULK_ACTIONS);
        const ids = [...new Set(asTextList(args.ids, "ids", MAX_TASK_BULK_IDS, MAX_ID_LENGTH))];
        if (ids.length === 0) throw new Error('"ids" must name at least one task.');
        const s = stores(context.profileId);
        const locale = context.locale;

        // Every id is checked before anything is written, so a stale id refuses the whole batch.
        const active = new Set(s.tasks.listActive().map((task) => task.id));
        for (const id of ids) {
          if (!active.has(id)) throw new Error(phrase(locale, BULK_NOT_FOUND, id));
        }
        const count = phrase(locale, TASK_COUNT, ids.length);

        if (action === "move") {
          const target = resolveNamed(
            s.lists.listActive(),
            asText(args.project, "project", MAX_TASK_LIST_NAME_LENGTH),
            locale,
            LIST_NOT_FOUND,
          );
          const section =
            args.section === undefined
              ? undefined
              : resolveNamed(
                  s.lists.listSections(target.id),
                  asText(args.section, "section", MAX_TASK_LIST_NAME_LENGTH),
                  locale,
                  SECTION_NOT_FOUND,
                );
          const declined = await confirmOrDecline(
            context,
            "tasks.bulk",
            "write",
            phrase(locale, BULK_WORDS.moveSummary, count, target.name),
          );
          if (declined !== null) return declined;
          s.tasks.bulkMoveToList(ids, target.id, section?.id ?? null, instantOf(deps.now()));
        } else if (action === "priority") {
          const priority = asEnum(args.priority, "priority", TASK_PRIORITIES);
          const declined = await confirmOrDecline(
            context,
            "tasks.bulk",
            "write",
            phrase(locale, BULK_WORDS.prioritySummary, count, priority),
          );
          if (declined !== null) return declined;
          s.tasks.bulkSetPriority(ids, priority);
        } else {
          if (args.due === undefined) throw new Error('"due" is required for a due change.');
          const day = asNullableDay(args.due, "due");
          const declined = await confirmOrDecline(
            context,
            "tasks.bulk",
            "write",
            day === null
              ? phrase(locale, BULK_WORDS.dueClearSummary, count)
              : phrase(locale, BULK_WORDS.dueSummary, count, formatDayShort(locale, day)),
          );
          if (declined !== null) return declined;
          s.tasks.bulkSetDueDate(ids, day);
        }
        return okResult(phrase(locale, BULK_WORDS.done, count));
      }),
  };

  return [
    list,
    create,
    complete,
    reschedule,
    update,
    remove,
    restore,
    overview,
    project,
    tagList,
    tag,
    templateList,
    template,
    dependencyList,
    depend,
    view,
    bulk,
  ];
}

/** The instant a store writes, from main's clock. */
function instantOf(atMs: number): string {
  return new Date(atMs).toISOString();
}

/**
 * The task a write names, by its id or its exact title, or a refusal the model can act on.
 *
 * Read from `listActive` rather than from a store getter, because this is also
 * where an id belonging to another profile, to a soft-deleted task or to nothing
 * at all becomes one single answer — and because the title in the confirmation
 * sentence is a fact this tool needs before it asks.
 */
function requireTask(tasks: TaskStore, ref: string, locale: AssistantLocale): Task {
  return resolveTask(tasks.listActive(), ref, locale);
}

/**
 * A task named by its id, or else by its title (case- and diacritics-blind).
 *
 * An id is exact and wins outright. A title that two tasks share is refused with
 * both ids, so the model can name the one it means instead of the first it found.
 */
function resolveTask(tasks: readonly Task[], ref: string, locale: AssistantLocale): Task {
  const byId = tasks.find((task) => task.id === ref);
  if (byId !== undefined) return byId;
  const folded = foldName(ref);
  const matches = tasks.filter((task) => foldName(task.title) === folded);
  const [only, ...rest] = matches;
  if (only === undefined) throw new Error(phrase(locale, TASK_NOT_FOUND, ref));
  if (rest.length > 0) {
    throw new Error(
      phrase(locale, AMBIGUOUS, ref, matches.map((task) => `${task.id} (${task.title})`).join(", ")),
    );
  }
  return only;
}

/**
 * The entry a name or id names, from the rows of one kind — a list, a tag, a template, a section.
 *
 * Exact on the id and case- and diacritics-blind on the name, with the profile's
 * own names in the refusal: a model that typed „fakultet" for „Fakultet" must be
 * told what the list is really called rather than left to guess again.
 */
function resolveNamed<T extends { readonly id: string; readonly name: string }>(
  entries: readonly T[],
  ref: string,
  locale: AssistantLocale,
  missing: AssistantPhrase<[ref: string, known: string]>,
): T {
  const byId = entries.find((entry) => entry.id === ref);
  if (byId !== undefined) return byId;
  const folded = foldName(ref);
  const matches = entries.filter((entry) => foldName(entry.name) === folded);
  const [only, ...rest] = matches;
  if (only === undefined) {
    const known = entries.length === 0 ? text(locale, ROW.none) : entries.map((entry) => entry.name).join(", ");
    throw new Error(phrase(locale, missing, ref, known));
  }
  if (rest.length > 0) {
    throw new Error(
      phrase(locale, AMBIGUOUS, ref, matches.map((entry) => `${entry.id} (${entry.name})`).join(", ")),
    );
  }
  return only;
}

/** A project name or id into the list it names; the Inbox is the default and is always there to be named. */
function resolveList(lists: readonly TaskList[], project: string, locale: AssistantLocale): TaskList {
  return resolveNamed(lists, project, locale, LIST_NOT_FOUND);
}

/** An optional list argument: absent or null is no list, and a name is resolved like any other. */
function optionalList(
  lists: TaskListStore,
  value: unknown,
  field: string,
  locale: AssistantLocale,
): TaskList | undefined {
  if (value === undefined || value === null) return undefined;
  const ref = asText(value, field, MAX_TASK_LIST_NAME_LENGTH);
  return resolveNamed(lists.listActive(), ref, locale, LIST_NOT_FOUND);
}

/** The Inbox, which every profile has: the list a template lands in when none is named. */
function defaultList(lists: TaskListStore, now: string): TaskList {
  return lists.ensureInbox(now);
}

/**
 * Lower-case, diacritics-free, trimmed: the one comparison every name lookup in
 * this file makes, so „Fakultet", „fakultet" and „Fakultèt" are one list.
 */
function foldName(value: string): string {
  return value
    .toLocaleLowerCase(["sr-Latn", "sr"])
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .trim();
}

/** The reminder days as the model wrote them: a list of whole days, each inside the store's own bound. */
function asReminderDays(value: unknown): number[] {
  if (value === null) return [];
  if (!Array.isArray(value)) throw new Error('"remindDaysBefore" must be a list of whole days.');
  return value.map((entry) => asCount(entry, "remindDaysBefore", 0, MAX_TASK_REMINDER_DAYS));
}

/** The weekday names a weekly repeat names, as the store's Monday-first indices. */
function asWeekdays(value: unknown): RecurrenceWeekday[] {
  if (!Array.isArray(value)) throw new Error('"weekdays" must be a list of day names.');
  return value.map(
    (entry) => WEEKDAY_NAMES.indexOf(asEnum(entry, "weekdays", WEEKDAY_NAMES)) as RecurrenceWeekday,
  );
}

/**
 * A model's flat repeat description, as the store's own rule — or a refusal.
 *
 * The rule phases from the due date, so a repeat without one is refused here with
 * the reason. Anything the store's validator will not hold is refused too, and a
 * model is never handed a rule it cannot read back.
 */
function repeatRuleOf(value: unknown, due: string | null, locale: AssistantLocale): RecurrenceRule {
  const args = asArgs(value);
  const every = asEnum(args.every, "every", REPEAT_UNITS);
  const interval = asOptionalCount(args.interval, "interval", 1, MAX_RECURRENCE_INTERVAL) ?? 1;
  const weekdays = args.weekdays === undefined ? undefined : asWeekdays(args.weekdays);
  const until = args.until === undefined ? undefined : asDay(args.until, "until");
  const count = asOptionalCount(args.count, "count", 1, MAX_RECURRENCE_COUNT);

  if (due === null) throw new Error(phrase(locale, REPEAT_REFUSAL.needsDue));
  if (weekdays !== undefined && every !== "week") {
    throw new Error(phrase(locale, REPEAT_REFUSAL.weekdays));
  }
  if (until !== undefined && count !== undefined) {
    throw new Error(phrase(locale, REPEAT_REFUSAL.endTwice));
  }

  const freq = frequencyOf(every, interval, weekdays, new Date(`${due}T00:00:00Z`));
  const end: RecurrenceEnd =
    until !== undefined
      ? { kind: "until", date: until }
      : count !== undefined
        ? { kind: "count", total: count }
        : { kind: "never" };

  const rule = validateRecurrenceRule({ freq, end });
  if (rule === null) throw new Error(phrase(locale, REPEAT_REFUSAL.invalid));
  return rule;
}

/**
 * The store's frequency for a unit the model named. A weekly repeat with no days
 * falls on the due date's own weekday, and a monthly one on its day of month.
 */
function frequencyOf(
  every: (typeof REPEAT_UNITS)[number],
  interval: number,
  weekdays: readonly RecurrenceWeekday[] | undefined,
  anchor: Date,
): RecurrenceFreq {
  switch (every) {
    case "day":
      return { kind: "daily", interval };
    case "workday":
      return { kind: "weekdays" };
    case "week":
      return {
        kind: "weekly",
        interval,
        days: [...(weekdays ?? [((anchor.getUTCDay() + 6) % 7) as RecurrenceWeekday])],
      };
    case "month":
      return { kind: "monthly-date", interval, day: anchor.getUTCDate() };
    case "year":
      return { kind: "yearly", interval };
  }
}

/**
 * The fields an update changes, and the words that name each change.
 *
 * Only a field whose value really differs from the task's counts: an update that
 * repeats what the task already says is an empty change, and a confirmation that
 * asks the user to approve nothing is a bad confirmation.
 */
function changedFields(
  args: Record<string, unknown>,
  task: Task,
  locale: AssistantLocale,
): { fields: UpdateTaskFields; lines: string[] } {
  const fields: UpdateTaskFields = {};
  const lines: string[] = [];
  // One change as a clause a person reads: „status → doing".
  const note = (key: keyof UpdateTaskFields, shown: string): void => {
    lines.push(`${text(locale, FIELD_NAME[key])} → ${shown}`);
  };

  if (args.title !== undefined) {
    const title = asText(args.title, "title", MAX_TITLE_CHARS);
    if (title !== task.title) {
      fields.title = title;
      note("title", `“${title}”`);
    }
  }
  if (args.description !== undefined) {
    const description =
      args.description === null ? null : asText(args.description, "description", MAX_DESCRIPTION_CHARS);
    if (description !== task.description) {
      fields.description = description;
      note("description", description === null ? text(locale, ROW.none) : `“${description}”`);
    }
  }
  const status = asOptionalEnum(args.status, "status", TASK_STATUSES);
  if (status !== undefined && status !== task.status) {
    fields.status = status;
    note("status", status);
  }
  const priority = asOptionalEnum(args.priority, "priority", TASK_PRIORITIES);
  if (priority !== undefined && priority !== task.priority) {
    fields.priority = priority;
    note("priority", priority);
  }
  if (args.due !== undefined) {
    const due = asNullableDay(args.due, "due");
    if (due !== task.dueDate) {
      fields.dueDate = due;
      note("dueDate", due === null ? text(locale, ROW.none) : formatDayShort(locale, due));
    }
  }
  if (args.start !== undefined) {
    const start = asNullableDay(args.start, "start");
    if (start !== task.startDate) {
      fields.startDate = start;
      note("startDate", start === null ? text(locale, ROW.none) : formatDayShort(locale, start));
    }
  }
  if (args.repeat !== undefined) {
    const due = fields.dueDate !== undefined ? fields.dueDate : task.dueDate;
    const recurrence = args.repeat === null ? null : repeatRuleOf(args.repeat, due, locale);
    if (JSON.stringify(recurrence) !== JSON.stringify(task.recurrence)) {
      fields.recurrence = recurrence;
      note("recurrence", recurrence === null ? text(locale, ROW.none) : text(locale, ROW.yes));
    }
  }
  if (args.remindDaysBefore !== undefined) {
    const days = args.remindDaysBefore === null ? [] : asReminderDays(args.remindDaysBefore);
    if (JSON.stringify(days) !== JSON.stringify(task.reminderOffsets)) {
      fields.reminderOffsets = days;
      note("reminderOffsets", days.length === 0 ? text(locale, ROW.none) : days.join(", "));
    }
  }
  return { fields, lines };
}

/**
 * A task's current occurrence template: what a template keeps, as the store holds it.
 *
 * The due date is kept as a count of days from today, so applying the template
 * next month lands on the same habit, not the same calendar day.
 */
function templatePayload(s: ProfileStores, task: Task, today: string): TaskTemplatePayload {
  const linked = new Set(
    s.tags.listTagLinks().filter((link) => link.taskId === task.id).map((link) => link.tagId),
  );
  const active = s.tasks.listActive();
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueOffsetDays: templateDueOffset(task.dueDate, today),
    reminderOffsets: task.reminderOffsets,
    recurrence: task.recurrence,
    tagNames: s.tags
      .listTags()
      .filter((tag) => linked.has(tag.id))
      .map((tag) => tag.name),
    subtaskTitles: active.filter((row) => row.parentId === task.id).map((row) => row.title),
  };
}

/** A task's due date as a template's offset in days from today, or null; a date already past is today, never a negative offset. */
function templateDueOffset(dueDate: string | null, today: string): number | null {
  if (dueDate === null || !isValidDayKey(dueDate)) return null;
  const days = Math.round((dayKeyToUtcMs(dueDate) - dayKeyToUtcMs(today)) / MS_PER_DAY);
  return Math.min(Math.max(days, 0), MAX_TASK_TEMPLATE_DUE_OFFSET_DAYS);
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
  const moved = new Date(at + days * MS_PER_DAY);
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

/** The app's Serbian Latin ordering, never SQLite's BINARY one — plain `"sr"` mis-tailors š/č/ć/ž. */
const COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

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
