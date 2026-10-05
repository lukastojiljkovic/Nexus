/**
 * Demo seed for the CALENDAR module.
 *
 * ~76 events across a twelve-week window (six back, six forward), built from
 * three layers: a handful of RECURRING masters for the weekly rhythm a real
 * timetable has (lectures, a work focus block, the gym — ADR-024 expands
 * these virtually, so four rows already fill dozens of slots); a small set of
 * hand-placed one-offs for today, the multi-day trips and the weekend
 * all-day entries the brief calls for by name; and a large pool of templated
 * one-offs (appointments, socials, errands) scattered with extra density
 * around the current week. Everything goes through `EventStore` /
 * `CalendarSettingsStore`, the same stores the renderer's IPC handlers use.
 *
 * Today is deliberately EXCEPTED (`addRecurrenceExdate`) from every recurring
 * master before its own dedicated events are added: without that, whether
 * today already shows 0-2 recurring slots depends on which weekday the demo
 * happens to be seeded on, and the "3-5 events, morning and evening" brief
 * has to hold on every day of the week, not just the ones a lecture falls on.
 */

import type { RecurrenceRule, RecurrenceWeekday } from "@nexus/core";
import {
  CalendarSettingsStore,
  EventStore,
  EventTemplateStore,
  type CreateEventInput,
  type EventTemplatePayload,
} from "@nexus/db";
import {
  demoAt,
  demoDay,
  demoRandom,
  minutes,
  type DatabaseHandle,
  type DemoContext,
  type DemoRandom,
} from "./context.js";

/**
 * English titles, descriptions and locations for the demo calendar, keyed by
 * the Serbian text the scene above uses. Categories ("posao", "zdravlje",
 * "lično", "društveno", "fakultet") are stored values the UI maps to its own
 * labels, so they are not translated here.
 */
const EN: Readonly<Record<string, string>> = {
  "Predavanje: Mašinsko učenje": "Lecture: Machine Learning",
  "Neuronske mreže i unazadna propagacija.": "Neural networks and backpropagation.",
  "Vežbe: Baze podataka": "Exercises: Databases",
  "Fokus blok — posao": "Focus block — work",
  "Duboki rad — bez sastanaka.": "Deep work — no meetings.",
  Teretana: "Gym",
  "Jutarnje trčanje": "Morning run",
  "Konsultacije kod profesora": "Office hours with the professor",
  "Ručak sa kolegom sa posla": "Lunch with a colleague from work",
  "Večera sa prijateljima": "Dinner with friends",
  "Video poziv sa porodicom": "Video call with the family",
  "Vikend kod roditelja": "Weekend at my parents'",
  "Sajam knjiga": "Book fair",
  "Obilazak štandova i kupovina knjiga za fakultet.":
    "Visiting the stands and buying books for university.",
  "Poseta rodbini": "Visiting relatives",
  "Rođendanska proslava kod prijatelja": "A friend's birthday party",
  "Sastanak tima": "Team meeting",
  "Nedeljni pregled zaduženja i blokera.": "The weekly review of assignments and blockers.",
  "Pregled koda sa kolegom": "Code review with a colleague",
  "Poziv sa klijentom": "Call with the client",
  "Kafa sa Anom": "Coffee with Ana",
  "Ručak sa bivšim kolegama": "Lunch with former colleagues",
  "Večera kod Marka": "Dinner at Marko's",
  "Gledanje utakmice": "Watching the match",
  "Rođendan kolege — druženje": "A colleague's birthday — get-together",
  "Iznenađenje posle posla.": "A surprise after work.",
  "Zubar — kontrolni pregled": "Dentist — check-up",
  Frizer: "Hairdresser",
  "Servis automobila": "Car service",
  "Preuzimanje paketa iz pošte": "Collecting a parcel from the post office",
  "Konsultacije na fakultetu": "Office hours at the university",
  "Pitanja oko teme diplomskog.": "Questions about the thesis topic.",
  "Rad na seminarskom u biblioteci": "Working on the term paper in the library",
  "Grupni projekat — sastanak tima": "Group project — team meeting",
  "Predavanje gostujućeg profesora": "Guest professor's lecture",
  "Individualni trening": "Personal training session",
  "Trčanje u parku": "Run in the park",
  Joga: "Yoga",
  "Video poziv sa roditeljima": "Video call with my parents",
  "Priprema prezentacije": "Preparing a presentation",
  "Kvartalni pregled za tim.": "The quarterly review for the team.",
  "Telefonski intervju": "Phone interview",
  "Pitanja oko seminarskog rada.": "Questions about the term paper.",
  "Konferencija — DevConf Beograd": "Conference — DevConf Belgrade",
  "Dva dana predavanja i radionica o distribuiranim sistemima.":
    "Two days of talks and workshops on distributed systems.",
  "Letovanje sa ekipom": "Summer holiday with the crew",
  "Nedelju dana na moru sa drugovima sa fakulteta.":
    "A week by the sea with friends from university.",
  "Vikend izlet na planinu": "Weekend trip to the mountains",
  "Amfiteatar 2": "Lecture hall 2",
  "Sala 305": "Room 305",
  "Teretana centar": "City gym",
  "Kabinet 214": "Office 214",
  "Restoran Salaš": "Restaurant Salaš",
  "Sala za sastanke": "Meeting room",
  "Stomatološka ordinacija": "Dental practice",
  "Auto servis Milić": "Milić car service",
  "Univerzitetska biblioteka": "University library",
};

