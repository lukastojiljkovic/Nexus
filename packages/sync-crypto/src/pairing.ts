/**
 * Device pairing: how a browser that is already signed in to the account gets
 * the content keys of the profiles the user marked web-enabled — without the
 * master key ever entering it, and without a hostile server being able to
 * insert itself.
 *
 * **Nothing in this file performs I/O.** Each step is a pure function that
 * takes a state and an incoming message and returns a new state and an
 * outgoing message; the transport — a Supabase table, a channel, a polled
 * endpoint — is entirely the caller's, and is injected in the only sense that
 * matters, by not being here. That is what makes replay, reflection and a
 * tampered transcript testable as ordinary function calls.
 *
 * ─── The shape of it ────────────────────────────────────────────────────────
 *
 * The DESKTOP is the `provider`: it is the side that holds MK, and it is the
 * side that GENERATES the 13-character code. The BROWSER is the `joiner`: the
 * human reads the code off the desktop screen and types it into the browser.
 * That direction is not arbitrary. A code generated in the browser and typed
 * into the desktop would mean the browser chooses the secret, and a browser is
 * the more exposed of the two environments; and the final consent has to happen
 * on the side that owns the keys, which is the desktop.
 *
 * **The code is not a bearer token.** Possessing it does not entitle anyone to
 * anything. It authorises exactly one run of a handshake:
 *
 *   K_pair = Argon2id(code, salt = SHA-256("nexus/sync/pair-salt/v1" ‖ pairingId))
 *
 *   m1  joiner   → provider   pairingId, X25519 public key, 32-byte nonce, device name
 *   m2  provider → joiner     X25519 public key, nonce, device name, confirm_provider
 *   m3  joiner   → provider   confirm_joiner
 *              ── human consent, in the desktop MAIN process, behind the
 *                 account passcode, showing the peer's device name, the
 *                 server-attested account email and the SAS ──
 *   payload provider → joiner  the wrapped grant, sealed under K_session
 *
 *   transcript = SHA-256(everything both sides said, length-framed)
 *   ikm        = K_pair ‖ X25519(ephemeral, ephemeral)
 *   K_session / K_confirm / K_sas = HKDF(ikm, salt = transcript, distinct infos)
 *
 * Two ingredients, and the protocol needs both. The ephemeral X25519 exchange
 * gives forward secrecy: recording the traffic and later learning the code
 * reveals nothing, because the ephemeral scalars are gone. The pairing code
 * gives authentication: a man in the middle can run two Diffie-Hellmans, but it
 * cannot compute K_confirm without the code, so its confirmation MAC fails and
 * both sides stop. Neither alone is enough — ECDH alone is unauthenticated, and
 * a code alone is a bearer token.
 *
 * The two confirmations use DIFFERENT domain labels. That is the whole defence
 * against REFLECTION: without it, an attacker could take the provider's
 * confirmation out of m2 and send it straight back as m3, and the provider —
 * which is checking a MAC it computed itself — would accept its own words as
 * proof that someone else knew the code.
 *
 * The transcript covers the pairing id, both public keys, both nonces, both
 * device names and the account email. Anything an attacker rewrites in flight
 * lands in one side's transcript and not the other's, and the confirmation
 * fails. That includes the device name the human is about to be shown, which is
 * the point: the consent screen must not be able to say "Chrome na poslu" while
 * the key goes somewhere else.
 *
 * ─── Why 65 bits is enough, and what makes it enough ────────────────────────
 *
 * 13 Crockford digits is ~65 bits. On its own that would be weak for an offline
 * attack, and the transcript IS an offline verifier — anyone who records m2 can
 * test a candidate code against confirm_provider. Three things make it hold:
 * the code lives 10 minutes, it is single-use, and **it is burned on the first
 * verification failure**, so online guessing gets exactly one attempt. Against
 * offline guessing, K_pair is Argon2id at 64 MiB — 2^65 candidates each costing
 * 64 MiB of memory-hard work is not a computation anyone performs, and the
 * answer is worthless ten minutes later anyway.
 *
 * ─── The pairing id is public, and the burn is a real trade-off ─────────────
 *
 * `pairingId` is a random 128-bit rendezvous handle. It is NOT derived from the
 * code — deriving a public value from a 65-bit secret would hand an attacker an
 * offline oracle with no Argon2id in front of it. The joiner learns it from the
 * transport: the server lists the live offers for the account the browser is
 * already authenticated as, which is metadata it already holds.
 *
 * The consequence, stated rather than hidden: **anyone who can reach the
 * rendezvous can burn a live offer** by sending one wrong message. That is a
 * denial of service costing the user two seconds and a new code, and it leaks
 * nothing. The alternative — allowing several attempts per offer — trades that
 * nuisance for a multiplied online guessing budget against a 65-bit secret.
 * One attempt is the right side of that trade. It does mean the desktop should
 * keep at most one live offer at a time, so the joiner never has to guess which
 * of several to answer.
 *
 * ─── The state machine ──────────────────────────────────────────────────────
 *
 * Each phase is its own TYPE, and each transition function accepts only the
 * phase it is valid from. `providerGrant` takes a `ProviderAwaitingConsent`;
 * there is no way to hand it an offer that has not been confirmed, or a session
 * that already delivered, because those are different types and the compiler
 * says so. The two terminal phases — `delivered` and `failed` — appear in no
 * function's parameter list at all, so a wrong transition is not "unlikely",
 * it does not compile.
 *
 * ─── What the types CANNOT do, and the one obligation that follows ──────────
 *
 * Every state here is an immutable value, and a value cannot be spent. Nothing
 * stops a caller keeping an `awaiting-confirmation` state and handing it to
 * `providerReceiveM3` a hundred times, or keeping an `awaiting-consent` state
 * that the human has just REFUSED and handing it to `providerGrant` anyway —
 * `providerDecline` returns a new failed state and leaves the one it was given
 * exactly as it was.
 *
 * So the single-use rule cannot live in the types. It lives in the
 * `PairingCodeRecord`, which is the one thing here that is meant to be
 * persisted, and it is enforced by **every provider transition checking the
 * record before doing anything**: `providerReceiveM1`, `providerReceiveM3` and
 * `providerGrant` all call {@link pairingCodeProblem} first, and every failure
 * is built by one private helper that burns on the way through. That leaves the
 * caller exactly one obligation, and it is worth stating in one sentence
 * because everything above depends on it:
 *
 *   **Keep one authoritative `PairingCodeRecord` per `pairingId`, write back
 *   the record every transition returns, and pass the current one in.**
 *
 * A caller that does that gets one online guess at the code, a ten-minute life
 * and a refusal that means refused. A caller that keeps a stale copy gets none
 * of it, and no type in this file can tell it so.
 */

