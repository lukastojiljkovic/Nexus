/**
 * Demo seed for the TASK module.
 *
 * Five lists carry a believable slice of a final-year CS student's life —
 * coursework, a part-time dev job, the apartment, personal errands and a
 * couple of side projects — so every TASK view (list, kanban, subtasks, tags,
 * dependencies, recurrence) has real rows to draw rather than an empty state.
 * Everything is written through the same public stores the renderer's IPC
 * handlers use (`context.ts`'s file doc explains why that matters).
 *
 * Each task also carries a real HISTORY: `TaskStore.create` and
 * `TaskStore.setDone` both take the caller's instant, so a seeded task was
 * created somewhere in the last five months and — if it is finished — checked
 * off somewhere in the last three weeks, rather than every row being stamped
 * with the moment the seeder ran. That is what the TASK module's „Priliv i
 * odliv" chart draws: created against completed, per week. With one stamp
 * shared by sixty tasks it has a single bar to draw and says nothing.
 */

import { nextOccurrenceDate, type RecurrenceRule } from "@nexus/core";
import {
  TaskDependencyStore,
  TaskListStore,
  TaskStore,
  TaskTagStore,
  type CreateTaskInput,
  type TaskPriority,
} from "@nexus/db";
import {
  demoAt,
  demoDay,
  demoRandom,
  type DatabaseHandle,
  type DemoContext,
  type DemoRandom,
} from "./context.js";

// --- Content shape -----------------------------------------------------

/** The coarse "when" a hand-authored task is due — resolved to a real date by `dueDateForBucket`. */
type DueBucket = "overdue" | "today" | "week" | "later" | "none";

interface SubtaskSeed {
  readonly title: string;
  readonly done?: true;
}

interface TaskSeed {
  readonly title: string;
  readonly description?: string;
  readonly priority: TaskPriority;
  /** Ignored when `recurrence` is set — a recurring task's due date is the rule's own next real occurrence instead (`recurringDueDate`). */
  readonly due: DueBucket;
  readonly status?: "doing" | "done";
  readonly tags?: readonly string[];
  readonly recurrence?: RecurrenceRule;
  readonly subtasks?: readonly SubtaskSeed[];
}

interface SectionSeed {
  readonly name: string;
  readonly tasks: readonly TaskSeed[];
}

interface ListSeed {
  readonly name: string;
  readonly tasks: readonly TaskSeed[];
  readonly sections?: readonly SectionSeed[];
}

interface DependencySeed {
  readonly blocker: string;
  readonly blocked: string;
}

// --- Tags ----------------------------------------------------------------

const TAGS = [
  "Hitno",
  "Čeka odgovor",
  "Brzo",
  "Fokus",
  "Kupovina",
  "Poziv",
  "Dokumentacija",
  "Ideja",
  "Ponoviti",
  "Važno",
] as const;

// --- Recurrence rules ------------------------------------------------------
//
// Four series (ADR-024's cap on this seed is "2-4"), each shaped like a habit
// a person would actually keep: a weekly timesheet, a monthly bill, a
// biweekly clean, and a monthly report that ends itself after half a year.

const WEEKLY_TIMESHEET: RecurrenceRule = {
  freq: { kind: "weekly", interval: 1, days: [4] }, // Friday
  end: { kind: "never" },
};
const MONTHLY_BILL: RecurrenceRule = {
  freq: { kind: "monthly-date", interval: 1, day: 5 },
  end: { kind: "never" },
};
const BIWEEKLY_CLEAN: RecurrenceRule = {
  freq: { kind: "weekly", interval: 2, days: [5] }, // Saturday
  end: { kind: "never" },
};
const MONTHLY_EXPENSE_REPORT: RecurrenceRule = {
  freq: { kind: "monthly-date", interval: 1, day: 28 },
  end: { kind: "count", total: 6 },
};

// --- Lists -------------------------------------------------------------

