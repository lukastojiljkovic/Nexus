import type { PlanReason, ProfilePlan, ToolPack } from "@nexus/core";

import { moduleName } from "./moduleName.js";
import { ACCENT_FOR_SHAPE } from "./profilePlanApply.js";
import { countUnit, fill, lookup, strings } from "./strings.js";

/**
 * ADR-086 §2: a plan's `reasons`, as sentences.
 *
 * `@nexus/core` holds no user-facing prose, so a `PlanReason` is a strings KEY
 * and the values it interpolates. This is the one place those become Serbian,
 * and it has two callers that must never disagree: the „Evo tvog Nexusa" reveal
 * at the end of the questionnaire, and the Settings card that answers the same
 * question a year later. A second rendering would be a second explanation of
 * the same decision.
 *
 * Every function here reads `strings` at CALL time. A module-scope read would
 * freeze this build's Serbian into the module and survive a language switch —
 * the capture `check:strings` gates.
 */

/**
 * „A, B i C" — the Serbian list, not a comma-joined one.
 *
 * The reveal reads as a sentence somebody wrote, and „Pravo, Računovodstvo,
 * Gradnja" in the middle of one reads as a database dump. Two items take „i"
 * with no comma before it, which is the rule Serbian actually has.
 */
export function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  return `${parts.slice(0, -1).join(", ")} ${strings.onboarding.reveal.and} ${last}`;
}

/** A pack's own name, from the drawer's table — the same word the picker shows. */
export function packName(pack: string): string {
  const copy = strings.pro.packs[pack as ToolPack] as { name: string } | undefined;
  return copy?.name ?? pack;
}

/** What the calendar's opening view is called, in the words its own toggle uses. */
function viewName(view: string): string {
  const c = strings.calendar;
  const named: Record<string, string> = {
    mesec: c.viewMesec,
    nedelja: c.viewNedelja,
    dan: c.viewDan,
    agenda: c.viewAgenda,
  };
  return named[view] ?? view;
}

/** What the accent a week shape wears is called, in „Izgled"'s own words. */
function accentName(shape: string): string {
  const accent = ACCENT_FOR_SHAPE[shape as keyof typeof ACCENT_FOR_SHAPE];
  if (accent === undefined) return shape;
  return lookup(strings.settings.appearance.accentNames, accent) ?? accent;
}

/**
 * One reason, as a line.
 *
 * `null` for a key this build does not know, and that is deliberate rather than
 * a fallback: a reason with no sentence is a decision the product cannot
 * explain, and law 4 exists so that state is unreachable. Printing the raw key
 * would hide the gap behind something that looks like copy.
 */
export function planReasonLine(reason: PlanReason): string | null {
  const s = strings.onboarding.reveal;
  switch (reason.key) {
    case "board": {
      // Full numeral agreement, not a bare number: „3 kartice" and „5 kartica"
      // do not collapse, and a composed board is 3–6 cards, which straddles the
      // boundary every single time.
      const count = Number(reason.values[0] ?? "0");
      const unit = countUnit(count, s.boardUnitOne, s.boardUnitFew, s.boardUnitMany);
      return fill(s.board, { count, unit });
    }
    case "packs":
      return fill(s.packs, { packs: joinList(reason.values.map(packName)) });
    case "nav":
      // `moduleName` rather than a lookup of `strings.modules`: a module the
      // plan turns on may be one of the DISCOVERED ones (ADR-090), whose name
      // lives in its own manifest and not in the shell's table. The plan's
      // sentence named such a module by its raw id, which is the same defect the
      // launcher's tiles had.
      return fill(s.nav, { modules: joinList(reason.values.map(moduleName)) });
    case "priv":
      return s.priv;
    case "calendar":
      return fill(s.calendar, { view: viewName(reason.values[0] ?? "") });
    case "accent":
      return fill(s.accent, { colour: accentName(reason.values[0] ?? "") });
    default:
      return null;
  }
}

/** Every line a plan can show, in the plan's own order — the reveal screen and the Settings card. */
export function planReasonLines(plan: ProfilePlan): string[] {
  return plan.reasons
    .map(planReasonLine)
    .filter((line): line is string => line !== null && line.length > 0);
}

/**
 * The trades the person named, quoted back as THEY wrote them.
 *
 * Separate from the reason lines because it is not a decision the app made — it
 * is what it heard, and the reveal says it in the person's own words before it
 * says anything about itself. „ „zidar" → Gradnja, Zanatstvo" reads as
 * recognition; „Uključeni paketi: Gradnja, Zanatstvo" reads as a setting that
 * appeared on its own.
 */
export function heardTrades(plan: ProfilePlan): { term: string; packs: string }[] {
  const byTerm = new Map<string, string[]>();
  for (const signal of plan.reasons.flatMap((reason) => reason.causedBy)) {
    if (signal.kind !== "trade") continue;
    const packs = byTerm.get(signal.term) ?? [];
    if (!packs.includes(signal.pack)) packs.push(signal.pack);
    byTerm.set(signal.term, packs);
  }
  return [...byTerm].map(([term, packs]) => ({ term, packs: joinList(packs.map(packName)) }));
}
