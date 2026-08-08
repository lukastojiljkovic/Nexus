/**
 * The adversarial pass over this package: one test per defect found by reading
 * it as an attacker rather than as its author.
 *
 * These live in one file, apart from the per-module suites, on purpose. Each
 * one was RED against the code as first written, and each is named after the
 * rule that was claimed in a comment but not enforced anywhere. A reviewer who
 * wants to know what the security review actually found reads this file; a
 * reviewer who wants to know what a module does reads its own suite.
 *
 * The recurring shape, and it is worth naming: **a rule enforced on one path is
 * present, not applied.** `providerReceiveM1` checked the code record and
 * `providerReceiveM3` did not; `port.ts` promised a low-order-point re-check
 * that `pairing.ts` never made; `merge.ts` refused to keep two copies of the
 * version and then kept two copies of `deleted`. In every case the reasoning
 * was written down correctly and then applied in exactly one of the places it
 * governs.
 */

import { describe, expect, it } from "vitest";
import { bytesToBase64url } from "./bytes.js";
import { SyncCryptoError } from "./errors.js";
import { compareHlc, formatHlc, parseHlc, type Hlc } from "./hlc.js";
import {
  WEB_KDF_PARAMS,
  deriveWebAuthPassword,
  deriveWebPasswordKeys,
  rewrapMasterKeyForEmailChange,
} from "./kdf.js";
import { applyEdit, decodeRowState, emptyRowState, encodeRowState, markDeleted } from "./merge.js";
import {
  PAIRING_CODE_TTL_MS,
  burnPairingCode,
  createPairingOffer,
  joinerReceiveM2,
  joinerStart,
  providerDecline,
  providerGrant,
  providerReceiveM1,
  providerReceiveM3,
  type PairingGrant,
} from "./pairing.js";
import { type CryptoPort } from "./port.js";
import { openRowFields, sealRowFields, type RowIdentity } from "./row.js";
import { createFakeCryptoPort, type FakeCryptoPort } from "./testing/fakeCryptoPort.js";
import { wrapKey } from "./wrap.js";

const NOW = 1_800_000_000_000;
const DESKTOP = "Lukin laptop";
const BROWSER = "Chrome na poslu";
const EMAIL = "luka@example.com";

const GRANT: PairingGrant = {
  profiles: [{ profileId: "profile-a", contentKey: bytesToBase64url(new Uint8Array(32).fill(0x31)) }],
};

/** Runs an honest handshake up to the point where the human is asked. */
async function upToConsent(port: CryptoPort, nowMs = NOW) {
  const offered = await createPairingOffer(port, {
    deviceName: DESKTOP,
    accountEmail: EMAIL,
    nowMs,
  });
  const start = await joinerStart(port, {
    pairingId: offered.record.pairingId,
    code: offered.code,
    deviceName: BROWSER,
    accountEmail: EMAIL,
  });
  if (!start.ok) throw new Error("joinerStart failed");
  const m1 = await providerReceiveM1(port, offered, start.m1, nowMs);
  if (!m1.ok) throw new Error(`providerReceiveM1 failed: ${m1.state.failure}`);
  const m2 = await joinerReceiveM2(port, start.state, m1.m2);
  if (!m2.ok) throw new Error(`joinerReceiveM2 failed: ${m2.state.failure}`);
  return { offered, awaitingConfirmation: m1.state, m3: m2.m3, joiner: m2.state };
}

describe("the code record is checked on the path that actually tests a guess", () => {
  it("refuses m3 for an offer that has already expired", async () => {
    // The header promises the code "lives 10 minutes". providerReceiveM1
    // enforced that; providerReceiveM3 never looked at the clock, so an
    // offer answered inside the window could be completed a week later.
    const port = createFakeCryptoPort({ seed: 41 });
    const run = await upToConsent(port);

    const late = await providerReceiveM3(
      port,
      run.awaitingConfirmation,
      run.m3,
      NOW + PAIRING_CODE_TTL_MS + 1,
    );
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.state.failure).toBe("code-expired");
  });

  it("refuses m3 against a record that is already burned — one guess means one guess", async () => {
    // The burn is what makes 65 bits enough: online guessing gets exactly one
    // attempt. But the states are immutable values, so a caller holding an
    // `awaiting-confirmation` state can call providerReceiveM3 again and again;
    // the only thing that stops it is the record, and providerReceiveM3 never
    // read the record at all.
    const port = createFakeCryptoPort({ seed: 42 });
    const run = await upToConsent(port);

    const spent = {
      ...run.awaitingConfirmation,
      record: burnPairingCode(run.awaitingConfirmation.record),
    };
    const retry = await providerReceiveM3(port, spent, run.m3, NOW);
    expect(retry.ok).toBe(false);
    if (retry.ok) return;
    expect(retry.state.failure).toBe("code-not-live");
  });
});

