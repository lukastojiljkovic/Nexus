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

import {
  chordAccelerator,
  findChordConflict,
  formatChord,
  isBindableChord,
  parseChord,
  type Chord,
} from "@nexus/core";
import { strings } from "./strings.js";

/** The six remappable actions, in the order the Settings card and the reference list them. */
export const SHORTCUT_ACTION_IDS = [
  "palette",
  "quickCreate",
  "globalCapture",
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
  /**
   * True when the chord is registered with the OS rather than only with this
   * window (TASK-002): it fires while Nexus is in the background, so it is
   * additionally constrained by `chordAccelerator` and can be refused by the
   * system when another application already holds it.
   */
  readonly global: boolean;
}

/** The one action the OS registers on the app's behalf — see `ShortcutAction.global`. */
const GLOBAL_ACTION_IDS: ReadonlySet<string> = new Set<ShortcutActionId>(["globalCapture"]);

/**
 * The defaults. Two of them are chosen against the app's home layout rather
 * than by convention:
 *
 *  - `shortcutsHelp` is F1 rather than the more common Ctrl+/: on the Serbian
 *    QWERTZ layout „/" sits on Shift+7, which makes Ctrl+/ close to untypeable,
 *    while F1 is the OS-wide help convention and layout-independent.
 *  - `globalCapture` is Ctrl+Shift+N rather than the usual Ctrl+Alt+N because
 *    Ctrl+Alt *is* AltGr on Windows, and AltGr+N prints „}" on the Serbian
 *    Latin layout — an OS-wide Ctrl+Alt+N would take that character away from
 *    every editor on the machine. Ctrl+Shift+N keeps the N of Ctrl+N (its
 *    in-app sibling) with one modifier more, and is free of AltGr entirely.
 */
const DEFAULT_CHORDS: Readonly<Record<ShortcutActionId, Chord>> = {
  palette: { ctrl: true, alt: false, shift: false, key: "k" },
  quickCreate: { ctrl: true, alt: false, shift: false, key: "n" },
  globalCapture: { ctrl: true, alt: false, shift: true, key: "n" },
  lock: { ctrl: true, alt: false, shift: false, key: "l" },
  settings: { ctrl: true, alt: false, shift: false, key: "," },
  shortcutsHelp: { ctrl: false, alt: false, shift: false, key: "F1" },
};

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = SHORTCUT_ACTION_IDS.map((id) => ({
  id,
  label: strings.shortcuts.actions[id],
  defaultChord: DEFAULT_CHORDS[id],
  global: GLOBAL_ACTION_IDS.has(id),
}));

/**
 * Whether an action's chord is registered with the OS. Exported so the Settings
 * capture surface can apply the extra `chordAccelerator` rule to exactly that
 * row without re-deriving which row it is.
 */
export function isGlobalShortcutAction(actionId: string): boolean {
  return GLOBAL_ACTION_IDS.has(actionId);
}

/** Every action's effective chord — what the global handler matches against. */
export type ShortcutBindings = Readonly<Record<ShortcutActionId, Chord>>;

/** Only the actions the user has actually remapped. */
export type ShortcutOverrides = Readonly<Partial<Record<ShortcutActionId, Chord>>>;

const STORAGE_KEY = "nexus.shortcuts";

/** The Serbian label of an action id — the one lookup a conflict refusal needs. */
export function shortcutActionLabel(actionId: string): string {
  return SHORTCUT_ACTIONS.find((action) => action.id === actionId)?.label ?? actionId;
}

/**
 * Reads the stored overrides. Anything that is not a known action id bound to
 * a chord this app would let the user record is dropped silently rather than
 * guessed at: an unknown id, unparsable text, a combination typing could
 * produce, one inside the reserved Ctrl+digit family, one another action
 * already answers to, or — for the global action alone — one the OS cannot be
 * asked to register (`chordAccelerator`). Every one of those is refused by the
 * Settings capture surface, so it can only arrive by hand-editing — and each
 * would leave a chord in Settings that either can never fire or fires two
 * actions at once.
 *
 * Collisions are settled by walking `SHORTCUT_ACTION_IDS` in order and judging
 * each candidate against the map as it would actually stand around it: every
 * action's default, with the overrides accepted so far already laid over it.
 * Two consequences worth naming, both covered by tests:
 *
 *  - An override that vacates its own default frees that chord for a later
 *    action to claim — move `palette` off Ctrl+K and `quickCreate` may take it.
 *  - An action not yet reached is still on its default, so a candidate is
 *    refused against a chord that a later override would have vacated.
 *
 * Dropping one candidate can therefore decide the next, which is exactly why
 * the walk follows the registry's fixed order — first laid out wins — rather
 * than the file's key order: the same file must always read back the same way.
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
  const raw = parsed as Record<string, unknown>;
  const overrides: Partial<Record<ShortcutActionId, Chord>> = {};
  const effective: Record<ShortcutActionId, Chord> = { ...DEFAULT_CHORDS };
  for (const id of SHORTCUT_ACTION_IDS) {
    const value = raw[id];
    if (typeof value !== "string") continue;
    const chord = parseChord(value);
    if (chord === null || !isBindableChord(chord)) continue;
    if (GLOBAL_ACTION_IDS.has(id) && chordAccelerator(chord) === null) continue;
    // `findChordConflict` skips `id` itself, so `effective` — which still holds
    // this action's own default — reads as the bindings of every OTHER action.
    if (findChordConflict(id, chord, effective) !== null) continue;
    overrides[id] = chord;
    effective[id] = chord;
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
