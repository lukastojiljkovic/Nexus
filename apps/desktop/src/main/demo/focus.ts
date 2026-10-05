import type Database from "better-sqlite3-multiple-ciphers";
import { DEFAULT_FOCUS_CONFIG, nextPhase } from "@nexus/core";
import type { FocusOutcome, FocusPhaseKind } from "@nexus/core";
import { FocusStore, SubjectStore, TaskStore } from "@nexus/db";
import type { CreateFocusSessionInput } from "@nexus/db";
import { demoAt, demoDay, demoRandom, minutes } from "./context.js";
import type { DemoContext, DemoRandom } from "./context.js";

type DatabaseHandle = Database.Database;

/**
 * Seeds ~10 weeks of Pomodoro/study history for the demo profile, ending
 * today, entirely through `FocusStore.create` — the same call
 * `endRunningFocusPhase` makes on `focus:stop` and on the quit sweep. Every
 * row here is therefore one the app itself could have produced: a real phase
 * with a real span, a plausible outcome, and (for the Pomodoro flavour) a
 * `cycleIndex` that follows the same `nextPhase` rule the running timer uses.
 *
 * Two shapes of session, mixed across the history exactly as a real user's
 * would be:
 *  - a **Pomodoro run**: one or more `work` phases, each usually followed by
 *    a `short_break`/`long_break` chosen by `nextPhase` (the four-cycle rule).
 *  - a **study block**: STUDY's open-ended timer — a `work` phase with
 *    `plannedMinutes: null`, which `FOCUS_OUTCOMES`' own doc comment says must
 *    always end `stopped` (there is no plan to *complete*).
 *
 * Attachment (`subjectId`/`taskId`) is drawn from whatever SUBJECT/TASK rows
 * already exist in this profile at the moment this runs (`SubjectStore`/
 * `TaskStore.listActive()`), never invented — `subjectId` in particular is a
 * real foreign key the store validates, so a made-up id would simply throw.
 */
export function seedDemoFocus(db: DatabaseHandle, ctx: DemoContext): void {
  const store = new FocusStore(db, ctx.profileId);
  const rnd = demoRandom("focus");
  const nowIso = new Date(ctx.now).toISOString();

  const subjectIds = new SubjectStore(db, ctx.profileId).listActive().map((subject) => subject.id);
  const taskIds = new TaskStore(db, ctx.profileId).listActive().map((task) => task.id);

  const HISTORY_DAYS = 70; // ~10 weeks, offsets -69..0 with 0 (today) handled separately below.

  let skipDays = 0;
  for (let offset = -(HISTORY_DAYS - 1); offset < 0; offset += 1) {
    if (skipDays > 0) {
      skipDays -= 1;
      continue;
    }

    const weekday = new Date(`${demoDay(ctx, offset)}T00:00:00`).getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    if (!rnd.chance(isWeekend ? 0.35 : 0.78)) {
      // An inactive day. Occasionally it is the start of a longer stretch of
      // nothing (exam week off, a trip) — a handful of consecutive empty
      // days reads as a genuine gap; a lone empty day every so often does not.
      if (rnd.chance(0.08)) skipDays = rnd.int(1, 4);
      continue;
    }

    const startHour = rnd.chance(0.5) ? rnd.int(7, 10) : rnd.int(13, 20);
    const startMs = demoAt(ctx, offset, startHour, rnd.int(0, 55));

    const phases = rnd.chance(0.75)
      ? buildPomodoroRun(rnd, startMs, rnd.int(1, 3), subjectIds, taskIds)
      : buildStudyBlock(rnd, startMs, subjectIds);

    createPhases(store, ctx, phases, nowIso);
  }

  seedToday(store, rnd, ctx, subjectIds, taskIds, nowIso);
}

/**
 * Today gets its own construction rather than falling out of the general
 * day loop: the „Trake pažnje" lane chart draws today's finished phases, and
 * it needs a handful spread across DIFFERENT hours on both sides of noon —
 * something one continuous Pomodoro run (which drifts a few minutes at a
 * time) would not reliably produce. So each work phase here is its own
 * independent one-cycle run, anchored at a distinct hour drawn from a
 * morning pool and an afternoon pool (`demoRandom.some`'s distinctness is
 * exactly the guarantee this needs), for 3-5 work phases in total.
 */