import {
  base64urlToBytes,
  bytesToBase64url,
  concatBytes,
  constantTimeEqual,
  encodeStruct,
  fromUtf8,
  utf8,
} from "./bytes.js";
import { encodeCrockford, groupCrockford, normalizeCrockford } from "./crockford.js";
import { canonicalJson, isJsonObject, parseJsonValue, type JsonValue } from "./json.js";
import { normalizeWebEmail } from "./kdf.js";
import {
  AEAD_KEY_BYTES,
  AEAD_NONCE_BYTES,
  AEAD_TAG_BYTES,
  SHA256_BYTES,
  X25519_PUBLIC_KEY_BYTES,
  type Argon2idParams,
  type CryptoPort,
  type X25519SecretKey,
} from "./port.js";

/** 13 × 5 bits = 65 bits of entropy in the code a human retypes. */
export const PAIRING_CODE_DIGITS = 13;

/** Displayed as 5-4-4 (`groupCrockford` absorbs the leftover into the first group). */
const PAIRING_CODE_GROUP = 4;

/** Ten minutes. Long enough to walk to the other machine, short enough to matter. */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

/** 128 bits of rendezvous handle. Public; see the file header. */
const PAIRING_ID_BYTES = 16;

/** Each side contributes 32 bytes of freshness so neither can fix the transcript alone. */
const PAIRING_NONCE_BYTES = 32;

/** Six decimal digits — ~20 bits, read aloud or compared by eye. */
export const PAIRING_SAS_DIGITS = 6;

/** A device name has to fit on a consent screen and must not be a payload. */
const MAX_DEVICE_NAME_LENGTH = 120;

/**
 * Every Unicode control (`Cc`: C0, C1, DEL) and every Unicode FORMAT character
 * (`Cf`), which is the category the interesting attacks live in.
 *
 * A device name is rendered to a human who is about to authorise a key release.
 * It is the single highest-stakes string in the product, so what it may contain
 * is worth being exact about rather than approximate.
 *
 * `Cc` alone — a newline, a carriage return — only lets a peer break the layout.
 * `Cf` is the category that lets it change the MEANING:
 *
 *  - U+202E RIGHT-TO-LEFT OVERRIDE and friends (U+202A-U+202E, U+2066-U+2069)
 *    render the remainder of the string backwards, so the reassuring half of a
 *    sentence can be placed where the alarming half will be read.
 *  - U+200B ZERO WIDTH SPACE, U+FEFF and U+2060 WORD JOINER are invisible: they
 *    let two different names look identical, so "the device I recognise" and the
 *    one actually receiving the keys need not be the same device.
 *
 * Written as a Unicode property escape rather than a hand-kept range list,
 * because a hand-kept list is how U+202E was missed the first time: the comment
 * named "a bidi-adjacent control character" and the regex covered only C0, C1
 * and DEL, which is none of them.
 *
 * The known false positive, accepted deliberately: `Cf` also holds the Arabic
 * number signs (U+0600-U+0605) and U+00AD SOFT HYPHEN, so a device name
 * legitimately containing one is refused. Refusing a rare valid name costs a
 * rename; accepting an override on a consent dialog costs the keys.
 */
const UNRENDERABLE_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

/**
 * The same OWASP baseline the rest of the product uses. Argon2id here defends
 * a 65-bit secret against an offline attack on a recorded transcript; see the
 * file header on why 65 bits plus this cost plus a 10-minute life is enough.
 */
export const PAIRING_KDF_PARAMS: Argon2idParams = {
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
};

const PAIR_SALT_LABEL = "nexus/sync/pair-salt/v1";
const TRANSCRIPT_LABEL = "nexus/sync/pair/v1";
const SESSION_INFO = utf8("nexus/sync/pair/session/v1");
const CONFIRM_INFO = utf8("nexus/sync/pair/confirm/v1");
const SAS_INFO = utf8("nexus/sync/pair/sas/v1");
const CONFIRM_PROVIDER_LABEL = utf8("nexus/sync/pair/confirm/provider/v1");
const CONFIRM_JOINER_LABEL = utf8("nexus/sync/pair/confirm/joiner/v1");
const PAYLOAD_LABEL = "nexus/sync/pair/payload/v1";

// Note that HKDF's SALT here is the transcript, not the usual empty array: the
// session keys must be bound to everything both sides said, and binding it
// through the extract step means a rewritten message changes all three outputs
// rather than only the one whose `info` mentions it.

// ── Failures ────────────────────────────────────────────────────────────────

/**
 * Every way a pairing can end badly. A closed union, and deliberately NOT an
 * exception type: a failed handshake is a state with a screen behind it, not
 * something to unwind the stack over.
 */
export type PairingFailure =
  /** The typed code is not 13 Crockford digits. Nothing was attempted. */
  | "bad-code-format"
  /** The offer is older than {@link PAIRING_CODE_TTL_MS}. */
  | "code-expired"
  /** The offer was already burned or already consumed. Single use means single use. */
  | "code-not-live"
  /** The message names a different offer — a mis-routed or replayed message. */
  | "pairing-id-mismatch"
  /** A field is the wrong shape, size or kind. The transport gave us rubbish. */
  | "malformed-message"
  /** The peer's X25519 key is the wrong length, our own key echoed back, or a low-order point. */
  | "bad-peer-public-key"
  /** A confirmation MAC did not verify: wrong code, tampered transcript, or reflection. */
  | "confirmation-mismatch"
  /** The sealed grant did not authenticate, or did not contain a grant. */
  | "payload-open-failed"
  /** The human at the desktop said no. */
  | "consent-declined";

// ── The code and its record ─────────────────────────────────────────────────

/** Live until it is used or fails; there is no way back from either. */
export type PairingCodeState = "live" | "burned" | "consumed";

/**
 * The persistable half of an offer. Holds no secret — the code itself lives in
 * the in-memory `ProviderOffered` state and never needs to be written down.
 */
export interface PairingCodeRecord {
  readonly pairingId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly state: PairingCodeState;
}

