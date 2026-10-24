import { createHash, createPublicKey } from "node:crypto";
import { expect, it } from "vitest";

import { RELEASE_PUBLIC_KEY_PEM } from "./releaseKey.js";

/**
 * The release workflow compares its secret with this key before publishing, but
 * that check runs only on a tag. Pin the public key's SPKI fingerprint here as
 * well so an accidental edit fails the ordinary suite, while an intentional
 * rotation has to update this value and its ADR in the same change.
 */
const RELEASE_PUBLIC_KEY_SHA256 =
  "da00340566fbe5ab1c30ceaf4e618af63d4900c3d16a3b4f77947ee579767f90";

it("compiles the Ed25519 release key recorded by ADR-121", () => {
  const key = createPublicKey(RELEASE_PUBLIC_KEY_PEM);
  const spki = key.export({ type: "spki", format: "der" });
  expect(key.asymmetricKeyType).toBe("ed25519");
  expect(createHash("sha256").update(spki).digest("hex")).toBe(RELEASE_PUBLIC_KEY_SHA256);
});
