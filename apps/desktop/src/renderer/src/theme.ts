import type { ThemeName } from "@nexus/tokens";

const STORAGE_KEY = "nexus.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Noć is the product's identity theme (founder decision), so it stays the
 * default even though the *preference* default now includes "system".
 *
 * Exported for „Izgled“'s „Vrati na podrazumevano“ (SET §5): the theme is the
 * one preference on that card this page does not own — App holds it and drives
 * `<html data-theme>` — so the reset hands it back through the very channel
 * every other theme change goes through, rather than reaching around it into
 * storage. The key then holds "noc", which is exactly what an absent key reads
 * as.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "noc";

/**
 * A user's theme choice: an explicit theme, or "system" to follow the OS's
 * light/dark setting live. Persisted under the same `nexus.theme` key the
 * earlier two-theme model used, so an existing stored "dan"/"noc" value keeps
 * working unchanged, just as one of three preferences instead of the only two.
 */
export type ThemePreference = "system" | "dan" | "noc";

export function readStoredThemePreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "dan" || stored === "noc" || stored === "system"
    ? stored
    : DEFAULT_THEME_PREFERENCE;
}

/** Resolves a preference to a concrete theme; "system" follows the OS dark-mode media query. */
export function resolveTheme(preference: ThemePreference): ThemeName {
  if (preference === "system") {
    return window.matchMedia(DARK_QUERY).matches ? "noc" : "dan";
  }
  return preference;
}

/** Persists the preference and applies its resolved theme to the document root. */
export function persistThemePreference(preference: ThemePreference): void {
  localStorage.setItem(STORAGE_KEY, preference);
  document.documentElement.setAttribute("data-theme", resolveTheme(preference));
}

/** Applies whatever preference is already stored (main.tsx, before first render — avoids a themed flash). */
export function applyStoredThemePreference(): void {
  persistThemePreference(readStoredThemePreference());
}

/**
 * Subscribes to OS light/dark changes, returning an unsubscribe function.
 * Only meaningful while the current preference is "system" — callers are
 * responsible for gating the subscription accordingly.
 */
export function subscribeSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
