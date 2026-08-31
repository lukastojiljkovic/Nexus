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
 * **This barrel is the DESKTOP's.** `@nexus/sync-crypto/web` is the same package
 * with the capabilities a browser must not hold removed — see `web.ts` for what
 * is missing and why each one is.
 *
 * The eight pieces, and where the reasoning for each lives:
 *
 *  - `kdf.ts`     the web password → K_auth / K_wrap split. Browser-safe: it has
 *                 no path to `wrap.ts`, which is what `rewrap.ts` exists for.
 *  - `rewrap.ts`  the re-wrap an email change forces (the salt binds the
 *                 address). Desktop only — it holds K_wrap and MK.
 *  - `wrap.ts`    MK and CK_p wrapping, with an explicit key-commitment tag,
 *                 because the AEAD is not key-committing.
 *  - `row.ts`     the ONLY place in the product that encrypts a row.
 *  - `pairing.ts` the desktop→browser handshake, as pure functions over an
 *                 injected transport, with a state machine in which a wrong
 *                 transition does not compile.
 *  - `device-name.ts` what a device may be called — the highest-stakes string in
 *                 the product, since a human reads it while authorising a key
 *                 release — and how it is sealed under a subkey of MK.
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
// `asBufferSource` is exported for the two WebCrypto ports — the real one in
// `@nexus/sync-port` and the fake here — so that „never hand `.buffer` to
// WebCrypto" is one function with one comment rather than a rule two files
// remember separately.
export {
  asBufferSource,
  base64urlToBytes,
  bytesToBase64url,
  constantTimeEqual,
  utf8,
  zeroize,
} from "./bytes.js";

// ── Canonical JSON ──────────────────────────────────────────────────────────
export { canonicalJson, isJsonObject, parseJsonValue } from "./json.js";
export type { JsonObject, JsonValue } from "./json.js";

// ── The web password KDF ────────────────────────────────────────────────────
// THIS BARREL IS THE DESKTOP'S. `deriveWebAuthPassword` is the browser's half;
// `deriveWebPasswordKeys` and `rewrapMasterKeyForEmailChange` derive K_wrap and
// are DESKTOP ONLY — see `kdf.ts`'s header on why that separation is a function
// boundary and not a convention. A browser imports `@nexus/sync-crypto/web`,
// which is the same package with the desktop-only capabilities absent; it is a
// separate barrel rather than a comment for the same reason this one is not
// simply „everything".
export {
  WEB_KDF_PARAMS,
  deriveWebAuthPassword,
  deriveWebPasswordKeys,
  normalizeWebEmail,
  normalizeWebPassword,
  webKdfSalt,
} from "./kdf.js";
export type { WebPasswordInput, WebPasswordKeys } from "./kdf.js";
export { rewrapMasterKeyForEmailChange } from "./rewrap.js";
export type { EmailChangeInput } from "./rewrap.js";

// The sync recovery code. `deriveSyncRecoveryKey` is DESKTOP ONLY and absent
// from the web barrel: `mk_under_src` is deliberately readable without a desktop
// device row (a recovering desktop has none), so a browser that could also
// derive its opener would be one call from MK. The code helpers themselves are
// harmless — they encode and check a string — but they live here with the
// derivation rather than being split across two barrels, because a browser has
// no reason to display or validate a code it can never use.
export {
  SYNC_RECOVERY_CODE_DIGITS,
  SYNC_RECOVERY_KDF_PARAMS,
  SYNC_RECOVERY_SALT_BYTES,
  deriveSyncRecoveryKey,
  formatSyncRecoveryCode,
  generateSyncRecoveryCode,
  generateSyncRecoverySalt,
  normalizeSyncRecoveryCode,
} from "./recovery.js";
export type { SyncRecoveryInput } from "./recovery.js";

// Turning sync on. DESKTOP ONLY and absent from the web barrel by definition:
// it mints the master key and derives K_wrap to wrap it, which are the two
// capabilities `web.ts` exists to withhold.
export { prepareSyncEnable } from "./enable.js";
export type { SyncEnableInput, SyncEnableMaterial } from "./enable.js";

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

// ── Device names ────────────────────────────────────────────────────────────
// The validator is shared with `pairing.ts`; the seal is DESKTOP ONLY and absent
// from the web barrel, because it is under a subkey of MK and a browser never
// holds MK. What that costs — a browser cannot render a device list's names —
// is argued in `device-name.ts`'s header.
export {
  MAX_DEVICE_NAME_LENGTH,
  assertDeviceName,
  isAcceptableDeviceName,
  openDeviceName,
  sealDeviceName,
} from "./device-name.js";
export type { DeviceNameContext, DevicePlatform, SealedDeviceName } from "./device-name.js";

// ── Getting a device row back ───────────────────────────────────────────────
// DESKTOP ONLY, and absent from the web barrel for the reason the whole module
// exists: it is derived from MK, and a browser never holds MK. A browser has no
// use for it either — `platform = 'desktop'` is what this proof buys.
export { DEVICE_REGISTER_PROOF_BYTES, deriveDeviceRegisterProof } from "./device-register.js";

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
