/**
 * One sync round on this desktop: everything `syncOnce` needs, constructed and
 * taken apart again around a single call.
 *
 * ─── What was missing, and why it looked like nothing was ───────────────────
 *
 * The engine, the scheduler, the wire and the content key were all finished and
 * all tested, and NOTHING CONSTRUCTED ANY OF THEM. Each piece takes its
 * dependencies as parameters — deliberately, so that a browser tab can satisfy
 * the same interfaces and so that a desktop with cloud off holds nothing that
 * could reach a network — which means the absence of a caller is invisible from
 * inside every one of them. This file is that caller.
 *
 * ─── The order is a rule, not a preference ──────────────────────────────────
 *
 * Local and free first, then the one request that decides whether the rest is
 * worth making:
 *
 *  1. **No ports** — cloud is off for this launch, or this build knows no
 *     project. Nothing else in this file can run, and `port.ts` guarantees there
 *     is no object here that could.
 *  2. **No account row** — sync was never turned on for this computer.
 *  3. **Locked** — the database is closed, so there is no data key, so there is
 *     nothing to open the master key with.
 *  4. **The access token**, refreshed if it would not survive the round, and its
 *     rotation written back ({@link accessTokenForRound}).
 *  5. **The content key**, which is one or two requests and can mint.
 *
 * Steps 1–3 cost nothing and rule out a machine that cannot participate whatever
 * the server says. Doing them after the refresh would spend a token — and a
 * refresh SPENDS the stored one — on behalf of a device that was never going to
 * send anything.
 *
 * ─── The keys live exactly as long as the round ─────────────────────────────
 *
 * The data key is erased as soon as the content key set has been opened from it,
 * and the set itself is erased when the round ends, whether it returned or threw.
 * Both releases are written as an assignment and then a release — never
 * `try { return syncOnce(…) } finally { keys.zeroize() }`, which erases the keys
 * AT THE RETURN STATEMENT, in the middle of the call that is using them. That is
 * `check:zeroize`'s whole reason for existing, and it cost an afternoon the first
 * time.
 *
 * ─── Nothing here throws at its caller ──────────────────────────────────────
 *
 * Every refusal is named. The caller is a scheduler that has to decide between
 * „later" and „stop", and it cannot decide that from a stack trace — while the
 * English `detail` strings the transport produces stay in this process, as
 * developer fault reports rather than user copy.
 */

import { zeroize, type CryptoPort } from "@nexus/sync-crypto";
import type { SyncAccount } from "@nexus/db";
import { syncOnce, type SyncRoundReport, type SyncStore } from "@nexus/sync-engine";

import type { SyncProblem } from "../../shared/ipc.js";
import { openContentKey, type ContentKeyProblem } from "./contentKey.js";
import { dataKeyBytes } from "./dataKey.js";
import type { CloudPorts } from "./port.js";
import { accessTokenForRound, type SessionHolder } from "./session.js";

/**
 * Why a round did not happen. Machine codes; the sentences are the renderer's.
 *
 * DERIVED from `SyncProblem` rather than declared, because the renderer must
 * have a sentence for every member and a second copy of the list is a member
 * that eventually has none. What is subtracted is the one thing that is not a
 * refusal to run: `nonce_reuse` is what a round that RAN came back and said.
 */
export type SyncRoundBlock = Exclude<SyncProblem, "nonce_reuse">;

export type SyncRoundOutcome =
  | {
      readonly kind: "ran";
      readonly report: SyncRoundReport;
      /** This round created the profile's first content key. */
      readonly minted: boolean;
      /**
       * Generations the server served that this device could not open.
       *
       * Not a failure — rows sealed at those epochs will quarantine, which is
       * the designed answer — but a fact the caller has to be able to log, since
       * nothing else will ever say it out loud.
       */
      readonly unopenable: readonly number[];
    }
  | {
      readonly kind: "blocked";
      readonly reason: SyncRoundBlock;
      /** English, for this process's log. Never user copy — see `service.ts`. */
      readonly detail: string | null;
    };

