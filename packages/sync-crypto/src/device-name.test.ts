import { describe, expect, it } from "vitest";
import { base64urlToBytes, bytesToBase64url, utf8 } from "./bytes.js";
import {
  MAX_DEVICE_NAME_LENGTH,
  assertDeviceName,
  isAcceptableDeviceName,
  openDeviceName,
  sealDeviceName,
  type DeviceNameContext,
  type SealedDeviceName,
} from "./device-name.js";
import { type SyncCryptoErrorCode } from "./errors.js";
import { AEAD_NONCE_BYTES } from "./port.js";
import { createFakeCryptoPort } from "./testing/fakeCryptoPort.js";

const port = createFakeCryptoPort({ seed: 31 });

const MK = new Uint8Array(32).fill(0x11);
const OTHER_MK = new Uint8Array(32).fill(0x12);

const DESKTOP: DeviceNameContext = { userId: "user-1", platform: "desktop" };

/**
 * The two numbers `devices_name_len` and `devices_name_nonce_len` enforce, copied
 * here rather than imported, because the point of the assertion is that two
 * independently-written layers agree. A shared constant would make it agree with
 * itself.
 */
const DB_NAME_CIPHERTEXT_MIN = 17;
const DB_NAME_CIPHERTEXT_MAX = 1024;
const DB_NAME_NONCE_BYTES = 24;

/**
 * Every hostile character in this file is built from its code point and never
 * typed as itself. A test file containing a real U+202E is a test file nobody
 * can read correctly, which is the entire complaint being tested.
 */
const char = (codePoint: number): string => String.fromCodePoint(codePoint);

async function expectCode(promise: Promise<unknown>, code: SyncCryptoErrorCode): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "SyncCryptoError", code });
}

function decoded(sealed: SealedDeviceName): { nonce: Uint8Array; ciphertext: Uint8Array } {
  const nonce = base64urlToBytes(sealed.nonce);
  const ciphertext = base64urlToBytes(sealed.ciphertext);
  if (nonce === null || ciphertext === null) throw new Error("the seal is not base64url");
  return { nonce, ciphertext };
}

