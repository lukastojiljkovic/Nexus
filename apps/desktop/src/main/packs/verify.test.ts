import { generateKeyPairSync, sign } from "node:crypto";
import { expect, it } from "vitest";

import { packSignedBytes, verifyPackSignature } from "./verify.js";

function keyPair(): { publicKeyPem: string; privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"] } {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: pair.privateKey,
  };
}

it("accepts a pack signature from any key in the ordered keyring", () => {
  const retired = keyPair();
  const current = keyPair();
  const manifestBytes = new TextEncoder().encode('{"id":"example"}');
  const signatureBytes = new Uint8Array(sign(null, packSignedBytes(manifestBytes), current.privateKey));

  expect(
    verifyPackSignature({
      manifestBytes,
      signatureBytes,
      publicKeyPem: `${retired.publicKeyPem}${current.publicKeyPem}`,
    }),
  ).toBe(true);
});
