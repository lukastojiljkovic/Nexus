import type { ModuleRegistry, ProfilePlan, WeekShape } from "@nexus/core";
import type { AccentId } from "@nexus/tokens";

import type { DashboardWidgetInstance, DashboardWidgetSize, ProfileKind } from "../../shared/ipc.js";
import {
  moduleFlagWrites,
  packFlagWrites,
  resolveModuleSelection,
  resolvePackSelection,
} from "../../shared/onboardingPresets.js";
import { hasStoredAccent, persistAccent, seedAccent } from "./accent.js";
import { hasStoredCalendarView, persistCalendarView } from "./calendarPrefs.js";
import { persistPinnedModules } from "./navPrefs.js";

/**
 * ADR-086 §4: turning a `ProfilePlan` into the app.
 *
 * `@nexus/core` decides; this writes. The split is the reason the decision is
 * testable at all — everything above is pure over signals, and everything a
 * plan actually costs (four `feature_flags` loops, a board rebuilt over IPC,
 * three device preferences) is here, in one function, in one order.
 *
 * **Two of the three device preferences are SEEDED, not set.** The accent and
 * the calendar's opening view both have a chooser of their own — „Izgled" and
 * the view toggle — so a plan writes them only where the profile has none.
 * Somebody who reopens the questionnaire a year later to switch one module on
 * must not find their calendar back on the month and their app repainted. The
 * pinned sidebar has no chooser and no prior author, so the plan writes it
 * outright; „Napredno" is where a person overrides it.
 *
 * **The board is the exception, and deliberately.** It is rebuilt whenever the
 * plan composed one, because the reveal screen names it („Tvoja tabla: 6
 * kartica") — a change the user is told about in the same breath is not a
 * change made behind their back. It is also the only write here that must
 * never pass through an empty state; see `applyBoard`.
 */

/**
 * Which accent a week shape wears.
 *
 * Read as a sentence about the person, never as decoration: graphite is the
 * neutral working surface, bronze is warm and academic, rose is domestic, jade
 * is the green this product already uses for anything measured, olive is the
 * maker's, and burgundy is the reserved business accent (ADR-058 decision #11)
 * — which is exactly right for somebody whose week IS their own firm.
 *
 * `zlato` is deliberately absent. It is what a profile that never answered
 * gets, so leaving it unassigned keeps „nobody said anything" distinguishable
 * from „somebody said something and it happened to land on the default".
 * `suma` is absent for the same reason: an accent nothing maps to is a colour
 * left for the user to choose, and eight swatches with six spoken for is a
 * palette rather than a verdict.
 */
export const ACCENT_FOR_SHAPE: Readonly<Record<WeekShape, AccentId>> = {
  posao: "grafit",
  skola: "bronza",
  dom: "ruza",
  kondicija: "zad",
  stvaranje: "maslina",
  firma: "bordo",
};

/** The four things applying a plan does, in the order it does them — what the „Priprema" screen narrates. */
export const PLAN_STAGES = ["packs", "modules", "board", "look"] as const;

export type PlanStage = (typeof PLAN_STAGES)[number];

/**
 * The slice of `NexusApi` a plan touches. Narrow on purpose: `window.nexus`
 * satisfies it structurally, so the caller passes it straight through, and the
 * tests pass four recording stubs instead of a mock of the whole bridge.
 */
export interface PlanApplyPorts {
  setFlag(profileId: string, moduleId: string, enabled: boolean): Promise<void>;
  dashboardWidgets(profileId: string, setId: string | null): Promise<DashboardWidgetInstance[]>;
  addDashboardWidget(
    profileId: string,
    widgetId: string,
    size: DashboardWidgetSize,
    setId: string | null,
  ): Promise<DashboardWidgetInstance[]>;
  removeDashboardWidget(
    profileId: string,
    instanceId: string,
    setId: string | null,
  ): Promise<DashboardWidgetInstance[]>;
}