/** The seeded text for the active locale. */
function text(ctx: DemoContext, sr: string): string {
  return ctx.locale === "en" ? (EN[sr] ?? sr) : sr;
}

// --- Recurring weekly rhythm ------------------------------------------

interface RecurringMasterSeed {
  readonly title: string;
  readonly hour: number;
  readonly minute: number;
  readonly durationMinutes: number;
  readonly days: readonly RecurrenceWeekday[];
  readonly interval: number;
  /** True for the two university courses, whose series ends with the semester. */
  readonly untilSemesterEnd?: true;
  readonly category: string;
  readonly location?: string;
  readonly description?: string;
}

const RECURRING_MASTERS: readonly RecurringMasterSeed[] = [
  {
    title: "Predavanje: Mašinsko učenje",
    hour: 10,
    minute: 0,
    durationMinutes: 90,
    days: [0], // Monday
    interval: 1,
    untilSemesterEnd: true,
    category: "fakultet",
    location: "Amfiteatar 2",
    description: "Neuronske mreže i unazadna propagacija.",
  },
  {
    title: "Vežbe: Baze podataka",
    hour: 12,
    minute: 0,
    durationMinutes: 90,
    days: [2], // Wednesday
    interval: 1,
    untilSemesterEnd: true,
    category: "fakultet",
    location: "Sala 305",
  },
  {
    title: "Fokus blok — posao",
    hour: 9,
    minute: 0,
    durationMinutes: 240,
    days: [1, 3], // Tuesday, Thursday
    interval: 1,
    category: "posao",
    description: "Duboki rad — bez sastanaka.",
  },
  {
    title: "Teretana",
    hour: 19,
    minute: 0,
    durationMinutes: 60,
    days: [0, 2, 4], // Monday, Wednesday, Friday
    interval: 1,
    category: "zdravlje",
    location: "Teretana centar",
  },
];

// --- Today's own events -------------------------------------------------
//
// Hand-placed rather than left to chance, so "today" reliably carries a
// morning-through-evening spread whatever weekday the seeding run lands on.

interface TodayEventSeed {
  readonly title: string;
  readonly hour: number;
  readonly minute: number;
  readonly durationMinutes: number;
  readonly category: string;
  readonly location?: string;
}

const TODAY_EVENTS: readonly TodayEventSeed[] = [
  { title: "Jutarnje trčanje", hour: 7, minute: 30, durationMinutes: 45, category: "zdravlje" },
  {
    title: "Konsultacije kod profesora",
    hour: 11,
    minute: 0,
    durationMinutes: 90,
    category: "fakultet",
    location: "Kabinet 214",
  },
  {
    title: "Ručak sa kolegom sa posla",
    hour: 13,
    minute: 0,
    durationMinutes: 60,
    category: "posao",
  },
  {
    title: "Večera sa prijateljima",
    hour: 19,
    minute: 0,
    durationMinutes: 90,
    category: "društveno",
    location: "Restoran Salaš",
  },
  {
    title: "Video poziv sa porodicom",
    hour: 21,
    minute: 0,
    durationMinutes: 45,
    category: "lično",
  },
];

