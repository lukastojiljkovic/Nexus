/**
 * One page of the log, in `seq` order, with the overlap the cursor design
 * requires.
 *
 * ─── The overlap is not caution, it is the reason `seq` works at all ────────
 *
 * Migration 001 says it plainly: an identity column's value is assigned BEFORE
 * the transaction commits, so two writes can take numbers 41 and 42 and commit
 * in the other order. A puller that asked for `seq > 41` in the window between
 * those commits would never see 41 again — its watermark has already passed it.
 * The fix is not a different column (`updated_at` has the identical hazard, only
 * with a clock in it); it is to re-read a little of what has already been read.
 * Applying a row twice is free under last-write-wins — the second apply loses to
 * itself — so the overlap costs bandwidth and buys a row that would otherwise be
 * lost silently and permanently.
 *
 * ─── The overlap belongs to a WALK, not to a request ────────────────────────
 *
 * {@link pullWindow} applies it, and {@link pullPage} does not: a page is asked
 * for at exactly the `fromSeq` it is given. That separation is not tidiness, it
 * is a bug this file had and a live test caught. When `pullPage` subtracted the
 * overlap itself, a walk that advanced its cursor to the last row of a page and
 * asked again had 64 subtracted from the number it had just moved forward to —
 * so with any page limit at or below the overlap the window never moved, the
 * same rows came back for ever, and the walk did not terminate. Above it, the
 * loop worked but re-read 64 rows on EVERY page of a full hydration rather than
 * once at the start.
 *
 * The rule the split states: the hazard is „a row numbered before my stored
 * watermark committed after I read past it", which is a fact about the STORED
 * watermark. Inside one walk each page is read forward from the page before it,
 * and there is nothing behind it to miss.
 *
 * `applyPull` must be handed the same `fromSeq` the query used, or its `nextSeq`
 * is computed against a base it did not read from — which is the kind of
 * arithmetic error that is invisible for months. {@link PullPage.fromSeq} echoes
 * it back for exactly that reason.
 *
 * ─── Why a page is „done" only when it is EMPTY ─────────────────────────────
 *
 * The obvious rule — „fewer rows than I asked for means the end" — is wrong
 * against PostgREST, and wrong silently. `config.toml` sets `max_rows = 1000`,
 * and that cap TRUNCATES a response without saying so: ask for 2 000 and get
 * 1 000, and a client using the obvious rule concludes it has reached the end of
 * a log it is halfway through. There is no header that distinguishes „that is
 * all there is" from „that is all you may have at once". So the loop rule is the
 * one that holds under any cap: keep pulling while rows keep arriving, and stop
 * on an empty page. It costs one extra round trip per sync and cannot skip
 * anything.
 *
 * {@link PULL_PAGE_ROWS} stays well under the cap anyway, so in practice the
 * truncation never fires — but a limit chosen to be under a server setting this
 * client cannot read is a coincidence, not a guarantee, which is why the rule
 * does not depend on it.
 */

import { type PulledRow, type SyncScope } from "@nexus/sync";

import { jsonHeaders, parseFailure, parseRows, postgrestPath, type HttpPort } from "./http.js";
import { PULL_SELECT, fromColumns } from "./rows.js";

/** Rows per request. Comfortably under `config.toml`'s `max_rows = 1000`; see the header. */
export const PULL_PAGE_ROWS = 500;

/**
 * How far behind the stored watermark a pull starts.
 *
 * Sized against what it defends: the window is „writes that were numbered before
 * my last read and committed after it", i.e. transactions in flight at one
 * instant on one account. Sixty-four is orders of magnitude more than a handful
 * of devices can have open at once, and it is 12 % of a page — an overlap that
 * costs nothing measurable and does not need tuning.
 */
export const PULL_OVERLAP = 64;

/**
 * Where a sync round starts reading, given what this device has stored.
 *
 * Called ONCE per collection per round, before the first page. Every later page
 * of the same walk starts at the `nextSeq` the previous page's `applyPull`
 * returned — see the header for why applying the overlap again would stall the
 * walk outright.
 */
export function pullWindow(cursor: number): number {
  return Math.max(0, cursor - PULL_OVERLAP);
}

