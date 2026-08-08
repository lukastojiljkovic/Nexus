/**
 * Demo seed for the BUSINESS profile — a freelance/consulting working life in
 * Serbia, and the counterpart to the personal demo profile the sibling files in
 * this directory build. Where the personal profile is a student's whole life,
 * this one is deliberately narrower: TASK, CALENDAR, NOTES, FINANCE, PEOPLE and
 * DOCUMENTS only. STUDY, FIT, HABIT and FOCUS are personal-life modules a
 * business profile has no reason to carry, so they are simply never seeded here.
 *
 * Everything goes through the same public stores the renderer's IPC handlers
 * use (`context.ts`'s file doc explains why that indistinguishability is the
 * whole point of a demo profile), each module drawing from its own named
 * `demoRandom` stream and every instant derived from `ctx.now` — nothing here
 * reads the wall clock or `Math.random`.
 */

import { buildNoteUpdate, nextOccurrenceDate, parseMarkdownNote, type RecurrenceRule } from "@nexus/core";
import {
  DocumentStore,
  EventStore,
  FinAccountStore,
  FinCategoryStore,
  FinRecurringStore,
  FinTransactionStore,
  NOTE_FOLDER_COLORS,
  NoteOrgStore,
  NoteStore,
  PeopleStore,
  TaskListStore,
  TaskStore,
  TaskTagStore,
  type CreateEventInput,
  type CreateFinRecurringInput,
  type CreatePersonInput,
  type CreateTaskInput,
  type DocumentType,
  type NoteFolderColor,
  type PersonKind,
  type TaskPriority,
} from "@nexus/db";
import { compactNow } from "../notes.js";
import {
  demoAt,
  demoDay,
  demoRandom,
  minutes,
  type DatabaseHandle,
  type DemoContext,
  type DemoRandom,
} from "./context.js";

// =========================================================================
// TASK
// =========================================================================

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

const TAGS = ["Hitno", "Čeka odgovor", "Poziv", "Dokumentacija", "Ideja", "Ponoviti"] as const;

// Two standing monthly obligations a Serbian freelancer/agency owner actually
// carries — self-employment contributions and the documents the accountant
// needs — mirroring the day-of-month the FINANCE module charges the matching
// cost on, so the two modules tell the same story about the same two dates.
const MONTHLY_CONTRIBUTIONS: RecurrenceRule = {
  freq: { kind: "monthly-date", interval: 1, day: 15 },
  end: { kind: "never" },
};
const MONTHLY_ACCOUNTANT_DOCS: RecurrenceRule = {
  freq: { kind: "monthly-date", interval: 1, day: 5 },
  end: { kind: "never" },
};

const INBOX_TASKS: readonly TaskSeed[] = [
  { title: "Pozvati podršku hostinga", priority: "none", due: "none" },
  { title: "Proveriti email od advokata", priority: "medium", due: "today" },
  { title: "Ideja: paket usluga za male klijente", priority: "none", due: "none", tags: ["Ideja"] },
];

const LISTS: readonly ListSeed[] = [
  {
    name: "Klijenti",
    tasks: [
      { title: "Poziv sa klijentom: redizajn sajta", priority: "high", due: "week", tags: ["Poziv"] },
      { title: "Poslati predračun za Delta d.o.o.", priority: "high", due: "today", tags: ["Hitno"] },
      {
        title: "Onboarding novog klijenta — Nimbus d.o.o.",
        priority: "medium",
        due: "week",
        status: "doing",
        subtasks: [
          { title: "Poslati ugovor na potpis", done: true },
          { title: "Zakazati uvodni sastanak", done: true },
          { title: "Podesiti pristup projektnim alatima" },
        ],
      },
      { title: "Prezentacija predloga za Sunčani vrt", priority: "high", due: "overdue" },
      { title: "Follow-up sa klijentom posle sastanka", priority: "low", due: "none", status: "done" },
    ],
  },
  {
    name: "Ponude i ugovori",
    tasks: [
      {
        title: "Priprema ponude — redizajn sajta Delta d.o.o.",
        priority: "high",
        due: "week",
        tags: ["Dokumentacija"],
        subtasks: [
          { title: "Definisati obim posla", done: true },
          { title: "Izračunati cenu po fazama" },
          { title: "Poslati na pregled" },
        ],
      },
      { title: "Poslati ugovor na potpis — Vega studio", priority: "medium", due: "today" },
      { title: "Revizija cenovnika usluga", priority: "low", due: "none", tags: ["Ideja"] },
    ],
    sections: [
      {
        name: "Ugovori",
        tasks: [
          {
            title: "Obnoviti ugovor sa Nimbus d.o.o.",
            priority: "medium",
            due: "later",
            tags: ["Dokumentacija"],
          },
          {
            title: "Arhivirati potpisane ugovore za drugi kvartal",
            priority: "low",
            due: "none",
            status: "done",
          },
        ],
      },
    ],
  },
  {
    name: "Administracija",
    tasks: [
      {
        title: "Kvartalni PDV — priprema",
        description: "Sravnjenje ulaznih i izlaznih računa pre predaje prijave.",
        priority: "high",
        due: "week",
        tags: ["Hitno", "Dokumentacija"],
      },
      { title: "Obnoviti domen i hosting", priority: "medium", due: "overdue" },
      { title: "Fakturisati avgust", priority: "high", due: "today" },
    ],
    sections: [
      {
        name: "Finansije",
        tasks: [
          {
            title: "Uplata doprinosa za samostalnu delatnost",
            priority: "high",
            due: "later",
            recurrence: MONTHLY_CONTRIBUTIONS,
            tags: ["Ponoviti"],
          },
          {
            title: "Slanje dokumentacije knjigovođi",
            priority: "medium",
            due: "later",
            recurrence: MONTHLY_ACCOUNTANT_DOCS,
            tags: ["Ponoviti"],
          },
        ],
      },
    ],
  },
  {
    name: "Marketing",
    tasks: [
      { title: "Objava studije slučaja na LinkedIn-u", priority: "low", due: "none", tags: ["Ideja"] },
      { title: "Ažuriranje portfolija na sajtu", priority: "medium", due: "later" },
      { title: "Zakazati fotografisanje za sajt", priority: "low", due: "week" },
      { title: "Newsletter — avgustovsko izdanje", priority: "medium", due: "none", status: "done" },
    ],
  },
];

