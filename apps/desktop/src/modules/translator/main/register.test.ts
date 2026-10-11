import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dictionaryKey, serbianLatin } from "@nexus/core";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { baseManifest, entry, makeKey, writePack } from "../../../main/packs/fixtures.js";
import { register } from "./register.js";

/**
 * TRANSLATOR through the kit (ADR-090): its three ops, over the fixture pack the
 * converter tests also pin.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * refusals and the sender check are the host's: going through `dispatch` tests
 * what runs in the app — a typo in an op name, a payload the validators refuse
 * or a message from an untrusted sender is a rejected promise here, not a
 * surprise on the first keystroke.
 *
 * **The pack is the fixture pack, not a hand-written one.** It is the exact
 * bytes `write-fixtures.mjs` writes and `convert.test.mjs` compares, so this
 * file tests the READER against the WRITER's output rather than against a second
 * idea of the format. It is installed under a temporary `packs/` root that
 * `./packDir.js` is mocked to answer with — the one Electron-shaped dependency
 * this module has.
 *
 * **The database is a tripwire.** The platform's `database()` throws, so a
 * lookup that ever reached for a profile row would fail here rather than pass
 * quietly: this module has no tables and reads no profile data (see its header).
 */

const state = vi.hoisted(() => ({ root: "" }));
vi.mock("./packDir.js", () => ({ installedPacksRoot: () => state.root }));

const TRUSTED = { trusted: true };
const PACK_VERSION = "2026.10.0";
const GOLDEN = fileURLToPath(new URL("../../../../../../scripts/packs/dictionary/fixtures/expected", import.meta.url));

let dir = "";

/**
 * The key the harness's throwaway model pack is SIGNED with.
 *
 * `readInstalled` re-verifies every manifest against the key it is handed, so a
 * pack written for this test has to be signed by the key the platform supplies —
 * which is the point of the arrangement rather than a complication: the app's
 * real key is the release key's public half, and a test may never use it.
 */
const packKey = makeKey();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-translator-"));
  state.root = join(dir, "packs");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  state.root = "";
});

/** Installs the fixture pack under the temporary packs root, the way ADR-091 lays an installed pack out. */
function installPack(): void {
  const target = join(state.root, "dictionary-sr-en", PACK_VERSION);
  mkdirSync(target, { recursive: true });
  cpSync(GOLDEN, target, { recursive: true });
}

function harness(): ModuleHost {
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => {
      throw new Error("the translator reads no database");
    },
    notify: () => {
      throw new Error("the translator announces nothing");
    },
    schedule: () => {
      throw new Error("the translator arms no timers");
    },
    // The pack registry's own two inputs, which is what the `packs` op reads the
    // installed list through: this module never names a path or a key of its own.
    packs: { userData: () => dir, publicKeyPem: packKey.publicKeyPem },
    now: () => Date.now(),
  };
  const host = new ModuleHost(platform);
  register(host);
  return host;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

/** One search, typed enough to read the assertions below. */
interface SearchView {
  direction: string;
  requested: string;
  key: string;
  exact: {
    word: string;
    latin: string | null;
    pos: string;
    glosses: string[];
    translations: string[];
    url: string;
  }[];
  prefix: { word: string }[];
  truncated: boolean;
}

describe("the translator handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    expect(harness().channels()).toEqual([
      "translator:status",
      "translator:search",
      "translator:phrases",
      // The sentence translator's model lookup: the installed packs, by id and
      // kind, so a pack the user installs makes a direction offerable without a
      // reload (ADR-107's wiring of `sentences/SentenceTranslator.tsx`).
      "translator:packs",
    ]);
  });

  it("answers the pack's state, and says there is none rather than throwing", async () => {
    const host = harness();
    const missing = await call<{ installed: boolean; counts: unknown }>(host, "translator:status", {});
    expect(missing).toEqual({ installed: false, version: null, counts: null, attribution: "", licence: "" });

    installPack();
    const installed = await call<{
      installed: boolean;
      version: string;
      counts: { enEntries: number; srEntries: number; topics: number };
      attribution: string;
      licence: string;
    }>(host, "translator:status", {});
    expect(installed.installed).toBe(true);
    expect(installed.version).toBe(PACK_VERSION);
    // Compared against the pack's OWN statement about itself rather than
    // against numbers typed here, so a field the reader forgot to map fails.
    // Compared against the pack's OWN statement about itself rather than
    // against numbers typed here, so a count the reader maps to the wrong field
    // fails. The pack also records what its caps dropped; the wire does not.
    const counts = JSON.parse(readFileSync(join(GOLDEN, "about.json"), "utf8")).counts;
    expect(installed.counts).toEqual({
      enKeys: counts.enKeys,
      enEntries: counts.enEntries,
      srKeys: counts.srKeys,
      srEntries: counts.srEntries,
      phrases: counts.phrases,
      topics: counts.topics,
    });
    expect(installed.counts.enEntries).toBe(4);
    expect(installed.licence).toBe("CC-BY-SA-4.0");
    expect(installed.attribution).toContain("Wiktionary");
  });

  it("answers an empty view for a machine with no pack, and no phrasebook", async () => {
    const host = harness();
    const search = await call<SearchView>(host, "translator:search", {
      direction: "en-sr",
      query: "kafa",
      limit: 10,
    });
    expect(search).toEqual({
      direction: "en-sr",
      requested: "en-sr",
      key: "",
      exact: [],
      prefix: [],
      truncated: false,
    });
    expect(await call(host, "translator:phrases", {})).toEqual({ topics: [] });
  });
});

