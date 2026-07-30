/**
 * Keyboard chords (ADR-040 / SET-013) — the pure half of the app's shortcut
 * system: what a chord *is*, how it serializes, and whether a given keystroke
 * is one. DOM-free and clock-free (the `calendarGrid` precedent): every
 * function here takes plain data, so the whole rule set is testable without a
 * browser and the renderer is left with nothing but wiring.
 *
 * Three decisions a reader would otherwise have to reverse-engineer:
 *
 *  - **`event.key`, never `event.code`.** A chord names the key the user's
 *    layout actually prints. On the Serbian QWERTZ layout that is the whole
 *    point: `code` would call the Y key "KeyZ" and make every printed chord a
 *    lie.
 *  - **Ctrl means `ctrlKey || metaKey`,** the rule the palette's own Ctrl+K
 *    listener has always used, so one binding covers Windows and macOS. It is
 *    displayed as "Ctrl" either way.
 *  - **Bindable = at least one of Ctrl/Alt held, or a function key.** A bare
 *    character — or a merely shifted one — is what typing looks like, and must
 *    never be capturable. That single rule is also why the app's global
 *    handler needs no input-focus guard: no remapped chord can ever collide
 *    with someone typing into a field.
 */

/** A key combination, with `key` already normalized (see `normalizeChordKey`). */
export interface Chord {
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  /** A single character, lowercased, or a function key by name ("F1"–"F12"). */
  readonly key: string;
}

/**
 * The parts of a `KeyboardEvent` a chord is decided from. Declared structurally
 * rather than imported from the DOM so this module stays platform-free — a real
 * `KeyboardEvent` satisfies it as-is.
 */
export interface ChordEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** How many modules the reserved positional family reaches: Ctrl+1 … Ctrl+9. */
export const MODULE_NAV_MAX = 9;

/**
 * `findChordConflict`'s answer when a chord collides with the reserved
 * Ctrl+digit family rather than with another action. Not an action id — the
 * family is positional and has no single owner to name.
 */
export const MODULE_NAV_CONFLICT = "moduleNav";

/** Keys that are *held*, never pressed: they can never be a chord's key. */
const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph"]);

const FUNCTION_KEY = /^F([1-9]|1[0-2])$/i;

const MODIFIER_TOKENS: Readonly<Record<string, "ctrl" | "alt" | "shift">> = {
  ctrl: "ctrl",
  alt: "alt",
  shift: "shift",
};

/** True for the keys a user holds down — pressing one alone is not yet a chord. */
export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key);
}

/**
 * Reduces a raw `event.key` to a chord's key, or `null` when it is not one of
 * the two shapes a chord may carry. Whitespace is refused along with the named
 * keys: a chord whose chip renders as an empty box is not something a
 * reference screen can honestly print.
 */
export function normalizeChordKey(key: string): string | null {
  if (FUNCTION_KEY.test(key)) return key.toUpperCase();
  if (isModifierKey(key) || key.trim() === "") return null;
  return [...key].length === 1 ? key.toLowerCase() : null;
}

/** Canonical serialization: modifiers in the fixed Ctrl, Alt, Shift order, then the key. */
export function formatChord(chord: Chord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push("Ctrl");
  if (chord.alt) parts.push("Alt");
  if (chord.shift) parts.push("Shift");
  parts.push(chord.key.toUpperCase());
  return parts.join("+");
}

/**
 * Splits a serialization into its modifier tokens and its raw key. "+" is both
 * the separator and a perfectly typeable key, so the two forms it can end in
 * are handled explicitly rather than by splitting and hoping.
 */
function splitChordText(text: string): { modifiers: string[]; rawKey: string } | null {
  if (text === "+") return { modifiers: [], rawKey: "+" };
  if (text.endsWith("++")) return { modifiers: text.slice(0, -2).split("+"), rawKey: "+" };
  const separator = text.lastIndexOf("+");
  if (separator === -1) return { modifiers: [], rawKey: text };
  const rawKey = text.slice(separator + 1);
  if (rawKey === "") return null; // a separator with nothing after it
  return { modifiers: text.slice(0, separator).split("+"), rawKey };
}

