/**
 * One sync round: sweep, pull, push, in that order and for reasons.
 *
 * **Sweep before pull**, because `applyPull`'s write-back refuses an object
 * whose local edit is still in the journal — the merge would have been computed
 * against a baseline this device no longer holds. Sweeping first is what makes
 * that refusal rare rather than the normal case.
 *
 * **Pull before push**, because a push carries the state the pull just merged.
 * `owed()` reads the shadow state through a join, so an object that was owed
 * before the pull is owed at its MERGED state afterwards without anything here
 * arranging it: the round sends one row instead of sending a stale one, being
 * refused with `NX001`, and sending it again next round.
 *
 * **Nothing here retries.** A round attempts each owed object at most once and
 * each collection's log until it stops making progress, then returns. Retrying
 * inside a round would mean deciding how long to wait, which is a scheduler's
 * question and a platform's answer — Electron has timers and a lifecycle, a
 * browser tab has neither. What survives the round is in tables: `sync_outbox`
 * carries what is still owed and why the last attempt failed, `sync_cursor`
 * carries how far each collection has been read, and `sync_quarantine` carries
 * what could not be opened. The report this returns is a SUMMARY of a round, not
 * the record of one.
 *
 * **What stops a round early** is only what makes continuing meaningless or
 * unsafe: a dead session (every later request would fail the same way), a
 * network that is not answering (likewise), and a nonce the server has seen
 * before — which is an alarm, not a failure. Reuse under XChaCha20-Poly1305
 * publishes the plaintext XOR and the Poly1305 forging key, so the round stops
 * pushing that profile at once and says so.
 */

import { applyPull, classify, collections, parentIdOf, planPush } from "@nexus/sync";
import type {
  ContentKeyForEpoch,
  PullApplied,
  PushCandidate,
  PushRow,
  SyncScope,
} from "@nexus/sync";
import type { CryptoPort, RowState } from "@nexus/sync-crypto/web";
import { PULL_PAGE_ROWS, needsReread, pullPage, pullWindow, pushRows } from "@nexus/sync-transport";
import type { HttpPort, PushResult } from "@nexus/sync-transport";

import type { ApplyRequest, ApplyStatus, QuarantinedObject, SyncStore } from "./store.js";

/** Owed objects planned and pushed per request batch. */
export const PUSH_BATCH_ROWS = 100;

/** Everything a round needs that this package refuses to own. */
export interface SyncDeps {
  readonly crypto: CryptoPort;
  readonly http: HttpPort;
  readonly store: SyncStore;
  readonly scope: SyncScope;
  /** The live content key, and the generation the server knows it by. */
  readonly contentKey: Uint8Array;
  readonly ckEpoch: number;
  /** Older generations, for rows sealed before a rotation. `null` when unavailable. */
  readonly keyFor: ContentKeyForEpoch;
  /** ISO 8601, read once per write so a round's stamps agree with the caller's clock. */
  readonly now: () => string;
}

export interface SyncRoundOptions {
  /**
   * Which collections to walk. Absent means all of them.
   *
   * This is where the Realtime signal's hint lands: a broadcast that says „these
   * three changed" turns a round from fifty-four requests into three. A hint is
   * never trusted to be complete — a round with no hint is the one that
   * guarantees nothing is missed, and the scheduler is what decides how often to
   * run one.
   */
  readonly collections?: readonly string[];
  readonly pushBatch?: number;
}

/** Why a round gave up before it ran out of work. */
export type SyncHalt =
  /** 401/403/42501 — the session is dead or this device has been revoked. */
  | "forbidden"
  /** 5xx, a timeout, an unparseable body. Nothing was learned; try again later. */
  | "offline"
  /** NX005 — a nonce this content key has already used. Stop, and surface it. */
  | "nonce-reuse"
  /** The server served something that is not a row of `sync_objects`. */
  | "malformed";

export interface SyncRoundReport {
  /**
   * Rows read off the server and opened.
   *
   * A quiet round is not a round with `pulled: 0`. Every walk starts
   * `PULL_OVERLAP` entries behind the stored watermark, so a device that is
   * fully caught up re-reads the tail of every collection's log on every round,
   * by design — the overlap is what closes the window between „numbered before
   * my last read" and „committed after it".
   */
  readonly pulled: number;
  /**
   * Objects whose merge CHANGED the local tables.
   *
   * Rows the overlap served again are opened, merged and found to say what this
   * device already holds; their shadow state moves and the row does not, and
   * they are not counted here. That distinction is the whole usefulness of this
   * number: counted the other way, `applied` would be non-zero on every round
   * for ever, and „did anything happen" would have no answer.
   */
  readonly applied: number;
  /** Objects the server accepted. */
  readonly pushed: number;
  /** Pushes the server refused because somebody else wrote first, or the row is not there. */
  readonly conflicts: number;
  /** Rows the cursor moved past without being able to open them. */
  readonly quarantined: number;
  /** How many objects the server still does not have when the round ended. */
  readonly owed: number;
  readonly halted: SyncHalt | null;
}

