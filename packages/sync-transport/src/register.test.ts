import { describe, expect, it } from "vitest";

import {
  DEVICE_REGISTER_FUNCTION,
  deviceRegisterBody,
  deviceRegisterRequest,
  parseDeviceRegisterResponse,
  registerDevice,
  type DeviceRegisterInput,
} from "./register.js";
import type { HttpResponse } from "./http.js";

const INPUT: DeviceRegisterInput = {
  proof: "cccccccccccccccccccccccccccccccccccccccccc0",
  deviceName: { nonce: "bm9uY2U", ciphertext: "Y2lwaGVy" },
};

function answer(status: number, body: unknown): HttpResponse {
  return { status, body: JSON.stringify(body) };
}

describe("deviceRegisterRequest", () => {
  it("names the function and sends the three fields the endpoint reads", () => {
    const request = deviceRegisterRequest(INPUT);
    expect(request.name).toBe(DEVICE_REGISTER_FUNCTION);
    expect(JSON.parse(request.body)).toEqual({
      mk_verifier: INPUT.proof,
      device_name_nonce: "bm9uY2U",
      device_name_ciphertext: "Y2lwaGVy",
    });
  });

  it("carries no second token, unlike the mint", () => {
    // `sync-enable` needs an ephemeral aal2 session to authorise it. Here the
    // authorisation IS the proof, and the endpoint refuses an aal2 session
    // outright — so a second bearer would be a second thing to get wrong.
    const headers = deviceRegisterRequest(INPUT).headers;
    expect(Object.keys(headers).some((name) => name.toLowerCase().includes("authorising"))).toBe(
      false,
    );
  });

  it("sends no password, no wrap and no key", () => {
    const body = JSON.stringify(deviceRegisterBody(INPUT));
    for (const forbidden of ["password", "wrapped", "kdf", "commit_tag", "recovery"]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

describe("parseDeviceRegisterResponse", () => {
  it("reads the device id out of a success", () => {
    expect(parseDeviceRegisterResponse(answer(200, { device_id: "dev-1" }))).toEqual({
      outcome: "registered",
      deviceId: "dev-1",
    });
  });

  it("refuses a 200 with no device id, because the id IS the outcome here", () => {
    // The mint allows itself „minted, device id unknown" — the mint had already
    // happened and the id was a convenience. Here, without an id the caller
    // cannot write `last_seen_at` or retire this machine later, so „registered"
    // would be a claim with nothing behind it.
    const result = parseDeviceRegisterResponse(answer(200, { status: "ok" }));
    expect(result).toEqual({ outcome: "refused", reason: "unknown", httpStatus: 200, detail: null });
  });

  it("names every refusal the endpoint can send", () => {
    const cases = [
      [401, "unauthenticated"],
      [403, "session_not_live"],
      [403, "session_not_aal1"],
      [409, "not_enabled"],
      [403, "proof_rejected"],
      [409, "too_many_devices"],
      [400, "bad_request"],
      [400, "rejected_by_schema"],
      [500, "register_failed"],
      [503, "unavailable"],
    ] as const;
    for (const [status, error] of cases) {
      const result = parseDeviceRegisterResponse(answer(status, { error }));
      expect(result).toEqual({ outcome: "refused", reason: error, httpStatus: status, detail: null });
    }
  });

  it("reports an unrecognised error rather than guessing at it", () => {
    const result = parseDeviceRegisterResponse(answer(418, { error: "tea" }));
    expect(result).toEqual({ outcome: "refused", reason: "unknown", httpStatus: 418, detail: null });
  });

  it("survives a body that is not JSON at all", () => {
    // A proxy's HTML error page is the realistic case, and it must not throw
    // inside the caller: the body is a server's, and the server is not trusted.
    const result = parseDeviceRegisterResponse({ status: 502, body: "<html>" });
    expect(result).toEqual({ outcome: "refused", reason: "unknown", httpStatus: 502, detail: null });
  });

  it("keeps a detail string when the server sends one", () => {
    const result = parseDeviceRegisterResponse(answer(400, { error: "bad_request", detail: "x" }));
    expect(result).toEqual({
      outcome: "refused",
      reason: "bad_request",
      httpStatus: 400,
      detail: "x",
    });
  });
});

describe("registerDevice", () => {
  it("builds, calls and reads in one step", async () => {
    const seen: string[] = [];
    const result = await registerDevice(async (request) => {
      seen.push(request.name);
      return answer(200, { device_id: "dev-9" });
    }, INPUT);
    expect(seen).toEqual([DEVICE_REGISTER_FUNCTION]);
    expect(result).toEqual({ outcome: "registered", deviceId: "dev-9" });
  });
});
