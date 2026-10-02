/**
 * The shared contract every demo seeder writes against.
 *
 * A demo profile exists for one reason: so a person opening Nexus for the first
 * time — or a designer reviewing a screen — sees the app FULL rather than
 * empty. Every module therefore fills its own slice through the same public
 * store API the IPC handlers use, so demo data is indistinguishable from data a
 * person typed, and nothing here can create a row the app itself could not.
 *
 * Two rules make the result reproducible:
 *
 *  1. **No `Math.random`.** Every choice comes from `demoRandom(seed)`, a
 *     seeded stream. A seeder that draws from its OWN named stream is unaffected
 *     by the order the seeders run in, which is what lets them be written
 *     independently.
 *  2. **No `Date.now`.** Every instant is derived from `DemoContext.now`, the
 *     single anchor the run was started with. The anchor is the real clock, so
 *     the profile always reads as alive ("today" has entries, this week is
 *     busy) — but within one run every module agrees on what "today" is, which
 *     a per-call `Date.now()` cannot guarantee across a midnight boundary.
 */

import type Database from "better-sqlite3-multiple-ciphers";
import { shiftDayKey, type DayKey } from "@nexus/core";

/** The raw connection every store takes — the same alias each store file declares. */
export type DatabaseHandle = Database.Database;

export interface DemoContext {
  /** The one anchor instant, in epoch milliseconds. Never re-read from the clock. */
  readonly now: number;
  /** `now` as a local-time day key (`YYYY-MM-DD`) — the demo profile's "today". */
  readonly today: DayKey;
  /** The profile every row is written under. */
  readonly profileId: string;
  /**
   * The language the seeded CONTENT is written in.
   *
   * A demo profile is read, not just clicked: its note bodies, task titles and
   * habit names are prose a person sees. A renderer in English that produced a
   * Serbian demo would be the one surface in the app that ignored the choice,
   * which is why every seeder carries both languages and picks by this field.
   * Date and number shapes follow it too.
   */
  readonly locale: DemoLocale;
}

/** The two languages the demo content is written in. */
export type DemoLocale = "sr" | "en";

/**
 * Builds the one context a seeding run shares.
 *
 * `today` is the LOCAL day, not the UTC one. Every day-keyed table in this app
 * is read back against the reader's own calendar — a habit is done "today"
 * where the person is standing — so a UTC key would put the evening's rows on
 * tomorrow for anyone east of Greenwich, which is everyone this app is for.
 */
export function createDemoContext(
  profileId: string,
  now: number,
  locale: DemoLocale = "sr",
): DemoContext {
  const anchor = new Date(now);
  const month = `${anchor.getMonth() + 1}`.padStart(2, "0");
  const day = `${anchor.getDate()}`.padStart(2, "0");
  return { now, profileId, locale, today: `${anchor.getFullYear()}-${month}-${day}` };
}

/** A seeded, reproducible source of the small choices demo content is made of. */
export interface DemoRandom {
  /** The next value in `[0, 1)`. */
  next(): number;
  /** An integer in `[min, max]`, both inclusive. */
  int(min: number, max: number): number;
  /** One member of a non-empty list. Throws on an empty one — an empty table is a bug in the caller, not a value to invent. */
  of<T>(items: readonly T[]): T;
  /** True with the given probability (`0` never, `1` always). */
  chance(probability: number): boolean;
  /** `count` distinct members, in list order. `count` above the list length yields the whole list. */
  some<T>(items: readonly T[], count: number): T[];
}

/**
 * A mulberry32 stream keyed by a string. Chosen over `Math.random` for
 * reproducibility and over a crypto source because nothing here is a secret —
 * this seeds a demo, and the same seed must always draw the same profile.
 */
export function demoRandom(seed: string): DemoRandom {
  let state = hashSeed(seed);
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    of<T>(items: readonly T[]): T {
      const picked = items[Math.floor(next() * items.length)];
      if (picked === undefined) throw new Error("demoRandom.of was handed an empty list");
      return picked;
    },
    chance: (probability) => next() < probability,
    some<T>(items: readonly T[], count: number): T[] {
      // Walk the list once, keeping each member with the probability that
      // leaves exactly `count` chosen. Preserves list order, which matters
      // when the list is already sorted the way the UI shows it.
      const chosen: T[] = [];
      let remaining = Math.min(count, items.length);
      for (let index = 0; index < items.length && remaining > 0; index += 1) {
        const candidate = items[index];
        if (candidate === undefined) continue;
        if (next() < remaining / (items.length - index)) {
          chosen.push(candidate);
          remaining -= 1;
        }
      }
      return chosen;
    },
  };
}

function hashSeed(seed: string): number {
  // FNV-1a, 32-bit. Any avalanche would do; this one is short and has no deps.
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The day key `offset` days from the context's today (negative = the past). */
export function demoDay(ctx: DemoContext, offset: number): DayKey {
  return shiftDayKey(ctx.today, offset);
}

/**
 * A local-time instant `offset` days from today at `hour`:`minute`.
 *
 * Local, not UTC, on purpose: the app renders every instant in the reader's own
 * zone, so a demo session logged at "18:30" has to BE 18:30 on screen. Built
 * from a `Date` constructed off the anchor rather than parsed from a string,
 * which keeps it correct across a DST boundary.
 */
export function demoAt(ctx: DemoContext, offset: number, hour: number, minute = 0): number {
  const anchor = new Date(ctx.now);
  return new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate() + offset,
    hour,
    minute,
    0,
    0,
  ).getTime();
}

/** Minutes as milliseconds — for durations, where a bare number is easy to misread. */
export function minutes(count: number): number {
  return count * 60_000;
}
