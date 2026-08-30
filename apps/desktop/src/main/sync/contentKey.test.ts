// The fixtures spell the wrap context out by hand — `ck/master-key` over
// (userId, profileId, epoch) — rather than importing the module's own `context`
// helper. That is the whole reason they can fail: a suite that derives the AAD
// from the code under test follows it wherever it moves, and the machine that
// would notice is the SECOND one, which never runs here.

import { beforeEach, describe, expect, it } from "vitest";
import { wrapKey, type SealedKey } from "@nexus/sync-crypto";
import { createFakeCryptoPort } from "@nexus/sync-crypto/testing";
import { base64urlToBytea, type HttpPort, type HttpRequest } from "@nexus/sync-transport";

import { FIRST_CK_EPOCH, openContentKey, type ContentKeyInput } from "./contentKey.js";

const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PROFILE = "11111111-2222-4333-8444-555555555555";
const OTHER_PROFILE = "99999999-8888-4777-8666-555555555555";
const DATA_KEY = new Uint8Array(32).fill(7);

let crypto: ReturnType<typeof createFakeCryptoPort>;
/** MK, and this computer's wrap of it — what `SyncAccountStore` holds. */
let masterKey: Uint8Array;
let localWrap: SealedKey;

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: string | null;
}

/** One canned answer per request, in order; the last one repeats. */
function port(answers: readonly { status: number; body: string }[]): {
  http: HttpPort;
  calls: Call[];
} {
  const calls: Call[] = [];
  let index = 0;
  const http: HttpPort = async (request: HttpRequest) => {
    calls.push({ method: request.method, path: request.path, body: request.body });
    const answer = answers[Math.min(index, answers.length - 1)] ?? { status: 500, body: "" };
    index += 1;
    return answer;
  };
  return { http, calls };
}

/** A `key_wraps` row as PostgREST serves one: `bytea` in hex, timestamps or null. */
async function row(
  key: Uint8Array,
  epoch: number,
  options: { profileId?: string; disabled?: boolean; kek?: Uint8Array } = {},
): Promise<Record<string, unknown>> {
  const profileId = options.profileId ?? PROFILE;
  const sealed = await wrapKey(crypto, options.kek ?? masterKey, key, {
    purpose: "ck/master-key",
    userId: USER,
    profileId,
    epoch,
  });
  return {
    profile_id: profileId,
    epoch,
    nonce: base64urlToBytea(sealed.nonce),
    wrapped: base64urlToBytea(sealed.ciphertext),
    commit_tag: base64urlToBytea(sealed.commitment),
    disabled_at: options.disabled === true ? "2026-08-17T10:00:00Z" : null,
  };
}

const input = (): ContentKeyInput => ({
  userId: USER,
  profileId: PROFILE,
  localWrap,
  localDataKey: DATA_KEY,
});

const ok = (rows: readonly unknown[]): { status: number; body: string } => ({
  status: 200,
  body: JSON.stringify(rows),
});

beforeEach(async () => {
  crypto = createFakeCryptoPort({ seed: 42 });
  masterKey = crypto.randomBytes(32);
  localWrap = await wrapKey(crypto, DATA_KEY, masterKey, {
    purpose: "mk/local-data-key",
    userId: USER,
  });
});