// --- Seeding engine ------------------------------------------------------
//
// A trimmed copy of `tasks.ts`'s own engine: the same history model (a task's
// `createdAt`/`completedAt` are drawn, never stamped with "now"), scaled to a
// four-month business window rather than a five-month student one. No
// dependency graph and no `idByTitle` map — this profile's ~22 tasks name
// nothing by cross-reference, so there is nothing here to look up by title.

const CREATED_DAYS_BACK = 90;
const COMPLETED_DAYS_BACK = 21;

interface TaskLifetime {
  readonly created: number;
  readonly completed: number | null;
}

interface TaskSeedEnv {
  readonly ctx: DemoContext;
  readonly rnd: DemoRandom;
  readonly tasks: TaskStore;
  readonly tagStore: TaskTagStore;
  readonly tagIdByName: ReadonlyMap<string, string>;
}

function dueDateForBucket(ctx: DemoContext, rnd: DemoRandom, bucket: DueBucket): string | null {
  switch (bucket) {
    case "overdue":
      return demoDay(ctx, -rnd.int(2, 9));
    case "today":
      return ctx.today;
    case "week":
      return demoDay(ctx, rnd.int(1, 6));
    case "later":
      return demoDay(ctx, rnd.int(9, 30));
    case "none":
      return null;
  }
}

/** Same reasoning as `tasks.ts`'s own `recurringDueDate`: a near anchor works for every rule shape this file uses. */
function recurringDueDate(ctx: DemoContext, rule: RecurrenceRule): string {
  const anchor = demoDay(ctx, -21);
  const next = nextOccurrenceDate(rule, anchor, demoDay(ctx, -1));
  if (next === null) {
    throw new Error("Demo recurrence rule produced no upcoming occurrence from its anchor.");
  }
  return next;
}

/** A FINISHED task drawn end-first, exactly as `tasks.ts` does — see that file's own doc for why the subtraction is the whole guarantee. */
function taskLifetime(rnd: DemoRandom, done: boolean): TaskLifetime {
  if (!done) return { created: -rnd.int(2, CREATED_DAYS_BACK), completed: null };
  const completed = -rnd.int(1, COMPLETED_DAYS_BACK);
  return { created: completed - rnd.int(1, CREATED_DAYS_BACK - COMPLETED_DAYS_BACK), completed };
}

function subtaskCompletedOffset(rnd: DemoRandom, parent: TaskLifetime): number {
  const earliest = Math.max(parent.created + 1, -COMPLETED_DAYS_BACK);
  return rnd.int(earliest, parent.completed ?? -1);
}

function demoInstant(ctx: DemoContext, rnd: DemoRandom, offset: number): string {
  return new Date(demoAt(ctx, offset, rnd.int(8, 21), rnd.int(0, 59))).toISOString();
}

function requireTagId(byName: ReadonlyMap<string, string>, name: string): string {
  const id = byName.get(name);
  if (id === undefined) throw new Error(`Demo tag "${name}" was never created.`);
  return id;
}

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
  if (lifetime.completed !== null) {
    env.tasks.setDone(created.id, true, demoInstant(env.ctx, env.rnd, lifetime.completed));
  }

  for (const tagName of seed.tags ?? []) {
    env.tagStore.attachTag(created.id, requireTagId(env.tagIdByName, tagName));
  }

  for (const sub of seed.subtasks ?? []) {
    const createdSub = env.tasks.create({ title: sub.title, parentId: created.id }, createdAt);
    if (sub.done === true) {
      const at = demoInstant(env.ctx, env.rnd, subtaskCompletedOffset(env.rnd, lifetime));
      env.tasks.setDone(createdSub.id, true, at);
    }
  }
}

function seedBusinessTasks(db: DatabaseHandle, ctx: DemoContext): void {
  const rnd = demoRandom("business-tasks");
  const nowIso = new Date(ctx.now).toISOString();

  const lists = new TaskListStore(db, ctx.profileId);
  const tasks = new TaskStore(db, ctx.profileId);
  const tagStore = new TaskTagStore(db, ctx.profileId);

  const tagIdByName = new Map<string, string>();
  for (const name of TAGS) {
    tagIdByName.set(name, tagStore.createTag(name, nowIso).id);
  }

  const env: TaskSeedEnv = { ctx, rnd, tasks, tagStore, tagIdByName };

  // `TaskStore` refuses to place a task without a list; `ensureInbox` is
  // idempotent, so seeding this profile more than once stays safe.
  const inbox = lists.ensureInbox(nowIso);
  for (const taskSeed of INBOX_TASKS) {
    createListTask(env, inbox.id, null, taskSeed);
  }

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
}

// =========================================================================
// CALENDAR
// =========================================================================

/** One weekday, working-hours meeting — `offset` is a raw day offset, shifted to the nearest weekday by `placeWeekdayEvent`. */
interface BusinessEventSeed {
  readonly title: string;
  readonly offset: number;
  readonly hour: number;
  readonly durationMinutes: number;
  readonly category: string;
  readonly location?: string;
  readonly description?: string;
}

const EVENT_MINUTES = [0, 15, 30, 45] as const;

