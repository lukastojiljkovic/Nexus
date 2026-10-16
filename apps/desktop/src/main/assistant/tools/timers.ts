/**
 * The TIMERS module: what is counting down, what is saved as a preset, the
 * sound preference, the stopwatch, and starting a countdown.
 *
 * **Why countdown changes go through the host.** Every other write in this folder
 * goes straight to the store the IPC handler uses, because the store IS the whole
 * of what the handler does. A countdown is the exception: `TimersStore` writes
 * the instant it ends, and something in MAIN has to be armed to notice that
 * instant passing (a toast for a timer whose page is closed is the entire
 * feature). That arming lives inside the TIMERS module's own `register`, in the
 * closure that re-arms after every mutation — so starting, pausing, resuming and
 * cancelling a countdown ask the host for it instead of writing a row that would
 * sit there and silently never fire, or keep firing after it was paused.
 *
 * **Presets and the sound preference write through the store.** Neither has a
 * clock attached, so the store is the whole of what the module's handler does.
 *
 * **The stopwatch is the page's.** Its reading is measured in the page and no main
 * state holds it, so the tool asks the timers page to apply a command
 * (`navigateTo.action`) and reads nothing back.
 */

import { MAX_TIMER_DURATION_SECONDS, MAX_TIMER_NAME_LENGTH, TimersStore } from "@nexus/db";
import type { TimersCountdown, TimersPreset } from "@nexus/db";
import { foldSearchText } from "@nexus/core";
import type { AssistantLocale, Tool } from "@nexus/core";
import { asArgs, asCount, asEnum, asOptionalBoolean, asText } from "./args.js";
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
  type ProfileDb,
} from "./support.js";

/** The TIMERS module's countdown entry points, as its main half owns them. */
export interface TimerHost {
  /** Starts a countdown AND arms main's clock for it — see the file header for why these are one call. */
  startCountdown(
    profileId: string,
    input: { readonly label: string; readonly durationSeconds: number },
  ): TimersCountdown;
  /** Every countdown this profile is running or has paused, in the store's own order. */
  listCountdowns(profileId: string): readonly TimersCountdown[];
  /** Freezes a running countdown and disarms its alarm. */
  pauseCountdown(profileId: string, id: string): TimersCountdown;
  /** Starts a paused countdown again, from the time it still owed, and arms its alarm. */
  resumeCountdown(profileId: string, id: string): TimersCountdown;
  /** Removes a countdown and disarms its alarm. */
  cancelCountdown(profileId: string, id: string): void;
}

export interface TimerToolDeps {
  readonly timers: TimerHost;
  /** Presets and the sound preference are plain store writes. */
  readonly profileDb: ProfileDb;
  /** Main's wall clock, injected so a test can move it. */
  readonly now: () => number;
}

const PRESET_ACTIONS = ["save", "rename", "delete", "start"] as const;
const STOPWATCH_ACTIONS = ["start", "stop", "lap", "reset"] as const;
type StopwatchAction = (typeof STOPWATCH_ACTIONS)[number];

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

const PAUSE_SUMMARY: AssistantPhrase<[label: string]> = {
  sr: (label) => `Pauziraj odbrojavanje „${label}“`,
  en: (label) => `Pause the countdown “${label}”`,
};

const PAUSED: AssistantPhrase<[label: string, id: string, left: string]> = {
  sr: (label, id, left) => `Pauzirano odbrojavanje „${label}“ (${id}), ostalo ${left}.`,
  en: (label, id, left) => `Paused countdown “${label}” (${id}), ${left} left.`,
};

const RESUME_SUMMARY: AssistantPhrase<[label: string]> = {
  sr: (label) => `Nastavi odbrojavanje „${label}“`,
  en: (label) => `Resume the countdown “${label}”`,
};

const RESUMED: AssistantPhrase<[label: string, id: string, clock: string]> = {
  sr: (label, id, clock) => `Nastavljeno odbrojavanje „${label}“ (${id}), ističe u ${clock}.`,
  en: (label, id, clock) => `Resumed countdown “${label}” (${id}), ends at ${clock}.`,
};

const CANCEL_SUMMARY: AssistantPhrase<[label: string]> = {
  sr: (label) => `Otkaži odbrojavanje „${label}“`,
  en: (label) => `Cancel the countdown “${label}”`,
};

const CANCELLED: AssistantPhrase<[label: string, id: string]> = {
  sr: (label, id) => `Otkazano odbrojavanje „${label}“ (${id}).`,
  en: (label, id) => `Cancelled countdown “${label}” (${id}).`,
};

