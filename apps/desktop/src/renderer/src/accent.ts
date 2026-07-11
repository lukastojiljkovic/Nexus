import { ACCENT_IDS, type AccentId } from "@nexus/tokens";

const STORAGE_KEY = "nexus.accent";
const DEFAULT_ACCENT: AccentId = "zlato";

function isAccentId(value: string | null): value is AccentId {
  return value != null && (ACCENT_IDS as readonly string[]).includes(value);
}

/** Reads the stored accent choice, falling back to the default for anything unrecognized (including nothing stored yet). */
export function readStoredAccent(): AccentId {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isAccentId(stored) ? stored : DEFAULT_ACCENT;
}

/** Persists the accent choice and applies it to the document root. */
export function persistAccent(accent: AccentId): void {
  localStorage.setItem(STORAGE_KEY, accent);
  document.documentElement.setAttribute("data-accent", accent);
}

/** Applies whatever accent is already stored (main.tsx, before first render — avoids an unaccented flash). */
export function applyStoredAccent(): void {
  persistAccent(readStoredAccent());
}