const ONE_OFF_EVENTS: readonly BusinessEventSeed[] = [
  {
    title: "Poziv sa klijentom: Delta d.o.o.",
    offset: -20,
    hour: 9,
    durationMinutes: 45,
    category: "klijenti",
    description: "Provera statusa redizajna sajta.",
  },
  {
    title: "Sastanak sa knjigovođom",
    offset: -17,
    hour: 10,
    durationMinutes: 60,
    category: "administracija",
    location: "Kancelarija knjigovođe",
  },
  { title: "Sprint pregled — Nimbus d.o.o.", offset: -14, hour: 11, durationMinutes: 60, category: "posao" },
  { title: "Poziv sa klijentom: Vega studio", offset: -11, hour: 9, durationMinutes: 30, category: "klijenti" },
  { title: "Pregled ugovora sa advokatom", offset: -8, hour: 14, durationMinutes: 45, category: "administracija" },
  { title: "Prezentacija predloga — Sunčani vrt", offset: -6, hour: 10, durationMinutes: 60, category: "klijenti" },
  { title: "Radni sastanak — redizajn sajta", offset: -3, hour: 13, durationMinutes: 90, category: "posao" },
  { title: "Poziv: podrška za postojećeg klijenta", offset: -1, hour: 15, durationMinutes: 30, category: "klijenti" },
  {
    title: "Sastanak sa dizajnerom — frilens saradnja",
    offset: 2,
    hour: 11,
    durationMinutes: 45,
    category: "posao",
  },
  { title: "Poziv sa potencijalnim klijentom", offset: 4, hour: 9, durationMinutes: 30, category: "klijenti" },
  { title: "Interni pregled finansija", offset: 7, hour: 16, durationMinutes: 60, category: "administracija" },
  { title: "Sprint pregled — interni projekat", offset: 10, hour: 11, durationMinutes: 60, category: "posao" },
  { title: "Prezentacija za investitora", offset: 13, hour: 10, durationMinutes: 90, category: "posao" },
  { title: "Telefonski poziv — nova ponuda", offset: 16, hour: 9, durationMinutes: 30, category: "klijenti" },
  {
    title: "Sastanak sa knjigovođom — zatvaranje kvartala",
    offset: 19,
    hour: 10,
    durationMinutes: 60,
    category: "administracija",
  },
];

/** Monday-first weekday of the date `offset` days from today (0 = Monday … 6 = Sunday) — the recurrence engine's own convention. */
function weekdayOf(ctx: DemoContext, offset: number): number {
  const anchor = new Date(ctx.now);
  const day = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + offset).getDay();
  return (day + 6) % 7;
}

/** Shifts a weekend offset forward to the following Monday — every one-off business meeting lands on a weekday. */
function nearestWeekday(ctx: DemoContext, offset: number): number {
  let candidate = offset;
  while (weekdayOf(ctx, candidate) >= 5) candidate += 1;
  return candidate;
}

/** The offset of the Saturday `weeksAway` weeks from this one — `calendar.ts`'s own helper, so a workshop lands on a real Saturday. */
function saturdayOffset(ctx: DemoContext, weeksAway: number): number {
  return weeksAway * 7 + (5 - weekdayOf(ctx, 0));
}

function placeWeekdayEvent(
  ctx: DemoContext,
  rnd: DemoRandom,
  events: EventStore,
  seed: BusinessEventSeed,
): void {
  const offset = nearestWeekday(ctx, seed.offset);
  const minute = rnd.of(EVENT_MINUTES);
  const startMs = demoAt(ctx, offset, seed.hour, minute);
  const input: CreateEventInput = {
    title: seed.title,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(startMs + minutes(seed.durationMinutes)).toISOString(),
    category: seed.category,
    ...(seed.location !== undefined ? { location: seed.location } : {}),
    ...(seed.description !== undefined ? { description: seed.description } : {}),
  };
  events.create(input);
}

function seedBusinessCalendar(db: DatabaseHandle, ctx: DemoContext): void {
  const rnd = demoRandom("business-calendar");
  const events = new EventStore(db, ctx.profileId);

  // The one recurring rhythm a small team actually keeps — a Monday stand-up,
  // expanded virtually across the whole window from a single row (ADR-024).
  const standupStart = demoAt(ctx, -14, 9, 0);
  const standupRule: RecurrenceRule = {
    freq: { kind: "weekly", interval: 1, days: [0] }, // Monday
    end: { kind: "never" },
  };
  events.create({
    title: "Nedeljni sastanak tima",
    startAt: new Date(standupStart).toISOString(),
    endAt: new Date(standupStart + minutes(30)).toISOString(),
    category: "posao",
    recurrence: standupRule,
  });

  for (const seed of ONE_OFF_EVENTS) {
    placeWeekdayEvent(ctx, rnd, events, seed);
  }

  // A two-day conference, like `calendar.ts`'s own DevConf — an all-day span
  // is never subject to the weekday-only rule that governs the timed meetings.
  events.create({
    title: "Konferencija — DevBiz Beograd",
    startAt: demoDay(ctx, 9),
    endAt: demoDay(ctx, 10),
    allDay: true,
    category: "posao",
    description: "Dva dana predavanja o digitalnom marketingu i razvoju poslovanja.",
  });

  // The one deliberate exception to "working hours, Monday-Friday".
  const workshopOffset = saturdayOffset(ctx, 1);
  const workshopStart = demoAt(ctx, workshopOffset, 10, 0);
  events.create({
    title: "Radionica za klijente — uvod u digitalni marketing",
    startAt: new Date(workshopStart).toISOString(),
    endAt: new Date(workshopStart + minutes(180)).toISOString(),
    category: "klijenti",
    location: "Coworking prostor",
  });
}

// =========================================================================
// NOTES
// =========================================================================

interface DemoFolderSpec {
  readonly key: string;
  readonly name: string;
  readonly color: NoteFolderColor;
  readonly createdOffsetDays: number;
}

/** Every business note lives in one of the two folders — unlike the personal profile, nothing here is unfiled. */
interface DemoNoteSpec {
  readonly folderKey: string;
  readonly createdOffsetDays: number;
  readonly revisitAfterDays?: number;
  readonly pinned?: boolean;
  readonly tags?: readonly string[];
  readonly body: string;
}