/** An apply outcome that must not let the stored cursor move past its row. */
const HOLDS_CURSOR: ReadonlySet<ApplyStatus> = new Set<ApplyStatus>(["stale", "refused"]);

/**
 * A sweep, a walk of every collection, and a drain of the owed set.
 *
 * The halt of the pull phase does not skip the push phase: the two fail for
 * different reasons — a `malformed` page says nothing about whether a write
 * would be taken — and a device that can still send what it owes should send it.
 * The two halts that DO cross are `forbidden` and `nonce-reuse`, because the
 * first means no request will be taken and the second means none should be.
 */
export async function syncOnce(
  deps: SyncDeps,
  options: SyncRoundOptions = {},
): Promise<SyncRoundReport> {
  deps.store.sweep(deps.now());

  const pull = await pullPhase(deps, options.collections ?? everyCollection());
  const push =
    pull.halted === "forbidden" || pull.halted === "nonce-reuse"
      ? { pushed: 0, conflicts: 0, halted: pull.halted }
      : await pushPhase(deps, options.pushBatch ?? PUSH_BATCH_ROWS);

  return {
    pulled: pull.pulled,
    applied: pull.applied,
    quarantined: pull.quarantined,
    pushed: push.pushed,
    conflicts: push.conflicts,
    owed: deps.store.owedCount(),
    halted: push.halted ?? pull.halted,
  };
}

function everyCollection(): readonly string[] {
  return collections().map((collection) => collection.table);
}

interface PullTally {
  readonly pulled: number;
  readonly applied: number;
  readonly quarantined: number;
  readonly halted: SyncHalt | null;
}

async function pullPhase(deps: SyncDeps, names: readonly string[]): Promise<PullTally> {
  let pulled = 0;
  let applied = 0;
  let quarantined = 0;

  for (const name of names) {
    const walk = await pullOne(deps, name);
    pulled += walk.pulled;
    applied += walk.applied;
    quarantined += walk.quarantined;
    // A halt is about the connection or the session, never about the collection,
    // so there is nothing to learn from asking fifty-three more times.
    if (walk.halted !== null) return { pulled, applied, quarantined, halted: walk.halted };
  }
  return { pulled, applied, quarantined, halted: null };
}

/**
 * One collection's log, from where this device left off to where it stops.
 *
 * Two watermarks, and the difference between them is the whole design. `from` is
 * where the NEXT PAGE starts and moves whenever the pull could read; `storable`
 * is what gets written to `sync_cursor` and stops at the first row the local
 * write-back could not take. A child that arrives before its parent is refused
 * by a foreign key, and its parent is very often further down the same log — so
 * the walk carries on and writes the parent, while the cursor stays behind the
 * child so the next round is served it again. Holding both back instead would
 * deadlock exactly that case: the parent would be in a page the walk never
 * fetched, and the child would be refused for ever.
 */
async function pullOne(deps: SyncDeps, name: string): Promise<PullTally> {
  const { store, scope } = deps;
  const localState = (collection: string, objectId: string): RowState | null =>
    store.readState(collection, objectId);

  let from = pullWindow(store.cursor(name));
  let storable = from;
  let held = false;
  let pulled = 0;
  let applied = 0;
  let quarantined = 0;

  for (;;) {
    const page = await pullPage(deps.http, scope, name, from, PULL_PAGE_ROWS);
    if (!page.ok) {
      const halted: SyncHalt =
        page.reason === "forbidden"
          ? "forbidden"
          : page.reason === "malformed"
            ? "malformed"
            : "offline";
      return { pulled, applied, quarantined, halted };
    }
    if (page.rows.length === 0) return { pulled, applied, quarantined, halted: null };

    const result = await applyPull(deps.crypto, scope, deps.keyFor, localState, from, page.rows);
    pulled += page.rows.length;

    const opened = result.outcomes.filter((outcome): outcome is PullApplied => outcome.ok);
    const outcomes = store.apply(opened.map(toApplyRequest), deps.now());
    applied += outcomes.filter((outcome) => outcome.status === "written").length;

    const unreadable: QuarantinedObject[] = [];
    for (const refusal of result.quarantined) {
      // `no-key` never reaches `quarantined` — `applyPull` holds the cursor on it
      // instead, because a rotation in progress is not an unreadable row. The
      // type cannot say so, so this is a skip rather than a cast: if the rule
      // ever changes, a key that is merely late stops being filed as damage.
      if (refusal.reason === "no-key") continue;
      unreadable.push({
        collection: refusal.collection,
        objectId: refusal.objectId,
        seq: refusal.seq,
        reason: refusal.reason,
        seenAt: deps.now(),
      });
    }
    if (unreadable.length > 0) {
      store.quarantine(unreadable);
      quarantined += unreadable.length;
    }

    if (!held) {
      for (const [index, row] of opened.entries()) {
        // Paired off by position, which the port requires of `apply`. A store
        // that answered short is treated as a hold rather than trusted: moving
        // the watermark past a row nobody claimed to have written is the one
        // mistake here that loses data instead of repeating work.
        const outcome = outcomes[index];
        if (outcome === undefined || HOLDS_CURSOR.has(outcome.status)) {
          held = true;
          break;
        }
        storable = row.seq;
      }
      // Nothing held, so the cursor may take everything the pull itself passed —
      // including the rows it moved past unread, which have no outcome here.
      if (!held) storable = result.nextSeq;
      store.advance(name, storable);
    }

    // `applyPull` answers `fromSeq` unchanged when its first row blocks. Asking
    // for the same page again would return the same page for ever, so this is
    // the walk's termination condition as well as the blocked one.
    if (result.nextSeq <= from) return { pulled, applied, quarantined, halted: null };
    from = result.nextSeq;
  }
}

