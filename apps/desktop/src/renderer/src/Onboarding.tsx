import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  KEEPS,
  TEMPOS,
  TRADE_ACTIVITIES,
  WEEK_SHAPES,
  buildProfilePlan,
  keeps,
  recognizeTrades,
  tempoOf,
  weekShapes,
} from "@nexus/core";
import type {
  FlagState,
  Keep,
  ModuleRegistry,
  ProfilePlan,
  Signal,
  Tempo,
  TradeMatch,
  WeekShape,
} from "@nexus/core";
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
  type OnboardingDraft,
} from "./onboardingDraft.js";
import { PLAN_STAGES, applyProfilePlan, type PlanStage } from "./profilePlanApply.js";
import { heardTrades, joinList, packName, planReasonLines } from "./profilePlanCopy.js";
import { persistSignals } from "./signalPrefs.js";
import { moduleDescription, moduleName } from "./moduleName.js";
import { fill, lookup, strings } from "./strings.js";

/** Mirrors the main-process rule: 1–80 chars after trimming (UX-side only). */
const NAME_MAX = 80;

/**
 * The trade field's cap. Generous, because it is a sentence and not a job
 * title — „stolar, radim i montažu kuhinja" is exactly the kind of answer the
 * lexicon is built to read — but bounded, because a `term` quoted back on the
 * reveal comes out of this text.
 */
const TRADE_MAX = 120;

/** At most two week shapes: three is a shrug, and a shrug carries no information (`signals.ts`). */
const WEEK_CAP = 2;

/** The questionnaire's screens, in order. */
type OnboardingStep = "ime" | "nedelja" | "posao" | "ritam" | "oko" | "podsetnici";

/**
 * ADR-086's flow: a name, and then four questions about the PERSON.
 *
 * **The business flow is the same six screens**, and it used to be worth a
 * paragraph explaining why one was dropped. The reason has only got stronger:
 * every question here is about the work and the week this profile is FOR, and a
 * business profile is the one that most obviously has an answer. A caterer's
 * business profile is exactly the profile that should say „kuvam".
 */
const STEPS: readonly OnboardingStep[] = ["ime", "nedelja", "posao", "ritam", "oko", "podsetnici"];

/**
 * The screens that answer with a LIST rather than with one field, and therefore
 * get the wide card (`.onb__card--wide`).
 *
 * The 400px the naming screen shares with `.auth` is the width of a screen a
 * person sees seconds after the lock screen, and that match is worth keeping
 * where it is visible. It is not a width to answer six week shapes, fourteen
 * activities or five subjects in: one column turns the most important questions
 * in the flow into a scroll where most of the answers start below the fold.
 */
const WIDE_STEPS: ReadonlySet<OnboardingStep> = new Set<OnboardingStep>([
  "nedelja",
  "posao",
  "ritam",
  "oko",
]);

/** What „Priprema" narrates: the four stages `applyProfilePlan` runs, then everything the run still owes. */
type PrepareStage = PlanStage | "done";

const PREPARE_STAGES: readonly PrepareStage[] = [...PLAN_STAGES, "done"];

/**
 * How long each „Priprema" line is held — four plan stages plus a closing beat,
 * so the screen lasts about two and a half seconds.
 *
 * It is a FLOOR under real work, never a substitute for it: `onStage` is
 * awaited, so the stage that is being named is the stage that is being written,
 * and a slow machine simply takes longer. A progress screen that narrates
 * stages it is not running is the one kind of loading screen a user is right to
 * resent.
 */
const STAGE_MS = 520;

/**
 * Holds one stage's line on screen.
 *
 * Collapsed to nothing under `prefers-reduced-motion`: somebody who has asked
 * the system to stop performing has asked this screen to stop performing too,
 * and what is left — the same five lines, written as fast as the work allows —
 * is still the truth about what happened.
 */
function beat(): Promise<void> {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return new Promise((resolve) => {
    setTimeout(resolve, still ? 0 : STAGE_MS);
  });
}

/**
 * Where a resumed run picks up. The draft stores the step RAW, so this is where
 * it is checked against the list THIS build actually has — a draft written by
 * the ADR-065 flow carries „oblasti“ and simply starts over, which is the right
 * answer for a screen this flow does not contain.
 */
function resumeStep(stored: string | undefined): OnboardingStep {
  return STEPS.find((step) => step === stored) ?? "ime";
}

/**
 * Which activity chips a resumed draft had ticked.
 *
 * Matched on the LABEL, because that is what a signal carries: `term` is what
 * the reveal quotes back, so an activity signal holds „Vodim knjige" and not
 * the id `knjige`. The cost is that a build which rewords a chip loses that one
 * tick on resume — invisible and harmless — where storing the id beside the
 * term would be a second spelling of the same answer in the durable record.
 */