/** 65 random bits from the port, as 13 Crockford digits (canonical, ungrouped). */
export function generatePairingCode(port: CryptoPort): string {
  // 9 bytes is 72 bits; the encoder takes the first 65 and drops the rest.
  return encodeCrockford(port.randomBytes(9), PAIRING_CODE_DIGITS);
}

/** 128 random bits as base64url — the public rendezvous handle. */
export function generatePairingId(port: CryptoPort): string {
  return bytesToBase64url(port.randomBytes(PAIRING_ID_BYTES));
}

/** What the human typed, folded to canonical form, or `null` if it cannot be a code. */
export function normalizePairingCode(input: string): string | null {
  return normalizeCrockford(input, PAIRING_CODE_DIGITS);
}

/** The display form: `XXXXX-XXXX-XXXX`. */
export function formatPairingCode(canonical: string): string {
  return groupCrockford(canonical, PAIRING_CODE_GROUP);
}

/** `null` when the record may still be used, otherwise why it may not. */
export function pairingCodeProblem(
  record: PairingCodeRecord,
  nowMs: number,
): Extract<PairingFailure, "code-not-live" | "code-expired"> | null {
  if (record.state !== "live") return "code-not-live";
  if (nowMs > record.expiresAtMs) return "code-expired";
  return null;
}

/** Spent by failure. Terminal. */
export function burnPairingCode(record: PairingCodeRecord): PairingCodeRecord {
  return { ...record, state: "burned" };
}

/** Spent by success. Terminal. */
export function consumePairingCode(record: PairingCodeRecord): PairingCodeRecord {
  return { ...record, state: "consumed" };
}

// ── Messages ────────────────────────────────────────────────────────────────

/** joiner → provider. Every byte field is unpadded base64url. */
export interface PairingM1 {
  readonly v: 1;
  readonly pairingId: string;
  readonly publicKey: string;
  readonly nonce: string;
  readonly deviceName: string;
}

/** provider → joiner, carrying the provider's proof that it knows the code. */
export interface PairingM2 {
  readonly v: 1;
  readonly pairingId: string;
  readonly publicKey: string;
  readonly nonce: string;
  readonly deviceName: string;
  readonly confirmation: string;
}

/** joiner → provider, carrying the joiner's proof. */
export interface PairingM3 {
  readonly v: 1;
  readonly pairingId: string;
  readonly confirmation: string;
}

/** The sealed grant. Only ever produced after human consent. */
export interface SealedPairingPayload {
  readonly v: 1;
  readonly nonce: string;
  readonly ciphertext: string;
}

/**
 * What pairing actually delivers: one content key per web-enabled profile.
 *
 * **There is no field here for the master key**, and that is worth having: a
 * design where MK travels and a flag says "do not store it" fails the first
 * time someone misreads the flag. But it is a guard rail, not a proof, and the
 * difference matters. MK is 32 bytes and so is a content key, so nothing in
 * this type or in `assertGrant` can tell them apart — a caller that put MK in a
 * `contentKey` slot would be obeyed. What actually keeps MK out of a browser is
 * the desktop code that ASSEMBLES this value: it must read only wraps of
 * purpose `ck/master-key`, one per web-enabled profile, and never touch the
 * master-key wraps at all.
 *
 * A profile the user kept local-only IS enforced structurally, one layer up in
 * `wrap.ts`: its CK_p was never wrapped under MK, so there is no ciphertext for
 * the desktop to open and nothing to put in a grant even if asked. That is the
 * shape the master key's own protection should be measured against.
 */
export interface PairingGrant {
  readonly profiles: readonly PairingGrantProfile[];
}

/** One profile's content key, base64url over 32 bytes. */
export interface PairingGrantProfile {
  readonly profileId: string;
  readonly contentKey: string;
}

// ── States ──────────────────────────────────────────────────────────────────

/** The desktop has shown a code and is waiting for a browser to answer. */
export interface ProviderOffered {
  readonly phase: "offered";
  readonly record: PairingCodeRecord;
  /** Canonical; show `formatPairingCode(code)`. Held only to be displayed. */
  readonly code: string;
  /** Derived once, at offer time, so the m1 path is not paying Argon2id under a timer. */
  readonly pairKey: Uint8Array;
  readonly deviceName: string;
  readonly accountEmail: string;
}

/** m1 answered; waiting for the joiner to prove it knows the code too. */
export interface ProviderAwaitingConfirmation {
  readonly phase: "awaiting-confirmation";
  readonly record: PairingCodeRecord;
  readonly transcript: Uint8Array;
  readonly sessionKey: Uint8Array;
  readonly expectedJoinerConfirmation: Uint8Array;
  readonly sas: string;
  readonly peerDeviceName: string;
  readonly accountEmail: string;
}

/** Both sides proved knowledge of the code. Nothing has been released yet. */
export interface ProviderAwaitingConsent {
  readonly phase: "awaiting-consent";
  readonly record: PairingCodeRecord;
  readonly transcript: Uint8Array;
  readonly sessionKey: Uint8Array;
  /** Show these three to the human, in the main process, behind the passcode. */
  readonly sas: string;
  readonly peerDeviceName: string;
  readonly accountEmail: string;
}

/** Terminal. The grant was sealed and the code consumed. */
export interface ProviderDelivered {
  readonly phase: "delivered";
  readonly record: PairingCodeRecord;
}

/** Terminal. The record inside is always burned — see the file header. */
export interface ProviderFailed {
  readonly phase: "failed";
  readonly failure: PairingFailure;
  readonly record: PairingCodeRecord;
}

/** The browser has sent m1 and is waiting for the desktop. */
export interface JoinerAwaitingM2 {
  readonly phase: "awaiting-m2";
  readonly pairingId: string;
  readonly pairKey: Uint8Array;
  readonly secretKey: X25519SecretKey;
  readonly publicKey: Uint8Array;
  readonly nonce: Uint8Array;
  readonly deviceName: string;
  readonly accountEmail: string;
}

/** The desktop is authenticated; showing the SAS while the human consents there. */
export interface JoinerAwaitingPayload {
  readonly phase: "awaiting-payload";
  readonly transcript: Uint8Array;
  readonly sessionKey: Uint8Array;
  readonly sas: string;
  readonly peerDeviceName: string;
  readonly accountEmail: string;
}

/** Terminal. */
export interface JoinerComplete {
  readonly phase: "complete";
  readonly grant: PairingGrant;
}