describe("isAcceptableDeviceName", () => {
  it("accepts the names people actually give machines", () => {
    for (const name of [
      "Luka — laptop",
      "Radna stanica (kancelarija)",
      "Šešir",
      "Čačak-desktop",
      "MacBook Pro 16",
      "机器",
      "телефон",
      "Dnevna soba 🖥",
    ]) {
      expect(isAcceptableDeviceName(name), name).toBe(true);
    }
  });

  it("refuses anything that is not a string", () => {
    for (const value of [undefined, null, 42, {}, [], new Uint8Array(4)]) {
      expect(isAcceptableDeviceName(value)).toBe(false);
    }
  });

  it("refuses a name that renders as nothing", () => {
    for (const blank of ["", " ", char(0x09), "      "]) {
      expect(isAcceptableDeviceName(blank), JSON.stringify(blank)).toBe(false);
    }
  });

  it("accepts exactly the bound and refuses one past it", () => {
    expect(isAcceptableDeviceName("n".repeat(MAX_DEVICE_NAME_LENGTH))).toBe(true);
    expect(isAcceptableDeviceName("n".repeat(MAX_DEVICE_NAME_LENGTH + 1))).toBe(false);
  });

  /** C0, DEL and C1 — the whole `Cc` category, not the printable-adjacent third of it. */
  it("refuses every control character", () => {
    for (const code of [0x00, 0x07, 0x09, 0x0a, 0x0d, 0x1b, 0x7f, 0x85, 0x9f]) {
      const label = `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
      expect(isAcceptableDeviceName(`Laptop${char(code)}`), label).toBe(false);
    }
  });

  /**
   * The category the file exists for. Each of these is a way to make one string
   * read as a different string on a dialog that releases keys.
   */
  it("refuses the format characters that change what a human reads", () => {
    const attacks: ReadonlyArray<readonly [number, string]> = [
      [0x202e, "right-to-left override reverses the rest of the line"],
      [0x202d, "left-to-right override does the same in the other direction"],
      [0x2066, "left-to-right isolate"],
      [0x2069, "pop directional isolate"],
      [0x200b, "zero-width space makes two different names look identical"],
      [0x200e, "left-to-right mark"],
      [0x2060, "word joiner is invisible"],
      [0xfeff, "a BOM in the middle of a string is invisible"],
      [0x00ad, "soft hyphen — a deliberate false positive, refused anyway"],
    ];
    for (const [code, why] of attacks) {
      expect(isAcceptableDeviceName(`Luka${char(code)} laptop`), why).toBe(false);
    }
  });

  it("assertDeviceName throws a TypeError naming the bound", () => {
    expect(() => assertDeviceName("ok")).not.toThrow();
    expect(() => assertDeviceName(`bad${char(0x202e)}`)).toThrow(TypeError);
    expect(() => assertDeviceName("")).toThrow(new RegExp(String(MAX_DEVICE_NAME_LENGTH)));
  });
});

describe("sealDeviceName / openDeviceName", () => {
  it("round-trips a name, including one that needs every byte of UTF-8", async () => {
    for (const name of ["Luka — laptop", "Пројекат Nexus 🛰", "Č".repeat(MAX_DEVICE_NAME_LENGTH)]) {
      const sealed = await sealDeviceName(port, MK, DESKTOP, name);
      expect(await openDeviceName(port, MK, DESKTOP, sealed)).toBe(name);
    }
  });

  it("refuses to seal a name the validator would refuse", async () => {
    await expect(sealDeviceName(port, MK, DESKTOP, `bad${char(0x202e)}`)).rejects.toThrow(TypeError);
    await expect(sealDeviceName(port, MK, DESKTOP, "  ")).rejects.toThrow(TypeError);
  });

  it("refuses a master key that is not 32 bytes", async () => {
    await expect(sealDeviceName(port, new Uint8Array(16), DESKTOP, "Laptop")).rejects.toThrow(
      TypeError,
    );
  });

  it("refuses an empty userId, which would otherwise seal under an empty AAD field", async () => {
    await expect(
      sealDeviceName(port, MK, { userId: "", platform: "desktop" }, "Laptop"),
    ).rejects.toThrow(TypeError);
  });

  it("uses a fresh nonce for every seal of the same name", async () => {
    const first = await sealDeviceName(port, MK, DESKTOP, "Laptop");
    const second = await sealDeviceName(port, MK, DESKTOP, "Laptop");
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });

  /**
   * The seal is under an HKDF subkey, not under MK — so MK itself must not open
   * it. If this ever fails, a device name and something else derived directly
   * from MK are one (key, nonce) collision away from each other.
   */
  it("does not seal under the master key itself", async () => {
    const sealed = await sealDeviceName(port, MK, DESKTOP, "Laptop");
    const { nonce, ciphertext } = decoded(sealed);
    expect(await port.aeadOpen({ key: MK, nonce, ciphertext, aad: new Uint8Array(0) })).toBeNull();
  });
});

describe("what the seal is bound to", () => {
  it("does not open under another account's master key", async () => {
    const sealed = await sealDeviceName(port, MK, DESKTOP, "Laptop");
    await expectCode(openDeviceName(port, OTHER_MK, DESKTOP, sealed), "device-name/aead-failed");
  });

  it("does not open against a different user id", async () => {
    const sealed = await sealDeviceName(port, MK, DESKTOP, "Laptop");
    await expectCode(
      openDeviceName(port, MK, { userId: "user-2", platform: "desktop" }, sealed),
      "device-name/aead-failed",
    );
  });

  it("does not open against a different platform", async () => {
    const sealed = await sealDeviceName(port, MK, DESKTOP, "Laptop");
    await expectCode(
      openDeviceName(port, MK, { userId: "user-1", platform: "web" }, sealed),
      "device-name/aead-failed",
    );
  });

  it("does not open a name whose ciphertext was edited", async () => {
    const sealed = await sealDeviceName(port, MK, DESKTOP, "Laptop");
    const { ciphertext } = decoded(sealed);
    ciphertext[0] = (ciphertext[0] as number) ^ 0x01;
    await expectCode(
      openDeviceName(port, MK, DESKTOP, { ...sealed, ciphertext: bytesToBase64url(ciphertext) }),
      "device-name/aead-failed",
    );
  });

  it("does not open a name resealed under another seal's nonce", async () => {
    const first = await sealDeviceName(port, MK, DESKTOP, "Laptop");
    const second = await sealDeviceName(port, MK, DESKTOP, "Telefon");
    await expectCode(
      openDeviceName(port, MK, DESKTOP, { nonce: second.nonce, ciphertext: first.ciphertext }),
      "device-name/aead-failed",
    );
  });

  /**
   * The limit the header states, asserted rather than left as prose: two devices
   * of one account on one platform have interchangeable name ciphertexts, so a
   * seal made for one opens as the other. Recorded here so that a future change
   * which fixes it fails loudly rather than leaving the header describing a
   * weakness that no longer exists.
   */
  it("does NOT bind the device id — names permute among same-platform devices", async () => {
    const forOneDevice = await sealDeviceName(port, MK, DESKTOP, "Kancelarija");
    const asAnotherDevice: DeviceNameContext = { userId: "user-1", platform: "desktop" };
    expect(await openDeviceName(port, MK, asAnotherDevice, forOneDevice)).toBe("Kancelarija");
  });
});

describe("malformed seals", () => {
  it("refuses a nonce that is not base64url or not 24 bytes", async () => {
    const sealed = await sealDeviceName(port, MK, DESKTOP, "Laptop");
    for (const nonce of ["", "not base64url!!", bytesToBase64url(new Uint8Array(23))]) {
      await expectCode(
        openDeviceName(port, MK, DESKTOP, { ...sealed, nonce }),
        "device-name/malformed",
      );
    }
  });

  it("refuses ciphertext that is not base64url", async () => {
    const sealed = await sealDeviceName(port, MK, DESKTOP, "Laptop");
    await expectCode(
      openDeviceName(port, MK, DESKTOP, { ...sealed, ciphertext: "n o t b a s e" }),
      "device-name/malformed",
    );
  });
});

describe("the sealed form fits the columns that store it", () => {
  it("puts the nonce at exactly the width devices_name_nonce_len demands", async () => {
    const sealed = await sealDeviceName(port, MK, DESKTOP, "Laptop");
    expect(decoded(sealed).nonce.length).toBe(DB_NAME_NONCE_BYTES);
    expect(AEAD_NONCE_BYTES).toBe(DB_NAME_NONCE_BYTES);
  });

  it("keeps the shortest possible name at or above the floor", async () => {
    const sealed = await sealDeviceName(port, MK, DESKTOP, "n");
    expect(decoded(sealed).ciphertext.length).toBe(DB_NAME_CIPHERTEXT_MIN);
  });

  /**
   * The worst case is not 120 astral characters — a surrogate pair spends two
   * UTF-16 units on four UTF-8 bytes. It is 120 three-byte BMP characters, which
   * is what `MAX_DEVICE_NAME_LENGTH` has to be chosen against.
   */
  it("keeps the longest possible name under the ceiling", async () => {
    const widest = "漢".repeat(MAX_DEVICE_NAME_LENGTH);
    expect(utf8(widest).length).toBe(MAX_DEVICE_NAME_LENGTH * 3);

    const sealed = await sealDeviceName(port, MK, DESKTOP, widest);
    const length = decoded(sealed).ciphertext.length;
    expect(length).toBe(MAX_DEVICE_NAME_LENGTH * 3 + 16);
    expect(length).toBeLessThanOrEqual(DB_NAME_CIPHERTEXT_MAX);
  });
});
