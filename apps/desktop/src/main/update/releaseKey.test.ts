import { createHash, createPublicKey } from "node:crypto";
import { expect, it } from "vitest";

import {
  LEGACY_PACK_PUBLIC_KEY_PEM,
  PACK_PUBLIC_KEYRING_PEM,
  RELEASE_PUBLIC_KEY_PEM,
} from "./releaseKey.js";

/**
 * The release workflow compares its secret with this key before publishing, but
 * that check runs only on a tag. Pin the public key's SPKI fingerprint here as
 * well so an accidental edit fails the ordinary suite, while an intentional
 * rotation has to update this value and its ADR in the same change.
 */
const RELEASE_PUBLIC_KEY_SHA256 =
  "da00340566fbe5ab1c30ceaf4e618af63d4900c3d16a3b4f77947ee579767f90";
const LEGACY_PACK_PUBLIC_KEY_SHA256 =
  "b46f8c0029f1de1f7d4a997e870d0346fbbe223c7a4a5e03c22625479e484223";

function fingerprint(publicKeyPem: string): string {
  const spki = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(spki).digest("hex");
}

it("compiles the Ed25519 release key recorded by ADR-121", () => {
  const key = createPublicKey(RELEASE_PUBLIC_KEY_PEM);
  expect(key.asymmetricKeyType).toBe("ed25519");
  expect(fingerprint(RELEASE_PUBLIC_KEY_PEM)).toBe(RELEASE_PUBLIC_KEY_SHA256);
});

it("keeps the retired key only in the content-pack keyring", () => {
  expect(PACK_PUBLIC_KEYRING_PEM).toContain(RELEASE_PUBLIC_KEY_PEM);
  expect(PACK_PUBLIC_KEYRING_PEM).toContain(LEGACY_PACK_PUBLIC_KEY_PEM);
  expect(fingerprint(LEGACY_PACK_PUBLIC_KEY_PEM)).toBe(LEGACY_PACK_PUBLIC_KEY_SHA256);
});