describe("openContentKey — the profile already has one", () => {
  it("opens the live generation and mints nothing", async () => {
    const existing = crypto.randomBytes(32);
    const { http, calls } = port([ok([await row(existing, 1)])]);

    const result = await openContentKey({ crypto, http }, input());

    expect(result.kind).toBe("open");
    if (result.kind !== "open") return;
    expect(result.keys.epoch).toBe(1);
    expect([...result.keys.key]).toEqual([...existing]);
    expect(result.keys.minted).toBe(false);
    // One GET and nothing else. A mint here would claim a slot that is taken and
    // be told so — but only after the key it generated had been used for a wrap.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
  });

  it("keeps a retired generation openable and seals under the newest live one", async () => {
    // `disabled` means „never seal anything NEW under this", not „this cannot be
    // opened". A device pulling a log meets rows at whatever epoch they were
    // sealed at, including epochs a rotation has since retired.
    const retired = crypto.randomBytes(32);
    const live = crypto.randomBytes(32);
    const { http } = port([
      ok([await row(retired, 1, { disabled: true }), await row(live, 2)]),
    ]);

    const result = await openContentKey({ crypto, http }, input());

    expect(result.kind).toBe("open");
    if (result.kind !== "open") return;
    expect(result.keys.epoch).toBe(2);
    expect([...result.keys.key]).toEqual([...live]);
    expect([...(result.keys.keyFor(1) ?? [])]).toEqual([...retired]);
    expect(result.keys.keyFor(3)).toBeNull();
  });

  it("reports a generation it cannot open instead of dropping it silently", async () => {
    // A wrap that was written under a DIFFERENT master key. Rows sealed at that
    // epoch will quarantine, which is the designed answer — but „this device
    // cannot open generation 1" is a fact the caller has to be able to log.
    const stranger = crypto.randomBytes(32);
    const live = crypto.randomBytes(32);
    const { http } = port([
      ok([
        await row(stranger, 1, { disabled: true, kek: crypto.randomBytes(32) }),
        await row(live, 2),
      ]),
    ]);

    const result = await openContentKey({ crypto, http }, input());

    expect(result.kind).toBe("open");
    if (result.kind !== "open") return;
    expect(result.keys.unopenable).toEqual([1]);
    expect(result.keys.keyFor(1)).toBeNull();
    expect([...result.keys.key]).toEqual([...live]);
  });

  it("refuses when the LIVE generation is the one it cannot open", async () => {
    // The same condition one epoch over, and it is not the same outcome: there is
    // no key to seal under, so proceeding would mean pushing rows nothing can read.
    const { http } = port([ok([await row(crypto.randomBytes(32), 1, { kek: crypto.randomBytes(32) })])]);

    const result = await openContentKey({ crypto, http }, input());

    expect(result).toMatchObject({ kind: "refused", reason: "content-key-unreadable" });
  });

  it("refuses when every generation is retired", async () => {
    const { http } = port([ok([await row(crypto.randomBytes(32), 1, { disabled: true })])]);

    const result = await openContentKey({ crypto, http }, input());

    expect(result).toMatchObject({ kind: "refused", reason: "no-live-generation" });
  });

  it("refuses a wrap belonging to another profile", async () => {
    // The request filters on `profile_id`, so this cannot happen against a server
    // that applied it. The AAD would refuse the wrap anyway — but as a commitment
    // mismatch, which reads as corruption rather than as a server that ignored a
    // filter.
    const { http } = port([ok([await row(crypto.randomBytes(32), 1, { profileId: OTHER_PROFILE })])]);

    const result = await openContentKey({ crypto, http }, input());

    expect(result).toMatchObject({ kind: "refused", reason: "malformed" });
  });

  it("refuses two wraps at the same epoch", async () => {
    // `key_wraps_one_per_slot` makes this unreachable. If it arrives anyway the
    // server is contradicting its own unique index, and taking one of the two
    // would be choosing which generation this device believes in.
    const { http } = port([
      ok([await row(crypto.randomBytes(32), 1), await row(crypto.randomBytes(32), 1)]),
    ]);

    const result = await openContentKey({ crypto, http }, input());

    expect(result).toMatchObject({ kind: "refused", reason: "malformed" });
  });
});

describe("openContentKey — the slot is empty", () => {
  it("mints the first generation and returns the key the SERVER stored", async () => {
    const { http, calls } = port([ok([]), { status: 201, body: "" }]);
    // The insert answers with what it stored; the harness echoes the request body
    // back, which is what `return=representation` does.
    const echoing: HttpPort = async (request) => {
      const answer = await http(request);
      if (request.method !== "POST") return answer;
      const sent = JSON.parse(request.body ?? "[]") as Record<string, unknown>[];
      return { status: 201, body: JSON.stringify(sent.map((r) => ({ ...r, disabled_at: null }))) };
    };

    const result = await openContentKey({ crypto, http: echoing }, input());

    expect(result.kind).toBe("open");
    if (result.kind !== "open") return;
    expect(result.keys.minted).toBe(true);
    expect(result.keys.epoch).toBe(FIRST_CK_EPOCH);

    // THE KEY IS THE ONE THAT CAME BACK, not the one that was generated. The only
    // path to a usable key in this module is unwrapping a wrap the server holds,
    // which is what makes „never seal under a key whose wrap is not durable"
    // structural rather than a rule somebody has to remember.
    const posted = JSON.parse(calls[1]?.body ?? "[]") as Record<string, unknown>[];
    expect(posted[0]?.["kind"]).toBe("ck_under_mk");
    expect(posted[0]?.["epoch"]).toBe(FIRST_CK_EPOCH);
    expect(posted[0]?.["user_id"]).toBe(USER);
  });

  it("erases the generated key rather than carrying it past the wrap", async () => {
    // The claim the module's header rests on, and the one thing here nothing else
    // can observe: the plaintext is a local that never reaches the result, so a
    // test can only see it by watching the randomness it came from. If the mint
    // ever kept it — as a convenience, to skip the unwrap — the „only path to a
    // usable key is a wrap the server holds" guarantee would still LOOK held,
    // because the returned key would be identical either way.
    const generated: Uint8Array[] = [];
    const watched: typeof crypto = {
      ...crypto,
      randomBytes: (length: number) => {
        const bytes = crypto.randomBytes(length);
        if (length === 32) generated.push(bytes);
        return bytes;
      },
    };
    const { http } = port([ok([]), { status: 403, body: "" }]);

    await openContentKey({ crypto: watched, http }, input());

    // Exactly one 32-byte draw: the content key. The wrap's nonce is 24.
    expect(generated).toHaveLength(1);
    expect([...(generated[0] ?? [])]).toEqual(Array<number>(32).fill(0));
  });

  it("adopts the winner when another device claimed the slot first", async () => {
    const winner = crypto.randomBytes(32);
    const answers = [
      ok([]),
      { status: 409, body: JSON.stringify({ code: "23505", message: "duplicate key" }) },
      ok([await row(winner, 1)]),
    ];
    const { http, calls } = port(answers);

    const result = await openContentKey({ crypto, http }, input());

    expect(result.kind).toBe("open");
    if (result.kind !== "open") return;
    expect([...result.keys.key]).toEqual([...winner]);
    // Minted is FALSE: this device generated a key, lost the race, and threw it
    // away. Reporting the attempt rather than the outcome would tell the caller
    // this profile joined sync here when it did not.
    expect(result.keys.minted).toBe(false);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "GET"]);
  });

  it("refuses when the slot is taken and then reads back empty", async () => {
    // A server disagreeing with itself. There is deliberately no third attempt:
    // retrying a contradiction is how a client spins.
    const { http, calls } = port([
      ok([]),
      { status: 409, body: JSON.stringify({ code: "23505", message: "duplicate key" }) },
      ok([]),
    ]);

    const result = await openContentKey({ crypto, http }, input());

    expect(result).toMatchObject({ kind: "refused", reason: "contested" });
    expect(calls).toHaveLength(3);
  });

  it("carries a refused mint through as the reason the transport gave", async () => {
    const { http } = port([
      ok([]),
      { status: 403, body: JSON.stringify({ code: "42501", message: "permission denied" }) },
    ]);

    const result = await openContentKey({ crypto, http }, input());

    expect(result).toMatchObject({ kind: "refused", reason: "forbidden" });
  });
});