describe("a declined consent is enforced, not merely recorded", () => {
  it("refuses to grant after the human said no", async () => {
    // providerDecline returns a NEW failed state and burns the record inside
    // it; the `awaiting-consent` value it was given is untouched, because every
    // state here is an immutable value. providerGrant never read the record at
    // all, so the refusal was advisory: a caller holding both values could seal
    // the keys anyway. It reads the record now, which is the most a pure
    // function can do — and note precisely where the guarantee comes from.
    const port = createFakeCryptoPort({ seed: 43 });
    const run = await upToConsent(port);
    const consent = await providerReceiveM3(port, run.awaitingConfirmation, run.m3, NOW);
    if (!consent.ok) throw new Error("providerReceiveM3 failed");

    const declined = providerDecline(consent.state);
    expect(declined.record.state).toBe("burned");

    const anyway = await providerGrant(
      port,
      { ...consent.state, record: declined.record },
      GRANT,
      NOW,
    );
    expect(anyway.ok).toBe(false);
    if (anyway.ok) return;
    expect(anyway.state.failure).toBe("code-not-live");
  });

  it("still grants against a STALE record — the residual, pinned so it is not mistaken for safety", async () => {
    // The boundary of what this package can promise, asserted rather than
    // described, so that nobody reads the test above as "declines are safe" and
    // so that a future change to it is visible rather than silent.
    //
    // `PairingCodeRecord` is the only fact here meant to be persisted, and a
    // pure function can only judge the record it is handed. Merging decline and
    // grant into one call would not help: the same caller could pass the same
    // stale state to the merged function twice. So the rule is an OBLIGATION on
    // the desktop's pairing session store — keep one authoritative record per
    // pairingId, write back what every transition returns — and the package's
    // half is to check that record at every transition, which it now does at
    // m1, m3 and grant.
    const port = createFakeCryptoPort({ seed: 53 });
    const run = await upToConsent(port);
    const consent = await providerReceiveM3(port, run.awaitingConfirmation, run.m3, NOW);
    if (!consent.ok) throw new Error("providerReceiveM3 failed");

    providerDecline(consent.state);
    // The caller's own copy was never touched — values cannot be spent.
    expect(consent.state.record.state).toBe("live");
    const stale = await providerGrant(port, consent.state, GRANT, NOW);
    expect(stale.ok).toBe(true);
  });

  it("refuses to grant twice off one consent", async () => {
    const port = createFakeCryptoPort({ seed: 44 });
    const run = await upToConsent(port);
    const consent = await providerReceiveM3(port, run.awaitingConfirmation, run.m3, NOW);
    if (!consent.ok) throw new Error("providerReceiveM3 failed");

    const first = await providerGrant(port, consent.state, GRANT, NOW);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await providerGrant(
      port,
      { ...consent.state, record: first.state.record },
      GRANT,
      NOW,
    );
    expect(second.ok).toBe(false);
  });

  it("refuses a grant this package would not accept at the other end", async () => {
    // providerGrant serialised whatever it was handed, and decodeGrant then
    // refused it at the joiner — so a malformed grant became a
    // "payload-open-failed" on the browser, which reads to the user as an
    // attack. The two ends must agree about what a grant is, and the desktop
    // is where a caller bug should surface.
    const port = createFakeCryptoPort({ seed: 45 });
    const run = await upToConsent(port);
    const consent = await providerReceiveM3(port, run.awaitingConfirmation, run.m3, NOW);
    if (!consent.ok) throw new Error("providerReceiveM3 failed");

    const shortKey: PairingGrant = {
      profiles: [{ profileId: "profile-a", contentKey: bytesToBase64url(new Uint8Array(16)) }],
    };
    await expect(providerGrant(port, consent.state, shortKey, NOW)).rejects.toThrow(TypeError);

    const duplicated: PairingGrant = {
      profiles: [
        { profileId: "p", contentKey: bytesToBase64url(new Uint8Array(32).fill(1)) },
        { profileId: "p", contentKey: bytesToBase64url(new Uint8Array(32).fill(2)) },
      ],
    };
    await expect(providerGrant(port, consent.state, duplicated, NOW)).rejects.toThrow(TypeError);
  });
});