/** Reads one entry from the store's own colour palette — see `notes.ts`'s identical helper for why. */
function paletteColor(index: number): NoteFolderColor {
  const color = NOTE_FOLDER_COLORS[index];
  if (color === undefined) {
    throw new Error(`seedBusinessNotes: no folder colour at palette index ${index}.`);
  }
  return color;
}

const FOLDERS: readonly DemoFolderSpec[] = [
  { key: "klijenti", name: "Klijenti", color: paletteColor(0), createdOffsetDays: -105 },
  { key: "interno", name: "Interno", color: paletteColor(1), createdOffsetDays: -105 },
];

const NOTES: readonly DemoNoteSpec[] = [
  // --- Klijenti ----------------------------------------------------------
  {
    folderKey: "klijenti",
    createdOffsetDays: -95,
    tags: ["klijent", "sastanak"],
    body: `# Zapisnik sastanka — Delta d.o.o.

Sastanak održan u kancelariji klijenta, prisutni: kontakt osoba klijenta i ja.
Tema — redizajn korporativnog sajta.

## Dogovoreno

Klijent želi potpuno nov vizuelni identitet sajta, zadržavajući postojeću
strukturu sadržaja koliko god je moguće — najveći deo teksta je nedavno
osvežen i ne treba ga ponovo pisati. Prioritet je brzina učitavanja stranice,
jer trenutna verzija sporo radi na mobilnim uređajima.

## Sledeći koraci

- Poslati predlog wireframe-a za početnu stranicu do kraja nedelje
- Zatražiti pristup analitici sajta radi uvida u najposećenije stranice
- Dogovoriti termin za drugi sastanak posle prvog kruga predloga

Klijent je naglasio da budžet za ovaj projekat nije konačno zaključan, ali da
očekuje predlog cene pre nego što odobri obim posla — predlog cene ide odmah
posle prvog kruga wireframe-ova, ne posle kompletnog dizajna.
`,
  },
  {
    folderKey: "klijenti",
    createdOffsetDays: -80,
    revisitAfterDays: 20,
    tags: ["projekat"],
    body: `# Brief projekta — redizajn sajta, Vega studio

Radni brief pre početka izrade ponude. Vega studio je manja agencija za
unutrašnji dizajn, žele sajt koji izgleda kao portfolio, ne kao klasična
korporativna prezentacija.

## Ciljevi

Glavni cilj je da posetilac za manje od minuta vidi portfolio radova i
kontakt formu — trenutni sajt sakriva oboje iza previše klikova. Sekundarni
cilj je jednostavan sistem da sami dodaju nove projekte u portfolio bez
pozivanja programera svaki put.

## Obim

- Početna stranica sa istaknutim portfolio radovima
- Stranica portfolija sa filterom po tipu prostora (stan, poslovni prostor,
  lokal)
- Kontakt stranica sa formom i mapom lokacije
- Jednostavan admin panel za dodavanje novih projekata

## Otvorena pitanja

Nisu odlučili da li žele CMS ili prilagođen admin panel — predložiću
prilagođeno rešenje jer je obim sadržaja mali i CMS bi bio prekomplikovan za
ono što im treba. Vratiću se na ovo posle njihovog odgovora.
`,
  },
  {
    folderKey: "klijenti",
    createdOffsetDays: -60,
    tags: ["ponuda"],
    body: `# Ponuda — razvoj veb aplikacije za Nimbus d.o.o.

Radna verzija ponude pre slanja klijentu, sa cenom po fazama umesto jedne
paušalne sume — lakše je klijentu da odobri fazu po fazu nego ceo iznos
odjednom.

## Faza 1 — Analiza i dizajn

Analiza zahteva, wireframe-ovi, dizajn ključnih ekrana. Trajanje dve nedelje.

## Faza 2 — Razvoj osnovne funkcionalnosti

Autentifikacija, glavni tok aplikacije, integracija sa njihovim postojećim
sistemom za upravljanje nalozima. Trajanje pet nedelja.

## Faza 3 — Testiranje i lansiranje

Testiranje sa stvarnim korisnicima, ispravke, priprema za produkciju.
Trajanje dve nedelje.

## Napomene

- Cena ne uključuje hosting — klijent već ima ugovor sa svojim provajderom
- Održavanje posle lansiranja ide kao poseban mesečni ugovor, ne kao deo ove
  ponude
- Rok od devet nedelja važi ako klijent isporučuje povratne informacije u
  roku od dva radna dana po fazi
`,
  },
  {
    folderKey: "klijenti",
    createdOffsetDays: -45,
    pinned: true,
    tags: ["onboarding"],
    body: `# Onboarding checklist — novi klijent

Lista koraka za svakog novog klijenta, da ništa ne ispadne iz procesa kad ima
više projekata u isto vreme.

- [x] Poslati ugovor na potpis
- [x] Zatražiti avansnu uplatu pre početka rada
- [x] Kreirati poseban folder za klijenta u sistemu za fajlove
- [ ] Zakazati uvodni sastanak i definisati kanale komunikacije
- [ ] Podesiti pristup alatima za praćenje projekta
- [ ] Poslati raspored isporuke sa okvirnim datumima

Najčešća greška iz ranijih projekata — zaboravim da definišem kanal
komunikacije na početku, pa se onda mešaju mejlovi, poruke i pozivi bez reda.
`,
  },
  {
    folderKey: "klijenti",
    createdOffsetDays: -30,
    tags: ["klijent", "sastanak"],
    body: `# Zapisnik sastanka — Sunčani vrt, predlog redizajna

Prvi sastanak sa novim potencijalnim klijentom — lanac vrtića Sunčani vrt,
zainteresovani za redizajn sajta i uvođenje online prijave za upis dece.

## Šta klijent traži

Trenutni sajt je star nekoliko godina i ne radi dobro na telefonu, a najveći
problem je što roditelji zovu telefonom da prijave dete jer online forma na
sajtu ne postoji. Žele formu koja šalje podatke direktno na mejl kancelarije,
bez potrebe za složenim sistemom za upravljanje.

## Utisak

Klijent nema jasnu predstavu o budžetu, samo okvirnu želju šta sajt treba da
radi — trebaće mi dodatni sastanak da definišemo tačan obim pre nego što
pošaljem predlog cene, umesto da nagađam obim iz ovog prvog razgovora.
`,
  },
  {
    folderKey: "klijenti",
    createdOffsetDays: -10,
    revisitAfterDays: 8,
    tags: ["klijent"],
    body: `# Beleške sa poziva — Vega studio, druga runda pregovora

Kratak poziv posle prve ponude — imaju par pitanja pre potpisivanja.

Najviše ih je zanimalo da li cena uključuje reviziju dizajna posle prvog
predloga — potvrdio sam da su dve runde revizije uključene, treća se
naplaćuje posebno. Takođe su pitali da li mogu da plate u dve rate umesto
odjednom, na šta sam pristao — polovina po potpisivanju ugovora, polovina po
predaji finalnog rada.

Deluju spremni da potpišu, čekam samo da mi pošalju potvrđen tekst ugovora.
`,
  },

  // --- Interno -------------------------------------------------------------
  {
    folderKey: "interno",
    createdOffsetDays: -100,
    body: `# Cenovnik usluga

Interni cenovnik, referenca pre slanja svake ponude — ne šalje se klijentima
u ovom obliku, služi samo da cene budu dosledne od projekta do projekta.

## Razvoj sajtova

- Jednostavan prezentacioni sajt — paušalna cena po dogovoru
- Veb aplikacija sa korisničkim nalozima — cena po fazama, ne paušalno
- Mesečno održavanje — fiksna mesečna naknada, nezavisno od broja sati

## Dizajn

- Redizajn postojećeg sajta — po broju jedinstvenih ekrana
- Izrada vizuelnog identiteta — paušalna cena, uključuje dve runde revizije

## Konsultacije

Satnica za konsultacije van okvira postojećeg ugovora — koristi se retko, ali
je bitno da postoji jasna cena umesto da se pregovara od slučaja do slučaja.

Cenovnik revidiram otprilike jednom godišnje, na osnovu toga koliko su
projekti realno trajali u odnosu na procenu.
`,
  },
  {
    folderKey: "interno",
    createdOffsetDays: -70,
    revisitAfterDays: 40,
    pinned: true,
    tags: ["procedura"],
    body: `# Procedura za onboarding novog klijenta

Interna procedura — dopuna na onboarding checklistu iz foldera Klijenti, ovde
je objašnjenje ZAŠTO svaki korak postoji, ne samo lista.

## Zašto ugovor ide pre svega ostalog

Nijedan sastanak o obimu posla se ne zakazuje pre potpisanog ugovora — u
ranijim projektima gde sam preskočio ovaj korak, obim se menjao usred
razgovora i onda je bilo teško vratiti se na pisanu verziju.

## Zašto avans ide pre početka rada

Avansna uplata nije samo o novcu — pokazuje da je klijent ozbiljan i smanjuje
broj projekata koji stanu na pola posle par nedelja rada bez ikakve uplate.

## Zašto poseban folder odmah na početku

Kad se folder kreira tek kad zatreba, fajlovi se raspu po više mesta i teško
ih je posle naći. Folder ide odmah, čak i pre nego što ima šta da se stavi u
njega.

Dopunio proceduru posle jednog projekta gde se komunikacija odvijala kroz tri
različita kanala istovremeno — dodao sam korak o definisanju kanala baš zbog
toga.
`,
  },
  {
    folderKey: "interno",
    createdOffsetDays: -50,
    body: `# Beleške — poreske obaveze samostalne radnje

Lične beleške radi orijentacije, ne zamena za savet knjigovođe — svaka
konkretna odluka ide preko knjigovođe.

Kao samostalna radnja, obaveze se plaćaju mesečno — porez na prihod i
doprinosi za penzijsko i zdravstveno osiguranje. Osnovica zavisi od
prijavljenog prihoda prethodnog perioda, pa nagli skok prihoda u jednom
mesecu ne menja odmah iznos obaveze za taj isti mesec.

Dokumentacija za knjigovođu ide početkom svakog meseca — izvod sa računa i
spisak izdatih faktura. Kašnjenje u slanju dokumentacije direktno kasni
obračun, pa je bolje poslati par dana ranije nego tačno na rok.
`,
  },
  {
    folderKey: "interno",
    createdOffsetDays: -5,
    tags: ["ideja"],
    body: `# Ideje za nove usluge

Brza lista mogućih pravaca širenja, bez konkretnog plana za sada.

- Paket mesečnog održavanja sajta za klijente koji nemaju sopstveni tim —
  redovna svrha za manje popravke i ažuriranja
- Konsultacije za manje firme koje razmišljaju o sajtu ali još nisu spremne
  za pun projekat
- Šablon-baziran paket za manje klijente sa ograničenim budžetom, brži za
  isporuku od potpuno prilagođenog rešenja

Paket održavanja deluje najrealnije za sledeći korak — već postoji nekoliko
klijenata koji bi verovatno pristali odmah.
`,
  },
];

