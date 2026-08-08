/**
 * Demo content for HABIT (migration 055).
 *
 * Twelve habits, chosen to exercise every schedule shape `validateHabitSchedule`
 * accepts — there are exactly two kinds (`days`, `quota`; see
 * `packages/core/src/habits/habitSchedule.ts`), and this file seeds both, with
 * `days` further split into „every day", „a few named weekdays" and „weekend
 * only" so the schedule picker's whole range is represented. Six habits are
 * target-less (a plain „uradio/nisam" tick) and six carry a numeric target, so
 * the wall's partial-fill rendering has something to draw.
 *
 * The point of this seed is TEXTURE, not volume: a uniform 80%-everywhere
 * history would look synthetic on the habit wall. Each habit below is written
 * as a small persona — a long unbroken streak, a habit that collapsed a month
 * ago, one only three weeks old, one stuck at a mediocre adherence with visible
 * gaps — because that mix is what a wall somebody has actually kept for six
 * months looks like.
 */

import { HabitStore } from "@nexus/db";
import type { HabitSchedule } from "@nexus/core";
import {
  demoAt,
  demoDay,
  demoRandom,
  type DatabaseHandle,
  type DemoContext,
  type DemoRandom,
} from "./context.js";

// The colour palette this habit gets on the wall — the same eight swatches a
// note folder picks from (`HabitStore`'s own `color` field reuses it rather
// than growing a second palette). Cycled by creation order rather than drawn
// from the RNG: which swatch a habit gets is cosmetic, not content, and cycling
// keeps twelve habits visually distinct without spending a random draw on it.
const HABIT_COLORS = [
  "bronza",
  "zlato",
  "suma",
  "zad",
  "grafit",
  "bordo",
  "maslina",
  "ruza",
] as const;

const DAILY: HabitSchedule = { kind: "days", weekdays: [1, 2, 3, 4, 5, 6, 7] };
const MON_WED_FRI: HabitSchedule = { kind: "days", weekdays: [1, 3, 5] };
const WEEKDAYS: HabitSchedule = { kind: "days", weekdays: [1, 2, 3, 4, 5] };
const WEEKEND: HabitSchedule = { kind: "days", weekdays: [6, 7] };

/** One habit's shape and the persona that fills its history. */
interface HabitSeed {
  readonly name: string;
  readonly schedule: HabitSchedule;
  /** Present together, or not at all — `HabitStore.resolve`'s own rule. */
  readonly target?: number;
  readonly unit?: string;
  /**
   * Days before `ctx.today` this habit was first created — six months for
   * most, three weeks for the one meant to read as new.
   */
  readonly createdOffset: number;
  /** The wall-clock hour a tick is usually logged — evening for training, morning for a pill. */
  readonly tickHour: number;
  /**
   * What was done on the day `offset` days from today (`weekday` is ISO,
   * 1 = Monday), or `null` for a day with no entry at all. Draws from the
   * shared `demoRandom("habits")` stream handed to every seed in creation
   * order, which is what makes the whole file reproduce identically run to
   * run.
   */
  readonly valueForDay: (offset: number, weekday: number, rng: DemoRandom) => number | null;
}

