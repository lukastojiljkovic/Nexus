/**
 * Pure backward-planning engine for the STUDY exam planner (piece 3a; topics,
 * the weekday vector and the exam-week posture since ADR-063): turns an exam
 * date, a few knobs and the exam's ranked topic list into a deterministic list
 * of daily study blocks. No clock reads, no `Date.now()` — every date involved
 * (`examDate`, `startDate`, `today`) is an explicit bare "YYYY-MM-DD" input, so
 * the same arguments always produce the same output. `@nexus/db`'s `PlanStore`
 * is the only caller: it reads the real clock/calendar once, resolves each
 * topic's EFFECTIVE confidence (manual, or FSRS-derived from its deck), then
 * calls this function with plain strings and numbers.
 *
 * All date math happens at UTC midnight (`${d}T00:00:00.000Z`), mirroring the
 * desktop app's `examDates.ts` day-arithmetic idiom exactly, so a bare date
 * never shifts by a day regardless of the host's timezone.
 *
 * Preconditions (the caller — `PlanStore` — is responsible for enforcing these
 * before calling; this function trusts its input and does no semantic
 * validation of its own): `examDate`, `startDate` and `today` are well-formed
 * "YYYY-MM-DD" dates, `dailyMinutes` is a positive, sane integer, and
 * `weekdayMinutes` (when present) is a 7-vector of integers in 0..480 with at
 * least one positive entry.
 *
 * The topic algorithm, stated precisely (every constant below is part of it):
 *
 * 1. CAPACITY IS LAW. Each day's capacity comes from `planDayCapacity`: the
 *    Mon..Sun vector entry for that weekday (or `dailyMinutes` when no vector
 *    is set), doubled inside the final `EXAM_WEEK_DAYS` window when
 *    `examWeekBoost` is on — the boost multiplies the vector exactly as it
 *    multiplied the scalar. A day is never scheduled past its capacity, and a
 *    zero-capacity day carries no block at all.
 * 2. BUDGETS. Cut topics are excluded before anything is computed. The
 *    coverage REGION is every capacity-bearing day strictly before the
 *    exam-week window — or, when the plan starts inside the window, the whole
 *    span (coverage that cannot be placed earlier is allowed there, which is
 *    the only case invariant 4 permits). The region's total capacity is split
 *    into one integer budget per topic by largest-remainder over the weights
 *    `max(100 - effectiveConfidence, MIN_TOPIC_WEIGHT)`, a NULL confidence
 *    reading as `NULL_CONFIDENCE` (between low and middle). Ties in the
 *    remainder fall to the lower rank.
 * 3. COVERAGE + REVISION per topic. A topic whose budget is at least
 *    `REVISION_MIN_BUDGET` reserves three revision passes of
 *    `max(REVISION_FLOOR_MINUTES, round(budget / 15))` minutes each — together
 *    ~25% of the coverage they follow — and covers the rest; a smaller topic
 *    is pure coverage. The walk goes day by day, ascending: revision passes
 *    whose due day has arrived are placed first (in enqueue order), then
 *    coverage continues in RANK order, splitting across days as capacity
 *    allows. When a topic's coverage completes, its passes are enqueued at
 *    +1/+3/+7 days from the completion day, clamped to exam-eve; a pass
 *    clamped onto (or before) the completion day itself is dropped, and two
 *    passes landing on one day merge into a single block, capped by the day's
 *    remaining capacity.
 * 4. RECALL. After the walk, every remaining slice of capacity — the whole
 *    exam-week window when the plan has earlier days, plus any leftovers the
 *    floors and caps freed — becomes one `recall` block per day, rotating
 *    through the topics ordered weakest first (effective confidence
 *    ascending, then rank).
 * 5. Output rows are sorted by date, then kind (coverage, revision, recall),
 *    then topic rank. A plan with no live topics takes the zero-topic path:
 *    one undifferentiated block per capacity-bearing day, byte-for-byte the
 *    pre-ADR-063 engine's output (the compatibility pin in this module's
 *    tests).
 */

const MS_PER_DAY = 86_400_000;
const EXAM_WEEK_DAYS = 7;

/** What a NULL (unknown) effective confidence reads as: between low (~0) and middle (~50). */
const NULL_CONFIDENCE = 25;
/** The floor under `100 - confidence`, so a fully-confident topic still gets a sliver of coverage. */
const MIN_TOPIC_WEIGHT = 10;
/** Revision passes after a topic's coverage completes, in days after the completion day. */
const REVISION_GAPS_DAYS = [1, 3, 7] as const;
/** No revision block is ever shorter than this. */
const REVISION_FLOOR_MINUTES = 15;
/** A topic with a smaller budget is pure coverage — three floored passes would drown it. */
const REVISION_MIN_BUDGET = 60;