/** Terminal. */
export interface JoinerFailed {
  readonly phase: "failed";
  readonly failure: PairingFailure;
}

/** Every transition answers with `ok`, so no caller can read a state that is not there. */
export type ProviderM1Result =
  | { readonly ok: true; readonly state: ProviderAwaitingConfirmation; readonly m2: PairingM2 }
  | { readonly ok: false; readonly state: ProviderFailed };

export type ProviderM3Result =
  | { readonly ok: true; readonly state: ProviderAwaitingConsent }
  | { readonly ok: false; readonly state: ProviderFailed };

export type ProviderGrantResult =
  | {
      readonly ok: true;
      readonly state: ProviderDelivered;
      readonly payload: SealedPairingPayload;
    }
  | { readonly ok: false; readonly state: ProviderFailed };

export type JoinerStartResult =
  | { readonly ok: true; readonly state: JoinerAwaitingM2; readonly m1: PairingM1 }
  | { readonly ok: false; readonly state: JoinerFailed };

export type JoinerM2Result =
  | { readonly ok: true; readonly state: JoinerAwaitingPayload; readonly m3: PairingM3 }
  | { readonly ok: false; readonly state: JoinerFailed };

export type JoinerPayloadResult =
  | { readonly ok: true; readonly state: JoinerComplete }
  | { readonly ok: false; readonly state: JoinerFailed };

/**
 * The ONLY way to build a failed provider state — and it always burns the
 * record on the way through. That is what makes "single use, burned on the
 * first failure" a property of the type system rather than of everyone
 * remembering: there is no path to a `ProviderFailed` whose code is still live.
 */
function providerFail(
  record: PairingCodeRecord,
  failure: PairingFailure,
): { readonly ok: false; readonly state: ProviderFailed } {
  return { ok: false, state: { phase: "failed", failure, record: burnPairingCode(record) } };
}

function joinerFail(failure: PairingFailure): { readonly ok: false; readonly state: JoinerFailed } {
  return { ok: false, state: { phase: "failed", failure } };
}

// ── Derivation ──────────────────────────────────────────────────────────────

/**
 * `Argon2id(code, SHA-256(label ‖ pairingId))`.
 *
 * The salt binds the rendezvous, which is what makes one recorded transcript
 * useless against any other pairing: even the (impossible) case of the same
 * 65-bit code being drawn twice yields two unrelated K_pair values.
 */
async function derivePairKey(
  port: CryptoPort,
  code: string,
  pairingId: string,
  params: Argon2idParams,
): Promise<Uint8Array> {
  const salt = await port.sha256(encodeStruct([utf8(PAIR_SALT_LABEL), utf8(pairingId)]));
  return port.argon2id({
    password: utf8(code),
    salt,
    params,
    outputBytes: AEAD_KEY_BYTES,
  });
}

interface TranscriptParts {
  readonly pairingId: string;
  readonly joinerPublicKey: Uint8Array;
  readonly joinerNonce: Uint8Array;
  readonly joinerDeviceName: string;
  readonly providerPublicKey: Uint8Array;
  readonly providerNonce: Uint8Array;
  readonly providerDeviceName: string;
  readonly accountEmail: string;
}

/**
 * SHA-256 over everything both sides said, length-framed. Both sides build it
 * from their OWN view; anything an attacker rewrote in flight makes the two
 * views differ, and the confirmations then disagree.
 */
async function buildTranscript(port: CryptoPort, parts: TranscriptParts): Promise<Uint8Array> {
  return port.sha256(
    encodeStruct([
      utf8(TRANSCRIPT_LABEL),
      utf8(parts.pairingId),
      parts.joinerPublicKey,
      parts.joinerNonce,
      utf8(parts.joinerDeviceName),
      parts.providerPublicKey,
      parts.providerNonce,
      utf8(parts.providerDeviceName),
      utf8(parts.accountEmail),
    ]),
  );
}

interface SessionKeys {
  readonly sessionKey: Uint8Array;
  readonly confirmKey: Uint8Array;
  readonly sas: string;
}

/**
 * The three outputs, from `K_pair ‖ DH` with the transcript as HKDF's salt.
 *
 * Length-framing the two inputs matters for the same reason it matters in an
 * AAD: without it, a shorter K_pair and a longer DH could concatenate to the
 * same bytes as some other pair. Framing is one line and removes the question.
 */
async function deriveSessionKeys(
  port: CryptoPort,
  pairKey: Uint8Array,
  sharedSecret: Uint8Array,
  transcript: Uint8Array,
): Promise<SessionKeys> {
  const ikm = encodeStruct([pairKey, sharedSecret]);
  const [sessionKey, confirmKey, sasKey] = await Promise.all([
    port.hkdfSha256({ ikm, salt: transcript, info: SESSION_INFO, outputBytes: AEAD_KEY_BYTES }),
    port.hkdfSha256({ ikm, salt: transcript, info: CONFIRM_INFO, outputBytes: SHA256_BYTES }),
    port.hkdfSha256({ ikm, salt: transcript, info: SAS_INFO, outputBytes: 8 }),
  ]);
  return { sessionKey, confirmKey, sas: sasFromKey(sasKey) };
}

/**
 * Six decimal digits, for two humans to compare.
 *
 * Read from EIGHT bytes rather than four so the modulo bias is nothing: the
 * bias of `x mod 10^6` over a uniform 64-bit `x` is about 10^6/2^64 ≈ 5×10^-14,
 * where four bytes would give ≈ 2×10^-4 — small, but a needless thumb on the
 * scale in a value whose whole job is to be unpredictable.
 *
 * ~20 bits is deliberately short: it is a check a tired human will actually
 * perform. It is the SECOND line of defence, not the first — the code and the
 * confirmations already authenticate the channel — and its real job is to
 * catch the case where the human is being socially engineered into pairing
 * with a device that is not the one in front of them.
 */
function sasFromKey(sasKey: Uint8Array): string {
  let value = 0n;
  for (const byte of sasKey) value = (value << 8n) | BigInt(byte);
  const digits = value % 10n ** BigInt(PAIRING_SAS_DIGITS);
  return digits.toString().padStart(PAIRING_SAS_DIGITS, "0");
}

async function confirmationFor(
  port: CryptoPort,
  confirmKey: Uint8Array,
  label: Uint8Array,
  transcript: Uint8Array,
): Promise<Uint8Array> {
  return port.hmacSha256(confirmKey, concatBytes(label, transcript));
}

