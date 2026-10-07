import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";

import { sha256Hex, verifyDetachedSignature } from "./verify.js";

/**
 * A key pair generated per test, never a fixture. The committed public key is
 * for releases; a test that used it would need the private half to produce a
 * signature, which is exactly the thing that must never be in this repository.
 */
function keyPair(): { publicKeyPem: string; privateKey: KeyObject } {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: pair.privateKey,
  };
}

describe("the detached signature check", () => {
  it("accepts a signature over the exact bytes", () => {
    const { publicKeyPem, privateKey } = keyPair();
    const data = new TextEncoder().encode("a1b2  Nexus-Setup-1.5.0.exe\n");
    const signature = new Uint8Array(sign(null, data, privateKey));
    expect(verifyDetachedSignature({ data, signature, publicKeyPem })).toBe(true);
  });

  it("refuses a signature over different bytes", () => {
    const { publicKeyPem, privateKey } = keyPair();
    const data = new TextEncoder().encode("a1b2  Nexus-Setup-1.5.0.exe\n");
    const signature = new Uint8Array(sign(null, data, privateKey));
    const tampered = new TextEncoder().encode("a1b2  Nexus-Setup-1.5.0.exe\n\n");
    expect(verifyDetachedSignature({ data: tampered, signature, publicKeyPem })).toBe(false);
  });

  it("refuses a signature from another key, and a wrong-length one", () => {
    const { publicKeyPem } = keyPair();
    const other = keyPair();
    const data = new TextEncoder().encode("bytes");
    const foreign = new Uint8Array(sign(null, data, other.privateKey));
    expect(verifyDetachedSignature({ data, signature: foreign, publicKeyPem })).toBe(false);
    expect(
      verifyDetachedSignature({ data, signature: new Uint8Array([1, 2, 3]), publicKeyPem }),
    ).toBe(false);
  });

  it("refuses a missing or malformed key rather than throwing", () => {
    const data = new TextEncoder().encode("bytes");
    const signature = new Uint8Array([1, 2, 3]);
    expect(verifyDetachedSignature({ data, signature, publicKeyPem: "" })).toBe(false);
    expect(verifyDetachedSignature({ data, signature, publicKeyPem: "not a pem" })).toBe(false);
  });

  it("hashes bytes the way the release workflow does", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

/**
 * The OpenSSL half of the contract, pinned to bytes rather than to a live
 * `openssl` binary.
 *
 * The release workflow signs with `openssl pkeyutl -sign -rawin` and the app
 * verifies with `crypto.verify(null, …)`. The two agree only when both treat
 * the input as the same raw bytes, so a signature OpenSSL actually produced is
 * checked here. The key is a throwaway generated for this fixture alone, never
 * the release key: the release key's private half must never be in the
 * repository, so a fixture that used it could not produce a signature at all.
 */
const OPENSSL_FIXTURE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAwf210drgEbH+17xPl0c2/odJNe0z0QK05BZAqPvDSbs=
-----END PUBLIC KEY-----
`;
/** The exact `SHA256SUMS.txt` bytes OpenSSL signed, LF line ends. */
const OPENSSL_FIXTURE_TEXT =
  "9c0d294c05fc1d88d698034609bb81c0c69196327594e4c69d2915c80fd9850c  Nexus-Setup-1.5.0.exe\n" +
  "7367ab9a454559025d4d8ee2241d74682674f0e62c344695d23cfb2f080dd0a9  THIRD-PARTY-NOTICES.md\n";
const OPENSSL_FIXTURE_SIGNATURE =
  "44giC+/5HPtXZmtBsdAA9z8IfZHn0EXcF3YSjI8BY+4geUmCXuI1vkRvC+ebIyHk6seyncou3Dkz9LAobBowCw==";

describe("the OpenSSL signature the release workflow produces", () => {
  it("verifies against the throwaway fixture key", () => {
    expect(
      verifyDetachedSignature({
        data: new TextEncoder().encode(OPENSSL_FIXTURE_TEXT),
        signature: Buffer.from(OPENSSL_FIXTURE_SIGNATURE, "base64"),
        publicKeyPem: OPENSSL_FIXTURE_PUBLIC_KEY,
      }),
    ).toBe(true);
  });

  it("fails when one byte of the signed text is flipped", () => {
    const flipped = new TextEncoder().encode(OPENSSL_FIXTURE_TEXT);
    // The first byte is the character „9"; any change makes it a different
    // string, which is the whole statement the signature covers.
    flipped[0] = flipped[0] === 0x39 ? 0x38 : 0x39;
    expect(
      verifyDetachedSignature({
        data: flipped,
        signature: Buffer.from(OPENSSL_FIXTURE_SIGNATURE, "base64"),
        publicKeyPem: OPENSSL_FIXTURE_PUBLIC_KEY,
      }),
    ).toBe(false);
  });
});
