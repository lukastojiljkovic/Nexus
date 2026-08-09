/**
 * `@nexus/sync-crypto/web` — everything a BROWSER may hold, and nothing else.
 *
 * This is not a convenience re-export of the main barrel. It is a capability
 * list: the set of cryptographic operations a browser tab is entitled to
 * perform, written down in the one form a build can check.
 *
 * ─── What is missing, and why each one is missing ───────────────────────────
 *
 * **`wrap.ts` in its entirety** — `wrapKey`, `unwrapKey`, `generateMasterKey`,
 * `generateContentKey`, `parseSealedKey`. The master-key wrap is a row of the
 * user's own account and a signed-in browser can ask the server for it, so the
 * distance between „a browser holds K_wrap" and „a browser holds MK" is exactly
 * one `unwrapKey` call. Nothing here shortens it. The browser does not mint keys
 * either: MK is minted once per account by a server-side path, and content keys
 * arrive through pairing, already open.
 *
 * **`deriveWebPasswordKeys`** — K_auth *and* K_wrap. The browser gets
 * {@link deriveWebAuthPassword}, which is K_auth alone, because signing in is
 * its entire legitimate interest in the password. See `kdf.ts`'s header for the
 * full argument and for the other three places this rule is enforced.
 *
 * **`rewrapMasterKeyForEmailChange`** — holds K_wrap and MK in plaintext by
 * construction. It lives in `rewrap.ts` precisely so that no module reachable
 * from this file imports `wrap.ts`; `scripts/web-key-surface.test.mjs` walks
 * that graph and fails if the edge comes back.
 *
 * **`@nexus/sync-crypto/testing`** is not re-exported from anywhere and must
 * never be reachable from a browser bundle: it is a DETERMINISTIC fake
 * `CryptoPort`, which is to say a random number generator that is not one.
 *
 * ─── What is here ──────────────────────────────────────────────────────────
 *
 * The row AEAD (a browser decrypts and encrypts rows — that is the product),
 * field-level merge and the clock it runs on, the joiner half of pairing, the
 * byte and JSON helpers those need, and K_auth. Adding an export is a one-line
 * diff and should be reviewed as what it is: widening what a browser can do.
 */

// ── The port ────────────────────────────────────────────────────────────────
export {
  AEAD_KEY_BYTES,
  AEAD_NONCE_BYTES,
  AEAD_TAG_BYTES,
  SHA256_BYTES,
  X25519_PUBLIC_KEY_BYTES,
} from "./port.js";
export type {
  AeadOpenRequest,
  AeadSealRequest,
  Argon2idParams,
  Argon2idRequest,
  CryptoPort,
  HkdfRequest,
  X25519KeyPair,
  X25519SecretKey,
} from "./port.js";

// ── Errors ──────────────────────────────────────────────────────────────────
export { SyncCryptoError } from "./errors.js";
export type { SyncCryptoErrorCode } from "./errors.js";

// ── Byte and JSON helpers ───────────────────────────────────────────────────
export { base64urlToBytes, bytesToBase64url, constantTimeEqual, utf8, zeroize } from "./bytes.js";
export { canonicalJson, isJsonObject, parseJsonValue } from "./json.js";
export type { JsonObject, JsonValue } from "./json.js";

// ── The web password KDF: K_auth only ───────────────────────────────────────
export {
  WEB_KDF_PARAMS,
  deriveWebAuthPassword,
  normalizeWebEmail,
  normalizeWebPassword,
  webKdfSalt,
} from "./kdf.js";
export type { WebPasswordInput } from "./kdf.js";

// ── Row encryption ──────────────────────────────────────────────────────────
export { openRow, openRowFields, parseSealedRow, sealRow, sealRowFields } from "./row.js";
export type { RowIdentity, SealedRow } from "./row.js";

// ── Pairing ─────────────────────────────────────────────────────────────────
// The browser is the JOINER — it types the code the desktop showed — but the
// provider half is exported too, because both halves are one protocol and a
// browser that could not parse the messages it receives could not run it. The
// capability that matters is not `providerGrant`; it is the content key, and
// that arrives sealed either way.
export {
  PAIRING_CODE_DIGITS,
  PAIRING_CODE_TTL_MS,
  PAIRING_KDF_PARAMS,
  PAIRING_SAS_DIGITS,
  burnPairingCode,
  consumePairingCode,
  createPairingOffer,
  formatPairingCode,
  generatePairingCode,
  generatePairingId,
  joinerOpenPayload,
  joinerReceiveM2,
  joinerStart,
  normalizePairingCode,
  pairingCodeProblem,
  parsePairingM1,
  parsePairingM2,
  parsePairingM3,
  parseSealedPairingPayload,
  providerDecline,
  providerGrant,
  providerReceiveM1,
  providerReceiveM3,
} from "./pairing.js";
export type {
  JoinerAwaitingM2,
  JoinerAwaitingPayload,
  JoinerComplete,
  JoinerFailed,
  JoinerM2Result,
  JoinerPayloadResult,
  JoinerStartInput,
  JoinerStartResult,
  PairingCodeRecord,
  PairingCodeState,
  PairingFailure,
  PairingGrant,
  PairingGrantProfile,
  PairingM1,
  PairingM2,
  PairingM3,
  PairingOfferInput,
  ProviderAwaitingConfirmation,
  ProviderAwaitingConsent,
  ProviderDelivered,
  ProviderFailed,
  ProviderGrantResult,
  ProviderM1Result,
  ProviderM3Result,
  ProviderOffered,
  SealedPairingPayload,
} from "./pairing.js";

// ── The hybrid logical clock ────────────────────────────────────────────────
export {
  HLC_MAX_FORWARD_DRIFT_MS,
  compareHlc,
  formatHlc,
  hlcExceedsDriftWindow,
  hlcReceive,
  hlcSend,
  hlcZero,
  parseHlc,
} from "./hlc.js";
export type { Hlc } from "./hlc.js";

// ── Field-level last-write-wins ─────────────────────────────────────────────
export {
  applyEdit,
  decodeRowState,
  emptyRowState,
  encodeRowState,
  markDeleted,
  markRestored,
  mergeFields,
  mergeRows,
  rowFields,
} from "./merge.js";
export type { DeletedState, FieldState, FieldStates, RowEnvelope, RowState } from "./merge.js";