// --- Multi-day and all-day one-offs ---------------------------------------

/** Genuinely all-day, single-day entries — the weekend rhythm a lived-in calendar has. */
interface AllDayEventSeed {
  readonly title: string;
  readonly weeksAway: number;
  readonly category: string;
  readonly description?: string;
}

// --- Weekday & weekend placement helpers ------------------------------

/** Monday-first weekday of the date `offset` days from today (0 = Monday … 6 = Sunday) — the recurrence engine's own convention. */
function weekdayOf(ctx: DemoContext, offset: number): number {
  const anchor = new Date(ctx.now);
  const day = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate() + offset,
  ).getDay();
  return (day + 6) % 7;
}

/**
 * The offset of the Saturday in the week `weeksAway` from this one (0 = this
 * week's Saturday, negative = a past weekend). Used so a "weekend" seed lands
 * on a real Saturday whatever weekday the run happens to start on, rather
 * than a hand-picked offset that only works for one particular "today".
 */
function saturdayOffset(ctx: DemoContext, weeksAway: number): number {
  return weeksAway * 7 + (5 - weekdayOf(ctx, 0));
}

const ALL_DAY_EVENTS: readonly AllDayEventSeed[] = [
  { title: "Vikend kod roditelja", weeksAway: -5, category: "lično" },
  {
    title: "Sajam knjiga",
    weeksAway: -1,
    category: "lično",
    description: "Obilazak štandova i kupovina knjiga za fakultet.",
  },
  { title: "Poseta rodbini", weeksAway: 2, category: "lično" },
  { title: "Rođendanska proslava kod prijatelja", weeksAway: 4, category: "društveno" },
];

// --- Templated filler ----------------------------------------------------
//
// Appointments, socials and errands, reused across the window the way a real
// calendar repeats them (the same dentist, the same coffee habit) without
// being a `recurrence` series. Placement — which day, which exact time
// within the template's plausible range — is drawn from the seeded stream,
// biased toward the current week so the week/month views both read as busy.

interface EventTemplate {
  readonly title: string;
  readonly category: string;
  readonly durationMinutes: number;
  /** Inclusive hour bounds the start time is drawn from. */
  readonly hourRange: readonly [number, number];
  readonly weekdaysOnly: boolean;
  readonly location?: string;
  readonly description?: string;
}

