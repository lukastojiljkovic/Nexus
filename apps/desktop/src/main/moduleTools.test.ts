import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { defineModuleContract } from "../shared/moduleApi.js";
import { makeKey, writePack, type PackKey } from "./packs/fixtures.js";
import { packVersionDir } from "./packs/registry.js";
import { createModuleTools, ModuleToolError, type ModuleToolPack } from "./moduleTools.js";
import { ModuleHost, type ModulePlatform } from "./moduleIpc.js";
import { fixtureScript, installedToolPack } from "./tools/fixtures.js";
import { TOOL_LIMITS, type ToolSession } from "./tools/run.js";

/**
 * The tool capability (ADR-094) against a REAL installed pack folder.
 *
 * **Why the fixture is a signed pack on disk and not a stub.** Every refusal
 * below is decided from what `packs/registry.ts` read, and what it read is a
 * manifest whose signature verified. A stub would test the stub: the interesting
 * questions here are whether a CONTENT pack is refused as „not a tool“, whether
 * the folder a session starts in is the one the registry derived from the id and
 * the version, and whether the entry's bytes are still checked — and all three
 * are facts about files.
 *
 * **Why the entry is a hard link to this Node.** A pack's entry is a Windows
 * executable and a test cannot ship one; the link costs no bytes, and the
 * fixture scripts are handed to it as the manifest's own fixed `args`, which is
 * exactly how a real pack hands its engine a flag. The programs this file starts
 * are the fakes in `tools/fixtures/` — never Stockfish, never LibreDWG; the ids
 * are the real ones, because an id is part of the interface.
 */

let userData: string | null = null;
const sessions: ToolSession[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.close();
  if (userData !== null) {
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  userData = null;
});

/** A throwaway `<userData>` and the one key every pack in a case is signed with. */
function fixtureRoot(): { readonly userData: string; readonly key: PackKey } {
  userData = mkdtempSync(join(tmpdir(), "nexus-module-tools-"));
  return { userData, key: makeKey() };
}

/** One installed CONTENT pack under the id a tool pack would use. */
function installContent(input: { readonly userData: string; readonly key: PackKey; readonly id: string }): void {
  const contents = "not a program";
  const dir = packVersionDir(input.userData, input.id, "1.0.0");
  mkdirSync(dir, { recursive: true });
  writePack({
    dir,
    key: input.key.privateKey,
    contents: { "content.txt": contents },
    manifest: {
      format: 1,
      id: input.id,
      version: "1.0.0",
      kind: "content",
      title: { sr: "Sadržaj", en: "Content" },
      description: { sr: "Nije alat.", en: "Not a tool." },
      files: [
        {
          path: "content.txt",
          size: Buffer.byteLength(contents, "utf8"),
          sha256: createHash("sha256").update(contents, "utf8").digest("hex"),
        },
      ],
      licence: { spdx: "CC0-1.0", attribution: "Nobody", url: "https://example.org/cc0" },
      source: { name: "Nexus tests", url: "https://example.org/fixture" },
      minAppVersion: "1.0.0",
    },
  });
}

/** The capability over one fixture root, with the runner's caps and a short deadline. */
function toolsFor(root: { readonly userData: string; readonly publicKeyPem: string }) {
  return createModuleTools({
    userData: () => root.userData,
    publicKeyPem: root.publicKeyPem,
    tempRoot: root.userData,
    limits: { ...TOOL_LIMITS, timeoutMs: 30_000 },
  });
}

describe("what the capability lists", () => {
  it("lists an installed tool pack with the licence and the source a module must show", () => {
    const { userData: root, key } = fixtureRoot();
    installedToolPack({
      userData: root,
      key,
      id: "stockfish",
      version: "19.0.0",
      protocol: "uci",
      args: [fixtureScript("fake-engine.mts")],
    });
    const installed = toolsFor({ userData: root, publicKeyPem: key.publicKeyPem }).installed();
    expect(installed).toHaveLength(1);
    const pack: ModuleToolPack = installed[0]!;
    expect(pack.id).toBe("stockfish");
    expect(pack.version).toBe("19.0.0");
    expect(pack.protocol).toBe("uci");
    expect(pack.entry).toBe("engine.exe");
    // The manifest's own fixed argument list: how a real pack hands its engine a
    // flag, and how this fixture hands it its script.
    expect(pack.args).toEqual([fixtureScript("fake-engine.mts")]);
    expect(pack.licence.spdx).toBe("GPL-3.0-or-later");
    expect(pack.licence.url).toBe("https://www.gnu.org/licenses/gpl-3.0.html");
    expect(pack.source.name).toBe("Nexus tests");
    expect(pack.source.url).toBe("https://example.org/fixture");
  });

  it("lists nothing when nothing is installed, and answers null for an id that is not there", () => {
    const { userData: root, key } = fixtureRoot();
    const tools = toolsFor({ userData: root, publicKeyPem: key.publicKeyPem });
    expect(tools.installed()).toEqual([]);
    expect(tools.pack("stockfish")).toBeNull();
  });

  it("answers with the newest version when one id is installed twice", () => {
    const { userData: root, key } = fixtureRoot();
    for (const version of ["1.9.0", "1.10.0"]) {
      installedToolPack({
        userData: root,
        key,
        id: "stockfish",
        version,
        protocol: "uci",
        args: [fixtureScript("fake-engine.mts")],
      });
    }
    // `1.10.0` is newer than `1.9.0` as a version and OLDER as a string, which is
    // the whole reason the capability compares versions rather than names.
    const installed = toolsFor({ userData: root, publicKeyPem: key.publicKeyPem }).installed();
    expect(installed.map((pack) => pack.version)).toEqual(["1.10.0"]);
  });

  it("leaves an unverifiable folder out rather than listing a pack this build will not run", () => {
    const { userData: root, key } = fixtureRoot();
    installedToolPack({
      userData: root,
      key,
      id: "stockfish",
      version: "19.0.0",
      protocol: "uci",
      args: [fixtureScript("fake-engine.mts")],
    });
    // The key the capability verifies with is NOT the one that signed the pack,
    // so the registry drops the folder: as far as a module is concerned, nothing
    // is installed.
    const other = makeKey();
    expect(toolsFor({ userData: root, publicKeyPem: other.publicKeyPem }).installed()).toEqual([]);
  });
});