function seedToday(
  store: FocusStore,
  rnd: DemoRandom,
  ctx: DemoContext,
  subjectIds: readonly string[],
  taskIds: readonly string[],
  nowIso: string,
): void {
  const targetWork = rnd.int(3, 5);
  const morningCount = Math.ceil(targetWork / 2);
  const afternoonCount = targetWork - morningCount;

  const morningHours = rnd.some([7, 8, 9, 10, 11], morningCount);
  const afternoonHours = rnd.some([13, 14, 15, 16, 17, 18, 19], afternoonCount);

  for (const hour of [...morningHours, ...afternoonHours]) {
    const startMs = demoAt(ctx, 0, hour, rnd.int(0, 45));
    const phases = buildPomodoroRun(rnd, startMs, 1, subjectIds, taskIds);
    createPhases(store, ctx, phases, nowIso);
  }
}

/** Plausible focus labels — what a work phase was CALLED at the time (`CreateFocusSessionInput.label`'s snapshot). */
const WORK_LABELS = [
  "Pisanje seminarskog rada",
  "Priprema za kolokvijum",
  "Čitanje literature",
  "Rešavanje zadataka",
  "Priprema prezentacije",
  "Debagovanje projekta",
  "Pregled beležaka",
  "Analiza algoritma",
  "Vežbanje za tehnički intervju",
  "Rad na ličnom projektu",
  "Pisanje izveštaja",
  "Organizacija materijala",
] as const;

/** Labels for STUDY's open-ended flavour of the same timer. */
const STUDY_LABELS = [
  "Samostalno učenje",
  "Ponavljanje gradiva",
  "Rešavanje zadataka sa vežbi",
  "Priprema za ispit",
] as const;

/**
 * English labels, keyed by the Serbian literal. The arrays above stay exactly
 * as they were - including the `rnd.of(...)` draw that picks from them - and
 * the chosen label is translated on the way into the store, so the locale can
 * never change which draw happens.
 */
const EN: Readonly<Record<string, string>> = {
  "Pisanje seminarskog rada": "Writing a term paper",
  "Priprema za kolokvijum": "Preparing for a midterm",
  "Čitanje literature": "Reading the literature",
  "Rešavanje zadataka": "Working through problems",
  "Priprema prezentacije": "Preparing a presentation",
  "Debagovanje projekta": "Debugging the project",
  "Pregled beležaka": "Reviewing notes",
  "Analiza algoritma": "Analysing an algorithm",
  "Vežbanje za tehnički intervju": "Practising for a technical interview",
  "Rad na ličnom projektu": "Working on a personal project",
  "Pisanje izveštaja": "Writing a report",
  "Organizacija materijala": "Organising materials",
  "Samostalno učenje": "Studying on my own",
  "Ponavljanje gradiva": "Revising the material",
  "Rešavanje zadataka sa vežbi": "Solving exercise problems",
  "Priprema za ispit": "Preparing for an exam",
};

/** Writes one run's phases, translating each label into the run's language. */
function createPhases(
  store: FocusStore,
  ctx: DemoContext,
  phases: readonly CreateFocusSessionInput[],
  nowIso: string,
): void {
  for (const phase of phases) {
    if (ctx.locale === "en" && typeof phase.label === "string") {
      store.create({ ...phase, label: EN[phase.label] ?? phase.label }, nowIso);
      continue;
    }
    store.create(phase, nowIso);
  }
}

/** Who a work phase belongs to, weighted so „none" is still the common case — most Pomodoro blocks are unattached. */
const ATTACH_KINDS = ["subject", "subject", "task", "none", "none", "none"] as const;

/**
 * One Pomodoro run of `workCount` work phases starting at `startMs`, each
 * usually followed by a break whose kind (`short_break`/`long_break`) comes
 * from `nextPhase` — the SAME rule `armFocusAlarm`'s caller in the main
 * process follows, keyed off how many work phases this run has completed so
 * far. A run always starts fresh at zero, exactly as a freshly started
 * Pomodoro session does.
 *
 * Every phase gets a plausible outcome: most `work` phases run to their plan
 * (`completed`, with a second or two of overrun before the stop was hit —
 * nobody clicks the instant the alarm fires), the rest are abandoned partway
 * through (`stopped`, at a random fraction of the plan). Breaks are usually
 * taken in full and occasionally cut short or skipped outright.
 */