const NO_PRESETS: { sr: string; en: string } = {
  sr: "Nema sačuvanih tajmera.",
  en: "No presets are saved.",
};

const PRESETS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Sačuvani tajmeri (${count}):`,
  en: (count) => `Saved presets (${count}):`,
};

const SAVE_SUMMARY: AssistantPhrase<[name: string, duration: string, replaces: boolean]> = {
  sr: (name, duration, replaces) =>
    `Sačuvaj tajmer „${name}“ na ${duration}${replaces ? " (zameni postojeći)" : ""}`,
  en: (name, duration, replaces) =>
    `Save the preset “${name}” as ${duration}${replaces ? " (replacing the saved one)" : ""}`,
};

const SAVED: AssistantPhrase<[name: string, id: string, duration: string]> = {
  sr: (name, id, duration) => `Sačuvan tajmer „${name}“ (${id}), ${duration}.`,
  en: (name, id, duration) => `Saved preset “${name}” (${id}), ${duration}.`,
};

const RENAME_SUMMARY: AssistantPhrase<[from: string, to: string]> = {
  sr: (from, to) => `Preimenuj tajmer „${from}“ u „${to}“`,
  en: (from, to) => `Rename the preset “${from}” to “${to}”`,
};

const RENAMED: AssistantPhrase<[to: string, id: string]> = {
  sr: (to, id) => `Preimenovan tajmer u „${to}“ (${id}).`,
  en: (to, id) => `Renamed the preset to “${to}” (${id}).`,
};

const DELETE_SUMMARY: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obriši sačuvani tajmer „${name}“`,
  en: (name) => `Delete the saved preset “${name}”`,
};

const DELETED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obrisan sačuvani tajmer „${name}“.`,
  en: (name) => `Deleted the saved preset “${name}”.`,
};

const SOUND_SUMMARY: AssistantPhrase<[on: boolean]> = {
  sr: (on) => (on ? "Uključi zvuk na kraju odbrojavanja" : "Isključi zvuk na kraju odbrojavanja"),
  en: (on) => (on ? "Turn the sound on when a countdown ends" : "Turn the sound off when a countdown ends"),
};

const SOUND_SET: AssistantPhrase<[on: boolean]> = {
  sr: (on) => `Zvuk na kraju odbrojavanja je ${on ? "uključen" : "isključen"}.`,
  en: (on) => `The sound when a countdown ends is ${on ? "on" : "off"}.`,
};

const STOPWATCH_WORD: Record<StopwatchAction, { sr: string; en: string }> = {
  start: { sr: "pokreni", en: "start" },
  stop: { sr: "zaustavi", en: "stop" },
  lap: { sr: "krug", en: "lap" },
  reset: { sr: "resetuj", en: "reset" },
};

const STOPWATCH_SENT: AssistantPhrase<[action: string]> = {
  sr: (action) => `Poslato štoperici: ${action}.`,
  en: (action) => `Sent to the stopwatch: ${action}.`,
};

/** What a lookup by name says when it finds nothing or too much, for one kind of row. */
interface NameLookup {
  readonly missing: AssistantPhrase<[name: string, known: string]>;
  readonly ambiguous: AssistantPhrase<[name: string, candidates: string]>;
}

const COUNTDOWN_LOOKUP: NameLookup = {
  missing: {
    sr: (name, known) => `Nema odbrojavanja „${name}“. Odbrojavanja u ovom profilu: ${known}.`,
    en: (name, known) => `No countdown named “${name}”. This profile's countdowns: ${known}.`,
  },
  ambiguous: {
    sr: (name, candidates) => `Ima više odbrojavanja zvanih „${name}“: ${candidates}. Navedi id.`,
    en: (name, candidates) => `More than one countdown is called “${name}”: ${candidates}. Name it by its id.`,
  },
};

const PRESET_LOOKUP: NameLookup = {
  missing: {
    sr: (name, known) => `Nema sačuvanog tajmera „${name}“. Sačuvani tajmeri: ${known}.`,
    en: (name, known) => `No saved preset named “${name}”. Saved presets: ${known}.`,
  },
  ambiguous: {
    sr: (name, candidates) => `Ima više sačuvanih tajmera zvanih „${name}“: ${candidates}. Navedi id.`,
    en: (name, candidates) => `More than one saved preset is called “${name}”: ${candidates}. Name it by its id.`,
  },
};

