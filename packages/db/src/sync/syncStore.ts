/**
 * `SyncJournal` + `SyncProgressStore` as the one thing the engine asks for.
 *
 * The engine declares `SyncStore` because a browser tab has to satisfy it too,
 * and this is the desktop's side of that contract. It is a binding rather than a
 * class: everything below is already implemented, and the only thing missing was
 * a profile — which is exactly what makes this the right shape, because a port
 * that carried a profile id per call would let a round write another profile's
 * rows by passing the wrong one. Closed over once, that mistake stops being
 * possible rather than being forbidden.
 *
 * The three tables the round reads and writes belong to two stores because they
 * answer two questions, and the split is where the transaction boundary is: the
 * owed set is written inside `sweep`'s and `apply`'s own transactions, while the
 * watermark and the quarantine are the walk's own bookkeeping. See migration
 * 066's header.
 */

import type { SyncStore } from "@nexus/sync-engine";

import type { SyncJournal } from "./syncJournal.js";
import type { SyncProgressStore } from "./syncProgress.js";

export function syncStoreFor(
  journal: SyncJournal,
  progress: SyncProgressStore,
  profileId: string,
): SyncStore {
  return {
    sweep(now) {
      // The sweep's return value is dropped on purpose. What the round pushes
      // comes from `owed()`, which is a table and survives a crash; taking the
      // list instead would reintroduce the defect the outbox exists to close.
      journal.sweep(profileId, now);
    },
    owed: (limit) => journal.owed(profileId, limit),
    owedCount: () => journal.owedCount(profileId),
    confirmPushed: (collection, objectId, next, now) =>
      journal.confirmPushed(profileId, collection, objectId, next, now),
    recordPushFailure: (collection, objectId, code, message) =>
      journal.recordPushFailure(profileId, collection, objectId, code, message),
    readState: (collection, objectId) => journal.readState(profileId, collection, objectId),
    apply: (requests, now) => journal.apply(profileId, requests, now),
    cursor: (collection) => progress.cursor(profileId, collection),
    advance(collection, seq) {
      progress.advance(profileId, collection, seq);
    },
    quarantine: (rows) => progress.quarantine(profileId, rows),
  };
}