const EVENT_TEMPLATES: readonly EventTemplate[] = [
  {
    title: "Sastanak tima",
    category: "posao",
    durationMinutes: 60,
    hourRange: [11, 13],
    weekdaysOnly: true,
    location: "Sala za sastanke",
    description: "Nedeljni pregled zaduženja i blokera.",
  },
  {
    title: "Pregled koda sa kolegom",
    category: "posao",
    durationMinutes: 45,
    hourRange: [14, 16],
    weekdaysOnly: true,
  },
  {
    title: "Poziv sa klijentom",
    category: "posao",
    durationMinutes: 45,
    hourRange: [9, 10],
    weekdaysOnly: true,
  },
  {
    title: "Kafa sa Anom",
    category: "društveno",
    durationMinutes: 45,
    hourRange: [15, 17],
    weekdaysOnly: false,
  },
  {
    title: "Ručak sa bivšim kolegama",
    category: "društveno",
    durationMinutes: 90,
    hourRange: [12, 13],
    weekdaysOnly: false,
  },
  {
    title: "Večera kod Marka",
    category: "društveno",
    durationMinutes: 90,
    hourRange: [19, 20],
    weekdaysOnly: false,
  },
  {
    title: "Gledanje utakmice",
    category: "društveno",
    durationMinutes: 90,
    hourRange: [20, 21],
    weekdaysOnly: false,
  },
  {
    title: "Rođendan kolege — druženje",
    category: "društveno",
    durationMinutes: 90,
    hourRange: [19, 20],
    weekdaysOnly: false,
    description: "Iznenađenje posle posla.",
  },
  {
    title: "Zubar — kontrolni pregled",
    category: "lično",
    durationMinutes: 45,
    hourRange: [9, 10],
    weekdaysOnly: true,
    location: "Stomatološka ordinacija",
  },
  {
    title: "Frizer",
    category: "lično",
    durationMinutes: 45,
    hourRange: [14, 16],
    weekdaysOnly: false,
  },
  {
    title: "Servis automobila",
    category: "lično",
    durationMinutes: 60,
    hourRange: [8, 9],
    weekdaysOnly: true,
    location: "Auto servis Milić",
  },
  {
    title: "Preuzimanje paketa iz pošte",
    category: "lično",
    durationMinutes: 45,
    hourRange: [12, 14],
    weekdaysOnly: true,
  },
  {
    title: "Konsultacije na fakultetu",
    category: "fakultet",
    durationMinutes: 60,
    hourRange: [9, 11],
    weekdaysOnly: true,
    location: "Kabinet 214",
    description: "Pitanja oko teme diplomskog.",
  },
  {
    title: "Rad na seminarskom u biblioteci",
    category: "fakultet",
    durationMinutes: 240,
    hourRange: [12, 13],
    weekdaysOnly: false,
    location: "Univerzitetska biblioteka",
  },
  {
    title: "Grupni projekat — sastanak tima",
    category: "fakultet",
    durationMinutes: 60,
    hourRange: [14, 16],
    weekdaysOnly: true,
  },
  {
    title: "Predavanje gostujućeg profesora",
    category: "fakultet",
    durationMinutes: 90,
    hourRange: [11, 12],
    weekdaysOnly: true,
  },
  {
    title: "Individualni trening",
    category: "zdravlje",
    durationMinutes: 60,
    hourRange: [18, 19],
    weekdaysOnly: false,
  },
  {
    title: "Trčanje u parku",
    category: "zdravlje",
    durationMinutes: 45,
    hourRange: [7, 8],
    weekdaysOnly: false,
  },
  {
    title: "Joga",
    category: "zdravlje",
    durationMinutes: 60,
    hourRange: [18, 19],
    weekdaysOnly: false,
  },
  {
    title: "Video poziv sa roditeljima",
    category: "lično",
    durationMinutes: 45,
    hourRange: [20, 21],
    weekdaysOnly: false,
  },
  {
    title: "Priprema prezentacije",
    category: "posao",
    durationMinutes: 240,
    hourRange: [9, 10],
    weekdaysOnly: true,
    description: "Kvartalni pregled za tim.",
  },
  {
    title: "Telefonski intervju",
    category: "posao",
    durationMinutes: 45,
    hourRange: [9, 10],
    weekdaysOnly: true,
  },
];

/** How many templated filler events to place — the bulk of the ~76-row total. */
const FILLER_EVENT_COUNT = 60;

// --- Saved templates (CAL-009) --------------------------------------------
//
// NOT the `EventTemplate` above, which is this file's own filler recipe and
// never leaves it. These are the real feature: rows in `event_templates` that
// the „Šabloni" popover lists and applies to whichever day the user is looking
// at.
//
// Seeded because the popover has been photographed empty for as long as the
// sweep has been able to reach it, and a demo profile that never exercises a
// shipped feature shows its empty state as though that were the surface. Three
// is the number that makes the list read as a LIST — one row cannot show
// alphabetical order, and the popover's own scroll is not what this is testing.
//
// A template carries no date on purpose (the store's `apply` phases it onto the
// caller's day), so what belongs here is the shape of a thing you arrange
// again and again rather than a thing that repeats on a schedule. One of the
// three carries a rule anyway — „Sastanak tima" is weekly wherever it lands —
// because a captured recurrence is stored UNANCHORED, and a seed that never
// held one would leave that half of CAL-009 undemonstrated.
const SAVED_TEMPLATES: readonly {
  readonly name: string;
  readonly payload: EventTemplatePayload;
}[] = [
  {
    name: "Individualni trening",
    payload: {
      title: "Individualni trening",
      allDay: false,
      startTime: "18:30",
      durationMinutes: 75,
      location: "Teretana centar",
      description: null,
      category: "zdravlje",
      reminderOffsets: [30],
      recurrence: null,
    },
  },
  {
    name: "Konsultacije kod profesora",
    payload: {
      title: "Konsultacije kod profesora",
      allDay: false,
      startTime: "12:00",
      durationMinutes: 30,
      location: "Kabinet 214",
      description: "Pitanja oko seminarskog rada.",
      category: "fakultet",
      reminderOffsets: [10, 60],
      recurrence: null,
    },
  },
  {
    name: "Sastanak tima",
    payload: {
      title: "Sastanak tima",
      allDay: false,
      startTime: "09:30",
      durationMinutes: 60,
      location: "Sala za sastanke",
      description: "Nedeljni pregled zaduženja i blokera.",
      category: "posao",
      reminderOffsets: [10],
      // Monday, and unanchored: applied to a Thursday this means „weekly from
      // that Thursday", which is the whole point of storing the rule without
      // the day it was captured on.
      recurrence: { freq: { kind: "weekly", interval: 1, days: [0] }, end: { kind: "never" } },
    },
  },
];