export function timerTools(deps: TimerToolDeps): readonly Tool[] {
  function timersStore(profileId: string): TimersStore {
    return deps.profileDb(profileId, (db, id) => new TimersStore(db, id));
  }

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
          { navigateTo: { module: "timers", item: countdown.id } },
        );
      }),
  };

  const pause = countdownAction({
    name: "timers.pause",
    description: {
      sr: "Pauzira odbrojavanje koje radi, po imenu ili id-u. Koristi ga kada korisnik kaže da pauzira tajmer. Pauzirano odbrojavanje čuva vreme koje mu je ostalo.",
      en: "Pauses a running countdown, named as the user named it or by its id. Use it when the user says to pause a timer. A paused countdown keeps the time it has left.",
    },
    summary: PAUSE_SUMMARY,
    apply: (profileId, id) => deps.timers.pauseCountdown(profileId, id),
    done: (countdown, locale) =>
      phrase(
        locale,
        PAUSED,
        countdown.label,
        countdown.id,
        formatDuration(locale, countdown.remainingSeconds ?? 0),
      ),
  });

  const resume = countdownAction({
    name: "timers.resume",
    description: {
      sr: "Nastavlja pauzirano odbrojavanje, po imenu ili id-u. Koristi ga kada korisnik kaže da nastavi ili pusti tajmer ponovo.",
      en: "Resumes a paused countdown, named as the user named it or by its id. Use it when the user says to resume or restart a paused timer.",
    },
    summary: RESUME_SUMMARY,
    apply: (profileId, id) => deps.timers.resumeCountdown(profileId, id),
    done: (countdown, locale) =>
      phrase(
        locale,
        RESUMED,
        countdown.label,
        countdown.id,
        formatClock(locale, Date.parse(countdown.endsAt ?? "")),
      ),
  });

  const cancel = countdownAction({
    name: "timers.cancel",
    description: {
      sr: "Otkazuje odbrojavanje, po imenu ili id-u, i gasi njegov alarm. Koristi ga kada korisnik kaže da prekine ili obriše tajmer. Sačuvani tajmeri se ne diraju.",
      en: "Cancels a countdown, named as the user named it or by its id, and turns its alarm off. Use it when the user says to stop or delete a timer. Saved presets are not touched.",
    },
    summary: CANCEL_SUMMARY,
    apply: (profileId, id, countdown) => {
      deps.timers.cancelCountdown(profileId, id);
      return countdown;
    },
    done: (countdown, locale) => phrase(locale, CANCELLED, countdown.label, countdown.id),
  });

  const presets: Tool = {
    name: "timers.presets",
    description: {
      sr: "Izlistava sačuvane tajmere sa trajanjem. Koristi ga kada korisnik pita koje tajmere ima sačuvane.",
      en: "Lists the saved presets with their durations. Use it when the user asks which timers they have saved.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const saved = timersStore(context.profileId).listPresets();
        if (saved.length === 0) {
          return okResult(text(context.locale, NO_PRESETS));
        }
        return okResult(
          [
            phrase(context.locale, PRESETS_HEADING, saved.length),
            ...saved.map(
              (preset) =>
                `- ${preset.id} ${preset.name} (${formatDuration(context.locale, preset.durationSeconds)})`,
            ),
          ].join("\n"),
        );
      }),
  };

  const preset: Tool = {
    name: "timers.preset",
    description: {
      sr: "Čuva, preimenuje, briše ili pokreće sačuvani tajmer, po imenu ili id-u. Koristi ga kada korisnik kaže „sačuvaj tajmer za kafu na 4 minuta“ ili „pokreni tajmer za kafu“.",
      en: "Saves, renames, deletes or starts a saved preset, named or by its id. Use it when the user says \"save a four minute timer as coffee\" or \"start the coffee timer\".",
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...PRESET_ACTIONS],
          description: "save, rename, delete, or start.",
        },
        name: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TIMER_NAME_LENGTH,
          description: "The preset's name or id. For save, the name to save it under.",
        },
        seconds: {
          type: "integer",
          minimum: 1,
          maximum: MAX_TIMER_DURATION_SECONDS,
          description: "The preset's length in seconds, for save (4 minutes is 240).",
        },
        newName: {
          type: "string",
          minLength: 1,
          maxLength: MAX_TIMER_NAME_LENGTH,
          description: "The new name, for rename.",
        },
      },
      required: ["action", "name"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const action = asEnum(args.action, "action", PRESET_ACTIONS);
        const name = asText(args.name, "name", MAX_TIMER_NAME_LENGTH);
        const store = timersStore(context.profileId);
        const now = instant(deps.now());

        if (action === "save") {
          const seconds = asCount(args.seconds, "seconds", 1, MAX_TIMER_DURATION_SECONDS);
          // A preset is saved under its name, so one already called that is
          // replaced: the store refuses a second, and the user means the newer one.
          const existing = findByName(store.listPresets(), name);
          const declined = await confirmOrDecline(
            context,
            "timers.preset",
            "write",
            phrase(
              context.locale,
              SAVE_SUMMARY,
              name,
              formatDuration(context.locale, seconds),
              existing !== undefined,
            ),
          );
          if (declined !== null) return declined;
          // One transaction: a failed create must not leave the old preset gone.
          const saved = deps.profileDb(context.profileId, (db, id) =>
            db.transaction(() => {
              const presets = new TimersStore(db, id);
              if (existing !== undefined) presets.removePreset(existing.id);
              return presets.createPreset({ name, durationSeconds: seconds }, now);
            })(),
          );
          return okResult(
            phrase(context.locale, SAVED, saved.name, saved.id, formatDuration(context.locale, seconds)),
            { navigateTo: { module: "timers", item: saved.id } },
          );
        }

        const target = resolveNamed(
          store.listPresets(),
          name,
          (row) => row.name,
          PRESET_LOOKUP,
          context.locale,
        );

        if (action === "rename") {
          const newName = asText(args.newName, "newName", MAX_TIMER_NAME_LENGTH);
          const declined = await confirmOrDecline(
            context,
            "timers.preset",
            "write",
            phrase(context.locale, RENAME_SUMMARY, target.name, newName),
          );
          if (declined !== null) return declined;
          const renamed = store.renamePreset(target.id, { name: newName }, now);
          return okResult(phrase(context.locale, RENAMED, renamed.name, renamed.id), {
            navigateTo: { module: "timers", item: renamed.id },
          });
        }

        if (action === "delete") {
          const declined = await confirmOrDecline(
            context,
            "timers.preset",
            "write",
            phrase(context.locale, DELETE_SUMMARY, target.name),
          );
          if (declined !== null) return declined;
          store.removePreset(target.id);
          return okResult(phrase(context.locale, DELETED, target.name), {
            navigateTo: { module: "timers" },
          });
        }

        // start: the countdown is the module's own, so it is armed through the host.
        const duration = formatDuration(context.locale, target.durationSeconds);
        const declined = await confirmOrDecline(
          context,
          "timers.preset",
          "write",
          phrase(context.locale, START_SUMMARY, target.name, duration),
        );
        if (declined !== null) return declined;
        const countdown = deps.timers.startCountdown(context.profileId, {
          label: target.name,
          durationSeconds: target.durationSeconds,
        });
        return okResult(phrase(context.locale, STARTED, countdown.label, countdown.id, duration), {
          navigateTo: { module: "timers", item: countdown.id },
        });
      }),
  };

  const stopwatch: Tool = {
    name: "timers.stopwatch",
    description: {
      sr: "Šalje štoperici na stranici tajmera naredbu: pokreni, zaustavi, krug ili resetuj. Štoperica nema zapis u aplikaciji, pa ovo ne čita vreme. Koristi ga kada korisnik kaže „pusti štopericu“.",
      en: "Sends the timers page's stopwatch a command: start, stop, lap or reset. The stopwatch keeps no record in the app, so this does not read the time. Use it when the user says \"start the stopwatch\".",
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...STOPWATCH_ACTIONS],
          description: "start, stop, lap (records a split while it runs), or reset.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    // It changes no data and asks nothing: it moves the page's own view, as `app.open` does.
    effect: "navigate",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const action = asEnum(asArgs(rawArgs).action, "action", STOPWATCH_ACTIONS);
        return okResult(
          phrase(context.locale, STOPWATCH_SENT, STOPWATCH_WORD[action][context.locale]),
          { navigateTo: { module: "timers", action: { name: "stopwatch", payload: { action } } } },
        );
      }),
  };

  const settings: Tool = {
    name: "timers.settings",
    description: {
      sr: "Uključuje ili isključuje zvuk na kraju odbrojavanja. Koristi ga kada korisnik kaže da utiša ili pusti zvuk tajmera.",
      en: "Turns the sound at the end of a countdown on or off. Use it when the user says to mute or unmute the timers.",
    },
    parameters: {
      type: "object",
      properties: {
        soundOnEnd: {
          type: "boolean",
          description: "true for the sound when a countdown ends, false for silence.",
        },
      },
      required: ["soundOnEnd"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const soundOnEnd = asOptionalBoolean(asArgs(rawArgs).soundOnEnd, "soundOnEnd");
        if (soundOnEnd === undefined) throw new Error('"soundOnEnd" must be a boolean.');

        const declined = await confirmOrDecline(
          context,
          "timers.settings",
          "write",
          phrase(context.locale, SOUND_SUMMARY, soundOnEnd),
        );
        if (declined !== null) return declined;

        const settled = timersStore(context.profileId).setSoundOnEnd(
          soundOnEnd,
          instant(deps.now()),
        );
        return okResult(phrase(context.locale, SOUND_SET, settled.soundOnEnd), {
          navigateTo: { module: "timers" },
        });
      }),
  };

  /**
   * A countdown tool that names one existing countdown and changes it by one host
   * call: resolve the name, confirm, apply, and answer with what the host says.
   * The alarm is the host's to move, so the tool never touches it.
   */
  function countdownAction(spec: {
    readonly name: string;
    readonly description: { readonly sr: string; readonly en: string };
    readonly summary: AssistantPhrase<[label: string]>;
    readonly apply: (profileId: string, id: string, before: TimersCountdown) => TimersCountdown | void;
    readonly done: (countdown: TimersCountdown, locale: AssistantLocale) => string;
  }): Tool {
    return {
      name: spec.name,
      description: spec.description,
      parameters: {
        type: "object",
        properties: {
          countdown: {
            type: "string",
            minLength: 1,
            maxLength: MAX_TIMER_NAME_LENGTH,
            description: "The countdown's label as the user named it, or its id.",
          },
        },
        required: ["countdown"],
        additionalProperties: false,
      },
      effect: "write",
      run: (rawArgs, context) =>
        guard(context, async () => {
          assertLive(context);
          const wanted = asText(asArgs(rawArgs).countdown, "countdown", MAX_TIMER_NAME_LENGTH);
          const target = resolveNamed(
            deps.timers.listCountdowns(context.profileId),
            wanted,
            (row) => row.label,
            COUNTDOWN_LOOKUP,
            context.locale,
          );

          const declined = await confirmOrDecline(
            context,
            spec.name,
            "write",
            phrase(context.locale, spec.summary, target.label),
          );
          if (declined !== null) return declined;

          const changed = spec.apply(context.profileId, target.id, target);
          return okResult(spec.done(changed ?? target, context.locale), {
            navigateTo: { module: "timers", item: target.id },
          });
        }),
    };
  }

  return [list, start, pause, resume, cancel, presets, preset, stopwatch, settings];
}

