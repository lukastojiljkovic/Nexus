import { FOCUS_PHASE_KINDS, nextPhase } from "@nexus/core";
import type { FocusConfig, FocusPhaseKind } from "@nexus/core";
import type { FocusSession } from "../../shared/ipc.js";
import { focusSessionMinutes } from "./focusFormat.js";

/**
 * „Fokus"'s page-level derivations — what a day of phases adds up to, and which
 * phase the cycle has earned next.
 *
 * A separate module from the page for `habitDone.ts`'s reason exactly: these are
 * RULES, and a rule living inside a `.tsx` is a rule nothing can test. Everything
 * here is pure — rows in, plain data out — and the cycle rule itself is not
 * re-derived at all: `nextPhase` is `@nexus/core`'s, so „every fourth one" has
 * one implementation and no off-by-one of its own.
 */

/** One kind's day: how many phases there were, and how many minutes of ATTENTION they held. */
export interface FocusKindTotal {
  sessions: number;
  minutes: number;
}

/** All three kinds, always — see `focusDayTotals` for why a zero is drawn rather than omitted. */
export type FocusDayTotals = Record<FocusPhaseKind, FocusKindTotal>;

/**
 * How many PLANNED work phases these rows hold — the number `nextPhase` counts
 * cycles in.
 *
 * Two exclusions, each a decision:
 *
 * - **An OPEN-ENDED work session does not count.** That is STUDY's timer, „uči
 *   dok ne staneš", and it is not a Pomodoro work phase: letting an afternoon of
 *   studying advance the cycle would push the timer into a long break nobody
 *   worked towards. One table, one history — but not one meaning for every row.
 * - **The outcome is irrelevant.** A phase stopped at nineteen minutes still
 *   happened, and the break after it is one that was worked for. `outcome`
 *   records HOW a phase ended, never whether it counts — the same rule
 *   `FocusStore.statsByKind` follows when it sums attention with no asterisk.
 */
export function plannedWorkPhases(sessions: readonly FocusSession[]): number {
  return sessions.filter((s) => s.kind === "work" && s.plannedMinutes !== null).length;
}

/** The phase a cycle has earned next: its kind, and the length this config gives that kind. */
export interface UpcomingPhase {
  kind: FocusPhaseKind;
  plannedMinutes: number;
}

/**
 * What to start next, given the config and the phases already behind you.
 *
 * Two rules, and only one of them is the engine's:
 *
 * - **After a BREAK it is always work.** `nextPhase` deliberately does not model
 *   this (its own note: a function taking one number could not tell a
 *   just-finished break from a just-finished work phase), so the caller has to
 *   look at what actually ran last. Without this, finishing a short break would
 *   go on suggesting the same short break — the work count has not moved, so the
 *   engine would keep answering the question it was last asked.
 * - **Otherwise `nextPhase` decides**, from the count of planned work phases.
 *   The long-break rule lives there and is not re-derived here.
 *
 * „Last" is by `startedAt`, with the id breaking a tie — `FocusStore`'s own
 * ordering, so this and the list on screen can never disagree about which phase
 * is the most recent one.
 *
 * The LENGTH is this function's only addition: it is a fact of the config rather
 * than of the rule, which is exactly why the engine does not return it.
 */
export function upcomingPhase(
  config: FocusConfig,
  sessions: readonly FocusSession[],
): UpcomingPhase {
  const latest = sessions.reduce<FocusSession | null>(
    (best, session) =>
      best === null ||
      session.startedAt > best.startedAt ||
      (session.startedAt === best.startedAt && session.id > best.id)
        ? session
        : best,
    null,
  );
  const kind =
    latest !== null && latest.kind !== "work"
      ? "work"
      : nextPhase(config, plannedWorkPhases(sessions));
  const minutes: Record<FocusPhaseKind, number> = {
    work: config.workMinutes,
    short_break: config.shortBreakMinutes,
    long_break: config.longBreakMinutes,
  };
  return { kind, plannedMinutes: minutes[kind] };
}

/**
 * A day's phases per kind: the count and the ATTENTION minutes (the wall span
 * less what was paused, through `focusSessionMinutes` — the one definition the
 * whole app sums focus with).
 *
 * **Every kind is present, zeros included**, unlike `FocusStore.statsByKind`
 * which omits a kind with nothing in range. The difference is the surface: the
 * store answers a query, the page makes a statement — and „0 pauza" is the
 * statement somebody who never stops needs to see. An absent row would read as
 * „no data" and say nothing at all.
 */
export function focusDayTotals(sessions: readonly FocusSession[]): FocusDayTotals {
  const totals = Object.fromEntries(
    FOCUS_PHASE_KINDS.map((kind) => [kind, { sessions: 0, minutes: 0 }]),
  ) as FocusDayTotals;
  for (const session of sessions) {
    const total = totals[session.kind];
    total.sessions += 1;
    total.minutes += focusSessionMinutes(session);
  }
  return totals;
}
