/**
 * The two primitives the pack layer is built out of.
 *
 * **There is no second verifier.** A pack is signed by the same Ed25519 key and
 * checked by the same call as a release: `verifyDetachedSignature` from
 * `update/verify.ts`, over the exact bytes of a small file, with the public key
 * compiled into the binary. A second implementation of "does this signature
 * check out" is a second thing to get wrong, and the one that is wrong is the
 * one nobody reviewed — so `verifyPackSignature` is a thin wrapper.
 *
 * **What it adds is a context.** The release key also signs `SHA256SUMS.txt`
 * for the updater, so a pack signature covers `PACK_SIGNATURE_CONTEXT` followed
 * by the manifest, never the manifest alone. A signature made for one of the two
 * jobs therefore cannot verify as the other, whatever the two files' formats
 * ever come to share.
 *
 * Hashing a content file streams. A pack's file can be twenty gigabytes, and
 * the only acceptable amount of it in memory at once is one chunk: `sha256File`
 * reads through the file with a `for await` loop and never holds more than the
 * stream's own buffer.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

import { verifyDetachedSignature } from "../update/verify.js";

/**
 * The bytes a pack signature is made over come after this. `scripts/pack-sign.mjs`
 * spells the same string, and its test reads this file to hold the two together.
 */
export const PACK_SIGNATURE_CONTEXT = "nexus-pack-manifest-v1\n";

/** What is actually signed: the context, then the manifest's exact bytes. */
export function packSignedBytes(manifestBytes: Uint8Array): Uint8Array {
  return Buffer.concat([Buffer.from(PACK_SIGNATURE_CONTEXT, "utf8"), manifestBytes]);
}

/**
 * The same arrangement for the CATALOGUE (ADR-103), and a THIRD context.
 *
 * The release key now signs three kinds of document: `SHA256SUMS.txt` for the
 * updater, a pack's `pack.json`, and the catalogue that lists the packs. The
 * context is what keeps any one of them from being presented as another, and a
 * third document is exactly the case the first two contexts were written for:
 * were the catalogue signed over its bytes alone, a pack's signed manifest
 * would be a valid catalogue, and a catalogue entry could be smuggled into a
 * pack. `scripts/pack-sign.mjs` spells the same string, and its test reads this
 * file to hold the two together.
 */
export const PACK_CATALOGUE_SIGNATURE_CONTEXT = "nexus-pack-catalogue-v1\n";

/** What a catalogue signature is made over: the context, then the document's exact bytes. */
export function catalogueSignedBytes(catalogueBytes: Uint8Array): Uint8Array {
  return Buffer.concat([Buffer.from(PACK_CATALOGUE_SIGNATURE_CONTEXT, "utf8"), catalogueBytes]);
}

/**
 * Whether `signatureBytes` is the pinned key's signature over the context and
 * exactly `manifestBytes`. Any error — a malformed key, a signature of the wrong
 * length — answers `false`, for `verifyDetachedSignature`'s reason: "I could
 * not check it" and "it is wrong" must lead to the same refusal to install.
 */
export function verifyPackSignature(input: {
  readonly manifestBytes: Uint8Array;
  readonly signatureBytes: Uint8Array;
  readonly publicKeyPem: string;
}): boolean {
  return verifyDetachedSignature({
    data: packSignedBytes(input.manifestBytes),
    signature: input.signatureBytes,
    publicKeyPem: input.publicKeyPem,
  });
}

/**
 * Whether `signatureBytes` is the pinned key's signature over the context and
 * exactly `catalogueBytes`. The refusals and the reason for the context are
 * {@link verifyPackSignature}'s; only the string differs.
 */
export function verifyCatalogueSignature(input: {
  readonly catalogueBytes: Uint8Array;
  readonly signatureBytes: Uint8Array;
  readonly publicKeyPem: string;
}): boolean {
  return verifyDetachedSignature({
    data: catalogueSignedBytes(input.catalogueBytes),
    signature: input.signatureBytes,
    publicKeyPem: input.publicKeyPem,
  });
}

/**
 * Lower-case hex SHA-256 of a file, read in a stream.
 *
 * `onChunk`, when given, is called with each chunk's length so a long hash can
 * report how far it has got. It is the only reason this is not `readFile` plus
 * `createHash`.
 */
export async function sha256File(
  path: string,
  onChunk?: ((bytes: number) => void) | undefined,
): Promise<string> {
  const hash = createHash("sha256");
  // `for await` on the read stream destroys it on a throw as well as on
  // completion, so a refused file does not leave a descriptor open.
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    hash.update(bytes);
    if (onChunk !== undefined) onChunk(bytes.byteLength);
  }
  return hash.digest("hex");
}
