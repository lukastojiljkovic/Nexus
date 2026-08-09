import { describe, expect, it } from "vitest";
import { base64urlToBytes, concatBytes, utf8 } from "./bytes.js";
import { SyncCryptoError } from "./errors.js";
import {
  WEB_KDF_PARAMS,
  deriveWebPasswordKeys,
  normalizeWebEmail,
  normalizeWebPassword,
  webKdfSalt,
} from "./kdf.js";
import { createFakeCryptoPort } from "./testing/fakeCryptoPort.js";

const port = createFakeCryptoPort({ seed: 7 });

const EMAIL = "Luka.Stojiljkovic@Example.COM";
const PASSWORD = "a-long-enough-web-password-1";

describe("normalizeWebEmail", () => {
  it("trims, NFKC-normalises and lower-cases so one address derives one key", () => {
    expect(normalizeWebEmail("  Luka@Example.COM ")).toBe("luka@example.com");
    // Fullwidth letters typed through an IME must fold to the ASCII address.
    expect(normalizeWebEmail("ＬＵＫＡ@example.com")).toBe("luka@example.com");
  });

  it("lower-cases with the locale-independent operation", () => {
    // toLocaleLowerCase("tr") maps "I" to a dotless "ı"; toLowerCase never does.
    // A Turkish-locale device must derive the same key as every other device.
    expect(normalizeWebEmail("ISTANBUL@example.com")).toBe("istanbul@example.com");
  });

  it("rejects an empty or whitespace-only address rather than deriving from nothing", () => {
    expect(() => normalizeWebEmail("   ")).toThrow(SyncCryptoError);
  });
});

describe("normalizeWebPassword", () => {
  it("NFKC-normalises but never trims", () => {
    expect(normalizeWebPassword("ａbc1")).toBe("abc1");
    // Leading/trailing spaces are part of a password the user chose to type;
    // trimming would silently narrow the password space.
    expect(normalizeWebPassword(" secret1 ")).toBe(" secret1 ");
  });

  it("rejects an empty password", () => {
    expect(() => normalizeWebPassword("")).toThrow(SyncCryptoError);
  });
});

describe("webKdfSalt", () => {
  it("is exactly SHA-256(label ‖ lowercase(email)) — the documented formula", async () => {
    const expected = await port.sha256(
      concatBytes(utf8("nexus/web-kdf/v1"), utf8("luka.stojiljkovic@example.com")),
    );
    expect(await webKdfSalt(port, EMAIL)).toEqual(expected);
  });

  it("is stable across the spellings normalizeWebEmail folds together", async () => {
    const a = await webKdfSalt(port, EMAIL);
    const b = await webKdfSalt(port, "  luka.stojiljkovic@example.com  ");
    expect(b).toEqual(a);
  });

  it("differs for a different address", async () => {
    const a = await webKdfSalt(port, EMAIL);
    const b = await webKdfSalt(port, "someone.else@example.com");
    expect(b).not.toEqual(a);
  });
});