// --- Seeding engine ----------------------------------------------------

function createRecurringMaster(
  ctx: DemoContext,
  events: EventStore,
  semesterEnd: string,
  seed: RecurringMasterSeed,
): void {
  // A weekly rule's phase does not depend on the anchor's own weekday (see
  // `recurrence.ts`'s `weeklySeries`), so any recent reference point works —
  // two weeks back keeps every master comfortably inside the demo's own
  // "six weeks back" window without needing to compute the exact weekday.
  const startMs = demoAt(ctx, -14, seed.hour, seed.minute);
  const rule: RecurrenceRule = {
    freq: { kind: "weekly", interval: seed.interval, days: [...seed.days] },
    end: seed.untilSemesterEnd === true ? { kind: "until", date: semesterEnd } : { kind: "never" },
  };
  const input: CreateEventInput = {
    title: text(ctx, seed.title),
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(startMs + minutes(seed.durationMinutes)).toISOString(),
    category: seed.category,
    recurrence: rule,
    ...(seed.location !== undefined ? { location: text(ctx, seed.location) } : {}),
    ...(seed.description !== undefined ? { description: text(ctx, seed.description) } : {}),
  };
  const created = events.create(input);
  // Today is handled by its own dedicated, hand-placed events below — see the
  // file doc for why a coincidental recurring occurrence would break the
  // "3-5 events, morning and evening" guarantee on some weekdays and not others.
  events.addRecurrenceExdate(created.id, ctx.today, new Date(ctx.now).toISOString());
}

function createTodayEvent(ctx: DemoContext, events: EventStore, seed: TodayEventSeed): void {
  const startMs = demoAt(ctx, 0, seed.hour, seed.minute);
  const input: CreateEventInput = {
    title: text(ctx, seed.title),
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(startMs + minutes(seed.durationMinutes)).toISOString(),
    category: seed.category,
    ...(seed.location !== undefined ? { location: text(ctx, seed.location) } : {}),
  };
  events.create(input);
}

interface MultiDaySeed {
  readonly title: string;
  readonly category: string;
  readonly description?: string;
}

function createMultiDayEvent(
  ctx: DemoContext,
  events: EventStore,
  startOffset: number,
  endOffset: number,
  seed: MultiDaySeed,
): void {
  const input: CreateEventInput = {
    title: text(ctx, seed.title),
    startAt: demoDay(ctx, startOffset),
    endAt: demoDay(ctx, endOffset),
    allDay: true,
    category: seed.category,
    ...(seed.description !== undefined ? { description: text(ctx, seed.description) } : {}),
  };
  events.create(input);
}

function createAllDayEvent(ctx: DemoContext, events: EventStore, seed: AllDayEventSeed): void {
  const input: CreateEventInput = {
    title: text(ctx, seed.title),
    startAt: demoDay(ctx, saturdayOffset(ctx, seed.weeksAway)),
    allDay: true,
    category: seed.category,
    ...(seed.description !== undefined ? { description: text(ctx, seed.description) } : {}),
  };
  events.create(input);
}

/**
 * A day offset for a filler event, biased toward the current week: 45% of
 * placements land within three days of today, the rest spread across the
 * remaining ten weeks of the window — the density gradient a lived-in
 * calendar has, busiest around "now" and thinner the further out it goes.
 */
