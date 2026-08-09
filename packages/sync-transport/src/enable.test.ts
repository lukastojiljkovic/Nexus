import { describe, expect, it } from "vitest";
import { bytesToBase64url } from "@nexus/sync-crypto/web";

import { base64urlToBytea } from "./bytea.js";
import {
  AUTHORISING_TOKEN_HEADER,
  SYNC_ENABLE_FUNCTION,
  enableSync,
  keyWrapReadbackRequest,
  parseSyncEnableResponse,
  syncEnableBody,
  syncEnableRequest,
  syncEnableRoundTripProblem,
  type SyncEnableInput,
} from "./enable.js";
import { failed, ok, recordingFunctionPort } from "./testing.js";

const b64 = (fill: number, length: number): string =>
  bytesToBase64url(new Uint8Array(length).fill(fill));

const PARAMS = { memoryKiB: 65536, iterations: 3, parallelism: 1 };

const INPUT: SyncEnableInput = {
  authorisingToken: "ephemeral.aal2.token",
  deviceName: { nonce: b64(0x01, 24), ciphertext: b64(0x02, 40) },
  passwordWrap: { nonce: b64(0x11, 24), ciphertext: b64(0x12, 48), commitment: b64(0x13, 32) },
  passwordKdfParams: PARAMS,
  recoveryWrap: { nonce: b64(0x21, 24), ciphertext: b64(0x22, 48), commitment: b64(0x23, 32) },
  recoveryKdfParams: PARAMS,
  recoverySalt: b64(0x31, 16),
};

/** What PostgREST returns for the two rows a correct mint wrote. */
function storedRows(input: SyncEnableInput = INPUT): Record<string, unknown>[] {
  const body = syncEnableBody(input);
  return [
    {
      kind: "mk_under_kwrap",
      nonce: base64urlToBytea(body.kwrap.nonce),
      wrapped: base64urlToBytea(body.kwrap.wrapped),
      commit_tag: base64urlToBytea(body.kwrap.commit_tag),
      kdf_salt: null,
      kdf_params: { ...body.kwrap.kdf_params },
    },
    {
      kind: "mk_under_src",
      nonce: base64urlToBytea(body.src.nonce),
      wrapped: base64urlToBytea(body.src.wrapped),
      commit_tag: base64urlToBytea(body.src.commit_tag),
      kdf_salt: base64urlToBytea(body.src.kdf_salt),
      kdf_params: { ...body.src.kdf_params },
    },
  ];
}

describe("the request", () => {
  it("names the function and carries the authorising token in its own header", () => {
    const request = syncEnableRequest(INPUT);
    expect(request.name).toBe(SYNC_ENABLE_FUNCTION);
    expect(request.headers[AUTHORISING_TOKEN_HEADER]).toBe(INPUT.authorisingToken);
    expect(request.headers["Content-Type"]).toBe("application/json");
  });

  /**
   * A bearer token in a JSON field ends up in request logs, replay fixtures and
   * whatever a developer pastes into a bug report. The endpoint reads it from a
   * header for that reason; this asserts the client never also puts it in the
   * body „for convenience".
   */
  it("keeps the authorising token out of the body entirely", () => {
    expect(syncEnableRequest(INPUT).body).not.toContain(INPUT.authorisingToken);
  });

  it("renames the crypto layer's fields to the server's exactly once", () => {
    const body = syncEnableBody(INPUT);
    expect(body.kwrap.wrapped).toBe(INPUT.passwordWrap.ciphertext);
    expect(body.kwrap.commit_tag).toBe(INPUT.passwordWrap.commitment);
    expect(body.src.wrapped).toBe(INPUT.recoveryWrap.ciphertext);
    expect(body.src.commit_tag).toBe(INPUT.recoveryWrap.commitment);
  });

  /**
   * `key_wraps_kdf_salt_presence` refuses a salt on this slot and so does the
   * endpoint: K_wrap's salt is derived from the email address on every device
   * and deliberately never stored. Sending one would be refused; sending one the
   * server accepted would record a derivation nobody performs.
   */
  it("sends no kdf_salt on the password wrap, and one on the recovery wrap", () => {
    const body = syncEnableBody(INPUT);
    expect("kdf_salt" in body.kwrap).toBe(false);
    expect(JSON.parse(syncEnableRequest(INPUT).body).kwrap.kdf_salt).toBeUndefined();
    expect(body.src.kdf_salt).toBe(INPUT.recoverySalt);
  });
});

