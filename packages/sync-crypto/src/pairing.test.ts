import { beforeEach, describe, expect, it } from "vitest";
import { base64urlToBytes, bytesToBase64url, encodeStruct, utf8 } from "./bytes.js";
import {
  PAIRING_CODE_DIGITS,
  PAIRING_CODE_TTL_MS,
  createPairingOffer,
  formatPairingCode,
  generatePairingCode,
  generatePairingId,
  joinerOpenPayload,
  joinerReceiveM2,
  joinerStart,
  normalizePairingCode,
  parsePairingM1,
  parsePairingM2,
  parsePairingM3,
  parseSealedPairingPayload,
  providerDecline,
  providerGrant,
  providerReceiveM1,
  providerReceiveM3,
  type JoinerAwaitingPayload,
  type PairingGrant,
  type PairingM1,
  type ProviderAwaitingConsent,
  type ProviderDelivered,
  type ProviderGrantResult,
  type SealedPairingPayload,
} from "./pairing.js";
import { AEAD_NONCE_BYTES } from "./port.js";
import { createFakeCryptoPort, type FakeCryptoPort } from "./testing/fakeCryptoPort.js";

/**
 * Unwraps a grant that is expected to succeed. `providerGrant` can now refuse —
 * a spent or expired record — so the happy-path tests say so once here instead
 * of carrying an `if (!ok)` guard apiece.
 */
function unwrapGrant(result: ProviderGrantResult): {
  readonly state: ProviderDelivered;
  readonly payload: SealedPairingPayload;
} {
  if (!result.ok) throw new Error(`providerGrant refused: ${result.state.failure}`);
  return { state: result.state, payload: result.payload };
}

const NOW = 1_800_000_000_000;
const DESKTOP = "Lukin laptop";
const BROWSER = "Chrome na poslu";
const EMAIL = "luka@example.com";

const GRANT: PairingGrant = {
  profiles: [
    { profileId: "profile-a", contentKey: bytesToBase64url(new Uint8Array(32).fill(0x31)) },
    { profileId: "profile-b", contentKey: bytesToBase64url(new Uint8Array(32).fill(0x32)) },
  ],
};

let port: FakeCryptoPort;

beforeEach(() => {
  port = createFakeCryptoPort({ seed: 99 });
});

/** Drives a full, honest handshake and hands back every intermediate value. */
async function runHandshake(options: { readonly nowMs?: number } = {}) {
  const nowMs = options.nowMs ?? NOW;
  const offered = await createPairingOffer(port, {
    deviceName: DESKTOP,
    accountEmail: EMAIL,
    nowMs,
  });

  const start = await joinerStart(port, {
    pairingId: offered.record.pairingId,
    code: formatPairingCode(offered.code),
    deviceName: BROWSER,
    accountEmail: EMAIL,
  });
  if (!start.ok) throw new Error("joinerStart failed unexpectedly");

  const m1Result = await providerReceiveM1(port, offered, start.m1, nowMs);
  if (!m1Result.ok) throw new Error(`providerReceiveM1 failed: ${m1Result.state.failure}`);

  const m2Result = await joinerReceiveM2(port, start.state, m1Result.m2);
  if (!m2Result.ok) throw new Error(`joinerReceiveM2 failed: ${m2Result.state.failure}`);

  const m3Result = await providerReceiveM3(port, m1Result.state, m2Result.m3, nowMs);
  if (!m3Result.ok) throw new Error(`providerReceiveM3 failed: ${m3Result.state.failure}`);

  return {
    offered,
    joinerStarted: start.state,
    m1: start.m1,
    m2: m1Result.m2,
    m3: m2Result.m3,
    providerAwaitingConfirmation: m1Result.state,
    providerConsent: m3Result.state,
    joinerAwaitingPayload: m2Result.state,
  };
}