export interface PullPage {
  readonly ok: true;
  /** The `seq` the query started after — the `fromSeq` given. Hand THIS to `applyPull`. */
  readonly fromSeq: number;
  readonly rows: readonly PulledRow[];
  /** No rows came back, so the log has nothing after `fromSeq`. See the header on why this and not a count. */
  readonly exhausted: boolean;
}

export type PullFailureReason =
  /** 401/403/42501 — the session is dead or revoked. */
  | "forbidden"
  /** 5xx, a body that is not an array, a transport error. Nothing was learned. */
  | "unavailable"
  /**
   * The server served something that is not a row of this table: an unknown
   * column, a `bytea` that is not hex, a bound outside the server's own CHECKs.
   *
   * The whole page fails rather than the row being skipped, and that is the same
   * choice `applyPull` makes about a shuffled batch: a server that serves
   * nonsense stalls itself and makes no progress. Skipping would let it choose
   * which of this account's rows a device never sees.
   */
  | "malformed";

export interface PullFailure {
  readonly ok: false;
  readonly reason: PullFailureReason;
  readonly status: number;
  readonly sqlstate: string | null;
  readonly message: string | null;
}

export type PullPageResult = PullPage | PullFailure;

/**
 * One page of one collection, starting immediately after `fromSeq`.
 *
 * `fromSeq` is taken literally — {@link pullWindow} is what turns a stored
 * watermark into the first one of a round.
 *
 * `user_id` is in the filter as well as `profile_id` and `collection` — not
 * because RLS would let anything else through, but because it is the leading
 * column of `sync_objects_pull`, and a query that cannot use that index degrades
 * into a scan of the account as it grows.
 */
export async function pullPage(
  http: HttpPort,
  scope: SyncScope,
  collection: string,
  fromSeq: number,
  limit: number = PULL_PAGE_ROWS,
): Promise<PullPageResult> {
  const path = postgrestPath("sync_objects", [
    ["user_id", `eq.${scope.userId}`],
    ["profile_id", `eq.${scope.profileId}`],
    ["collection", `eq.${collection}`],
    ["seq", `gt.${fromSeq}`],
    ["select", PULL_SELECT],
    ["order", "seq.asc"],
    ["limit", String(limit)],
  ]);

  const response = await http({ method: "GET", path, headers: jsonHeaders(), body: null });

  if (response.status !== 200) {
    const failure = parseFailure(response.body);
    const forbidden =
      response.status === 401 || response.status === 403 || failure.code === "42501";
    return {
      ok: false,
      reason: forbidden ? "forbidden" : "unavailable",
      status: response.status,
      sqlstate: failure.code,
      message: failure.message,
    };
  }

  const raw = parseRows(response.body);
  if (raw === null) {
    return {
      ok: false,
      reason: "unavailable",
      status: response.status,
      sqlstate: null,
      message: "the body of a 200 was not a JSON array",
    };
  }

  const rows: PulledRow[] = [];
  for (const value of raw) {
    const row = fromColumns(value);
    if (row === null) {
      return {
        ok: false,
        reason: "malformed",
        status: response.status,
        sqlstate: null,
        message: `row ${rows.length} of the page is not a sync_objects row`,
      };
    }
    rows.push(row);
  }

  return { ok: true, fromSeq, rows, exhausted: rows.length === 0 };
}

/**
 * The stored watermark after a page has been applied.
 *
 * A `max` and not an assignment, and the reason is the overlap above. Every pull
 * starts BEHIND the stored cursor, so a page whose last readable row sits inside
 * the overlap — or one that blocks on its first row, which makes `applyPull`
 * return `fromSeq` unchanged — yields a `nextSeq` lower than what the device
 * already knows. Storing it would walk the cursor backwards a little on every
 * sync, re-reading a growing tail forever without ever being visibly broken.
 *
 * One function rather than a sentence in a comment, because this is the exact
 * arithmetic `pull.ts` in `@nexus/sync` says „is a correctness rule, not
 * bookkeeping, and it is wrong in a way nobody would notice for months".
 */
export function advanceCursor(stored: number, nextSeq: number): number {
  return Math.max(stored, nextSeq);
}
