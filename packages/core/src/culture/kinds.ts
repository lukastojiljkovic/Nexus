/**
 * The culture corner's vocabulary: what a visit is, what a listening entry is,
 * and which audio formats the library accepts. One file, because stage 2's page
 * and the store must agree on all three, and a second copy of "the kinds" is
 * how a picker offers a kind the schema refuses.
 *
 * **`other` is a member of both lists and is not a hole in them.** A kind list
 * that cannot say "something I have no word for" makes the user lie, and a lie
 * in a kind (recording a puppet show as `theatre`) is worse than an honest
 * `other`, because it quietly corrupts the statistics that group by kind.
 *
 * **The lists are closed and their ORDER is the order they are offered in.**
 * `VISIT_KINDS` runs from the most common to the least, so a picker can render
 * it as it stands; `stats.ts` reads the same order for its per-kind table, which
 * is what makes two of the app's surfaces present one list rather than two.
 */

/** The ten kinds of visit. Closed: the store and the schema both refuse a word that is not here. */
export const VISIT_KINDS = [
  "museum",
  "gallery",
  "exhibition",
  "theatre",
  "opera",
  "ballet",
  "concert",
  "cinema",
  "festival",
  "other",
] as const;

export type VisitKind = (typeof VISIT_KINDS)[number];

/**
 * What one line of the listening log is about. Not the same axis as
 * `VISIT_KINDS`: a log entry is a recording (`album`, `track`), a performance
 * heard live, or something else entirely, and an album is deliberately NOT
 * "a collection of tracks" here — the log records what was played, and the
 * distinction the user is making is `album` versus `track`.
 */
export const MUSIC_LOG_KINDS = ["album", "track", "live", "other"] as const;

export type MusicLogKind = (typeof MUSIC_LOG_KINDS)[number];

/** The worst a visit or a listening entry may be rated, and the best — one scale for both, since both are the same judgement. */
export const MIN_CULTURE_RATING = 1;
export const MAX_CULTURE_RATING = 10;

/**
 * The audio formats the library accepts: MP3, AAC/M4A, Ogg/Opus, FLAC, WAV —
 * the five the brief names, each with the spellings a real file carries.
 *
 * The vendor spellings (`audio/x-m4a`, `audio/x-flac`, `audio/x-wav`,
 * `audio/wave`) are the point of a list written out by hand: a file tagged by a
 * decade of encoders will claim one of them, and a store that knew only the
 * IANA-preferred spelling would refuse a correct MP3 whose header says
 * otherwise. The list stays closed, so the next spelling is a decision somebody
 * writes down rather than a mime that slipped through.
 */
export const CULTURE_AUDIO_MIMES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/x-m4a",
  "audio/m4a",
  "audio/ogg",
  "audio/opus",
  "audio/flac",
  "audio/x-flac",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
] as const;

export type CultureAudioMime = (typeof CULTURE_AUDIO_MIMES)[number];

/**
 * Whether an untrusted value is a visit kind. Takes `unknown` on purpose: it is
 * the store's gate on a payload from the renderer, where the field arrives as
 * whatever the caller sent.
 */
export function isVisitKind(value: unknown): value is VisitKind {
  return typeof value === "string" && (VISIT_KINDS as readonly string[]).includes(value);
}

/** Whether an untrusted value is a listening-entry kind — `isVisitKind`'s twin, and closed the same way. */
export function isMusicLogKind(value: unknown): value is MusicLogKind {
  return typeof value === "string" && (MUSIC_LOG_KINDS as readonly string[]).includes(value);
}

/**
 * Whether a value is a rating this module will store: a whole number on the
 * 1-10 scale. `null` is NOT a rating and is handled by the caller, which is the
 * only place that knows whether the field was omitted or cleared.
 */
export function isCultureRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_CULTURE_RATING &&
    value <= MAX_CULTURE_RATING
  );
}

/** Whether a stored or sniffed mime is one of the five formats the library holds. */
export function isCultureAudioMime(mime: string): boolean {
  return (CULTURE_AUDIO_MIMES as readonly string[]).includes(mime);
}
