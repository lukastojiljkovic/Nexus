/**
 * The profile's content key: open it, or mint the first generation — and never
 * hand back a key whose wrap the server does not already hold.
 *
 * ─── The rule this module exists to make structural ─────────────────────────
 *
 * A row sealed under a content key no peer can fetch is a row no peer can ever
 * open, and no later repair can invent the key. So „read, then mint if empty,
 * then seal" is not a preference about ordering; it is the difference between a
 * profile that syncs and a profile whose history is unreadable everywhere else.
 *
 * The rule could have been a comment. Instead there is exactly ONE path in this
 * file that produces a usable key: {@link unwrapKey} over a wrap the server
 * served. The mint generates 32 bytes, wraps them, sends the wrap, **throws the
 * plaintext away**, and opens the row that came back. So a key this module
 * returns is by construction a key the server can serve to the user's other
 * machines — there is no branch where the two could differ, and nobody has to
 * remember the rule to keep it.
 *
 * ─── Why the mint is a client INSERT and not an Edge Function ───────────────
 *
 * `sync-enable` mints MK inside a function because „exactly once per account" is
 * an atomic-singleton problem a service role can solve. This is not that problem.
 * The row is CK_p wrapped UNDER MK, the server has never held MK and must never
 * hold it, so a function would be a proxy for the same insert with no authority
 * the desktop lacks. `key_wraps_one_per_slot` is the better arbiter of „exactly
 * once per slot": two desktops minting in the same second cannot both win, and
 * the loser is told `23505` — {@link ContentKeyProblem} `taken` in the transport
 * — rather than discovering later that it sealed rows under a key nothing else
 * has.
 *
 * ─── Every generation, and the ones that will not open ──────────────────────
 *
 * `keyFor` answers for retired epochs too: `disabled` means „seal nothing NEW
 * under this", not „this cannot be opened", and a device pulling a log meets rows
 * at whatever epoch they were sealed at. A generation this device cannot open is
 * NOT dropped quietly — rows at that epoch will quarantine, which is the designed
 * answer, but „generation 1 did not open" is a fact the caller has to be able to
 * log, so it is on the set as {@link ContentKeySet.unopenable}. The same
 * condition on the LIVE generation is fatal instead: there is nothing to seal
 * under, and proceeding would mean pushing rows nothing can read.
 */

import {
  generateContentKey,
  parseSealedKey,
  unwrapKey,
  wrapKey,
  zeroize,
  type CryptoPort,
  type SealedKey,
  type WrapContext,
} from "@nexus/sync-crypto";
import {
  mintContentKeyWrap,
  readContentKeyWraps,
  type ContentKeyFailure,
  type ContentKeyWrap,
  type HttpPort,
} from "@nexus/sync-transport";
import type { ContentKeyForEpoch } from "@nexus/sync";

/** The generation a profile's first content key is minted at. */
export const FIRST_CK_EPOCH = 1;

/** The purpose every wrap this module touches carries. */
const CK_PURPOSE = "ck/master-key";

export type ContentKeyProblem =
  /** 401/403/42501 — the session is dead, revoked, or is not a desktop. */
  | "forbidden"
  /** 5xx or a transport fault. Nothing was learned; the caller may try later. */
  | "offline"
  /** The server served something that is not this profile's set of wraps. */
  | "malformed"
  /** This computer's data key does not open its own copy of the master key. */
  | "master-key-unreadable"
  /** The live generation exists and this account's master key does not open it. */
  | "content-key-unreadable"
  /** Every generation is retired: nothing may be sealed, so nothing may be pushed. */
  | "no-live-generation"
  /** The slot was taken and then read back empty — a server disagreeing with itself. */
  | "contested";

export interface ContentKeySet {
  /** The generation new rows are sealed under: the newest that is not retired. */
  readonly epoch: number;
  /** The key at {@link ContentKeySet.epoch}. Erased by {@link ContentKeySet.close}. */
  readonly key: Uint8Array;
  /** Which key opens a given epoch, `null` for one this device does not hold. */
  readonly keyFor: ContentKeyForEpoch;
  /** True when THIS call created the profile's first generation. */
  readonly minted: boolean;
  /** Generations the server served that this device could not open, ascending. */
  readonly unopenable: readonly number[];
  /**
   * Erase every generation. Idempotent, and after it `keyFor` answers `null`
   * rather than 32 zero bytes — a zeroed key is still a key as far as an AEAD is
   * concerned, and one that „works" is worse than one that is absent.
   *
   * NOT called `close`, and the name is the point. `check:zeroize` exists
   * because a key released in a `finally` beside a `return` of an async call is
   * erased in the MIDDLE of that call, and the gate recognises the release by
   * the substring `zeroize(` — narrowly, because `close(` is what a database, a
   * file and a socket are released with and a gate that fired on all of them
   * would be switched off. So a set released as `keys.close()` would sit exactly
   * outside the reach of the rule written for it (DC-61), while `keys.zeroize()`
   * is inside it for every caller that will ever be written.
   */
  readonly zeroize: () => void;
}