describe("starting a session", () => {
  it("refuses an id nothing is installed under", async () => {
    const { userData: root, key } = fixtureRoot();
    await expect(
      toolsFor({ userData: root, publicKeyPem: key.publicKeyPem }).session("stockfish", "uci"),
    ).rejects.toMatchObject({ code: "unknown-pack" });
  });

  it("refuses a pack that is installed and is not a program", async () => {
    const { userData: root, key } = fixtureRoot();
    installContent({ userData: root, key, id: "stockfish" });
    const tools = toolsFor({ userData: root, publicKeyPem: key.publicKeyPem });
    await expect(tools.session("stockfish", "uci")).rejects.toBeInstanceOf(ModuleToolError);
    await expect(tools.session("stockfish", "uci")).rejects.toMatchObject({ code: "not-a-tool" });
    // The same id also reads as no pack at all: it is content, and content is not
    // something a module may run.
    expect(tools.pack("stockfish")).toBeNull();
    expect(tools.installed()).toEqual([]);
  });

  it("refuses a pack that speaks the other protocol, before anything is started", async () => {
    const { userData: root, key } = fixtureRoot();
    installedToolPack({
      userData: root,
      key,
      id: "libredwg",
      version: "0.14.8601",
      protocol: "stdio",
      args: [fixtureScript("fake-dwg2dxf.mts")],
    });
    const tools = toolsFor({ userData: root, publicKeyPem: key.publicKeyPem });
    await expect(tools.session("libredwg", "uci")).rejects.toMatchObject({ code: "wrong-protocol" });
    // The matching request answers a session whose own record is the manifest's.
    const session = await tools.session("libredwg", "stdio");
    sessions.push(session);
    expect(session.tool.protocol).toBe("stdio");
    expect(session.tool.entry).toBe("engine.exe");
  }, 30_000);

  it("starts the entry the signed manifest names, with the manifest's own argv", async () => {
    const { userData: root, key } = fixtureRoot();
    installedToolPack({
      userData: root,
      key,
      id: "stockfish",
      version: "19.0.0",
      protocol: "stdio",
      args: [fixtureScript("fake-tool.mts"), "--fixed"],
    });
    const session = await toolsFor({ userData: root, publicKeyPem: key.publicKeyPem }).session(
      "stockfish",
      "stdio",
    );
    sessions.push(session);
    const result = await session.run({ args: ["ok"], stdin: "" });
    expect(result.code).toBe(0);
    // Node eats the script as the program to run, so `--fixed` is the first thing
    // the script itself sees: the manifest's fixed argument first, the caller's
    // second, and no renderer anywhere in the list.
    const argv = result.stdout
      .toString("utf8")
      .split("\n")
      .find((line) => line.startsWith("argv: "));
    expect(argv).toBe("argv: --fixed ok");
    // MEASURED: this case takes 207 ms with the shared executable already cached
    // (the entry's 92 MB hash included), and the whole file is about 4 s on this
    // machine. A machine that has never started this exact path pays about a
    // second of antivirus work on top; the budget is CI's margin.
  }, 30_000);

  it("refuses an entry whose bytes are not the bytes the manifest states", async () => {
    const { userData: root, key } = fixtureRoot();
    const installed = installedToolPack({
      userData: root,
      key,
      id: "stockfish",
      version: "19.0.0",
      protocol: "stdio",
      args: [fixtureScript("fake-tool.mts")],
    });
    writeFileSync(installed.entryPath, "not this node");
    const session = await toolsFor({ userData: root, publicKeyPem: key.publicKeyPem }).session(
      "stockfish",
      "stdio",
    );
    sessions.push(session);
    await expect(session.start({ args: ["ok"] })).rejects.toMatchObject({ code: "hash-mismatch" });
  }, 30_000);
});

describe("the capability in a process that has none", () => {
  const contract = defineModuleContract<
    "probe",
    { poke: { request: Record<string, never>; response: unknown } }
  >("probe", ["poke"]);

  it("refuses by name, rather than answering as though nothing were installed", () => {
    const platform = {
      assertTrustedSender: () => undefined,
      database: () => {
        throw new Error("this test has no database");
      },
      notify: () => undefined,
      schedule: () => () => undefined,
      now: () => 0,
    } satisfies ModulePlatform;
    const host = new ModuleHost(platform);
    const ctx = host.adopt(contract);
    // A harness with no tool access is a wiring mistake, and the two mistakes
    // must not look the same from inside a module: `tools()` throws, where an
    // empty `installed()` list would read as „the user has installed nothing“.
    expect(() => ctx.tools()).toThrow(/no tool-pack access/);
  });
});
