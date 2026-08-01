/**
 * FOCUS's pure engine — the Pomodoro rules, and the arithmetic that says how far
 * into a phase you are. No I/O, no `Date.now()`: every function takes `now` as an
 * explicit ISO instant, `computeHabitStreak`'s idiom exactly, so the same inputs
 * always give the same answer and a test never has to freeze a clock.
 *
 * **One row is one PHASE, not one cycle.** The honest unit for „koliko sam danas
 * fokusiran bio" is a stretch of time with a real start and a real end. A whole
 * cycle would have to model its own interruptions internally — a pause here, a
 * phone call there — and the moment it does, the sum of the parts stops being
 * checkable against the wall clock. A phase is checkable, so a phase is the row.
 *
 * **A focus session is a period of deliberate attention, optionally planned,
 * optionally attached to a subject or a task.** That one sentence is what lets
 * STUDY's open-ended timer and a Pomodoro phase be the same thing: the study
 * timer is a `work` phase with no plan (`plannedMinutes` null), a Pomodoro work
 * phase is one with a plan, and a break is a phase whose kind says so. There is
 * exactly one focus timer in this product, and this is its vocabulary.
 *
 * **The RUNNING phase is deliberately not a database row** (migration 008's
 * decision, upheld): it lives as main-process runtime state, so a crash loses the
 * in-progress timer honestly rather than persisting a duration nobody observed.
 * That is why `phaseProgress` takes a `pausedAt` this module's storage has no
 * column for — pausing is a fact about the running phase, and the accumulated
 * `pausedSeconds` is written once, with the finished row.
 *
 * **Progress is WALL-CLOCK, never a tick count.** A timer that counts its own
 * ticks lies the moment the machine sleeps, the tab is throttled, or a frame is
 * dropped — it would report twenty minutes of focus for a laptop that spent
 * fifteen of them shut. Everything here is derived from two instants and an
 * accumulator, so a phase that survives a suspend reports the truth about it.
 */

/** The three kinds of phase, and there is no fourth. */
export const FOCUS_PHASE_KINDS = ["work", "short_break", "long_break"] as const;
export type FocusPhaseKind = (typeof FOCUS_PHASE_KINDS)[number];

/**
 * How a finished phase ended: run to its planned end, or stopped by hand before
 * it. Two values and no third — in particular nothing for „abandoned", because a
 * running phase is never a row (see the file header), so there is no such thing
 * as a stored phase whose end nobody witnessed. Every persisted row is a real,
 * observed, positive duration, which is what lets the history be summed without
 * a rule about which outcomes are allowed to count.
 *
 * An open-ended session (STUDY's timer, no plan) carries `stopped`: it was ended
 * by hand, because there was no planned end for it to reach.
 */
export const FOCUS_OUTCOMES = ["completed", "stopped"] as const;
export type FocusOutcome = (typeof FOCUS_OUTCOMES)[number];

/**
 * One profile's Pomodoro shape. Minutes rather than seconds, because that is the
 * unit the user sets it in and storing a second nobody can enter would only
 * invite a rounding question later.
 */
export interface FocusConfig {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** How many WORK phases run before the long break — the classic four. */
  cyclesBeforeLongBreak: number;
}

/** The classic 25/5/15/4. Chosen, not sacred: this constant is the only place it lives. */
export const DEFAULT_FOCUS_CONFIG: FocusConfig = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  cyclesBeforeLongBreak: 4,
};

/**
 * The bounds each field is accepted inside. They are sanity caps, not opinions:
 * three hours is already far past what anybody sustains in one sitting, an hour
 * of „short" break is not short, and a cycle of thirteen work phases before a
 * long break is a config nobody meant to type. A bound is cheaper than
 * discovering the absence of one, exactly as `MAX_HABIT_COUNT` is one module over.
 */
const FOCUS_BOUNDS: Readonly<Record<keyof FocusConfig, readonly [number, number]>> = {
  workMinutes: [1, 180],
  shortBreakMinutes: [1, 60],
  longBreakMinutes: [1, 120],
  cyclesBeforeLongBreak: [1, 12],
};

/**
 * A validation ANSWER rather than an exception — the caller here is a settings
 * form and a store boundary, both of which want to say which field is wrong
 * rather than catch something.
 *
 * `field` is `null` when the value was not a config at all (not a record, a
 * missing key, an unknown extra one): there is no single field to blame for
 * „this is not the shape", and pretending there is would point a form's error at
 * an input the user never touched.
 */
export type FocusConfigResult =
  | { ok: true; config: FocusConfig }
  | { ok: false; field: keyof FocusConfig | null };

const CONFIG_KEYS = Object.keys(FOCUS_BOUNDS) as ReadonlyArray<keyof FocusConfig>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structural validation of an untrusted config into a fresh, canonical one —
 * `validateHabitSchedule`'s contract in this vocabulary, except that it names the
 * offending field instead of collapsing every refusal into `null`.
 *
 * Exactly these four keys, no more and no fewer (`habitSchedule.ts`'s rule): an
 * unknown key means the value was not produced by this module, and silently
 * ignoring it would let a renamed field go on being read as its own default.
 * Never returns the caller's own object, so a config that came back from here
 * cannot be mutated from under its holder.
 */
export function validateFocusConfig(value: unknown): FocusConfigResult {
  if (!isRecord(value)) return { ok: false, field: null };
  if (Object.keys(value).length !== CONFIG_KEYS.length) return { ok: false, field: null };

  for (const key of CONFIG_KEYS) {
    if (!(key in value)) return { ok: false, field: null };
  }
  for (const key of CONFIG_KEYS) {
    const [min, max] = FOCUS_BOUNDS[key];
    const raw = value[key];
    // Whole minutes only: „25.5 minuta" is not something a timer is set in, and
    // a fractional cycle length is not a count of anything.
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
      return { ok: false, field: key };
    }
  }

  return {
    ok: true,
    config: {
      workMinutes: value.workMinutes as number,
      shortBreakMinutes: value.shortBreakMinutes as number,
      longBreakMinutes: value.longBreakMinutes as number,
      cyclesBeforeLongBreak: value.cyclesBeforeLongBreak as number,
    },
  };
}