/** The kinds a generated block can carry (ADR-063; migration 046's CHECK domain). */
export type PlanBlockKind = "coverage" | "revision" | "recall";

/** Sort key per kind: coverage before revision before recall within one day. */
const KIND_ORDER: Record<PlanBlockKind, number> = { coverage: 0, revision: 1, recall: 2 };

/** One generated study session: a bare date, its planned length, and what it is for. */
export interface PlanBlockDate {
  date: string;
  minutes: number;
  /** The topic this block serves, or null on a zero-topic plan's undifferentiated block. */
  topicId: string | null;
  kind: PlanBlockKind;
}

/** One exam topic as the engine consumes it — resolved numbers, no rows (the store owns derivation). */
export interface PlanTopic {
  id: string;
  /** The user's rank: 0 = the list's top = most important (curriculum order AND scope-cut priority). */
  rank: number;
  /** EFFECTIVE confidence 0-100 (manual, or deck-derived by the store), or null for unknown. */
  confidence: number | null;
  /** A cut topic is excluded from generation entirely (STUDY-004). */
  cut: boolean;
}

export interface PlanBlockDatesInput {
  /** The exam's date; blocks are generated for every day strictly before it. */
  examDate: string;
  /** The plan's requested first day; clamped forward to `today` if it has already passed. */
  startDate: string;
  /** Minutes allotted to an ordinary day; the base the weekday vector defaults from. */
  dailyMinutes: number;
  /** When true, capacity in the final 7 days before the exam is doubled. */
  examWeekBoost: boolean;
  /** "Now", as a bare date — the earliest day a block may ever be generated for. */
  today: string;
  /** Mon..Sun capacity vector; absent or null means "every day = dailyMinutes". */
  weekdayMinutes?: readonly number[] | null;
  /** The exam's topics; absent, empty, or all-cut takes the zero-topic path. */
  topics?: readonly PlanTopic[];
}

/** The subset of a plan `planDayCapacity` reads — what `PlanStore` holds for every plan row. */
export interface PlanCapacitySpec {
  examDate: string;
  dailyMinutes: number;
  examWeekBoost: boolean;
  weekdayMinutes?: readonly number[] | null;
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

/** The Mon..Sun vector index for a UTC-midnight ms (`getUTCDay` is Sun-first). */
function weekdayIndex(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7;
}

/**
 * One day's scheduling capacity under a plan's knobs: the weekday vector's
 * entry for that day (or `dailyMinutes` when no vector is set), doubled inside
 * the final 7 days before the exam when `examWeekBoost` is on. Zero on and
 * after the exam date — no block may exist there. Exported because `PlanStore`
 * needs the same answer when it redistributes a backlog: two spellings of one
 * capacity rule would be a law that quietly stopped holding.
 */
export function planDayCapacity(spec: PlanCapacitySpec, date: string): number {
  const dayMs = utcDayMs(date);
  const examMs = utcDayMs(spec.examDate);
  if (dayMs >= examMs) return 0;

  const vector = spec.weekdayMinutes ?? null;
  const base = vector === null ? spec.dailyMinutes : (vector[weekdayIndex(dayMs)] ?? 0);
  const boosted = spec.examWeekBoost && dayMs >= examMs - EXAM_WEEK_DAYS * MS_PER_DAY;
  return boosted ? base * 2 : base;
}

/** One day of the working schedule: its date, and how much capacity is still unclaimed. */
interface DayLedger {
  ms: number;
  date: string;
  rem: number;
  inWindow: boolean;
}

/** A revision pass waiting for its due day (or for a day with capacity after it). */
interface PendingRevision {
  topicId: string;
  rank: number;
  dueMs: number;
  minutes: number;
}

/**
 * Splits `total` into one integer share per weight by largest remainder:
 * floors first, then one extra unit each to the largest fractional parts, ties
 * falling to the earlier (lower-rank) entry. Σ shares === total.
 */
function largestRemainderShares(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum === 0 || total <= 0) return weights.map(() => 0);

  const raw = weights.map((weight) => (total * weight) / sum);
  const shares = raw.map((value) => Math.floor(value));
  let leftover = total - shares.reduce((acc, value) => acc + value, 0);

  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const { index } of order) {
    if (leftover <= 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    leftover -= 1;
  }
  return shares;
}

/**
 * Generates the blocks for one plan — see the module header for the whole
 * algorithm. Returns `[]` once the exam is today or already past, or once the
 * effective start lands on/after the exam date.
 */
