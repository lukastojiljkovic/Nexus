/**
 * `@nexus/sync-crypto` — the cryptographic core of sync, and nothing else.
 *
 * Pure by construction: no DOM, no `node:` import, no clock, no I/O, no
 * randomness of its own, and **zero runtime dependencies**. Every primitive
 * arrives through {@link CryptoPort}, which the caller implements — the
 * Electron main process over `node:crypto` plus a WASM Argon2, a browser over
 * WebCrypto plus the same WASM. A deterministic fake for tests lives behind the
 * separate `@nexus/sync-crypto/testing` subpath and is deliberately not
 * reachable from here.
 *
 * The six pieces, and where the reasoning for each lives:
 *
 *  - `kdf.ts`     the web password → K_auth / K_wrap split, and the re-wrap an
 *                 email change forces (the salt binds the address).
 *  - `wrap.ts`    MK and CK_p wrapping, with an explicit key-commitment tag,
 *                 because the AEAD is not key-committing.
 *  - `row.ts`     the ONLY place in the product that encrypts a row.
 *  - `pairing.ts` the desktop→browser handshake, as pure functions over an
 *                 injected transport, with a state machine in which a wrong
 *                 transition does not compile.
 *  - `hlc.ts`     the hybrid logical clock and its 24-hour forward clamp.
 *  - `merge.ts`   field-level last-write-wins over that clock.
 *
 * Nothing here touches the local key chain (DK, the passcode, the Recovery
 * Kit); that stays in `@nexus/core/auth` where it already is.
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

// ── Byte helpers callers need to move sealed material through JSON ──────────
// `utf8` is exported for one reason worth naming: the server bounds `object_id`
// and `parent_id` by `octet_length`, and a client that checked `String.length`
// would pass a 200-character Serbian id that is 320 bytes on the wire. Counting
// the same bytes the database counts needs the same encoder.
export { base64urlToBytes, bytesToBase64url, constantTimeEqual, utf8, zeroize } from "./bytes.js";

// ── Canonical JSON ──────────────────────────────────────────────────────────
export { canonicalJson, isJsonObject, parseJsonValue } from "./json.js";
export type { JsonObject, JsonValue } from "./json.js";

// ── The web password KDF ────────────────────────────────────────────────────
// `deriveWebAuthPassword` is the browser's half; `deriveWebPasswordKeys` and
// `rewrapMasterKeyForEmailChange` derive K_wrap and are DESKTOP ONLY — see
// `kdf.ts`'s header on why that separation is a function boundary and not a
// convention, and on the bundle rule the web app owes in return.
export {
  WEB_KDF_PARAMS,
  deriveWebAuthPassword,
  deriveWebPasswordKeys,
  normalizeWebEmail,
  normalizeWebPassword,
  rewrapMasterKeyForEmailChange,
  webKdfSalt,
} from "./kdf.js";
export type { EmailChangeInput, WebPasswordInput, WebPasswordKeys } from "./kdf.js";

// ── Key wrapping ────────────────────────────────────────────────────────────
export {
  generateContentKey,
  generateMasterKey,
  parseSealedKey,
  unwrapKey,
  wrapKey,
} from "./wrap.js";
export type { SealedKey, WrapContext, WrapPurpose } from "./wrap.js";

// ── Row encryption ──────────────────────────────────────────────────────────
export { openRow, openRowFields, parseSealedRow, sealRow, sealRowFields } from "./row.js";
export type { RowIdentity, SealedRow } from "./row.js";

// ── Pairing ─────────────────────────────────────────────────────────────────
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
