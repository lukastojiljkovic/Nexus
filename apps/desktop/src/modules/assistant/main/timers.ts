import { TimersStore, type TimersCountdown } from "@nexus/db";
import type { ModuleText } from "@nexus/core";
import type { TimerHost } from "../../../main/assistant/tools/timers.js";

/**
 * THE TIMERS HOST the assistant's `timers.*` tools are built against, in this
 * module rather than in main's `index.ts`.
 *
 * **Why it is here.** `tools/timers.ts` was written against a `TimerHost` - the
 * TIMERS module's own arming path, so that a countdown the assistant starts is
 * the same countdown that module's page shows and that main's clock announces.
 * That host belongs to the timers module's `register.ts`, which builds it inside
 * its own closure and exports none of it; a second copy of the arming arithmetic
 * in `index.ts` would be exactly the kind of drift this repository refuses (the
 * hop policy alone is a rule with a comment about suspended machines).
 *
 * **So this file borrows the two halves instead of copying them.** The ROW is
 * written by `TimersStore` - the same store the timers module writes through, so
 * its CHECKs, its whole-seconds arithmetic and its ordering apply unchanged - and
 * the ALARM is armed through the kit's own `armUntil` (`ctx.armUntil` in
 * `register.ts`), which is the same bounded-hop scheduler the timers module is
 * handed. What is genuinely the assistant's is the sentence the toast carries:
 * a module that starts a timer on somebody's behalf says so.
 *
 * **Alarms follow the row, not the call.** The page's own alarms are armed by
 * `register.ts`, which does not hear about a countdown this host paused, resumed
 * or cancelled. So an alarm here is disarmed when its countdown is paused or
 * cancelled, and when one fires it announces only if the row still ends at the
 * instant it was set for; anything else is a newer end with its own alarm.
 */

/** The two capabilities the kit hands this module, narrowed to what a timer needs. */
export interface TimerArming {
  armUntil(atMs: number, run: () => void): () => void;
  notify(copy: { readonly title: ModuleText; readonly body: ModuleText }, silent?: boolean): void;
}

/** The toast copy, in both languages: a countdown the assistant started, named exactly as the user named it. */
const TIMER_COPY: {
  readonly title: ModuleText;
  readonly done: (label: string) => ModuleText;
} = {
  title: { sr: "Tajmeri", en: "Timers" },
  done: (label) => ({
    sr: `„${label}“ — vreme je isteklo.`,
    en: `"${label}" — time is up.`,
  }),
};

/**
 * The host. One per profile, holding the store, the arming pair and the cancel
 * function of each alarm this host armed. The kit owns the timers it armed (it
 * cancels them at a session end), so nothing here outlives the session it serves.
 */
export function createAssistantTimerHost(deps: {
  readonly store: TimersStore;
  readonly arming: TimerArming;
  readonly now: () => number;
}): TimerHost {
  /** The cancel function of each countdown's live alarm, by countdown id. */
  const alarms = new Map<string, () => void>();

  function disarm(countdownId: string): void {
    alarms.get(countdownId)?.();
    alarms.delete(countdownId);
  }

  /** Arms the alarm for a countdown's current end, replacing the one it had. A paused countdown has no end, so no alarm. */
  function arm(countdown: TimersCountdown): void {
    disarm(countdown.id);
    const endsAt = countdown.endsAt;
    if (endsAt === null) return;
    alarms.set(
      countdown.id,
      deps.arming.armUntil(Date.parse(endsAt), () => finish(countdown.id, endsAt)),
    );
  }

  /** Announces and removes a countdown whose alarm fired, if the row still ends when that alarm was set for. */
  function finish(countdownId: string, endsAt: string): void {
    const row = deps.store.countdown(countdownId);
    if (row === null || row.endsAt !== endsAt) return;
    alarms.delete(countdownId);
    deps.arming.notify(
      { title: TIMER_COPY.title, body: TIMER_COPY.done(row.label) },
      !deps.store.settings().soundOnEnd,
    );
    // Removing the finished countdown is the TIMERS module's own rule: a
    // countdown that has run out has nothing left to be, and its record is the
    // announcement it produced.
    deps.store.cancelCountdown(countdownId);
  }

  return {
    startCountdown(_profileId, input): TimersCountdown {
      const countdown = deps.store.createCountdown(input, instant(deps.now()));
      arm(countdown);
      return countdown;
    },

    listCountdowns(): readonly TimersCountdown[] {
      return deps.store.listCountdowns();
    },

    pauseCountdown(_profileId, countdownId): TimersCountdown {
      const countdown = deps.store.pauseCountdown(countdownId, instant(deps.now()));
      disarm(countdownId);
      return countdown;
    },

    resumeCountdown(_profileId, countdownId): TimersCountdown {
      const countdown = deps.store.resumeCountdown(countdownId, instant(deps.now()));
      arm(countdown);
      return countdown;
    },

    cancelCountdown(_profileId, countdownId): void {
      deps.store.cancelCountdown(countdownId);
      disarm(countdownId);
    },
  };
}

/** The instant a store write is stamped with. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}
