import { TOOL_PACKS, packFlagKey, type ModuleRegistry, type ToolPack } from "@nexus/core";
import { LOCKED_MODULE_IDS } from "./modules.js";

/**
 * ADR-065 / PRD 30: what the onboarding questionnaire is made of, and the pure
 * functions that turn its answers into what actually gets stored.
 *
 * Lives in `shared/` beside `modules.ts` for the same reason that file does:
 * both processes may read these facts, and two hand-copied copies are how they
 * would drift. It imports `@nexus/core` and `modules.ts` and nothing else, so
 * neither side links anything new.
 */

/**
 * „Osnovno": what a profile gets when the questionnaire is skipped. It IS
 * today's personal defaults (`defaultEnabled` across the v0 manifests) written
 * out by hand — pinned by a test against the live registry, so the two can
 * never quietly disagree.
 *
 * **Every selectable module is decided here, `false` included.** It is never a
 * list of the ids that happen to be on. That is what lets
 * `onboardingPresets.test.ts` derive the expected key set from the live registry
 * and fail the moment a module is registered without anybody deciding its place
 * — a module that silently inherited `defaultEnabled` is precisely the failure
 * mode this shape designs out.
 *
 * PRIV is off, as it is everywhere: an opt-in section (ADR-057) is never
 * pre-chosen for anybody. PRO is off because a drawer with no packs is an empty
 * page — see `applyPackSelection`, which is the only thing that ever turns it on.
 */
export const ESSENTIALS_MODULE_PRESET: Readonly<Record<string, boolean>> = {
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
  canvas: true,
  electronics: true,
  // The first module built on the kit (ADR-090) is decided here like every other
  // selectable one: nothing about a timer asks to be opted into, so „Osnovno"
  // turns it on exactly as the manifest's own `defaultEnabled` says.
  timers: true,
  // The Reader (ADR-100) is decided here like every other selectable module:
  // nothing about a shelf of installed packs asks to be opted into, so „Osnovno"
  // turns it on exactly as the manifest's own `defaultEnabled` says. A profile
  // with no packs installed sees its empty state, which is the page telling the
  // person where packs come from.
  reader: true,
  // And the same for the culture corner (ADR-090): it holds nothing until a
  // visit, a plan or an audio file is added, so there is nothing to opt into.
  culture: true,
  // And the second (ADR-090): a cookbook writes nothing until somebody saves a
  // recipe, so there is nothing to opt into either.
  cookbook: true,
  // Likewise the recorder: a diary writes nothing until somebody records, so
  // there is nothing for a user to opt into either.
  recorder: true,
  // And the second, on the same terms: a card that is empty until somebody fills
  // it in is a card nobody needs to be asked about.
  emergency: true,
  // And the calculator (CALC, migration 079), on the same terms and for the same
  // reason: it is a bench rather than a subject, and it writes nothing at all
  // until somebody types an expression into it.
  calculator: true,
  // And the SIGNALS module, on the same terms: its page draws four instruments
  // and opens the microphone only when one of them is started, so there is
  // nothing about it to opt into either.
  signals: true,
  // The second kit module (ADR-090): a drawer of small tools, which asks to be
  // opted into no more than a timer does.
  miniapps: true,
  // The arcade is decided here like every other selectable module, and its
  // answer is `false`: PRD 31 hides the entertainment section by default and
  // never suggests it during onboarding, so a profile that never asks for it
  // never sees it. The gallery is where it is switched on.
  arcade: false,
  // And the second kit module (ADR-090), for the same reason: a board game is a
  // complete screen the moment it is on, and it writes nothing until somebody
  // plays one — so „Osnovno" decides it `true`, exactly as its manifest says.
  boards: true,
  // Šah, decided the same way and for the same reason: a board writes nothing
  // until somebody plays a game, so there is nothing here to opt into.
  chess: true,
  // The scanner, the kit's second module, is decided the same way. It does need
  // a language pack before it can read anything, and that is not a reason to
  // ship it off: the page says which pack is missing and where it is installed,
  // so the module is on and only RECOGNITION waits for the pack.
  scanner: true,
  pro: false,
  // The second module built on the kit (ADR-090), decided here like every other
  // selectable one: a library that had to be switched on first would be hiding
  // the shelf a person came for, so it follows its manifest's `defaultEnabled`.
  library: true,
  // The second kit module, decided here for the same reason: a pantry writes
  // nothing until the user records a first item, so there is nothing to opt into
  // and „Osnovno" turns it on exactly as its manifest says.
  pantry: true,
};