function stamp(ctx: DemoContext, rnd: DemoRandom, offsetDays: number): string {
  return new Date(demoAt(ctx, offsetDays, rnd.int(8, 21), rnd.int(0, 59))).toISOString();
}

function requireFolderId(folderIds: ReadonlyMap<string, string>, key: string): string {
  const id = folderIds.get(key);
  if (id === undefined) {
    throw new Error(`seedBusinessNotes: unknown folder key "${key}".`);
  }
  return id;
}

function seedBusinessNotes(db: DatabaseHandle, ctx: DemoContext): void {
  const notes = new NoteStore(db, ctx.profileId);
  const org = new NoteOrgStore(db, ctx.profileId);
  const rnd = demoRandom("business-notes");

  const folderIds = new Map<string, string>();
  for (const folder of FOLDERS) {
    const created = org.createFolder(
      { parentId: null, name: folder.name, color: folder.color },
      stamp(ctx, rnd, folder.createdOffsetDays),
    );
    folderIds.set(folder.key, created.id);
  }

  const tagIds = new Map<string, string>();
  const resolveTag = (name: string, now: string): string => {
    const existing = tagIds.get(name);
    if (existing !== undefined) return existing;
    const tag = org.createTag(name, now);
    tagIds.set(name, tag.id);
    return tag.id;
  };

  for (const spec of NOTES) {
    const createdAt = stamp(ctx, rnd, spec.createdOffsetDays);
    // A note nobody revisited keeps ONE instant for both stamps, exactly as
    // `notes.ts` does for the same reason.
    const updatedAt =
      spec.revisitAfterDays === undefined
        ? createdAt
        : stamp(ctx, rnd, Math.min(0, spec.createdOffsetDays + spec.revisitAfterDays));

    const parsed = parseMarkdownNote(spec.body.trim(), "Beleška");
    const update = buildNoteUpdate(parsed.blocks);

    const note = notes.create(createdAt);
    notes.appendUpdate(note.id, update, parsed.title, updatedAt);
    notes.setFolder(note.id, requireFolderId(folderIds, spec.folderKey));
    if (spec.pinned === true) notes.setPinned(note.id, true);
    for (const tagName of spec.tags ?? []) {
      org.attachTag(note.id, resolveTag(tagName, updatedAt));
    }
    // Same fold `markdownImport.ts` runs after every import — see `notes.ts`'s
    // own doc for why this is what makes a demo note whole from its first byte.
    compactNow(notes, note.id);
  }
}

