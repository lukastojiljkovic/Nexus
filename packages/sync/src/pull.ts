/**
 * A row the server served becomes a merged `RowState` — or a named refusal that
 * does not stop the batch.
 *
 * ─── The AAD is rebuilt from the SERVER'S OWN CLAIM ─────────────────────────
 *
 * Every field in {@link PulledRow} except the ciphertext is metadata the server
 * stores in the clear and could rewrite. This file feeds every one of them back
 * into the AAD before opening, which is what turns each rewrite into a visible
 * failure instead of a silent success: move a row to another profile, roll its
 * version back, strip its tombstone, reparent it, claim a content-key epoch it
 * was not sealed under — the tag check fails, and `openRowFields` throws.
 *
 * The temptation this exists to refuse is to rebuild the AAD from what the
 * CLIENT expected instead. That version of the code passes every test and
 * authenticates nothing at all.
 *
 * ─── A failure is quarantined, not retried, and only one kind blocks ────────
 *
 * A pull is a cursor walk over `seq`. Advancing the watermark past a row this
 * device could not read loses that object permanently; refusing to advance
 * stalls every later row behind it, forever, on a failure that will answer the
 * same way every time. Neither is acceptable as a blanket rule, so the two cases
 * are separated by whether a retry could plausibly succeed:
 *
 *  - `no-key` — this device holds no content key for the row's epoch, because a
 *    rotation happened and the new `CK_p` has not been unwrapped yet. Fetching
 *    the key wraps and pulling again WILL succeed, so this HOLDS the cursor.
 *  - `aead-failed` and `bad-plaintext` — the bytes will not change on a retry.
 *    Either the server is serving something it should not, or a peer wrote a
 *    shape this client version cannot parse. The cursor advances past them and
 *    they are quarantined BY KEY, so the object can be re-fetched directly once
 *    the key arrives, the client is upgraded, or a human is told.
 *
 * That is why {@link PullResult} reports `nextSeq` rather than leaving the
 * caller to take `max(seq)`: the arithmetic is a correctness rule, not
 * bookkeeping, and it is wrong in a way nobody would notice for months.
 *
 * ─── What is deliberately NOT here ──────────────────────────────────────────
 *
 * Writing the merged state into the real tables. That needs SQLite and the
 * collection's derived-column rules, so it lives where the database does; this
 * file hands back the merged `RowState` and says whether the local row and the
 * server's copy each still agree with it.
 *
 * Detecting a server that WITHHOLDS rows. Every row served here is genuine and
 * every rewrite is caught, but a server that simply omits a row — or truncates
 * the tail of a collection — passes every check in this file, because the rows
 * it did serve are real. That needs a sealed manifest over
 * `(object_id, version, ck_epoch)`, which is a new table and not a change here.
 */

import {
  canonicalJson,
  decodeRowState,
  encodeRowState,
  mergeRows,
  openRowFields,
  SyncCryptoError,
  type CryptoPort,
  type RowIdentity,
  type RowState,
} from "@nexus/sync-crypto/web";

import type { SyncScope } from "./push.js";
import type { PulledRow } from "./wire.js";

/**
 * Which content key opens a given epoch, or `null` when this device holds none.
 *
 * A FUNCTION rather than one key, because the epoch exists precisely so that two
 * generations can be live at once: a rotation re-encrypts a profile row by row,
 * and until it finishes the account holds rows on both. `row.ts` binds the epoch
 * into the AAD so a client never has to TRY two keys — it looks the right one up
 * and gets one attempt, always.
 */
export type ContentKeyForEpoch = (ckEpoch: number) => Uint8Array | null;

/** What this device already holds for an object, or `null` for one it has never seen. */
export type LocalStateLookup = (collection: string, objectId: string) => RowState | null;

/** Why one row could not be applied. See the file header for which of these block the cursor. */
export type PullRefusalReason =
  /** No content key for this row's `ck_epoch`. Transient: unwrap the key and pull again. */
  | "no-key"
  /** The ciphertext did not authenticate against the metadata the server itself supplied. */
  | "aead-failed"
  /** It opened, and what came out is not a `RowState` this client understands. */
  | "bad-plaintext";

export interface PullRefused {
  readonly ok: false;
  readonly collection: string;
  readonly objectId: string;
  readonly seq: number;
  readonly reason: PullRefusalReason;
}

export interface PullApplied {
  readonly ok: true;
  readonly collection: string;
  readonly objectId: string;
  readonly seq: number;
  /** What the server holds, as this client read it. */
  readonly remote: RowState;
  /** `mergeRows(local, remote)` — or `remote` alone for an object never seen here. */
  readonly merged: RowState;
  /** The merge differs from what this device held: the local row must be rewritten. */
  readonly changed: boolean;
  /** The merge differs from what the SERVER holds: this device owes it a push. */
  readonly owed: boolean;
  /**
   * The server served a version BELOW one this device had already merged.
   *
   * Never legitimate. A local version is only ever set from a push the server
   * accepted or a merge against a row the server served, so it cannot outrun the
   * server by accident — this is a restored backup or a deliberate rollback. The
   * merge recovers on its own (`mergeRows` takes the greater version and the
   * push that follows carries the newer state) but the event is worth seeing,
   * because a server doing it repeatedly is a server erasing edits.
   */
  readonly rolledBack: boolean;
}

export type PullOutcome = PullApplied | PullRefused;