/**
 * The packs the questionnaire may offer — every pack that has at least one tool
 * registered against it, in `TOOL_PACKS` order.
 *
 * **This replaces a table, and the replacement is the design.** The screen this
 * feeds used to be „Uloga": five buttons, each with a hand-written row deciding
 * all thirteen modules. Generalised to professions that would have become a
 * twenty-by-thirteen matrix — 260 cells maintained by hand, which is not „a
 * table a person reads deciding what a role gets" but the place drift hides.
 *
 * More importantly it would have carried a rule somebody has to remember: *do
 * not offer a pack whose tools are not built yet*, the founder's 2026-07-12
 * „only built modules are registered" applied one level down. A user who picks
 * „Poljoprivreda" and lands on an empty list has been lied to by a questionnaire.
 * Derived from the registry, that rule is not a rule at all — an empty pack is
 * unofferable because there is nothing to build a card out of.
 *
 * So the screen has no card table. One card per pack that has contents, in the
 * order `TOOL_PACKS` declares, named from `strings.pro.packs`. Adding a pack's
 * first tool is what puts it on screen; nothing else has to happen.
 */
export function packInventory(registry: ModuleRegistry): { pack: ToolPack; toolCount: number }[] {
  const counts = new Map<string, number>();
  for (const manifest of registry.all()) {
    for (const tool of manifest.tools ?? []) {
      for (const pack of tool.packs ?? []) counts.set(pack, (counts.get(pack) ?? 0) + 1);
    }
  }
  // The count rides along rather than being a second walk: every surface that
  // lists packs also wants to say how many tools each one brings — the card
  // screen's receipt, the drawer's picker — and two functions over the same
  // registry is how the two would eventually disagree.
  return TOOL_PACKS.filter((pack) => counts.has(pack)).map((pack) => ({
    pack,
    toolCount: counts.get(pack) ?? 0,
  }));
}

/**
 * The module selection implied by a set of chosen packs: the base, plus PRO
 * switched on exactly when at least one pack was chosen.
 *
 * **This is the whole of the questionnaire's module inference, and it is one
 * line on purpose.** The obvious design — and the one this replaced — gives
 * every card a module delta: „Fotografija" turns „Učenje" off, because a
 * photographer is not sitting an exam. That is a guess, and it is the *wrong
 * kind* of guess: the card question asks what somebody's WORK is about, and
 * „Učenje" is a fact about their life. A caterer may well be finishing a degree.
 * The old „Uloga" screen could make that subtraction honestly because it asked
 * about the person's status directly; this screen does not ask, so it does not
 * answer. „Šta ti treba?" — the very next screen — is where a module is chosen,
 * and it opens on every module the profile has.
 *
 * What IS derived is PRO, because that is not a guess but an identity: the
 * professional drawer's every tool belongs to a pack, so a profile with no packs
 * would open it on an empty list. Turning it on with the first pack and off with
 * the last makes „an empty professional drawer" unreachable rather than merely
 * unlikely.
 */
export function applyPackSelection(
  base: Readonly<Record<string, boolean>>,
  packs: ReadonlySet<string>,
): Record<string, boolean> {
  return { ...base, pro: packs.size > 0 };
}

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
 * is not. This is what the „Šta ti treba?" screen opens on in EVERY mode — which
 * is also why a fresh personal profile opens on exactly „Osnovno", since that is
 * what those defaults spell.
 */
export function resolveModuleSelection(
  registry: ModuleRegistry,
  flags: Readonly<Record<string, boolean>>,
): Record<string, boolean> {
  const selection: Record<string, boolean> = {};
  for (const manifest of registry.all()) {
    if (LOCKED_MODULE_IDS.has(manifest.id)) continue;
    selection[manifest.id] = flags[manifest.id] ?? manifest.defaultEnabled;
  }
  return selection;
}

/**
 * The packs a profile currently has, as the set the cards screen opens on.
 *
 * Absent is off, always — the asymmetry with modules is deliberate and is
 * argued at `enabledPacks`: a module falls through to its manifest default
 * because the app has an opinion about whether you want a calendar, and it has
 * none about whether you are an electrician.
 */
export function resolvePackSelection(flags: Readonly<Record<string, boolean>>): Set<string> {
  return new Set(TOOL_PACKS.filter((pack) => flags[packFlagKey(pack)] === true));
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
 * makes „never a row for a locked module" a property of this function rather
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

/**
 * The pack rows a completion writes — `moduleFlagWrites`' rule, applied to the
 * other half of what the questionnaire decides.
 *
 * The walk is over `TOOL_PACKS` and not over the packs that HAVE tools, and the
 * difference matters exactly once: a first run stores a `false` row for a pack
 * whose tools ship in a later version, so when they arrive the user's „no" is
 * already on record rather than being asked again. That is the stored-fact
 * argument taken to its conclusion — what toolkits you have is a fact of the
 * profile, not an accident of which build first offered them.
 *
 * A rerun still upserts only what changed, so a pack that appeared since the
 * first run and has not been answered for simply stays absent, which reads as
 * off and is offered next time the screen opens.
 */
export function packFlagWrites(
  packs: ReadonlySet<string>,
  current: ReadonlySet<string> | null,
): { moduleId: string; enabled: boolean }[] {
  const writes: { moduleId: string; enabled: boolean }[] = [];
  for (const pack of TOOL_PACKS) {
    const enabled = packs.has(pack);
    if (current !== null && current.has(pack) === enabled) continue;
    writes.push({ moduleId: packFlagKey(pack), enabled });
  }
  return writes;
}
