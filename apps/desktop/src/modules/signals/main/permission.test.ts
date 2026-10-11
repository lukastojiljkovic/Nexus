import { describe, expect, it } from "vitest";

import { allows } from "./permission.js";

/**
 * The microphone exception, as a decision table.
 *
 * What is pinned here is that the exception is exactly one permission, from
 * exactly one page, of exactly one kind of device: every other row below — a
 * camera, a USB device, a geolocation, a remote origin, a subframe — must stay as
 * refused as it was before this module existed.
 */

const DEV = "http://localhost:5173";

describe("allows", () => {
  it("admits audio from this application's own page, in either spelling the handlers use", () => {
    // The request handler, reported as a URL…
    expect(allows("media", "file:///C:/Nexus/renderer/index.html", { mediaTypes: ["audio"] }, null)).toBe(true);
    // …and as the serialized origin.
    expect(allows("media", "file://", { mediaTypes: ["audio"] }, null)).toBe(true);
    // The check handler reports one media kind instead of a list.
    expect(allows("media", "file://", { mediaType: "audio" }, null)).toBe(true);
  });

  it("admits the dev server only when this launch named it", () => {
    expect(allows("media", DEV, { mediaTypes: ["audio"] }, DEV)).toBe(true);
    expect(allows("media", `${DEV}/index.html`, { mediaTypes: ["audio"] }, DEV)).toBe(true);
    // Without the origin this launch was built with, a loopback page is a page
    // that is not ours — the same rule `net/offline.ts` states for requests.
    expect(allows("media", DEV, { mediaTypes: ["audio"] }, null)).toBe(false);
  });

  it("refuses a camera, and refuses a request that asks for both", () => {
    expect(allows("media", "file://", { mediaTypes: ["video"] }, null)).toBe(false);
    expect(allows("media", "file://", { mediaTypes: ["audio", "video"] }, null)).toBe(false);
    // The check handler's `unknown` kind is not a microphone request either.
    expect(allows("media", "file://", { mediaType: "unknown" }, null)).toBe(false);
    expect(allows("media", "file://", {}, null)).toBe(false);
  });

  it("refuses a page that is not this application's", () => {
    expect(allows("media", "https://example.com", { mediaTypes: ["audio"] }, null)).toBe(false);
    expect(allows("media", "https://example.com", { mediaTypes: ["audio"] }, DEV)).toBe(false);
    // A look-alike dev origin is not the dev origin.
    expect(allows("media", `${DEV}.evil.test`, { mediaTypes: ["audio"] }, DEV)).toBe(false);
  });

  it("refuses a subframe", () => {
    expect(allows("media", "file://", { mediaTypes: ["audio"], isMainFrame: false }, null)).toBe(
      false,
    );
    // „Not said" is not „false": a missing field must not be read as a refusal of
    // an otherwise good ask (the check handler omits it in some paths).
    expect(allows("media", "file://", { mediaTypes: ["audio"] }, null)).toBe(true);
  });

  it("refuses every other permission, whatever the details say", () => {
    for (const permission of [
      "geolocation",
      "usb",
      "serial",
      "hid",
      "notifications",
      "clipboard-read",
      "mediaKeySystem",
      "unknown",
    ]) {
      expect(allows(permission, "file://", { mediaTypes: ["audio"] }, DEV)).toBe(false);
    }
  });
});