/**
 * The X25519 result, or `null` if it is not a shared secret at all.
 *
 * `CryptoPort.x25519SharedSecret` is required to return `null` for a low-order
 * peer point, and both real adapters (WebCrypto and `node:crypto`) do — the spec
 * makes the all-zero check mandatory. **This function is the second layer, and
 * it exists because port.ts already claims it exists.** RFC 7748 §6.1 requires
 * the check for any protocol without contributory behaviour, and this is one:
 * a peer that forces the DH output to zero removes the entire Diffie-Hellman
 * contribution, leaving the 65-bit code as the only secret in the key schedule
 * and destroying the forward secrecy the ephemeral exchange was there to buy.
 * The handshake would still complete, and nothing would look wrong.
 *
 * The cost of not trusting the port is four lines. The cost of trusting it is
 * that the whole protocol silently degrades the day someone writes an adapter
 * over a raw curve library that returns the zeros instead of refusing. The
 * length check is here for the same reason: a short secret would quietly weaken
 * the IKM, and only this function is positioned to notice.
 */
async function contributorySharedSecret(
  port: CryptoPort,
  secretKey: X25519SecretKey,
  peerPublicKey: Uint8Array,
): Promise<Uint8Array | null> {
  const shared = await port.x25519SharedSecret(secretKey, peerPublicKey);
  if (shared === null || shared.length !== X25519_PUBLIC_KEY_BYTES) return null;
  let bits = 0;
  for (const byte of shared) bits |= byte;
  return bits === 0 ? null : shared;
}

/**
 * The account address as it enters the transcript, or a throw.
 *
 * The transcript binds the account email so a cross-account splice fails and so
 * the consent screen cannot name one account while the keys go to another. That
 * binding is only worth anything if the value is real and if both sides
 * produce the same STRING for the same account: the desktop shows what the
 * server attests, the browser reports the session it is signed in as, and
 * nothing guaranteed those agreed about case or surrounding space. They would
 * then fail confirmation — and, because failure burns, spend a live offer for a
 * reason that is not an attack.
 *
 * {@link normalizeWebEmail} is deliberately the SAME function that derives the
 * account's own KDF salt, so "the address this pairing is bound to" and "the
 * address this account's keys are derived from" cannot drift apart. It also
 * refuses an empty address, which is the other half: an empty binding binds
 * nothing, and a consent dialog with a blank account line is worse than none.
 */
function transcriptEmail(accountEmail: string): string {
  return normalizeWebEmail(accountEmail);
}

// ── Provider ────────────────────────────────────────────────────────────────

/** What the desktop supplies when the user asks for a code. */
export interface PairingOfferInput {
  readonly deviceName: string;
  /**
   * The email the server attests this account has. Shown at consent, bound in
   * the transcript, and normalised by {@link transcriptEmail} so the two sides
   * cannot disagree over case or space. An address that normalises to nothing
   * is refused: an empty binding binds nothing.
   */
  readonly accountEmail: string;
  readonly nowMs: number;
  /**
   * Overrides {@link PAIRING_KDF_PARAMS}, for tests. Note that unlike the web
   * KDF's parameters, these are NEVER negotiated and never travel: both sides
   * read the same compile-time constant, so there is nothing here for a hostile
   * server to weaken, and correspondingly no floor check to enforce.
   */
  readonly params?: Argon2idParams;
}

/** Draws a code and a rendezvous id, and pays the Argon2id up front. */
export async function createPairingOffer(
  port: CryptoPort,
  input: PairingOfferInput,
): Promise<ProviderOffered> {
  assertDeviceName(input.deviceName);
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
    throw new TypeError(`nowMs must be a non-negative safe integer, got: ${String(input.nowMs)}`);
  }

  // Before any randomness is spent: an offer whose account cannot be named is
  // an offer whose transcript binds nothing.
  const accountEmail = transcriptEmail(input.accountEmail);

  const code = generatePairingCode(port);
  const pairingId = generatePairingId(port);
  const pairKey = await derivePairKey(port, code, pairingId, input.params ?? PAIRING_KDF_PARAMS);

  return {
    phase: "offered",
    record: {
      pairingId,
      issuedAtMs: input.nowMs,
      expiresAtMs: input.nowMs + PAIRING_CODE_TTL_MS,
      state: "live",
    },
    code,
    pairKey,
    deviceName: input.deviceName,
    accountEmail,
  };
}

/**
 * Answers m1: generates the provider's ephemeral pair and nonce, builds the
 * transcript, and returns m2 carrying the provider's confirmation.
 *
 * Fresh ephemeral material on EVERY call, even for the same offer. That is what
 * makes a recorded m3 useless against a second run: the transcript differs, so
 * the confirmation the attacker recorded no longer verifies.
 */
export async function providerReceiveM1(
  port: CryptoPort,
  state: ProviderOffered,
  m1: PairingM1,
  nowMs: number,
): Promise<ProviderM1Result> {
  const problem = pairingCodeProblem(state.record, nowMs);
  if (problem !== null) return providerFail(state.record, problem);

  // Checked before any expensive work: a mis-routed message must not cost an
  // Argon2id, and it must not be able to reach the key schedule at all.
  if (m1.pairingId !== state.record.pairingId) {
    return providerFail(state.record, "pairing-id-mismatch");
  }

  const joinerPublicKey = base64urlToBytes(m1.publicKey);
  const joinerNonce = base64urlToBytes(m1.nonce);
  if (
    joinerNonce === null ||
    joinerNonce.length !== PAIRING_NONCE_BYTES ||
    !isAcceptableDeviceName(m1.deviceName)
  ) {
    return providerFail(state.record, "malformed-message");
  }
  if (joinerPublicKey === null || joinerPublicKey.length !== X25519_PUBLIC_KEY_BYTES) {
    return providerFail(state.record, "bad-peer-public-key");
  }

  const ephemeral = await port.x25519GenerateKeyPair();
  // A peer echoing our own public key back is either a broken transport or a
  // reflection attempt; either way the resulting "shared" secret is not a
  // secret shared with anyone.
  if (constantTimeEqual(ephemeral.publicKey, joinerPublicKey)) {
    return providerFail(state.record, "bad-peer-public-key");
  }

  const sharedSecret = await contributorySharedSecret(
    port,
    ephemeral.secretKey,
    joinerPublicKey,
  );
  if (sharedSecret === null) return providerFail(state.record, "bad-peer-public-key");

  const providerNonce = port.randomBytes(PAIRING_NONCE_BYTES);
  const transcript = await buildTranscript(port, {
    pairingId: state.record.pairingId,
    joinerPublicKey,
    joinerNonce,
    joinerDeviceName: m1.deviceName,
    providerPublicKey: ephemeral.publicKey,
    providerNonce,
    providerDeviceName: state.deviceName,
    accountEmail: state.accountEmail,
  });

  const keys = await deriveSessionKeys(port, state.pairKey, sharedSecret, transcript);
  const [confirmProvider, confirmJoiner] = await Promise.all([
    confirmationFor(port, keys.confirmKey, CONFIRM_PROVIDER_LABEL, transcript),
    confirmationFor(port, keys.confirmKey, CONFIRM_JOINER_LABEL, transcript),
  ]);

  return {
    ok: true,
    state: {
      phase: "awaiting-confirmation",
      record: state.record,
      transcript,
      sessionKey: keys.sessionKey,
      expectedJoinerConfirmation: confirmJoiner,
      sas: keys.sas,
      peerDeviceName: m1.deviceName,
      accountEmail: state.accountEmail,
    },
    m2: {
      v: 1,
      pairingId: state.record.pairingId,
      publicKey: bytesToBase64url(ephemeral.publicKey),
      nonce: bytesToBase64url(providerNonce),
      deviceName: state.deviceName,
      confirmation: bytesToBase64url(confirmProvider),
    },
  };
}

