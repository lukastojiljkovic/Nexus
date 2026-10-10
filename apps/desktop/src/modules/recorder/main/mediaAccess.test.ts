import { afterEach, describe, expect, it } from "vitest";
import {
  MEDIA_ARM_WINDOW_MS,
  allows,
  armMediaAccess,
  disarmMediaAccess,
  mediaAccessArmedAt,
  originOf,
  selfOriginsFor,
  type MediaRequestFacts,
} from "./mediaAccess.js";

/**
 * The recorder's media rule (SEC-EL, ADR-090's module kit): a `media` permission
 * is granted to this app's own document, in its main frame, only while the
 * recorder's page has asked — and to nothing else. What is pinned here is both
 * directions: the one request that must be granted (or the module cannot record)
 * and every neighbouring one that must not.
 */

const NOW = Date.parse("2026-10-10T20:00:00.000Z");
/** The packaged renderer's document, as Chromium spells it. */
const FILE_DOCUMENT = "file:///C:/Program%20Files/Nexus/resources/app.asar/renderer/index.html";
/** A dev-server document, for the launch where `ELECTRON_RENDERER_URL` is set. */
const DEV_DOCUMENT = "http://localhost:5173/index.html";

function facts(overrides: Partial<MediaRequestFacts> = {}): MediaRequestFacts {
  return {
    mediaTypes: ["audio"],
    armed: true,
    selfOrigins: selfOriginsFor(null),
    isMainFrame: true,
    ...overrides,
  };
}

afterEach(() => {
  disarmMediaAccess();
});

describe("originOf", () => {
  it("reads an ordinary origin off a URL", () => {
    expect(originOf(DEV_DOCUMENT)).toBe("http://localhost:5173");
    expect(originOf("https://example.test/path?q=1")).toBe("https://example.test");
  });

  it("normalises a file document to `file://`, which is what Chromium calls its origin", () => {
    // `new URL(FILE_DOCUMENT).origin` is the string "null" — an opaque origin —
    // so the comparison the rule makes would never match without this.
    expect(originOf(FILE_DOCUMENT)).toBe("file://");
  });

  it("answers the empty string for anything it cannot parse, never a plausible origin", () => {
    expect(originOf("")).toBe("");
    expect(originOf("not a url at all")).toBe("");
    expect(originOf("http://[unclosed")).toBe("");
  });
});

describe("selfOriginsFor", () => {
  it("is the file document's origin in a packaged build, and the dev server's while one runs", () => {
    expect(selfOriginsFor(null)).toEqual(["file://"]);
    expect(selfOriginsFor("http://localhost:5173")).toEqual(["http://localhost:5173"]);
  });

  it("grants nothing for a dev-server setting it cannot read", () => {
    // A malformed `ELECTRON_RENDERER_URL` is not „no dev server" (which answers
    // the file document): it is a launch this rule cannot vouch for, and an
    // empty list refuses every origin there is.
    expect(selfOriginsFor("nonsense")).toEqual([]);
  });
});

describe("allows", () => {
  it("grants a microphone or camera to this app's own document while the recorder has asked", () => {
    expect(allows("media", FILE_DOCUMENT, facts({ mediaTypes: ["audio"] }))).toBe(true);
    expect(allows("media", FILE_DOCUMENT, facts({ mediaTypes: ["video"] }))).toBe(true);
    expect(allows("media", FILE_DOCUMENT, facts({ mediaTypes: ["audio", "video"] }))).toBe(true);
    expect(allows("media", DEV_DOCUMENT, facts({ selfOrigins: selfOriginsFor("http://localhost:5173") }))).toBe(true);
  });

  it("grants a check that names no capture kind, because it hands no device over", () => {
    // `enumerateDevices()` labels depend on a media check that often carries no
    // kind; granting it labels the picker and captures nothing.
    expect(allows("media", FILE_DOCUMENT, facts({ mediaTypes: [] }))).toBe(true);
    expect(allows("media", FILE_DOCUMENT, facts({ mediaTypes: ["unknown"] }))).toBe(true);
  });

  it("refuses every other permission outright", () => {
    for (const permission of ["geolocation", "notifications", "clipboard-read", "usb", "mediaKeySystem", "MEdia"]) {
      expect(allows(permission, FILE_DOCUMENT, facts()), permission).toBe(false);
    }
  });

  it("refuses media from any origin that is not this app's own document", () => {
    // The dev-server launch: a page served from loopback is NOT the app.
    expect(allows("media", DEV_DOCUMENT, facts())).toBe(false);
    // A remote document, and a URL this rule cannot read, are neither of them
    // ours.
    expect(allows("media", "https://example.test/index.html", facts())).toBe(false);
    expect(allows("media", "not a url", facts())).toBe(false);
  });

  it("treats any file document as the app's own origin, and says so out loud", () => {
    // `file://` IS every local file's origin, so this arm is one step wider than
    // „our index.html" — the window's own navigation lock is what keeps a
    // foreign file document out of it (see the function's comment). Pinned as a
    // KNOWN trade rather than discovered later: the alternative comparison is on
    // whole URLs, which Chromium re-spells on its way through this pipeline.
    expect(allows("media", "file:///C:/somewhere/else/index.html", facts())).toBe(true);
  });

  it("refuses media from a subframe, and media nobody has asked for", () => {
    expect(allows("media", FILE_DOCUMENT, facts({ isMainFrame: false }))).toBe(false);
    expect(allows("media", FILE_DOCUMENT, facts({ armed: false }))).toBe(false);
  });
});

describe("the armed window", () => {
  it("opens on `beginCapture`'s arming, closes on its own, and closes on `disarmMediaAccess`", () => {
    expect(mediaAccessArmedAt(NOW)).toBe(false);

    armMediaAccess(NOW);
    expect(mediaAccessArmedAt(NOW)).toBe(true);
    expect(mediaAccessArmedAt(NOW + MEDIA_ARM_WINDOW_MS - 1)).toBe(true);
    // Exactly at the end it is over: the window is a half-open interval, so no
    // permission is granted at the instant it closes.
    expect(mediaAccessArmedAt(NOW + MEDIA_ARM_WINDOW_MS)).toBe(false);
    expect(mediaAccessArmedAt(NOW + 10 * MEDIA_ARM_WINDOW_MS)).toBe(false);

    // The module's session ending closes it early.
    armMediaAccess(NOW);
    disarmMediaAccess();
    expect(mediaAccessArmedAt(NOW + 1)).toBe(false);
  });
});