describe("the search", () => {
  beforeEach(() => {
    installPack();
  });

  it("answers the exact key's entries, with the source's own glosses and translations", async () => {
    const view = await call<SearchView>(harness(), "translator:search", {
      direction: "en-sr",
      query: "dictionary",
      limit: 20,
    });
    expect(view.key).toBe("dictionary");
    expect(view.prefix).toEqual([]);
    expect(view.exact).toHaveLength(1);
    expect(view.exact[0]?.word).toBe("dictionary");
    expect(view.exact[0]?.pos).toBe("noun");
    expect(view.exact[0]?.url).toBe("https://en.wiktionary.org/wiki/dictionary");
    // The gloss is the source's own text, and the translations are the Serbian
    // words the record carries — the folded keys are asserted rather than the
    // strings because the source stores them with their tone marks.
    expect(view.exact[0]?.glosses[0]).toContain("A reference work listing words");
    expect(view.exact[0]?.translations.map(dictionaryKey)).toEqual(["recnik", "rjecnik", "slovnik"]);
  });

  it("answers one key's several entries, which is why an entry is not one row per headword", async () => {
    const view = await call<SearchView>(harness(), "translator:search", {
      direction: "en-sr",
      query: "free",
      limit: 20,
    });
    expect(view.exact.map((entry) => entry.pos)).toEqual(["adj", "verb"]);
    expect(view.exact[1]?.glosses).toEqual(["To make free; set at liberty; release."]);
    expect(view.exact[1]?.translations.map(dictionaryKey)).toEqual(["oslobadjati", "osloboditi"]);
  });

  it("finds the neighbourhood of a partial query, exact-first and then by key", async () => {
    const view = await call<SearchView>(harness(), "translator:search", {
      direction: "en-sr",
      query: "f",
      limit: 20,
    });
    expect(view.exact).toEqual([]);
    expect(view.prefix.map((entry) => entry.word)).toEqual(["free", "free"]);
    expect(view.truncated).toBe(false);
  });

  it("stops at the cap and says it stopped", async () => {
    const view = await call<SearchView>(harness(), "translator:search", {
      direction: "en-sr",
      query: "f",
      limit: 1,
    });
    expect(view.prefix).toHaveLength(1);
    expect(view.truncated).toBe(true);
  });

  it("spells a Cyrillic headword in Latin, which is what a Serbian reader of a Latin interface needs", async () => {
    const view = await call<SearchView>(harness(), "translator:search", {
      direction: "sr-en",
      query: "указ",
      limit: 20,
    });
    expect(view.exact.map((entry) => entry.latin)).toEqual(["ukaz"]);
    expect(view.exact.map((entry) => entry.glosses)).toEqual([["order, decree, ukase"]]);
    const source = view.exact[0]?.word ?? "";
    expect(serbianLatin(source)).toBe("ukaz");
  });

  it("finds a Serbian word typed without its diacritics", async () => {
    const view = await call<SearchView>(harness(), "translator:search", {
      direction: "sr-en",
      query: "ukaz",
      limit: 20,
    });
    // `ukaz` is the folded key of `КУЦА`, so the Latin query
    // finds the Cyrillic headword.
    expect(view.key).toBe("ukaz");
    expect(view.exact).toHaveLength(1);
    expect(view.exact[0]?.latin).toBe("ukaz");
  });

  it("takes the direction the caller pinned", async () => {
    const view = await call<SearchView>(harness(), "translator:search", {
      direction: "sr-en",
      query: "f",
      limit: 20,
    });
    expect(view.direction).toBe("sr-en");
    expect(view.requested).toBe("sr-en");
    expect(view.exact.map((entry) => entry.pos)).toEqual(["character", "prep"]);
  });
});

