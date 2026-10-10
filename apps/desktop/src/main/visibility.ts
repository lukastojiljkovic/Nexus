import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { resolveEnabled, type ModuleManifest, type ModuleRegistry } from "@nexus/core";

import type { FlagState } from "../shared/ipc.js";
import {
  DEFAULT_SHELL_VISIBILITY,
  isModuleVisible,
  normalizeShellVisibility,
  parseShellVisibility,
  seedVisibleModules,
  setModuleVisible,
  type ShellVisibility,
} from "../shared/moduleVisibility.js";

/**
 * THE DEVICE'S MODULE ARRANGEMENT, ON DISK (ADR-101).
 *
 * The shape and every rule about it live in `shared/moduleVisibility.ts`; this
 * file owns the two things that may not: the FILE, and the one-time union of the
 * per-profile switches this setting replaces.
 *
 * **Why `userData` and not the profile database.** It has to be answerable
 * before any profile is unlocked, exactly as `cloud.json` and `network.json` are
 * (`main/net/offline.ts`): the rail is drawn from it, main's notification
 * scheduler and search gate read it, and a setting stored inside an encrypted
 * profile could not be read at the moment either of them needs it. It sits at
 * the root of `userData`, beside those two files, and it is therefore
 * world-readable and user-writable for the same reason they are — an attacker
 * who can write it is already running as the user. It is a preference, not a
 * boundary, and the parser says so by failing OPEN (a bad file reads as
 * „nothing hidden") rather than closed.
 *
 * **The same versioned, atomic-write pattern as the network mode.** A sibling
 * `.tmp`, fsynced and closed before the rename, so a reader sees either the old
 * arrangement or the new one and never half of one; and a `version` in the file
 * so a later release can change the shape and teach this parser about it
 * without a migration pass over every device.
 */

const SHELL_VISIBILITY_FILE = "visibility.json";

export function shellVisibilityPath(userData: string): string {
  return join(userData, SHELL_VISIBILITY_FILE);
}

/**
 * Whether `visibility.json` has never been written on this device.
 *
 * Read ONCE per launch, by `main/index.ts`, and that is what opens ADR-101's
 * migration window: the launch that finds no file is the launch in which each
 * profile's old per-profile switches are unioned in as it becomes readable. A
 * later launch finds the file and migrates nothing, which is what keeps the
 * union from re-showing a module the user has since hidden by hand.
 */
export function shellVisibilityUnset(userData: string): boolean {
  return !existsSync(shellVisibilityPath(userData));
}

/**
 * The stored arrangement, or `null` when no VALID one is recorded — missing,
 * unreadable, malformed, or written by a version this build does not know.
 *
 * `null` and `DEFAULT_SHELL_VISIBILITY` are deliberately different answers:
 * only the first says „nothing is recorded here", which is what the migration
 * asks, while every reader wants the second.
 */