describe("the answer", () => {
  it("reads a mint and its device id", () => {
    const result = parseSyncEnableResponse(ok('{"status":"minted","device_id":"dev-1"}'));
    expect(result).toEqual({ outcome: "minted", deviceId: "dev-1" });
  });

  it("reads a mint whose device row could not be read back", () => {
    const result = parseSyncEnableResponse(ok('{"status":"minted","device_id":null}'));
    expect(result).toEqual({ outcome: "minted", deviceId: null });
  });

  it("reads already_minted, which carries nothing else by design", () => {
    expect(parseSyncEnableResponse(ok('{"status":"already_minted"}'))).toEqual({
      outcome: "already_minted",
    });
  });

  it("names every refusal the endpoint can send", () => {
    const cases = [
      [401, "unauthenticated"],
      [403, "session_not_live"],
      [403, "second_factor_required"],
      [403, "factor_must_predate_session"],
      [403, "email_not_confirmed"],
      [403, "sessions_from_different_accounts"],
      [400, "sessions_must_differ"],
      [400, "bad_request"],
      [400, "rejected_by_schema"],
      [500, "mint_failed"],
      [503, "unavailable"],
    ] as const;
    for (const [status, error] of cases) {
      const result = parseSyncEnableResponse(failed(status, JSON.stringify({ error })));
      expect(result, error).toMatchObject({ outcome: "refused", reason: error, httpStatus: status });
    }
  });

  it("keeps the detail a schema refusal carries", () => {
    const body = JSON.stringify({ error: "rejected_by_schema", detail: "key_wraps_kdf_params_floor" });
    const result = parseSyncEnableResponse(failed(400, body));
    expect(result).toMatchObject({ reason: "rejected_by_schema", detail: "key_wraps_kdf_params_floor" });
  });

  it("calls an unrecognised error unknown rather than guessing", () => {
    const result = parseSyncEnableResponse(failed(418, '{"error":"teapot"}'));
    expect(result).toMatchObject({ outcome: "refused", reason: "unknown", httpStatus: 418 });
  });

  /**
   * A 200 that says neither `minted` nor `already_minted` is not a success this
   * client can act on — treating it as one would leave the desktop believing
   * sync is on with no master key behind it.
   */
  it("refuses a 200 that claims neither outcome", () => {
    for (const body of ['{"status":"ok"}', "{}", "not json", "[]", "null"]) {
      expect(parseSyncEnableResponse(ok(body)), body).toMatchObject({
        outcome: "refused",
        reason: "unknown",
        httpStatus: 200,
      });
    }
  });

  it("never throws on a body a hostile server chose", () => {
    for (const body of ["", "<html>504</html>", '{"error":', '{"error":{"nested":true}}']) {
      expect(() => parseSyncEnableResponse(failed(502, body)), body).not.toThrow();
    }
  });
});

describe("enableSync", () => {
  it("makes exactly one call and returns what it said", async () => {
    const { port, requests } = recordingFunctionPort([ok('{"status":"minted","device_id":"d"}')]);
    const result = await enableSync(port, INPUT);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.name).toBe(SYNC_ENABLE_FUNCTION);
    expect(result).toEqual({ outcome: "minted", deviceId: "d" });
  });
});