/**
 * Verifies the joiner's confirmation. This is the check that burns the code on
 * failure: it is the first and only moment at which a guess at the code can be
 * tested against the provider, so it gets exactly one shot.
 *
 * **And "one shot" is why the record is re-read here rather than trusted from
 * m1.** The states are immutable values, so the `awaiting-confirmation` state
 * this takes can be presented again after it has already failed; nothing about
 * holding it proves the offer is still live. Checking only at m1 also let the
 * ten-minute life expire silently — a handshake answered inside the window
 * could be finished a week later, because this was the one transition with no
 * clock in its signature. It has one now, and it is not optional.
 */
export async function providerReceiveM3(
  port: CryptoPort,
  state: ProviderAwaitingConfirmation,
  m3: PairingM3,
  nowMs: number,
): Promise<ProviderM3Result> {
  const problem = pairingCodeProblem(state.record, nowMs);
  if (problem !== null) return providerFail(state.record, problem);

  if (m3.pairingId !== state.record.pairingId) {
    return providerFail(state.record, "pairing-id-mismatch");
  }

  const confirmation = base64urlToBytes(m3.confirmation);
  if (confirmation === null || !constantTimeEqual(confirmation, state.expectedJoinerConfirmation)) {
    return providerFail(state.record, "confirmation-mismatch");
  }

  return {
    ok: true,
    state: {
      phase: "awaiting-consent",
      record: state.record,
      transcript: state.transcript,
      sessionKey: state.sessionKey,
      sas: state.sas,
      peerDeviceName: state.peerDeviceName,
      accountEmail: state.accountEmail,
    },
  };
}

/**
 * Seals the grant. Called ONLY after the human has consented in the desktop
 * main process, behind the account passcode, having seen `peerDeviceName`,
 * `accountEmail` and `sas`. The type enforces the ORDER — there is no other
 * state this function accepts — and the record enforces the rest.
 *
 * **Why the record is checked here too.** The type cannot express "and the
 * human said yes", and it cannot express "and this consent has not already been
 * spent", because a state is a value: `providerDecline` returns a new failed
 * state and leaves the `awaiting-consent` value it was given exactly as it was,
 * so without this check a refusal was advisory and a caller holding both values
 * could seal the keys anyway. Same for a second call: one consent, one grant.
 * This is the last gate before profile content keys leave the device, so it is
 * the last place worth being paranoid.
 *
 * Throws for a grant this package would refuse at the other end — that is a bug
 * on the trusted side, and it must surface on the desktop rather than arriving
 * in the browser disguised as `payload-open-failed`, which reads to the user as
 * an attack.
 */
export async function providerGrant(
  port: CryptoPort,
  state: ProviderAwaitingConsent,
  grant: PairingGrant,
  nowMs: number,
): Promise<ProviderGrantResult> {
  const problem = pairingCodeProblem(state.record, nowMs);
  if (problem !== null) return providerFail(state.record, problem);
  assertGrant(grant);

  const nonce = port.randomBytes(AEAD_NONCE_BYTES);
  const ciphertext = await port.aeadSeal({
    key: state.sessionKey,
    nonce,
    plaintext: utf8(canonicalJson(encodeGrant(grant))),
    aad: payloadAad(state.transcript),
  });

  return {
    ok: true,
    state: { phase: "delivered", record: consumePairingCode(state.record) },
    payload: { v: 1, nonce: bytesToBase64url(nonce), ciphertext: bytesToBase64url(ciphertext) },
  };
}

/**
 * The human said no. Burns the code — a refused pairing does not get a second
 * try, because "try again and hope they click the other button" is exactly the
 * attack a consent screen exists to stop. Routed through `providerFail` like
 * every other failure, so the "no failed state escapes with a live code" claim
 * stays literally true.
 *
 * The burned record it returns is the whole point, and it is only a refusal if
 * the caller writes it back: see the file header's one obligation.
 * `providerGrant` re-reads the record for exactly this reason.
 */
export function providerDecline(state: ProviderAwaitingConsent): ProviderFailed {
  return providerFail(state.record, "consent-declined").state;
}

// ── Joiner ──────────────────────────────────────────────────────────────────

/** What the browser supplies: the rendezvous handle, and the code the human typed. */
export interface JoinerStartInput {
  readonly pairingId: string;
  /** As typed. Normalised here; a code that cannot be one fails immediately. */
  readonly code: string;
  readonly deviceName: string;
  /** The email of the session the browser is already signed in as; see {@link transcriptEmail}. */
  readonly accountEmail: string;
  readonly params?: Argon2idParams;
}