function toApplyRequest(outcome: PullApplied): ApplyRequest {
  return {
    collection: outcome.collection,
    objectId: outcome.objectId,
    merged: outcome.merged,
    changed: outcome.changed,
    owed: outcome.owed,
  };
}

interface PushTally {
  readonly pushed: number;
  readonly conflicts: number;
  readonly halted: SyncHalt | null;
}

async function pushPhase(deps: SyncDeps, batch: number): Promise<PushTally> {
  const { store } = deps;
  // Every object this round has already put a request behind. The queue orders
  // by `attempts`, so a refused object sinks below the untried ones on its own —
  // but „on its own" is a property of an ORDER BY, and a round that took the
  // same object twice because a batch boundary fell in the wrong place would
  // double its `attempts` and look like two independent refusals.
  const attempted = new Set<string>();
  let pushed = 0;
  let conflicts = 0;

  for (;;) {
    const owed = store
      .owed(batch)
      .filter((object) => !attempted.has(`${object.collection}/${object.objectId}`));
    if (owed.length === 0) return { pushed, conflicts, halted: null };
    for (const object of owed) attempted.add(`${object.collection}/${object.objectId}`);

    const candidates: PushCandidate[] = [];
    for (const object of owed) {
      const collection = classify(object.collection);
      if (collection === undefined || collection.kind !== "collection") {
        // A collection this build no longer carries. Recorded rather than
        // dropped: an older client meeting a newer peer's table is a real state,
        // and the row must stay owed for the upgrade that can send it.
        store.recordPushFailure(object.collection, object.objectId, "unknown-collection", null);
        continue;
      }
      try {
        candidates.push({
          collection: object.collection,
          objectId: object.objectId,
          parentId: parentIdOf(collection, object.objectId, object.state),
          state: object.state,
        });
      } catch (error) {
        // `parentIdOf` throws when the shadow state carries no parent key, which
        // is a corrupt local file rather than anything the server did. Caught
        // per object, because one of them must not cost the other ninety-nine
        // their round trip.
        store.recordPushFailure(
          object.collection,
          object.objectId,
          "malformed-parent",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    if (candidates.length === 0) return { pushed, conflicts, halted: null };

    const plans = await planPush(
      deps.crypto,
      deps.scope,
      deps.contentKey,
      deps.ckEpoch,
      candidates,
    );
    const rows: PushRow[] = [];
    const nexts: RowState[] = [];
    for (const plan of plans) {
      if (!plan.ok) {
        store.recordPushFailure(plan.collection, plan.objectId, plan.reason, null);
        continue;
      }
      rows.push(plan.row);
      nexts.push(plan.next);
    }
    if (rows.length === 0) return { pushed, conflicts, halted: null };

    const results = await pushRows(deps.http, deps.scope, rows);
    let accepted = 0;
    for (const [index, result] of results.entries()) {
      if (result.code === "accepted") {
        store.confirmPushed(result.collection, result.objectId, nexts[index]!, deps.now());
        accepted += 1;
        pushed += 1;
        continue;
      }
      store.recordPushFailure(result.collection, result.objectId, result.code, result.message);
      if (needsReread(result.code)) conflicts += 1;
    }

    const halted = haltOf(results);
    if (halted !== null) return { pushed, conflicts, halted };
    // `pushRows` stops the batch on a re-read, so a round that accepted nothing
    // has learned everything this batch had to teach it. Taking another would
    // spin against a server that is refusing on a rule this round cannot change.
    if (accepted === 0) return { pushed, conflicts, halted: null };
  }
}

/**
 * The one outcome in a batch that ends the round, if there is one.
 *
 * Order matters: `nonce-reuse` outranks everything because it is the only code
 * here that is about this client's own key rather than about the connection.
 */
function haltOf(results: readonly PushResult[]): SyncHalt | null {
  if (results.some((result) => result.code === "nonce-reuse")) return "nonce-reuse";
  if (results.some((result) => result.code === "forbidden")) return "forbidden";
  if (results.some((result) => result.code === "unavailable")) return "offline";
  return null;
}
