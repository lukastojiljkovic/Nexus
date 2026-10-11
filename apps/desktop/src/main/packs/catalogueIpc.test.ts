import { describe, expect, it } from "vitest";

import { catalogueEntryState } from "./catalogueIpc.js";

/**
 * The one decision the catalogue layer makes on its own (ADR-103): what this
 * device has of an entry. The rest of the file is wiring between the client,
 * the downloader and the install, and it is covered where those are —
 * `catalogueClient.test.ts` and `download.test.ts` — rather than by a mock of
 * all three.
 *
 * The `null` case at the bottom is the one that matters: a version this build
 * cannot compare must not read as an update, because the row would then offer a
 * download that installs nothing new.
 */
describe("the state a catalogue entry is in on this device", () => {
  it("is not-installed when nothing of this id is installed", () => {
    expect(catalogueEntryState("2026.10.0", null)).toBe("not-installed");
  });

  it("is installed when the installed version is the catalogue's", () => {
    expect(catalogueEntryState("2026.10.0", "2026.10.0")).toBe("installed");
  });

  it("is update-available when the catalogue's version is newer", () => {
    expect(catalogueEntryState("2026.11.0", "2026.10.0")).toBe("update-available");
    expect(catalogueEntryState("2027.1.0", "2026.12.0")).toBe("update-available");
  });

  it("is installed, not an update, when the catalogue's version is older or one it cannot read", () => {
    expect(catalogueEntryState("2026.9.0", "2026.10.0")).toBe("installed");
    expect(catalogueEntryState("latest", "2026.10.0")).toBe("installed");
  });
});
