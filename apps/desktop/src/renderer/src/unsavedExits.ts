import { useMemo, useSyncExternalStore } from "react";

/**
 * Writes that failed after the page owing them was gone — the one place such a
 * failure can still be said, and, where it is safe, tried again.
 *
 * Every write-behind editor here (the two note editors, „Tabla") saves on a
 * debounce and flushes what it owes on the way out. A failure while the page is
 * up is the page's to show, beside the thing that did not save. A failure of
 * the LAST write, made as the page unmounts, has no page left: until 2026-09-27
 * each editor set its save line on a component React had already torn down, so
 * the failure was seen nowhere (DC-148). It is reported here instead, to the
 * shell, which outlives every page.
 *
 * **A retry is offered only where replaying the write cannot overwrite
 * anything.** A note's owed edit is a list of Yjs updates, and an update
 * applied late, or twice, merges — so „Pokušaj ponovo" is a real offer there
 * even after the note has been reopened and edited. A board is written whole,
 * so a replay after the board was reopened and drawn on would put the older
 * drawing over the newer one; and a private note's write is its plaintext,
 * which must not outlive the section's lock in a closure the shell holds. Those
 * two are said, not retried.
 *
 * Kept per profile, and shown only while that profile is active: the message
 * names a note or a board, and a profile switch must not carry one profile's
 * titles into the other's window (ADR-058 §1).
 */
export interface UnsavedExit {
  readonly id: number;
  readonly profileId: string;
  /** One sentence naming what did not save. */
  readonly message: string;
  /** Whether sending the write again is offered at all. */
  readonly retryable: boolean;
  /** A retry is out; a second one is not started while it is. */
  readonly retrying: boolean;
  /** The last retry failed as well, so the offer stands and says so. */
  readonly retryFailed: boolean;
}

export interface UnsavedExitReport {
  readonly profileId: string;
  readonly message: string;
  /**
   * What a later report supersedes. A board or a private note is written
   * WHOLE, so its newer failure makes the older one moot and one sentence per
   * subject is right. A note's owed updates are only part of it and are not
   * superseded by anything — two failed exits from one note owe two different
   * edits — so a note reports with `null` and each failure stands on its own.
   */
  readonly subject: string | null;
  /** Sends the owed write again; null where a replay could not help or could harm. */
  readonly retry: (() => Promise<void>) | null;
}

interface Entry extends UnsavedExit {
  readonly subject: string | null;
  readonly retry: (() => Promise<void>) | null;
}

let entries: readonly Entry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function publish(next: readonly Entry[]): void {
  entries = next;
  for (const listener of listeners) listener();
}

function patch(id: number, changes: Partial<Pick<Entry, "retrying" | "retryFailed">>): void {
  publish(entries.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)));
}

export function reportUnsavedExit(report: UnsavedExitReport): void {
  const kept =
    report.subject === null ? entries : entries.filter((entry) => entry.subject !== report.subject);
  publish([
    ...kept,
    {
      ...report,
      id: nextId++,
      retryable: report.retry !== null,
      retrying: false,
      retryFailed: false,
    },
  ]);
}

export function discardUnsavedExit(id: number): void {
  publish(entries.filter((entry) => entry.id !== id));
}

/** Sends one again; it is dropped once the write lands, and kept, marked, if it fails again. */
export async function retryUnsavedExit(id: number): Promise<void> {
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry === undefined || entry.retry === null || entry.retrying) return;
  patch(id, { retrying: true, retryFailed: false });
  try {
    await entry.retry();
  } catch (error) {
    console.error("Nexus: retrying a write that failed on the way out failed again:", error);
    patch(id, { retrying: false, retryFailed: true });
    return;
  }
  discardUnsavedExit(id);
}

export function unsavedExitsFor(profileId: string): readonly UnsavedExit[] {
  return entries.filter((entry) => entry.profileId === profileId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The active profile's unsaved exits, re-rendering whenever the list changes. */
export function useUnsavedExits(profileId: string | null): readonly UnsavedExit[] {
  const all = useSyncExternalStore(subscribe, () => entries);
  return useMemo(
    () => (profileId === null ? [] : all.filter((entry) => entry.profileId === profileId)),
    [all, profileId],
  );
}