const HABITS: readonly HabitSeed[] = [
  // Strong for five months, then fell off — the collapse sits ~30 days back,
  // which is what the wall shows: a long solid stretch of M/W/F ticks that
  // simply stops.
  {
    name: "Trening",
    schedule: MON_WED_FRI,
    createdOffset: -180,
    tickHour: 19,
    valueForDay: (offset, weekday, rng) => {
      if (weekday !== 1 && weekday !== 3 && weekday !== 5) return null;
      const chance = offset <= -30 ? 0.88 : 0.12;
      return rng.chance(chance) ? 1 : null;
    },
  },
  // One of the two long-unbroken-streak habits: solid every day for the last
  // 120 days, looser (~50%) before that — a supplement somebody committed to
  // properly a few months in.
  {
    name: "Vitamin D",
    schedule: DAILY,
    createdOffset: -180,
    tickHour: 8,
    valueForDay: (offset, _weekday, rng) => {
      if (offset >= -119) return 1;
      return rng.chance(0.5) ? 1 : null;
    },
  },
  // The second long-unbroken-streak habit, and a numeric target: the last 100
  // days are always at or above 10 000, the months before that are a genuine
  // ~55% with values landing on both sides of the target.
  {
    name: "Šetnja 10.000 koraka",
    schedule: DAILY,
    target: 10_000,
    unit: "koraka",
    createdOffset: -180,
    tickHour: 21,
    valueForDay: (offset, _weekday, rng) => {
      if (offset >= -99) return rng.int(10_200, 15_000);
      if (!rng.chance(0.55)) return null;
      return rng.int(4_000, 13_000);
    },
  },
  // A steady, unremarkable ~75% — the wall's ordinary case beside the two
  // dramatic ones above it.
  {
    name: "Meditacija",
    schedule: DAILY,
    createdOffset: -180,
    tickHour: 7,
    valueForDay: (_offset, _weekday, rng) => (rng.chance(0.75) ? 1 : null),
  },
  // Weekday discipline that slips on weekends — a completion-rate version of
  // the weekday/weekend contrast, rather than a schedule that excludes the
  // weekend outright.
  {
    name: "Bez telefona posle 23h",
    schedule: DAILY,
    createdOffset: -180,
    tickHour: 23,
    valueForDay: (_offset, weekday, rng) => {
      const isWeekend = weekday === 6 || weekday === 7;
      return rng.chance(isWeekend ? 0.4 : 0.82) ? 1 : null;
    },
  },
  // A quota habit: any four days a week, no fixed days at all — the per-day
  // chance is quota/7 so the actual weekly count lands near four without
  // pinning which days.
  {
    name: "Srpski dnevnik",
    schedule: { kind: "quota", perWeek: 4 },
    createdOffset: -180,
    tickHour: 22,
    valueForDay: (_offset, _weekday, rng) => (rng.chance(0.55) ? 1 : null),
  },
  // The numeric-target habit with the clearest weekend contrast: weekday
  // amounts cluster around and above the eight-glass target, weekends are
  // consistently short of it — partial fills on the wall by construction.
  {
    name: "Voda",
    schedule: DAILY,
    target: 8,
    unit: "čaša",
    createdOffset: -180,
    tickHour: 22,
    valueForDay: (_offset, weekday, rng) => {
      const isWeekend = weekday === 6 || weekday === 7;
      if (!rng.chance(isWeekend ? 0.7 : 0.92)) return null;
      return isWeekend ? rng.int(3, 7) : rng.int(5, 11);
    },
  },
  // The „consistently ~60%, no long streak" habit the wall needs at least one
  // of: a quota of five, hit a bit over half the time, values spanning well
  // under to well over the 30-minute target.
  {
    name: "Čitanje",
    schedule: { kind: "quota", perWeek: 5 },
    target: 30,
    unit: "min",
    createdOffset: -180,
    tickHour: 22,
    valueForDay: (_offset, _weekday, rng) => (rng.chance(0.6) ? rng.int(10, 45) : null),
  },
  // A lighter quota (three) at roughly its own rate, with the numeric target
  // showing both partial and over-target days.
  {
    name: "Engleski — 20 min",
    schedule: { kind: "quota", perWeek: 3 },
    target: 20,
    unit: "min",
    createdOffset: -180,
    tickHour: 20,
    valueForDay: (_offset, _weekday, rng) => (rng.chance(0.45) ? rng.int(8, 30) : null),
  },
  // A weekday-only schedule: the wall shows real gaps every Saturday and
  // Sunday because the habit was never expected there, not because it was
  // missed.
  {
    name: "Pospremanje stola",
    schedule: WEEKDAYS,
    createdOffset: -180,
    tickHour: 18,
    valueForDay: (_offset, weekday, rng) => {
      if (weekday === 6 || weekday === 7) return null;
      return rng.chance(0.85) ? 1 : null;
    },
  },
  // The mirror image of „Pospremanje stola": expected ONLY on the weekend, so
  // the two habits together make the weekday/weekend contrast unmistakable at
  // a glance.
  {
    name: "Vikend trčanje",
    schedule: WEEKEND,
    target: 5,
    unit: "km",
    createdOffset: -180,
    tickHour: 10,
    valueForDay: (_offset, weekday, rng) => {
      if (weekday !== 6 && weekday !== 7) return null;
      if (!rng.chance(0.55)) return null;
      return rng.int(3, 9);
    },
  },
  // The habit that started three weeks ago — no history exists before its
  // `createdOffset`, and what exists since reads as a fresh, still-enthusiastic
  // start rather than a settled routine.
  {
    name: "Rastezanje",
    schedule: DAILY,
    target: 10,
    unit: "min",
    createdOffset: -21,
    tickHour: 7,
    valueForDay: (_offset, _weekday, rng) => (rng.chance(0.8) ? rng.int(5, 15) : null),
  },
];

/** A local instant `offset` days from today, as the ISO-8601 string every store's `now` wants. */
function demoIso(ctx: DemoContext, offset: number, hour: number, minute = 0): string {
  return new Date(demoAt(ctx, offset, hour, minute)).toISOString();
}

/**
 * The ISO weekday (1 = Monday … 7 = Sunday) of the local day `offset` days
 * from today. Built off `ctx.now` the way `demoAt` builds an instant — local
 * calendar fields rather than UTC arithmetic, so a day near a DST boundary
 * still lands on the day a person would call it. Fixed at noon, which no DST
 * transition ever crosses, because only the CALENDAR day is wanted here.
 */
function isoWeekday(ctx: DemoContext, offset: number): number {
  const anchor = new Date(ctx.now);
  const local = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + offset, 12);
  const jsWeekday = local.getDay();
  return jsWeekday === 0 ? 7 : jsWeekday;
}

/** Seeds every demo habit and roughly six months of its completion history. */
export function seedDemoHabits(db: DatabaseHandle, ctx: DemoContext): void {
  const store = new HabitStore(db, ctx.profileId);
  const rng = demoRandom("habits");

  HABITS.forEach((seed, index) => {
    const color = HABIT_COLORS[index % HABIT_COLORS.length] ?? "bronza";
    const habit = store.create(
      {
        name: seed.name,
        color,
        schedule: seed.schedule,
        target: seed.target ?? null,
        unit: seed.unit ?? null,
      },
      demoIso(ctx, seed.createdOffset, seed.tickHour),
    );

    for (let offset = seed.createdOffset; offset <= 0; offset += 1) {
      const weekday = isoWeekday(ctx, offset);
      const value = seed.valueForDay(offset, weekday, rng);
      if (value === null) continue;
      store.setEntry(habit.id, demoDay(ctx, offset), value, demoIso(ctx, offset, seed.tickHour));
    }
  });
}
