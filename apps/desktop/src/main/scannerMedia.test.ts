import { describe, expect, it } from "vitest";
import { allows, appMediaOrigins } from "./scannerMedia.js";

/**
 * The camera rule, as a pure function: every arm of it is a case here, so the
 * two session handlers that consult it hold no policy of their own.
 */

/** The packaged app's own list: `file:` and nothing else. */
const PACKAGED = appMediaOrigins({});

/** Development, where the renderer is served by electron-vite over loopback. */
const DEV = appMediaOrigins({ ELECTRON_RENDERER_URL: "http://localhost:5173/" });

const CAMERA = { mediaTypes: ["video"] };
const CAMERA_AND_MIC = { mediaTypes: ["video", "audio"] };
const MICROPHONE = { mediaTypes: ["audio"] };

describe("appMediaOrigins", () => {
  it("names only file: in a packaged launch", () => {
    expect(PACKAGED).toEqual(["file:"]);
    // An empty variable is what a packaged build has, not a missing key.
    expect(appMediaOrigins({ ELECTRON_RENDERER_URL: "" })).toEqual(["file:"]);
  });

  it("adds the dev server's own origin while developing", () => {
    expect(DEV).toEqual(["file:", "http://localhost:5173"]);
  });

  it("ignores a variable that is not a URL rather than admitting it", () => {
    expect(appMediaOrigins({ ELECTRON_RENDERER_URL: "not a url" })).toEqual(["file:"]);
  });
});

describe("allows", () => {
  it("grants the camera to the packaged renderer and to the dev server", () => {
    expect(allows("media", "file:///C:/Nexus/resources/renderer/index.html", CAMERA, PACKAGED)).toBe(true);
    expect(
      allows("media", "http://localhost:5173/index.html", CAMERA, DEV),
    ).toBe(true);
  });

  it("refuses the packaged app's camera request in a build whose list has no file: entry", () => {
    expect(allows("media", "file:///C:/Nexus/index.html", CAMERA, [])).toBe(false);
  });

  it("refuses the dev server's origin in a packaged launch", () => {
    expect(allows("media", "http://localhost:5173/index.html", CAMERA, PACKAGED)).toBe(false);
  });

  it("refuses another origin, whatever it is and however it is spelled", () => {
    for (const origin of [
      "https://example.com/",
      "http://127.0.0.1:5173/",
      "http://localhost.example.com/",
      "https://cdn.jsdelivr.net/",
      "data:text/html,x",
      "not a url",
      "",
    ]) {
      expect(allows("media", origin, CAMERA, DEV), origin).toBe(false);
    }
    expect(allows("media", null, CAMERA, DEV)).toBe(false);
  });

  it("refuses every permission that is not media, even from the app's own page", () => {
    for (const permission of [
      "geolocation",
      "notifications",
      "clipboard-read",
      "display-capture",
      "openExternal",
      "hid",
      "serial",
      "usb",
    ]) {
      expect(allows(permission, "file:///C:/Nexus/index.html", CAMERA, PACKAGED), permission).toBe(
        false,
      );
    }
  });

  it("refuses a request that also asks for the microphone, and one that asks for it alone", () => {
    // Granted partially would be the worst answer: `media` covers both devices,
    // so a scanner rule that admitted `audio` would open the microphone.
    expect(allows("media", "file:///C:/Nexus/index.html", CAMERA_AND_MIC, PACKAGED)).toBe(false);
    expect(allows("media", "file:///C:/Nexus/index.html", MICROPHONE, PACKAGED)).toBe(false);
  });

  it("refuses a request that names no media type at all", () => {
    expect(allows("media", "file:///C:/Nexus/index.html", undefined, PACKAGED)).toBe(false);
    expect(allows("media", "file:///C:/Nexus/index.html", { mediaTypes: [] }, PACKAGED)).toBe(false);
  });

  it("understands the CHECK handler's own shape, which names one media type", () => {
    // Electron declares the request handler's details and the check handler's
    // as different structures; a rule that knew only the first would refuse
    // every check, which is the camera refused one layer down.
    expect(allows("media", "file:///C:/Nexus/index.html", { mediaType: "video" }, PACKAGED)).toBe(
      true,
    );
    expect(allows("media", "file:///C:/Nexus/index.html", { mediaType: "audio" }, PACKAGED)).toBe(
      false,
    );
    expect(allows("media", "file:///C:/Nexus/index.html", { mediaType: "unknown" }, PACKAGED)).toBe(
      false,
    );
  });

  it("refuses a details object whose media fields are not the shapes Electron declares", () => {
    for (const details of [{}, { mediaTypes: "video" }, { mediaTypes: [1] }, { mediaType: 2 }, 7, null]) {
      expect(allows("media", "file:///C:/Nexus/index.html", details, PACKAGED)).toBe(false);
    }
  });

  it("defaults to the packaged answer, so a caller with no environment still gets the strict rule", () => {
    expect(allows("media", "file:///C:/Nexus/index.html", CAMERA)).toBe(true);
    expect(allows("media", "http://localhost:5173/index.html", CAMERA)).toBe(false);
  });
});
