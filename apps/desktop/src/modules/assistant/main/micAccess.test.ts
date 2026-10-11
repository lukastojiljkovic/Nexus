import { afterEach, describe, expect, it } from "vitest";
import {
  MIC_ARM_WINDOW_MS,
  allows,
  allowsCheck,
  allowsRequest,
  armAssistantMic,
  assistantMicArmedAt,
  disarmAssistantMic,
  originOf,
  selfOriginsFor,
  type MicRequestFacts,
} from "./micAccess.js";

/**
 * The assistant's microphone rule (SEC-EL, ADR-090's module kit): a `media`
 * permission is granted to this app's own document, in its main frame, for
 * AUDIO only, and only while the assistant's page has asked to talk. Both
 * directions are pinned here: the one request the voice feature needs, and every
 * neighbouring one that must still be refused - in particular a camera, which
 * the recorder's own rule would allow and this module has no surface for.
 */

const NOW = Date.parse("2026-10-10T20:00:00.000Z");
/** The packaged renderer's document, as Chromium spells it. */
const FILE_DOCUMENT = "file:///C:/Program%20Files/Nexus/resources/app.asar/renderer/index.html";
/** A dev-server document, for the launch where `ELECTRON_RENDERER_URL` is set. */
const DEV_DOCUMENT = "http://localhost:5173/index.html";

function facts(overrides: Partial<MicRequestFacts> = {}): MicRequestFacts {
  return {
    mediaTypes: ["audio"],
    armed: true,
    selfOrigins: selfOriginsFor(null),
    isMainFrame: true,
    ...overrides,
  };
}

afterEach(() => {
  disarmAssistantMic();
});

describe("originOf", () => {
  it("reads an ordinary origin off a URL", () => {
    expect(originOf(DEV_DOCUMENT)).toBe("http://localhost:5173");
    expect(originOf("https://example.test/path?q=1")).toBe("https://example.test");
  });

  it("normalises a file document to `file://`, which is what Chromium calls its origin", () => {
    // `new URL(FILE_DOCUMENT).origin` is the string "null" - an opaque origin -
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
    expect(selfOriginsFor("nonsense")).toEqual([]);
  });
});

describe("the arming window", () => {
  it("is closed until something arms it, and stays open for the window's whole length", () => {
    expect(assistantMicArmedAt(NOW)).toBe(false);
    armAssistantMic(NOW);
    expect(assistantMicArmedAt(NOW)).toBe(true);
    expect(assistantMicArmedAt(NOW + MIC_ARM_WINDOW_MS - 1)).toBe(true);
    // The boundary itself is closed: the window is `now < armedUntil`, so a
    // grant cannot be the last millisecond of a window nobody re-armed.
    expect(assistantMicArmedAt(NOW + MIC_ARM_WINDOW_MS)).toBe(false);
  });

  it("closes when the session ends", () => {
    armAssistantMic(NOW);
    disarmAssistantMic();
    expect(assistantMicArmedAt(NOW)).toBe(false);
  });
});

describe("allows", () => {
  it("grants the assistant's own capture: our document, our frame, audio, armed", () => {
    expect(allows("media", FILE_DOCUMENT, facts())).toBe(true);
    expect(allows("media", DEV_DOCUMENT, facts({ selfOrigins: selfOriginsFor(DEV_DOCUMENT) }))).toBe(
      true,
    );
  });

  it("refuses a camera, and a request that asks for a camera beside a microphone", () => {
    expect(allows("media", FILE_DOCUMENT, facts({ mediaTypes: ["video"] }))).toBe(false);
    expect(allows("media", FILE_DOCUMENT, facts({ mediaTypes: ["audio", "video"] }))).toBe(false);
  });

  it("refuses every permission that is not `media`", () => {
    for (const permission of ["notifications", "geolocation", "serial", "hid", "usb", "clipboard-read"]) {
      expect(allows(permission, FILE_DOCUMENT, facts()), permission).toBe(false);
    }
  });

  it("refuses a request from an origin that is not ours, and one it cannot read", () => {
    expect(allows("media", "https://example.test/", facts())).toBe(false);
    expect(allows("media", "file:///C:/elsewhere/index.html", facts())).toBe(true);
    // "could not tell" is not "ours": an unparseable origin is refused even
    // though `file://` would have been accepted.
    expect(allows("media", "not a url at all", facts())).toBe(false);
    expect(allows("media", FILE_DOCUMENT, facts({ selfOrigins: [] }))).toBe(false);
  });

  it("refuses a subframe", () => {
    expect(allows("media", FILE_DOCUMENT, facts({ isMainFrame: false }))).toBe(false);
  });

  it("refuses everything while the page has not asked to talk", () => {
    expect(allows("media", FILE_DOCUMENT, facts({ armed: false }))).toBe(false);
  });

  it("grants a request that names no capture kind, which is what the device list asks with", () => {
    // The permission CHECK behind `enumerateDevices()` often carries no kind at
    // all; answering it no would empty a device picker while granting no
    // capture, because the request handler is what hands a microphone over.
    expect(allows("media", FILE_DOCUMENT, facts({ mediaTypes: [] }))).toBe(true);
    expect(allows("media", FILE_DOCUMENT, facts({ mediaTypes: ["unknown"] }))).toBe(true);
  });
});

describe("the two handler shapes", () => {
  it("reads a request handler's details, and answers `false` for one with no URL at all", () => {
    armAssistantMic(NOW);
    expect(
      allowsRequest("media", { requestingUrl: FILE_DOCUMENT, mediaTypes: ["audio"] }, null, NOW),
    ).toBe(true);
    expect(allowsRequest("media", { mediaTypes: ["audio"] }, null, NOW)).toBe(false);
    // Before the page arms, the same request is refused: that is the whole point
    // of the window.
    disarmAssistantMic();
    expect(
      allowsRequest("media", { requestingUrl: FILE_DOCUMENT, mediaTypes: ["audio"] }, null, NOW),
    ).toBe(false);
  });

  it("reads a check handler's single media kind, and falls back to the origin argument", () => {
    armAssistantMic(NOW);
    expect(allowsCheck("media", "file://", { mediaType: "audio" }, null, NOW)).toBe(true);
    expect(allowsCheck("media", "file://", { mediaType: "video" }, null, NOW)).toBe(false);
    expect(allowsCheck("media", "file://", { mediaType: "unknown" }, null, NOW)).toBe(true);
    expect(allowsCheck("media", "file://", {}, null, NOW)).toBe(true);
    expect(allowsCheck("media", "https://example.test", { mediaType: "audio" }, null, NOW)).toBe(
      false,
    );
  });
});