describe("the pairing code", () => {
  it("is 13 Crockford digits — about 65 bits", () => {
    const code = generatePairingCode(port);
    expect(code).toHaveLength(PAIRING_CODE_DIGITS);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{13}$/);
    expect(PAIRING_CODE_DIGITS * 5).toBe(65);
  });

  it("displays as 5-4-4 so no group is a lone character", () => {
    expect(formatPairingCode("ABCDEFGHJKMNP")).toBe("ABCDE-FGHJ-KMNP");
  });

  it("accepts what a human types back: lower case, dashes, spaces, confusables", () => {
    const code = generatePairingCode(port);
    expect(normalizePairingCode(formatPairingCode(code).toLowerCase())).toBe(code);
    expect(normalizePairingCode(`  ${formatPairingCode(code)} `)).toBe(code);
    expect(normalizePairingCode("oil0000000000")).toBe("0110000000000");
    expect(normalizePairingCode("U000000000000")).toBeNull();
  });

  it("draws from the port, never from a global — 9 bytes for 65 bits", () => {
    const local = createFakeCryptoPort({ seed: 2 });
    const before = local.drawnBytes;
    generatePairingCode(local);
    expect(local.drawnBytes - before).toBe(9);
  });

  it("differs across calls", () => {
    expect(generatePairingCode(port)).not.toBe(generatePairingCode(port));
    expect(generatePairingId(port)).not.toBe(generatePairingId(port));
  });
});

describe("the happy path", () => {
  it("completes, agrees on the short authentication string, and delivers the grant", async () => {
    const run = await runHandshake();

    expect(run.providerConsent.sas).toMatch(/^\d{6}$/);
    expect(run.joinerAwaitingPayload.sas).toBe(run.providerConsent.sas);

    // Each side shows the human the OTHER side's name plus the account email.
    expect(run.providerConsent.peerDeviceName).toBe(BROWSER);
    expect(run.joinerAwaitingPayload.peerDeviceName).toBe(DESKTOP);
    expect(run.providerConsent.accountEmail).toBe(EMAIL);

    const granted = unwrapGrant(await providerGrant(port, run.providerConsent, GRANT, NOW));
    expect(granted.state.record.state).toBe("consumed");

    const opened = await joinerOpenPayload(port, run.joinerAwaitingPayload, granted.payload);
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.state.grant).toEqual(GRANT);
  });

  it("carries only content keys — the master key has no field to travel in", async () => {
    const run = await runHandshake();
    const granted = unwrapGrant(await providerGrant(port, run.providerConsent, GRANT, NOW));
    const opened = await joinerOpenPayload(port, run.joinerAwaitingPayload, granted.payload);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(Object.keys(opened.state.grant)).toEqual(["profiles"]);
    for (const profile of opened.state.grant.profiles) {
      expect(Object.keys(profile).sort()).toEqual(["contentKey", "profileId"]);
    }
  });

  it("burns nothing on the happy path until the grant consumes the code", async () => {
    const run = await runHandshake();
    expect(run.providerConsent.record.state).toBe("live");
  });

  it("gives a different short authentication string to every handshake", async () => {
    const first = await runHandshake();
    const second = await runHandshake();
    // If the SAS did not depend on the transcript, comparing it would prove
    // nothing and the check would be theatre.
    expect(second.providerConsent.sas).not.toBe(first.providerConsent.sas);
  });
});

describe("a wrong code", () => {
  it("fails at the joiner's check of m2 and burns the offer when m3 is attempted", async () => {
    const offered = await createPairingOffer(port, {
      deviceName: DESKTOP,
      accountEmail: EMAIL,
      nowMs: NOW,
    });
    const wrongCode = generatePairingCode(port);

    const start = await joinerStart(port, {
      pairingId: offered.record.pairingId,
      code: wrongCode,
      deviceName: BROWSER,
      accountEmail: EMAIL,
    });
    expect(start.ok).toBe(true);
    if (!start.ok) return;

    const m1Result = await providerReceiveM1(port, offered, start.m1, NOW);
    expect(m1Result.ok).toBe(true);
    if (!m1Result.ok) return;

    // The joiner cannot verify the provider's confirmation without the code.
    const m2Result = await joinerReceiveM2(port, start.state, m1Result.m2);
    expect(m2Result.ok).toBe(false);
    if (m2Result.ok) return;
    expect(m2Result.state.failure).toBe("confirmation-mismatch");

    // And a forged m3 sent anyway burns the offer.
    const m3Result = await providerReceiveM3(
      port,
      m1Result.state,
      {
        v: 1,
        pairingId: offered.record.pairingId,
        confirmation: bytesToBase64url(new Uint8Array(32).fill(0x00)),
      },
      NOW,
    );
    expect(m3Result.ok).toBe(false);
    if (m3Result.ok) return;
    expect(m3Result.state.failure).toBe("confirmation-mismatch");
    expect(m3Result.state.record.state).toBe("burned");
  });

  it("rejects a rendezvous handle of the wrong shape before any work is done", async () => {
    const start = await joinerStart(port, {
      pairingId: "not-a-pairing-id",
      code: generatePairingCode(port),
      deviceName: BROWSER,
      accountEmail: EMAIL,
    });
    expect(start.ok).toBe(false);
    if (start.ok) return;
    expect(start.state.failure).toBe("malformed-message");
  });

  it("rejects a code that is not 13 Crockford digits before any work is done", async () => {
    const offered = await createPairingOffer(port, {
      deviceName: DESKTOP,
      accountEmail: EMAIL,
      nowMs: NOW,
    });
    const start = await joinerStart(port, {
      pairingId: offered.record.pairingId,
      code: "nope",
      deviceName: BROWSER,
      accountEmail: EMAIL,
    });
    expect(start.ok).toBe(false);
    if (start.ok) return;
    expect(start.state.failure).toBe("bad-code-format");
  });
});