describe("the low-order point re-check port.ts says this file makes", () => {
  /** A port that has forgotten RFC 7748 §6.1 — exactly what the re-check is for. */
  function permissivePort(base: FakeCryptoPort): CryptoPort {
    return {
      ...base,
      async x25519SharedSecret(): Promise<Uint8Array> {
        return new Uint8Array(32);
      },
    };
  }

  it("refuses an all-zero shared secret at the provider", async () => {
    const base = createFakeCryptoPort({ seed: 46 });
    const port = permissivePort(base);
    const offered = await createPairingOffer(port, {
      deviceName: DESKTOP,
      accountEmail: EMAIL,
      nowMs: NOW,
    });
    const start = await joinerStart(port, {
      pairingId: offered.record.pairingId,
      code: offered.code,
      deviceName: BROWSER,
      accountEmail: EMAIL,
    });
    if (!start.ok) throw new Error("joinerStart failed");

    const result = await providerReceiveM1(port, offered, start.m1, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.state.failure).toBe("bad-peer-public-key");
  });

  it("refuses an all-zero shared secret at the joiner", async () => {
    // Both halves matter. With the contributory check missing on either side,
    // a man in the middle that forces a low-order point removes the whole
    // Diffie-Hellman contribution and the handshake still completes — leaving
    // the 65-bit code as the only secret, which the file header says outright
    // is not enough on its own.
    const base = createFakeCryptoPort({ seed: 47 });
    const honest = await createPairingOffer(base, {
      deviceName: DESKTOP,
      accountEmail: EMAIL,
      nowMs: NOW,
    });
    const port = permissivePort(base);
    const start = await joinerStart(port, {
      pairingId: honest.record.pairingId,
      code: honest.code,
      deviceName: BROWSER,
      accountEmail: EMAIL,
    });
    if (!start.ok) throw new Error("joinerStart failed");
    const m1 = await providerReceiveM1(base, honest, start.m1, NOW);
    if (!m1.ok) throw new Error("providerReceiveM1 failed");

    const result = await joinerReceiveM2(port, start.state, m1.m2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.state.failure).toBe("bad-peer-public-key");
  });
});

describe("the account email the transcript binds is a real value", () => {
  it("refuses an offer with no account email — an empty binding binds nothing", async () => {
    const port = createFakeCryptoPort({ seed: 48 });
    await expect(
      createPairingOffer(port, { deviceName: DESKTOP, accountEmail: "  ", nowMs: NOW }),
    ).rejects.toThrow();
  });

  it("does not burn a live offer because the two sides spelled one address differently", async () => {
    // The desktop shows the server-attested address; the browser reports the
    // session it is signed in as. Nothing guaranteed those were the same
    // STRING, so "Luka@Example.com" against "luka@example.com" — one account —
    // produced a confirmation mismatch and spent the code.
    const port = createFakeCryptoPort({ seed: 49 });
    const offered = await createPairingOffer(port, {
      deviceName: DESKTOP,
      accountEmail: "Luka@Example.COM",
      nowMs: NOW,
    });
    const start = await joinerStart(port, {
      pairingId: offered.record.pairingId,
      code: offered.code,
      deviceName: BROWSER,
      accountEmail: " luka@example.com ",
    });
    if (!start.ok) throw new Error("joinerStart failed");
    const m1 = await providerReceiveM1(port, offered, start.m1, NOW);
    if (!m1.ok) throw new Error("providerReceiveM1 failed");

    const m2 = await joinerReceiveM2(port, start.state, m1.m2);
    expect(m2.ok).toBe(true);
  });

  it("still refuses two genuinely different addresses", async () => {
    const port = createFakeCryptoPort({ seed: 50 });
    const offered = await createPairingOffer(port, {
      deviceName: DESKTOP,
      accountEmail: EMAIL,
      nowMs: NOW,
    });
    const start = await joinerStart(port, {
      pairingId: offered.record.pairingId,
      code: offered.code,
      deviceName: BROWSER,
      accountEmail: "someone.else@example.com",
    });
    if (!start.ok) throw new Error("joinerStart failed");
    const m1 = await providerReceiveM1(port, offered, start.m1, NOW);
    if (!m1.ok) throw new Error("providerReceiveM1 failed");
    const m2 = await joinerReceiveM2(port, start.state, m1.m2);
    expect(m2.ok).toBe(false);
  });
});