/** Derives K_pair, generates the ephemeral pair, and builds m1. */
export async function joinerStart(
  port: CryptoPort,
  input: JoinerStartInput,
): Promise<JoinerStartResult> {
  assertDeviceName(input.deviceName);
  const accountEmail = transcriptEmail(input.accountEmail);

  // The rendezvous handle comes from the transport, so it is checked here
  // rather than trusted: an id of the wrong shape would still derive a K_pair
  // and still build an m1, and the failure would surface much later as an
  // unexplained mismatch on the other side.
  if (!isPairingId(input.pairingId)) return joinerFail("malformed-message");

  const code = normalizePairingCode(input.code);
  if (code === null) return joinerFail("bad-code-format");

  const pairKey = await derivePairKey(port, code, input.pairingId, input.params ?? PAIRING_KDF_PARAMS);
  const ephemeral = await port.x25519GenerateKeyPair();
  const nonce = port.randomBytes(PAIRING_NONCE_BYTES);

  return {
    ok: true,
    state: {
      phase: "awaiting-m2",
      pairingId: input.pairingId,
      pairKey,
      secretKey: ephemeral.secretKey,
      publicKey: ephemeral.publicKey,
      nonce,
      deviceName: input.deviceName,
      accountEmail,
    },
    m1: {
      v: 1,
      pairingId: input.pairingId,
      publicKey: bytesToBase64url(ephemeral.publicKey),
      nonce: bytesToBase64url(nonce),
      deviceName: input.deviceName,
    },
  };
}

/**
 * Verifies the provider's confirmation and answers with the joiner's.
 *
 * A `confirmation-mismatch` here is the joiner's ONLY signal that something is
 * wrong, and it covers three different situations that cannot be told apart and
 * must not be: the human typed the wrong code, someone rewrote a message in
 * flight, or the desktop is not the desktop it claims to be. All three end the
 * handshake the same way.
 */
export async function joinerReceiveM2(
  port: CryptoPort,
  state: JoinerAwaitingM2,
  m2: PairingM2,
): Promise<JoinerM2Result> {
  if (m2.pairingId !== state.pairingId) return joinerFail("pairing-id-mismatch");

  const providerPublicKey = base64urlToBytes(m2.publicKey);
  const providerNonce = base64urlToBytes(m2.nonce);
  if (
    providerNonce === null ||
    providerNonce.length !== PAIRING_NONCE_BYTES ||
    !isAcceptableDeviceName(m2.deviceName)
  ) {
    return joinerFail("malformed-message");
  }
  if (
    providerPublicKey === null ||
    providerPublicKey.length !== X25519_PUBLIC_KEY_BYTES ||
    // Our own public key echoed back: a reflection attempt, or a transport
    // looping our own m1 into m2. Either way the "shared" secret is shared
    // with nobody.
    constantTimeEqual(providerPublicKey, state.publicKey)
  ) {
    return joinerFail("bad-peer-public-key");
  }

  const sharedSecret = await contributorySharedSecret(
    port,
    state.secretKey,
    providerPublicKey,
  );
  if (sharedSecret === null) return joinerFail("bad-peer-public-key");

  const transcript = await buildTranscript(port, {
    pairingId: state.pairingId,
    joinerPublicKey: state.publicKey,
    joinerNonce: state.nonce,
    joinerDeviceName: state.deviceName,
    providerPublicKey,
    providerNonce,
    providerDeviceName: m2.deviceName,
    accountEmail: state.accountEmail,
  });

  const keys = await deriveSessionKeys(port, state.pairKey, sharedSecret, transcript);
  const expected = await confirmationFor(port, keys.confirmKey, CONFIRM_PROVIDER_LABEL, transcript);
  const offered = base64urlToBytes(m2.confirmation);
  if (offered === null || !constantTimeEqual(offered, expected)) {
    return joinerFail("confirmation-mismatch");
  }

  const confirmJoiner = await confirmationFor(
    port,
    keys.confirmKey,
    CONFIRM_JOINER_LABEL,
    transcript,
  );

  return {
    ok: true,
    state: {
      phase: "awaiting-payload",
      transcript,
      sessionKey: keys.sessionKey,
      sas: keys.sas,
      peerDeviceName: m2.deviceName,
      accountEmail: state.accountEmail,
    },
    m3: {
      v: 1,
      pairingId: state.pairingId,
      confirmation: bytesToBase64url(confirmJoiner),
    },
  };
}

/** Opens the sealed grant. The AAD binds it to this exact handshake. */
export async function joinerOpenPayload(
  port: CryptoPort,
  state: JoinerAwaitingPayload,
  payload: SealedPairingPayload,
): Promise<JoinerPayloadResult> {
  const nonce = base64urlToBytes(payload.nonce);
  const ciphertext = base64urlToBytes(payload.ciphertext);
  if (
    nonce === null ||
    nonce.length !== AEAD_NONCE_BYTES ||
    ciphertext === null ||
    ciphertext.length < AEAD_TAG_BYTES
  ) {
    return joinerFail("payload-open-failed");
  }

  const plaintext = await port.aeadOpen({
    key: state.sessionKey,
    nonce,
    ciphertext,
    aad: payloadAad(state.transcript),
  });
  if (plaintext === null) return joinerFail("payload-open-failed");

  let text: string;
  try {
    text = fromUtf8(plaintext);
  } catch {
    return joinerFail("payload-open-failed");
  }
  const grant = decodeGrant(parseJsonValue(text));
  if (grant === null) return joinerFail("payload-open-failed");

  return { ok: true, state: { phase: "complete", grant } };
}

// ── Payload encoding ────────────────────────────────────────────────────────

function payloadAad(transcript: Uint8Array): Uint8Array {
  return encodeStruct([utf8(PAYLOAD_LABEL), transcript]);
}

/**
 * The provider-side mirror of {@link decodeGrant}: the same rules, applied
 * before the payload is sealed rather than after it has crossed the network.
 *
 * Two ends that disagree about what a grant is turn a caller bug into an
 * `payload-open-failed` on the browser, which is the code word for "someone
 * tampered with this" — the worst possible message for the least serious cause.
 * Throws rather than failing the handshake, because the grant is assembled by
 * the desktop, on the trusted side: this is a programming error, not an attack.
 *
 * **What this cannot check, said plainly.** A 32-byte value is a 32-byte value.
 * `PairingGrant` has no field for the master key, and that is worth having, but
 * MK is also 32 bytes, so nothing here can tell a content key from MK smuggled
 * into the `contentKey` slot. "MK never enters a browser" is therefore a
 * property of the code that ASSEMBLES the grant — it must read only wraps of
 * purpose `ck/master-key`, one per web-enabled profile — and not a property this
 * type can enforce. Documenting it as structural would be a lie that reads like
 * a guarantee.
 */