describe("deriveWebPasswordKeys", () => {
  it("is deterministic for the same email, password and parameters", async () => {
    const first = await deriveWebPasswordKeys(port, {
      email: EMAIL,
      password: PASSWORD,
      params: WEB_KDF_PARAMS,
    });
    const second = await deriveWebPasswordKeys(port, {
      email: EMAIL,
      password: PASSWORD,
      params: WEB_KDF_PARAMS,
    });
    expect(second.authPassword).toBe(first.authPassword);
    expect(second.wrapKey).toEqual(first.wrapKey);
  });

  it("returns an auth password that is 43 unpadded base64url characters over 32 bytes", async () => {
    const keys = await deriveWebPasswordKeys(port, {
      email: EMAIL,
      password: PASSWORD,
      params: WEB_KDF_PARAMS,
    });
    expect(keys.authPassword).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(base64urlToBytes(keys.authPassword)?.length).toBe(32);
    // Well inside bcrypt's 72-byte truncation, so no character of it is lost.
    expect(keys.authPassword.length).toBeLessThan(72);
  });

  it("gives K_auth and K_wrap independent values — the server learns one, never the other", async () => {
    const keys = await deriveWebPasswordKeys(port, {
      email: EMAIL,
      password: PASSWORD,
      params: WEB_KDF_PARAMS,
    });
    expect(base64urlToBytes(keys.authPassword)).not.toEqual(keys.wrapKey);
  });

  it("changes completely when the email changes — the salt binds the address", async () => {
    const before = await deriveWebPasswordKeys(port, {
      email: EMAIL,
      password: PASSWORD,
      params: WEB_KDF_PARAMS,
    });
    const after = await deriveWebPasswordKeys(port, {
      email: "new.address@example.com",
      password: PASSWORD,
      params: WEB_KDF_PARAMS,
    });
    expect(after.authPassword).not.toBe(before.authPassword);
    expect(after.wrapKey).not.toEqual(before.wrapKey);
  });

  it("changes when the password changes", async () => {
    const before = await deriveWebPasswordKeys(port, {
      email: EMAIL,
      password: PASSWORD,
      params: WEB_KDF_PARAMS,
    });
    const after = await deriveWebPasswordKeys(port, {
      email: EMAIL,
      password: `${PASSWORD}!`,
      params: WEB_KDF_PARAMS,
    });
    expect(after.wrapKey).not.toEqual(before.wrapKey);
  });

  it("refuses parameters weaker than the baseline, whoever supplied them", async () => {
    // The account's KDF parameters are read from a HOSTILE server. Accepting
    // m=8 KiB would let it hand every client a cost it can brute-force.
    await expect(
      deriveWebPasswordKeys(port, {
        email: EMAIL,
        password: PASSWORD,
        params: { memoryKiB: 8, iterations: 1, parallelism: 1 },
      }),
    ).rejects.toThrow(SyncCryptoError);
    await expect(
      deriveWebPasswordKeys(port, {
        email: EMAIL,
        password: PASSWORD,
        params: { ...WEB_KDF_PARAMS, iterations: 2 },
      }),
    ).rejects.toThrow(SyncCryptoError);
  });

  it("refuses parameters so large they are a denial of service", async () => {
    // The other direction of the same attack: a server that cannot weaken the
    // derivation settles for hanging every tab that tries to sign in.
    await expect(
      deriveWebPasswordKeys(port, {
        email: EMAIL,
        password: PASSWORD,
        params: { memoryKiB: 64 * 1024 * 1024, iterations: 3, parallelism: 1 },
      }),
    ).rejects.toThrow(SyncCryptoError);
    await expect(
      deriveWebPasswordKeys(port, {
        email: EMAIL,
        password: PASSWORD,
        params: { ...WEB_KDF_PARAMS, iterations: 10_000 },
      }),
    ).rejects.toThrow(SyncCryptoError);
  });

  it("refuses more lanes than the cap — parallelism is not a strength dial", async () => {
    await expect(
      deriveWebPasswordKeys(port, {
        email: EMAIL,
        password: PASSWORD,
        params: { ...WEB_KDF_PARAMS, parallelism: 1024 },
      }),
    ).rejects.toThrow(SyncCryptoError);
  });

  it("refuses a parameter that is not a positive integer", async () => {
    for (const params of [
      { ...WEB_KDF_PARAMS, memoryKiB: Number.NaN },
      { ...WEB_KDF_PARAMS, iterations: 3.5 },
      { ...WEB_KDF_PARAMS, parallelism: 0 },
      { ...WEB_KDF_PARAMS, memoryKiB: Number.POSITIVE_INFINITY },
    ]) {
      await expect(
        deriveWebPasswordKeys(port, { email: EMAIL, password: PASSWORD, params }),
      ).rejects.toThrow(SyncCryptoError);
    }
  });

  it("accepts parameters STRONGER than the baseline, so costs can be raised later", async () => {
    const keys = await deriveWebPasswordKeys(port, {
      email: EMAIL,
      password: PASSWORD,
      params: { memoryKiB: 128 * 1024, iterations: 4, parallelism: 1 },
    });
    expect(keys.wrapKey).toHaveLength(32);
  });
});
