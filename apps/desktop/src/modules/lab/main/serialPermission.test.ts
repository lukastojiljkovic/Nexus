import { describe, expect, it } from "vitest";

import { allows, appOrigin, ownOrigins } from "./serialPermission.js";

/**
 * The serial permission rule, driven as the two handlers drive it: `appOrigin`
 * resolves what a handler was handed into one of the app's own origins (or
 * nothing), and `allows` answers the question. The cases below are the ones the
 * session actually produces — a packaged build's `file://` page, the dev
 * server's loopback origin, a foreign https page, and Electron's own
 * `securityOrigin` on a check.
 */

const PACKAGED: NodeJS.ProcessEnv = {};
const DEVELOPMENT: NodeJS.ProcessEnv = { ELECTRON_RENDERER_URL: "http://localhost:5173/" };

describe("ownOrigins", () => {
  it("is the packaged app's file origin, plus the dev server's when one is running", () => {
    expect(ownOrigins(PACKAGED)).toEqual(["file://"]);
    expect(ownOrigins(DEVELOPMENT)).toEqual(["file://", "http://localhost:5173"]);
  });

  it("answers nothing usable for a dev server URL it cannot read", () => {
    expect(ownOrigins({ ELECTRON_RENDERER_URL: "not a url" })).toEqual(["file://"]);
    expect(ownOrigins({ ELECTRON_RENDERER_URL: "" })).toEqual(["file://"]);
  });
});

describe("appOrigin", () => {
  it("resolves a document URL to the origin the app is served from", () => {
    expect(appOrigin("file:///C:/Nexus/renderer/index.html", PACKAGED)).toBe("file://");
    expect(appOrigin("file://", PACKAGED)).toBe("file://");
    expect(appOrigin("http://localhost:5173/index.html", DEVELOPMENT)).toBe("http://localhost:5173");
  });

  it("answers null for anything that is not one of the app's own origins", () => {
    // A foreign page cannot reach this handler at all — the request layer blocks
    // it — and the refusal is here so that the handler is right on its own.
    expect(appOrigin("https://example.com/index.html", PACKAGED)).toBeNull();
    expect(appOrigin("http://localhost:5173/", PACKAGED)).toBeNull();
    expect(appOrigin("http://localhost:9999/", DEVELOPMENT)).toBeNull();
    expect(appOrigin(null, PACKAGED)).toBeNull();
    expect(appOrigin(undefined, PACKAGED)).toBeNull();
    expect(appOrigin("", PACKAGED)).toBeNull();
    expect(appOrigin("about:blank", PACKAGED)).toBeNull();
  });
});

describe("allows", () => {
  it("allows `serial` from the app's own origin and nothing else", () => {
    expect(allows("serial", "file://", {})).toBe(true);
    expect(allows("serial", "http://localhost:5173", {})).toBe(true);
    // The whole permission list, refused: this rule is about ONE capability.
    for (const permission of ["media", "geolocation", "hid", "usb", "notifications", "unknown"]) {
      expect(allows(permission, "file://", {}), permission).toBe(false);
    }
    // An origin this rule was not told is one of ours — the caller's `appOrigin`
    // turns a foreign page into `null`, and a bare origin is refused here too.
    expect(allows("serial", null, {})).toBe(false);
  });

  it("refuses a frame whose own securityOrigin is not the origin that asked", () => {
    // Electron sets `securityOrigin` for serial checks, and a value that is not
    // the origin that reached us is a cross-origin frame asking on our behalf.
    expect(allows("serial", "file://", { securityOrigin: "file://" })).toBe(true);
    expect(allows("serial", "file://", { securityOrigin: "https://evil.example" })).toBe(false);
    expect(allows("serial", "file://", { securityOrigin: "not an origin" })).toBe(false);
    // A handler that carried no securityOrigin is the ordinary case, and it is
    // not a refusal.
    expect(allows("serial", "file://", { securityOrigin: undefined })).toBe(true);
    expect(allows("serial", "file://", null)).toBe(true);
  });

  it("accepts the file page's origin in either spelling Chromium reports", () => {
    expect(allows("serial", "file://", { securityOrigin: "file:///C:/app/index.html" })).toBe(true);
  });
});