describe("a tampered transcript", () => {
  it("is caught when a man in the middle rewrites the joiner's device name", async () => {
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

    // The desktop will show the human "Evil laptop" and confirm over that
    // name; the browser confirms over its own. The two transcripts differ.
    const tampered: PairingM1 = { ...start.m1, deviceName: "Evil laptop" };
    const m1Result = await providerReceiveM1(port, offered, tampered, NOW);
    if (!m1Result.ok) throw new Error("providerReceiveM1 failed");

    const m2Result = await joinerReceiveM2(port, start.state, m1Result.m2);
    expect(m2Result.ok).toBe(false);
    if (m2Result.ok) return;
    expect(m2Result.state.failure).toBe("confirmation-mismatch");
  });

  it("is caught when the provider's nonce is rewritten in flight", async () => {
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
    const m1Result = await providerReceiveM1(port, offered, start.m1, NOW);
    if (!m1Result.ok) throw new Error("providerReceiveM1 failed");

    const bytes = base64urlToBytes(m1Result.m2.nonce) as Uint8Array;
    bytes[0] = (bytes[0] as number) ^ 0x01;
    const m2Result = await joinerReceiveM2(port, start.state, {
      ...m1Result.m2,
      nonce: bytesToBase64url(bytes),
    });
    expect(m2Result.ok).toBe(false);
    if (m2Result.ok) return;
    expect(m2Result.state.failure).toBe("confirmation-mismatch");
  });

  it("is caught when the two sides disagree about the account email", async () => {
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
    const m1Result = await providerReceiveM1(port, offered, start.m1, NOW);
    if (!m1Result.ok) throw new Error("providerReceiveM1 failed");
    const m2Result = await joinerReceiveM2(port, start.state, m1Result.m2);
    expect(m2Result.ok).toBe(false);
  });
});

describe("reflection", () => {
  it("refuses the provider's own confirmation bounced back as the joiner's", async () => {
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
    const m1Result = await providerReceiveM1(port, offered, start.m1, NOW);
    if (!m1Result.ok) throw new Error("providerReceiveM1 failed");

    const reflected = await providerReceiveM3(
      port,
      m1Result.state,
      { v: 1, pairingId: offered.record.pairingId, confirmation: m1Result.m2.confirmation },
      NOW,
    );
    expect(reflected.ok).toBe(false);
    if (reflected.ok) return;
    expect(reflected.state.failure).toBe("confirmation-mismatch");
    expect(reflected.state.record.state).toBe("burned");
  });

  it("refuses the joiner's own public key echoed back as the provider's", async () => {
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
    const m1Result = await providerReceiveM1(port, offered, start.m1, NOW);
    if (!m1Result.ok) throw new Error("providerReceiveM1 failed");

    const m2Result = await joinerReceiveM2(port, start.state, {
      ...m1Result.m2,
      publicKey: start.m1.publicKey,
    });
    expect(m2Result.ok).toBe(false);
    if (m2Result.ok) return;
    expect(m2Result.state.failure).toBe("bad-peer-public-key");
  });
});

