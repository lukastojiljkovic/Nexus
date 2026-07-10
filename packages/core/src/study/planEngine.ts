/**
 * Pure backward-planning engine for the STUDY exam planner (piece 3a): turns an
 * exam date and a few knobs into a deterministic list of daily study blocks.
 * No clock reads, no `Date.now()` — every date involved (`examDate`, `startDate`,
 * `today`) is an explicit bare "YYYY-MM-DD" input, so the same arguments always
 * produce the same output. `@nexus/db`'s `PlanStore` is the only caller; it reads
 * the real clock/calendar once, then calls this function with plain strings.
 *
 * All date math happens at UTC midnight (`${d}T00:00:00.000Z`), mirroring the
 * desktop app's `examDates.ts` day-arithmetic idiom exactly, so a bare date never
 * shifts by a day regardless of the host's timezone.
 *
 * Preconditions (the caller — `PlanStore` — is responsible for enforcing these
 * before calling; this function trusts its input and does no semantic
 * validation of its own): `examDate`, `startDate` and `today` are well-formed
 * "YYYY-MM-DD" dates, and `dailyMinutes` is a positive, sane integer.
 */

const MS_PER_DAY = 86_400_000;
const EXAM_WEEK_DAYS = 7;

/** One generated study session: a bare date plus its planned length. */
export interface PlanBlockDate {
  date: string;
  minutes: number;
}

export interface PlanBlockDatesInput {
  /** The exam's date; blocks are generated for every day strictly before it. */
  examDate: string;
  /** The plan's requested first day; clamped forward to `today` if it has already passed. */
  startDate: string;
  /** Minutes allotted to an ordinary block; doubled on boosted days. */
  dailyMinutes: number;
  /** When true, blocks in the final 7 days before the exam get double `dailyMinutes`. */
  examWeekBoost: boolean;
  /** "Now", as a bare date — the earliest day a block may ever be generated for. */
  today: string;
}

/** UTC-midnight ms for a bare "YYYY-MM-DD" prefix (mirrors `examDates.ts`'s `utcDayMs`). */
function utcDayMs(dateKey: string): number {
  const [yearPart, monthPart, dayPart] = dateKey.slice(0, 10).split("-");
  return Date.UTC(Number(yearPart), Number(monthPart) - 1, Number(dayPart));
}

/** Formats UTC-midnight ms back into a bare "YYYY-MM-DD" string. */
function utcDateKey(ms: number): string {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Generates one block per day from `max(startDate, today)` through the day
 * before `examDate`, inclusive, ascending. Blocks in the final 7 days before
 * the exam get double `dailyMinutes` when `examWeekBoost` is set (a span
 * shorter than 7 days is boosted in full). Returns `[]` once the exam is today
 * or already past, or once the effective start lands on/after the exam date.
 */
export function planBlockDates(input: PlanBlockDatesInput): PlanBlockDate[] {
  const examMs = utcDayMs(input.examDate);
  const todayMs = utcDayMs(input.today);
  if (examMs <= todayMs) return [];

  const startMs = utcDayMs(input.startDate);
  const effectiveStartMs = Math.max(startMs, todayMs);
  if (effectiveStartMs >= examMs) return [];

  const lastBlockMs = examMs - MS_PER_DAY;
  const boostThresholdMs = examMs - EXAM_WEEK_DAYS * MS_PER_DAY;

  const blocks: PlanBlockDate[] = [];
  for (let ms = effectiveStartMs; ms <= lastBlockMs; ms += MS_PER_DAY) {
    const boosted = input.examWeekBoost && ms >= boostThresholdMs;
    blocks.push({ date: utcDateKey(ms), minutes: boosted ? input.dailyMinutes * 2 : input.dailyMinutes });
  }
  return blocks;
}

/**
 * Spreads `backlogMinutes` of missed study time across `blocks` evenly, with
 * earlier days absorbing any remainder first — the STUDY catch-up replan:
 * missed minutes are redistributed onto the remaining planned days with no
 * daily cap. Every block gets `floor(backlogMinutes / n)` extra minutes on
 * top of its own `minutes`, and the first `backlogMinutes % n` blocks (in the
 * given order — callers pass `planBlockDates`'s own ascending-date output)
 * get one further extra minute each, so the user catches up sooner.
 *
 * Precondition (the caller's responsibility, like `dailyMinutes` above):
 * `backlogMinutes` is an integer. A `backlogMinutes` of zero or less, or an
 * empty `blocks` array, returns the blocks unchanged (a new array, same
 * values). Pure: no clock, no mutation of the input.
 */
export function distributeBacklog(
  blocks: readonly PlanBlockDate[],
  backlogMinutes: number,
): PlanBlockDate[] {
  if (backlogMinutes <= 0 || blocks.length === 0) return blocks.map((block) => ({ ...block }));

  const base = Math.floor(backlogMinutes / blocks.length);
  const remainder = backlogMinutes % blocks.length;

  return blocks.map((block, index) => ({
    ...block,
    minutes: block.minutes + base + (index < remainder ? 1 : 0),
  }));
}
