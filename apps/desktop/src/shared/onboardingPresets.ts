import type { FlagState, ModuleRegistry } from "@nexus/core";
import { LOCKED_MODULE_IDS } from "./modules.js";

/**
 * ADR-065: the two declarative tables the onboarding questionnaire is made of,
 * plus the three pure functions that turn them into what actually gets stored.
 *
 * Lives in `shared/` beside `modules.ts` for the same reason that file does:
 * both processes may read these facts, and two hand-copied copies are how they
 * would drift. It imports `@nexus/core` and `modules.ts` and nothing else, so
 * neither side links anything new.
 *
 * The one rule both tables obey: a preset DECIDES EVERY selectable module,
 * `false` included — it is never a list of the ids that happen to be on. That
 * is what lets `onboardingPresets.test.ts` derive the expected key set from the
 * live registry and fail the moment a module is registered without anybody
 * deciding its place here. A module that silently inherited `defaultEnabled`
 * is precisely the failure mode this shape designs out.
 */

/** The four answers the „Uloga“ screen offers, in the order it lists them. */
export const ONBOARDING_OCCUPATIONS = ["student", "zaposleni", "preduzetnik", "drugo"] as const;

export type OnboardingOccupation = (typeof ONBOARDING_OCCUPATIONS)[number];

/** A decision for every selectable module — see the module comment for why `false` entries are mandatory rather than omitted. */
export type ModulePreset = Readonly<Record<string, boolean>>;

/**
 * „Osnovno“: what a profile gets when the questionnaire is skipped. It IS
 * today's personal defaults (`defaultEnabled` across the v0 manifests) written
 * out by hand — pinned by a test against the live registry, so the two can
 * never quietly disagree. PRIV is off, as it is everywhere: an opt-in section
 * (ADR-057) is never pre-chosen for anybody.
 */
export const ESSENTIALS_MODULE_PRESET: ModulePreset = {
  tasks: true,
  calendar: true,
  notes: true,
  priv: false,
  files: true,
  study: true,
  finance: true,
  habits: true,
  focus: true,
  fitness: true,
  tools: true,
};

/**
 * What each answer to „Uloga“ PRE-CHECKS on the next screen. It suggests and
 * never forces: the „Oblasti“ screen is a plain checkbox list the user is free
 * to overrule, and this only decides what it opens on.
 *
 * „Student“ and „Nešto drugo“ both land on „Osnovno“, deliberately and for
 * different reasons: the app's shipped defaults ARE the student set, and an
 * answer that says „ne uklapam se“ carries no information to act on, so it gets
 * the neutral preset rather than an invented one. The two work answers drop
 * STUDY, which is the one module their day genuinely has no place for.
 * PRIV is false in every row — see `ESSENTIALS_MODULE_PRESET`.
 *
 * FIN is true in every row, and that uniformity is a decision rather than a
 * default: „Uloga“ tells us how somebody's DAY is shaped, and money is the one
 * subject here that is shaped the same way for a student, an employee, a
 * founder and somebody who fits none of those. Dropping it for any of the four
 * would be inventing a difference the question never asked about.
 *
 * DOC is true in every row on a stronger version of the same argument: it holds
 * nothing of its own. „Datoteke“ is a way of LOOKING at files the other modules
 * already carry, so switching it off for a role would not spare anybody a
 * feature — it would only hide one view of what they have.
 *
 * HABIT is true in every row on FIN's argument exactly: „Uloga“ asks how
 * somebody's DAY is shaped, and „vežbaj, pij vodu, čitaj“ is shaped the same way
 * for a student, an employee, a founder and somebody who fits none of those.
 * Dropping it for any of the four would invent a difference the question never
 * asked about. It also costs nothing to leave on — the module holds nothing at
 * all until the user names a first habit.
 *
 * UTIL („Fokus“) is true in every row on the strongest version of that argument:
 * it is a TIMER. Sitting down to concentrate for half an hour is not shaped
 * differently for a student and a founder, and the module holds nothing at all
 * until somebody presses start. It is also the one module a role answer could
 * not sensibly drop without also dropping STUDY, since the two share the timer.
 *
 * UTIL („Alatke“) is true in every row on the same argument taken one step
 * further: the drawer holds NOTHING, ever. A converter and a percentage sum are
 * arithmetic, not data — the module writes no row for anybody — so there is no
 * clutter to spare a user by dropping it, and „koliko je ovo u inčima“ is not a
 * question shaped differently for a student and a founder. It is the one module
 * whose presence costs a profile literally nothing.
 *
 * FIT („Ishrana“) is true in every row on HABIT's argument exactly: „Uloga“ asks
 * how somebody's DAY is shaped, and eating is shaped the same way for a student,
 * an employee, a founder and somebody who fits none of those. Dropping it for
 * any of the four would invent a difference the question never asked about — and
 * it would be an invented difference ABOUT SOMEBODY'S BODY, which is the last
 * thing a role question has any standing to guess at. It costs nothing to leave
 * on: the module holds nothing until the user logs a first meal.
 */
