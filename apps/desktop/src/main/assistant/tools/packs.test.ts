import { describe, expect, it } from "vitest";
import type { Tool, ToolContext } from "@nexus/core";
import type { InstalledPackView } from "../../../shared/ipc.js";
import { packTools } from "./packs.js";

/**
 * The PACKS tool: a read of the app's own Packs service.
 *
 * There is no database here on purpose — a pack is device-level content
 * (`userData/packs`), not a profile row — so what this suite pins is the shape
 * of the answer: the pack's own title in the active locale, its kind, its size
 * and its LICENCE, which is the part a model must never invent.
 */

const PROFILE_ID = "0192f0f0-0000-7000-8000-000000000000";

const PACK: InstalledPackView = {
  id: "mapa-srbije",
  version: "2026.1",
  kind: "map",
  title: { sr: "Mapa Srbije", en: "Map of Serbia" },
  description: { sr: "Vektorska mapa za rad van mreže.", en: "A vector map for offline use." },
  licence: {
    spdx: "CC-BY-4.0",
    attribution: "OpenStreetMap contributors",
    url: "https://creativecommons.org/licenses/by/4.0/",
  },
  source: { name: "OpenStreetMap", url: "https://www.openstreetmap.org/copyright" },
  size: 12_340_000,
  fileCount: 3,
  installedAt: Date.parse("2026-10-01T00:00:00.000Z"),
};

function context(locale: "sr" | "en"): ToolContext {
  return {
    profileId: PROFILE_ID,
    locale,
    signal: new AbortController().signal,
    confirm: () => Promise.resolve(true),
  };
}

function toolOf(packs: readonly InstalledPackView[]): Tool {
  const found = packTools({ packs: { list: () => Promise.resolve(packs) } }).find(
    (entry) => entry.name === "packs.list",
  );
  if (found === undefined) throw new Error('Test setup: no tool "packs.list".');
  return found;
}

describe("packs.list", () => {
  it("names each pack in the active locale, with the licence it carries", async () => {
    const sr = await toolOf([PACK]).run({}, context("sr"));
    expect(sr).toEqual({
      ok: true,
      content: [
        "Instalirani paketi (1):",
        "- mapa-srbije Mapa Srbije [vrsta map, 2026.1, 12,3 MB, licenca CC-BY-4.0 (OpenStreetMap contributors), https://creativecommons.org/licenses/by/4.0/]",
      ].join("\n"),
    });

    const en = await toolOf([PACK]).run({}, context("en"));
    expect(en.content).toBe(
      [
        "Installed packs (1):",
        "- mapa-srbije Map of Serbia [kind map, 2026.1, 12.3 MB, licence CC-BY-4.0 (OpenStreetMap contributors), https://creativecommons.org/licenses/by/4.0/]",
      ].join("\n"),
    );
  });

  it("says so when the device has no pack at all", async () => {
    expect(await toolOf([]).run({}, context("sr"))).toEqual({
      ok: true,
      content: "Na ovom uređaju nije instaliran nijedan paket sadržaja.",
    });
    expect(await toolOf([]).run({}, context("en"))).toEqual({
      ok: true,
      content: "No content pack is installed on this device.",
    });
  });
});