const LISTS: readonly ListSeed[] = [
  {
    name: "Fakultet",
    tasks: [
      {
        title: "Prijava teme za diplomski rad",
        description: "Skupiti tri predloga tema i dogovoriti termin sa mentorom.",
        priority: "high",
        due: "later",
        tags: ["Važno", "Dokumentacija"],
      },
      {
        title: "Sastanak sa mentorom",
        priority: "medium",
        due: "today",
        status: "done",
        tags: ["Poziv"],
      },
      {
        title: "Upis prvog semestra master studija",
        priority: "medium",
        due: "later",
      },
    ],
    sections: [
      {
        name: "Predavanja i vežbe",
        tasks: [
          {
            title: "Domaći zadatak iz Mašinskog učenja",
            description: "Implementirati unazadnu propagaciju bez frameworka.",
            priority: "high",
            due: "week",
            status: "doing",
            tags: ["Fokus"],
            subtasks: [
              { title: "Pročitati poglavlje o gradijentnom spustu", done: true },
              { title: "Napisati testove za slojeve", done: true },
              { title: "Provera na validacionom skupu" },
            ],
          },
          {
            title: "Projekat iz Prevodilaca",
            description: "Sintaksna analiza za mini jezik — LL(1) parser.",
            priority: "high",
            due: "later",
            status: "doing",
            tags: ["Fokus"],
            subtasks: [
              { title: "Napisati gramatiku", done: true },
              { title: "Implementirati lekser", done: true },
              { title: "Implementirati parser" },
              { title: "Testirati na primerima" },
            ],
          },
          {
            title: "Vežbe iz Baze podataka — normalizacija",
            priority: "medium",
            due: "week",
            status: "done",
          },
          {
            title: "Seminarski rad iz Softverskog inženjerstva",
            description: "Tema: mikroservisna arhitektura i observability.",
            priority: "medium",
            due: "later",
            tags: ["Dokumentacija"],
          },
        ],
      },
      {
        name: "Ispiti",
        tasks: [
          { title: "Ispit iz Kompajlera", priority: "high", due: "later", tags: ["Važno"] },
          {
            title: "Ispit iz Veštačke inteligencije",
            priority: "high",
            due: "later",
            tags: ["Važno"],
          },
          {
            title: "Popravni iz Operacionih sistema",
            description: "Ponovo prijavljen ispit posle pada u junskom roku.",
            priority: "medium",
            due: "overdue",
          },
        ],
      },
    ],
  },
  {
    name: "Posao",
    tasks: [
      {
        title: "Ažurirati CV i portfolio",
        description: "Dodati poslednji projekat i osvežiti sekciju veština.",
        priority: "high",
        due: "week",
        tags: ["Fokus", "Važno"],
      },
      {
        title: "Poslati prijave za pripravnički program",
        description: "Fokus na kompanije koje traže Java/Kotlin ili Python profil.",
        priority: "high",
        due: "later",
        tags: ["Čeka odgovor"],
      },
      {
        title: "Priprema za tehnički intervju",
        description: "LeetCode srednji nivo + sistemski dizajn osnove.",
        priority: "high",
        due: "week",
        status: "doing",
        tags: ["Fokus"],
        subtasks: [
          { title: "Ponoviti algoritme i strukture podataka" },
          { title: "Uraditi mock intervju" },
          { title: "Pripremiti pitanja za poslodavca", done: true },
        ],
      },
      {
        title: "Napisati propratno pismo",
        priority: "medium",
        due: "today",
        status: "done",
      },
    ],
    sections: [
      {
        name: "Sprint",
        tasks: [
          {
            // „PR #128" would have been the natural phrasing, and it trips the
            // raw-colour gate: `#128` is a syntactically valid three-digit hex
            // colour, and the gate is right to refuse to guess which is meant.
            title: "Code review za PR br. 128",
            priority: "medium",
            due: "today",
            status: "done",
            tags: ["Brzo"],
          },
          {
            title: "Ispraviti bag u modulu za autentifikaciju",
            description: "Token se ne obnavlja posle isteka — repro koraci u tiketu.",
            priority: "high",
            due: "overdue",
            tags: ["Hitno"],
          },
          {
            title: "Napisati testove za novi endpoint",
            priority: "medium",
            due: "week",
            status: "done",
          },
          {
            title: "Deploy na staging okruženje",
            priority: "none",
            due: "none",
          },
        ],
      },
      {
        name: "Administracija",
        tasks: [
          {
            title: "Popuniti izveštaj o radnim satima",
            priority: "low",
            due: "later",
            recurrence: WEEKLY_TIMESHEET,
            tags: ["Ponoviti"],
          },
          {
            title: "Obnoviti ugovor o radu",
            priority: "medium",
            due: "later",
            tags: ["Dokumentacija"],
          },
          {
            title: "Prijava godišnjeg odmora",
            priority: "low",
            due: "none",
            status: "done",
          },
          {
            title: "Mesečni izveštaj o troškovima",
            priority: "low",
            due: "later",
            recurrence: MONTHLY_EXPENSE_REPORT,
            tags: ["Ponoviti"],
          },
        ],
      },
    ],
  },
  {
    name: "Kuća",
    tasks: [
      {
        title: "Kupovina namirnica",
        description: "Mleko, jaja, povrće, kafa.",
        priority: "medium",
        due: "today",
        tags: ["Kupovina"],
      },
      {
        title: "Plaćanje računa za struju",
        priority: "medium",
        due: "week",
        recurrence: MONTHLY_BILL,
        tags: ["Ponoviti"],
      },
      {
        title: "Popravka slavine u kupatilu",
        description: "Curi ispod sudopere, verovatno zaptivka.",
        priority: "high",
        due: "overdue",
        tags: ["Hitno"],
      },
      {
        title: "Generalno čišćenje stana",
        priority: "low",
        due: "week",
        recurrence: BIWEEKLY_CLEAN,
        tags: ["Ponoviti"],
      },
      {
        title: "Zameniti filter za vodu",
        priority: "low",
        due: "later",
        status: "done",
      },
      {
        title: "Sastanak sa majstorom za klimu",
        priority: "medium",
        due: "today",
        tags: ["Poziv"],
      },
      {
        title: "Kupiti novu stolicu za radni sto",
        priority: "none",
        due: "none",
        status: "done",
        tags: ["Kupovina"],
      },
      {
        title: "Organizacija ostave",
        priority: "low",
        due: "later",
      },
    ],
  },
  {
    name: "Lično",
    tasks: [
      {
        title: "Zakazati sistematski pregled",
        description: "Krv, EKG i oftalmolog — obavezno pre kraja godine.",
        priority: "medium",
        due: "week",
        tags: ["Poziv"],
      },
      {
        title: "Obnoviti ličnu kartu",
        priority: "medium",
        due: "later",
        tags: ["Dokumentacija"],
      },
      {
        title: "Rezervacija leta za letovanje",
        priority: "medium",
        due: "later",
        status: "done",
      },
      {
        title: "Pročitati „Clean Architecture“",
        priority: "low",
        due: "none",
        tags: ["Fokus"],
        subtasks: [
          { title: "Prva polovina knjige", done: true },
          { title: "Druga polovina knjige" },
        ],
      },
      {
        title: "Vratiti pozajmljeni novac Marku",
        description: "Pozajmica za koncert u martu.",
        priority: "high",
        due: "overdue",
        status: "done",
      },
      {
        title: "Poklon za rođendan sestre",
        priority: "medium",
        due: "week",
        tags: ["Kupovina"],
      },
      {
        title: "Rezervacija stola za rođendansku večeru",
        priority: "medium",
        due: "today",
        tags: ["Poziv"],
      },
      {
        title: "Podnošenje zahteva za studentski kredit",
        description: "Potrebna potvrda o upisu i izvod iz banke.",
        priority: "high",
        due: "later",
        tags: ["Dokumentacija", "Važno"],
      },
    ],
  },
  {
    name: "Projekti",
    tasks: [
      {
        title: "Postaviti ličnu veb stranicu",
        priority: "medium",
        due: "later",
        tags: ["Ideja"],
      },
      {
        title: "Napisati blog post o RAG arhitekturama",
        priority: "none",
        due: "none",
        tags: ["Ideja"],
      },
    ],
    sections: [
      {
        name: "Nexus",
        tasks: [
          {
            title: "Dovršiti modul za praćenje navika",
            description: "Streak logika, nedeljni pregled i grafikon napretka.",
            priority: "high",
            due: "week",
            status: "doing",
            tags: ["Fokus"],
            subtasks: [
              { title: "Dizajnirati šemu baze", done: true },
              { title: "Implementirati streak logiku", done: true },
              { title: "Napisati UI komponente" },
            ],
          },
          {
            title: "Napisati testove za uvoz/izvoz podataka",
            description: "Pokriti .ics i JSON arhivu edge-case datumima.",
            priority: "medium",
            due: "later",
            status: "done",
          },
          {
            title: "Optimizacija upita nad velikim tabelama",
            description: "Indeksi za tabelu događaja i zadataka.",
            priority: "medium",
            due: "none",
            status: "done",
          },
        ],
      },
      {
        name: "Ideje",
        tasks: [
          {
            title: "Istražiti lokalne LLM modele za pretragu beležaka",
            description: "Kandidati: manji modeli koji staju u 8GB VRAM.",
            priority: "low",
            due: "none",
            tags: ["Ideja"],
          },
          {
            title: "Skica za aplikaciju za deljenje troškova sa cimerima",
            priority: "none",
            due: "none",
            tags: ["Ideja"],
          },
        ],
      },
    ],
  },
];