/**
 * Parses a serialization back into a chord, or `null` for anything malformed —
 * an unknown or repeated modifier, a key that is neither a character nor
 * F1–F12. Deliberately syntactic only: whether the result may be *bound* is
 * `isBindableChord`'s separate question, so a caller reading stored data can
 * refuse a well-formed-but-unbindable chord with the right reason.
 *
 * Modifier order and casing are accepted freely on the way in; `formatChord`
 * always emits the canonical form on the way out, which is what makes chord
 * equality a plain string comparison.
 */
export function parseChord(text: string): Chord | null {
  const split = splitChordText(text);
  if (split === null) return null;
  const key = normalizeChordKey(split.rawKey);
  if (key === null) return null;
  const held = { ctrl: false, alt: false, shift: false };
  for (const token of split.modifiers) {
    const modifier = MODIFIER_TOKENS[token.toLowerCase()];
    if (modifier === undefined || held[modifier]) return null;
    held[modifier] = true;
  }
  return { ...held, key };
}

/**
 * Whether a chord may be bound to an action at all: Ctrl or Alt must be held,
 * unless the key is a function key (which prints nothing, so it is safe on its
 * own — and is why F1 can be the help chord).
 */
export function isBindableChord(chord: Chord): boolean {
  return chord.ctrl || chord.alt || FUNCTION_KEY.test(chord.key);
}

/** The bindable chord an event represents, or `null` when it is not one (capture mode's whole gate). */
export function chordFromEvent(event: ChordEvent): Chord | null {
  const key = normalizeChordKey(event.key);
  if (key === null) return null;
  const chord: Chord = {
    ctrl: event.ctrlKey || event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
    key,
  };
  return isBindableChord(chord) ? chord : null;
}

/** Whether an event fires a given chord. Alt and Shift must match exactly; Ctrl also accepts Cmd. */
export function matchesChord(chord: Chord, event: ChordEvent): boolean {
  return (
    chord.ctrl === (event.ctrlKey || event.metaKey) &&
    chord.alt === event.altKey &&
    chord.shift === event.shiftKey &&
    chord.key === normalizeChordKey(event.key)
  );
}

/** The reserved family: bare Ctrl + a digit 1–9. Adding Alt or Shift leaves the combination free. */
function isModuleNavChord(chord: Chord): boolean {
  return chord.ctrl && !chord.alt && !chord.shift && chord.key >= "1" && chord.key <= "9";
}

/** The chord that navigates to the Nth visible module, or `null` outside 1…`MODULE_NAV_MAX`. */
export function moduleNavChord(position: number): Chord | null {
  if (!Number.isInteger(position) || position < 1 || position > MODULE_NAV_MAX) return null;
  return { ctrl: true, alt: false, shift: false, key: String(position) };
}

/** The 1-based module position an event asks for, or `null` when it is not a reserved chord. */
export function moduleNavPosition(event: ChordEvent): number | null {
  const chord = chordFromEvent(event);
  return chord !== null && isModuleNavChord(chord) ? Number(chord.key) : null;
}

/**
 * What already holds `chord`: another action's id, `MODULE_NAV_CONFLICT` for
 * the reserved positional family, or `null` when it is free. `actionId` is
 * excluded from the scan — rebinding an action to the chord it already has is
 * a no-op, not a clash.
 */
export function findChordConflict(
  actionId: string,
  chord: Chord,
  bindings: Readonly<Record<string, Chord>>,
): string | null {
  if (isModuleNavChord(chord)) return MODULE_NAV_CONFLICT;
  const serialized = formatChord(chord);
  for (const [id, bound] of Object.entries(bindings)) {
    if (id !== actionId && formatChord(bound) === serialized) return id;
  }
  return null;
}