export function planBlockDates(input: PlanBlockDatesInput): PlanBlockDate[] {
  const examMs = utcDayMs(input.examDate);
  const todayMs = utcDayMs(input.today);
  if (examMs <= todayMs) return [];

  const startMs = utcDayMs(input.startDate);
  const effectiveStartMs = Math.max(startMs, todayMs);
  if (effectiveStartMs >= examMs) return [];

  const spec: PlanCapacitySpec = {
    examDate: input.examDate,
    dailyMinutes: input.dailyMinutes,
    examWeekBoost: input.examWeekBoost,
    weekdayMinutes: input.weekdayMinutes ?? null,
  };
  const windowStartMs = examMs - EXAM_WEEK_DAYS * MS_PER_DAY;

  const days: DayLedger[] = [];
  for (let ms = effectiveStartMs; ms < examMs; ms += MS_PER_DAY) {
    const date = utcDateKey(ms);
    const cap = planDayCapacity(spec, date);
    if (cap <= 0) continue;
    days.push({ ms, date, rem: cap, inWindow: ms >= windowStartMs });
  }
  if (days.length === 0) return [];

  const topics = (input.topics ?? [])
    .filter((candidate) => !candidate.cut)
    .sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // The zero-topic path: one undifferentiated block per capacity-bearing day —
  // the pre-ADR-063 engine byte for byte (the compatibility pin).
  if (topics.length === 0) {
    return days.map((day) => ({
      date: day.date,
      minutes: day.rem,
      topicId: null,
      kind: "coverage" as const,
    }));
  }

  // Coverage region: the days before the window — or the whole span when the
  // plan starts inside it (coverage that cannot be placed earlier).
  const hasEarlyDays = days.some((day) => !day.inWindow);
  const coverageAllowed = (day: DayLedger): boolean => !day.inWindow || !hasEarlyDays;
  const regionCapacity = days
    .filter((day) => coverageAllowed(day))
    .reduce((acc, day) => acc + day.rem, 0);

  const weights = topics.map(
    (t) => Math.max(100 - (t.confidence ?? NULL_CONFIDENCE), MIN_TOPIC_WEIGHT),
  );
  const budgets = largestRemainderShares(regionCapacity, weights);

  interface CoverageTask {
    topicId: string;
    rank: number;
    remaining: number;
    passMinutes: number; // 0 = no revisions (budget under the minimum)
  }
  const queue: CoverageTask[] = topics.map((t, index) => {
    const budget = budgets[index] ?? 0;
    const withRevisions = budget >= REVISION_MIN_BUDGET;
    const passMinutes = withRevisions
      ? Math.max(REVISION_FLOOR_MINUTES, Math.round(budget / 15))
      : 0;
    return {
      topicId: t.id,
      rank: t.rank,
      remaining: withRevisions ? budget - REVISION_GAPS_DAYS.length * passMinutes : budget,
      passMinutes,
    };
  });

  const rankOf = new Map(topics.map((t) => [t.id, t.rank]));
  const blocks: PlanBlockDate[] = [];
  /** The one revision block per (topic, date), for merging clamped passes. */
  const revisionAt = new Map<string, PlanBlockDate>();
  const pending: PendingRevision[] = [];
  let queueIndex = 0;

  const examEveMs = examMs - MS_PER_DAY;
  for (const day of days) {
    // 1. Revision passes whose due day has arrived, in enqueue order.
    for (const pass of pending) {
      if (pass.minutes <= 0 || pass.dueMs > day.ms || day.rem <= 0) continue;
      const placed = Math.min(pass.minutes, day.rem);
      const key = `${pass.topicId}\u0000${day.date}`;
      const existing = revisionAt.get(key);
      if (existing) {
        existing.minutes += placed;
      } else {
        const block: PlanBlockDate = {
          date: day.date,
          minutes: placed,
          topicId: pass.topicId,
          kind: "revision",
        };
        revisionAt.set(key, block);
        blocks.push(block);
      }
      day.rem -= placed;
      pass.minutes = 0;
    }

    // 2. Coverage in rank order, splitting across days as capacity allows.
    if (!coverageAllowed(day)) continue;
    while (day.rem > 0 && queueIndex < queue.length) {
      const task = queue[queueIndex]!;
      if (task.remaining <= 0) {
        queueIndex += 1;
        continue;
      }
      const placed = Math.min(task.remaining, day.rem);
      blocks.push({ date: day.date, minutes: placed, topicId: task.topicId, kind: "coverage" });
      task.remaining -= placed;
      day.rem -= placed;
      if (task.remaining === 0 && task.passMinutes > 0) {
        // Completed: enqueue the spaced passes. A pass clamped onto (or before)
        // the completion day itself is not a revision of anything and is dropped.
        for (const gap of REVISION_GAPS_DAYS) {
          const dueMs = Math.min(day.ms + gap * MS_PER_DAY, examEveMs);
          if (dueMs <= day.ms) continue;
          pending.push({ topicId: task.topicId, rank: task.rank, dueMs, minutes: task.passMinutes });
        }
      }
    }
  }

  // 3. Recall: every leftover slice, rotated weakest-first (STUDY-005 fills
  // the window; the same rule absorbs what the floors and caps freed earlier).
  const weakOrder = [...topics].sort(
    (a, b) =>
      (a.confidence ?? NULL_CONFIDENCE) - (b.confidence ?? NULL_CONFIDENCE) || a.rank - b.rank,
  );
  let recallCounter = 0;
  for (const day of days) {
    if (day.rem <= 0) continue;
    const target = weakOrder[recallCounter % weakOrder.length]!;
    recallCounter += 1;
    blocks.push({ date: day.date, minutes: day.rem, topicId: target.id, kind: "recall" });
    day.rem = 0;
  }

  blocks.sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (rankOf.get(a.topicId ?? "") ?? 0) - (rankOf.get(b.topicId ?? "") ?? 0),
  );
  return blocks;
}

