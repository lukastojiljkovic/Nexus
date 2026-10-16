/**
 * The FOKUS module's running phase: start, stop, pause, resume and read it.
 *
 * **Why the host is main's, not the page's.** The running phase is main-process
 * runtime state keyed by profile (`main/index.ts`'s `runningFocusSessions`), not a
 * store row and not page state, so a tool can drive it from main directly without
 * an `action` for the page to apply. The closures that do the work live beside the
 * IPC handlers and the host is built over them, so the assistant and the page
 * cannot disagree about whether a phase is running.
 */

import { FOCUS_PHASE_KINDS, phaseProgress } from "@nexus/core";
import { MAX_FOCUS_LABEL_LENGTH, MAX_FOCUS_PLANNED_MINUTES } from "@nexus/db";
import type { AssistantLocale, Tool } from "@nexus/core";
import type { FocusSession, RunningFocusSession } from "../../../shared/ipc.js";
import { asArgs, asCount, asOptionalEnum, asOptionalText } from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  failResult,
  formatDuration,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
} from "./support.js";

/** The focus timer as main owns it. Every method is per profile, as the timer is. */
export interface FocusHost {
  /** Starts a phase from the IPC payload's own fields; refuses a second start. */
  start(profileId: string, body: Readonly<Record<string, unknown>>): RunningFocusSession;
  /** Ends the phase and persists exactly one row, or `null` when there was nothing to persist. */
  stop(profileId: string): FocusSession | null;
  /** Drops the phase without persisting anything. */
  cancel(profileId: string): void;
  pause(profileId: string): RunningFocusSession;
  resume(profileId: string): RunningFocusSession;
  /** The running phase, or `null` when none runs. */
  status(profileId: string): RunningFocusSession | null;
}

export interface FocusToolDeps {
  readonly focus: FocusHost;
  /** Main's wall clock, for the remaining time a status reading states. */
  readonly now: () => number;
}

const KIND_NAME: Record<(typeof FOCUS_PHASE_KINDS)[number], { sr: string; en: string }> = {
  work: { sr: "rad", en: "work" },
  short_break: { sr: "kratka pauza", en: "short break" },
  long_break: { sr: "duga pauza", en: "long break" },
};

const NONE_RUNNING: { sr: string; en: string } = {
  sr: "Trenutno ne radi nijedna faza fokusa.",
  en: "No focus phase is running right now.",
};

const ALREADY_RUNNING: { sr: string; en: string } = {
  sr: "faza fokusa već radi. Zaustavi je ili je otkaži pre nove.",
  en: "a focus phase is already running. Stop or cancel it first.",
};

const NOTHING_TO_END: { sr: string; en: string } = {
  sr: "nijedna faza fokusa ne radi.",
  en: "no focus phase is running.",
};

const STATUS: AssistantPhrase<[kind: string, plan: string, state: string]> = {
  sr: (kind, plan, state) => `Radi faza fokusa: ${kind}, ${plan}, ${state}.`,
  en: (kind, plan, state) => `A focus phase is running: ${kind}, ${plan}, ${state}.`,
};

const PLAN: AssistantPhrase<[duration: string]> = {
  sr: (duration) => `plan ${duration}`,
  en: (duration) => `planned for ${duration}`,
};

const OPEN_ENDED: { sr: string; en: string } = { sr: "bez plana", en: "no plan" };

const PAUSED: { sr: string; en: string } = { sr: "pauzirano", en: "paused" };

const START_SUMMARY: AssistantPhrase<[kind: string, duration: string]> = {
  sr: (kind, duration) => `Pokreni fazu fokusa: ${kind}${duration}.`,
  en: (kind, duration) => `Start a focus phase: ${kind}${duration}.`,
};

const STOP_SUMMARY: { sr: string; en: string } = {
  sr: "Zaustavi fazu fokusa i sačuvaj je u istoriji.",
  en: "Stop the focus phase and save it to the history.",
};

const DISCARD_SUMMARY: { sr: string; en: string } = {
  sr: "Otkaži fazu fokusa bez čuvanja.",
  en: "Cancel the focus phase without saving it.",
};

const PAUSE_SUMMARY: { sr: string; en: string } = {
  sr: "Pauziraj fazu fokusa.",
  en: "Pause the focus phase.",
};

const RESUME_SUMMARY: { sr: string; en: string } = {
  sr: "Nastavi fazu fokusa.",
  en: "Resume the focus phase.",
};

const STARTED: AssistantPhrase<[kind: string, duration: string]> = {
  sr: (kind, duration) => `Pokrenuta faza fokusa: ${kind}${duration}.`,
  en: (kind, duration) => `Started a focus phase: ${kind}${duration}.`,
};