function fillerOffset(rnd: DemoRandom): number {
  if (rnd.chance(0.45)) return rnd.int(-3, 3);
  const far = rnd.int(4, 42);
  return rnd.chance(0.5) ? -far : far;
}

const FILLER_MINUTES = [0, 15, 30, 45] as const;

function placeFillerEvent(
  ctx: DemoContext,
  rnd: DemoRandom,
  events: EventStore,
  template: EventTemplate,
): void {
  // Re-drawn (never adjusted) until it clears both guards: never today — that
  // slot is already fully specified above — and, for a weekday-only template,
  // never a weekend. A fresh draw each attempt keeps this reproducible and
  // terminates quickly, since five of every seven days qualify.
  let offset = fillerOffset(rnd);
  while (offset === 0 || (template.weekdaysOnly && weekdayOf(ctx, offset) >= 5)) {
    offset = fillerOffset(rnd);
  }
  const hour = rnd.int(template.hourRange[0], template.hourRange[1]);
  const minute = rnd.of(FILLER_MINUTES);
  const startMs = demoAt(ctx, offset, hour, minute);

  const input: CreateEventInput = {
    title: text(ctx, template.title),
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(startMs + minutes(template.durationMinutes)).toISOString(),
    category: template.category,
    ...(template.location !== undefined ? { location: text(ctx, template.location) } : {}),
    ...(template.description !== undefined
      ? { description: text(ctx, template.description) }
      : {}),
  };
  events.create(input);
}

export function seedDemoCalendar(db: DatabaseHandle, ctx: DemoContext): void {
  const rnd = demoRandom("calendar");
  const events = new EventStore(db, ctx.profileId);
  const settings = new CalendarSettingsStore(db, ctx.profileId);

  // A ~16-week term straddling today, so the Semestar view (ADR-054) has a
  // real range to anchor on — and the two lecture series end exactly when it does.
  const semesterStart = demoDay(ctx, -45);
  const semesterEnd = demoDay(ctx, 70);
  settings.save({ semesterStart, semesterEnd });

  for (const seed of RECURRING_MASTERS) {
    createRecurringMaster(ctx, events, semesterEnd, seed);
  }

  for (const seed of TODAY_EVENTS) {
    createTodayEvent(ctx, events, seed);
  }

  createMultiDayEvent(ctx, events, -18, -17, {
    title: "Konferencija — DevConf Beograd",
    category: "posao",
    description: "Dva dana predavanja i radionica o distribuiranim sistemima.",
  });
  {
    // A full week (Saturday through the following Friday), four weeks out —
    // still comfortably inside the ±42-day seeding window.
    const start = saturdayOffset(ctx, 4);
    createMultiDayEvent(ctx, events, start, start + 6, {
      title: "Letovanje sa ekipom",
      category: "lično",
      description: "Nedelju dana na moru sa drugovima sa fakulteta.",
    });
  }
  {
    // A weekend getaway plus a bonus Monday off — the "half-day/all-day mix"
    // brief's other multi-day entry, one week out.
    const start = saturdayOffset(ctx, 1);
    createMultiDayEvent(ctx, events, start, start + 2, {
      title: "Vikend izlet na planinu",
      category: "društveno",
    });
  }

  for (const seed of ALL_DAY_EVENTS) {
    createAllDayEvent(ctx, events, seed);
  }

  for (let i = 0; i < FILLER_EVENT_COUNT; i += 1) {
    placeFillerEvent(ctx, rnd, events, rnd.of(EVENT_TEMPLATES));
  }

  const templates = new EventTemplateStore(db, ctx.profileId);
  const now = new Date(ctx.now).toISOString();
  for (const seed of SAVED_TEMPLATES) {
    templates.saveByName(text(ctx, seed.name), translatePayload(ctx, seed.payload), now);
  }
}

/** A saved template's own text, in the run's language. */
function translatePayload(
  ctx: DemoContext,
  payload: EventTemplatePayload,
): EventTemplatePayload {
  if (ctx.locale !== "en") return payload;
  return {
    ...payload,
    title: text(ctx, payload.title),
    location: payload.location === null ? null : text(ctx, payload.location),
    description: payload.description === null ? null : text(ctx, payload.description),
  };
}