describe("the browser's half of the web KDF", () => {
  const INPUT = {
    email: "Luka@Example.COM",
    password: "a-long-enough-web-password-1",
    params: WEB_KDF_PARAMS,
  } as const;

  it("derives the same auth password as the desktop's function, and no wrap key", async () => {
    // The separation is only usable if the two functions agree: if the browser's
    // narrow function produced a different `authPassword`, nobody would use it
    // and K_wrap would go back to being derived in a tab. So the claim that they
    // are interchangeable for signing in is the load-bearing one, and it is
    // asserted here rather than asserted in a comment.
    const port = createFakeCryptoPort({ seed: 61 });
    const both = await deriveWebPasswordKeys(port, INPUT);
    const authOnly = await deriveWebAuthPassword(port, INPUT);

    expect(authOnly).toBe(both.authPassword);
    // And the narrow one hands back a string, so there is no K_wrap in the
    // browser's hands to open the server-held master-key wrap with. That MK
    // never enters a browser is a property of WHICH FUNCTION the web bundle
    // imports; this test pins the shape that makes the rule checkable.
    expect(typeof authOnly).toBe("string");
    expect(both.wrapKey).toHaveLength(32);
    expect(bytesToBase64url(both.wrapKey)).not.toBe(both.authPassword);
  });

  it("refuses an address change that changes nothing", async () => {
    // A re-wrap under an identically-derived key spends a live wrap for no
    // reason, and — if the caller then treated it as a successful change — would
    // look exactly like a change that worked.
    const port = createFakeCryptoPort({ seed: 62 });
    const keys = await deriveWebPasswordKeys(port, INPUT);
    const sealed = await wrapKey(port, keys.wrapKey, new Uint8Array(32).fill(0xab), {
      purpose: "mk/web-password",
      userId: "user-1",
    });

    await expect(
      rewrapMasterKeyForEmailChange(port, {
        sealed,
        userId: "user-1",
        currentEmail: "Luka@Example.COM",
        nextEmail: "  luka@example.com ",
        password: INPUT.password,
        params: WEB_KDF_PARAMS,
      }),
    ).rejects.toThrow(SyncCryptoError);
  });
});

describe("the device name shown on the consent screen", () => {
  /** The peer's name, as it reaches the provider inside m1. */
  async function offerAgainst(port: FakeCryptoPort, joinerDeviceName: string) {
    const offered = await createPairingOffer(port, {
      deviceName: DESKTOP,
      accountEmail: EMAIL,
      nowMs: NOW,
    });
    const start = await joinerStart(port, {
      pairingId: offered.record.pairingId,
      code: offered.code,
      deviceName: BROWSER,
      accountEmail: EMAIL,
    });
    if (!start.ok) throw new Error("joinerStart failed");
    return providerReceiveM1(port, offered, { ...start.m1, deviceName: joinerDeviceName }, NOW);
  }

  it("refuses a bidi override — the classic way to make a dialog say the opposite", async () => {
    // The comment on CONTROL_CHARACTERS named "a bidi-adjacent control
    // character" as the thing it was stopping, and then matched only C0, C1 and
    // DEL. U+202E RIGHT-TO-LEFT OVERRIDE is none of those: it renders the rest
    // of the string backwards, so a peer can put the reassuring half of a
    // sentence where the alarming half will be read. This is the single
    // highest-stakes string in the product — it is what the human is looking at
    // when they release profile content keys.
    const port = createFakeCryptoPort({ seed: 54 });
    const spoofed = await offerAgainst(port, "Chrome \u202Eelbasid ytiruces");
    expect(spoofed.ok).toBe(false);
    if (spoofed.ok) return;
    expect(spoofed.state.failure).toBe("malformed-message");
  });

  it("refuses zero-width and invisible formatting characters", async () => {
    for (const name of ["Chrome\u200Bna\u200Bposlu", "Chrome\uFEFF", "Chrome\u2066x\u2069"]) {
      const result = await offerAgainst(createFakeCryptoPort({ seed: 55 }), name);
      expect(result.ok).toBe(false);
    }
  });

  it("refuses a name that renders as nothing at all", async () => {
    // Non-empty, no control characters, and a blank line on the dialog where
    // the peer's identity is supposed to be.
    const port = createFakeCryptoPort({ seed: 57 });
    const blank = await offerAgainst(port, "   ");
    expect(blank.ok).toBe(false);
    await expect(
      createPairingOffer(port, { deviceName: "  ", accountEmail: EMAIL, nowMs: NOW }),
    ).rejects.toThrow(TypeError);
  });

  it("still accepts an ordinary name with Serbian letters", async () => {
    const port = createFakeCryptoPort({ seed: 58 });
    const ok = await offerAgainst(port, "Lukin računar — kancelarija");
    expect(ok.ok).toBe(true);
  });
});