/**
 * Which phase should follow, given how many WORK phases have been completed so
 * far. The one place the long-break rule lives, so no caller ever re-derives
 * „every fourth one" and gets the off-by-one wrong.
 *
 * `0` means nothing has been finished yet, so the answer is `work` — a session
 * opens on work, and a break before any work is not one anybody earned. Every
 * other count answers „what follows the work phase you just finished": the long
 * break on each multiple of `cyclesBeforeLongBreak`, a short one otherwise.
 *
 * What follows a BREAK is deliberately not asked here, because it needs no rule:
 * it is always work, in every config, and a function taking one number could not
 * tell a just-finished break from a just-finished work phase anyway. The caller
 * counts work phases; this decides what they have earned.
 *
 * A count that is not a whole positive number — negative, fractional, `NaN` —
 * reads as „none completed" rather than throwing: this is the pure half of a
 * timer, and the honest answer to a nonsensical tally is the phase a session
 * starts on.
 *
 * `config` is expected to have been through `validateFocusConfig`, exactly as
 * `computeHabitStreak` expects a validated `HabitSchedule`.
 */
export function nextPhase(config: FocusConfig, completedWorkPhases: number): FocusPhaseKind {
  if (!Number.isInteger(completedWorkPhases) || completedWorkPhases <= 0) return "work";
  return completedWorkPhases % config.cyclesBeforeLongBreak === 0 ? "long_break" : "short_break";
}

/**
 * The running phase's own timing, as the main process holds it. Not a database
 * row: `pausedAt` in particular has no column, because a paused phase is by
 * definition still running (see the file header).
 *
 * `plannedMinutes` is `null` for an open-ended session — STUDY's timer, which
 * runs until you stop it.
 *
 * `pausedSeconds` accumulates the pauses that have ENDED. The pause currently
 * running is not in it; it is `pausedAt` instead, and folding the two together
 * is what `resume` does.
 */
export interface FocusPhaseTiming {
  startedAt: string;
  plannedMinutes: number | null;
  pausedAt: string | null;
  pausedSeconds: number;
}

/**
 * How far into a phase you are. `remainingSeconds` and `overrunSeconds` are
 * never both positive, and neither is ever negative: before the planned end one
 * counts down, after it the other counts up.
 */
export interface FocusPhaseProgress {
  elapsedSeconds: number;
  remainingSeconds: number;
  overrunSeconds: number;
  isPaused: boolean;
}

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/**
 * A phase's progress at `now`, from the wall clock alone.
 *
 * **The clock stops while paused.** A paused phase is measured to `pausedAt`
 * rather than to `now`, so its numbers are frozen for as long as it stays
 * paused — the pause currently running is excluded by construction, without ever
 * being added to `pausedSeconds` and having to be taken back out.
 *
 * **Overrun is real and it is representable.** When the planned end passes and
 * nobody has acknowledged it, `remainingSeconds` sits at `0` and
 * `overrunSeconds` grows. Nothing here ends the phase: a pure function that
 * quietly decided a phase was over would be inventing an end time, and the end
 * time is the one thing a focus row must not invent. Ending it is a deliberate
 * act, and it belongs to whoever holds the clock.
 *
 * **No plan means no verdict.** With `plannedMinutes` null there is nothing to
 * be short of and nothing to exceed, so both counters stay `0` while
 * `elapsedSeconds` runs — an open-ended session cannot overrun a plan it does
 * not have.
 *
 * Elapsed time is TRUNCATED, not rounded: a second is counted once it has
 * actually passed, so the display never shows time that has not elapsed yet. A
 * `now` before the start, or an accumulator larger than the clock, floors at
 * zero rather than going negative — as does an instant that will not parse,
 * which is read as no elapsed time rather than allowed to poison the arithmetic
 * with `NaN`.
 */
export function phaseProgress(session: FocusPhaseTiming, now: string): FocusPhaseProgress {
  const isPaused = session.pausedAt !== null;
  const startMs = Date.parse(session.startedAt);
  const untilMs = Date.parse(session.pausedAt ?? now);

  const rawSeconds =
    Math.floor((untilMs - startMs) / MS_PER_SECOND) - Math.floor(session.pausedSeconds);
  const elapsedSeconds = Number.isFinite(rawSeconds) ? Math.max(0, rawSeconds) : 0;

  if (session.plannedMinutes === null) {
    return { elapsedSeconds, remainingSeconds: 0, overrunSeconds: 0, isPaused };
  }

  const plannedSeconds = session.plannedMinutes * SECONDS_PER_MINUTE;
  return {
    elapsedSeconds,
    remainingSeconds: Math.max(0, plannedSeconds - elapsedSeconds),
    overrunSeconds: Math.max(0, elapsedSeconds - plannedSeconds),
    isPaused,
  };
}
