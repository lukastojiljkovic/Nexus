import type { Profile } from "../../shared/ipc.js";
import { strings } from "./strings.js";

/**
 * Which of the account's profiles the shell is standing in (ADR-058 §1) — a
 * DEVICE preference on the `calendarPrefs` recipe: `localStorage`, a safe
 * fallback for anything unusable, no IPC. The stored id is RAW at read time;
 * `resolveActiveProfile` validates it against the live list, because an id can
 * go stale under the preference (the profile was deleted, or a restore
 * replaced the database) and the shell must never stand in a profile that is
 * not there.
 */
const ACTIVE_PROFILE_KEY = "nexus.activeProfile";

/** The raw stored id, or null for nothing usable. Unvalidated — see the module comment. */
export function readStoredActiveProfileId(): string | null {
  const stored = localStorage.getItem(ACTIVE_PROFILE_KEY);
  return stored === null || stored.trim().length === 0 ? null : stored;
}

export function persistActiveProfile(id: string): void {
  localStorage.setItem(ACTIVE_PROFILE_KEY, id);
}

/**
 * The profile the shell should stand in: the stored one while it is still in
 * the live list, otherwise the PERSONAL profile — the account's anchor, which
 * is ADR-058's stale-pref fallback — otherwise the first profile there is
 * (defensive: the store refuses to delete the anchor, but a fallback that
 * returned undefined for a non-empty list would gate the shell on that
 * invariant). Undefined only for an empty list.
 */
export function resolveActiveProfile(profiles: readonly Profile[]): Profile | undefined {
  const storedId = readStoredActiveProfileId();
  const stored =
    storedId === null ? undefined : profiles.find((profile) => profile.id === storedId);
  return stored ?? profiles.find((profile) => profile.kind === "personal") ?? profiles[0];
}

/**
 * What a profile is CALLED wherever it is listed: its own trimmed name, or —
 * for a business profile still carrying the empty-name ONB-lite sentinel
 * (ADR-058) — the „Posao“ fallback label. A personal profile's empty name is
 * returned as-is: that state exists only before onboarding, where the ONB gate
 * holds the whole shell and nothing lists the profile at all.
 */
export function profileDisplayName(profile: Pick<Profile, "kind" | "name">): string {
  const trimmed = profile.name.trim();
  if (trimmed.length > 0) return trimmed;
  return profile.kind === "business" ? strings.profiles.businessLabel : profile.name;
}