// --- Dependencies (ADR-037) ----------------------------------------------
//
// Five edges, each between tasks whose real-world order actually matters —
// never a pair picked just to exercise the table.

const DEPENDENCIES: readonly DependencySeed[] = [
  { blocker: "Ažurirati CV i portfolio", blocked: "Poslati prijave za pripravnički program" },
  { blocker: "Ispraviti bag u modulu za autentifikaciju", blocked: "Deploy na staging okruženje" },
  { blocker: "Dizajnirati šemu baze", blocked: "Implementirati streak logiku" },
  { blocker: "Napisati gramatiku", blocked: "Implementirati parser" },
  {
    blocker: "Pročitati poglavlje o gradijentnom spustu",
    blocked: "Napisati testove za slojeve",
  },
];

// --- Seeding engine ----------------------------------------------------

interface TaskSeedEnv {
  readonly ctx: DemoContext;
  readonly rnd: DemoRandom;
  readonly tasks: TaskStore;
  readonly tagStore: TaskTagStore;
  readonly tagIdByName: ReadonlyMap<string, string>;
  readonly idByTitle: Map<string, string>;
}

/** Resolves a hand-authored due bucket to a concrete date, jittered within the bucket's span. */
function dueDateForBucket(ctx: DemoContext, rnd: DemoRandom, bucket: DueBucket): string | null {
  switch (bucket) {
    case "overdue":
      return demoDay(ctx, -rnd.int(2, 9));
    case "today":
      return ctx.today;
    case "week":
      return demoDay(ctx, rnd.int(1, 6));
    case "later":
      return demoDay(ctx, rnd.int(9, 45));
    case "none":
      return null;
  }
}