export const OCCUPATION_MODULE_PRESETS: Readonly<Record<OnboardingOccupation, ModulePreset>> = {
  student: ESSENTIALS_MODULE_PRESET,
  zaposleni: {
    tasks: true,
    calendar: true,
    notes: true,
    priv: false,
    files: true,
    study: false,
    finance: true,
    habits: true,
    focus: true,
    fitness: true,
    tools: true,
  },
  preduzetnik: {
    tasks: true,
    calendar: true,
    notes: true,
    priv: false,
    files: true,
    study: false,
    finance: true,
    habits: true,
    focus: true,
    fitness: true,
    tools: true,
  },
  drugo: ESSENTIALS_MODULE_PRESET,
};

/** Every registered module the questionnaire may offer, in registration order — the locked pair is never one of them. */
export function selectableModuleIds(registry: ModuleRegistry): string[] {
  return registry
    .all()
    .map((manifest) => manifest.id)
    .filter((id) => !LOCKED_MODULE_IDS.has(id));
}

/**
 * The profile's LIVE module state as a preset: one entry per selectable module,
 * its stored flag row where there is one and its manifest default where there
 * is not. This is what the „Oblasti“ screen opens on in EVERY mode — which is
 * also why a fresh personal profile opens on exactly „Osnovno“, since that is
 * what those defaults spell.
 */
export function resolveModuleSelection(
  registry: ModuleRegistry,
  flags: FlagState,
): Record<string, boolean> {
  const selection: Record<string, boolean> = {};
  for (const manifest of registry.all()) {
    if (LOCKED_MODULE_IDS.has(manifest.id)) continue;
    selection[manifest.id] = flags[manifest.id] ?? manifest.defaultEnabled;
  }
  return selection;
}

/**
 * The `feature_flags` rows a completion writes, in registration order.
 *
 * `current === null` is the FIRST RUN: every selectable module is written as an
 * explicit row even where it matches its default — the `BUSINESS_DEFAULT_FLAGS`
 * argument (`main/index.ts`), that what modules you have should be a stored
 * fact of the profile rather than an accident of this build's manifest list.
 * A `current` map is a RERUN: only what actually changed is upserted, so the
 * flow never rewrites rows it was not asked to touch.
 *
 * The walk is over the REGISTRY rather than over `selection`, which is what
 * makes „never a row for a locked module“ a property of this function rather
 * than of every caller. A selectable module missing from `selection` is skipped
 * rather than guessed at.
 */
export function moduleFlagWrites(
  registry: ModuleRegistry,
  selection: Readonly<Record<string, boolean>>,
  current: Readonly<Record<string, boolean>> | null,
): { moduleId: string; enabled: boolean }[] {
  const writes: { moduleId: string; enabled: boolean }[] = [];
  for (const moduleId of selectableModuleIds(registry)) {
    const enabled = selection[moduleId];
    if (enabled === undefined) continue;
    if (current !== null && current[moduleId] === enabled) continue;
    writes.push({ moduleId, enabled });
  }
  return writes;
}