function resumeActivities(signals: readonly Signal[]): string[] {
  const terms = new Set<string>();
  for (const signal of signals) {
    if (signal.kind === "trade" && signal.via === "activity") terms.add(signal.term);
  }
  return TRADE_ACTIVITIES.filter((activity) =>
    terms.has(lookup(strings.onboarding.trade.activities, activity.id) ?? activity.id),
  ).map((activity) => activity.id);
}

/**
 * Which recognised terms a resumed draft had DISMISSED — derived, never stored.
 *
 * Recognition is deterministic over the stored text, so „what the lexicon finds
 * in this text now" minus „what the draft still carries" is exactly the set of
 * chips the person removed. A stored dismissal list would be a second record of
 * the same fact, free to disagree with the first.
 */
function resumeDismissed(draft: OnboardingDraft): Set<string> {
  const kept = new Set<string>();
  for (const signal of draft.signals) {
    if (signal.kind === "trade" && signal.via === "typed") kept.add(signal.term);
  }
  const gone = new Set<string>();
  for (const match of recognizeTrades(draft.trade)) {
    if (!kept.has(match.term)) gone.add(match.term);
  }
  return gone;
}

/**
 * The flow's whole state, as one discriminated union rather than a set of
 * independent booleans (the `RestoreState` idiom): „asking, with an error from
 * the last attempt“ and „writing right now“ are then mutually exclusive by
 * construction, so a progress screen can never render over a stale failure and
 * a failed write always puts the user back on the screen they pressed from.
 */
type FlowState =
  | { phase: "asking"; step: OnboardingStep; error: string | null }
  | { phase: "preparing"; stage: PrepareStage }
  | { phase: "reveal" }
  | { phase: "advanced"; error: string | null }
  | { phase: "advanced-saving" };

/** What „Priprema“ produced — everything the reveal shows and the completion hands back. */
interface PrepareOutcome {
  readonly name: string;
  readonly flags: FlagState;
  readonly demoProfile: Profile | null;
  /** Kept so the reveal can explain itself from the SAME plan that was applied, never a rebuilt one. */
  readonly plan: ProfilePlan;
}

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
   * something this screen is not about — words its own intro, and gets no
   * welcome note.
   */
  kind: ProfileKind;
  mode: OnboardingMode;
  /** The profile's current name: empty on a first run (the ONB sentinel), the live name on a rerun, where screen 1 shows it editable. */
  initialName: string;
  /** The profile's LIVE stored flags — the base every plan is merged onto, in every mode. */
  flags: FlagState;
  registry: ModuleRegistry;
  theme: ThemeName;
  /** Persistence lives in the caller (SET owns theme.ts's write path); this just reports the pick. */
  onThemeChange: (theme: ThemeName) => void;
  /** Rerun only: leave without writing anything. Null on a first run, where there is nothing to go back to. */
  onCancel: (() => void) | null;
  /** Called once every write has landed and the user has left the reveal. */
  onComplete: (result: OnboardingResult) => void;
}

