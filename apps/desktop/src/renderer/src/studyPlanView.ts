import type { ExamTopic, PlanHealth, StudyBlock, StudyBlockKind } from "../../shared/ipc.js";
import { shiftDayKey } from "./examDates.js";
import { countUnit, strings } from "./strings.js";

/**
 * Pure presentation arithmetic for the topic-aware study planner (ADR-063,
 * slice b) — the kanbanColumns.ts/studyLog.ts idiom: StudyPage decides what to
 * fetch and when, this module decides only what a fetched plan READS as, so
 * every rule below is pinned by tests instead of by reading JSX.
 *
 *  - The WEEKDAY VECTOR mirror of `PlanStore`'s own rule (exactly 7 integers
 *    0..480, at least one positive) lives here so the form refuses exactly
 *    what the store would refuse, one keystroke earlier.
 *  - The EXAM-WEEK window predicate mirrors the engine's `EXAM_WEEK_DAYS`
 *    constant, so the highlighted rows are exactly the rows the engine treats
 *    as the final posture.
 *  - The HEALTH sentence and the SCOPE-CUT rows are the honest-planner copy
 *    (invariant 5 / STUDY-004): a number the store reported, never one this
 *    module invents.
 */

/** Mirrors the engine's `EXAM_WEEK_DAYS` (packages/core planEngine.ts): the final window before an exam. */
const EXAM_WEEK_DAYS = 7;

/** Mirrors `PlanStore`'s weekday-vector bounds (migration 046): a day may be free (0) but never longer than 480. */
const MAX_WEEKDAY_MINUTES = 480;
const WEEKDAY_VECTOR_LENGTH = 7;

/** Only whole non-negative numbers pass — `Number()` alone would accept "1e2" and "0x10". */
const WHOLE_NUMBER = /^\d+$/;

/**
 * Parses the form's seven Mon..Sun inputs into the store's vector, or null
 * when any entry breaks the store's own rule (exactly 7 integers 0..480, at
 * least one positive — a week of nothing is not a plan). UX-only parity;
 * main and the store both revalidate.
 */
export function parseWeekdayMinutes(inputs: readonly string[]): number[] | null {
  if (inputs.length !== WEEKDAY_VECTOR_LENGTH) return null;
  const vector: number[] = [];
  for (const raw of inputs) {
    const trimmed = raw.trim();
    if (!WHOLE_NUMBER.test(trimmed)) return null;
    const value = Number(trimmed);
    if (value > MAX_WEEKDAY_MINUTES) return null;
    vector.push(value);
  }
  return vector.some((entry) => entry > 0) ? vector : null;
}

/**
 * What the form actually SENDS for a parsed vector: null when every entry
 * equals the scalar — the stored NULL means "svaki dan isto", and a vector
 * that says nothing the scalar does not say should not outlive the form —
 * otherwise the vector itself (a copy). An all-equal week that differs from
 * the scalar is kept: it is what the user typed, and collapsing it would
 * change the plan's capacity behind their back.
 */
export function weekdayMinutesForSave(
  vector: readonly number[],
  dailyMinutes: number,
): number[] | null {
  return vector.every((entry) => entry === dailyMinutes) ? null : [...vector];
}

/**
 * True when `dayKey` falls inside the final `EXAM_WEEK_DAYS` window strictly
 * before `examDate` — the days the engine doubles under the boost and fills
 * with recall, and the days the page draws in the exam-week variant. Bare-day
 * string comparison over ISO keys; a time part on the exam date is ignored.
 */
export function isExamWeekDay(examDate: string, dayKey: string): boolean {
  const exam = examDate.slice(0, 10);
  const day = dayKey.slice(0, 10);
  return day < exam && day >= shiftDayKey(exam, -EXAM_WEEK_DAYS);
}

/**
 * The plan card's honest health sentence (ADR-063 invariant 5), or null when
 * there is nothing to confess. The store guarantees the two counts are never
 * both positive (a passed exam regenerates nothing), so the order here is a
 * formality, not a priority call.
 */
export function planHealthLine(
  health: Pick<PlanHealth, "overflowMinutes" | "examPassedBacklogMinutes"> | undefined,
): string | null {
  if (health === undefined) return null;
  const s = strings.study;
  if (health.overflowMinutes > 0) {
    return `${s.healthOverflowPrefix} ${health.overflowMinutes} ${s.healthOverflowSuffix}`;
  }
  if (health.examPassedBacklogMinutes > 0) {
    return `${s.healthExamPassedPrefix} ${health.examPassedBacklogMinutes} ${s.healthExamPassedSuffix}`;
  }
  return null;
}

/**
 * The plan card's scope line beside the health sentence (STUDY-004): how many
 * of the exam's topics the user has accepted out of the plan, or null at full
 * scope — a plan that cut nothing says nothing. Counted from the `cut` flags
 * the page already holds; the store is the only thing that sets them, and
 * „Vrati u plan" on a row is what makes this number go back down.
 */
export function cutTopicsLine(topics: readonly Pick<ExamTopic, "cut">[]): string | null {
  const count = topics.reduce((acc, topic) => (topic.cut ? acc + 1 : acc), 0);
  if (count === 0) return null;
  const s = strings.study;
  const unit = countUnit(count, s.scopeCountUnitOne, s.scopeCountUnitFew, s.scopeCountUnitMany);
  return `${count} ${unit}`;
}

/**
 * The quiet kind chip's label, or null for coverage — the ordinary case
 * renders plain (ADR-063: a chip on every row would be noise, and the topic
 * name already says what the block is about).
 */
export function blockKindChipLabel(kind: StudyBlockKind): string | null {
  return kind === "coverage" ? null : strings.study.blockKind[kind];
}

/** One row of the „Predlog skraćenja" dialog: a proposed topic and what cutting it frees. */
export interface ScopeCutRow {
  id: string;
  name: string;
  rank: number;
  remainingMinutes: number;
}

/**
 * Joins a proposal's topic ids with the loaded topics and blocks into dialog
 * rows, in the proposal's own bottom-up order. `remainingMinutes` mirrors the
 * store's remaining-load read exactly (`selectRemainingMinutesByTopic`):
 * missed blocks count wherever they sit, planned ones only from `today` on,
 * done ones never. An id no loaded topic resolves (a race with a delete) is
 * skipped rather than drawn nameless.
 */
export function scopeCutRows(
  topicIds: readonly string[],
  topics: readonly Pick<ExamTopic, "id" | "name" | "rank">[],
  blocks: readonly Pick<StudyBlock, "topicId" | "minutes" | "status" | "blockDate">[],
  today: string,
): ScopeCutRow[] {
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
  return topicIds.flatMap((id) => {
    const topic = topicsById.get(id);
    if (!topic) return [];
    const remainingMinutes = blocks.reduce(
      (acc, block) =>
        block.topicId === id &&
        (block.status === "missed" || (block.status === "planned" && block.blockDate >= today))
          ? acc + block.minutes
          : acc,
      0,
    );
    return [{ id, name: topic.name, rank: topic.rank, remainingMinutes }];
  });
}
