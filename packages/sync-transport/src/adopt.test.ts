import { describe, expect, it } from "vitest";

import {
  parseInsertedDeviceId,
  parseRecoveryWrapRows,
  recoveryWrapRequest,
  retireBootstrapDeviceRequest,
  webDeviceInsertRequest,
} from "./adopt.js";

const DEVICE = "22222222-3333-4444-8555-666666666666";
const NAME = { nonce: "bm9uY2U", ciphertext: "Y2lwaGVy" };
const PARAMS = { memoryKiB: 65536, iterations: 3, parallelism: 1 };

/** `\x` + hex, which is how PostgREST answers a `bytea` column. */
const bytea = (byte: number, length: number): string =>
  `\\x${byte.toString(16).padStart(2, "0").repeat(length)}`;

describe("webDeviceInsertRequest", () => {
  it("writes the caller's own row and asks for its id back", () => {
    const request = webDeviceInsertRequest({ userId: "u1", sessionId: "s1", deviceName: NAME });
    expect(request.method).toBe("POST");
    expect(request.path).toContain("/devices?");
    expect(request.path).toContain("select=id");
    expect(request.headers["Prefer"]).toBe("return=representation");
    expect(JSON.parse(request.body ?? "{}")).toEqual({
      user_id: "u1",
      session_id: "s1",
      name_nonce: NAME.nonce,
      name_ciphertext: NAME.ciphertext,
    });
  });

  it("names no platform, because the client is not allowed to have an opinion", () => {
    // `platform` is absent from the INSERT grant, so a client that sent one
    // would be refused by the column privilege — and the row lands as 'web',
    // which is what makes "desktop" mean something.
    expect(webDeviceInsertRequest({ userId: "u1", sessionId: "s1", deviceName: NAME }).body).not
      .toContain("platform");
  });
});

describe("retireBootstrapDeviceRequest", () => {
  it("ends the row and gives it a readable name in the same statement", () => {
    const request = retireBootstrapDeviceRequest(DEVICE, NAME, "2026-08-09T18:00:00.000Z");
    expect(request.method).toBe("PATCH");
    expect(request.path).toContain(`id=eq.${DEVICE}`);
    expect(JSON.parse(request.body ?? "{}")).toEqual({
      name_nonce: NAME.nonce,
      name_ciphertext: NAME.ciphertext,
      revoked_at: "2026-08-09T18:00:00.000Z",
    });
  });

  it("asks for the row back, because a PATCH that matched nothing is a 200", () => {
    expect(retireBootstrapDeviceRequest(DEVICE, NAME, "x").headers["Prefer"]).toBe(
      "return=representation",
    );
  });

  it("refuses to interpolate anything that is not a device id", () => {
    expect(() => retireBootstrapDeviceRequest("or.true", NAME, "x")).toThrow(TypeError);
  });
});

describe("recoveryWrapRequest", () => {
  it("asks for the recovery slot alone", () => {
    const path = recoveryWrapRequest().path;
    expect(path).toContain("kind=eq.mk_under_src");
    expect(path).not.toContain("mk_under_kwrap");
  });

  it("scopes nothing by account, because the policy already does", () => {
    // A `user_id` filter here would be a second opinion about identity, taken
    // from a token this package does not hold.
    expect(recoveryWrapRequest().path).not.toContain("user_id");
  });
});

describe("parseRecoveryWrapRows", () => {
  const row = {
    kind: "mk_under_src",
    nonce: bytea(0x11, 24),
    wrapped: bytea(0x22, 48),
    commit_tag: bytea(0x33, 32),
    kdf_salt: bytea(0x44, 16),
    kdf_params: PARAMS,
  };

  it("turns the server's hex into the base64url this package speaks", () => {
    const parsed = parseRecoveryWrapRows([row]);
    expect(parsed?.kdfParams).toEqual(PARAMS);
    // 24 bytes of 0x11. Divisible by three, so base64url is exactly 32
    // characters with nothing to pad — the encoding, not the hex, is what the
    // crypto takes.
    expect(parsed?.nonce).toBe("ERERERERERERERERERERERERERERERER");
    expect(parsed?.nonce.includes("\\x")).toBe(false);
  });

  it("refuses a row with no salt, which is the sign it is not the recovery slot", () => {
    // Migration 009 made `kdf_salt` belong to `mk_under_src` alone. A null one
    // means the server answered with a different row than the one asked for, and
    // deriving a key from a missing salt is not a thing to attempt.
    expect(parseRecoveryWrapRows([{ ...row, kdf_salt: null }])).toBeNull();
  });

  it("refuses kdf params that are not three numbers", () => {
    expect(parseRecoveryWrapRows([{ ...row, kdf_params: { memoryKiB: "lots" } }])).toBeNull();
    expect(parseRecoveryWrapRows([{ ...row, kdf_params: null }])).toBeNull();
  });

  it("answers null for an account that has never minted", () => {
    expect(parseRecoveryWrapRows([])).toBeNull();
  });

  it("survives rubbish where a row should be", () => {
    expect(parseRecoveryWrapRows([42])).toBeNull();
    expect(parseRecoveryWrapRows([["not", "a", "row"]])).toBeNull();
  });
});

describe("parseInsertedDeviceId", () => {
  it("reads the id PostgREST returns", () => {
    expect(parseInsertedDeviceId([{ id: DEVICE }])).toBe(DEVICE);
  });

  it("answers null when the insert returned nothing to name", () => {
    expect(parseInsertedDeviceId([])).toBeNull();
    expect(parseInsertedDeviceId([{ id: "" }])).toBeNull();
  });
});