describe("replay", () => {
  it("makes a recorded m3 useless against a second run of the same offer", async () => {
    const run = await runHandshake();

    // The provider's ephemeral pair and nonce are fresh per m1, so a second
    // run of the same offer has a different transcript.
    const second = await providerReceiveM1(port, run.offered, run.m1, NOW);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.m2.nonce).not.toBe(run.m2.nonce);
    expect(second.m2.publicKey).not.toBe(run.m2.publicKey);

    const replayed = await providerReceiveM3(port, second.state, run.m3, NOW);
    expect(replayed.ok).toBe(false);
    if (replayed.ok) return;
    expect(replayed.state.failure).toBe("confirmation-mismatch");
  });

  it("makes a recorded m1 useless against a fresh offer — a different code and id", async () => {
    const run = await runHandshake();
    const fresh = await createPairingOffer(port, {
      deviceName: DESKTOP,
      accountEmail: EMAIL,
      nowMs: NOW,
    });

    const result = await providerReceiveM1(port, fresh, run.m1, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.state.failure).toBe("pairing-id-mismatch");
    expect(result.state.record.state).toBe("burned");
  });

  it("makes a recorded payload useless against a second session", async () => {
    const first = await runHandshake();
    const granted = unwrapGrant(await providerGrant(port, first.providerConsent, GRANT, NOW));

    const second = await runHandshake();
    const opened = await joinerOpenPayload(port, second.joinerAwaitingPayload, granted.payload);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.state.failure).toBe("payload-open-failed");
  });
});

describe("two concurrent pairings on one account", () => {
  it("keeps the offers independent — the wrong code against the wrong offer fails", async () => {
    const offerA = await createPairingOffer(port, {
      deviceName: "Desktop A",
      accountEmail: EMAIL,
      nowMs: NOW,
    });
    const offerB = await createPairingOffer(port, {
      deviceName: "Desktop B",
      accountEmail: EMAIL,
      nowMs: NOW,
    });
    expect(offerB.record.pairingId).not.toBe(offerA.record.pairingId);
    expect(offerB.code).not.toBe(offerA.code);

    // A's code typed against B's offer: B answers, but its confirmation is
    // computed under B's code and the joiner cannot verify it.
    const start = await joinerStart(port, {
      pairingId: offerB.record.pairingId,
      code: offerA.code,
      deviceName: BROWSER,
      accountEmail: EMAIL,
    });
    if (!start.ok) throw new Error("joinerStart failed");
    const m1Result = await providerReceiveM1(port, offerB, start.m1, NOW);
    if (!m1Result.ok) throw new Error("providerReceiveM1 failed");
    const m2Result = await joinerReceiveM2(port, start.state, m1Result.m2);
    expect(m2Result.ok).toBe(false);

    // A's own pairing still completes: burning B did not touch A.
    const honest = await joinerStart(port, {
      pairingId: offerA.record.pairingId,
      code: offerA.code,
      deviceName: BROWSER,
      accountEmail: EMAIL,
    });
    if (!honest.ok) throw new Error("joinerStart failed");
    const honestM1 = await providerReceiveM1(port, offerA, honest.m1, NOW);
    expect(honestM1.ok).toBe(true);
    if (!honestM1.ok) return;
    const honestM2 = await joinerReceiveM2(port, honest.state, honestM1.m2);
    expect(honestM2.ok).toBe(true);
  });

  it("refuses a message routed to the wrong offer", async () => {
    const offerA = await createPairingOffer(port, {
      deviceName: "Desktop A",
      accountEmail: EMAIL,
      nowMs: NOW,
    });
    const offerB = await createPairingOffer(port, {
      deviceName: "Desktop B",
      accountEmail: EMAIL,
      nowMs: NOW,
    });
    const start = await joinerStart(port, {
      pairingId: offerA.record.pairingId,
      code: offerA.code,
      deviceName: BROWSER,
      accountEmail: EMAIL,
    });
    if (!start.ok) throw new Error("joinerStart failed");

    const result = await providerReceiveM1(port, offerB, start.m1, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.state.failure).toBe("pairing-id-mismatch");
  });
});

