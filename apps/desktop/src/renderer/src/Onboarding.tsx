import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { buildNoteUpdate, parseMarkdownNote } from "@nexus/core";
import type { FlagState, ModuleRegistry } from "@nexus/core";
import { Button, Card, Checkbox, Chip, StarField, TextField } from "@nexus/ui";
import type { ThemeName } from "@nexus/tokens";
import type { Profile, ProfileKind } from "../../shared/ipc.js";
import { LOCKED_MODULE_IDS } from "../../shared/modules.js";
import {
  applyPackSelection,
  moduleFlagWrites,
  packFlagWrites,
  packInventory,
  resolveModuleSelection,
  resolvePackSelection,
} from "../../shared/onboardingPresets.js";
import { NOTIFICATION_PRESETS, type NotificationPresetKey } from "./notificationFormat.js";
import {
  clearOnboardingDraft,
  readOnboardingDraft,
  writeOnboardingDraft,
} from "./onboardingDraft.js";
import { fill, lookup, strings } from "./strings.js";

/** Mirrors the main-process rule: 1–80 chars after trimming (UX-side only). */
const NAME_MAX = 80;

/** The questionnaire's screens, in order. */
type OnboardingStep = "ime" | "nedelja" | "oblasti" | "podsetnici";

const PERSONAL_STEPS: readonly OnboardingStep[] = ["ime", "nedelja", "oblasti", "podsetnici"];

/**
 * The BUSINESS flow is the same four screens.
 *
 * **It used to be three, and dropping one was right for the question that used
 * to be there.** „Uloga“ asked whether somebody was a student, an employee or a
 * founder, and a business profile already knows: its module set is its own
 * creation-time preset (ADR-058), so the answer had nothing to do with anything.
 *
 * „Tvoja nedelja“ asks something else entirely — which trades' toolkits this
 * profile should carry — and a business profile is the one that most obviously
 * has an answer. A caterer's business profile is exactly the profile that wants
 * „Kuhinja i porcije“. Skipping it there would have hidden the feature from its
 * best user in order to preserve a shape whose reason had already gone.
 */
const BUSINESS_STEPS: readonly OnboardingStep[] = PERSONAL_STEPS;

/**
 * The screens that answer with a LIST rather than with one field, and therefore
 * get the wide card (`.onb__card--wide`).
 *
 * „Tvoja nedelja“ is what forced it: nineteen toolkits at the naming screen's
 * 400px is a scroll where most of the answers start below the fold, and the
 * screen only works if a person can see their trade without hunting for it.
 * „Šta ti treba?“ is the same shape one screen later, so it goes with it rather
 * than making the card change width twice in three screens.
 */
const WIDE_STEPS: ReadonlySet<OnboardingStep> = new Set<OnboardingStep>(["nedelja", "oblasti"]);

/**
 * Where a resumed run picks up. The draft stores the step RAW, so this is where
 * it is checked against the list THIS profile's flow actually has — a personal
 * draft carrying „uloga“ read by a business flow simply starts over, which is
 * the right answer for a screen that flow does not contain.
 */
function resumeStep(steps: readonly OnboardingStep[], stored: string | undefined): OnboardingStep {
  return steps.find((step) => step === stored) ?? "ime";
}

/**
 * The flow's whole state, as one discriminated union rather than a pair of
 * independent booleans (the `RestoreState` idiom): „asking, with an error from
 * the last attempt“ and „writing right now“ are then mutually exclusive by
 * construction, so a spinner can never render over a stale failure and a
 * failed write always puts the user back on the screen they pressed from.
 */
type FlowState =
  | { phase: "asking"; step: OnboardingStep; error: string | null }
  | { phase: "saving"; step: OnboardingStep };

export type OnboardingMode = "first-run" | "rerun";