function assertGrant(grant: PairingGrant): void {
  const seen = new Set<string>();
  for (const profile of grant.profiles) {
    if (profile.profileId.length === 0) {
      throw new TypeError("A pairing grant cannot name a profile with an empty id.");
    }
    const bytes = base64urlToBytes(profile.contentKey);
    if (bytes === null || bytes.length !== AEAD_KEY_BYTES) {
      throw new TypeError(
        `The content key for profile "${profile.profileId}" is not ${AEAD_KEY_BYTES} ` +
          "bytes of base64url.",
      );
    }
    if (seen.has(profile.profileId)) {
      throw new TypeError(`The grant names profile "${profile.profileId}" twice.`);
    }
    seen.add(profile.profileId);
  }
}

function encodeGrant(grant: PairingGrant): { readonly [key: string]: JsonValue } {
  return {
    p: grant.profiles.map((profile) => ({ i: profile.profileId, k: profile.contentKey })),
  };
}

/** Strict: an unknown key or a content key that is not 32 bytes is a refusal. */
function decodeGrant(value: JsonValue | null): PairingGrant | null {
  if (value === null || !isJsonObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "p") return null;

  const list = value["p"];
  if (!Array.isArray(list)) return null;

  const profiles: PairingGrantProfile[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (!isJsonObject(entry)) return null;
    const entryKeys = Object.keys(entry).sort();
    if (entryKeys.length !== 2 || entryKeys[0] !== "i" || entryKeys[1] !== "k") return null;
    const profileId = entry["i"];
    const contentKey = entry["k"];
    if (typeof profileId !== "string" || profileId.length === 0) return null;
    if (typeof contentKey !== "string") return null;
    const bytes = base64urlToBytes(contentKey);
    if (bytes === null || bytes.length !== AEAD_KEY_BYTES) return null;
    // Two keys for one profile is not a grant, it is an ambiguity, and every
    // resolution of it ("first wins", "last wins") is a decision an attacker
    // would like to make on the client's behalf.
    if (seen.has(profileId)) return null;
    seen.add(profileId);
    profiles.push({ profileId, contentKey });
  }
  return { profiles };
}

// ── Message parsing ─────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function readBytesField(value: unknown, expectedBytes: number): string | null {
  if (typeof value !== "string") return null;
  const bytes = base64urlToBytes(value);
  return bytes !== null && bytes.length === expectedBytes ? value : null;
}

/**
 * A device name is shown to a human on a consent screen. Bounded, visible, and
 * free of anything unrenderable — an unbounded string from a peer that ends up
 * in a dialog is how a "device name" becomes a paragraph of instructions
 * telling the user to click Allow.
 *
 * "Visible" is a separate condition from "non-empty", and it is the one that
 * matters: `"   "` is non-empty, carries no control characters, and puts a
 * blank line on the dialog exactly where the identity of the thing receiving
 * the keys is supposed to be. A consent screen that names nobody is worse than
 * no consent screen, because it still collects a click.
 */
function isAcceptableDeviceName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_DEVICE_NAME_LENGTH &&
    value.trim().length > 0 &&
    !UNRENDERABLE_CHARACTERS.test(value)
  );
}

function assertDeviceName(value: string): void {
  if (!isAcceptableDeviceName(value)) {
    throw new TypeError(
      `A device name must be 1–${MAX_DEVICE_NAME_LENGTH} visible characters, with no control ` +
        "or format characters.",
    );
  }
}

function isPairingId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const bytes = base64urlToBytes(value);
  return bytes !== null && bytes.length === PAIRING_ID_BYTES;
}

/** Validates m1 from an untrusted transport. Unknown keys are a rejection. */
export function parsePairingM1(value: unknown): PairingM1 | null {
  if (!isRecord(value) || !hasExactly(value, ["v", "pairingId", "publicKey", "nonce", "deviceName"])) {
    return null;
  }
  if (value["v"] !== 1 || !isPairingId(value["pairingId"])) return null;
  const publicKey = readBytesField(value["publicKey"], X25519_PUBLIC_KEY_BYTES);
  const nonce = readBytesField(value["nonce"], PAIRING_NONCE_BYTES);
  const deviceName = value["deviceName"];
  if (publicKey === null || nonce === null || !isAcceptableDeviceName(deviceName)) return null;
  return { v: 1, pairingId: value["pairingId"], publicKey, nonce, deviceName };
}

/** Validates m2. */
export function parsePairingM2(value: unknown): PairingM2 | null {
  if (
    !isRecord(value) ||
    !hasExactly(value, ["v", "pairingId", "publicKey", "nonce", "deviceName", "confirmation"])
  ) {
    return null;
  }
  if (value["v"] !== 1 || !isPairingId(value["pairingId"])) return null;
  const publicKey = readBytesField(value["publicKey"], X25519_PUBLIC_KEY_BYTES);
  const nonce = readBytesField(value["nonce"], PAIRING_NONCE_BYTES);
  const confirmation = readBytesField(value["confirmation"], SHA256_BYTES);
  const deviceName = value["deviceName"];
  if (publicKey === null || nonce === null || confirmation === null) return null;
  if (!isAcceptableDeviceName(deviceName)) return null;
  return { v: 1, pairingId: value["pairingId"], publicKey, nonce, deviceName, confirmation };
}

/** Validates m3. */
export function parsePairingM3(value: unknown): PairingM3 | null {
  if (!isRecord(value) || !hasExactly(value, ["v", "pairingId", "confirmation"])) return null;
  if (value["v"] !== 1 || !isPairingId(value["pairingId"])) return null;
  const confirmation = readBytesField(value["confirmation"], SHA256_BYTES);
  if (confirmation === null) return null;
  return { v: 1, pairingId: value["pairingId"], confirmation };
}

/** Validates the sealed grant envelope. */
export function parseSealedPairingPayload(value: unknown): SealedPairingPayload | null {
  if (!isRecord(value) || !hasExactly(value, ["v", "nonce", "ciphertext"])) return null;
  if (value["v"] !== 1) return null;
  const nonce = readBytesField(value["nonce"], AEAD_NONCE_BYTES);
  const ciphertext = value["ciphertext"];
  if (nonce === null || typeof ciphertext !== "string") return null;
  const bytes = base64urlToBytes(ciphertext);
  if (bytes === null || bytes.length < AEAD_TAG_BYTES) return null;
  return { v: 1, nonce, ciphertext };
}