/**
 * The due date a recurring task is seeded with: a real occurrence of `rule`
 * at or after today, never an arbitrary bucketed date. `TaskStore` shows
 * `dueDate` directly (unlike a calendar event, a task does not expand
 * virtually — ADR-024), so a due date that does not itself match the task's
 * own rule would read as broken the moment the profile opens.
 *
 * The scan starts from a NEAR anchor (three weeks back) rather than a far one:
 * a `count`-terminated rule tallies every occurrence from its anchor forward,
 * so a distant anchor could exhaust the count before reaching today. A weekly
 * or monthly-date rule does not care how far back the anchor sits — see
 * `recurrence.ts`'s own `weeklySeries`/`monthlySeries` — so the same near
 * anchor works for every rule shape this file uses.
 */
function recurringDueDate(ctx: DemoContext, rule: RecurrenceRule): string {
  const anchor = demoDay(ctx, -21);
  const next = nextOccurrenceDate(rule, anchor, demoDay(ctx, -1));
  if (next === null) {
    throw new Error("Demo recurrence rule produced no upcoming occurrence from its anchor.");
  }
  return next;
}

function requireTagId(byName: ReadonlyMap<string, string>, name: string): string {
  const id = byName.get(name);
  if (id === undefined) throw new Error(`Demo tag "${name}" was never created.`);
  return id;
}

