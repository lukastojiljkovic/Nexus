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
 * The host. One per profile, holding nothing but the store and the arming pair -
 * the kit owns the timers it armed (it cancels them at a session end), so this
 * object has no lifetime of its own to manage.
 */
export function createAssistantTimerHost(deps: {
  readonly store: TimersStore;
  readonly arming: TimerArming;
  readonly now: () => number;
}): TimerHost {
  return {
    startCountdown(
      _profileId: string,
      input: { readonly label: string; readonly durationSeconds: number },
    ): TimersCountdown {
      const countdown = deps.store.createCountdown(input, instant(deps.now()));
      const soundOn = deps.store.settings().soundOnEnd;
      if (countdown.endsAt !== null) {
        deps.arming.armUntil(Date.parse(countdown.endsAt), () => {
          deps.arming.notify(
            { title: TIMER_COPY.title, body: TIMER_COPY.done(countdown.label) },
            !soundOn,
          );
          // Removing the finished countdown is the TIMERS module's own rule: a
          // countdown that has run out has nothing left to be, and its record is
          // the announcement it produced.
          try {
            deps.store.cancelCountdown(countdown.id);
          } catch {
            // The user may have cancelled it first, which is the ordinary way a
            // countdown ends early - and not a failure to report.
          }
        });
      }
      return countdown;
    },

    listCountdowns(): readonly TimersCountdown[] {
      return deps.store.listCountdowns();
    },
  };
}

/** The instant a store write is stamped with. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}
