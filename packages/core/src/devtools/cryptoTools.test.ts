import { beforeAll, describe, expect, it } from "vitest";

import {
  AMBIGUOUS_CHARACTERS,
  MAX_TOKEN_COUNT,
  MAX_TOKEN_LENGTH,
  PBKDF2_MIN_ITERATIONS,
  PEM_LABEL_PRIVATE,
  PEM_LABEL_PUBLIC,
  WORD_LISTS,
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  bytesToHex,
  bytesToText,
  decodeJwt,
  decryptAes,
  digestText,
  encryptAes,
  formatAesEnvelope,
  fromPem,
  generateEcKeyPair,
  generatePassphrase,
  generatePassword,
  generateRsaKeyPair,
  generateTokens,
  hashAvailability,
  hexToBytes,
  hmacBytes,
  hmacText,
  parseAesEnvelope,
  rsaDecrypt,
  rsaEncrypt,
  rsaOaepMaxPlaintextBytes,
  signMessage,
  textToBytes,
  toPem,
  verifyJwt,
  verifyMessage,
  wordList,
} from "./cryptoTools.js";
import type { RandomPort } from "./random.js";
import type {
  AesEnvelope,
  CryptoToolResult,
  PemKeyPair,
  RsaModulusSize,
  SignatureAlgorithm,
} from "./cryptoTools.js";

/**
 * A port that hands out a fixed byte sequence, cycling. Every generator test
 * below states the sequence AND the string it must produce, so „is the sampler
 * unbiased" stops being an argument and becomes an assertion.
 */
function fixedRandom(sequence: readonly number[]): RandomPort {
  let offset = 0;
  return {
    bytes(count: number): Uint8Array {
      const out = new Uint8Array(count);
      for (let i = 0; i < count; i += 1) out[i] = sequence[(offset + i) % sequence.length] ?? 0;
      offset += count;
      return out;
    },
  };
}