// =========================================================================
// FINANCE
// =========================================================================

/** How far back the ledger reaches — ~4 months, ending on `ctx.today`. */
const HISTORY_DAYS = 120;

/** RSD minor units for a whole-dinar amount. */
function rsd(dinars: number): number {
  return Math.round(dinars) * 100;
}

/** EUR minor units (cents) for a whole-euro amount. */
function eur(euros: number): number {
  return Math.round(euros) * 100;
}

/** `ctx.now`-derived instants, turned into the ISO-8601 date-time string every store's `now` wants. */
function iso(ms: number): string {
  return new Date(ms).toISOString();
}

interface DemoBizAccounts {
  currentId: string;
  eurId: string;
}

interface DemoBizCategories {
  fakture: string;
  konverzijaIncome: string;
  konverzijaExpense: string;
  hosting: string;
  knjigovodstvo: string;
  porezi: string;
  softver: string;
  putovanja: string;
  oprema: string;
  marketing: string;
  ostalo: string;
}

function seedBusinessAccounts(db: DatabaseHandle, ctx: DemoContext): DemoBizAccounts {
  const store = new FinAccountStore(db, ctx.profileId);
  const now = iso(ctx.now);

  const current = store.create(
    { name: "Poslovni tekući račun", kind: "current", currency: "RSD", openingBalance: rsd(180_000) },
    now,
  );
  const eurAccount = store.create(
    { name: "Devizni račun", kind: "current", currency: "EUR", openingBalance: eur(850) },
    now,
  );

  return { currentId: current.id, eurId: eurAccount.id };
}

/**
 * Eleven categories: two income (client invoices, currency conversion) and
 * nine expense. „Konverzija deviza" exists under BOTH kinds for the same
 * reason `finance.ts` creates „Pokloni" twice — see `seedBusinessTransactions`
 * for why a currency conversion is two ordinary categorized rows, never a
 * linked transfer.
 */
function seedBusinessCategories(db: DatabaseHandle, ctx: DemoContext): DemoBizCategories {
  const store = new FinCategoryStore(db, ctx.profileId);
  const now = iso(ctx.now);

  const income = (name: string): string => store.create({ name, kind: "income" }, now).id;
  const expense = (name: string): string => store.create({ name, kind: "expense" }, now).id;

  return {
    fakture: income("Fakture klijentima"),
    konverzijaIncome: income("Konverzija deviza"),
    konverzijaExpense: expense("Konverzija deviza"),
    hosting: expense("Hosting i domeni"),
    knjigovodstvo: expense("Knjigovodstvo"),
    porezi: expense("Porezi i doprinosi"),
    softver: expense("Softverske pretplate"),
    putovanja: expense("Putovanja"),
    oprema: expense("Oprema"),
    marketing: expense("Marketing"),
    ostalo: expense("Ostalo"),
  };
}

/**
 * Four fixed monthly costs — hosting, the accountant, self-employment
 * contributions and a EUR-denominated software subscription — opened
 * `HISTORY_DAYS` ago and charged forward to today in one `generateDue` pass,
 * the same mechanism `finance.ts` relies on for its own subscriptions.
 */
function seedBusinessRecurring(
  db: DatabaseHandle,
  ctx: DemoContext,
  accounts: DemoBizAccounts,
  categories: DemoBizCategories,
): void {
  const store = new FinRecurringStore(db, ctx.profileId);
  const now = iso(ctx.now);
  const startDate = demoDay(ctx, -HISTORY_DAYS);

  const monthly = (day: number): RecurrenceRule => ({
    freq: { kind: "monthly-date", interval: 1, day },
    end: { kind: "never" },
  });

  const rules: CreateFinRecurringInput[] = [
    {
      accountId: accounts.currentId,
      categoryId: categories.hosting,
      name: "Hosting i domeni",
      amount: -rsd(2_500),
      recurrence: monthly(3),
      startDate,
    },
    {
      accountId: accounts.currentId,
      categoryId: categories.knjigovodstvo,
      name: "Knjigovodstvo",
      amount: -rsd(9_000),
      recurrence: monthly(5),
      startDate,
    },
    {
      accountId: accounts.currentId,
      categoryId: categories.porezi,
      name: "Porezi i doprinosi",
      amount: -rsd(35_000),
      recurrence: monthly(15),
      startDate,
      reminderDays: 3,
    },
    {
      accountId: accounts.eurId,
      categoryId: categories.softver,
      name: "Softverske pretplate",
      amount: -eur(25),
      recurrence: monthly(20),
      startDate,
    },
  ];

  for (const rule of rules) store.create(rule, now);
  store.generateDue(now, ctx.today);
}

