import { describe, expect, it } from "vitest";
import { SAFETY_NOTICE, type ConfirmRequest, type Tool, type ToolContext } from "@nexus/core";
import type {
  InstalledPackView,
  PackCatalogueEntryView,
  PackCatalogueResult,
  PackDownloadResult,
  PackRemoveResult,
} from "../../../shared/ipc.js";
import { packTools, type PackManager } from "./packs.js";

/**
 * The PACKS tools: a read of the list, and the three decisions that change it.
 *
 * There is no database here on purpose — a pack is device-level content
 * (`userData/packs`), not a profile row — so the service is a fake that records
 * what the tool asked for. What this suite pins is the shape of each answer, the
 * licence a model must never invent, and the rules that protect a download: the
 * mode, the confirmation, and the name a tool may act on.
 */

const PROFILE_ID = "0192f0f0-0000-7000-8000-000000000000";

const PACK: InstalledPackView = {
  id: "mapa-srbije",
  version: "2026.1",
  kind: "map",
  notice: null,
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

const SAFETY_PACK: InstalledPackView = {
  ...PACK,
  id: "prva-pomoc",
  kind: "content",
  notice: "safety",
  title: { sr: "Prva pomoć", en: "First aid" },
};

const CATALOGUE_ENTRY: PackCatalogueEntryView = {
  id: "mapa-srbije",
  version: "2026.1",
  kind: "map",
  title: PACK.title,
  description: PACK.description,
  size: PACK.size,
  fileCount: 3,
  licence: PACK.licence,
  source: PACK.source,
  notice: null,
  state: "not-installed",
  installedVersion: null,
};

interface Recorded {
  readonly confirms: ConfirmRequest[];
  readonly downloads: string[];
  readonly removals: string[];
}

interface Fake {
  readonly packs: PackManager;
  readonly recorded: Recorded;
}

function fakeOf(options: {
  installed?: readonly InstalledPackView[];
  catalogue?: PackCatalogueResult;
  downloadsAllowed?: boolean;
  removal?: PackRemoveResult;
}): Fake {
  const recorded: Recorded = { confirms: [], downloads: [], removals: [] };
  const downloaded: PackDownloadResult = { outcome: "paused", id: "mapa-srbije" };
  const packs: PackManager = {
    list: () => Promise.resolve(options.installed ?? []),
    catalogue: () =>
      Promise.resolve(options.catalogue ?? { outcome: "ready", entries: [CATALOGUE_ENTRY] }),
    download: (id) => {
      recorded.downloads.push(id);
      return Promise.resolve(downloaded);
    },
    remove: (id) => {
      recorded.removals.push(id);
      return Promise.resolve(options.removal ?? { outcome: "removed", id });
    },
    downloadsAllowed: () => options.downloadsAllowed ?? true,
  };
  return { packs, recorded };
}

function contextOf(locale: "sr" | "en", recorded: Recorded, answer = true): ToolContext {
  return {
    profileId: PROFILE_ID,
    locale,
    signal: new AbortController().signal,
    confirm: (request) => {
      recorded.confirms.push(request);
      return Promise.resolve(answer);
    },
  };
}

function toolNamed(fake: Fake, name: string): Tool {
  const found = packTools({ packs: fake.packs }).find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

describe("packs.list", () => {
  it("names each pack in the active locale, with the licence it carries", async () => {
    const fake = fakeOf({ installed: [PACK] });
    const sr = await toolNamed(fake, "packs.list").run({}, contextOf("sr", fake.recorded));
    expect(sr).toEqual({
      ok: true,
      content: [
        "Instalirani paketi (1):",
        "- mapa-srbije Mapa Srbije [vrsta map, 2026.1, 12,3 MB, licenca CC-BY-4.0 (OpenStreetMap contributors), https://creativecommons.org/licenses/by/4.0/]",
      ].join("\n"),
    });

    const en = await toolNamed(fake, "packs.list").run({}, contextOf("en", fake.recorded));
    expect(en.content).toBe(
      [
        "Installed packs (1):",
        "- mapa-srbije Map of Serbia [kind map, 2026.1, 12.3 MB, licence CC-BY-4.0 (OpenStreetMap contributors), https://creativecommons.org/licenses/by/4.0/]",
      ].join("\n"),
    );
  });

  it("says so when the device has no pack at all", async () => {
    const fake = fakeOf({});
    expect(await toolNamed(fake, "packs.list").run({}, contextOf("sr", fake.recorded))).toEqual({
      ok: true,
      content: "Na ovom uređaju nije instaliran nijedan paket sadržaja.",
    });
    expect(await toolNamed(fake, "packs.list").run({}, contextOf("en", fake.recorded))).toEqual({
      ok: true,
      content: "No content pack is installed on this device.",
    });
  });

  it("names a safety notice on the pack that carries one, and states the notice once", async () => {
    const fake = fakeOf({ installed: [PACK, SAFETY_PACK] });
    const result = await toolNamed(fake, "packs.list").run({}, contextOf("en", fake.recorded));
    expect(result.content).toContain("[kind content, 2026.1, 12.3 MB, licence CC-BY-4.0 (OpenStreetMap contributors), https://creativecommons.org/licenses/by/4.0/, safety notice required]");
    expect(result.content.split(SAFETY_NOTICE.en)).toHaveLength(2);
    expect(result.content.endsWith(SAFETY_NOTICE.en)).toBe(true);
  });
});

describe("packs.catalogue", () => {
  it("refuses in an offline launch, naming the setting, and asks nothing", async () => {
    const fake = fakeOf({ downloadsAllowed: false });
    const result = await toolNamed(fake, "packs.catalogue").run({}, contextOf("en", fake.recorded));
    expect(result.ok).toBe(false);
    expect(result.content).toContain("Turn on “Downloads”");
    expect(fake.recorded.confirms).toEqual([]);
  });

  it("lists what can be installed with its state on this device", async () => {
    const fake = fakeOf({
      catalogue: {
        outcome: "ready",
        entries: [{ ...CATALOGUE_ENTRY, state: "update-available", installedVersion: "2025.4" }],
      },
    });
    const result = await toolNamed(fake, "packs.catalogue").run({}, contextOf("en", fake.recorded));
    expect(result).toEqual({
      ok: true,
      content: [
        "Packs in the catalogue (1):",
        "- mapa-srbije Map of Serbia [kind map, 2026.1, 12.3 MB, licence CC-BY-4.0, update available]",
      ].join("\n"),
    });
    expect(fake.recorded.confirms).toHaveLength(1);
  });

  it("writes nothing and reads nothing when the user declines", async () => {
    const fake = fakeOf({});
    const result = await toolNamed(fake, "packs.catalogue").run({}, contextOf("en", fake.recorded, false));
    expect(result).toEqual({ ok: false, content: "The user declined." });
  });
});

describe("packs.install", () => {
  it("names the pack and its size, then starts the download and points at the Packs card", async () => {
    const fake = fakeOf({});
    const result = await toolNamed(fake, "packs.install").run(
      { pack: "Map of Serbia" },
      contextOf("en", fake.recorded),
    );
    expect(fake.recorded.confirms[0]?.summary).toBe(
      "Download “Map of Serbia” (12.3 MB) and install it? The download may take a long time.",
    );
    expect(fake.recorded.downloads).toEqual(["mapa-srbije"]);
    expect(result).toEqual({
      ok: true,
      content: "The download of “Map of Serbia” has started. Its progress shows in the Packs card in Settings; the pack is ready when it says installed.",
      navigateTo: { module: "settings", settings: "packs" },
    });
  });

  it("downloads nothing when the user declines", async () => {
    const fake = fakeOf({});
    const result = await toolNamed(fake, "packs.install").run(
      { pack: "mapa-srbije" },
      contextOf("en", fake.recorded, false),
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(fake.recorded.downloads).toEqual([]);
  });

  it("refuses a name the catalogue does not hold, and an offline launch", async () => {
    const fake = fakeOf({});
    const unknown = await toolNamed(fake, "packs.install").run(
      { pack: "Nepostojeći" },
      contextOf("en", fake.recorded),
    );
    expect(unknown).toEqual({ ok: false, content: "Failed: there is no pack “Nepostojeći”." });

    const offline = fakeOf({ downloadsAllowed: false });
    const refused = await toolNamed(offline, "packs.install").run(
      { pack: "mapa-srbije" },
      contextOf("en", offline.recorded),
    );
    expect(refused.ok).toBe(false);
    expect(offline.recorded.downloads).toEqual([]);
  });
});

describe("packs.remove", () => {
  it("resolves the title ignoring diacritics, names the size, and removes it", async () => {
    const fake = fakeOf({ installed: [PACK] });
    const result = await toolNamed(fake, "packs.remove").run(
      { pack: "map of serbia" },
      contextOf("en", fake.recorded),
    );
    expect(fake.recorded.confirms[0]?.summary).toBe(
      "Remove the pack “Map of Serbia” 2026.1 (12.3 MB)? To get it back, it has to be downloaded again.",
    );
    expect(fake.recorded.removals).toEqual(["mapa-srbije"]);
    expect(result).toEqual({
      ok: true,
      content: "Removed the pack “Map of Serbia”.",
      navigateTo: { module: "settings", settings: "packs" },
    });
  });

  it("refuses an unknown pack without removing anything", async () => {
    const fake = fakeOf({ installed: [PACK] });
    const result = await toolNamed(fake, "packs.remove").run({ pack: "Atlas" }, contextOf("sr", fake.recorded));
    expect(result).toEqual({ ok: false, content: "Neuspešno: nema paketa „Atlas“." });
    expect(fake.recorded.removals).toEqual([]);
  });

  it("writes nothing when the user declines", async () => {
    const fake = fakeOf({ installed: [PACK] });
    const result = await toolNamed(fake, "packs.remove").run(
      { pack: "mapa-srbije" },
      contextOf("en", fake.recorded, false),
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(fake.recorded.removals).toEqual([]);
  });

  it("refuses a title two installed packs share, listing their ids", async () => {
    const fake = fakeOf({ installed: [PACK, { ...PACK, id: "mapa-srbije-2" }] });
    const result = await toolNamed(fake, "packs.remove").run(
      { pack: "Map of Serbia" },
      contextOf("en", fake.recorded),
    );
    expect(result).toEqual({
      ok: false,
      content: "Failed: more than one pack matches “Map of Serbia”: mapa-srbije, mapa-srbije-2. Name the exact id.",
    });
    expect(fake.recorded.removals).toEqual([]);
  });
});