/**
 * Spreads `backlogMinutes` of missed study time across `blocks` evenly, with
 * earlier days absorbing any remainder first — the STUDY catch-up replan for
 * ZERO-TOPIC plans only (ADR-063 invariant 5 keeps this no-cap behaviour as
 * their compatibility contract; topic-aware plans go through
 * `distributeBacklogCapped`, and even this path's overflow past the plan's own
 * capacity is reported by `PlanStore`). Every block gets
 * `floor(backlogMinutes / n)` extra minutes on top of its own `minutes`, and
 * the first `backlogMinutes % n` blocks (in the given order — callers pass
 * `planBlockDates`'s own ascending-date output) get one further extra minute
 * each, so the user catches up sooner.
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

/** `distributeBacklogCapped`'s result: the redistributed blocks, and every minute that found no headroom. */
export interface DistributedBacklog {
  blocks: PlanBlockDate[];
  /** Backlog minutes NO day could absorb — a return value, never a silent stretch (ADR-063 invariant 5). */
  overflowMinutes: number;
}

/**
 * The capped catch-up replan (ADR-063 invariant 5): spreads `backlogMinutes`
 * across the blocks' DAYS without ever pushing a day past `capacityOf(date)`.
 * Headroom is filled in rounds — an even split per round, earlier days
 * absorbing the remainder first, each day clamped to what it can still take —
 * so the result matches `distributeBacklog`'s shape wherever the caps do not
 * bind. A day's extra lands on its FIRST block in the given order (callers
 * pass ascending date, coverage-first output, so the day's main block grows).
 * Whatever finds no headroom is RETURNED as `overflowMinutes` — the number
 * `PlanStore` surfaces as the plan's health, and the scope-cut conversation's
 * trigger (STUDY-004). Pure: no clock, no mutation of the input.
 */
export function distributeBacklogCapped(
  blocks: readonly PlanBlockDate[],
  backlogMinutes: number,
  capacityOf: (date: string) => number,
): DistributedBacklog {
  const copies = blocks.map((block) => ({ ...block }));
  if (backlogMinutes <= 0) return { blocks: copies, overflowMinutes: 0 };
  if (copies.length === 0) return { blocks: copies, overflowMinutes: backlogMinutes };

  // One ledger per day, in first-seen (ascending) order: total scheduled, the
  // day's first block (which absorbs the extra), and the headroom left.
  interface DayFill {
    date: string;
    first: PlanBlockDate;
    headroom: number;
  }
  const byDate = new Map<string, DayFill>();
  for (const block of copies) {
    const existing = byDate.get(block.date);
    if (existing) {
      existing.headroom -= block.minutes;
    } else {
      byDate.set(block.date, {
        date: block.date,
        first: block,
        headroom: capacityOf(block.date) - block.minutes,
      });
    }
  }

  let backlog = backlogMinutes;
  for (;;) {
    const active = [...byDate.values()].filter((day) => day.headroom > 0);
    if (backlog <= 0 || active.length === 0) break;
    const base = Math.floor(backlog / active.length);
    const remainder = backlog % active.length;
    active.forEach((day, index) => {
      const offered = base + (index < remainder ? 1 : 0);
      const taken = Math.min(offered, day.headroom);
      day.first.minutes += taken;
      day.headroom -= taken;
      backlog -= taken;
    });
  }

  return { blocks: copies, overflowMinutes: backlog };
}
