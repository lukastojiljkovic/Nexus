import { MAX_A4_HZ, MAX_WPM, MIN_A4_HZ, MIN_WPM } from "@nexus/core";

/**
 * SIGNALS' device preferences, stored in `localStorage` exactly as `notePrefs.ts`
 * and `accent.ts` store theirs: they describe how THIS machine plays a tone and
 * reads a string, not what the profile contains, so they belong beside the theme
 * rather than in the encrypted database. They are also the whole of this
 * module's persistent state — the module has no store and no migration, which is
 * why the settings card is a device card (see `shared/manifest.ts`).
 *
 * **One key per value, per profile, and every reader is total.** `localStorage` is writable by
 * anything with a console, so a stored number is narrowed on read against the
 * engine's own bounds and falls back to the default for anything unrecognised.
 * A hand-edited key can therefore never put the module into a state its own page
 * cannot name — and it can never hand `morseSchedule` a speed outside
 * `MIN_WPM…MAX_WPM`, which throws.
 *
 * **The bounds are the engines' where an engine has one.** The two speeds come
 * from `MIN_WPM`/`MAX_WPM` (the range Morse timing is defined over), and A4 from
 * `MIN_A4_HZ`/`MAX_A4_HZ` (415–466 Hz, the range of surviving early-music
 * practice, which is the range `noteForFrequency` will name a note at). The tone
 * pitch is the one range this module owns rather than borrows: it is a sine on a
 * laptop speaker, and 300–1200 Hz is the window in which it stays comfortable at
 * any Morse speed.
 *
 * **Why the profile is part of the key.** These are device preferences — they
 * live on this machine and travel in no archive — but the values are somebody's:
 * one player reads at 12 words a minute and tunes to a baroque 415, another at 20
 * and A440, and two people share a laptop. `signalPrefs.ts` records the same
 * distinction for the opening questionnaire's answers, and this module follows
 * it: a key is `nexus.signals.<profileId>.<field>`, which keeps a device
 * preference from being one person's setting forced on another.
 */

export interface SignalsPrefs {
  /** The speed the CHARACTERS are keyed at, in words per minute (PARIS). */
  readonly wpm: number;
  /** The speed the MESSAGE is sent at — Farnsworth spacing. Equal to `wpm` is standard timing. */
  readonly messageWpm: number;
  /** The Morse beat note, in Hz. */
  readonly pitchHz: number;
  /** The tuner's reference, in Hz. */
  readonly a4Hz: number;
}

/** Twenty words a minute is the speed a first hand is taught at, and A440 is the modern reference the engine names. */
export const SIGNALS_DEFAULTS: SignalsPrefs = {
  wpm: 20,
  messageWpm: 20,
  pitchHz: 700,
  a4Hz: 440,
};

/** The window the Morse beat note is offered in — see this file's header. */
export const MORSE_PITCH_MIN_HZ = 300;
export const MORSE_PITCH_MAX_HZ = 1200;

/** The four fields a preference key can name. */
export type SignalsPrefField = "wpm" | "messageWpm" | "pitchHz" | "a4Hz";

const FIELDS: readonly SignalsPrefField[] = ["wpm", "messageWpm", "pitchHz", "a4Hz"];

/**
 * The `localStorage` key of one field of one profile.
 *
 * Exported so the four keys are data a test can pin rather than four string
 * literals built at three call sites — the defect that shape produces is a write
 * to one key and a read from another, which reads as a preference that silently
 * does not stick.
 */
export function signalsPrefKey(profileId: string, field: SignalsPrefField): string {
  return `nexus.signals.${profileId}.${field}`;
}

/**
 * One stored number, or the default.
 *
 * Whole numbers only, because both speeds count dits and a half a word a minute
 * is not a speed anybody keys at — and because the encoder's own schedule is
 * read from this value. A stored value outside the range is REFUSED rather than
 * clamped: a clamp would silently move a number the user can see on screen,
 * which is the one thing a preference must never do.
 */
function wholeInRange(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return value >= min && value <= max ? value : fallback;
}

/** One stored number that may carry a decimal (the A4 reference and the tone pitch do: 442.5 Hz is a real ensemble). */
function finiteInRange(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value >= min && value <= max ? value : fallback;
}