export type OpenContentKeyResult =
  | { readonly kind: "open"; readonly keys: ContentKeySet }
  | {
      readonly kind: "refused";
      readonly reason: ContentKeyProblem;
      /** English, for the main process's log. Never user copy — see `service.ts`. */
      readonly detail: string | null;
    };

export interface ContentKeyDeps {
  readonly crypto: CryptoPort;
  readonly http: HttpPort;
}

export interface ContentKeyInput {
  readonly userId: string;
  readonly profileId: string;
  /** MK under this computer's data key, as `SyncAccountStore` holds it. */
  readonly localWrap: SealedKey;
  /** The unlocked SQLCipher data key. Borrowed — the caller owns its erasure. */
  readonly localDataKey: Uint8Array;
}

/**
 * The profile's content key, ready to seal and to open with.
 *
 * The master key is opened FIRST, before any request. It is local and free, and a
 * machine that cannot open its own wrap cannot participate whatever the server
 * says — spending a round trip to discover that would be a request made on behalf
 * of a device that is already out.
 */
export async function openContentKey(
  deps: ContentKeyDeps,
  input: ContentKeyInput,
): Promise<OpenContentKeyResult> {
  let masterKey: Uint8Array;
  try {
    masterKey = await unwrapKey(deps.crypto, input.localDataKey, input.localWrap, {
      purpose: "mk/local-data-key",
      userId: input.userId,
    });
  } catch (error) {
    return refused("master-key-unreadable", messageOf(error));
  }

  try {
    const read = await readContentKeyWraps(deps.http, input.profileId);
    if (!read.ok) return fromTransport(read);

    // `return await`, NOT `return`, and every one of these is load-bearing. A
    // `return promise` inside a `try` completes the try block AT THE RETURN
    // STATEMENT — the `finally` below then runs while the returned promise is
    // still pending, so the master key would be erased in the middle of the very
    // call that is using it. It cost an afternoon: generation 1 opened (its
    // subkeys were derived before the first await yielded) and generation 2 was
    // decrypted under 32 zero bytes, which presents as a commitment mismatch,
    // which reads as „the server sent a wrap from another account".
    if (read.wraps.length > 0) return await openAll(deps, input, masterKey, read.wraps, false);

    const claimed = await claimFirstGeneration(deps, input, masterKey);
    if (claimed.kind === "refused") return claimed;
    return await openAll(deps, input, masterKey, claimed.wraps, claimed.minted);
  } finally {
    // In a `finally` so „MK lives as long as this call" stays true when the call
    // FAILS, which is the shape `service.ts` learned the hard way: a save that
    // threw used to leave the account's master key live for as long as the
    // process ran.
    zeroize(masterKey);
  }
}

interface Claimed {
  readonly kind: "claimed";
  readonly wraps: readonly ContentKeyWrap[];
  readonly minted: boolean;
}

/**
 * Claim epoch 1 for a profile that has no wrap, or adopt whoever got there first.
 *
 * The generated key is erased before the request goes out. Nothing here needs it
 * again: what the caller gets back is opened from the row the server stored, so
 * the wrap is the only carrier and the race has exactly one winner in both the
 * database and this process.
 */
