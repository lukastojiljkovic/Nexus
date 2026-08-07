import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { buildNoteUpdate, parseMarkdownNote } from "@nexus/core";
import type { FlagState, ModuleRegistry } from "@nexus/core";
import { Button, Card, Checkbox, Chip, TextField } from "@nexus/ui";
import type { ThemeName } from "@nexus/tokens";
import type { ProfileKind } from "../../shared/ipc.js";
import { LOCKED_MODULE_IDS } from "../../shared/modules.js";
import {
  moduleFlagWrites,
  OCCUPATION_MODULE_PRESETS,
  ONBOARDING_OCCUPATIONS,
  resolveModuleSelection,
  type OnboardingOccupation,
} from "../../shared/onboardingPresets.js";
import { NOTIFICATION_PRESETS, type NotificationPresetKey } from "./notificationFormat.js";
import {
  clearOnboardingDraft,
  readOnboardingDraft,
  writeOnboardingDraft,
} from "./onboardingDraft.js";
import { lookup, strings } from "./strings.js";

/** Mirrors the main-process rule: 1–80 chars after trimming (UX-side only). */
const NAME_MAX = 80;

/** The questionnaire's screens, in order. */
type OnboardingStep = "ime" | "uloga" | "oblasti" | "podsetnici";

const PERSONAL_STEPS: readonly OnboardingStep[] = ["ime", "uloga", "oblasti", "podsetnici"];

/**
 * The BUSINESS flow is three screens, not four, and that divergence is
 * deliberate: „Uloga“ exists only to pre-check „Oblasti“, and a business
 * profile's suggestion is its own creation-time preset (ADR-058) — asking a
 * profile that already knows what it is for would be a question with nothing
 * to do with the answer.
 */
const BUSINESS_STEPS: readonly OnboardingStep[] = ["ime", "oblasti", "podsetnici"];

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
  const [occupation, setOccupation] = useState<OnboardingOccupation | null>(
    () => draft?.occupation ?? null,
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
      occupation,
      modules: selection,
    });
  }, [rerun, profileId, state.step, name, occupation, selection]);

  function goTo(step: OnboardingStep): void {
    setState({ phase: "asking", step, error: null });
  }

  /**
   * Answering „Uloga“ re-seeds the module selection from that role's table —
   * at the moment of the answer rather than when „Oblasti“ mounts, so stepping
   * back and forth never silently discards ticks the user made by hand. Only
   * picking a different role does that, which is what picking one means.
   */
  function pickOccupation(next: OnboardingOccupation): void {
    setOccupation(next);
    setSelection({ ...OCCUPATION_MODULE_PRESETS[next] });
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
    nextAppetite: NotificationPresetKey | null,
  ): Promise<void> {
    if (completing.current || !nameValid) return;
    completing.current = true;
    setState({ phase: "saving", step: state.step });
    try {
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
      clearOnboardingDraft(profileId);
      onComplete({ name: trimmed, flags: stored });
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
    void complete(selection, appetite);
  }

  return (
    <div className="onb">
      <Card className="onb__card">
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

          {state.step === "uloga" && (
            <>
              <h1 className="onb__title">{s.occupationTitle}</h1>
              <p className="onb__desc">{s.occupationDescription}</p>
              <div className="onb__choices" role="group" aria-label={s.occupationTitle}>
                {ONBOARDING_OCCUPATIONS.map((option) => (
                  <Button
                    key={option}
                    className="onb__choice"
                    variant={occupation === option ? "primary" : "ghost"}
                    aria-pressed={occupation === option}
                    onClick={() => pickOccupation(option)}
                  >
                    {s.occupationOptions[option]}
                  </Button>
                ))}
              </div>
            </>
          )}

          {state.step === "oblasti" && (
            <>
              <h1 className="onb__title">{s.modulesTitle}</h1>
              <p className="onb__desc">{s.modulesDescription}</p>
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
              onClick={() => void complete(selection, null)}
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