function requireTaskId(byTitle: ReadonlyMap<string, string>, title: string): string {
  const id = byTitle.get(title);
  if (id === undefined) throw new Error(`Demo task "${title}" was never created.`);
  return id;
}

// --- History (when each task was created, and when it was finished) ------
//
// Two windows, both counted in days back from the demo's today: creations
// spread across five months, completions across the last three weeks. The two
// together are what the „Priliv i odliv" chart plots week by week — a wide
// intake against a recent, denser outflow, which is the shape a real backlog
// has.

const CREATED_DAYS_BACK = 150;
const COMPLETED_DAYS_BACK = 21;

/** One task's life as day offsets from today, both negative; `completed` is null while the task is open. */
interface TaskLifetime {
  readonly created: number;
  readonly completed: number | null;
}

/**
 * The lifetime of one list-body or section task.
 *
 * A FINISHED task is drawn END-FIRST: the completion day comes out of the
 * three-week window, and the creation day is then that day MINUS a lead time of
 * at least one day. The subtraction is the whole guarantee — the creation
 * offset is *computed from* the completion offset, never drawn beside it — so
 * there is no draw this function can make that puts a completion before its own
 * creation. The relationship holds by construction rather than by a comparison
 * that some future branch could forget to run.
 *
 * Both branches stop at -2 rather than -1, which is what always leaves a done
 * subtask of an open parent at least one day to be completed in
 * (`subtaskCompletedOffset`).
 */
function taskLifetime(rnd: DemoRandom, done: boolean): TaskLifetime {
  if (!done) return { created: -rnd.int(2, CREATED_DAYS_BACK), completed: null };
  const completed = -rnd.int(1, COMPLETED_DAYS_BACK);
  return { created: completed - rnd.int(1, CREATED_DAYS_BACK - COMPLETED_DAYS_BACK), completed };
}

/**
 * When a done SUBTASK was ticked off. A subtask carries its parent's own
 * creation instant (`createListTask` explains why), so the earliest it can be
 * finished is the day after the parent was created; the latest is the day the
 * parent itself was finished, or yesterday while the parent is still open — a
 * checklist item completed after the task it belongs to would read as broken.
 *
 * The range is never empty: `taskLifetime` returns `created <= -2` and
 * `completed >= created + 1`, so `earliest <= latest` on both branches.
 */
function subtaskCompletedOffset(rnd: DemoRandom, parent: TaskLifetime): number {
  const earliest = Math.max(parent.created + 1, -COMPLETED_DAYS_BACK);
  return rnd.int(earliest, parent.completed ?? -1);
}

/** A day offset resolved to a waking-hours instant on that day, as the ISO-8601 date-time the stores take. */
function demoInstant(ctx: DemoContext, rnd: DemoRandom, offset: number): string {
  return new Date(demoAt(ctx, offset, rnd.int(8, 21), rnd.int(0, 59))).toISOString();
}