export interface PlanApplyRequest {
  readonly ports: PlanApplyPorts;
  readonly profileId: string;
  readonly kind: ProfileKind;
  readonly registry: ModuleRegistry;
  readonly plan: ProfilePlan;
  /**
   * The profile's LIVE flags on a rerun; null on a first run.
   *
   * Same rule `Onboarding.complete` has always obeyed: a first run writes every
   * selectable module as an explicit row even where it matches its default, and
   * a rerun upserts only what actually changed.
   */
  readonly currentFlags: Readonly<Record<string, boolean>> | null;
  /**
   * Called BEFORE each stage's work, so the screen names what is happening
   * rather than what just did — and AWAITED, which is what lets „Priprema" be
   * a few seconds long without inventing anything.
   *
   * A progress screen that narrates stages it is not actually running is the
   * one kind of loading screen a user is right to resent. Pacing the REAL
   * stages instead means every line on that screen is a thing being written,
   * and the floor is held by the caller rather than by a `setTimeout` wrapped
   * around the whole thing.
   */
  readonly onStage?: (stage: PlanStage) => void | Promise<void>;
}

/**
 * Rebuilds „Početna" as the plan composed it — ADDING FIRST AND REMOVING
 * AFTERWARDS, which is not a style choice.
 *
 * A board with no rows IS the default arrangement (`dashboardWidgetStore`), so
 * removing the last placement puts the five default cards back, and the next
 * `add` materialises them as real rows before appending. Clear-then-fill would
 * therefore leave eleven cards: the five it thought it had deleted, plus six.
 * Adding first never passes through zero, and the removals that follow take
 * exactly the placements that existed before this ran — including the default
 * five, whose instance ids are derived and stable, so they can be named before
 * any row exists for them.
 */
async function applyBoard(request: PlanApplyRequest): Promise<void> {
  const { ports, profileId, plan } = request;
  // Law 1: an empty board means „write no rows". On a rerun that also protects
  // a board the user arranged by hand from a plan that has nothing to say.
  if (plan.board.length === 0) return;
  const before = await ports.dashboardWidgets(profileId, null);
  for (const entry of plan.board) {
    await ports.addDashboardWidget(profileId, entry.widgetId, entry.size, null);
  }
  for (const placement of before) {
    await ports.removeDashboardWidget(profileId, placement.instanceId, null);
  }
}

/** The three device preferences — no IPC, no failure mode worth a retry, so this runs last. */
function applyLook(request: PlanApplyRequest): void {
  const { profileId, kind, plan } = request;
  persistPinnedModules(profileId, plan.navPrimary);
  if (plan.calendarView !== null && !hasStoredCalendarView(profileId)) {
    persistCalendarView(profileId, plan.calendarView);
  }
  if (plan.accentShape !== null && !hasStoredAccent(profileId)) {
    const accent = ACCENT_FOR_SHAPE[plan.accentShape];
    // Repaint only the ACTIVE profile's document. A business profile is created
    // and set up from the personal one that is still on screen (`seedAccent`'s
    // existing caller), and repainting there would change the shell around a
    // dialog rather than the profile being prepared.
    if (kind === "business") seedAccent(profileId, accent);
    else persistAccent(profileId, accent);
  }
}

/**
 * Applies a plan.
 *
 * Order is load-bearing and is `Onboarding.complete`'s, extended: packs before
 * modules, because „Stručne alatke" is switched on exactly when a pack was
 * chosen and a failure between the two loops must leave the drawer OFF with
 * packs on record rather than ON with nothing in it. The board comes after the
 * modules it is filtered through, and the look — which cannot fail in any way a
 * retry would fix — comes last.
 */
export async function applyProfilePlan(request: PlanApplyRequest): Promise<void> {
  const { ports, profileId, registry, plan, currentFlags, onStage } = request;

  await onStage?.("packs");
  const currentPacks = currentFlags === null ? null : resolvePackSelection(currentFlags);
  for (const write of packFlagWrites(new Set(plan.packs), currentPacks)) {
    await ports.setFlag(profileId, write.moduleId, write.enabled);
  }

  await onStage?.("modules");
  const currentModules =
    currentFlags === null ? null : resolveModuleSelection(registry, currentFlags);
  for (const write of moduleFlagWrites(registry, plan.modules, currentModules)) {
    await ports.setFlag(profileId, write.moduleId, write.enabled);
  }

  await onStage?.("board");
  await applyBoard(request);

  await onStage?.("look");
  applyLook(request);
}