describe("openContentKey — what it refuses before touching the network", () => {
  it("refuses a local wrap this computer's data key does not open, without a request", async () => {
    const { http, calls } = port([ok([])]);
    const wrong = { ...input(), localDataKey: new Uint8Array(32).fill(9) };

    const result = await openContentKey({ crypto, http }, wrong);

    expect(result).toMatchObject({ kind: "refused", reason: "master-key-unreadable" });
    // The master key is opened FIRST because it is local and free. A machine that
    // cannot participate should not spend a request discovering it.
    expect(calls).toHaveLength(0);
  });
});

describe("openContentKey — failures the transport names", () => {
  it("maps a dead session to `forbidden`", async () => {
    const { http } = port([{ status: 401, body: "" }]);
    expect(await openContentKey({ crypto, http }, input())).toMatchObject({
      kind: "refused",
      reason: "forbidden",
    });
  });

  it("maps a server that is not answering to `offline`", async () => {
    const { http } = port([{ status: 503, body: "" }]);
    expect(await openContentKey({ crypto, http }, input())).toMatchObject({
      kind: "refused",
      reason: "offline",
    });
  });

  it("maps a body that is not a list of wraps to `malformed`", async () => {
    const { http } = port([{ status: 200, body: JSON.stringify([{ epoch: "one" }]) }]);
    expect(await openContentKey({ crypto, http }, input())).toMatchObject({
      kind: "refused",
      reason: "malformed",
    });
  });
});

describe("ContentKeySet.zeroize", () => {
  it("erases every generation, and the live key with them", async () => {
    const { http } = port([
      ok([await row(crypto.randomBytes(32), 1, { disabled: true }), await row(crypto.randomBytes(32), 2)]),
    ]);

    const result = await openContentKey({ crypto, http }, input());
    expect(result.kind).toBe("open");
    if (result.kind !== "open") return;

    const live = result.keys.key;
    const retired = result.keys.keyFor(1);
    expect(retired).not.toBeNull();

    result.keys.zeroize();

    expect([...live]).toEqual(Array<number>(32).fill(0));
    expect([...(retired ?? [])]).toEqual(Array<number>(32).fill(0));
    // And the lookup stops answering, so a caller holding the set past its
    // lifetime gets `null` rather than 32 zero bytes that would „work".
    expect(result.keys.keyFor(1)).toBeNull();
    expect(result.keys.keyFor(2)).toBeNull();
  });

  it("is idempotent", async () => {
    const { http } = port([ok([await row(crypto.randomBytes(32), 1)])]);
    const result = await openContentKey({ crypto, http }, input());
    if (result.kind !== "open") throw new Error("expected an open key set");
    result.keys.zeroize();
    expect(() => result.keys.zeroize()).not.toThrow();
  });
});