export interface OnboardingResult {
  /** The stored (trimmed) name. */
  name: string;
  /** The profile's flags as they stand after the completion writes — read back from main, never assumed. */
  flags: FlagState;
  /**
   * The demo profile this run created, or `null` when it did not (not asked
   * for, a rerun, a business profile, or the seed failed).
   *
   * It is REPORTED rather than left for the shell to discover, because the
   * shell holds the profile list in its own state and only ever patches it. A
   * profile created here and not handed back is a profile the switcher does not
   * list until the next launch — and, worse, one the „Dodaj demo profil" entry
   * keeps offering to create, because that entry's condition is „no profile
   * named Demo in the cached list". The user would then press it and be told by
   * main that the account already has one.
   */
  demoProfile: Profile | null;
}

export interface OnboardingProps {
  profileId: string;
  /**
   * Which profile is being set up. A BUSINESS first entry (ADR-058 §5) skips
   * the theme group entirely — the theme is device-wide and was chosen long
   * before a second profile existed, so re-asking would offer to change
   * something this screen is not about — words its own intro, skips „Uloga“,
   * and gets no welcome note.
   */
  kind: ProfileKind;
  mode: OnboardingMode;
  /** The profile's current name: empty on a first run (the ONB sentinel), the live name on a rerun, where screen 1 shows it editable. */
  initialName: string;
  /** The profile's LIVE stored flags — what „Oblasti“ opens on, in every mode. */
  flags: FlagState;
  registry: ModuleRegistry;
  theme: ThemeName;
  /** Persistence lives in the caller (SET owns theme.ts's write path); this just reports the pick. */
  onThemeChange: (theme: ThemeName) => void;
  /** Rerun only: leave without writing anything. Null on a first run, where there is nothing to go back to. */
  onCancel: (() => void) | null;
  /** Called once every write has landed. */
  onComplete: (result: OnboardingResult) => void;
}

/**
 * ONB (ADR-065): the four-screen questionnaire — ime + tema, uloga, oblasti,
 * podsetnici — that replaced ONB-lite's single naming screen. Drawn on the same
 * `.onb` shell `AuthGate` mirrors, so the first and second screens a user ever
 * sees still match.
 *
 * **The name sentinel stays the completion fact.** `App` withholds the shell
 * while the active profile's name is empty (ADR-058), and that one sentinel
 * already buys per-profile gating, resume on relaunch, resume across a lock
 * cycle, and correct restore/business re-entry behaviour. So completion IS the
 * single `renameProfile` write, and it happens at the END of the sequence: no
 * earlier screen may commit the name, or the gate would open mid-questionnaire.
 * Everything before it (flag rows, the appetite answer) is idempotent, so a
 * failed rename leaves a retry that costs nothing.
 *
 * **In-progress state** lives in `localStorage` (`onboardingDraft.ts`), not in
 * a table: an interrupted first run belongs to this machine and legitimately
 * never travels in an archive. Cleared on completion.
 *
 * **Every screen is skippable.** „Preskoči“ completes with what the flow
 * currently holds — which, on a run where nothing was answered, is exactly the
 * „Osnovno“ preset, because that preset IS what a fresh profile's defaults
 * resolve to (pinned in `onboardingPresets.test.ts`). Committing the current
 * selection rather than reverting to a constant is what keeps a skip from
 * silently undoing answers the user did give, and from flattening a business
 * profile's own creation-time preset. Screen 1's name is required even on skip:
 * a profile needs its name, and one field is not a flow.
 *
 * A RERUN has no „Preskoči“ at all — it offers „Otkaži“ instead. Skipping to a
 * constant would clear live settings the flow was never asked to touch, which
 * §5 forbids; leaving without writing is the honest equivalent. A rerun also
 * writes no welcome note and upserts only the flags that actually changed.
 */