/** Unwraps a result, failing the test with the refusal code rather than a bare `undefined`. */
function value<T>(result: CryptoToolResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.failure)}`);
  return result.value;
}

/** The refusal code, or a readable complaint that there wasn't one. */
function code(result: CryptoToolResult<unknown>): string {
  return result.ok ? "ok" : result.failure.code;
}

describe("encodings", () => {
  it("round-trips hex", () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0x10, 0x7f, 0x80, 0xff]);
    expect(bytesToHex(bytes)).toBe("000f107f80ff");
    expect(hexToBytes("000f107f80ff")).toStrictEqual(bytes);
  });

  it("accepts hex wrapped across lines but refuses an odd digit count", () => {
    // Rejoining a pasted dump is not repairing a value; inventing a nibble is.
    expect(hexToBytes("dead\n beef")).toStrictEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(hexToBytes("abc")).toBeNull();
    expect(hexToBytes("zz")).toBeNull();
  });

  it("round-trips standard base64 and refuses what is not base64", () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00]);
    // 11111011 11111111 10111111 00000000 regrouped into sixes is
    // 111110 111111 111110 111111 000000 00 -> 62, 63, 62, 63, 0, 0(padded)
    // -> "+/+/AA==", which exercises both of the characters base64url renames.
    expect(bytesToBase64(bytes)).toBe("+/+/AA==");
    expect(base64ToBytes("+/+/AA==")).toStrictEqual(bytes);
    expect(base64ToBytes("+/+/AA")).toStrictEqual(bytes);
    expect(base64ToBytes("!!!!")).toBeNull();
    // Four base64 characters carry three bytes, so a lone trailing character
    // cannot come from any byte string.
    expect(base64ToBytes("AAAAA")).toBeNull();
    // Padding that does not complete a group, and padding with nothing to pad.
    expect(base64ToBytes("QQ=")).toBeNull();
    expect(base64ToBytes("==")).toBeNull();
    expect(base64ToBytes("QQ==")).toStrictEqual(new Uint8Array([0x41]));
    expect(base64ToBytes("")).toStrictEqual(new Uint8Array(0));
  });

  it("writes base64url without padding and reads it back strictly", () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00]);
    // The same bytes: 62 becomes "-" and 63 becomes "_", and the padding goes.
    expect(bytesToBase64Url(bytes)).toBe("-_-_AA");
    expect(base64UrlToBytes("-_-_AA")).toStrictEqual(bytes);
    // RFC 7515 §2 omits the padding, so a padded segment is not a JWS segment.
    expect(base64UrlToBytes("-_-_AA==")).toBeNull();
    expect(base64UrlToBytes("+/+/AA")).toBeNull();
  });

  it("refuses bytes that are not UTF-8 instead of substituting replacements", () => {
    expect(bytesToText(textToBytes("ćirilica i š"))).toBe("ćirilica i š");
    // 0x80 is a continuation byte with nothing to continue.
    expect(bytesToText(new Uint8Array([0x80]))).toBeNull();
  });
});

describe("PEM", () => {
  /** 100 bytes -> ceil(100/3)*4 = 136 base64 characters -> lines of 64, 64 and 8. */
  const der = new Uint8Array(100).map((_, index) => index);

  it("wraps the base64 at 64 columns and ends every line, per RFC 7468 §2", () => {
    const pem = toPem(PEM_LABEL_PUBLIC, der);
    const lines = pem.split("\n");
    expect(lines[0]).toBe("-----BEGIN PUBLIC KEY-----");
    expect(lines.slice(1, 4).map((line) => line.length)).toStrictEqual([64, 64, 8]);
    expect(lines[4]).toBe("-----END PUBLIC KEY-----");
    // A trailing line break, so the file ends on a line rather than mid-line.
    expect(lines[5]).toBe("");
    expect(pem.endsWith("\n")).toBe(true);
  });

  it("round-trips DER through PEM", () => {
    expect(value(fromPem(toPem(PEM_LABEL_PRIVATE, der))).der).toStrictEqual(der);
    expect(value(fromPem(toPem(PEM_LABEL_PRIVATE, der))).label).toBe(PEM_LABEL_PRIVATE);
  });

  it("refuses a block whose BEGIN and END disagree rather than believing one of them", () => {
    const broken = "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PUBLIC KEY-----\n";
    expect(code(fromPem(broken))).toBe("pem-malformed");
    expect(code(fromPem("not a pem at all"))).toBe("pem-malformed");
  });

  it("names the label it found when the caller wanted another", () => {
    const result = fromPem(toPem(PEM_LABEL_PRIVATE, der), PEM_LABEL_PUBLIC);
    expect(code(result)).toBe("pem-wrong-label");
    expect(result.ok ? null : result.failure.subject).toBe(PEM_LABEL_PRIVATE);
  });
});

describe("token generator", () => {
  it("maps the low nibble of each byte onto the hex alphabet", () => {
    // Bytes 0…15, masked to 4 bits, are the alphabet in order.
    const random = fixedRandom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    const batch = value(generateTokens({ length: 16, alphabet: "hex" }, random));
    expect(batch.tokens).toStrictEqual(["0123456789abcdef"]);
  });

  /**
   * THE test this tool exists for. base58 needs 6 bits, so the mask is 0x3f and
   * the values 58…63 have no character. Fed 0x3f then 0x3e then 0x00 then 0x01:
   *   rejection sampling discards 63 and 62 and answers "12" (alphabet[0], [1]);
   *   `byte % 58` would answer "65" (63−58 = 5 → alphabet[5], 62−58 = 4 → [4]).
   * The second string is what a biased generator produces, so the test names it.
   */
  it("discards out-of-range draws instead of folding them back with a modulo", () => {
    const random = fixedRandom([0x3f, 0x3e, 0x00, 0x01]);
    const batch = value(generateTokens({ length: 2, alphabet: "base58" }, random));
    expect(batch.tokens[0]).toBe("12");
    expect(batch.tokens[0]).not.toBe("65");
  });

  it("reports entropy from the alphabet actually used", () => {
    const batch = value(generateTokens({ length: 22, alphabet: "base58" }));
    // log2(58) = 6 − log2(64/58) = 5.857981; × 22 = 128.875582.
    expect(batch.alphabetSize).toBe(58);
    expect(batch.entropyBitsPerToken).toBeCloseTo(128.8756, 3);
    expect(value(generateTokens({ length: 16, alphabet: "hex" })).entropyBitsPerToken).toBe(64);
  });

  it("makes as many tokens as asked, each of the asked length", () => {
    const batch = value(generateTokens({ length: 12, alphabet: "base64url", count: 25 }));
    expect(batch.tokens).toHaveLength(25);
    for (const token of batch.tokens) {
      expect(token).toHaveLength(12);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    // Twenty-five 72-bit tokens colliding would mean the sampler is broken.
    expect(new Set(batch.tokens).size).toBe(25);
  });

  it("uses a custom alphabet exactly as given", () => {
    const random = fixedRandom([0, 1, 1, 0]);
    const tokens = value(
      generateTokens({ length: 4, alphabet: "custom", customAlphabet: "ab" }, random),
    ).tokens;
    expect(tokens).toStrictEqual(["abba"]);
  });

  it("refuses a custom alphabet that repeats a character rather than deduplicating it", () => {
    const request = { length: 8, alphabet: "custom", customAlphabet: "aabc" } as const;
    expect(code(generateTokens(request))).toBe("alphabet-repeats");
    expect(code(generateTokens({ length: 8, alphabet: "custom", customAlphabet: "x" }))).toBe(
      "alphabet-too-small",
    );
  });

  it("refuses lengths and counts outside its range", () => {
    expect(code(generateTokens({ length: 0, alphabet: "hex" }))).toBe("length-out-of-range");
    expect(code(generateTokens({ length: MAX_TOKEN_LENGTH + 1, alphabet: "hex" }))).toBe(
      "length-out-of-range",
    );
    expect(code(generateTokens({ length: 8, alphabet: "hex", count: 0 }))).toBe(
      "count-out-of-range",
    );
    expect(code(generateTokens({ length: 8, alphabet: "hex", count: MAX_TOKEN_COUNT + 1 }))).toBe(
      "count-out-of-range",
    );
  });

  it("gives up rather than looping when a port never produces an in-range draw", () => {
    // 0xff masked to 6 bits is 63, which base58 has no character for. Forever.
    const random = fixedRandom([0xff]);
    expect(code(generateTokens({ length: 4, alphabet: "base58" }, random))).toBe(
      "randomness-exhausted",
    );
  });
});

describe("password generator", () => {
  it("reports length · log2(alphabet) when nothing is required", () => {
    const generated = value(
      generatePassword({ length: 10, classes: ["lower", "upper", "digit", "symbol"] }),
    );
    // 26 + 26 + 10 + 27 = 89 characters. log2(89) = 6.4757366; × 10 = 64.757366.
    expect(generated.alphabetSize).toBe(89);
    expect(generated.entropyBits).toBeCloseTo(64.7574, 3);
    expect(generated.password).toHaveLength(10);
  });

  /**
   * Require-each-class draws uniformly over a SMALLER set, so the honest figure
   * is lower. Counted by hand: two characters over lower+digit with one of each
   * is „letter then digit" or „digit then letter" — 2 · 26 · 10 = 520 strings,
   * against 36² = 1296 unrestricted. log2(520) = 9 + log2(1.015625) = 9.022368.
   */
  it("reports the restricted count when every class is required", () => {
    const generated = value(
      generatePassword({ length: 2, classes: ["lower", "digit"], requireEachClass: true }),
    );
    expect(generated.entropyBits).toBeCloseTo(9.0224, 3);
    // And it is strictly below the unrestricted 2 · log2(36) = 10.339850.
    expect(generated.entropyBits).toBeLessThan(2 * Math.log2(36));
  });

  it("actually delivers one of each class when asked", () => {
    for (let round = 0; round < 20; round += 1) {
      const password = value(
        generatePassword({
          length: 8,
          classes: ["lower", "upper", "digit", "symbol"],
          requireEachClass: true,
        }),
      ).password;
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!$%&()*+,\-./:;<=>?@[\]^_{|}~]/);
    }
  });

  it("drops the confusable glyphs from every class when asked", () => {
    const generated = value(
      generatePassword({
        length: 40,
        classes: ["lower", "upper", "digit"],
        excludeAmbiguous: true,
      }),
    );
    // 26 − 1 (l) + 26 − 2 (O, I) + 10 − 2 (0, 1) = 25 + 24 + 8 = 57.
    expect(generated.alphabetSize).toBe(57);
    for (const ch of AMBIGUOUS_CHARACTERS) expect(generated.password).not.toContain(ch);
  });

  it("refuses a password too short to hold every required class", () => {
    const result = generatePassword({
      length: 3,
      classes: ["lower", "upper", "digit", "symbol"],
      requireEachClass: true,
    });
    expect(code(result)).toBe("length-below-required-classes");
    expect(result.ok ? null : result.failure.limit).toBe(4);
  });

  it("refuses an empty class selection and an impossible length", () => {
    expect(code(generatePassword({ length: 12, classes: [] }))).toBe("no-character-classes");
    expect(code(generatePassword({ length: 0, classes: ["lower"] }))).toBe("length-out-of-range");
  });

  it("gives up when a stuck port can never satisfy the class requirement", () => {
    // Every draw is index 0 — the first lower-case letter — so no digit ever
    // appears and the rejection loop can only run out.
    const random = fixedRandom([0]);
    const result = generatePassword(
      { length: 4, classes: ["lower", "digit"], requireEachClass: true },
      random,
    );
    expect(code(result)).toBe("randomness-exhausted");
  });
});

describe("passphrase", () => {
  it("ships two lists of exactly 256 distinct, diacritic-free words", () => {
    for (const id of WORD_LISTS) {
      const words = wordList(id);
      expect(words, id).toHaveLength(256);
      expect(new Set(words).size, id).toBe(256);
      // /^[a-z]+$/ is also the diacritic test: š, č, ć, ž and đ are not in a–z.
      for (const word of words) expect(word, `${id}:${word}`).toMatch(/^[a-z]{3,}$/);
    }
  });

  it("counts entropy in words, never in characters", () => {
    const generated = value(generatePassphrase({ words: 6, list: "sr" }));
    // 256 words is 8 bits each, so six words is 48 bits — exactly, no rounding.
    expect(generated.entropyBits).toBe(48);
    expect(generated.words).toHaveLength(6);
    // The character-count answer for the same string would be far larger; that
    // it is not is the whole point of the field.
    expect(generated.entropyBits).toBeLessThan(generated.passphrase.length * Math.log2(27));
  });

  it("joins with the separator and capitalizes without claiming extra bits", () => {
    const random = fixedRandom([0]);
    const generated = value(
      generatePassphrase({ words: 3, list: "en", separator: ".", capitalize: true }, random),
    );
    // Index 0 every time, so all three words are the list's first entry.
    expect(generated.passphrase).toBe("Apple.Apple.Apple");
    expect(generated.entropyBits).toBe(24);
  });

  it("refuses a word count outside its range", () => {
    expect(code(generatePassphrase({ words: 0, list: "sr" }))).toBe("word-count-out-of-range");
    expect(code(generatePassphrase({ words: 33, list: "sr" }))).toBe("word-count-out-of-range");
  });
});

describe("hashing", () => {
  // FIPS PUB 180-4 example digests.
  const ABC = {
    "SHA-1": "a9993e364706816aba3e25717850c26c9cd0d89d",
    "SHA-256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "SHA-384":
      "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed" +
      "8086072ba1e7cc2358baeca134c825a7",
    "SHA-512":
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a" +
      "2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
  } as const;

  const EMPTY = {
    "SHA-1": "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    "SHA-256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "SHA-384":
      "38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da" +
      "274edebfe76f65fbd51ad2f14898b95b",
    "SHA-512":
      "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce" +
      "47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
  } as const;

  it("matches FIPS 180-4 for \"abc\" and for the empty input", async () => {
    for (const [algorithm, hex] of Object.entries(ABC)) {
      const digest = value(await digestText("abc", algorithm as keyof typeof ABC));
      expect(digest.hex, algorithm).toBe(hex);
    }
    for (const [algorithm, hex] of Object.entries(EMPTY)) {
      const digest = value(await digestText("", algorithm as keyof typeof EMPTY));
      expect(digest.hex, algorithm).toBe(hex);
    }
  });

  it("gives hex and base64 of the same bytes", async () => {
    const digest = value(await digestText("abc", "SHA-256"));
    expect(bytesToHex(base64ToBytes(digest.base64) ?? new Uint8Array())).toBe(digest.hex);
    expect(digest.bytes).toHaveLength(32);
  });

  it("matches RFC 4231 test case 1 (key 0x0b × 20, \"Hi There\")", async () => {
    const key = new Uint8Array(20).fill(0x0b);
    const data = textToBytes("Hi There");
    expect(value(await hmacBytes(key, data, "SHA-256")).hex).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );
    expect(value(await hmacBytes(key, data, "SHA-384")).hex).toBe(
      "afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59c" +
        "faea9ea9076ede7f4af152e8b2fa9cb6",
    );
    expect(value(await hmacBytes(key, data, "SHA-512")).hex).toBe(
      "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cde" +
        "daa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854",
    );
    // RFC 2202 test case 1, the SHA-1 half of the same input.
    expect(value(await hmacBytes(key, data, "SHA-1")).hex).toBe(
      "b617318655057264e28bc0b6fb378c8ef146be00",
    );
  });

  it("matches RFC 4231 / RFC 2202 test case 2 (key \"Jefe\")", async () => {
    const message = "what do ya want for nothing?";
    expect(value(await hmacText("Jefe", message, "SHA-256")).hex).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
    expect(value(await hmacText("Jefe", message, "SHA-1")).hex).toBe(
      "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79",
    );
  });

  /**
   * RFC 2104's key schedule zero-pads a short key to the block size, so an
   * empty key and a block of zeros are the same key. WebCrypto refuses to
   * import the empty one; the substitution has to change no output, and the
   * block size has to follow the hash — 64 bytes for SHA-256, 128 for SHA-512.
   */
  it("treats an empty HMAC key as a zero-filled block, per hash", async () => {
    const message = textToBytes("nexus");
    for (const [algorithm, blockBytes] of [["SHA-256", 64], ["SHA-512", 128]] as const) {
      const empty = value(await hmacBytes(new Uint8Array(0), message, algorithm));
      const zeros = value(await hmacBytes(new Uint8Array(blockBytes), message, algorithm));
      expect(empty.hex, algorithm).toBe(zeros.hex);
    }
  });

  it("reports MD5 as unavailable rather than pretending it is merely unknown", () => {
    const md5 = hashAvailability("md5");
    expect(code(md5)).toBe("hash-unavailable");
    expect(md5.ok ? null : md5.failure.subject).toBe("MD5");
    expect(value(hashAvailability(" sha-256 "))).toBe("SHA-256");
    expect(code(hashAvailability("whirlpool"))).toBe("unsupported-algorithm");
  });
});

describe("JWT", () => {
  /** RFC 7515 Appendix A.1, the HMAC-SHA-256 example, verbatim. */
  const RFC_HS256 =
    "eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9" +
    ".eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFt" +
    "cGxlLmNvbS9pc19yb290Ijp0cnVlfQ" +
    ".dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  /** The `k` of that appendix's `oct` JWK. */
  const RFC_KEY =
    "AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow";

  /** The example's `exp`, in milliseconds — 2011-03-22T18:43:00Z. */
  const RFC_EXP_MS = 1300819380 * 1000;

  function encodeSegment(claims: Record<string, unknown>): string {
    return bytesToBase64Url(textToBytes(JSON.stringify(claims)));
  }

  it("pulls the RFC 7515 example apart and names its registered claims", () => {
    const decoded = value(decodeJwt(RFC_HS256, RFC_EXP_MS - 1));
    expect(decoded.header["alg"]).toBe("HS256");
    expect(decoded.header["typ"]).toBe("JWT");
    expect(decoded.payload["iss"]).toBe("joe");
    expect(decoded.payload["exp"]).toBe(1300819380);
    expect(decoded.claims).toHaveLength(3);
    expect(decoded.support).toStrictEqual({ supported: true, algorithm: "HS256" });

    const exp = decoded.claims.find((claim) => claim.name === "exp");
    expect(exp?.registered).toBe(true);
    // 1300819380 s = 15055 days + 67380 s; day 15055 is 2011-03-22 and
    // 67380 s is 18:43:00.
    expect(exp?.instant).toBe("2011-03-22T18:43:00.000Z");
    // The third claim is a private one and is shown, unnamed but not dropped.
    expect(decoded.claims.filter((claim) => !claim.registered)).toHaveLength(1);
  });

  it("puts the exp and nbf boundaries on opposite sides, as RFC 7519 §4.1.4/4.1.5 does", () => {
    // §4.1.4: not to be accepted ON or after `exp`, so the boundary is expired.
    expect(value(decodeJwt(RFC_HS256, RFC_EXP_MS - 1)).validity.valid).toBe(true);
    expect(value(decodeJwt(RFC_HS256, RFC_EXP_MS)).validity.expired).toBe(true);
    expect(value(decodeJwt(RFC_HS256, RFC_EXP_MS)).validity.valid).toBe(false);

    // §4.1.5: not before `nbf`, so the boundary instant IS acceptable.
    const token = `${encodeSegment({ alg: "HS256" })}.${encodeSegment({ nbf: 1000 })}.AA`;
    expect(value(decodeJwt(token, 999_999)).validity.notYetValid).toBe(true);
    expect(value(decodeJwt(token, 1_000_000)).validity.notYetValid).toBe(false);
    expect(value(decodeJwt(token, 1_000_000)).validity.valid).toBe(true);
  });

  it("says a token with neither exp nor nbf is unbounded rather than blessed", () => {
    const token = `${encodeSegment({ alg: "HS256" })}.${encodeSegment({ iss: "joe" })}.AA`;
    const validity = value(decodeJwt(token, 0)).validity;
    expect(validity.bounded).toBe(false);
    expect(validity.valid).toBe(true);
  });

  it("lists a time claim it could not read instead of ignoring it", () => {
    const token = `${encodeSegment({ alg: "HS256" })}.${encodeSegment({ exp: "sutra" })}.AA`;
    const validity = value(decodeJwt(token, 0)).validity;
    expect(validity.unreadable).toStrictEqual(["exp"]);
    expect(validity.bounded).toBe(false);
  });

  it("verifies the RFC 7515 signature from the oct JWK and from the raw secret", async () => {
    const jwk = await verifyJwt(RFC_HS256, { kind: "jwk", jwk: { kty: "oct", k: RFC_KEY } }, 0);
    expect(value(jwk).signatureValid).toBe(true);

    const secret = base64UrlToBytes(RFC_KEY);
    expect(secret).not.toBeNull();
    const key = { kind: "secret", secret: secret ?? new Uint8Array() } as const;
    const raw = await verifyJwt(RFC_HS256, key, 0);
    expect(value(raw).signatureValid).toBe(true);
  });

  it("answers false — not an error — for the wrong secret", async () => {
    const result = await verifyJwt(RFC_HS256, { kind: "secret", secret: textToBytes("nope") }, 0);
    expect(value(result).signatureValid).toBe(false);
    // And the decode still came back, because you asked to look at the token.
    expect(value(result).decoded.payload["iss"]).toBe("joe");
  });

  it("refuses alg: none loudly while still decoding the token", async () => {
    const token = `${encodeSegment({ alg: "none" })}.${encodeSegment({ iss: "joe" })}.`;
    const decoded = value(decodeJwt(token, 0));
    expect(decoded.support).toStrictEqual({ supported: false, reason: "none", algorithm: "none" });
    expect(decoded.payload["iss"]).toBe("joe");
    // No key makes this verifiable. That is the point.
    const verified = await verifyJwt(token, { kind: "secret", secret: new Uint8Array(32) }, 0);
    expect(code(verified)).toBe("jwt-alg-none");
  });

  it("names an alg it does not implement", async () => {
    const token = `${encodeSegment({ alg: "PS512" })}.${encodeSegment({ iss: "joe" })}.AA`;
    const result = await verifyJwt(token, { kind: "secret", secret: new Uint8Array(32) }, 0);
    expect(code(result)).toBe("jwt-alg-unsupported");
    expect(result.ok ? null : result.failure.subject).toBe("PS512");
  });

  it("refuses a key of the wrong kind for the algorithm", async () => {
    const pem = toPem(PEM_LABEL_PUBLIC, new Uint8Array([1]));
    const result = await verifyJwt(RFC_HS256, { kind: "pem", pem }, 0);
    expect(code(result)).toBe("jwt-key-mismatch");
  });

  it("refuses a private JWK where a public one belongs", async () => {
    const token = `${encodeSegment({ alg: "ES256" })}.${encodeSegment({ iss: "joe" })}.AA`;
    const jwk = { kty: "EC", crv: "P-256", d: "x" };
    const result = await verifyJwt(token, { kind: "jwk", jwk }, 0);
    expect(code(result)).toBe("key-is-private");
  });

  it("refuses a malformed token and a padded segment", () => {
    expect(code(decodeJwt("only.two", 0))).toBe("jwt-malformed");
    expect(code(decodeJwt("a.b.c.d", 0))).toBe("jwt-malformed");
    expect(code(decodeJwt(`${encodeSegment({ alg: "HS256" })}==.AA.AA`, 0))).toBe(
      "jwt-not-base64url",
    );
    expect(code(decodeJwt("QQ.QQ.AA", 0))).toBe("jwt-not-json");
  });
});

describe("AES", () => {
  /** 32 bytes as hex — a 256-bit key the user pasted. */
  const KEY_256_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  const KEY_128_BASE64 = bytesToBase64(new Uint8Array(16).fill(7));

  it("round-trips GCM with a raw hex key and carries the IV in the envelope", async () => {
    const key = { kind: "raw", text: KEY_256_HEX, encoding: "hex" } as const;
    const envelope = value(
      await encryptAes("tajna poruka", key, { mode: "AES-GCM", keyBits: 256 }),
    );
    expect(envelope.kdf).toBeNull();
    // 12 bytes of IV, and the ciphertext carries the 16-byte tag on the end:
    // 12 plaintext bytes + 16 = 28.
    expect(base64ToBytes(envelope.iv)).toHaveLength(12);
    expect(base64ToBytes(envelope.ciphertext)).toHaveLength(28);
    expect(value(await decryptAes(envelope, key))).toBe("tajna poruka");
  });

  it("never reuses an IV between two encryptions of the same text", async () => {
    const key = { kind: "raw", text: KEY_256_HEX, encoding: "hex" } as const;
    const options = { mode: "AES-GCM", keyBits: 256 } as const;
    const first = value(await encryptAes("isto", key, options));
    const second = value(await encryptAes("isto", key, options));
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("names a failing GCM tag rather than returning nothing", async () => {
    const key = { kind: "raw", text: KEY_256_HEX, encoding: "hex" } as const;
    const envelope = value(await encryptAes("poruka", key, { mode: "AES-GCM", keyBits: 256 }));
    const bytes = base64ToBytes(envelope.ciphertext) ?? new Uint8Array();
    bytes[0] = (bytes[0] ?? 0) ^ 0x01;
    const tampered: AesEnvelope = { ...envelope, ciphertext: bytesToBase64(bytes) };
    expect(code(await decryptAes(tampered, key))).toBe("aes-authentication-failed");
  });

  it("round-trips CBC with a base64 key, and cannot authenticate a wrong one", async () => {
    const key = { kind: "raw", text: KEY_128_BASE64, encoding: "base64" } as const;
    const envelope = value(await encryptAes("cbc tekst", key, { mode: "AES-CBC", keyBits: 128 }));
    expect(base64ToBytes(envelope.iv)).toHaveLength(16);
    expect(value(await decryptAes(envelope, key))).toBe("cbc tekst");

    // CBC is unauthenticated: a wrong key almost always breaks the padding, and
    // in the rare case it does not, the plaintext is garbage that is not UTF-8.
    // The test asserts what is actually true rather than pretending CBC can
    // tell the two apart — which is the reason to prefer GCM.
    const other = bytesToBase64(new Uint8Array(16).fill(9));
    const wrong = { kind: "raw", text: other, encoding: "base64" } as const;
    const failed = await decryptAes(envelope, wrong);
    expect(failed.ok).toBe(false);
    expect(["aes-decrypt-failed", "not-utf8"]).toContain(code(failed));
  });

  it("derives from a passphrase, recording the salt and iteration count", async () => {
    const key = {
      kind: "passphrase",
      passphrase: "lozinka za test",
      iterations: PBKDF2_MIN_ITERATIONS,
    } as const;
    const envelope = value(await encryptAes("iza lozinke", key, { mode: "AES-GCM", keyBits: 256 }));
    expect(envelope.kdf?.name).toBe("PBKDF2");
    expect(envelope.kdf?.iterations).toBe(PBKDF2_MIN_ITERATIONS);
    expect(base64ToBytes(envelope.kdf?.salt ?? "")).toHaveLength(16);
    expect(value(await decryptAes(envelope, key))).toBe("iza lozinke");

    const wrong = {
      kind: "passphrase",
      passphrase: "druga",
      iterations: PBKDF2_MIN_ITERATIONS,
    } as const;
    expect(code(await decryptAes(envelope, wrong))).toBe("aes-authentication-failed");
  });

  /**
   * The recorded count is the one that decrypts, and the key source's is
   * ignored — otherwise raising the default (or the floor) would strand every
   * file already written. Passing three times the iterations here still opens
   * the envelope, which is only possible if the envelope's number won.
   */
  it("derives on decryption from the envelope's iteration count, not the caller's", async () => {
    const written = {
      kind: "passphrase",
      passphrase: "ista lozinka",
      iterations: PBKDF2_MIN_ITERATIONS,
    } as const;
    const envelope = value(await encryptAes("sadrzaj", written, { mode: "AES-GCM", keyBits: 256 }));
    const later = {
      kind: "passphrase",
      passphrase: "ista lozinka",
      iterations: PBKDF2_MIN_ITERATIONS * 3,
    } as const;
    expect(value(await decryptAes(envelope, later))).toBe("sadrzaj");
  });

  it("refuses too few PBKDF2 iterations instead of quietly raising them", async () => {
    const key = { kind: "passphrase", passphrase: "x", iterations: 1000 } as const;
    const result = await encryptAes("y", key, { mode: "AES-GCM", keyBits: 256 });
    expect(code(result)).toBe("iterations-too-low");
    expect(result.ok ? null : result.failure.limit).toBe(PBKDF2_MIN_ITERATIONS);
  });

  it("refuses a raw key whose length does not match the requested size", async () => {
    const key = { kind: "raw", text: KEY_256_HEX, encoding: "hex" } as const;
    const result = await encryptAes("x", key, { mode: "AES-GCM", keyBits: 128 });
    expect(code(result)).toBe("key-length-mismatch");
    expect(result.ok ? null : result.failure.limit).toBe(16);
    expect(result.ok ? null : result.failure.actual).toBe(32);
  });

  it("refuses the other kind of key for the envelope it was given", async () => {
    const raw = { kind: "raw", text: KEY_256_HEX, encoding: "hex" } as const;
    const envelope = value(await encryptAes("x", raw, { mode: "AES-GCM", keyBits: 256 }));
    const passphrase = {
      kind: "passphrase",
      passphrase: "x",
      iterations: PBKDF2_MIN_ITERATIONS,
    } as const;
    expect(code(await decryptAes(envelope, passphrase))).toBe("envelope-key-mismatch");
  });

  it("round-trips the envelope through its text form", async () => {
    const key = { kind: "raw", text: KEY_256_HEX, encoding: "hex" } as const;
    const envelope = value(await encryptAes("tekst", key, { mode: "AES-GCM", keyBits: 256 }));
    expect(value(parseAesEnvelope(formatAesEnvelope(envelope)))).toStrictEqual(envelope);
    expect(code(parseAesEnvelope("{"))).toBe("envelope-malformed");
    expect(code(parseAesEnvelope(JSON.stringify({ ...envelope, mode: "AES-XTS" })))).toBe(
      "envelope-malformed",
    );
    expect(code(parseAesEnvelope(JSON.stringify({ ...envelope, version: 2 })))).toBe(
      "envelope-malformed",
    );
  });

  it("refuses an envelope whose IV is the wrong length for its mode", async () => {
    const key = { kind: "raw", text: KEY_256_HEX, encoding: "hex" } as const;
    const envelope = value(await encryptAes("x", key, { mode: "AES-GCM", keyBits: 256 }));
    const broken: AesEnvelope = { ...envelope, iv: bytesToBase64(new Uint8Array(16)) };
    expect(code(await decryptAes(broken, key))).toBe("envelope-malformed");
  });
});

describe("RSA and signatures", () => {
  // Key generation is the slow part of this suite, so every pair is made once.
  let oaep: PemKeyPair;
  let otherOaep: PemKeyPair;
  let pss: PemKeyPair;
  let p256: PemKeyPair;
  let p384: PemKeyPair;

  beforeAll(async () => {
    [oaep, otherOaep, pss, p256, p384] = await Promise.all([
      generateRsaKeyPair({ scheme: "RSA-OAEP", modulusBits: 2048 }).then(value),
      generateRsaKeyPair({ scheme: "RSA-OAEP", modulusBits: 2048 }).then(value),
      generateRsaKeyPair({ scheme: "RSA-PSS", modulusBits: 2048 }).then(value),
      generateEcKeyPair("P-256").then(value),
      generateEcKeyPair("P-384").then(value),
    ]);
  }, 60_000);

  it("exports a generated pair as PKCS#8 and SPKI PEM that parse back", () => {
    expect(oaep.privatePem.startsWith("-----BEGIN PRIVATE KEY-----\n")).toBe(true);
    expect(oaep.publicPem.startsWith("-----BEGIN PUBLIC KEY-----\n")).toBe(true);
    for (const pem of [oaep.privatePem, oaep.publicPem]) {
      for (const line of pem.trim().split("\n").slice(1, -1)) {
        expect(line.length).toBeLessThanOrEqual(64);
      }
    }
    // A 2048-bit SPKI is 294 bytes of DER; the point here is only that it is a
    // real key rather than a wrapper around nothing.
    expect(value(fromPem(oaep.publicPem, PEM_LABEL_PUBLIC)).der.length).toBeGreaterThan(200);
  });

  it("refuses a modulus size it does not offer", async () => {
    // Cast through `unknown` on purpose: the guard is a RUNTIME one, and the
    // renderer's requests arrive as JSON where the literal type proves nothing.
    const modulusBits = 1024 as unknown as RsaModulusSize;
    const result = await generateRsaKeyPair({ scheme: "RSA-OAEP", modulusBits });
    expect(code(result)).toBe("unsupported-algorithm");
    expect(result.ok ? null : result.failure.subject).toBe("1024");
  });

  it("states RSA-OAEP's maximum plaintext as RFC 8017 §7.1.1 does", () => {
    // k − 2·hLen − 2, k in bytes.
    expect(rsaOaepMaxPlaintextBytes(2048, "SHA-256")).toBe(190); // 256 − 64 − 2
    expect(rsaOaepMaxPlaintextBytes(2048, "SHA-512")).toBe(126); // 256 − 128 − 2
    expect(rsaOaepMaxPlaintextBytes(3072, "SHA-256")).toBe(318); // 384 − 64 − 2
    expect(rsaOaepMaxPlaintextBytes(4096, "SHA-384")).toBe(414); // 512 − 96 − 2
  });

  it("round-trips RSA-OAEP and refuses one byte past the maximum, with the number", async () => {
    const secret = "kljuc koji putuje";
    const encrypted = value(await rsaEncrypt(oaep.publicPem, secret));
    expect(encrypted.maxPlaintextBytes).toBe(190);
    expect(encrypted.bytes).toHaveLength(256);
    expect(value(await rsaDecrypt(oaep.privatePem, encrypted.base64))).toBe(secret);

    const tooLong = "a".repeat(191);
    const refused = await rsaEncrypt(oaep.publicPem, tooLong);
    expect(code(refused)).toBe("rsa-plaintext-too-long");
    expect(refused.ok ? null : refused.failure.limit).toBe(190);
    expect(refused.ok ? null : refused.failure.actual).toBe(191);
  });

  it("refuses the wrong private key without leaking why", async () => {
    const encrypted = value(await rsaEncrypt(oaep.publicPem, "poruka"));
    expect(code(await rsaDecrypt(otherOaep.privatePem, encrypted.base64))).toBe(
      "rsa-decrypt-failed",
    );
    expect(code(await rsaDecrypt(oaep.privatePem, "not base64 !!"))).toBe("invalid-base64");
  });

  it("refuses a private PEM offered where a public one belongs", async () => {
    const result = await rsaEncrypt(oaep.privatePem, "x");
    expect(code(result)).toBe("pem-wrong-label");
    expect(result.ok ? null : result.failure.subject).toBe(PEM_LABEL_PRIVATE);
  });

  const cases: readonly { readonly algorithm: SignatureAlgorithm; readonly bytes: number }[] = [
    { algorithm: "RSA-PSS", bytes: 256 },
    { algorithm: "RSASSA-PKCS1-v1_5", bytes: 256 },
    // ECDSA answers the raw P1363 pair: two field elements, 32 bytes each on
    // P-256 and 48 on P-384. A DER signature from OpenSSL would be neither.
    { algorithm: "ECDSA-P-256", bytes: 64 },
    { algorithm: "ECDSA-P-384", bytes: 96 },
  ];

  it("signs and verifies over every algorithm, and rejects a changed message", async () => {
    for (const { algorithm, bytes } of cases) {
      const pair = algorithm === "ECDSA-P-256" ? p256 : algorithm === "ECDSA-P-384" ? p384 : pss;
      const message = "potpisana poruka";
      const signature = value(
        await signMessage({ algorithm, privatePem: pair.privatePem, message }),
      );
      expect(signature.bytes, algorithm).toHaveLength(bytes);
      expect(signature.hex, algorithm).toHaveLength(bytes * 2);

      const good = await verifyMessage({
        algorithm,
        publicPem: pair.publicPem,
        message,
        signature: signature.base64,
        encoding: "base64",
      });
      expect(value(good).valid, algorithm).toBe(true);

      const changed = await verifyMessage({
        algorithm,
        publicPem: pair.publicPem,
        message: `${message} `,
        signature: signature.hex,
        encoding: "hex",
      });
      expect(value(changed).valid, algorithm).toBe(false);
    }
  });

  it("answers false for a nonsense signature instead of throwing", async () => {
    const result = await verifyMessage({
      algorithm: "ECDSA-P-256",
      publicPem: p256.publicPem,
      message: "x",
      signature: bytesToBase64(new Uint8Array(7)),
      encoding: "base64",
    });
    expect(value(result).valid).toBe(false);
  });

  it("separates a signature that fails from one that could not be checked", async () => {
    const unreadable = await verifyMessage({
      algorithm: "RSA-PSS",
      publicPem: pss.publicPem,
      message: "x",
      signature: "!!! not hex !!!",
      encoding: "hex",
    });
    expect(code(unreadable)).toBe("invalid-hex");

    const noKey = await verifyMessage({
      algorithm: "RSA-PSS",
      publicPem: "garbage",
      message: "x",
      signature: "00",
      encoding: "hex",
    });
    expect(code(noKey)).toBe("pem-malformed");
  });

  it("carries a signature it made into a JWT the verifier accepts", async () => {
    // The JWS signing input is `header.payload`, and JWS uses exactly the raw
    // ECDSA form this tool emits — so a signature from tool 8 IS a tool 3 token.
    const header = bytesToBase64Url(textToBytes(JSON.stringify({ alg: "ES256" })));
    const claims = JSON.stringify({ iss: "nexus", exp: 4102444800 });
    const payload = bytesToBase64Url(textToBytes(claims));
    const signature = value(
      await signMessage({
        algorithm: "ECDSA-P-256",
        privatePem: p256.privatePem,
        message: `${header}.${payload}`,
      }),
    );
    const token = `${header}.${payload}.${bytesToBase64Url(signature.bytes)}`;

    const verified = value(await verifyJwt(token, { kind: "pem", pem: p256.publicPem }, 0));
    expect(verified.signatureValid).toBe(true);
    expect(verified.decoded.validity.valid).toBe(true);

    // And the same token, one instant past its `exp`, verifies but is expired —
    // two separate answers, deliberately never fused into one.
    const late = value(await verifyJwt(token, { kind: "pem", pem: p256.publicPem }, 4102444800000));
    expect(late.signatureValid).toBe(true);
    expect(late.decoded.validity.expired).toBe(true);
  });

  it("verifies an RS256 token against an SPKI PEM", async () => {
    const header = bytesToBase64Url(textToBytes(JSON.stringify({ alg: "RS256" })));
    const payload = bytesToBase64Url(textToBytes(JSON.stringify({ sub: "1" })));
    const signature = value(
      await signMessage({
        algorithm: "RSASSA-PKCS1-v1_5",
        privatePem: pss.privatePem,
        message: `${header}.${payload}`,
      }),
    );
    const token = `${header}.${payload}.${bytesToBase64Url(signature.bytes)}`;
    const verified = value(await verifyJwt(token, { kind: "pem", pem: pss.publicPem }, 0));
    expect(verified.signatureValid).toBe(true);
  });
});
