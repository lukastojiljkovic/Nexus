/**
 * The TIMERS module: what is counting down, and starting one.
 *
 * **Why starting a countdown is a dependency rather than a store call.** Every
 * other write in this folder goes straight to the store the IPC handler uses,
 * because the store IS the whole of what the handler does. A countdown is the
 * one exception: `TimersStore.createCountdown` writes the instant it ends, and
 * something in MAIN has to be armed to notice that instant passing (a toast for
 * a timer whose page is closed is the entire feature). That arming lives inside
 * the TIMERS module's own `register`, in the closure that re-arms after every
 * mutation — so this tool asks the host for it instead of writing a row that
 * would sit there and silently never fire.
 *
 * The shape below is deliberately the module's own vocabulary (`label`,
 * `durationSeconds`, and `TimersCountdown` back), so the wiring that supplies it
 * can be the module's handler path with nothing invented in between.
 */

import { MAX_TIMER_DURATION_SECONDS, MAX_TIMER_NAME_LENGTH } from "@nexus/db";
import type { TimersCountdown } from "@nexus/db";
import type { AssistantLocale, Tool } from "@nexus/core";
import { asArgs, asCount, asText } from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  formatClock,
  formatDuration,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
} from "./support.js";

/** The TIMERS module's own two entry points, as its main half owns them. */
export interface TimerHost {
  /** Starts a countdown AND arms main's clock for it — see the file header for why these are one call. */
  startCountdown(
    profileId: string,
    input: { readonly label: string; readonly durationSeconds: number },
  ): TimersCountdown;
  /** Every countdown this profile is running or has paused, in the store's own order. */
  listCountdowns(profileId: string): readonly TimersCountdown[];
}

export interface TimerToolDeps {
  readonly timers: TimerHost;
}

const TIMERS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Odbrojavanja (${count}):`,
  en: (count) => `Countdowns (${count}):`,
};

const NO_TIMERS: { sr: string; en: string } = {
  sr: "Trenutno ne radi nijedno odbrojavanje.",
  en: "No countdown is running right now.",
};

const TIMER_LINE: {
  readonly running: AssistantPhrase<[clock: string]>;
  readonly paused: AssistantPhrase<[left: string]>;
} = {
  running: {
    sr: (clock) => `ističe u ${clock}`,
    en: (clock) => `ends at ${clock}`,
  },
  paused: {
    sr: (left) => `pauza, ostalo ${left}`,
    en: (left) => `paused, ${left} left`,
  },
};

const START_SUMMARY: AssistantPhrase<[label: string, duration: string]> = {
  sr: (label, duration) => `Pokreni odbrojavanje „${label}“ na ${duration}`,
  en: (label, duration) => `Start a countdown “${label}” for ${duration}`,
};

const STARTED: AssistantPhrase<[label: string, id: string, duration: string]> = {
  sr: (label, id, duration) => `Pokrenuto odbrojavanje „${label}“ (${id}), ${duration}.`,
  en: (label, id, duration) => `Started countdown “${label}” (${id}), ${duration}.`,
};

export function timerTools(deps: TimerToolDeps): readonly Tool[] {
  const list: Tool = {
    name: "timers.list",
    description: {
      sr: "Izlistava odbrojavanja koja rade ili su pauzirana. Koristi ga kada korisnik pita koliko je ostalo ili koja odbrojavanja ima.",
      en: "Lists the countdowns that are running or paused. Use it when the user asks how much time is left or which countdowns they have.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const countdowns = deps.timers.listCountdowns(context.profileId);
        if (countdowns.length === 0) {
          return okResult(text(context.locale, NO_TIMERS));
        }
        return okResult(
          [
            phrase(context.locale, TIMERS_HEADING, countdowns.length),
            ...countdowns.map((countdown) => countdownLine(context.locale, countdown)),
          ].join("\n"),
        );
      }),
  };

  const start: Tool = {
    name: "timers.start",
    description: {
      sr: "Pokreće odbrojavanje sa imenom i trajanjem u sekundama; ono radi i kada stranica nije otvorena. Koristi ga kada korisnik kaže npr. „tajmer na 10 minuta“ (600 sekundi). Trajanje je najviše jedan dan.",
      en: "Starts a countdown with a label and a duration in seconds; it keeps running with the page closed. Use it when the user says e.g. \"a ten minute timer\" (600 seconds). The duration is at most one day.",
    },
    parameters: {
      type: "object",
      properties: {
        label: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TIMER_NAME_LENGTH,
          description: "What the countdown is for — the name the user will read.",
        },
        seconds: {
          type: "integer",
          minimum: 1,
          maximum: MAX_TIMER_DURATION_SECONDS,
          description: "How long it runs, in seconds (10 minutes is 600).",
        },
      },
      required: ["label", "seconds"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const label = asText(args.label, "label", MAX_TIMER_NAME_LENGTH);
        const seconds = asCount(args.seconds, "seconds", 1, MAX_TIMER_DURATION_SECONDS);

        const declined = await confirmOrDecline(
          context,
          "timers.start",
          "write",
          phrase(context.locale, START_SUMMARY, label, formatDuration(context.locale, seconds)),
        );
        if (declined !== null) return declined;

        const countdown = deps.timers.startCountdown(context.profileId, {
          label,
          durationSeconds: seconds,
        });
        return okResult(
          phrase(
            context.locale,
            STARTED,
            countdown.label,
            countdown.id,
            formatDuration(context.locale, seconds),
          ),
          { navigateTo: { module: "timers" } },
        );
      }),
  };

  return [list, start];
}

/**
 * One countdown as a line: its label, and either the clock it ends on (a running
 * one stores the instant, never a remaining count, so the reading stays true
 * whatever time it is read at) or the seconds it still owes.
 */
function countdownLine(locale: AssistantLocale, countdown: TimersCountdown): string {
  const id = countdown.id;
  if (countdown.endsAt !== null) {
    const at = Date.parse(countdown.endsAt);
    const reading = Number.isNaN(at)
      ? countdown.endsAt
      : formatClock(locale, at);
    return `- ${id} ${countdown.label} (${phrase(locale, TIMER_LINE.running, reading)})`;
  }
  return `- ${id} ${countdown.label} (${phrase(
    locale,
    TIMER_LINE.paused,
    formatDuration(locale, countdown.remainingSeconds ?? 0),
  )})`;
}