describe("the direction the dictionary chooses on auto", () => {
  beforeEach(() => {
    installPack();
  });

  it("reads a query that carries a Serbian letter as Serbian", async () => {
    // No index has this query; the SCRIPT is what decides, and a Cyrillic query
    // is never an English headword.
    const cyrillic = await call<SearchView>(harness(), "translator:search", {
      direction: "auto",
      query: "ЖЕНА",
      limit: 20,
    });
    expect(cyrillic.direction).toBe("sr-en");
    expect(cyrillic.requested).toBe("auto");
    expect(cyrillic.exact).toEqual([]);
  });

  it("asks the English index first for a query with no Serbian letter", async () => {
    const english = await call<SearchView>(harness(), "translator:search", {
      direction: "auto",
      query: "free",
      limit: 20,
    });
    expect(english.direction).toBe("en-sr");
  });

  it("falls to the Serbian index when the English one has nothing", async () => {
    const serbian = await call<SearchView>(harness(), "translator:search", {
      direction: "auto",
      query: "august",
      limit: 20,
    });
    expect(serbian.direction).toBe("sr-en");
    expect(serbian.exact.map((entry) => entry.glosses)).toEqual([["August"]]);
  });
});

describe("the phrasebook", () => {
  it("answers the topics the pack carries, in the source's order", async () => {
    installPack();
    const view = await call<{ topics: { id: string; title: string; phrases: { en: string; sr: string }[] }[] }>(
      harness(),
      "translator:phrases",
      {},
    );
    expect(view.topics.map((topic) => topic.id)).toEqual([
      "vowels",
      "consonants",
      "common-diphthongs",
      "basics",
    ]);
    const basics = view.topics.find((topic) => topic.id === "basics");
    expect(basics?.phrases[0]?.en).toBe("Hello.");
    expect(view.topics.reduce((sum, topic) => sum + topic.phrases.length, 0)).toBe(59);
  });
});

/**
 * The sentence translator's model lookup.
 *
 * What is asserted is the boundary rather than the engine: the list is the
 * REGISTRY's — a signed folder on this machine, verified against the key main
 * holds — and what crosses the wire is an id and a kind, never a path. The pack
 * is a real one written by the pack suite's own fixture builder, so this drives
 * the same `readInstalled` the Packs card does.
 */
describe("the installed packs the sentence translator reads", () => {
  it("answers nothing when no pack is installed, rather than refusing", async () => {
    expect(await call(harness(), "translator:packs", {})).toEqual({ packs: [] });
  });

  it("answers every installed pack by id and kind, and not by path", async () => {
    const contents = { "model.bin": "not a real model, and not read here" };
    writePack({
      dir: join(state.root, "translate-sr-en", "1.0.0"),
      key: packKey.privateKey,
      contents,
      manifest: baseManifest([entry("model.bin", contents["model.bin"])], {
        id: "translate-sr-en",
        kind: "model",
      }),
    });
    // The dictionary the word search reads lives in the SAME root, and it is not
    // in this answer: it is a `about.json` pack (the converter's format), not an
    // ADR-091 manifest, so the registry — which is what this op asks — has never
    // seen it. That is the reader split the module's header records.
    installPack();
    expect(await call(harness(), "translator:packs", {})).toEqual({
      packs: [{ id: "translate-sr-en", kind: "model" }],
    });
  });
});

describe("what the wire refuses", () => {
  beforeEach(() => {
    installPack();
  });

  it("refuses a direction outside the switch's vocabulary, by name", async () => {
    await expect(
      call(harness(), "translator:search", { direction: "sideways", query: "kafa", limit: 10 }),
    ).rejects.toThrow(/direction/);
    await expect(
      call(harness(), "translator:search", { query: "kafa", limit: 10 }),
    ).rejects.toThrow(/direction/);
  });

  it("refuses a query past the cap and a limit outside the range, before the pack is read", async () => {
    const host = harness();
    await expect(
      call(host, "translator:search", { direction: "en-sr", query: "k".repeat(81), limit: 10 }),
    ).rejects.toThrow(/must not exceed 80 characters/);
    await expect(
      call(host, "translator:search", { direction: "en-sr", query: "kafa", limit: 0 }),
    ).rejects.toThrow(/between 1 and 50/);
    await expect(
      call(host, "translator:search", { direction: "en-sr", query: "kafa", limit: 51 }),
    ).rejects.toThrow(/between 1 and 50/);
    await expect(
      call(host, "translator:search", { direction: "en-sr", query: "kafa", limit: 1.5 }),
    ).rejects.toThrow(/integer/);
    await expect(
      call(host, "translator:search", { direction: "en-sr", query: 42, limit: 10 }),
    ).rejects.toThrow(/must be a string/);
  });

  it("refuses a payload that is not an object at all", async () => {
    await expect(call(harness(), "translator:status", "everything")).rejects.toThrow(/expected an object/);
    await expect(call(harness(), "translator:phrases", [])).rejects.toThrow(/expected an object/);
  });

  it("refuses a message from a sender this app did not send", async () => {
    const host = harness();
    await expect(host.dispatch("translator:status", { trusted: false }, {})).rejects.toThrow(
      /did not come from this app/,
    );
  });

  it("refuses a channel no module answers", async () => {
    await expect(harness().dispatch("translator:summon", TRUSTED, {})).rejects.toThrow(
      /No module answers channel/,
    );
  });
});