export interface PullResult {
  readonly outcomes: readonly PullOutcome[];
  /**
   * How far the pull watermark may advance. Equal to `fromSeq` when the first
   * row of the batch blocks, so a caller that stores this unconditionally cannot
   * skip a row it never read.
   */
  readonly nextSeq: number;
  /**
   * Objects to re-fetch BY KEY rather than by cursor, and to surface.
   *
   * Only the refusals the cursor moved PAST — a row that held the cursor is
   * already going to be served again from the same watermark, and listing it
   * here would tell the caller to chase a row that is arriving anyway, and to
   * report a rotation in progress as a row that cannot be read. Every refusal,
   * blocking or not, is still in {@link outcomes}.
   */
  readonly quarantined: readonly PullRefused[];
}

/** Only a missing key is worth waiting for; see the file header. */
const BLOCKS_CURSOR: ReadonlySet<PullRefusalReason> = new Set<PullRefusalReason>(["no-key"]);

/**
 * Opens, merges and reports one batch, in the order given.
 *
 * `rows` MUST be ascending by `seq` — the transport asks for that order. A batch
 * that is not ascending is not rejected wholesale, because the reordering party
 * is the server and a throw would hand it a way to crash every client: instead
 * the cursor stops at the first row out of order, so a server that shuffles its
 * log stalls itself and makes no progress, which is the failure to prefer.
 */
export async function applyPull(
  port: CryptoPort,
  scope: SyncScope,
  keyFor: ContentKeyForEpoch,
  localState: LocalStateLookup,
  fromSeq: number,
  rows: readonly PulledRow[],
): Promise<PullResult> {
  const outcomes: PullOutcome[] = [];
  const quarantined: PullRefused[] = [];
  let nextSeq = fromSeq;
  let advancing = true;
  let lastSeq = fromSeq;

  for (const row of rows) {
    const outcome = await applyOne(port, scope, keyFor, localState, row);
    outcomes.push(outcome);
    const blocking = !outcome.ok && BLOCKS_CURSOR.has(outcome.reason);
    if (!outcome.ok && !blocking) quarantined.push(outcome);

    if (!advancing) continue;
    if (row.seq <= lastSeq) {
      // Out of order, or a repeat. Either way the cursor cannot move past it
      // without the possibility of skipping something.
      advancing = false;
      continue;
    }
    lastSeq = row.seq;
    if (blocking) {
      advancing = false;
      continue;
    }
    nextSeq = row.seq;
  }

  return { outcomes, nextSeq, quarantined };
}

async function applyOne(
  port: CryptoPort,
  scope: SyncScope,
  keyFor: ContentKeyForEpoch,
  localState: LocalStateLookup,
  row: PulledRow,
): Promise<PullOutcome> {
  const { collection, objectId, seq } = row;
  const refuse = (reason: PullRefusalReason): PullRefused => ({
    ok: false,
    collection,
    objectId,
    seq,
    reason,
  });

  const contentKey = keyFor(row.ckEpoch);
  if (contentKey === null) return refuse("no-key");

  const identity: RowIdentity = {
    userId: scope.userId,
    profileId: scope.profileId,
    collection,
    objectId,
    version: row.version,
    deleted: row.deleted,
    parentId: row.parentId,
    ckEpoch: row.ckEpoch,
  };

  let plaintext;
  try {
    plaintext = await openRowFields(port, contentKey, identity, {
      v: 2,
      nonce: row.nonce,
      ciphertext: row.ciphertext,
    });
  } catch (error) {
    // `row/malformed` cannot reach here — `parsePulledRow` already checked both
    // lengths — so the only shapes left are the AEAD's own refusal and a
    // plaintext that is not UTF-8 or not a JSON object. They are reported
    // apart because they mean different things: one is a server or a bad disk,
    // the other is a peer this client cannot understand.
    const code = error instanceof SyncCryptoError ? error.code : null;
    return refuse(code === "row/bad-plaintext" ? "bad-plaintext" : "aead-failed");
  }

  // The envelope is the SERVER's claim, and `decodeRowState` cross-checks its
  // tombstone against the stamped one in the plaintext. Both are already
  // authenticated — `deleted` is in the AAD — so this catches a peer holding
  // CK_p that sealed the two copies disagreeing, not the server.
  const remote = decodeRowState(plaintext, { version: row.version, deleted: row.deleted });
  if (remote === null) return refuse("bad-plaintext");

  const local = localState(collection, objectId);
  const merged = local === null ? remote : mergeRows(local, remote);

  return {
    ok: true,
    collection,
    objectId,
    seq,
    remote,
    merged,
    changed: local === null || !sameState(local, merged),
    owed: !sameState(remote, merged),
    rolledBack: local !== null && row.version < local.version,
  };
}

/**
 * Do two states carry the same information?
 *
 * Compared through `encodeRowState`, which means the VERSION is deliberately
 * excluded: it is the server's bookkeeping, not content, and including it would
 * make `owed` true for every row this device pulled at a higher version than it
 * held — a push of bytes the server already has, forever, on every sync.
 *
 * `canonicalJson` rather than a structural walk, for the reason it exists: field
 * order must not decide whether two identical states look different.
 */
function sameState(left: RowState, right: RowState): boolean {
  return canonicalJson(encodeRowState(left)) === canonicalJson(encodeRowState(right));
}
