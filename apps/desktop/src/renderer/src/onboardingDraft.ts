import { ONBOARDING_OCCUPATIONS, type OnboardingOccupation } from "../../shared/onboardingPresets.js";

/**
 * ADR-065: the questionnaire's IN-PROGRESS state — which screen the user is on
 * and what they have answered so far — as a PER-PROFILE device preference,
 * `nexus.onb.<profileId>`, on the `accent.ts` recipe (`localStorage`, a safe
 * fallback for anything unusable, no IPC).
 *
 * Why a device preference and not a row: an interrupted first run belongs to
 * this machine. It has to survive the idle auto-lock (AUTH-005) that can fire
 * while somebody is still deciding, and it must never travel in an archive —
 * a half-answered questionnaire is not a fact about the profile, it is a fact
 * about a session on one computer. The questionnaire's DURABLE output is the
 * explicit flag rows plus the name/theme/appetite it writes through channels
 * that already exist; the raw answers have no second reader, so a table for
 * them would be storage nobody queries.
 *
 * Completion clears the key. `pruneOnboardingDrafts` carries the `profilePrefs`
 * rule — validate against the LIVE profile list, drop what names a profile that
 * is no longer there — since a deleted profile's draft would otherwise sit in
 * `localStorage` for the life of the installation.
 */

const STORAGE_KEY_PREFIX = "nexus.onb.";

/** Upper bound on a stored name, mirroring the main-process rule the screen itself enforces (1–80 after trimming). */
const NAME_MAX = 80;

export interface OnboardingDraft {
  /** The step id the user was last on — validated by the screen against its own list, since the business flow is one screen shorter. */
  readonly step: string;
  /** What has been typed into the name field so far; deliberately NOT trimmed or committed — the rename is the completion act. */
  readonly name: string;
  readonly occupation: OnboardingOccupation | null;
  /** The „Oblasti“ checkbox state: one entry per selectable module. */
  readonly modules: Readonly<Record<string, boolean>>;
}

function isOccupation(value: unknown): value is OnboardingOccupation {
  return (ONBOARDING_OCCUPATIONS as readonly string[]).includes(value as string);
}

/** A `Record<string, boolean>` or nothing — anything with a non-boolean value is not a selection this app wrote. */
function asModuleSelection(value: unknown): Record<string, boolean> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([, enabled]) => typeof enabled !== "boolean")) return null;
  return Object.fromEntries(entries) as Record<string, boolean>;
}

/**
 * The stored draft for one profile, or null for nothing usable — no draft,
 * unparseable JSON, or a shape this build does not recognise. Null always means
 * „start the questionnaire from the beginning“, which is a correct answer for
 * every one of those cases.
 */
export function readOnboardingDraft(profileId: string): OnboardingDraft | null {
  const stored = localStorage.getItem(STORAGE_KEY_PREFIX + profileId);
  if (stored === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const draft = parsed as Record<string, unknown>;
  const modules = asModuleSelection(draft["modules"]);
  if (typeof draft["step"] !== "string" || typeof draft["name"] !== "string" || modules === null) {
    return null;
  }
  const occupation = draft["occupation"];
  return {
    step: draft["step"],
    name: draft["name"].slice(0, NAME_MAX),
    occupation: isOccupation(occupation) ? occupation : null,
    modules,
  };
}

export function writeOnboardingDraft(profileId: string, draft: OnboardingDraft): void {
  localStorage.setItem(STORAGE_KEY_PREFIX + profileId, JSON.stringify(draft));
}

/** Forgets one profile's draft — what completion does, so a later rerun opens on the live state rather than on last year's answers. */
export function clearOnboardingDraft(profileId: string): void {
  localStorage.removeItem(STORAGE_KEY_PREFIX + profileId);
}

/**
 * Drops every stored draft whose profile is not in the live list (the
 * `resolveActiveProfile` rule, applied to housekeeping rather than to a
 * lookup). Called once per unlock, where the live list first exists: a profile
 * can go away between two runs — deleted, or replaced wholesale by a restore —
 * and its draft has nothing left to resume.
 */
export function pruneOnboardingDrafts(liveProfileIds: Iterable<string>): void {
  const live = new Set(liveProfileIds);
  const stale: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key === null || !key.startsWith(STORAGE_KEY_PREFIX)) continue;
    if (!live.has(key.slice(STORAGE_KEY_PREFIX.length))) stale.push(key);
  }
  for (const key of stale) localStorage.removeItem(key);
}
