import { ACCENT_IDS, type AccentId } from "@nexus/tokens";
import type { ProfileKind } from "../../shared/ipc.js";

/**
 * The accent is a PER-PROFILE device preference (AUTH-025 / ADR-058 §3): each
 * profile keeps its own `nexus.accent.<profileId>` key — the calendar's
 * `nexus.calendar.sources.<profileId>` recipe — so switching profiles switches
 * the accent with everything else. The document root only ever shows the
 * ACTIVE profile's accent; every function that touches the attribute says so.
 */
const STORAGE_KEY_PREFIX = "nexus.accent.";

/**
 * The single device-wide key this module used before ADR-058. Never written
 * anymore; `readStoredAccent` migrates it into the active profile's own key on
 * first read and removes it.
 */
const LEGACY_STORAGE_KEY = "nexus.accent";

const PERSONAL_DEFAULT: AccentId = "zlato";
/** Decision #11: bordo (burgundy) is the reserved business accent. */
const BUSINESS_DEFAULT: AccentId = "bordo";

/** What a profile that never chose an accent gets: zlato, except the reserved bordo for a business profile. */
export function defaultAccent(kind: ProfileKind): AccentId {
  return kind === "business" ? BUSINESS_DEFAULT : PERSONAL_DEFAULT;
}

function isAccentId(value: string | null): value is AccentId {
  return value != null && (ACCENT_IDS as readonly string[]).includes(value);
}

function paint(accent: AccentId): void {
  document.documentElement.setAttribute("data-accent", accent);
}

/**
 * Reads a profile's stored accent, falling back to its kind's default for
 * anything unrecognized (including nothing stored yet).
 *
 * Carries the one-time migration: callers only ever ask about the ACTIVE
 * profile, so a pre-ADR-058 unprefixed `nexus.accent` value found here becomes
 * THIS profile's own value — and the old key is consumed either way, so a
 * stale device-wide value can never be adopted by a later fresh profile.
 */
export function readStoredAccent(profileId: string, kind: ProfileKind): AccentId {
  const key = STORAGE_KEY_PREFIX + profileId;
  const stored = localStorage.getItem(key);
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacy !== null) localStorage.removeItem(LEGACY_STORAGE_KEY);
  if (isAccentId(stored)) return stored;
  if (isAccentId(legacy)) {
    localStorage.setItem(key, legacy);
    return legacy;
  }
  return defaultAccent(kind);
}

/** Persists the ACTIVE profile's accent choice and applies it to the document root — the Settings swatch click. */
export function persistAccent(profileId: string, accent: AccentId): void {
  localStorage.setItem(STORAGE_KEY_PREFIX + profileId, accent);
  paint(accent);
}

/**
 * Writes a profile's accent WITHOUT repainting — for a profile that is NOT the
 * active one. The one caller is business-profile creation, which seeds the
 * reserved bordo (§3) so the profile's very first entry — ONB-lite included —
 * already opens under it, boot paint and all.
 */
export function seedAccent(profileId: string, accent: AccentId): void {
  localStorage.setItem(STORAGE_KEY_PREFIX + profileId, accent);
}

/** Applies a profile's stored accent to the document root — where a profile switch lands, and every unlock's data load. */
export function applyProfileAccent(profileId: string, kind: ProfileKind): void {
  paint(readStoredAccent(profileId, kind));
}

/**
 * Pre-mount paint (main.tsx, before first render — avoids an unaccented
 * flash). The id is the RAW device preference, unvalidated — validating it
 * needs the live profile list, which needs an unlocked database — so this
 * writes nothing and paints the best guess it has: the remembered profile's
 * stored accent, a not-yet-migrated legacy value, or the personal default.
 * `App` re-applies through `applyProfileAccent` the moment profiles load.
 */
export function applyBootAccent(activeProfileId: string | null): void {
  const stored =
    activeProfileId === null ? null : localStorage.getItem(STORAGE_KEY_PREFIX + activeProfileId);
  const candidate = stored ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  paint(isAccentId(candidate) ? candidate : PERSONAL_DEFAULT);
}

/**
 * Forgets ONE profile's stored accent and puts the document back on that
 * profile's default — part of „Izgled“'s „Vrati na podrazumevano“ (SET §5),
 * which only ever acts for the active profile. The key is REMOVED rather than
 * overwritten, so a reset leaves exactly what a fresh profile has; the legacy
 * key is dropped too, or the migration read below would resurrect it.
 */
export function clearStoredAccent(profileId: string, kind: ProfileKind): void {
  localStorage.removeItem(STORAGE_KEY_PREFIX + profileId);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  paint(readStoredAccent(profileId, kind));
}
