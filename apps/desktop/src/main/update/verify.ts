import { createHash, createPublicKey, verify } from "node:crypto";

/**
 * The two primitives the install path is built out of, kept apart from the
 * service so they can be tested without a session, a file or a network — and
 * so the exact call under test is `crypto.verify(null, …)`, which is the shape
 * the brief pins for an Ed25519 detached signature.
 */

/**
 * Verifies a detached Ed25519 signature over `data`.
 *
 * `null` as the algorithm is not a shortcut: for Ed25519, Node requires the
 * algorithm to be `null` (the key carries the scheme), and passing `"sha256"`
 * would hash the bytes first and verify a DIFFERENT statement than the one the
 * release workflow signs. Any error — a malformed PEM, a signature of the
 * wrong length — answers `false`, because "I could not check it" and "it is
 * wrong" must lead to the same refusal to install.
 */
export function verifyDetachedSignature(input: {
  readonly data: Uint8Array;
  readonly signature: Uint8Array;
  readonly publicKeyPem: string;
}): boolean {
  try {
    const key = createPublicKey(input.publicKeyPem);
    return verify(null, input.data, key, input.signature);
  } catch {
    return false;
  }
}

/** Lower-case hex SHA-256 of a buffer, for the pre-launch re-hash. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