export function readShellVisibility(userData: string): ShellVisibility | null {
  let raw: string;
  try {
    raw = readFileSync(shellVisibilityPath(userData), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseShellVisibility(parsed);
}

/** The arrangement this launch runs under. Missing, unreadable or malformed is the app as it ships. */
export function resolveShellVisibility(userData: string): ShellVisibility {
  return readShellVisibility(userData) ?? DEFAULT_SHELL_VISIBILITY;
}

/**
 * Records the arrangement, atomically (`writeNetworkMode`'s recipe and its
 * reason): a crash partway through a plain write leaves a truncated file, and a
 * truncated file reads as „nothing recorded" — which would re-hide nothing and
 * re-run the union over a device that already answered.
 */
export function writeShellVisibility(userData: string, next: ShellVisibility): void {
  const path = shellVisibilityPath(userData);
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  const fd = openSync(tmpPath, "w");
  try {
    writeSync(
      fd,
      `${JSON.stringify(
        {
          version: next.version,
          hidden: [...next.hidden],
          shown: [...next.shown],
          groupOrder: [...next.groupOrder],
          moduleOrder: next.moduleOrder,
        },
        null,
        2,
      )}\n`,
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, path);
}

/**
 * The payload validator for `visibility:set` (SEC-EL: the renderer is
 * untrusted). It is `parseShellVisibility` plus the standard refusal message,
 * and it stays here rather than in `index.ts` because the shape it validates is
 * this module's subject.
 *
 * Unlike a store's validator, this one is the WHOLE check: the value a renderer
 * may name is a preference about which of this build's own modules are drawn,
 * so there is nothing behind it to re-validate — the handler normalizes what
 * this returns against the live registry and writes it.
 */
export function asModuleVisibility(value: unknown): ShellVisibility {
  const parsed = parseShellVisibility(value);
  if (parsed === null) {
    throw new Error("Invalid IPC payload: not a well-formed module visibility value.");
  }
  return parsed;
}

/**
 * One profile's old per-profile switches, resolved the way the shell resolved
 * them on the last build the profile ran: `resolveEnabled` over the shared
 * manifests, fed by the profile's own flag rows. The migration's ONLY reading
 * of the old switch, so the union means what each profile's app actually showed.
 */
export function enabledModulesFromFlags(
  registry: ModuleRegistry,
  flags: FlagState,
): ReadonlySet<string> {
  return new Set(resolveEnabled(registry, flags));
}

/**
 * ADR-101 §3's migration, as the piece of session state main drives.
 *
 * The window is open exactly when the launch found NO `visibility.json`, and it
 * stays open for that launch: profiles become readable one account unlock at a
 * time, and each one that has not been merged yet adds its ON set to the union.
 * After every addition the whole arrangement is written from the union, so the
 * file says at all times "what the profiles seen so far had on" — and the
 * profile that unlocks next can only add to it.
 *
 * Why the window closes at the next launch rather than at the first write: a
 * union that kept running would re-show a module the user hid by hand every
 * time another profile was unlocked, and creating a second profile is an
 * ordinary act, not a migration.
 *
 * The union is held in memory and never in the file. It has exactly one
 * lifetime — this launch — and a record of it left in the file would be a second
 * statement of something the file already says.
 */
export interface ShellVisibilityMigration {
  /** Whether this launch is the one that seeds the setting. False on every launch that found a file. */
  readonly open: boolean;
  /** The profile ids this launch has already read, so a second unlock of the same account adds nothing twice. */
  readonly mergedProfiles: ReadonlySet<string>;
  /**
   * Reads whichever profiles it has not read yet and rewrites the arrangement
   * as the union of everything seen so far. Answers `null` when the window is
   * closed, and the arrangement when it wrote one.
   */
  merge(
    profiles: readonly { readonly id: string; readonly flags: FlagState }[],
  ): ShellVisibility | null;
}

export function createShellVisibilityMigration(
  userData: string,
  registry: ModuleRegistry,
): ShellVisibilityMigration {
  const open = shellVisibilityUnset(userData);
  const mergedProfiles = new Set<string>();
  const union = new Set<string>();
  return {
    open,
    mergedProfiles,
    merge: (profiles) => {
      if (!open) return null;
      const pending = profiles.filter((profile) => !mergedProfiles.has(profile.id));
      if (pending.length === 0) return null;
      for (const profile of pending) {
        mergedProfiles.add(profile.id);
        for (const id of enabledModulesFromFlags(registry, profile.flags)) union.add(id);
      }
      const next = seedVisibleModules(registry, union);
      writeShellVisibility(userData, next);
      return next;
    },
  };
}

/**
 * Every module shown, for the automated runs.
 *
 * The smoke run's page walk switches every module on before it walks the pages
 * (`runSmokePageWalk`), and with this setting that sentence is a write here
 * rather than a row in each profile's flag table.
 */
export function showEveryModule(userData: string, registry: ModuleRegistry): ShellVisibility {
  const next = normalizeShellVisibility(
    seedVisibleModules(registry, new Set(registry.all().map((manifest) => manifest.id))),
    registry,
  );
  writeShellVisibility(userData, next);
  return next;
}

/**
 * A profile's flag rows with the DEVICE's answer laid over every module id.
 *
 * This is what `flags:get` answers with, and it is the whole of how the older
 * callers survive the move: the renderer's questionnaire, its manual override
 * and the profile plan all read "what does this profile have on" and write it
 * back one module at a time, and none of them had to learn a second shape. A
 * module's answer is the device's (ADR-101) — there is one arrangement, not one
 * per profile — while a toolkit pack stays exactly where it was, a row of this
 * profile's own.
 *
 * The rows themselves are untouched: they are the migration's input on the
 * launch that reads them (`createShellVisibilityMigration`) and nothing else
 * reads them afterwards, so overlaying is a READ's business and never a write.
 */
export function withModuleVisibility(
  registry: ModuleRegistry,
  rows: FlagState,
  visibility: ShellVisibility,
): FlagState {
  const next: FlagState = { ...rows };
  for (const manifest of registry.all()) {
    next[manifest.id] = isModuleVisible(manifest, visibility);
  }
  return next;
}

/**
 * One module switched on or off in the DEVICE's arrangement, written — the
 * single-module door beside `visibility:set`'s whole-arrangement one.
 *
 * Two channels write this file and they must not disagree, so both go through
 * the same pure helpers and the same normalization: the „Prikaz" card sends the
 * arrangement it just computed, and `flags:set` (the questionnaire, the manual
 * override, the profile plan) sends one module at a time. A locked module
 * answers the arrangement unchanged rather than being refused, so a caller that
 * asked for something impossible gets the state the app is actually in.
 */
export function setShellModuleVisible(
  userData: string,
  registry: ModuleRegistry,
  manifest: ModuleManifest,
  visible: boolean,
): ShellVisibility {
  const current = resolveShellVisibility(userData);
  const next = normalizeShellVisibility(
    setModuleVisible(current, manifest, visible, registry),
    registry,
  );
  writeShellVisibility(userData, next);
  return next;
}

/**
 * Several modules at once, from a `moduleId → visible` record — the profile
 * plan's and the business profile's preset's door.
 *
 * `changes` names only the modules that decision has an opinion about, so a
 * preset that says one thing about one module leaves the rest of the
 * arrangement exactly as the user left it.
 */
export function applyShellModuleChanges(
  userData: string,
  registry: ModuleRegistry,
  changes: Readonly<Record<string, boolean>>,
): ShellVisibility {
  let next = resolveShellVisibility(userData);
  for (const manifest of registry.all()) {
    const wanted = changes[manifest.id];
    if (wanted === undefined) continue;
    next = setModuleVisible(next, manifest, wanted, registry);
  }
  const normalized = normalizeShellVisibility(next, registry);
  writeShellVisibility(userData, normalized);
  return normalized;
}