describe("the code record", () => {
  it("expires exactly at the ten-minute mark", async () => {
    const offered = await createPairingOffer(port, {
      deviceName: DESKTOP,
      accountEmail: EMAIL,
      nowMs: NOW,
    });
    expect(offered.record.expiresAtMs).toBe(NOW + PAIRING_CODE_TTL_MS);

    const start = await joinerStart(port, {
      pairingId: offered.record.pairingId,
      code: offered.code,
      deviceName: BROWSER,
      accountEmail: EMAIL,
    });
    if (!start.ok) throw new Error("joinerStart failed");

    const atEdge = await providerReceiveM1(port, offered, start.m1, NOW + PAIRING_CODE_TTL_MS);
    expect(atEdge.ok).toBe(true);

    const past = await providerReceiveM1(port, offered, start.m1, NOW + PAIRING_CODE_TTL_MS + 1);
    expect(past.ok).toBe(false);
    if (past.ok) return;
    expect(past.state.failure).toBe("code-expired");
    expect(past.state.record.state).toBe("burned");
  });

  it("is single use: a burned or consumed record is never usable again", async () => {
    const run = await runHandshake();
    const granted = unwrapGrant(await providerGrant(port, run.providerConsent, GRANT, NOW));

    const reused = await providerReceiveM1(
      port,
      { ...run.offered, record: granted.state.record },
      run.m1,
      NOW,
    );
    expect(reused.ok).toBe(false);
    if (reused.ok) return;
    expect(reused.state.failure).toBe("code-not-live");
  });

  it("burns on a declined consent — the human said no, the code is spent", async () => {
    const run = await runHandshake();
    const declined = providerDecline(run.providerConsent);
    expect(declined.failure).toBe("consent-declined");
    expect(declined.record.state).toBe("burned");
  });
});

describe("a bad public key", () => {
  it("refuses an all-zero X25519 point — the low-order attack", async () => {
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

    const result = await providerReceiveM1(
      port,
      offered,
      { ...start.m1, publicKey: bytesToBase64url(new Uint8Array(32)) },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.state.failure).toBe("bad-peer-public-key");
  });

  it("separates a malformed message from a bad key, so the log says which", async () => {
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

    const shortNonce = await providerReceiveM1(
      port,
      offered,
      { ...start.m1, nonce: bytesToBase64url(new Uint8Array(16)) },
      NOW,
    );
    expect(shortNonce.ok).toBe(false);
    if (shortNonce.ok) return;
    expect(shortNonce.state.failure).toBe("malformed-message");

    const controlName = await providerReceiveM1(
      port,
      offered,
      { ...start.m1, deviceName: "Chrome\nAllow this device" },
      NOW,
    );
    expect(controlName.ok).toBe(false);
    if (controlName.ok) return;
    expect(controlName.state.failure).toBe("malformed-message");
  });

  it("refuses a public key of the wrong length", async () => {
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

    const result = await providerReceiveM1(
      port,
      offered,
      { ...start.m1, publicKey: bytesToBase64url(new Uint8Array(31)) },
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.state.failure).toBe("bad-peer-public-key");
  });
});

