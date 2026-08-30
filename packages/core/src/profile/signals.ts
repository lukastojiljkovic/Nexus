import type { ToolPack } from "../contracts/tools.js";

/**
 * ADR-086: what the first-run questionnaire actually produces.
 *
 * A **signal** is one thing the person told us about their life — never a
 * setting they chose. That distinction is the whole design. ADR-065's flow
 * collected settings (thirty-two checkboxes, each already an answer about the
 * software), which meant the questionnaire had to be as wide as the product.
 * A signal is narrow and about the person, and the width lives in
 * `buildProfilePlan`, where it can be reasoned about and tested.
 *
 * Signals are also the reason every decision can be explained: a `PlanReason`
 * names the signals that caused it, so „why does my Nexus look like this" is
 * answerable by construction rather than by somebody remembering to write copy.
 */

/**
 * Question 1 — „Na šta ti odlazi nedelja?", at most two.
 *
 * These are shapes of a WEEK, not job titles and not modules. „What takes your
 * time" is a question anybody can answer about themselves without knowing what
 * a module is, and it is the same question the product is ultimately about:
 * Nexus manages obligations, so the shape of somebody's obligations is the
 * strongest single thing we can know about them.
 *
 * At most two on purpose. Three is a shrug, and a shrug carries no information
 * — a person who genuinely does everything is served by the „Osnovno" preset,
 * which is exactly what no signals produce.
 */
export const WEEK_SHAPES = ["posao", "skola", "dom", "kondicija", "stvaranje", "firma"] as const;

export type WeekShape = (typeof WEEK_SHAPES)[number];

/**
 * Question 3 — „Kako ti izgleda dan?", exactly one.
 *
 * Not what somebody does but HOW, and it decides the things a module opens on.
 * A planner wants the month; somebody working through a day wants the day. The
 * app has always had both and has always shown everybody the same one.
 */
export const TEMPOS = ["planer", "reaktivan", "beleznik"] as const;

export type Tempo = (typeof TEMPOS)[number];

/**
 * Question 4 — „Šta hoćeš da ti Nexus drži na oku?", any number.
 *
 * Asked about CONTENT rather than about modules, because that is the honest
 * form of the question: „do you want to keep track of money" is answerable,
 * „do you want the Finance module" is the questionnaire asking the user to do
 * its job. PRIV is here and nowhere else — an opt-in section is never inferred
 * from anything but somebody saying yes to it.
 */
export const KEEPS = ["novac", "zdravlje", "dokumenta", "ideje", "privatno"] as const;

export type Keep = (typeof KEEPS)[number];

/**
 * One thing the person said.
 *
 * `trade` carries `term` and `via` beside the pack because the reveal screen
 * quotes them back — „„stolar" → Zanatstvo, Gradnja" reads as recognition,
 * where a bare pack name reads as a setting that appeared on its own. `via`
 * separates what somebody typed from what they tapped, which is the difference
 * between the lexicon having worked and the safety net having caught them.
 */
export type Signal =
  | { readonly kind: "week"; readonly id: WeekShape }
  | {
      readonly kind: "trade";
      readonly pack: ToolPack;
      readonly term: string;
      readonly via: "typed" | "activity";
    }
  | { readonly kind: "tempo"; readonly id: Tempo }
  | { readonly kind: "keep"; readonly id: Keep };

/** The week shapes present in a signal set — order-preserving, deduplicated. */
export function weekShapes(signals: readonly Signal[]): WeekShape[] {
  const found: WeekShape[] = [];
  for (const signal of signals) {
    if (signal.kind === "week" && !found.includes(signal.id)) found.push(signal.id);
  }
  return found;
}

/** The single tempo, or null when it was skipped. The LAST wins — a re-answer is an answer. */
export function tempoOf(signals: readonly Signal[]): Tempo | null {
  let tempo: Tempo | null = null;
  for (const signal of signals) if (signal.kind === "tempo") tempo = signal.id;
  return tempo;
}

/** Whether the person asked Nexus to keep an eye on something. */
export function keeps(signals: readonly Signal[], keep: Keep): boolean {
  return signals.some((signal) => signal.kind === "keep" && signal.id === keep);
}

/**
 * The packs a signal set argues for, in first-mentioned order.
 *
 * Order matters downstream: it is the order the reveal lists them in, and the
 * order the professional drawer's first tool is picked from. „First mentioned"
 * means the person's own emphasis survives — what they typed before they
 * tapped, and what they typed first inside that.
 */
export function tradePacks(signals: readonly Signal[]): ToolPack[] {
  const found: ToolPack[] = [];
  for (const signal of signals) {
    if (signal.kind === "trade" && !found.includes(signal.pack)) found.push(signal.pack);
  }
  return found;
}