/**
 * The one row a name or id refers to, or a refusal. An id wins; a name is matched
 * ignoring case and diacritics; an ambiguous name is refused with its candidates,
 * and a missing one with the names that exist.
 */
function resolveNamed<T extends { readonly id: string }>(
  rows: readonly T[],
  wanted: string,
  nameOf: (row: T) => string,
  lookup: NameLookup,
  locale: AssistantLocale,
): T {
  const byId = rows.find((row) => row.id === wanted);
  if (byId !== undefined) return byId;
  const needle = foldSearchText(wanted);
  const matches = rows.filter((row) => foldSearchText(nameOf(row).trim()) === needle);
  if (matches.length > 1) {
    throw new Error(
      phrase(
        locale,
        lookup.ambiguous,
        wanted,
        matches.map((row) => `${nameOf(row)} (${row.id})`).join(", "),
      ),
    );
  }
  const [found] = matches;
  if (found === undefined) {
    throw new Error(phrase(locale, lookup.missing, wanted, rows.map(nameOf).join(", ") || "-"));
  }
  return found;
}

/** A saved preset with this name, ignoring case and diacritics, or `undefined`. */
function findByName(presets: readonly TimersPreset[], name: string): TimersPreset | undefined {
  const needle = foldSearchText(name);
  return presets.find((preset) => foldSearchText(preset.name.trim()) === needle);
}

/** The instant a store write is stamped with. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
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
    const reading = Number.isNaN(at) ? countdown.endsAt : formatClock(locale, at);
    return `- ${id} ${countdown.label} (${phrase(locale, TIMER_LINE.running, reading)})`;
  }
  return `- ${id} ${countdown.label} (${phrase(
    locale,
    TIMER_LINE.paused,
    formatDuration(locale, countdown.remainingSeconds ?? 0),
  )})`;
}