async function claimFirstGeneration(
  deps: ContentKeyDeps,
  input: ContentKeyInput,
  masterKey: Uint8Array,
): Promise<Claimed | Extract<OpenContentKeyResult, { kind: "refused" }>> {
  const fresh = generateContentKey(deps.crypto);
  let sealed: SealedKey;
  try {
    sealed = await wrapKey(deps.crypto, masterKey, fresh, context(input, FIRST_CK_EPOCH));
  } finally {
    zeroize(fresh);
  }

  const mint = await mintContentKeyWrap(deps.http, {
    userId: input.userId,
    profileId: input.profileId,
    epoch: FIRST_CK_EPOCH,
    sealed: { nonce: sealed.nonce, ciphertext: sealed.ciphertext, commitment: sealed.commitment },
  });
  if (mint.ok) return { kind: "claimed", wraps: [mint.wrap], minted: true };
  if (mint.reason !== "taken") return fromTransport(mint);

  // Another device wrote the slot between the read and the insert. Read it again
  // and adopt what is there. There is deliberately no third attempt: a slot that
  // is empty after a `23505` is a server contradicting itself, and retrying a
  // contradiction is how a client spins.
  const again = await readContentKeyWraps(deps.http, input.profileId);
  if (!again.ok) return fromTransport(again);
  if (again.wraps.length === 0) {
    return refused("contested", "the slot was taken and then read back empty");
  }
  // `minted` is false: this device generated a key, lost the race and threw it
  // away. Reporting the attempt rather than the outcome would tell the caller
  // that this profile joined sync here, which it did not.
  return { kind: "claimed", wraps: again.wraps, minted: false };
}

/** Every generation the server served, opened under MK. */
async function openAll(
  deps: ContentKeyDeps,
  input: ContentKeyInput,
  masterKey: Uint8Array,
  wraps: readonly ContentKeyWrap[],
  minted: boolean,
): Promise<OpenContentKeyResult> {
  const keys = new Map<number, Uint8Array>();
  const unopenable: number[] = [];
  const erase = (): void => {
    for (const key of keys.values()) zeroize(key);
    keys.clear();
  };
  const give = (reason: ContentKeyProblem, detail: string): OpenContentKeyResult => {
    erase();
    return refused(reason, detail);
  };

  for (const wrap of wraps) {
    // The request filters on `profile_id`, so a foreign row means the server did
    // not apply it. The AAD would refuse the wrap anyway — as a commitment
    // mismatch, which reads as corruption rather than as what it is.
    if (wrap.profileId !== input.profileId) {
      return give("malformed", `a wrap for profile ${wrap.profileId} arrived`);
    }
    // `key_wraps_one_per_slot` makes this unreachable. Arriving anyway, taking
    // either row would be choosing which generation this device believes in.
    if (keys.has(wrap.epoch) || unopenable.includes(wrap.epoch)) {
      return give("malformed", `two wraps at epoch ${wrap.epoch}`);
    }

    const sealed = parseSealedKey({ v: 2, purpose: CK_PURPOSE, ...wrap.sealed });
    if (sealed === null) {
      unopenable.push(wrap.epoch);
      continue;
    }
    try {
      keys.set(wrap.epoch, await unwrapKey(deps.crypto, masterKey, sealed, context(input, wrap.epoch)));
    } catch {
      unopenable.push(wrap.epoch);
    }
  }

  const live = wraps.filter((wrap) => !wrap.disabled).reduce(highestEpoch, null);
  if (live === null) {
    return give("no-live-generation", "every generation of this profile's key is retired");
  }
  const key = keys.get(live);
  if (key === undefined) {
    return give("content-key-unreadable", `the master key does not open generation ${live}`);
  }

  unopenable.sort((a, b) => a - b);
  return {
    kind: "open",
    keys: {
      epoch: live,
      key,
      keyFor: (epoch: number) => keys.get(epoch) ?? null,
      minted,
      unopenable,
      zeroize: erase,
    },
  };
}

const highestEpoch = (highest: number | null, wrap: ContentKeyWrap): number =>
  highest === null || wrap.epoch > highest ? wrap.epoch : highest;

function context(input: ContentKeyInput, epoch: number): WrapContext {
  return { purpose: CK_PURPOSE, userId: input.userId, profileId: input.profileId, epoch };
}

const refused = (
  reason: ContentKeyProblem,
  detail: string | null,
): Extract<OpenContentKeyResult, { kind: "refused" }> => ({ kind: "refused", reason, detail });

/**
 * A transport failure as this module's vocabulary.
 *
 * `taken` is absent on purpose: it is not an outcome of this function, it is a
 * step inside {@link claimFirstGeneration}, and a caller that could receive it
 * would have to know what to do about a race it cannot see.
 */
function fromTransport(failure: ContentKeyFailure): Extract<OpenContentKeyResult, { kind: "refused" }> {
  const reason: ContentKeyProblem =
    failure.reason === "forbidden"
      ? "forbidden"
      : failure.reason === "malformed"
        ? "malformed"
        : failure.reason === "taken"
          ? "contested"
          : "offline";
  const detail = [failure.sqlstate, failure.message].filter((part) => part !== null).join(" ");
  return refused(reason, detail === "" ? `HTTP ${failure.status}` : detail);
}

function messageOf(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}