/**
 * A stored `SignalsPrefs`, or the defaults, from the raw string `localStorage`
 * answered. Total: every field is narrowed on its own, a malformed document
 * costs the whole row, and the one RELATION between two fields — a message
 * speed faster than the character speed is not Farnsworth spacing and the engine
 * refuses it — is resolved here by holding the message at the character speed,
 * which is exactly what standard timing is.
 */
export function parseSignalsPrefs(stored: string | null): SignalsPrefs {
  let raw: unknown = null;
  if (stored !== null) {
    try {
      raw = JSON.parse(stored);
    } catch {
      raw = null;
    }
  }
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const wpm = wholeInRange(record["wpm"], MIN_WPM, MAX_WPM, SIGNALS_DEFAULTS.wpm);
  const messageWpm = wholeInRange(
    record["messageWpm"],
    MIN_WPM,
    wpm,
    Math.min(SIGNALS_DEFAULTS.messageWpm, wpm),
  );
  return {
    wpm,
    messageWpm,
    pitchHz: finiteInRange(
      record["pitchHz"],
      MORSE_PITCH_MIN_HZ,
      MORSE_PITCH_MAX_HZ,
      SIGNALS_DEFAULTS.pitchHz,
    ),
    a4Hz: finiteInRange(record["a4Hz"], MIN_A4_HZ, MAX_A4_HZ, SIGNALS_DEFAULTS.a4Hz),
  };
}

/** This profile's four values, read as one document. */
export function readSignalsPrefs(profileId: string): SignalsPrefs {
  const stored: Record<string, unknown> = {};
  for (const field of FIELDS) {
    const raw = localStorage.getItem(signalsPrefKey(profileId, field));
    if (raw !== null) stored[field] = Number(raw);
  }
  return parseSignalsPrefs(JSON.stringify(stored));
}

/**
 * Writes the four keys. The KEYS are separate rather than one JSON document
 * because that is the shape `localStorage` preferences take all over this app
 * (`accent.ts`, `notePrefs.ts`): a single key holding an object makes every
 * reader parse JSON to answer one question, and makes a hand-edited file cost
 * all four values instead of the one that was edited.
 */
export function persistSignalsPrefs(profileId: string, prefs: SignalsPrefs): void {
  for (const field of FIELDS) localStorage.setItem(signalsPrefKey(profileId, field), String(prefs[field]));
}

/**
 * Forgets all four — the „reset" half of the module's settings card, which the
 * module's own body offers because a kit card has no shell-provided reset (see
 * `moduleKit/settings.ts`). The keys are enumerated rather than swept by prefix,
 * so the reset can never grow to reach something else called `nexus.signals…`:
 * `nexus.profile.signals.<id>` belongs to the opening questionnaire and is
 * nothing to do with this module.
 */
export function clearStoredSignalsPreferences(profileId: string): void {
  for (const field of FIELDS) localStorage.removeItem(signalsPrefKey(profileId, field));
}

/** A whole words-per-minute figure typed into a field, or null when it is not one the engine accepts. */
export function parseWpmInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= MIN_WPM && value <= MAX_WPM ? value : null;
}

/** A tone pitch in Hz typed into a field, or null. Decimals are allowed: 741.3 Hz is a note somebody may want. */
export function parsePitchInput(text: string): number | null {
  return parseBoundedInput(text, MORSE_PITCH_MIN_HZ, MORSE_PITCH_MAX_HZ);
}

/** An A4 reference in Hz typed into a field, or null. */
export function parseA4Input(text: string): number | null {
  return parseBoundedInput(text, MIN_A4_HZ, MAX_A4_HZ);
}

/**
 * A decimal number inside a range, or null. The text is parsed with `Number`,
 * which accepts `"4e2"` and `" 440 "`; both are numbers a person can mean, and
 * anything it cannot read (`""`, `"x"`, `"440,0"`) answers null. The comma is
 * deliberately NOT accepted: this app formats with the active locale's decimal
 * mark, and a field that read both marks would accept a value the formatter
 * prints back in the other form.
 */
function parseBoundedInput(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

/**
 * The effective speed of a message: Farnsworth may only SLOW a message down, so
 * a message speed above the character speed is the character speed. The engine
 * refuses the other order outright (`morseSchedule` throws), and this is the
 * function that keeps that refusal unreachable from the page.
 */
export function effectiveWpm(wpm: number, messageWpm: number): number {
  return Math.min(wpm, messageWpm);
}
