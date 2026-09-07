/**
 * The TASK module's device preferences (ADR-049), stored in `localStorage` on
 * the `notePrefs.ts` / `weekStart.ts` recipe: a closed value set, a safe
 * fallback for anything unrecognized, and no IPC — this describes how THIS
 * machine reads the smart lists, not what the profile contains.
 *
 * Unlike the note width there is no document attribute to write: the value is
 * read by the page (it feeds `selectSmartList`'s `includeBlocked`), never by
 * the stylesheet — the same split `persistWeekStart` lives under.
 */
import { clearStoredOverviewOpen } from "./overviewPrefs.js";

const BLOCKED_IN_TODAY_KEY = "nexus.tasks.blockedInToday";

/** Whether a blocked task (ADR-037: waiting on something still open) shows up in Danas and Sledećih 7 dana. */
export type BlockedInToday = "prikazi" | "sakrij";

export const BLOCKED_IN_TODAY_OPTIONS: readonly BlockedInToday[] = ["sakrij", "prikazi"];

/**
 * Hidden by default. „Danas“ answers "what can I do now", and a task whose
 * condition is not finished is precisely what cannot be done now — so the quiet
 * default is to leave it out, and showing it is the deliberate choice.
 */
const DEFAULT_BLOCKED_IN_TODAY: BlockedInToday = "sakrij";

function isBlockedInToday(value: string | null): value is BlockedInToday {
  return value != null && BLOCKED_IN_TODAY_OPTIONS.some((option) => option === value);
}

export function readStoredBlockedInToday(): BlockedInToday {
  const stored = localStorage.getItem(BLOCKED_IN_TODAY_KEY);
  return isBlockedInToday(stored) ? stored : DEFAULT_BLOCKED_IN_TODAY;
}

export function persistBlockedInToday(preference: BlockedInToday): void {
  localStorage.setItem(BLOCKED_IN_TODAY_KEY, preference);
}

/** Forgets this card's one key, so the next read hides blocked tasks again — „Zadaci“'s „Vrati na podrazumevano“ (SET §5). */
export function clearStoredTaskPreferences(): void {
  localStorage.removeItem(BLOCKED_IN_TODAY_KEY);
  clearStoredOverviewOpen("tasks");
}

/** The form `selectSmartList` takes — the one place the preference's spelling meets the query's flag. */
export function toIncludeBlocked(preference: BlockedInToday): boolean {
  return preference === "prikazi";
}