/**
 * The irregular half of the ledger: client invoices, travel, equipment,
 * marketing and the odd small cost, each hand-placed on a real day in the
 * `HISTORY_DAYS` window rather than drawn from a daily chance — a business's
 * invoicing rhythm is lumpy by nature, not a coin flip repeated every day.
 *
 * A currency conversion between the two accounts is deliberately TWO ordinary
 * transactions, one per account, never a linked transfer:
 * `FinTransactionStore.create` refuses a transfer whose two sides are not the
 * SAME currency (the RSD/EUR pair here never qualifies, and rightly so — the
 * store has no exchange rate to hold the two legs equal). Recording it as two
 * independently categorized rows is what a bank statement actually shows for
 * an FX conversion anyway: money leaving one account, an unrelated amount
 * arriving in the other.
 */
function seedBusinessTransactions(
  db: DatabaseHandle,
  ctx: DemoContext,
  rnd: DemoRandom,
  accounts: DemoBizAccounts,
  categories: DemoBizCategories,
): void {
  const store = new FinTransactionStore(db, ctx.profileId);
  const now = iso(ctx.now);

  const rsdSpend = (categoryId: string, offset: number, dinars: number, payee: string): void => {
    store.create(
      { accountId: accounts.currentId, categoryId, date: demoDay(ctx, offset), amount: -rsd(dinars), payee },
      now,
    );
  };
  const rsdIncome = (categoryId: string, offset: number, dinars: number, payee: string): void => {
    store.create(
      { accountId: accounts.currentId, categoryId, date: demoDay(ctx, offset), amount: rsd(dinars), payee },
      now,
    );
  };
  const eurSpend = (categoryId: string, offset: number, euros: number, payee: string): void => {
    store.create(
      { accountId: accounts.eurId, categoryId, date: demoDay(ctx, offset), amount: -eur(euros), payee },
      now,
    );
  };
  const eurIncome = (categoryId: string, offset: number, euros: number, payee: string): void => {
    store.create(
      { accountId: accounts.eurId, categoryId, date: demoDay(ctx, offset), amount: eur(euros), payee },
      now,
    );
  };

  // Incoming invoices — large and irregular, mostly RSD with two EUR payments
  // from a foreign client.
  rsdIncome(categories.fakture, -112, rnd.int(85_000, 110_000), "Delta d.o.o.");
  eurIncome(categories.fakture, -98, rnd.int(400, 500), "Nordic Client AB");
  rsdIncome(categories.fakture, -84, rnd.int(120_000, 160_000), "Vega studio");
  rsdIncome(categories.fakture, -63, rnd.int(65_000, 90_000), "Nimbus d.o.o.");
  eurIncome(categories.fakture, -45, rnd.int(550, 700), "Nordic Client AB");
  rsdIncome(categories.fakture, -30, rnd.int(180_000, 230_000), "Sunčani vrt");
  rsdIncome(categories.fakture, -10, rnd.int(110_000, 145_000), "Delta d.o.o.");

  // Travel — client visits and one conference.
  rsdSpend(categories.putovanja, -88, rnd.int(15_000, 22_000), "Put — sastanak sa klijentom, Novi Sad");
  rsdSpend(categories.putovanja, -55, rnd.int(28_000, 38_000), "DevBiz Beograd — kotizacija i prevoz");
  eurSpend(categories.putovanja, -20, rnd.int(120, 180), "Avionska karta — sastanak u inostranstvu");

  // Equipment — rare, larger one-offs.
  rsdSpend(categories.oprema, -70, rnd.int(75_000, 95_000), "Kupovina monitora");
  rsdSpend(categories.oprema, -8, rnd.int(25_000, 38_000), "Nova stolica za kancelariju");

  // Marketing — occasional.
  rsdSpend(categories.marketing, -77, rnd.int(12_000, 18_000), "Plaćeno oglašavanje na društvenim mrežama");
  rsdSpend(categories.marketing, -25, rnd.int(7_000, 11_000), "Vizit karte i flajeri");

  // Everything else, small and one-off.
  rsdSpend(categories.ostalo, -101, rnd.int(2_500, 4_000), "Poštarina i kancelarijski materijal");
  rsdSpend(categories.ostalo, -60, rnd.int(4_000, 6_500), "Bankarske provizije");

  // Two currency conversions — EUR earnings moved to RSD to cover local costs.
  eurSpend(categories.konverzijaExpense, -80, 200, "Konverzija u dinare");
  rsdIncome(categories.konverzijaIncome, -80, rnd.int(23_000, 24_000), "Konverzija iz evra");
  eurSpend(categories.konverzijaExpense, -33, 300, "Konverzija u dinare");
  rsdIncome(categories.konverzijaIncome, -33, rnd.int(34_500, 35_500), "Konverzija iz evra");
}

function seedBusinessFinance(db: DatabaseHandle, ctx: DemoContext): void {
  const rnd = demoRandom("business-finance");
  const accounts = seedBusinessAccounts(db, ctx);
  const categories = seedBusinessCategories(db, ctx);
  seedBusinessRecurring(db, ctx, accounts, categories);
  seedBusinessTransactions(db, ctx, rnd, accounts, categories);
}

// =========================================================================
// PEOPLE
// =========================================================================

/** One contact — always a literal `month`/`day` (CAL-007's yearless recurring fact), the role carried in `note`. */
interface DemoPersonSpec {
  readonly name: string;
  readonly kind: PersonKind;
  readonly month: number;
  readonly day: number;
  readonly year: number | null;
  readonly note: string;
}

