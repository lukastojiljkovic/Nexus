import { sr } from "./copy.sr.js";

/**
 * TIMERS in English — the same shape as `copy.sr.ts`, checked by the compiler.
 *
 * `typeof sr` is the whole mechanism: a sentence left untranslated, a key
 * invented here, or a nested table that does not match is one compile error
 * each, so this file cannot drift from the Serbian table the way a second
 * hand-kept table would. The register is the app's own English: sentence case,
 * informative, no exclamation marks.
 */
export const en: typeof sr = {
  page: {
    subtitle: "A stopwatch and countdowns — they keep running with the page closed.",
    loading: "Loading…",
  },
  stopwatch: {
    title: "Stopwatch",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    reset: "Reset",
    lap: "Lap",
    lapsTitle: "Laps",
    lapTotal: "Total",
    keysHint: "While the page has focus: Space starts and pauses, L takes a lap, R resets.",
  },
  countdowns: {
    title: "Countdowns",
    empty: "No countdown is running. Type a name and a duration, then start it.",
    name: "Name",
    hours: "Hours",
    minutes: "Minutes",
    seconds: "Seconds",
    start: "Start",
    savePreset: "Save as a preset",
    pause: "Pause",
    resume: "Resume",
    addMinute: "+1 min",
    cancel: "Cancel",
    running: "Running",
    paused: "Paused",
  },
  presets: {
    title: "Presets",
    start: "Start",
    rename: "Rename",
    remove: "Delete",
    save: "Save",
    cancel: "Cancel",
    emptyTitle: "No presets yet",
    emptyBody: "Save a countdown under a name — „Coffee“, say — and start it with one click.",
  },
  errors: {
    load: "The timers could not be loaded.",
    mutate: "The change was not saved.",
    name: "A name is required and may be at most 60 characters.",
    duration: "A duration must be between 1 second and 24 hours.",
  },
  settings: {
    caption: "Timers announce themselves even when the page is closed.",
    hint: "The sound is the system's notification sound — Nexus ships no audio files of its own.",
    saved: "Saved.",
    loadError: "The setting could not be loaded.",
    saveError: "The setting was not saved.",
  },
  widget: {
    empty: "No countdown is running.",
    loading: "Loading…",
    loadError: "The countdowns could not be loaded.",
  },
};