export interface SyncRoundDeps {
  readonly crypto: CryptoPort;
  /** `null` when this launch must not reach a network at all — see `port.ts`. */
  readonly ports: CloudPorts | null;
  readonly holder: SessionHolder;
  /** The stored account, or `null`. Read per round: `disconnect` can empty it. */
  readonly account: () => SyncAccount | null;
  /** Persist a refresh token GoTrue has just rotated to. */
  readonly saveRefreshToken: (token: string) => void;
  /** The unlocked SQLCipher data key as hex. Throws while locked. */
  readonly dataKeyHex: () => string;
  /**
   * The local store, already bound to this profile.
   *
   * A factory rather than a value because a round is about the profile that is
   * open now, and one built at construction would outlive a profile switch. The
   * engine's `SyncStore` carries no profile id at all, so binding it here is
   * what makes „a round cannot touch another profile's rows" unrepresentable
   * rather than forbidden.
   */
  readonly store: (profileId: string) => SyncStore;
  readonly now: () => Date;
}

export interface SyncRoundInput {
  readonly profileId: string;
  /** The scheduler's hint. Absent means walk every collection. */
  readonly collections?: readonly string[];
}

const blocked = (reason: SyncRoundBlock, detail: string | null = null): SyncRoundOutcome => ({
  kind: "blocked",
  reason,
  detail,
});

export async function runSyncRound(
  deps: SyncRoundDeps,
  input: SyncRoundInput,
): Promise<SyncRoundOutcome> {
  const { ports } = deps;
  if (ports === null) return blocked("cloud_off");

  const account = deps.account();
  if (account === null) return blocked("not_enabled");

  let dataKeyHex: string;
  try {
    dataKeyHex = deps.dataKeyHex();
  } catch {
    return blocked("locked");
  }

  // A round is the first thing in this product that asks for a token without a
  // user behind it, so the refresh has to be the one that writes its rotation
  // back. A network fault here is `offline` rather than a throw: the caller's
  // whole job is to tell „later" from „stop", and a stack says neither.
  let token: string | null;
  try {
    token = await accessTokenForRound(
      ports.auth,
      deps.holder,
      { persist: deps.saveRefreshToken },
      Math.floor(deps.now().getTime() / 1000),
    );
  } catch (error) {
    return blocked("offline", messageOf(error));
  }
  if (token === null) return blocked("signed_out");

  // Not caught, deliberately: `dataKeyBytes` throws only for a key that is not
  // 64 hex characters, and the one this is given is main's own. A refusal name
  // here would turn „this build has a bug" into „try again later, for ever".
  const localDataKey = dataKeyBytes(dataKeyHex);
  let opened;
  try {
    opened = await openContentKey(
      { crypto: deps.crypto, http: ports.http },
      {
        userId: account.userId,
        profileId: input.profileId,
        localWrap: account.localWrap,
        localDataKey,
      },
    );
  } catch (error) {
    return blocked("offline", messageOf(error));
  } finally {
    // The data key's whole purpose here is to open the master key, which
    // `openContentKey` has finished with by the time it answers. Nothing below
    // this line needs it, so nothing below this line may hold it.
    zeroize(localDataKey);
  }
  if (opened.kind === "refused") return blocked(fromContentKey(opened.reason), opened.detail);

  const keys = opened.keys;
  // Read BEFORE the round, because they are what this call learned about the
  // key set and the set is erased below.
  const { minted, unopenable } = keys;

  let report: SyncRoundReport;
  try {
    report = await syncOnce(
      {
        crypto: deps.crypto,
        http: ports.http,
        store: deps.store(input.profileId),
        scope: { userId: account.userId, profileId: input.profileId },
        contentKey: keys.key,
        ckEpoch: keys.epoch,
        keyFor: keys.keyFor,
        now: () => deps.now().toISOString(),
      },
      input.collections === undefined ? {} : { collections: input.collections },
    );
  } catch (error) {
    // `syncOnce` does not throw for anything the server does — every one of
    // those is a `SyncHalt` in the report. A throw is this build meeting
    // something it has no vocabulary for, and reporting it as `malformed`
    // rather than crashing the round is what keeps the scheduler's decision a
    // decision.
    return blocked("malformed", messageOf(error));
  } finally {
    keys.zeroize();
  }

  return { kind: "ran", report, minted, unopenable };
}

/**
 * The content key's vocabulary as this file's.
 *
 * Three of its seven collapse into `key_unavailable` on purpose: they differ in
 * which key is missing, which is a fact for the log, and they do not differ in
 * what a scheduler should do about it.
 */
function fromContentKey(reason: ContentKeyProblem): SyncRoundBlock {
  switch (reason) {
    case "forbidden":
      return "forbidden";
    case "offline":
      return "offline";
    case "malformed":
      return "malformed";
    case "contested":
      return "contested";
    default:
      return "key_unavailable";
  }
}

function messageOf(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}