describe("reading the mint back", () => {
  it("asks for both master-key slots and the six columns it compares", () => {
    const request = keyWrapReadbackRequest();
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
    // `encodeURIComponent` leaves parentheses alone and encodes the comma, so
    // the list arrives as `in.(a%2Cb)`. PostgREST percent-decodes the whole query
    // string before it parses anything — the same measured behaviour `filterValue`
    // rests on — and `live.test.ts` pins THIS filter against a running server,
    // because „decodes first" being true of `eq.` does not make it true of `in.`.
    expect(request.path).toContain("kind=in.(mk_under_kwrap%2Cmk_under_src)");
    expect(request.path).toContain("select=kind%2Cnonce%2Cwrapped%2Ccommit_tag%2Ckdf_salt%2Ckdf_params");
  });

  it("passes when the server holds exactly what was sent", () => {
    expect(syncEnableRoundTripProblem(INPUT, storedRows())).toBeNull();
  });

  it("passes regardless of the order the rows come back in", () => {
    expect(syncEnableRoundTripProblem(INPUT, storedRows().reverse())).toBeNull();
  });

  it("fails when a slot is missing, duplicated, or not an object", () => {
    expect(syncEnableRoundTripProblem(INPUT, [])).toContain("mk_under_kwrap");
    expect(syncEnableRoundTripProblem(INPUT, storedRows().slice(0, 1))).toContain("mk_under_src");
    const doubled = [...storedRows(), storedRows()[0] as Record<string, unknown>];
    expect(syncEnableRoundTripProblem(INPUT, doubled)).toContain("the server returned 2");
    expect(syncEnableRoundTripProblem(INPUT, ["not a row", 7, null])).not.toBeNull();
  });

  it("fails when any sealed byte differs", () => {
    for (const column of ["nonce", "wrapped", "commit_tag"] as const) {
      const rows = storedRows();
      rows[0]![column] = base64urlToBytea(b64(0xee, column === "wrapped" ? 48 : 24));
      const problem = syncEnableRoundTripProblem(INPUT, rows);
      expect(problem, column).toContain(`mk_under_kwrap.${column}`);
    }
  });

  it("fails when a column comes back as something that is not a bytea", () => {
    const rows = storedRows();
    rows[1]!["wrapped"] = "AAAA";
    expect(syncEnableRoundTripProblem(INPUT, rows)).toContain("is not a bytea");
  });

  /**
   * Both directions. A salt appearing on the slot that must not have one is as
   * much a corruption as a wrong salt, and a check written only as „if we sent
   * one, it matches" would walk past it.
   */
  it("fails when a salt appears on the password wrap", () => {
    const rows = storedRows();
    rows[0]!["kdf_salt"] = base64urlToBytea(b64(0x31, 16));
    expect(syncEnableRoundTripProblem(INPUT, rows)).toContain(
      "mk_under_kwrap.kdf_salt is set, and must not be",
    );
  });

  it("fails when the recovery salt is not the one that was sent", () => {
    const rows = storedRows();
    rows[1]!["kdf_salt"] = base64urlToBytea(b64(0x99, 16));
    expect(syncEnableRoundTripProblem(INPUT, rows)).toContain("mk_under_src.kdf_salt");
  });

  it("fails when the recovery salt was dropped altogether", () => {
    const rows = storedRows();
    rows[1]!["kdf_salt"] = null;
    expect(syncEnableRoundTripProblem(INPUT, rows)).toContain("mk_under_src.kdf_salt");
  });

  /**
   * The downgrade this comparison exists for: a server that stored a lower cost
   * than the client derived under produces a wrap nothing can reproduce, and the
   * account's master key is gone. The floor in the schema refuses the obvious
   * version of this; the comparison refuses the rest.
   */
  it("fails when a cost parameter is not the one that was sent", () => {
    const rows = storedRows();
    rows[0]!["kdf_params"] = { ...PARAMS, iterations: 1 };
    expect(syncEnableRoundTripProblem(INPUT, rows)).toContain("iterations is 1");
  });

  it("fails when kdf_params carries a key this device did not send", () => {
    const rows = storedRows();
    rows[1]!["kdf_params"] = { ...PARAMS, version: 19 };
    expect(syncEnableRoundTripProblem(INPUT, rows)).toContain("has 4 keys");
  });

  /**
   * The comparison decodes both sides rather than comparing text, so „the same
   * bytes, spelled with padding" must not read as tampering — and a spelling
   * `@nexus/sync-crypto` never produces is named as this client's fault rather
   * than blamed on the server.
   */
  it("names a non-canonical value on the sending side as a client fault", () => {
    const padded = { ...INPUT, recoverySalt: "MTIzNDU2Nzg5MDEyMzQ1Ng==" };
    expect(syncEnableRoundTripProblem(padded, storedRows())).toContain(
      "was not canonical base64url when this device sent it",
    );
  });

  it("fails when kdf_params is not an object at all", () => {
    for (const value of [null, "64", 3, []]) {
      const rows = storedRows();
      rows[0]!["kdf_params"] = value;
      expect(syncEnableRoundTripProblem(INPUT, rows), String(value)).toContain("not an object");
    }
  });
});