export function Onboarding({
  profileId,
  kind,
  mode,
  initialName,
  flags,
  registry,
  theme,
  onThemeChange,
  onCancel,
  onComplete,
}: OnboardingProps) {
  const s = strings.onboarding;
  const business = kind === "business";
  const rerun = mode === "rerun";
  const steps = business ? BUSINESS_STEPS : PERSONAL_STEPS;

  // Read once. Both render sites mount this per profile, so `profileId` is
  // constant for the lifetime of a mount — the `SettingsPage` accent recipe.
  // A rerun deliberately reads no draft: it starts from the LIVE state, and a
  // rerun interrupted by a lock has no gate to come back through anyway.
  const [draft] = useState(() => (rerun ? null : readOnboardingDraft(profileId)));

  const [name, setName] = useState(() => draft?.name ?? initialName);
  /**
   * „Tvoja nedelja“ — the toolkits this profile carries.
   *
   * Opens on the profile's LIVE packs in every mode, which is the same honest
   * merge „Šta ti treba?“ makes for modules: what you have is what you start
   * from. For a fresh profile that is the empty set, because a pack is only ever
   * something somebody asked for.
   */
  const [packs, setPacks] = useState<Set<string>>(() =>
    draft === null ? resolvePackSelection(flags) : new Set(draft.packs),
  );
  // „Oblasti“ opens on the profile's live flags in every mode — the honest
  // merge (what you have is what you start from), which for a fresh personal
  // profile is „Osnovno“ by construction.
  const [selection, setSelection] = useState<Record<string, boolean>>(
    () => draft?.modules ?? resolveModuleSelection(registry, flags),
  );
  // NTF-008 is asked ONCE, ever: no pick here is a real answer that leaves the
  // first-reminder-moment dialog armed, so this starts — and may stay — null.
  const [appetite, setAppetite] = useState<NotificationPresetKey | null>(null);
  /**
   * „Dodaj i „Demo" profil" — offered on the last screen of a personal first
   * run and nowhere else in this flow.
   *
   * OFF by default, and that is the whole shape of the decision: a profile
   * holding several hundred rows of somebody else's invented life is a real
   * thing to put in an account, so it is something a person asks for rather
   * than something they have to notice and refuse. It is deliberately NOT in
   * the draft: the draft resumes an interrupted questionnaire, and a request
   * to write half a thousand rows should be made by somebody who is looking at
   * the screen at the time.
   */
  const [wantsDemo, setWantsDemo] = useState(false);
  const [state, setState] = useState<FlowState>(() => ({
    phase: "asking",
    step: resumeStep(steps, draft?.step),
    error: null,
  }));

  // The in-flight guard is a ref, not the `saving` state (the appetite dialog's
  // own rule): two clicks inside one render would both read the same
  // not-yet-flushed `false` — and completion is the one act here that is not
  // idempotent, since a second pass would leave a second welcome note.
  const completing = useRef(false);

  // The toolkits this build can honestly offer — derived from the registry, so
  // a pack whose tools are not written yet simply has no card (`packInventory`).
  const offeredPacks = packInventory(registry);

  const stepIndex = steps.indexOf(state.step);
  const saving = state.phase === "saving";
  const trimmed = name.trim();
  const nameValid = trimmed.length >= 1 && trimmed.length <= NAME_MAX;
  const lastStep = stepIndex === steps.length - 1;

  // The draft is the resume story for a first run interrupted by the idle
  // auto-lock; a rerun has none to keep (see the `draft` initializer).
  useEffect(() => {
    if (rerun) return;
    writeOnboardingDraft(profileId, {
      step: state.step,
      name,
      packs: [...packs],
      modules: selection,
    });
  }, [rerun, profileId, state.step, name, packs, selection]);

  function goTo(step: OnboardingStep): void {
    setState({ phase: "asking", step, error: null });
  }

  /**
   * Ticking a card adds or removes one toolkit, and — through
   * `applyPackSelection` — switches „Stručne alatke“ on with the first and off
   * with the last.
   *
   * **It touches no other module, and the restraint is the whole point.** The
   * screen this replaced re-seeded the ENTIRE module selection from the role's
   * table on every answer, discarding hand-made ticks, and it could do that
   * honestly because it asked what kind of life somebody had. „Tvoja nedelja“
   * asks what their WORK is about, which says nothing about whether they keep
   * habits or sit exams — so it decides the drawer it is asking about and
   * leaves the next screen's answer alone.
   */
  function togglePack(pack: string, on: boolean): void {
    // Computed here rather than inside a `setPacks` updater: the updater form
    // would put a second `setState` inside a function React is free to call
    // twice, and „free to call twice" is exactly what a reducer promises. One
    // click is one render, so reading the current set from the closure is the
    // honest version of the same thing.
    const next = new Set(packs);
    if (on) next.add(pack);
    else next.delete(pack);
    setPacks(next);
    setSelection((selected) => applyPackSelection(selected, next));
  }

  function toggleModule(moduleId: string, enabled: boolean): void {
    setSelection((current) => ({ ...current, [moduleId]: enabled }));
  }

  /**
   * The one place anything is written. Order is load-bearing: the flag rows and
   * the appetite answer are idempotent and go first, the ONE rename lands last
   * (the gate, see the component comment), and the welcome note comes after it
   * as best-effort — a note that failed to write must never cost the user the
   * completion, and writing it after the rename is what keeps a retry from
   * leaving two of them.
   */
  async function complete(
    nextSelection: Readonly<Record<string, boolean>>,
    nextPacks: ReadonlySet<string>,
    nextAppetite: NotificationPresetKey | null,
  ): Promise<void> {
    if (completing.current || !nameValid) return;
    completing.current = true;
    setState({ phase: "saving", step: state.step });
    try {
      // The packs go through the SAME channel as the modules and obey the same
      // first-run / rerun rule — they are `feature_flags` rows under a `pack:`
      // key, not a store of their own (`packFlagKey`).
      //
      // **They are written FIRST, and the order is load-bearing.** „Stručne
      // alatke" is switched on by this run exactly when a pack was chosen, so
      // writing the modules first would mean a failure between the two loops
      // leaves the drawer ON with nothing in it — the empty page this whole
      // design exists to make unreachable. This way round, the worst a partial
      // failure leaves is packs on record and the drawer still off, which is
      // both harmless and exactly what the retry then fixes.
      const currentPacks = rerun ? resolvePackSelection(flags) : null;
      for (const { moduleId, enabled } of packFlagWrites(nextPacks, currentPacks)) {
        await window.nexus.setFlag(profileId, moduleId, enabled);
      }
      // First run writes every selectable module as an EXPLICIT row (the
      // `BUSINESS_DEFAULT_FLAGS` argument); a rerun upserts only what changed.
      const current = rerun ? resolveModuleSelection(registry, flags) : null;
      for (const { moduleId, enabled } of moduleFlagWrites(registry, nextSelection, current)) {
        await window.nexus.setFlag(profileId, moduleId, enabled);
      }
      const preset = NOTIFICATION_PRESETS.find((candidate) => candidate.key === nextAppetite);
      if (preset !== undefined) {
        // Answers the once-ever question AND marks it asked, so the queued
        // first-moment dialog does not pop the instant onboarding ends.
        await window.nexus.answerNotificationAppetite(profileId, preset.sources);
      }
      if (trimmed !== initialName.trim()) {
        await window.nexus.renameProfile(profileId, trimmed);
      }
      const stored = await window.nexus.getFlags(profileId);
      if (!rerun && !business && (nextSelection["notes"] ?? false)) {
        await writeWelcomeNote(profileId);
      }
      // BEST-EFFORT, on the welcome note's terms exactly: the demo profile is
      // an extra, and failing to write one must never cost somebody the first
      // run they have just finished. It is also the slowest thing this flow
      // does — main writes several hundred rows synchronously — which is why
      // it comes after everything the profile itself needs, and why the button
      // is already showing its saving state by the time it starts.
      let demoProfile: Profile | null = null;
      if (wantsDemo && !rerun && !business) {
        try {
          demoProfile = await window.nexus.createDemoProfile();
        } catch (error) {
          console.error("Nexus: failed to add the demo profile:", error);
        }
      }
      clearOnboardingDraft(profileId);
      onComplete({ name: trimmed, flags: stored, demoProfile });
    } catch (error) {
      // Nothing written so far is lost or half-applied: the flag rows and the
      // appetite answer are upserts, and the name — the gate — is the last
      // thing attempted, so a failure leaves the user exactly where they were,
      // free to press again.
      completing.current = false;
      setState({ phase: "asking", step: state.step, error: s.saveError });
      console.error("Nexus: failed to finish onboarding:", error);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (saving) return;
    if (state.step === "ime" && !nameValid) return;
    const next = steps[stepIndex + 1];
    if (next !== undefined) {
      goTo(next);
      return;
    }
    void complete(selection, packs, appetite);
  }

  return (
    <div className="onb">
      {/* The second screen a person ever sees, on the same ground as the
          first (`AuthGate`). The sky is permitted here by `StarField`'s own
          rule — a fixed, centred grid that never scrolls. */}
      <StarField />
      {/* The two screens that ask somebody to PICK from a list get the wider
          card; the two that ask one question keep the 400px `.auth` mirrors.
          Derived from the step rather than hard-coded per screen, so a screen
          added to either list cannot end up with the wrong width by omission. */}
      <Card className={`onb__card${WIDE_STEPS.has(state.step) ? " onb__card--wide" : ""}`}>
        <form className="onb__form" onSubmit={submit}>
          <span className="onb__brand" aria-hidden="true">✦</span>
          <p className="onb__steps">
            {s.stepPrefix} {stepIndex + 1} {s.stepOf} {steps.length}
          </p>

          {state.step === "ime" && (
            <>
              <h1 className="onb__title">
                {rerun ? s.rerunTitle : business ? s.titleBusiness : s.title}
              </h1>
              <p className="onb__desc">
                {rerun ? s.rerunDescription : business ? s.descriptionBusiness : s.description}
              </p>
              <TextField
                label={s.nameLabel}
                placeholder={s.namePlaceholder}
                value={name}
                maxLength={NAME_MAX}
                autoFocus
                required
                onChange={(event) => setName(event.target.value)}
              />
              {!business && (
                <div className="onb__theme" role="group" aria-label={s.themeLabel}>
                  <span className="onb__theme-label">{s.themeLabel}</span>
                  <div className="onb__theme-options">
                    {(["dan", "noc"] as const).map((option) => (
                      <Button
                        key={option}
                        size="sm"
                        variant={theme === option ? "primary" : "ghost"}
                        aria-pressed={theme === option}
                        onClick={() => onThemeChange(option)}
                      >
                        {option === "dan" ? strings.app.themeDan : strings.app.themeNoc}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {state.step === "nedelja" && (
            <>
              <h1 className="onb__title">{s.packsTitle}</h1>
              <p className="onb__desc">{s.packsDescription}</p>
              {/* One card per STOCKED pack, in `TOOL_PACKS` order. There is no
                  card table to keep in step with the packs — a pack with no
                  tools has nothing to put on a card, so „do not offer a toolkit
                  that is not built yet" is a property here rather than a rule
                  somebody has to remember (`packInventory`).

                  Multi-select, uncapped, and nothing signals that one answer is
                  normal and three are greedy: most people's working week is
                  more than one subject, and the professor who also freelances
                  is the ordinary case rather than the advanced one.

                  The card is the DRAWER's block (`.pro-kit`, `tools.css`), not a
                  local one: this screen and „Paketi…" show the same object, and
                  a chosen toolkit has to look the same in both. */}
              <div className="pro-kits pro-kits--capped" role="group" aria-label={s.packsTitle}>
                {offeredPacks.map(({ pack, toolCount }) => {
                  const chosen = packs.has(pack);
                  const copy = strings.pro.packs[pack];
                  return (
                    <button
                      key={pack}
                      type="button"
                      className={`pro-kit${chosen ? " pro-kit--on" : ""}`}
                      aria-pressed={chosen}
                      onClick={() => togglePack(pack, !chosen)}
                    >
                      <span className="pro-kit-name">{copy.name}</span>
                      {/* The professions, under the subject. The packs are
                          named after what the work IS, which is what lets a
                          geodeta recognise „Gradnja i projektovanje" without
                          being on anybody's list — but it costs the one thing a
                          list of job titles gives away free, which is seeing
                          your own word. This line is that word. */}
                      <span className="pro-kit-who">{copy.who}</span>
                      <span className="pro-kit-count">
                        {fill(strings.pro.picker.contains, { count: toolCount })}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* There is deliberately no „Nešto drugo" card. Picking nothing IS
                  „nešto drugo", and it already means exactly what it should. */}
              <p className="onb__caption">{s.packsNoChoice}</p>
              {/* The same sentence the picker carries, on the screen where most
                  people will actually choose their toolkits for the first time.
                  Repeating it is the point: this and „Paketi…" are the two doors
                  into the professional drawer, and a characterisation that only
                  one door carries is a characterisation half the users never
                  see. */}
              <p className="onb__caption">{strings.pro.picker.responsibility}</p>
            </>
          )}

          {state.step === "oblasti" && (
            <>
              <h1 className="onb__title">{s.modulesTitle}</h1>
              <p className="onb__desc">{s.modulesDescription}</p>
              {/* The receipt, and it lists only what is ON.
                  A confirmation that draws all nineteen toolkits is a
                  confirmation nobody reads; a person who ticked two cards
                  changed two things and should see two rows. Everything else is
                  reachable from the drawer's own „Paketi…" at any time, which is
                  where a veto belongs after the questionnaire is over. */}
              {packs.size > 0 && (
                <div className="onb__module-group">
                  <h2 className="onb__module-group-title">{strings.pro.picker.title}</h2>
                  <div className="onb__module-list">
                    {offeredPacks
                      .filter(({ pack }) => packs.has(pack))
                      .map(({ pack, toolCount }) => (
                        <div className="onb__module-row" key={pack}>
                          <div className="onb__module-info">
                            <span className="onb__module-name">{strings.pro.packs[pack].name}</span>
                            <span className="onb__module-desc">
                              {fill(strings.pro.picker.contains, { count: toolCount })}
                            </span>
                          </div>
                          <Checkbox
                            checked
                            aria-label={strings.pro.packs[pack].name}
                            onChange={() => togglePack(pack, false)}
                          />
                        </div>
                      ))}
                  </div>
                </div>
              )}
              {/* The Settings gallery's own markup and its own copy: the two
                  screens ask the same question, and the locked pair is drawn
                  as an „Uvek uključeno“ chip in both. */}
              <div className="onb__modules">
                {[...registry.byCategory()].map(([category, members]) => (
                  <div key={category} className="onb__module-group">
                    <h2 className="onb__module-group-title">
                      {strings.settings.moduleCategories[category] ?? category}
                    </h2>
                    <div className="onb__module-list">
                      {members.map((manifest) => {
                        const label = lookup(strings.modules, manifest.id) ?? manifest.id;
                        return (
                          <div className="onb__module-row" key={manifest.id}>
                            <div className="onb__module-info">
                              <span className="onb__module-name">{label}</span>
                              <span className="onb__module-desc">
                                {lookup(strings.settings.moduleDescriptions, manifest.id) ?? ""}
                              </span>
                            </div>
                            {LOCKED_MODULE_IDS.has(manifest.id) ? (
                              <Chip>{strings.settings.modulesAlwaysOn}</Chip>
                            ) : (
                              <Checkbox
                                checked={selection[manifest.id] ?? false}
                                aria-label={label}
                                onChange={(event) =>
                                  toggleModule(manifest.id, event.target.checked)
                                }
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {state.step === "podsetnici" && (
            <>
              <h1 className="onb__title">{s.remindersTitle}</h1>
              <p className="onb__desc">{s.remindersDescription}</p>
              <div className="onb__choices" role="group" aria-label={s.remindersTitle}>
                {NOTIFICATION_PRESETS.map((preset) => (
                  <Button
                    key={preset.key}
                    className="onb__choice"
                    variant={appetite === preset.key ? "primary" : "ghost"}
                    aria-pressed={appetite === preset.key}
                    onClick={() => setAppetite(preset.key)}
                  >
                    {strings.settings.notificationPresets[preset.key]}
                  </Button>
                ))}
              </div>
              <p className="onb__caption">{s.remindersNoChoice}</p>
              {/* The last screen, because this is the only question here that
                  is not about the profile being made — it offers a SECOND one.
                  A personal first run only: a rerun is somebody adjusting a
                  profile they already have, and a business profile's demo is
                  its own account-level thing. */}
              {!rerun && !business && (
                <div className="onb__demo">
                  <Checkbox
                    checked={wantsDemo}
                    onChange={(event) => setWantsDemo(event.target.checked)}
                  >
                    {s.demoLabel}
                  </Checkbox>
                  <p className="onb__caption">{s.demoHint}</p>
                </div>
              )}
            </>
          )}

          {state.phase === "asking" && state.error != null && (
            <p className="onb__error" role="alert">
              {state.error}
            </p>
          )}

          <div className="onb__actions">
            {stepIndex > 0 && (
              <Button
                size="sm"
                disabled={saving}
                onClick={() => {
                  const previous = steps[stepIndex - 1];
                  if (previous !== undefined) goTo(previous);
                }}
              >
                {s.back}
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={saving || (state.step === "ime" && !nameValid)}
            >
              {lastStep ? s.start : s.next}
            </Button>
          </div>

          {/* Quiet and typographic, the `.set__reset` idiom: an exit is
              available, not advertised. A first run skips (and completes); a
              rerun cancels (and writes nothing). */}
          {rerun ? (
            onCancel !== null && (
              <button type="button" className="onb__quiet" disabled={saving} onClick={onCancel}>
                {s.cancel}
              </button>
            )
          ) : (
            <button
              type="button"
              className="onb__quiet"
              disabled={saving || !nameValid}
              onClick={() => void complete(selection, packs, null)}
            >
              {s.skip}
            </button>
          )}
        </form>
      </Card>
    </div>
  );
}

/**
 * The one genuine starter row (ADR-065 §4): „Dobro došli u Nexus“, written
 * through the REAL note-creation path the markdown import uses — `createNote`
 * mints the row and `appendNoteUpdate` writes the document and the
 * denormalised title, after which main compacts it into the searchable
 * snapshot on its own idle timer. So the welcome note is indistinguishable
 * from a typed one: search finds it, version history has it, and deleting it
 * is an ordinary delete.
 *
 * No sample tasks, events or notes accompany it — the `EmptyState` pattern
 * already standing across the app IS the first-run experience, and fabricated
 * data is not something this app ships.
 */
async function writeWelcomeNote(profileId: string): Promise<void> {
  try {
    const parsed = parseMarkdownNote(
      strings.onboarding.welcomeNote.body,
      strings.onboarding.welcomeNote.title,
    );
    if (parsed.blocks.length === 0) return;
    const note = await window.nexus.createNote(profileId);
    await window.nexus.appendNoteUpdate(
      profileId,
      note.id,
      buildNoteUpdate(parsed.blocks),
      parsed.title,
    );
  } catch (error) {
    // Best-effort by design: the profile is named and configured by now, and
    // losing a starter note is not worth sending the user back through a
    // questionnaire they have already answered.
    console.error("Nexus: failed to write the welcome note:", error);
  }
}
