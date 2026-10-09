/**
 * Note naming — where a frequency sits, and what it is called.
 *
 * **Temperament and the reference are two separate decisions.** The scale is
 * twelve-tone equal temperament — each semitone is a factor of 2^(1/12) — and
 * the reference is a frequency the caller supplies, not a constant: a tuner
 * that cannot move off A440 is useless to a string player reading a baroque
 * score or a wind player following the ensemble they are sitting in. `a4Hz`
 * alone moves every name on the staff, and nothing else in this module has an
 * opinion about it.
 *
 * **The cents figure is what a tuner needle shows**, so it is signed and it is
 * the distance to the NEAREST note of the scale, not the distance to the note
 * the user has in mind. `centsOff` is inside ±50 by construction.
 *
 * **Open strings are named with the octave number of the pitch itself** (E2 not
 * „low E"), and a preset is in instrument order — thickest string first, which
 * is the order a tune-up walks in and the reverse of what a chord diagram
 * prints, so a surface that draws them the other way is drawing its own order
 * and not the engine's.
 */

/** A named note: the pitch class, the octave, and how far off it is. */
export interface NoteReading {
  /** E.g. `C#`. The pitch class only. */
  readonly name: string;
  /** E.g. `4`. Scientific pitch notation, where A4 is the note above middle C. */
  readonly octave: number;
  /** `name` and octave together, e.g. `C#4`. */
  readonly label: string;
  /** The distance to `label` in cents, signed; negative is flat. */
  readonly centsOff: number;
  /** Where `label` sits exactly, in Hz, at this module's reference. */
  readonly frequencyHz: number;
}

/** What a frequency is nearest, and what the tuning reference was. */
export interface PitchReading extends NoteReading {
  /** The reference the reading was taken at, so a screen can print it beside the name. */
  readonly a4Hz: number;
}

/** One string of an instrument, or one entry of the chromatic scale. */
export interface TuningTarget {
  /** `E2`, `A2`, … — the label a surface prints. */
  readonly label: string;
  /** The exact frequency the string should sound at, at A4 = 440 Hz. */
  readonly frequencyHz: number;
  /** Which string this is, counting from the first of its preset's own list; absent for chromatic. */
  readonly string?: number;
}

/** An instrument preset: what its open strings are, and how to draw them. */
export interface InstrumentPreset {
  /** Stable ASCII id for a stored preference and a strings key, never a label. */
  readonly id: string;
  /**
   * The order the target list is in, so a surface does not have to guess.
   * `low-to-high` runs from the lowest-pitched string to the highest;
   * `re-entrant` is the instrument's own order, in which a string is higher
   * than the one listed after it — the ukulele's G above the C and E — so the
   * list is drawn as it stands and not sorted.
   */
  readonly arrangement: "low-to-high" | "high-to-low" | "re-entrant";
  readonly targets: readonly TuningTarget[];
}

/** The pitch classes, sharp-spelled: this module never invents an enharmonic choice. */
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

/** The window the reference is offered in, which is the range of surviving early-music practice. */
export const MIN_A4_HZ = 415;
export const MAX_A4_HZ = 466;
/** A440. Here so that a caller who wants the modern reference can say so by name. */
export const CONCERT_A4_HZ = 440;

/** A semitone as a frequency ratio, `2^(1/12)`. */
export const SEMITONE_RATIO = 2 ** (1 / 12);

/** True for a reference the module will name notes at. */
export function isValidA4(a4Hz: number): boolean {
  return Number.isFinite(a4Hz) && a4Hz >= MIN_A4_HZ && a4Hz <= MAX_A4_HZ;
}

/**
 * The frequency of a note, at a reference.
 *
 * `midi` is the MIDI note number (A4 = 69), which is only a convenience for
 * naming the pitch class and octave — the arithmetic is `a4Hz · 2^((midi−69)/12)`
 * and does not need the scale to exist.
 */
export function noteFrequencyHz(midi: number, a4Hz = CONCERT_A4_HZ): number {
  return a4Hz * 2 ** ((midi - 69) / 12);
}

/** The label (`C#4`) for a MIDI note number. */
export function noteLabel(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12] as string;
  return `${name}${Math.floor(midi / 12) - 1}`;
}

/**
 * The nearest note to a frequency, in cents.
 *
 * The note is found by rounding, not by searching the scale, so the answer is
 * the same for any frequency and there is no table to walk off the end of. The
 * cents figure is then recomputed from the note's own exact frequency rather
 * than taken from the rounding step, because the two differ in the last places
 * and the one a tuner shows is the distance to the note the screen is printing.
 *
 * The note is named over the 128 MIDI numbers, C-1 to G9 — the range every
 * label in this module is built from — and a frequency whose nearest note falls
 * outside it is refused the way an out-of-range reference is, rather than
 * answered with an octave no other name here reaches.
 */