/**
 * ONB (ADR-065, rebuilt by ADR-086): the questionnaire that decides what this
 * person's Nexus looks like. Drawn on the same `.onb` shell `AuthGate` mirrors,
 * so the first and second screens a user ever sees still match.
 *
 * **It asks about the person and never about the software.** ADR-065's version
 * was thirty-two checkboxes — „do you want the Finance module" — which is the
 * questionnaire asking the user to do its job, and it produced the same app for
 * everybody who ticked the same boxes. The four questions here (a week, a
 * trade, a tempo, what to keep an eye on) produce `Signal`s; `buildProfilePlan`
 * turns those into modules, a board, a sidebar shortlist, an accent and a
 * calendar view; `applyProfilePlan` writes them. The checkbox screens survive
 * as „Podesi ručno" — reachable, never on the path.
 *
 * **The name sentinel stays the completion fact.** `App` withholds the shell
 * while the active profile's name is empty (ADR-058), and that one sentinel
 * already buys per-profile gating, resume on relaunch, resume across a lock
 * cycle, and correct restore/business re-entry behaviour. So completion IS the
 * single `renameProfile` write, and it happens INSIDE „Priprema", after the
 * plan has been applied: no earlier screen may commit the name, or the gate
 * would open mid-questionnaire. Everything before it is idempotent, so a failed
 * rename leaves a retry that costs nothing.
 *
 * **In-progress state** lives in `localStorage` (`onboardingDraft.ts`), not in
 * a table: an interrupted first run belongs to this machine and legitimately
 * never travels in an archive. Cleared on completion — at which point the
 * ANSWERS are written to `signalPrefs.ts`, which outlives the run so
 * „Podešavanja → Kako je Nexus podešen za tebe" can rebuild the same plan and
 * say the same sentences a year later.
 *
 * **Every screen is skippable.** „Preskoči“ runs the preparation with whatever
 * the flow currently holds — which, on a run where nothing was answered, is no
 * signals at all, and `buildProfilePlan`'s first law says that is today's app
 * exactly. Screen 1's name is required even on skip: a profile needs its name,
 * and one field is not a flow.
 *
 * A RERUN has no „Preskoči“ at all — it offers „Otkaži“ instead. It also writes
 * no welcome note, creates no demo profile, and upserts only the flags that
 * actually changed.
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

  // Read once. Both render sites mount this per profile, so `profileId` is
  // constant for the lifetime of a mount — the `SettingsPage` accent recipe.
  // A rerun deliberately reads no draft: it starts from the LIVE state, and a
  // rerun interrupted by a lock has no gate to come back through anyway.
  const [draft] = useState(() => (rerun ? null : readOnboardingDraft(profileId)));

  const [name, setName] = useState(() => draft?.name ?? initialName);

  // The four answers, each as the screen holds it. `signals` below is DERIVED
  // from them — one direction only, so the questionnaire's state and what it
  // produces can never disagree.
  const [weekPicks, setWeekPicks] = useState<WeekShape[]>(() =>
    draft === null ? [] : weekShapes(draft.signals),
  );
  const [tradeText, setTradeText] = useState(() => draft?.trade ?? "");
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() =>
    draft === null ? new Set<string>() : resumeDismissed(draft),
  );
  const [activityPicks, setActivityPicks] = useState<string[]>(() =>
    draft === null ? [] : resumeActivities(draft.signals),
  );
  const [tempo, setTempo] = useState<Tempo | null>(() =>
    draft === null ? null : tempoOf(draft.signals),
  );
  const [keepPicks, setKeepPicks] = useState<Keep[]>(() =>
    draft === null ? [] : KEEPS.filter((keep) => keeps(draft.signals, keep)),
  );

  // NTF-008 is asked ONCE, ever: no pick here is a real answer that leaves the
  // first-reminder-moment dialog armed, so this starts — and may stay — null.
  const [appetite, setAppetite] = useState<NotificationPresetKey | null>(null);
  /**
   * „Dodaj i „Demo" profil" — offered on the last question of a personal first
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
    step: resumeStep(draft?.step),
    error: null,
  }));
  const [outcome, setOutcome] = useState<PrepareOutcome | null>(null);

  // „Podesi ručno" — ADR-065's two screens, kept as the override. Seeded from
  // the flags the preparation actually left behind, so it opens on what the app
  // now IS rather than on what it was before the plan ran.
  const [manualPacks, setManualPacks] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [manualModules, setManualModules] = useState<Record<string, boolean>>({});

  // The in-flight guard is a ref, not the phase (the appetite dialog's own
  // rule): two clicks inside one render would both read the same
  // not-yet-flushed state — and completion is the one act here that is not
  // idempotent, since a second pass would leave a second welcome note.
  const completing = useRef(false);

  // The toolkits this build can honestly offer — derived from the registry, so
  // a pack whose tools are not written yet simply has no card (`packInventory`).
  const offeredPacks = useMemo(() => packInventory(registry), [registry]);

  const trimmed = name.trim();
  const nameValid = trimmed.length >= 1 && trimmed.length <= NAME_MAX;
  const step = state.phase === "asking" ? state.step : null;
  const stepIndex = step === null ? -1 : STEPS.indexOf(step);
  const lastStep = stepIndex === STEPS.length - 1;

  /** What the lexicon reads in the field right now, minus the chips the person took back. */
  const recognised = useMemo<TradeMatch[]>(() => recognizeTrades(tradeText), [tradeText]);
  const heard = useMemo(
    () => recognised.filter((match) => !dismissed.has(match.term)),
    [recognised, dismissed],
  );

  /**
   * Everything the person has said, as the plan will read it.
   *
   * Typed matches come before tapped ones, and within each the order they were
   * given: `tradePacks` preserves it, so the reveal lists the packs in the
   * person's own emphasis and „stolar koji vodi knjige" leads with Zanatstvo.
   */
  const signals = useMemo<Signal[]>(() => {
    const list: Signal[] = [];
    for (const shape of weekPicks) list.push({ kind: "week", id: shape });
    for (const match of heard) {
      for (const pack of match.packs) {
        list.push({ kind: "trade", pack, term: match.term, via: "typed" });
      }
    }
    for (const id of activityPicks) {
      const activity = TRADE_ACTIVITIES.find((entry) => entry.id === id);
      if (activity === undefined) continue;
      const term = lookup(s.trade.activities, id) ?? id;
      for (const pack of activity.packs) list.push({ kind: "trade", pack, term, via: "activity" });
    }
    if (tempo !== null) list.push({ kind: "tempo", id: tempo });
    for (const keep of keepPicks) list.push({ kind: "keep", id: keep });
    return list;
  }, [weekPicks, heard, activityPicks, tempo, keepPicks, s]);

  // The draft is the resume story for a first run interrupted by the idle
  // auto-lock; a rerun has none to keep (see the `draft` initializer). It stops
  // being written the moment the questions are over — from „Priprema" onwards
  // there is nothing left to resume, and completion clears the key outright.
  useEffect(() => {
    if (rerun || step === null) return;
    writeOnboardingDraft(profileId, { step, name, signals, trade: tradeText });
  }, [rerun, profileId, step, name, signals, tradeText]);

  function goTo(next: OnboardingStep): void {
    setState({ phase: "asking", step: next, error: null });
  }

  /**
   * A third week shape REPLACES the oldest rather than being refused.
   *
   * A button that does nothing when pressed is the app disagreeing silently.
   * Dropping the first answer is visible in the same glance, and the cap is
   * what makes the question mean anything at all.
   */
  function toggleWeek(shape: WeekShape): void {
    setWeekPicks((picked) =>
      picked.includes(shape)
        ? picked.filter((entry) => entry !== shape)
        : [...picked, shape].slice(-WEEK_CAP),
    );
  }

  function changeTrade(value: string): void {
    setTradeText(value);
    // Clearing the field un-says everything, dismissals included: „nisam ništa
    // rekao" has one state, not two.
    if (value.trim().length === 0) setDismissed(new Set<string>());
  }

  /** Taking a chip back. The recognition is a suggestion the person can refuse, never a verdict. */
  function dismissTrade(term: string): void {
    setDismissed((current) => new Set(current).add(term));
  }

  function toggleActivity(id: string): void {
    setActivityPicks((picked) =>
      picked.includes(id) ? picked.filter((entry) => entry !== id) : [...picked, id],
    );
  }

  /** Exactly one tempo, and pressing the chosen one again un-says it — the question is optional. */
  function pickTempo(next: Tempo): void {
    setTempo((current) => (current === next ? null : next));
  }

  function toggleKeep(keep: Keep): void {
    setKeepPicks((picked) =>
      picked.includes(keep) ? picked.filter((entry) => entry !== keep) : [...picked, keep],
    );
  }

  /**
   * „Priprema" — the one place the questionnaire writes anything.
   *
   * Order is load-bearing. `applyProfilePlan` runs its four stages first (packs
   * before modules, board after the modules it is filtered through, look last);
   * then the appetite answer, which is idempotent; then the ONE rename, which
   * is the gate; then the flags are read back rather than assumed; then the
   * answers are stored; and the welcome note and the demo profile come last as
   * best-effort, because neither is worth costing somebody the run they have
   * just finished.
   */
  async function runPrepare(): Promise<void> {
    if (completing.current || !nameValid) return;
    // Captured before the phase changes: a failed write must put the user back
    // on the screen they pressed FROM, which for „Preskoči" is not the last one.
    const from = step ?? "podsetnici";
    completing.current = true;
    setState({ phase: "preparing", stage: "packs" });
    try {
      const plan = buildProfilePlan(signals, registry, resolveModuleSelection(registry, flags));
      await applyProfilePlan({
        ports: window.nexus,
        profileId,
        kind,
        registry,
        plan,
        // A first run writes every selectable module as an explicit row; a
        // rerun upserts only what actually changed.
        currentFlags: rerun ? flags : null,
        onStage: async (stage) => {
          setState({ phase: "preparing", stage });
          await beat();
        },
      });
      setState({ phase: "preparing", stage: "done" });
      const preset = NOTIFICATION_PRESETS.find((candidate) => candidate.key === appetite);
      if (preset !== undefined) {
        // Answers the once-ever question AND marks it asked, so the queued
        // first-moment dialog does not pop the instant onboarding ends.
        await window.nexus.answerNotificationAppetite(profileId, preset.sources);
      }
      if (trimmed !== initialName.trim()) {
        await window.nexus.renameProfile(profileId, trimmed);
      }
      const stored = await window.nexus.getFlags(profileId);
      // The answers, not the plan (`signalPrefs.ts`): a plan is a snapshot of
      // what one build could compose, the answers are what the person said.
      persistSignals(profileId, signals);
      if (!rerun && !business && (plan.modules["notes"] ?? false)) {
        await writeWelcomeNote(profileId);
      }
      let demoProfile: Profile | null = null;
      if (wantsDemo && !rerun && !business) {
        try {
          demoProfile = await window.nexus.createDemoProfile();
        } catch (error) {
          console.error("Nexus: failed to add the demo profile:", error);
        }
      }
      clearOnboardingDraft(profileId);
      await beat();
      setOutcome({ name: trimmed, flags: stored, demoProfile, plan });
      setState({ phase: "reveal" });
    } catch (error) {
      // Nothing written so far is lost or half-applied: the flag rows and the
      // appetite answer are upserts, and the name — the gate — is attempted
      // after them, so a failure leaves the user exactly where they were, free
      // to press again.
      completing.current = false;
      setState({ phase: "asking", step: from, error: s.saveError });
      console.error("Nexus: failed to finish onboarding:", error);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (state.phase !== "asking") return;
    if (state.step === "ime" && !nameValid) return;
    const next = STEPS[stepIndex + 1];
    if (next !== undefined) {
      goTo(next);
      return;
    }
    void runPrepare();
  }

  function openManual(): void {
    if (outcome === null) return;
    setManualPacks(resolvePackSelection(outcome.flags));
    setManualModules(resolveModuleSelection(registry, outcome.flags));
    setState({ phase: "advanced", error: null });
  }

  /**
   * Ticking a toolkit adds or removes one pack and — through
   * `applyPackSelection` — switches „Stručne alatke“ on with the first and off
   * with the last. It touches no other module.
   */
  function toggleManualPack(pack: string, on: boolean): void {
    // Computed here rather than inside an updater: the updater form would put a
    // second `setState` inside a function React is free to call twice. One
    // click is one render, so reading the current set from the closure is the
    // honest version of the same thing.
    const next = new Set(manualPacks);
    if (on) next.add(pack);
    else next.delete(pack);
    setManualPacks(next);
    setManualModules((selected) => applyPackSelection(selected, next));
  }

  /**
   * The manual override's write.
   *
   * Always a DELTA, in both modes, and never the first-run „write every row"
   * pass: „Priprema" has already put an explicit row on every selectable module
   * by the time this screen can be reached, so what is left to write is exactly
   * what the person changed here.
   */
  async function saveManual(): Promise<void> {
    if (outcome === null || state.phase !== "advanced") return;
    setState({ phase: "advanced-saving" });
    try {
      const currentPacks = resolvePackSelection(outcome.flags);
      for (const { moduleId, enabled } of packFlagWrites(manualPacks, currentPacks)) {
        await window.nexus.setFlag(profileId, moduleId, enabled);
      }
      const currentModules = resolveModuleSelection(registry, outcome.flags);
      const writes = moduleFlagWrites(registry, manualModules, currentModules);
      for (const { moduleId, enabled } of writes) {
        await window.nexus.setFlag(profileId, moduleId, enabled);
      }
      const stored = await window.nexus.getFlags(profileId);
      onComplete({ name: outcome.name, flags: stored, demoProfile: outcome.demoProfile });
    } catch (error) {
      setState({ phase: "advanced", error: s.saveError });
      console.error("Nexus: failed to save the manual setup:", error);
    }
  }

  const wide =
    (state.phase === "asking" && WIDE_STEPS.has(state.step)) ||
    state.phase === "reveal" ||
    state.phase === "advanced" ||
    state.phase === "advanced-saving";

  // The reveal's two lists, derived once. Both walk `plan.reasons`, and both
  // are asked twice by the markup below — once for „is there anything to show"
  // and once to show it.
  const revealTrades = outcome === null ? [] : heardTrades(outcome.plan);
  const revealLines = outcome === null ? [] : planReasonLines(outcome.plan);

  return (
    <div className="onb">
      {/* The second screen a person ever sees, on the same ground as the
          first (`AuthGate`). The sky is permitted here by `StarField`'s own
          rule — a fixed, centred grid that never scrolls. */}
      <StarField />
      {/* The screens that ask somebody to PICK from a list get the wider card;
          the ones that ask a single question keep the 400px `.auth` mirrors.
          Derived from the phase rather than hard-coded per screen, so a screen
          added to either list cannot end up with the wrong width by omission. */}
      <Card className={`onb__card${wide ? " onb__card--wide" : ""}`}>
        {state.phase === "asking" && (
          <form className="onb__form" onSubmit={submit}>
            <span className="onb__brand" aria-hidden="true">✦</span>
            <p className="onb__steps">
              {s.stepPrefix} {stepIndex + 1} {s.stepOf} {STEPS.length}
            </p>

            {state.step === "ime" && (
              <>
                <h1 className="onb__title">
                  {rerun ? s.rerunTitle : business ? s.titleBusiness : s.title}
                </h1>
                <p className="nx-hint nx-hint--prose">
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
                <h1 className="onb__title">{s.week.title}</h1>
                <p className="nx-hint nx-hint--prose">{s.week.description}</p>
                {/* The card is the DRAWER's block (`.pro-kit`, `tools.css`), not
                    a local one: a chosen thing looks the same everywhere in this
                    app, and a second copy under an `.onb__` name is how two
                    screens end up disagreeing about what „chosen" looks like. */}
                <div className="pro-kits" role="group" aria-label={s.week.title}>
                  {WEEK_SHAPES.map((shape) => {
                    const copy = s.week.shapes[shape];
                    const chosen = weekPicks.includes(shape);
                    return (
                      <button
                        key={shape}
                        type="button"
                        className={`pro-kit${chosen ? " pro-kit--on" : ""}`}
                        aria-pressed={chosen}
                        onClick={() => toggleWeek(shape)}
                      >
                        <span className="pro-kit-name">{copy.name}</span>
                        <span className="pro-kit-who">{copy.desc}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="onb__caption">{s.week.noChoice}</p>
              </>
            )}

            {state.step === "posao" && (
              <>
                <h1 className="onb__title">{s.trade.title}</h1>
                <p className="nx-hint nx-hint--prose">{s.trade.description}</p>
                {/* One field instead of eighteen toolkit cards. The cards were
                    „the same taxonomy with fewer boxes" — a person outside the
                    eighteen still had nowhere to be — where a field fails OPEN:
                    the lexicon reads „zidar" in every case Serbian inflects it
                    into, and the chips below are the net for whoever it misses. */}
                <TextField
                  label={s.trade.label}
                  placeholder={s.trade.placeholder}
                  value={tradeText}
                  maxLength={TRADE_MAX}
                  autoFocus
                  onChange={(event) => changeTrade(event.target.value)}
                />
                {heard.length > 0 && (
                  <div className="onb__heard">
                    <span className="onb__group-label">{s.trade.heard}</span>
                    <div className="onb__heard-list">
                      {heard.map((match) => (
                        <span key={match.term} className="onb__heard-chip">
                          <span className="onb__heard-term">{match.term}</span>
                          <span className="onb__heard-packs">
                            {joinList(match.packs.map(packName))}
                          </span>
                          <button
                            type="button"
                            className="onb__heard-drop"
                            aria-label={`${s.trade.remove}: ${match.term}`}
                            onClick={() => dismissTrade(match.term)}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <span className="onb__group-label">{s.trade.activitiesLabel}</span>
                <div className="onb__acts" role="group" aria-label={s.trade.activitiesLabel}>
                  {TRADE_ACTIVITIES.map((activity) => {
                    const on = activityPicks.includes(activity.id);
                    return (
                      <button
                        key={activity.id}
                        type="button"
                        className={`onb__act${on ? " onb__act--on" : ""}`}
                        aria-pressed={on}
                        onClick={() => toggleActivity(activity.id)}
                      >
                        {lookup(s.trade.activities, activity.id) ?? activity.id}
                      </button>
                    );
                  })}
                </div>
                <p className="onb__caption">{s.trade.noChoice}</p>
                {/* The sentence the professional picker carries, on the screen
                    where most people will first acquire professional tools.
                    Repeating it is the point: a characterisation only one door
                    carries is one half the users never see. */}
                <p className="onb__caption">{strings.pro.picker.responsibility}</p>
              </>
            )}

            {state.step === "ritam" && (
              <>
                <h1 className="onb__title">{s.tempo.title}</h1>
                <p className="nx-hint nx-hint--prose">{s.tempo.description}</p>
                <div className="pro-kits" role="group" aria-label={s.tempo.title}>
                  {TEMPOS.map((option) => {
                    const copy = s.tempo.options[option];
                    const chosen = tempo === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        className={`pro-kit${chosen ? " pro-kit--on" : ""}`}
                        aria-pressed={chosen}
                        onClick={() => pickTempo(option)}
                      >
                        <span className="pro-kit-name">{copy.name}</span>
                        <span className="pro-kit-who">{copy.desc}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="onb__caption">{s.tempo.noChoice}</p>
              </>
            )}

            {state.step === "oko" && (
              <>
                <h1 className="onb__title">{s.keep.title}</h1>
                <p className="nx-hint nx-hint--prose">{s.keep.description}</p>
                <div className="pro-kits" role="group" aria-label={s.keep.title}>
                  {KEEPS.map((keep) => {
                    const copy = s.keep.options[keep];
                    const chosen = keepPicks.includes(keep);
                    return (
                      <button
                        key={keep}
                        type="button"
                        className={`pro-kit${chosen ? " pro-kit--on" : ""}`}
                        aria-pressed={chosen}
                        onClick={() => toggleKeep(keep)}
                      >
                        <span className="pro-kit-name">{copy.name}</span>
                        <span className="pro-kit-who">{copy.desc}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="onb__caption">{s.keep.noChoice}</p>
              </>
            )}

            {state.step === "podsetnici" && (
              <>
                <h1 className="onb__title">{s.remindersTitle}</h1>
                <p className="nx-hint nx-hint--prose">{s.remindersDescription}</p>
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

            {state.error != null && (
              <p className="onb__error" role="alert">
                {state.error}
              </p>
            )}

            <div className="onb__actions">
              {stepIndex > 0 && (
                <Button
                  size="sm"
                  onClick={() => {
                    const previous = STEPS[stepIndex - 1];
                    if (previous !== undefined) goTo(previous);
                  }}
                >
                  {s.back}
                </Button>
              )}
              <Button
                type="submit"
                variant="primary"
                disabled={state.step === "ime" && !nameValid}
              >
                {lastStep ? s.start : s.next}
              </Button>
            </div>

            {/* Quiet and typographic, `Button variant="quiet"`: an exit is
                available, not advertised. A first run skips (and prepares with
                what it has); a rerun cancels (and writes nothing). */}
            {rerun ? (
              onCancel !== null && (
                <Button variant="quiet" className="onb__quiet" onClick={onCancel}>
                  {s.cancel}
                </Button>
              )
            ) : (
              <Button
                variant="quiet"
                className="onb__quiet"
                disabled={!nameValid}
                onClick={() => void runPrepare()}
              >
                {s.skip}
              </Button>
            )}
          </form>
        )}

        {state.phase === "preparing" && (
          <PrepareScreen stage={state.stage} name={trimmed} />
        )}

        {state.phase === "reveal" && outcome !== null && (
          <div className="onb__form">
            <span className="onb__brand" aria-hidden="true">✦</span>
            <h1 className="onb__title">{s.reveal.title}</h1>
            <p className="nx-hint nx-hint--prose">{s.reveal.description}</p>
            {/* What it HEARD, before anything it decided — and in the person's
                own spelling. „„stolar" → Zanatstvo, Gradnja" reads as
                recognition; „Uključeni paketi: Zanatstvo" reads as a setting
                that appeared on its own. */}
            {revealTrades.length > 0 && (
              <div className="onb__heard">
                <span className="onb__group-label">{s.reveal.heard}</span>
                <div className="onb__heard-list">
                  {revealTrades.map((entry) => (
                    <Chip key={entry.term} variant="accent">
                      {entry.term} → {entry.packs}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
            {/* Every line is generated from `plan.reasons`, so the app can only
                say what it actually did. No reasons is not a failure: it is what
                a run where nothing was answered legitimately produces. */}
            {revealLines.length > 0 ? (
              <ul className="onb__reasons">
                {revealLines.map((line) => (
                  <li key={line} className="onb__reason">
                    <span className="onb__reason-mark" aria-hidden="true">✦</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="onb__caption">{s.reveal.nothing}</p>
            )}
            <Button
              className="onb__enter"
              variant="primary"
              onClick={() =>
                onComplete({
                  name: outcome.name,
                  flags: outcome.flags,
                  demoProfile: outcome.demoProfile,
                })
              }
            >
              {s.reveal.enter}
            </Button>
            <Button variant="quiet" className="onb__quiet" onClick={openManual}>
              {s.reveal.advanced}
            </Button>
          </div>
        )}

        {(state.phase === "advanced" || state.phase === "advanced-saving") && (
          /* `--manual` carries no style of its own: it is how the screenshot
             sweep tells this phase from the others. */
          <form
            className="onb__form onb__form--manual"
            onSubmit={(event) => {
              event.preventDefault();
              void saveManual();
            }}
          >
            <span className="onb__brand" aria-hidden="true">✦</span>
            <h1 className="onb__title">{s.advancedTitle}</h1>
            <p className="nx-hint nx-hint--prose">{s.advancedDescription}</p>
            <h2 className="onb__module-group-title">{strings.pro.picker.title}</h2>
            {/* Uncapped: the card scrolls, and a scroller inside a scroller cut
                this grid in half mid-row at every window size. */}
            <div className="pro-kits" role="group" aria-label={strings.pro.picker.title}>
              {offeredPacks.map(({ pack, toolCount }) => {
                const chosen = manualPacks.has(pack);
                const copy = strings.pro.packs[pack];
                return (
                  <button
                    key={pack}
                    type="button"
                    className={`pro-kit${chosen ? " pro-kit--on" : ""}`}
                    aria-pressed={chosen}
                    onClick={() => toggleManualPack(pack, !chosen)}
                  >
                    <span className="pro-kit-name">{copy.name}</span>
                    <span className="pro-kit-who">{copy.who}</span>
                    <span className="pro-kit-count">
                      {fill(strings.pro.picker.contains, { count: toolCount })}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* The consequence of choosing nothing, said where the choice is
                being made rather than discovered later in Settings: this grid
                is the only place it can be said, and it is a real outcome —
                `applyPackSelection` switches the professional tools off when no
                pack is chosen. The sentence was written for this slot and was
                drawn nowhere, which is what `check:copy` now finds. */}
            <p className="nx-hint nx-hint--prose">{s.packsNoChoice}</p>
            {/* The Settings gallery's own markup and its own copy: the two
                screens ask the same question, and the locked pair is drawn as an
                „Uvek uključeno“ chip in both. */}
            <h2 className="onb__module-group-title">{s.modulesTitle}</h2>
            <div className="onb__modules">
              {/* The same groups the rail and the launcher draw (ADR-093): the
                  chips are grouped so the person recognises the shape their app
                  is about to have, and a heading only this screen uses would be
                  a taxonomy they never meet again. */}
              {[...registry.byGroup()].map(([group, members]) => (
                <div key={group} className="onb__module-group">
                  <h3 className="onb__module-group-title">
                    {lookup(strings.app.navGroups, group) ?? group}
                  </h3>
                  <div className="onb__module-list">
                    {members.map((manifest) => {
                      const label = moduleName(manifest.id);
                      return (
                        <div className="onb__module-row" key={manifest.id}>
                          <div className="onb__module-info">
                            <span className="onb__module-name">{label}</span>
                            <span className="onb__module-desc">
                              {moduleDescription(manifest.id)}
                            </span>
                          </div>
                          {LOCKED_MODULE_IDS.has(manifest.id) ? (
                            <Chip>{strings.settings.modulesAlwaysOn}</Chip>
                          ) : (
                            <Checkbox
                              checked={manualModules[manifest.id] ?? false}
                              aria-label={label}
                              onChange={(event) =>
                                setManualModules((current) => ({
                                  ...current,
                                  [manifest.id]: event.target.checked,
                                }))
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
            {state.phase === "advanced" && state.error != null && (
              <p className="onb__error" role="alert">
                {state.error}
              </p>
            )}
            <div className="onb__actions">
              <Button
                size="sm"
                disabled={state.phase === "advanced-saving"}
                onClick={() => setState({ phase: "reveal" })}
              >
                {s.back}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={state.phase === "advanced-saving"}
              >
                {s.advancedSave}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

/**
 * „Priprema" — five lines, each one a thing that is being written.
 *
 * The marker is typographic: the brand glyph on the line in progress, a tick on
 * the ones behind it, the app's single active-state recipe rather than a
 * spinner. The rail underneath is determinate because the progress is
 * determinate — five stages, and the screen knows which one it is on.
 */
function PrepareScreen({ stage, name }: { stage: PrepareStage; name: string }) {
  const s = strings.onboarding.prepare;
  const at = PREPARE_STAGES.indexOf(stage);
  const done = at + 1;
  return (
    <div className="onb__form">
      <span className="onb__brand" aria-hidden="true">✦</span>
      <h1 className="onb__title">{s.title}</h1>
      <p className="nx-hint nx-hint--prose">
        {name.length > 0 ? `${name} — ${s.description}` : s.description}
      </p>
      <div
        className="onb__progress"
        role="progressbar"
        aria-label={s.title}
        aria-valuemin={0}
        aria-valuemax={PREPARE_STAGES.length}
        aria-valuenow={done}
      >
        <span
          className="onb__progress-fill"
          style={{ width: `${(done / PREPARE_STAGES.length) * 100}%` }}
        />
      </div>
      <ol className="onb__stages">
        {PREPARE_STAGES.map((entry, index) => {
          const passed = index < at;
          const now = index === at;
          const classes = ["onb__stage"];
          if (passed) classes.push("onb__stage--done");
          if (now) classes.push("onb__stage--now");
          return (
            <li key={entry} className={classes.join(" ")}>
              <span className="onb__stage-mark" aria-hidden="true">
                {passed ? "✓" : now ? "✦" : "·"}
              </span>
              <span>{lookup(s.stages, entry) ?? entry}</span>
            </li>
          );
        })}
      </ol>
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
    // Loaded here, not imported at the top: this runs once per profile, and a
    // static import would keep the note document model in the startup chunk
    // for every session after it (`markdownNote.ts`). Inside the `try`, so a
    // chunk that fails to load is the same best-effort miss as any other.
    const { buildNoteUpdate, parseMarkdownNote } = await import("./markdownNote.js");
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
