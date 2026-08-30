import type { Signal } from "@nexus/core";

import { parseSignalList } from "./signalPrefs.js";

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
 * that already exist, and — since ADR-086 — the answers themselves, which are
 * kept by `signalPrefs.ts` under a key of their own once the run completes.
 *
 * **The draft and the stored signals are two different things** and the
 * difference is worth stating, since both now hold a `Signal[]`. This is what
 * somebody is in the middle of saying and it is discarded the moment they
 * finish; `signalPrefs.ts` holds what they SAID, and it outlives the run so the
 * app can explain itself a year later. One is a resume point, the other is a
 * record.
 *
 * Completion clears the key. `pruneOnboardingDrafts` carries the `profilePrefs`
 * rule — validate against the LIVE profile list, drop what names a profile that
 * is no longer there — since a deleted profile's draft would otherwise sit in
 * `localStorage` for the life of the installation.
 */

const STORAGE_KEY_PREFIX = "nexus.onb.";

/** Upper bound on a stored name, mirroring the main-process rule the screen itself enforces (1–80 after trimming). */
const NAME_MAX = 80;

/** Upper bound on the stored trade sentence, mirroring the field's own maximum on the screen. */
const TRADE_MAX = 120;

export interface OnboardingDraft {
  /** The step id the user was last on — validated by the screen against its own list, since a build can rename a screen. */
  readonly step: string;
  /** What has been typed into the name field so far; deliberately NOT trimmed or committed — the rename is the completion act. */
  readonly name: string;
  /**
   * What the person has told the questionnaire so far (ADR-086).
   *
   * Validated field by field on the way back in, through the same
   * `parseSignalList` the durable store uses — one narrowing for one shape, so
   * a signal that is safe to plan from in one place is safe in the other.
   */
  readonly signals: readonly Signal[];
  /**
   * What is literally in the trade field — the one screen whose state a signal
   * cannot record.
   *
   * A signal carries a recognised TERM, so the rest of the sentence somebody
   * wrote („stolar, radim i montažu kuhinja") is not in it, and neither is the
   * fact that a chip was dismissed. Keeping the raw text is what lets a resumed
   * run open on the words the person actually typed and derive the dismissals
   * by diffing what the lexicon reads now against what the draft still carries.
   */
  readonly trade: string;
}

/**
 * The stored draft for one profile, or null for nothing usable — no draft,
 * unparseable JSON, or a shape this build does not recognise. Null always means
 * „start the questionnaire from the beginning“, which is a correct answer for
 * every one of those cases.
 *
 * **A draft written by the ADR-065 flow reads as a NAME and nothing else, and
 * that is deliberate.** It carries `packs` and `modules` — thirty-two ticked
 * boxes — and there is no honest conversion from those to signals: a tick is a
 * setting somebody chose about the software, a signal is something they said
 * about themselves, and nothing in „Finansije: da“ tells us they would have
 * written „vodim knjige“. So the answers are dropped, the typed name survives
 * (the one thing that is annoying to retype), and `resumeStep` refuses the old
 * screen id on its own — the run restarts at screen one with the name filled
 * in. Rejecting the whole draft would have thrown the name away for nothing.
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
  if (typeof draft["step"] !== "string" || typeof draft["name"] !== "string") return null;
  return {
    step: draft["step"],
    name: draft["name"].slice(0, NAME_MAX),
    signals: parseSignalList(draft["signals"]),
    trade: typeof draft["trade"] === "string" ? draft["trade"].slice(0, TRADE_MAX) : "",
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