export function noteForFrequency(frequencyHz: number, a4Hz = CONCERT_A4_HZ): PitchReading | null {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0 || !isValidA4(a4Hz)) return null;
  const midi = Math.round(69 + 12 * Math.log2(frequencyHz / a4Hz));
  // C-1 (MIDI 0) to G9 (127): the range `noteLabel` and the presets live in.
  if (midi < 0 || midi > 127) return null;
  const exact = noteFrequencyHz(midi, a4Hz);
  return {
    name: NOTE_NAMES[((midi % 12) + 12) % 12] as string,
    octave: Math.floor(midi / 12) - 1,
    label: noteLabel(midi),
    centsOff: 1200 * Math.log2(frequencyHz / exact),
    frequencyHz: exact,
    a4Hz,
  };
}

/** The cents between two frequencies, signed; the unit a tuning readout is in. */
export function centsBetween(frequencyHz: number, referenceHz: number): number | null {
  if (!Number.isFinite(frequencyHz) || !Number.isFinite(referenceHz) || frequencyHz <= 0 || referenceHz <= 0) return null;
  return 1200 * Math.log2(frequencyHz / referenceHz);
}

/** The frequency `cents` above a reference. The exact inverse of `centsBetween`. */
export function shiftCents(frequencyHz: number, cents: number): number | null {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0 || !Number.isFinite(cents)) return null;
  return frequencyHz * 2 ** (cents / 1200);
}

/** A tuning target, from its label. The label is the note's spelling, never a string number. */
export function targetFor(label: string, a4Hz = CONCERT_A4_HZ): TuningTarget | null {
  const match = /^([A-G])(#?)(-?\d+)$/.exec(label.trim().toUpperCase());
  if (match === null) return null;
  const index = NOTE_NAMES.indexOf(`${match[1]}${match[2]}` as (typeof NOTE_NAMES)[number]);
  if (index < 0) return null;
  const octave = Number(match[3]);
  if (!Number.isInteger(octave) || octave < -1 || octave > 9) return null;
  const midi = (octave + 1) * 12 + index;
  // C-1 (MIDI 0) to G9 (127), the range `noteForFrequency` names: a target this
  // module hands out is a note it can also read back.
  if (midi < 0 || midi > 127) return null;
  return { label: noteLabel(midi), frequencyHz: noteFrequencyHz(midi, a4Hz) };
}

/**
 * The open strings in the order the instrument is strung, with the string
 * number counting from the first target in the list: for guitar, bass and
 * violin that is the lowest-pitched string, which is the order a tune-up walks
 * in and the reverse of what a chord diagram prints.
 *
 * A ukulele is the one preset whose list is not in pitch order, because its
 * tuning is re-entrant: the G it lists first is higher than the C and E below
 * it. `arrangement` is what says which of the two orders a preset is in, and it
 * matters to a tuner drawing a needle — sorted, that list would be four strings
 * in an order the player is not holding. A low-G ukulele (G3 C4 E4 A4) is a
 * second preset for the same instrument rather than a flag: it is a different
 * set of pitches, and its list IS in pitch order.
 */
function strings(labels: readonly string[]): readonly TuningTarget[] {
  return labels.map((label, index) => {
    const target = targetFor(label) as TuningTarget;
    return { label: target.label, frequencyHz: target.frequencyHz, string: index + 1 };
  });
}

/** Every preset the module offers, in the order a picker should offer them. */
export const TUNING_PRESETS: readonly InstrumentPreset[] = [
  {
    id: "guitar-standard",
    arrangement: "low-to-high",
    targets: strings(["E2", "A2", "D3", "G3", "B3", "E4"]),
  },
  { id: "bass", arrangement: "low-to-high", targets: strings(["E1", "A1", "D2", "G2"]) },
  { id: "violin", arrangement: "low-to-high", targets: strings(["G3", "D4", "A4", "E5"]) },
  { id: "ukulele", arrangement: "re-entrant", targets: strings(["G4", "C4", "E4", "A4"]) },
  { id: "ukulele-low-g", arrangement: "low-to-high", targets: strings(["G3", "C4", "E4", "A4"]) },
];

/**
 * The chromatic scale over the octaves an instrument is played in: C2 to C6,
 * low to high. It is a preset like any other so a surface does not have a
 * second code path for „no preset", and it carries no string numbers because
 * it is not an instrument.
 */
export const CHROMATIC_PRESET: InstrumentPreset = {
  id: "chromatic",
  arrangement: "low-to-high",
  targets: Array.from({ length: 49 }, (_, index) => {
    const midi = 36 + index; // C2 … C6
    return { label: noteLabel(midi), frequencyHz: noteFrequencyHz(midi) };
  }),
};
