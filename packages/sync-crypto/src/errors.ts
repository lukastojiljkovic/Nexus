/**
 * The one error type this package throws, and the closed set of reasons it
 * carries.
 *
 * One class rather than six, because every caller does the same thing with it:
 * switches on the reason to choose a Serbian sentence. A `code` on one class is
 * a `switch` the compiler can check for exhaustiveness; six sibling classes are
 * an `instanceof` ladder that silently falls through when a seventh appears.
 *
 * Note what is NOT here: pairing failures. A handshake that fails is not an
 * exceptional condition, it is a STATE the machine transitions to — with a
 * burned code and a screen to show — so `pairing.ts` returns those rather than
 * throwing them. See `PairingFailure`.
 */

export type SyncCryptoErrorCode =
  /** A wrap was opened under a context whose purpose does not match the stored one. */
  | "wrap/purpose-mismatch"
  /** The key-commitment tag did not match: this key does not open this wrap. */
  | "wrap/commitment-mismatch"
  /** The wrap authenticated its commitment but failed AEAD — edited ciphertext. */
  | "wrap/aead-failed"
  /** A wrap's stored fields are not the shape or size a wrap has. */
  | "wrap/malformed"
  /** A row failed AEAD: wrong content key, edited bytes, or moved by the server. */
  | "row/aead-failed"
  /** A row's stored fields are not the shape or size a sealed row has. */
  | "row/malformed"
  /** A row's plaintext did not decode as the canonical JSON field map it must be. */
  | "row/bad-plaintext"
  /** An email or password could not be normalised into something derivable. */
  | "kdf/bad-input";

/** Thrown by `wrap.ts`, `row.ts` and `kdf.ts`; never by `pairing.ts`, `hlc.ts` or `merge.ts`. */
export class SyncCryptoError extends Error {
  readonly code: SyncCryptoErrorCode;

  constructor(code: SyncCryptoErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SyncCryptoError";
    this.code = code;
  }
}