// Clients, a freelance collaborator, the accountant and the lawyer — the
// people a solo consultancy actually deals with. Birthdays are invented but
// spread across the year, exactly as `people.ts` spreads its own; the last
// entry uses `kind: "anniversary"` for a business relationship's own start
// date, mirroring how `people.ts` tracks a couple's anniversary.
const PEOPLE: readonly DemoPersonSpec[] = [
  {
    name: "Nemanja Todorović",
    kind: "birthday",
    month: 3,
    day: 22,
    year: null,
    note: "Klijent — Delta d.o.o., kontakt osoba za projekte",
  },
  {
    name: "Milica Erić",
    kind: "birthday",
    month: 6,
    day: 5,
    year: null,
    note: "Klijentkinja — Vega studio, vlasnica agencije",
  },
  {
    name: "Filip Kovačević",
    kind: "birthday",
    month: 9,
    day: 14,
    year: null,
    note: "Klijent — Nimbus d.o.o., product menadžer",
  },
  {
    name: "Jelena Anđelić",
    kind: "birthday",
    month: 11,
    day: 30,
    year: null,
    note: "Klijentkinja — Sunčani vrt, marketing",
  },
  {
    name: "Aleksandar Simić",
    kind: "birthday",
    month: 2,
    day: 8,
    year: null,
    note: "Frilens saradnik — dizajn",
  },
  {
    name: "Tijana Radovanović",
    kind: "birthday",
    month: 7,
    day: 19,
    year: null,
    note: "Knjigovotkinja",
  },
  {
    name: "Nenad Popović",
    kind: "birthday",
    month: 4,
    day: 27,
    year: null,
    note: "Advokat — ugovori i pravna podrška",
  },
  {
    name: "Delta d.o.o.",
    kind: "anniversary",
    month: 10,
    day: 1,
    year: 2024,
    note: "Godišnjica prvog ugovora o saradnji",
  },
];

function seedBusinessPeople(db: DatabaseHandle, ctx: DemoContext): void {
  const store = new PeopleStore(db, ctx.profileId);
  const nowIso = new Date(ctx.now).toISOString();

  for (const spec of PEOPLE) {
    const input: CreatePersonInput = {
      name: spec.name,
      kind: spec.kind,
      month: spec.month,
      day: spec.day,
      year: spec.year,
      note: spec.note,
    };
    store.create(input, nowIso);
  }
}

// =========================================================================
// DOCUMENTS
// =========================================================================

/** Same shape as `documents.ts`'s own spec: a sequence of expiry dates, oldest first — see that file's doc for the full mechanics. */
interface DemoDocumentSpec {
  readonly docType: DocumentType;
  readonly label: string;
  readonly notes: string | null;
  readonly expiryOffsets: readonly [number, ...number[]];
}

const DOCUMENTS: readonly DemoDocumentSpec[] = [
  // Renewed once; the current expiry sits inside the 30-day reminder window (`uskoro`).
  {
    docType: "custom",
    label: "Ugovor o zakupu poslovnog prostora",
    notes: "Produžava se sa zakupodavcem na godinu dana.",
    expiryOffsets: [-345, 20],
  },
  // A single entry whose expiry has already passed — the renegotiation that has not happened yet (`istekao`).
  {
    docType: "custom",
    label: "Ugovor o saradnji — Vega studio",
    notes: "Okvirni ugovor za tekuće i buduće projekte; renegocijacija u toku.",
    expiryOffsets: [-10],
  },
  // Renewed once; twelve days from its own expiry (`uskoro`).
  {
    docType: "polisa",
    label: "Polisa poslovnog osiguranja",
    notes: "Osiguranje opreme i profesionalne odgovornosti.",
    expiryOffsets: [-353, 12],
  },
  // Renewed once; comfortably valid (`ok`) — the qualified certificate a Serbian freelancer needs to issue e-fakture.
  {
    docType: "custom",
    label: "Sertifikat za elektronsko fakturisanje",
    notes: "Kvalifikovani sertifikat neophodan za izdavanje e-faktura.",
    expiryOffsets: [-30, 700],
  },
  // A single entry, comfortably valid (`ok`).
  {
    docType: "kartica",
    label: "Poslovna platna kartica",
    notes: null,
    expiryOffsets: [850],
  },
];

function seedBusinessDocuments(db: DatabaseHandle, ctx: DemoContext): void {
  const store = new DocumentStore(db, ctx.profileId);

  for (const spec of DOCUMENTS) {
    const [firstOffset, ...renewalOffsets] = spec.expiryOffsets;
    const created = store.create({
      docType: spec.docType,
      label: spec.label,
      expiryDate: demoDay(ctx, firstOffset),
      notes: spec.notes,
    });

    for (const offset of renewalOffsets) {
      store.renew(created.id, demoDay(ctx, offset));
    }
  }
}

// =========================================================================
// Orchestrator
// =========================================================================

/**
 * Fills `ctx.profileId` with a complete, believable BUSINESS working life —
 * TASK, CALENDAR, NOTES, FINANCE, PEOPLE and DOCUMENTS, in that order.
 *
 * Order matters in exactly one place — `seedBusinessTasks` must run before
 * anything else, because it is the only module that mints the profile's
 * Inbox (`TaskListStore.ensureInbox`), which `TaskStore` requires to exist
 * before it can place a task. Every other module is independent by
 * construction: each draws from its own named `demoRandom` stream, so the
 * result does not depend on which one ran first.
 */
export function seedDemoBusinessProfile(db: DatabaseHandle, ctx: DemoContext): void {
  seedBusinessTasks(db, ctx);
  seedBusinessCalendar(db, ctx);
  seedBusinessNotes(db, ctx);
  seedBusinessFinance(db, ctx);
  seedBusinessPeople(db, ctx);
  seedBusinessDocuments(db, ctx);
}