function buildPomodoroRun(
  rnd: DemoRandom,
  startMs: number,
  workCount: number,
  subjectIds: readonly string[],
  taskIds: readonly string[],
): CreateFocusSessionInput[] {
  const phases: CreateFocusSessionInput[] = [];
  let cursor = startMs;
  let completedWork = 0;

  for (let index = 0; index < workCount; index += 1) {
    const planned = rnd.chance(0.15) ? rnd.of([45, 50]) : DEFAULT_FOCUS_CONFIG.workMinutes;
    const completed = rnd.chance(0.78);
    const durationMinutes = completed
      ? planned + rnd.int(0, 2)
      : rnd.int(4, Math.max(5, planned - 3));
    const endMs = cursor + minutes(durationMinutes);
    completedWork += 1;

    phases.push(
      buildPhase(rnd, "work", cursor, endMs, planned, completed ? "completed" : "stopped", completedWork, {
        subjectIds,
        taskIds,
        labels: WORK_LABELS,
        labelChance: 0.4,
      }),
    );

    cursor = endMs + minutes(rnd.int(1, 4));

    const isLastWork = index === workCount - 1;
    if (rnd.chance(isLastWork ? 0.55 : 0.85)) {
      const breakKind = nextPhase(DEFAULT_FOCUS_CONFIG, completedWork) as Extract<
        FocusPhaseKind,
        "short_break" | "long_break"
      >;
      const breakPlanned =
        breakKind === "long_break"
          ? DEFAULT_FOCUS_CONFIG.longBreakMinutes
          : DEFAULT_FOCUS_CONFIG.shortBreakMinutes;
      const breakCompleted = rnd.chance(0.85);
      const breakDuration = breakCompleted ? breakPlanned : rnd.int(1, Math.max(2, breakPlanned - 1));
      const breakEndMs = cursor + minutes(breakDuration);

      phases.push(
        buildPhase(
          rnd,
          breakKind,
          cursor,
          breakEndMs,
          breakPlanned,
          breakCompleted ? "completed" : "stopped",
          completedWork,
          { subjectIds: [], taskIds: [], labels: [], labelChance: 0 },
        ),
      );
      cursor = breakEndMs + minutes(rnd.int(1, 5));
    }
  }

  return phases;
}

/**
 * STUDY's flavour of the same timer: 1-2 open-ended `work` phases with no
 * plan, always ended `stopped` (`FOCUS_OUTCOMES`'s rule — nothing to
 * "complete" without a plan), leaning much more heavily toward a subject than
 * a Pomodoro block does, since an open study session is usually about one.
 */
function buildStudyBlock(
  rnd: DemoRandom,
  startMs: number,
  subjectIds: readonly string[],
): CreateFocusSessionInput[] {
  const phases: CreateFocusSessionInput[] = [];
  let cursor = startMs;
  const blocks = rnd.chance(0.7) ? 1 : 2;

  for (let index = 0; index < blocks; index += 1) {
    const durationMinutes = rnd.int(20, 90);
    const endMs = cursor + minutes(durationMinutes);
    const subjectId = subjectIds.length > 0 && rnd.chance(0.7) ? rnd.of(subjectIds) : null;
    const label = rnd.chance(0.5) ? rnd.of(STUDY_LABELS) : null;
    const span = spanSeconds(cursor, endMs);
    const pausedSeconds = rnd.chance(0.2) ? Math.min(rnd.int(30, 180), Math.floor(span * 0.3)) : 0;

    phases.push({
      startedAt: iso(cursor),
      endedAt: iso(endMs),
      kind: "work",
      plannedMinutes: null,
      pausedSeconds,
      outcome: "stopped",
      cycleIndex: 0,
      subjectId,
      taskId: null,
      label,
    });

    cursor = endMs + minutes(rnd.int(5, 20));
  }

  return phases;
}

/** Builds one phase row, attaching a subject/task/label from the given pools when the roll and the pool allow it. */
function buildPhase(
  rnd: DemoRandom,
  kind: FocusPhaseKind,
  startMs: number,
  endMs: number,
  plannedMinutes: number,
  outcome: FocusOutcome,
  cycleIndex: number,
  attach: {
    subjectIds: readonly string[];
    taskIds: readonly string[];
    labels: readonly string[];
    labelChance: number;
  },
): CreateFocusSessionInput {
  const span = spanSeconds(startMs, endMs);
  const pausedSeconds = rnd.chance(0.25) ? Math.min(rnd.int(30, 240), Math.floor(span * 0.35)) : 0;

  const attachKind = rnd.of(ATTACH_KINDS);
  const subjectId =
    attachKind === "subject" && attach.subjectIds.length > 0 ? rnd.of(attach.subjectIds) : null;
  const taskId = attachKind === "task" && attach.taskIds.length > 0 ? rnd.of(attach.taskIds) : null;
  const label = attach.labels.length > 0 && rnd.chance(attach.labelChance) ? rnd.of(attach.labels) : null;

  return {
    startedAt: iso(startMs),
    endedAt: iso(endMs),
    kind,
    plannedMinutes,
    pausedSeconds,
    outcome,
    cycleIndex,
    subjectId,
    taskId,
    label,
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Whole seconds between two epoch-ms instants — the ceiling `pausedSeconds` may not exceed (`FocusStore.create`'s rule). */
function spanSeconds(startMs: number, endMs: number): number {
  return Math.floor((endMs - startMs) / 1000);
}
