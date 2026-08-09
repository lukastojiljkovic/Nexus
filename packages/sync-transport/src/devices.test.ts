import { describe, expect, it } from "vitest";
import { retireDeviceRequest, touchDeviceRequest } from "./devices.js";

const DEVICE = "6f2f4f5e-1b5c-4d3a-9a4e-2c7f0a1b2c3d";

describe("retireDeviceRequest", () => {
  it("patches exactly one row and asks to see it come back", () => {
    const request = retireDeviceRequest(DEVICE, "2026-08-09T18:00:00.000Z");
    expect(request.method).toBe("PATCH");
    expect(request.path).toBe(`/devices?id=eq.${DEVICE}&select=id`);
    expect(request.headers["Prefer"]).toBe("return=representation");
    expect(JSON.parse(request.body ?? "null")).toEqual({
      revoked_at: "2026-08-09T18:00:00.000Z",
    });
  });

  /**
   * A PATCH that matches nothing is HTTP 200 with an empty array. The caller is
   * about to throw away this computer's copy of the master key on the strength
   * of this write, so it has to be able to see whether a row came back.
   */
  it("asks for the row precisely because a matchless PATCH is a silent success", () => {
    expect(retireDeviceRequest(DEVICE, "x").path).toContain("select=id");
  });
});

describe("touchDeviceRequest", () => {
  it("writes only the heartbeat, and asks for nothing back", () => {
    const request = touchDeviceRequest(DEVICE, "2026-08-09T18:00:00.000Z");
    expect(request.path).toBe(`/devices?id=eq.${DEVICE}`);
    expect(request.headers["Prefer"]).toBeUndefined();
    expect(JSON.parse(request.body ?? "null")).toEqual({
      last_seen_at: "2026-08-09T18:00:00.000Z",
    });
  });
});

describe("both", () => {
  /** A value interpolated into a filter is checked where it is interpolated. */
  it("refuse a device id that is not one", () => {
    for (const id of ["", "..", "eq.anything", `${DEVICE} `, "*"]) {
      expect(() => retireDeviceRequest(id, "x"), JSON.stringify(id)).toThrow(TypeError);
      expect(() => touchDeviceRequest(id, "x")).toThrow(TypeError);
    }
  });
});