describe("the sealed payload", () => {
  it("refuses an edited payload", async () => {
    const run = await runHandshake();
    const granted = unwrapGrant(await providerGrant(port, run.providerConsent, GRANT, NOW));
    const bytes = base64urlToBytes(granted.payload.ciphertext) as Uint8Array;
    bytes[0] = (bytes[0] as number) ^ 0x01;

    const opened = await joinerOpenPayload(port, run.joinerAwaitingPayload, {
      ...granted.payload,
      ciphertext: bytesToBase64url(bytes),
    });
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.state.failure).toBe("payload-open-failed");
  });

  /**
   * Seals an arbitrary grant body under the joiner's own session key, the way a
   * COMPROMISED provider would — bypassing `providerGrant`'s own validation.
   * That is the threat `decodeGrant` exists for: the browser must refuse a
   * malformed grant even when the thing on the other end never runs our code.
   */
  async function sealHostileGrant(
    state: JoinerAwaitingPayload,
    body: unknown,
  ): Promise<SealedPairingPayload> {
    const nonce = port.randomBytes(AEAD_NONCE_BYTES);
    const ciphertext = await port.aeadSeal({
      key: state.sessionKey,
      nonce,
      plaintext: utf8(JSON.stringify(body)),
      aad: encodeStruct([utf8("nexus/sync/pair/payload/v1"), state.transcript]),
    });
    return { v: 1, nonce: bytesToBase64url(nonce), ciphertext: bytesToBase64url(ciphertext) };
  }

  it("refuses a grant naming one profile twice, even from a compromised provider", async () => {
    const run = await runHandshake();
    const key = bytesToBase64url(new Uint8Array(32).fill(0x31));
    const payload = await sealHostileGrant(run.joinerAwaitingPayload, {
      p: [
        { i: "profile-a", k: key },
        { i: "profile-a", k: bytesToBase64url(new Uint8Array(32).fill(0x32)) },
      ],
    });
    const opened = await joinerOpenPayload(port, run.joinerAwaitingPayload, payload);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.state.failure).toBe("payload-open-failed");
  });

  it("refuses a content key that is not 32 bytes, even from a compromised provider", async () => {
    const run = await runHandshake();
    const payload = await sealHostileGrant(run.joinerAwaitingPayload, {
      p: [{ i: "profile-a", k: bytesToBase64url(new Uint8Array(16)) }],
    });
    const opened = await joinerOpenPayload(port, run.joinerAwaitingPayload, payload);
    expect(opened.ok).toBe(false);
  });

  it("refuses a grant carrying a field this version does not understand", async () => {
    const run = await runHandshake();
    const payload = await sealHostileGrant(run.joinerAwaitingPayload, {
      p: [{ i: "profile-a", k: bytesToBase64url(new Uint8Array(32).fill(1)) }],
      masterKey: bytesToBase64url(new Uint8Array(32).fill(7)),
    });
    const opened = await joinerOpenPayload(port, run.joinerAwaitingPayload, payload);
    expect(opened.ok).toBe(false);
  });

  it("refuses a malformed payload without reaching the AEAD", async () => {
    const run = await runHandshake();
    const opened = await joinerOpenPayload(port, run.joinerAwaitingPayload, {
      v: 1,
      nonce: "%%%",
      ciphertext: "%%%",
    });
    expect(opened.ok).toBe(false);
  });
});

describe("message parsers", () => {
  it("accept what the handshake produced after a JSON round trip", async () => {
    const run = await runHandshake();
    const granted = unwrapGrant(await providerGrant(port, run.providerConsent, GRANT, NOW));
    const trip = <T>(value: T): unknown => JSON.parse(JSON.stringify(value)) as unknown;

    expect(parsePairingM1(trip(run.m1))).toEqual(run.m1);
    expect(parsePairingM2(trip(run.m2))).toEqual(run.m2);
    expect(parsePairingM3(trip(run.m3))).toEqual(run.m3);
    expect(parseSealedPairingPayload(trip(granted.payload))).toEqual(granted.payload);
  });

  it("reject the shapes a hostile transport would send", async () => {
    const run = await runHandshake();
    expect(parsePairingM1(null)).toBeNull();
    expect(parsePairingM1({ ...run.m1, v: 2 })).toBeNull();
    expect(parsePairingM1({ ...run.m1, extra: 1 })).toBeNull();
    expect(parsePairingM1({ ...run.m1, publicKey: bytesToBase64url(new Uint8Array(31)) })).toBeNull();
    expect(parsePairingM1({ ...run.m1, deviceName: "" })).toBeNull();
    expect(parsePairingM1({ ...run.m1, deviceName: "x".repeat(200) })).toBeNull();
    expect(parsePairingM2({ ...run.m2, confirmation: "%%%" })).toBeNull();
    expect(parsePairingM3({ ...run.m3, pairingId: 7 })).toBeNull();
  });
});

describe("the state machine forbids a wrong transition", () => {
  it("has no function that accepts a terminal state", async () => {
    // Compile-time, not runtime: `providerGrant` takes ProviderAwaitingConsent
    // and nothing else, so a `delivered` or `failed` state cannot be passed to
    // it, and `joinerOpenPayload` cannot be handed a `complete` state. The
    // assertions below only pin the phases those types carry.
    const run = await runHandshake();
    const consent: ProviderAwaitingConsent = run.providerConsent;
    const awaiting: JoinerAwaitingPayload = run.joinerAwaitingPayload;
    expect(consent.phase).toBe("awaiting-consent");
    expect(awaiting.phase).toBe("awaiting-payload");

    const granted = unwrapGrant(await providerGrant(port, consent, GRANT, NOW));
    expect(granted.state.phase).toBe("delivered");
    const opened = await joinerOpenPayload(port, awaiting, granted.payload);
    expect(opened.state.phase).toBe("complete");
  });
});
