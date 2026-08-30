import { KEEPS, TEMPOS, TOOL_PACKS, WEEK_SHAPES } from "@nexus/core";
import type { Keep, Signal, Tempo, ToolPack, WeekShape } from "@nexus/core";

/**
 * ADR-086: the answers themselves, kept so the app can say WHY it looks the way
 * it does — „Podešavanja → Kako je Nexus podešen za tebe" rebuilds the plan from
 * these and renders its reasons.
 *
 * **The signals are stored and the plan is not**, which is the whole design in
 * one decision. A stored plan is a snapshot of what one build's registry could
 * compose; stored signals are what the PERSON said, and a plan rebuilt from them
 * next year gets the modules and cards that exist then. It also means the
 * explanation can never drift from the answers, because it is derived from them
 * rather than written beside them.
 *
 * Per profile, in `localStorage`, on `accent.ts`'s recipe — two people share a
 * machine and their answers are not each other's. Nothing here is content: a
 * week shape and a trade term are the shape of somebody's working life, which is
 * the same class of fact as „which modules are on", already a device preference.
 */

const SIGNALS_KEY_PREFIX = "nexus.profile.signals.";

function isWeekShape(value: unknown): value is WeekShape {
  return typeof value === "string" && WEEK_SHAPES.some((shape) => shape === value);
}
function isTempo(value: unknown): value is Tempo {
  return typeof value === "string" && TEMPOS.some((tempo) => tempo === value);
}
function isKeep(value: unknown): value is Keep {
  return typeof value === "string" && KEEPS.some((keep) => keep === value);
}
function isToolPack(value: unknown): value is ToolPack {
  return typeof value === "string" && TOOL_PACKS.some((pack) => pack === value);
}

/**
 * Narrows one parsed entry — a stored signal is checked FIELD BY FIELD, never
 * cast. `localStorage` is writable by anything with a devtools console, and a
 * plan built from a signal whose `pack` is not a pack would compose a board out
 * of a widget id nothing publishes.
 */
function asSignal(value: unknown): Signal | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const kind = record["kind"];
  const id = record["id"];
  if (kind === "week" && isWeekShape(id)) return { kind, id };
  if (kind === "tempo" && isTempo(id)) return { kind, id };
  if (kind === "keep" && isKeep(id)) return { kind, id };
  if (kind !== "trade") return null;
  const pack = record["pack"];
  const term = record["term"];
  const via = record["via"];
  if (!isToolPack(pack)) return null;
  if (typeof term !== "string" || term.length === 0) return null;
  if (via !== "typed" && via !== "activity") return null;
  return { kind, pack, term, via };
}

/**
 * A profile's stored answers, or an empty list.
 *
 * Anything unreadable reads as „never answered", which is exactly what an empty
 * list means everywhere downstream: `buildProfilePlan([])` returns today's app.
 * A single malformed entry is dropped rather than costing the rest — the
 * explanation screen is better slightly short than absent.
 */
export function parseSignalList(value: unknown): Signal[] {
  if (!Array.isArray(value)) return [];
  return value.map(asSignal).filter((signal): signal is Signal => signal !== null);
}

export function readStoredSignals(profileId: string): Signal[] {
  const raw = localStorage.getItem(SIGNALS_KEY_PREFIX + profileId);
  if (raw === null) return [];
  try {
    return parseSignalList(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Writes a profile's answers. An empty list REMOVES the key: „answered nothing" has one representation. */
export function persistSignals(profileId: string, signals: readonly Signal[]): void {
  const key = SIGNALS_KEY_PREFIX + profileId;
  if (signals.length === 0) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify(signals));
}

/** Forgets one profile's answers — the „Vrati na podrazumevano" half of the Settings card. */
export function clearStoredSignals(profileId: string): void {
  localStorage.removeItem(SIGNALS_KEY_PREFIX + profileId);
}
