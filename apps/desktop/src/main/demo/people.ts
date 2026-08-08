import type Database from "better-sqlite3-multiple-ciphers";
import { PeopleStore } from "@nexus/db";
import type { CreatePersonInput, PersonKind } from "@nexus/db";
import { demoDay } from "./context.js";
import type { DemoContext } from "./context.js";

type DatabaseHandle = Database.Database;

/**
 * One entry in the hand-curated guest list below. `month`/`day` are literal
 * (this is CAL-007's yearless recurring fact, same as `Person` itself) except
 * for the three carrying `upcomingInDays`, whose date is instead computed
 * from `ctx.today` at seed time — see `resolveDate` — so the „upcoming
 * birthdays" surface always has something in it regardless of what day the
 * demo profile happens to be created on.
 */
interface DemoPersonSpec {
  name: string;
  kind: PersonKind;
  year: number | null;
  note: string | null;
  month?: number;
  day?: number;
  /** Days from today (0-14) — replaces `month`/`day` when present. */
  upcomingInDays?: number;
}

// A curated address book for a Belgrade student/young professional: family,
// friends, faculty colleagues, and professors — the four groups CAL's people
// surfaces group by. Birthdays are spread across the whole year (`month`/`day`
// below is fixed, not random, so the calendar view reads as a real, lived-in
// address book rather than a statistically even scatter); three fall in the
// next two weeks so the „uskoro rođendan" surface has something to show.
const PEOPLE: readonly DemoPersonSpec[] = [
  // --- Porodica ---------------------------------------------------------
  { name: "Ana Stanković", kind: "birthday", year: 1968, note: "Majka", month: 3, day: 14 },
  { name: "Dragan Stanković", kind: "birthday", year: 1965, note: "Otac", month: 11, day: 2 },
  { name: "Jovana Stanković", kind: "birthday", year: 1998, note: "Sestra", month: 6, day: 21 },
  { name: "Marko Stanković", kind: "birthday", year: 2001, note: "Brat", upcomingInDays: 9 },
  {
    name: "Ana i Dragan Stanković",
    kind: "anniversary",
    year: 1993,
    note: "Godišnjica braka roditelja",
    month: 9,
    day: 4,
  },
  { name: "Bojan Stanković", kind: "birthday", year: 1962, note: "Stric", month: 1, day: 27 },
  { name: "Milena Stanković", kind: "birthday", year: 1970, note: "Tetka", month: 8, day: 16 },

  // --- Prijatelji ---------------------------------------------------------
  { name: "Nikola Jovanović", kind: "birthday", year: 1999, note: "Drug iz srednje škole", upcomingInDays: 4 },
  { name: "Ivana Petrović", kind: "birthday", year: 2000, note: "Prijateljica sa fakulteta", month: 5, day: 30 },
  { name: "Petar Đorđević", kind: "birthday", year: 1999, note: "Drug iz osnovne škole", month: 12, day: 8 },
  { name: "Milica Radović", kind: "birthday", year: 2000, note: "Najbolja drugarica", upcomingInDays: 12 },
  { name: "Aleksandar Nikolić", kind: "birthday", year: 1998, note: null, month: 4, day: 19 },
  {
    name: "Teodora i Filip",
    kind: "anniversary",
    year: 2021,
    note: "Godišnjica veze",
    month: 7,
    day: 11,
  },

  // --- Kolege ---------------------------------------------------------
  { name: "Jelena Marković", kind: "birthday", year: 1997, note: "Koleginica sa prakse", month: 2, day: 25 },
  { name: "Stefan Ilić", kind: "birthday", year: 1995, note: "Kolega iz tima", month: 10, day: 5 },
  { name: "Tamara Vasić", kind: "birthday", year: 1996, note: null, month: 6, day: 3 },
  { name: "Nemanja Popović", kind: "birthday", year: 1994, note: "Kolega, front-end", month: 3, day: 29 },
  { name: "Sara Kostić", kind: "birthday", year: 1993, note: "Product menadžerka", month: 9, day: 17 },

  // --- Profesori ---------------------------------------------------------
  {
    name: "Prof. dr Vladimir Simić",
    kind: "birthday",
    year: 1972,
    note: "Profesor — Algoritmi i strukture podataka",
    month: 1,
    day: 9,
  },
  {
    name: "Prof. dr Milena Backović",
    kind: "birthday",
    year: 1978,
    note: "Profesorka — Baze podataka",
    month: 11,
    day: 23,
  },
  {
    name: "Doc. dr Nikola Tomić",
    kind: "birthday",
    year: 1985,
    note: "Asistent — Veštačka inteligencija",
    month: 5,
    day: 12,
  },
  {
    name: "Prof. dr Zoran Radulović",
    kind: "birthday",
    year: 1968,
    note: "Profesor — Softversko inženjerstvo",
    month: 12,
    day: 30,
  },
];

/** Populates ~20 people through `PeopleStore.create` — CAL-007's address book, ready to browse on first run. */
export function seedDemoPeople(db: DatabaseHandle, ctx: DemoContext): void {
  const store = new PeopleStore(db, ctx.profileId);
  const nowIso = new Date(ctx.now).toISOString();

  for (const spec of PEOPLE) {
    const { month, day } = resolveDate(ctx, spec);
    const input: CreatePersonInput = { name: spec.name, kind: spec.kind, month, day, year: spec.year, note: spec.note };
    store.create(input, nowIso);
  }
}

/** A spec's `month`/`day`, either literal or derived from `ctx.today + upcomingInDays` (never `Date.now`). */
function resolveDate(ctx: DemoContext, spec: DemoPersonSpec): { month: number; day: number } {
  if (spec.upcomingInDays !== undefined) {
    const parts = demoDay(ctx, spec.upcomingInDays).split("-").map(Number);
    const month = parts[1];
    const day = parts[2];
    if (month === undefined || day === undefined) {
      throw new Error(`demoDay produced an unparseable day key for offset ${spec.upcomingInDays}`);
    }
    return { month, day };
  }
  if (spec.month === undefined || spec.day === undefined) {
    throw new Error(`Demo person "${spec.name}" has neither a literal date nor "upcomingInDays".`);
  }
  return { month: spec.month, day: spec.day };
}
