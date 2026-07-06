import type { ThemeName } from "@nexus/tokens";

const STORAGE_KEY = "nexus.theme";
const DEFAULT_THEME: ThemeName = "noc";

// Theme is a user setting, not a feature flag, so it is NOT persisted through the
// flags IPC. localStorage is a deliberate interim store — the SET (settings)
// module owns theme persistence and cross-device sync later (ADR-008).

export function readStoredTheme(): ThemeName {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "dan" || stored === "noc" ? stored : DEFAULT_THEME;
}

export function applyStoredTheme(): ThemeName {
  const theme = readStoredTheme();
  document.documentElement.setAttribute("data-theme", theme);
  return theme;
}

export function persistTheme(theme: ThemeName): void {
  localStorage.setItem(STORAGE_KEY, theme);
  document.documentElement.setAttribute("data-theme", theme);
}
