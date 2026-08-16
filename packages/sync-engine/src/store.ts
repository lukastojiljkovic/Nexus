/**
 * What the round needs of a local store, and nothing else.
 *
 * **Why the interface is declared here and not in `@nexus/db`.** The consumer
 * names what it needs: this package must run in a browser tab, where SQLite and
 * `better-sqlite3` do not exist, so a port that imported `@nexus/db` would make
 * the web half unbuildable. `@nexus/db` satisfies it structurally — its adapter
 * binds the profile and hands back an object of this shape — and the desktop is
 * where the two meet. The types below are therefore the CONTRACT, and the fact
 * that `SyncJournal` and `SyncProgressStore` happen to have the same shapes is
 * checked where the adapter is written, not assumed here.
 *
 * **Every method is already scoped to one profile.** The engine never passes a
 * profile id, because a round is about one profile and an engine that could name
 * another is an engine that can cross-write a profile's rows. The adapter closes
 * over it, which makes that mistake unrepresentable rather than forbidden.
 */

import type { RowState } from "@nexus/sync-crypto/web";

/** One object the server does not have. */
export interface OwedObject {
  readonly collection: string;
  readonly objectId: string;
  /** What the push will seal — the sweep's state, or a pull's merge. */
  readonly state: RowState;
  /** How many pushes of this object have already been refused. */
  readonly attempts: number;
}

/** One merged object to write back into the table it came from. */
export interface ApplyRequest {
  readonly collection: string;
  readonly objectId: string;
  readonly merged: RowState;
  /** The merge differs from what this device held: the row must be rewritten. */
  readonly changed: boolean;
  /** The merge differs from what the SERVER holds: the object is owed a push. */
  readonly owed: boolean;
}

/** What became of one write-back. */
export type ApplyStatus = "written" | "state-only" | "stale" | "unknown" | "refused";

export interface ApplyOutcome {
  readonly collection: string;
  readonly objectId: string;
  readonly status: ApplyStatus;
}

/** One object the cursor moved past without being able to read it. */
export interface QuarantinedObject {
  readonly collection: string;
  readonly objectId: string;
  readonly seq: number;
  readonly reason: "aead-failed" | "bad-plaintext";
  readonly seenAt: string;
}

export interface SyncStore {
  /**
   * Turn every local edit since the last sweep into shadow state and owed rows.
   *
   * Returns nothing on purpose, though the implementation has a list to give:
   * what the round pushes comes from {@link owed}, which is a TABLE and survives
   * a crash, and taking the return value instead would quietly reintroduce the
   * defect the outbox exists to close.
   */
  sweep(now: string): void;

  /** What the server does not have, least-failed first, at most `limit` of them. */
  owed(limit: number): readonly OwedObject[];

  /**
   * How many objects are owed in total.
   *
   * Separate from {@link owed} because the round reports it and a screen shows
   * it: „three items are waiting" is a number a user reads, and deriving it from
   * a page of the queue would either cap it at the page size — which is a count
   * that silently stops counting — or fetch and decode every owed state to
   * answer a question about how many there are.
   */
  owedCount(): number;

  /** The server took it: store the version it accepted and stop owing the object. */
  confirmPushed(collection: string, objectId: string, next: RowState, now: string): void;

  /** The push did not land. The object stays owed; only the server's opinion is recorded. */
  recordPushFailure(
    collection: string,
    objectId: string,
    code: string,
    message: string | null,
  ): void;

  /** What this device last sealed or merged for one object, for the merge to run against. */
  readState(collection: string, objectId: string): RowState | null;

  /**
   * Write merged objects back, without letting the writes look like new local
   * edits.
   *
   * ONE OUTCOME PER REQUEST, IN THE ORDER GIVEN. The round pairs them off by
   * position to decide how far the cursor may move, so a store that filtered,
   * reordered or coalesced them would move the watermark past a row it had not
   * written. A store that cannot answer for a request must still say so in that
   * request's place.
   */
  apply(requests: readonly ApplyRequest[], now: string): readonly ApplyOutcome[];

  /** How far this device has read one collection's log. Zero for one never read. */
  cursor(collection: string): number;

  /** Raise that watermark. Never lowers it — see `SyncProgressStore.advance`. */
  advance(collection: string, seq: number): void;

  /** Objects the cursor moved past unread, for a by-key re-fetch and a report. */
  quarantine(rows: readonly QuarantinedObject[]): void;
}