describe("formatHlc's fixed width is enforced, not assumed", () => {
  it("refuses a stamp too wide for the format instead of emitting one", () => {
    // The whole claim of the string form is that lexicographic order equals
    // compareHlc, so SQLite can ORDER BY the column. A 13-digit wall field
    // silently inverts that: 2^49 sorts BEFORE 2^48-1 as a string, because "2"
    // precedes "f". Nothing rejected the stamp, and nothing had to construct
    // it dishonestly — `Hlc` is a plain interface any caller can build.
    const tooBig: Hlc = { wallMs: 2 ** 49, counter: 0, nodeId: "device-a" };
    const inRange: Hlc = { wallMs: 2 ** 48 - 1, counter: 0, nodeId: "device-a" };
    expect(compareHlc(tooBig, inRange)).toBe(1);
    expect(() => formatHlc(tooBig)).toThrow(TypeError);
    expect(() => formatHlc({ wallMs: 1, counter: 2 ** 32, nodeId: "device-a" })).toThrow(TypeError);
  });

  it("refuses a node id parseHlc could never read back", () => {
    // parseHlc's node-id group is `(.+)`, which does not match a newline, so a
    // stamp formatted with one round-trips to null — a row whose clock cannot
    // be re-read after storage.
    expect(() => formatHlc({ wallMs: 1, counter: 0, nodeId: "a\nb" })).toThrow(TypeError);
    expect(() => formatHlc({ wallMs: 1, counter: 0, nodeId: "" })).toThrow(TypeError);
  });

  it("still round-trips everything it accepts", () => {
    const stamp: Hlc = { wallMs: 2 ** 48 - 1, counter: 0xffffffff, nodeId: "desktop:win:01" };
    expect(parseHlc(formatHlc(stamp))).toEqual(stamp);
  });
});

describe("the tombstone is not stored twice with nothing comparing the copies", () => {
  const identity: RowIdentity = {
    userId: "user-1",
    profileId: "profile-a",
    collection: "tasks",
    objectId: "01J0000000000000000000000",
    version: 7,
    deleted: false,
  };

  it("refuses a plaintext whose tombstone disagrees with the authenticated envelope", async () => {
    // merge.ts leaves the version out of the plaintext precisely so two copies
    // cannot disagree — and then writes `deleted` into both the plaintext and
    // the AAD, with nothing comparing them. A peer holding CK_p could seal a
    // row the server files as live and every client merges as deleted.
    const port = createFakeCryptoPort({ seed: 51 });
    const stamp: Hlc = { wallMs: NOW, counter: 0, nodeId: "device-a" };
    const row = markDeleted(applyEdit(emptyRowState(stamp), { title: "x" }, stamp), stamp);

    const sealed = await sealRowFields(port, new Uint8Array(32).fill(9), identity, encodeRowState(row));
    const wire = await openRowFields(port, new Uint8Array(32).fill(9), identity, sealed);

    expect(decodeRowState(wire, identity)).toBeNull();
    expect(decodeRowState(wire, { ...identity, deleted: true })).not.toBeNull();
  });

  it("takes the version from the envelope, exactly as before", async () => {
    const port = createFakeCryptoPort({ seed: 52 });
    const stamp: Hlc = { wallMs: NOW, counter: 0, nodeId: "device-a" };
    const row = applyEdit(emptyRowState(stamp), { title: "x" }, stamp);

    const sealed = await sealRowFields(port, new Uint8Array(32).fill(9), identity, encodeRowState(row));
    const wire = await openRowFields(port, new Uint8Array(32).fill(9), identity, sealed);
    expect(decodeRowState(wire, identity)?.version).toBe(7);
  });
});