const SAVED: AssistantPhrase<[id: string, minutes: number]> = {
  sr: (id, minutes) => `Faza fokusa je zaustavljena i sačuvana (${id}), ${String(minutes)} min rada.`,
  en: (id, minutes) => `Focus phase stopped and saved (${id}), ${String(minutes)} min of work.`,
};

const DISCARDED: { sr: string; en: string } = {
  sr: "Faza fokusa je otkazana. Ništa nije sačuvano.",
  en: "Focus phase cancelled. Nothing was saved.",
};

const PAUSED_DONE: AssistantPhrase<[left: string]> = {
  sr: (left) => `Faza fokusa je pauzirana, ${left}.`,
  en: (left) => `Focus phase paused, ${left}.`,
};

const RESUMED: AssistantPhrase<[left: string]> = {
  sr: (left) => `Faza fokusa je nastavljena, ${left}.`,
  en: (left) => `Focus phase resumed, ${left}.`,
};

/** The planned-minutes wording: the duration after a lead-in, or nothing for an open-ended phase. */
function planSuffix(locale: AssistantLocale, minutes: number | null, lead: string): string {
  return minutes === null ? "" : `${lead}${formatDuration(locale, minutes * 60)}`;
}

export function focusTools(deps: FocusToolDeps): readonly Tool[] {
  const status: Tool = {
    name: "focus.status",
    description: {
      sr: "Kaže da li radi faza fokusa (Pomodoro), koja je, koliko je ostalo i da li je pauzirana. Koristi ga kada korisnik pita šta radi ili koliko mu je ostalo.",
      en: "Says whether a focus phase (Pomodoro) is running, which one, how much time is left and whether it is paused. Use it when the user asks what is running or how much time is left.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const phase = deps.focus.status(context.profileId);
        if (phase === null) return okResult(text(context.locale, NONE_RUNNING));
        return okResult(statusLine(context.locale, phase, new Date(deps.now()).toISOString()));
      }),
  };

  const start: Tool = {
    name: "focus.start",
    description: {
      sr: "Pokreće fazu fokusa (Pomodoro): rad ili pauzu, sa planom u minutima i opcionim nazivom. Koristi ga kada korisnik kaže „pokreni fokus“ ili „Pomodoro na 25 minuta“.",
      en: "Starts a focus phase (Pomodoro): work or a break, with a plan in minutes and an optional name. Use it when the user says \"start focus\" or \"a 25 minute Pomodoro\".",
    },
    parameters: {
      type: "object",
      properties: {
        minutes: {
          type: "integer",
          minimum: 1,
          maximum: MAX_FOCUS_PLANNED_MINUTES,
          description: "The planned length in minutes (25 for a standard Pomodoro). Omit for an open-ended phase.",
        },
        kind: {
          type: "string",
          enum: [...FOCUS_PHASE_KINDS],
          description: "work (the default), short_break or long_break.",
        },
        label: {
          type: "string",
          maxLength: MAX_FOCUS_LABEL_LENGTH,
          description: "What the phase is for, as the user will read it.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const minutes =
          args.minutes === undefined
            ? undefined
            : asCount(args.minutes, "minutes", 1, MAX_FOCUS_PLANNED_MINUTES);
        const kind = asOptionalEnum(args.kind, "kind", FOCUS_PHASE_KINDS) ?? "work";
        const label = asOptionalText(args.label, "label", MAX_FOCUS_LABEL_LENGTH);
        if (deps.focus.status(context.profileId) !== null) {
          return failResult(context.locale, text(context.locale, ALREADY_RUNNING));
        }

        const kindText = text(context.locale, KIND_NAME[kind]);
        const planText = planSuffix(context.locale, minutes ?? null, ", ");
        const declined = await confirmOrDecline(
          context,
          "focus.start",
          "write",
          phrase(context.locale, START_SUMMARY, kindText, planText),
        );
        if (declined !== null) return declined;

        const phase = deps.focus.start(context.profileId, {
          kind,
          plannedMinutes: minutes ?? null,
          label: label ?? null,
        });
        return okResult(
          phrase(context.locale, STARTED, kindText, planSuffix(context.locale, phase.plannedMinutes, ", ")),
          { navigateTo: { module: "focus" } },
        );
      }),
  };

  const stop: Tool = {
    name: "focus.stop",
    description: {
      sr: "Zaustavlja fazu fokusa i čuva je u istoriji, ili je otkazuje bez čuvanja kada korisnik kaže da je odbaci. Koristi ga kada korisnik kaže „zaustavi fokus“.",
      en: "Stops the focus phase and saves it to the history, or cancels it without saving when the user says to discard it. Use it when the user says \"stop focus\".",
    },
    parameters: {
      type: "object",
      properties: {
        discard: {
          type: "boolean",
          description: "true to cancel the phase without saving it; false or omitted to save it.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const discard = asArgs(rawArgs).discard === true;
        if (deps.focus.status(context.profileId) === null) {
          return failResult(context.locale, text(context.locale, NOTHING_TO_END));
        }
        const declined = await confirmOrDecline(
          context,
          "focus.stop",
          "write",
          text(context.locale, discard ? DISCARD_SUMMARY : STOP_SUMMARY),
        );
        if (declined !== null) return declined;

        if (discard) {
          deps.focus.cancel(context.profileId);
          return okResult(text(context.locale, DISCARDED));
        }
        const session = deps.focus.stop(context.profileId);
        if (session === null) {
          return okResult(text(context.locale, DISCARDED));
        }
        const attentionSeconds =
          (Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 1000 -
          session.pausedSeconds;
        return okResult(
          phrase(
            context.locale,
            SAVED,
            session.id,
            Math.max(0, Math.floor(attentionSeconds / 60)),
          ),
          { navigateTo: { module: "focus", item: session.id } },
        );
      }),
  };

  const pause: Tool = pauseOrResume(deps, {
    name: "focus.pause",
    description: {
      sr: "Pauzira fazu fokusa, bez prekida plana. Koristi ga kada korisnik kaže da pauzira fokus.",
      en: "Pauses the focus phase without ending its plan. Use it when the user says to pause focus.",
    },
    summary: PAUSE_SUMMARY,
    done: PAUSED_DONE,
    act: (profileId) => deps.focus.pause(profileId),
  });
  const resume: Tool = pauseOrResume(deps, {
    name: "focus.resume",
    description: {
      sr: "Nastavlja pauziranu fazu fokusa. Koristi ga kada korisnik kaže da nastavi fokus.",
      en: "Resumes a paused focus phase. Use it when the user says to resume focus.",
    },
    summary: RESUME_SUMMARY,
    done: RESUMED,
    act: (profileId) => deps.focus.resume(profileId),
  });

  return [status, start, stop, pause, resume];
}

/** Pause and resume differ only in the host call, the copy and the sentence they answer with. */
function pauseOrResume(
  deps: FocusToolDeps,
  spec: {
    readonly name: "focus.pause" | "focus.resume";
    readonly description: { readonly sr: string; readonly en: string };
    readonly summary: { readonly sr: string; readonly en: string };
    readonly done: AssistantPhrase<[left: string]>;
    readonly act: (profileId: string) => RunningFocusSession;
  },
): Tool {
  return {
    name: spec.name,
    description: spec.description,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "write",
    run: (_rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        if (deps.focus.status(context.profileId) === null) {
          return failResult(context.locale, text(context.locale, NOTHING_TO_END));
        }
        const declined = await confirmOrDecline(
          context,
          spec.name,
          "write",
          text(context.locale, spec.summary),
        );
        if (declined !== null) return declined;
        const updated = spec.act(context.profileId);
        const left = remainingCopy(updated, new Date(deps.now()).toISOString());
        return okResult(phrase(context.locale, spec.done, text(context.locale, left)));
      }),
  };
}

/** The phase's own time left as a fragment both locales share, or the open-ended note. */
function remainingCopy(phase: RunningFocusSession, now: string): { sr: string; en: string } {
  if (phase.plannedMinutes === null) return OPEN_ENDED;
  const { remainingSeconds } = phaseProgress(phase, now);
  if (remainingSeconds <= 0) return { sr: "plan je istekao", en: "the plan has run out" };
  return {
    sr: `preostalo ${formatDuration("sr", remainingSeconds)}`,
    en: `${formatDuration("en", remainingSeconds)} left`,
  };
}

/** One line for `focus.status`: kind, plan, and the state it is in. */
function statusLine(locale: AssistantLocale, phase: RunningFocusSession, now: string): string {
  const kind = text(locale, KIND_NAME[phase.kind]);
  const plan =
    phase.plannedMinutes === null
      ? text(locale, OPEN_ENDED)
      : phrase(locale, PLAN, formatDuration(locale, phase.plannedMinutes * 60));
  const state =
    phase.pausedAt !== null
      ? text(locale, PAUSED)
      : text(locale, remainingCopy(phase, now));
  return phrase(locale, STATUS, kind, plan, state);
}

