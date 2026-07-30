/**
 * The app's remappable core shortcut set (ADR-040 / SET-013): the declarative
 * action registry, and the `localStorage` read/write that remembers a user's
 * overrides. Owns its key exactly the way `autoLock.ts` and `theme.ts` own
 * theirs — and for the same reason: a binding is muscle memory of a *device*,
 * not data of a profile, so it lives here rather than in the database and
 * never travels in an archive.
 *
 * Only OVERRIDDEN actions are stored. That way a future change to a default
 * chord reaches every user who never remapped that action, instead of being
 * shadowed forever by a copy of the old default written out on first run.
 *
 * All chord semantics (parsing, matching, conflicts) live in `@nexus/core`;
 * this module is storage and copy.
 */

import { findChordConflict, formatChord, isBindableChord, parseChord, type Chord } from "@nexus/core";
import { strings } from "./strings.js";

/** The five remappable actions, in the order the Settings card and the reference list them. */
export const SHORTCUT_ACTION_IDS = [
  "palette",
  "quickCreate",
  "lock",
  "settings",
  "shortcutsHelp",
] as const;

export type ShortcutActionId = (typeof SHORTCUT_ACTION_IDS)[number];

export interface ShortcutAction {
  readonly id: ShortcutActionId;
  /** Serbian label, shown in the Settings card, the reference, and conflict refusals. */
  readonly label: string;
  readonly defaultChord: Chord;
}

/**
 * The defaults. `shortcutsHelp` is F1 rather than the more common Ctrl+/
 * deliberately: on the Serbian QWERTZ layout „/" sits on Shift+7, which makes
 * Ctrl+/ close to untypeable on the app's home layout, while F1 is the
 * OS-wide help convention and layout-independent.
 */
const DEFAULT_CHORDS: Readonly<Record<ShortcutActionId, Chord>> = {
  palette: { ctrl: true, alt: false, shift: false, key: "k" },
  quickCreate: { ctrl: true, alt: false, shift: false, key: "n" },
  lock: { ctrl: true, alt: false, shift: false, key: "l" },
  settings: { ctrl: true, alt: false, shift: false, key: "," },
  shortcutsHelp: { ctrl: false, alt: false, shift: false, key: "F1" },
};

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = SHORTCUT_ACTION_IDS.map((id) => ({
  id,
  label: strings.shortcuts.actions[id],
  defaultChord: DEFAULT_CHORDS[id],
}));

/** Every action's effective chord — what the global handler matches against. */
export type ShortcutBindings = Readonly<Record<ShortcutActionId, Chord>>;

/** Only the actions the user has actually remapped. */
export type ShortcutOverrides = Readonly<Partial<Record<ShortcutActionId, Chord>>>;

const STORAGE_KEY = "nexus.shortcuts";

/** The Serbian label of an action id — the one lookup a conflict refusal needs. */
export function shortcutActionLabel(actionId: string): string {
  return SHORTCUT_ACTIONS.find((action) => action.id === actionId)?.label ?? actionId;
}

function isShortcutActionId(value: string): value is ShortcutActionId {
  return (SHORTCUT_ACTION_IDS as readonly string[]).includes(value);
}

/**
 * Reads the stored overrides. Anything that is not a known action id bound to
 * a chord this app would let the user record is dropped silently rather than
 * guessed at: an unknown id, unparsable text, a combination typing could
 * produce, or one inside the reserved Ctrl+digit family (which the capture
 * surface refuses, so it can only arrive by hand-editing — and would show a
 * chord in Settings that can never fire).
 */
export function readStoredShortcutOverrides(): ShortcutOverrides {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const overrides: Partial<Record<ShortcutActionId, Chord>> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isShortcutActionId(id) || typeof value !== "string") continue;
    const chord = parseChord(value);
    if (chord === null || !isBindableChord(chord)) continue;
    if (findChordConflict(id, chord, {}) !== null) continue; // reserved Ctrl+digit
    overrides[id] = chord;
  }
  return overrides;
}

/** Persists the overrides; an empty set removes the key rather than storing `{}`. */
export function writeStoredShortcutOverrides(overrides: ShortcutOverrides): void {
  const record: Record<string, string> = {};
  for (const action of SHORTCUT_ACTIONS) {
    const chord = overrides[action.id];
    if (chord !== undefined) record[action.id] = formatChord(chord);
  }
  if (Object.keys(record).length === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}

/** Overrides laid over the defaults — the complete binding map everything else reads. */
export function resolveShortcuts(overrides: ShortcutOverrides): ShortcutBindings {
  const resolved: Record<ShortcutActionId, Chord> = { ...DEFAULT_CHORDS };
  for (const action of SHORTCUT_ACTIONS) {
    const override = overrides[action.id];
    if (override !== undefined) resolved[action.id] = override;
  }
  return resolved;
}
