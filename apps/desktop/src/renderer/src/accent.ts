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

/**
 * Forgets the stored accent and puts the document back on the default — part
 * of „Izgled“'s „Vrati na podrazumevano“ (SET §5). The key is REMOVED rather
 * than overwritten with the default, so a reset leaves exactly what a fresh
 * install has; the document attribute is written from the read that follows,
 * because a page whose stylesheet still says „bordo“ has not been reset.
 */
export function clearStoredAccent(): void {
  localStorage.removeItem(STORAGE_KEY);
  document.documentElement.setAttribute("data-accent", readStoredAccent());
}