/**
 * Creates one list-body or section task, its tags and its subtasks, recording
 * every id created by title.
 *
 * A finished task is created OPEN and checked off afterwards, in two calls:
 * `create` stamps one instant across `createdAt`, `updatedAt` and (for a row
 * born done) `completedAt`, so a single call cannot express a task that was
 * written in March and finished in July. Two calls also make the seed follow
 * the path a person's task actually takes, which is the rule `context.ts` sets
 * for this whole directory.
 *
 * No seed is both recurring and done; if one ever is, `setDone` refuses it
 * (ADR-024 — that is `completeOccurrence`'s job) and the seeder fails loudly
 * rather than quietly ending a series.
 */
function createListTask(
  env: TaskSeedEnv,
  listId: string,
  sectionId: string | null,
  seed: TaskSeed,
): void {
  const dueDate =
    seed.recurrence !== undefined
      ? recurringDueDate(env.ctx, seed.recurrence)
      : dueDateForBucket(env.ctx, env.rnd, seed.due);
  const lifetime = taskLifetime(env.rnd, seed.status === "done");
  const createdAt = demoInstant(env.ctx, env.rnd, lifetime.created);

  const input: CreateTaskInput = {
    title: seed.title,
    priority: seed.priority,
    dueDate,
    listId,
    sectionId,
    ...(seed.description !== undefined ? { description: seed.description } : {}),
    ...(seed.status === "doing" ? { status: seed.status } : {}),
    ...(seed.recurrence !== undefined ? { recurrence: seed.recurrence } : {}),
  };
  const created = env.tasks.create(input, createdAt);
  env.idByTitle.set(seed.title, created.id);
  if (lifetime.completed !== null) {
    env.tasks.setDone(created.id, true, demoInstant(env.ctx, env.rnd, lifetime.completed));
  }

  for (const tagName of seed.tags ?? []) {
    env.tagStore.attachTag(created.id, requireTagId(env.tagIdByName, tagName));
  }

  for (const sub of seed.subtasks ?? []) {
    // A checklist is written when the task it hangs under is written, so a
    // subtask takes its parent's own creation instant — which is also what
    // makes "a subtask never predates its parent" true without comparing
    // anything.
    const createdSub = env.tasks.create({ title: sub.title, parentId: created.id }, createdAt);
    env.idByTitle.set(sub.title, createdSub.id);
    if (sub.done === true) {
      const at = demoInstant(env.ctx, env.rnd, subtaskCompletedOffset(env.rnd, lifetime));
      env.tasks.setDone(createdSub.id, true, at);
    }
  }
}

export function seedDemoTasks(db: DatabaseHandle, ctx: DemoContext): void {
  const rnd = demoRandom("tasks");
  const nowIso = new Date(ctx.now).toISOString();

  const lists = new TaskListStore(db, ctx.profileId);
  const tasks = new TaskStore(db, ctx.profileId);
  const tagStore = new TaskTagStore(db, ctx.profileId);
  const deps = new TaskDependencyStore(db, ctx.profileId);

  const tagIdByName = new Map<string, string>();
  for (const name of TAGS) {
    tagIdByName.set(name, tagStore.createTag(name, nowIso).id);
  }

  const env: TaskSeedEnv = {
    ctx,
    rnd,
    tasks,
    tagStore,
    tagIdByName,
    idByTitle: new Map<string, string>(),
  };

  for (const listSeed of LISTS) {
    const list = lists.createList({ name: listSeed.name }, nowIso);

    for (const taskSeed of listSeed.tasks) {
      createListTask(env, list.id, null, taskSeed);
    }
    for (const sectionSeed of listSeed.sections ?? []) {
      const section = lists.createSection(list.id, sectionSeed.name, nowIso);
      for (const taskSeed of sectionSeed.tasks) {
        createListTask(env, list.id, section.id, taskSeed);
      }
    }
  }

  for (const dependency of DEPENDENCIES) {
    deps.addDependency(
      requireTaskId(env.idByTitle, dependency.blocker),
      requireTaskId(env.idByTitle, dependency.blocked),
    );
  }
}
