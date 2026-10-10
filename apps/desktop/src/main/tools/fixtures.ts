/**
 * TEST-ONLY helper — imported by the `*.test.ts` files beside it and by nothing
 * in the app, `packs/fixtures.ts`'s arrangement.
 *
 * Every tool test needs the same three things: a folder that looks like an
 * installed pack, a manifest that survived `parsePackManifest` (so the tests are
 * driven through the real validator rather than past it), and an entry that is a
 * program this machine can actually start.
 *
 * That last one is the interesting part. A pack's entry is a Windows executable,
 * and a test cannot ship one — so the fixture folder gets a HARD LINK to a copy
 * of the Node that is running the test, named `engine.exe`, and the fixture
 * scripts are given to it as argv. The link costs no bytes, the entry is a real
 * executable, and `run.ts` is unaware of any of it: it starts the entry, which is
 * exactly what it does in production. `fixtureExecutable` explains why the copy
 * is made once under `%TEMP%` and then linked rather than copied per fixture.
 */

import { createHash, type KeyObject } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePackManifest, type PackManifest, type ToolProtocol } from "../packs/manifest.js";
import { writePack } from "../packs/fixtures.js";
import { packVersionDir } from "../packs/registry.js";

/** The name the fixture's entry gets inside the pack folder: a real executable, as a pack's is. */
export const FIXTURE_ENTRY = "engine.exe";

/** An absolute path to one of the fixture scripts beside this file. */
export function fixtureScript(name: string): string {
  return join(dirname(fileURLToPath(import.meta.url)), "fixtures", name);
}

export interface ToolPackFixture {
  /** The throwaway root; a test removes it in `afterEach`. */
  readonly root: string;
  /** The folder the manifest's paths are relative to — the "installed pack". */
  readonly dir: string;
  readonly manifest: PackManifest;
  /** The absolute path of the entry, for a test that wants to tamper with it. */
  readonly entryPath: string;
}

/**
 * A fixture folder handed out more than once.
 *
 * MEASURED on this machine, and the reason this function exists: a fresh copy of
 * an executable is scanned by the OS the first time it is started — 904 ms for a
 * 92,825,416-byte Node, against about 55 ms for every later spawn of the SAME
 * path. A pack folder per test therefore spends nine tenths of a second per case
 * on antivirus work, and a suite that did that would be over its ten-second
 * budget on a machine three times as slow as this one. Sharing one folder per
 * FILE's shape is the fix: the scan happens once per distinct executable path.
 */
const sharedPacks = new Map<string, ToolPackFixture>();
const handedOut: string[] = [];

export function sharedToolPack(
  input: Parameters<typeof toolPackFixture>[0] & { readonly fresh?: boolean },
): ToolPackFixture {
  const key = JSON.stringify(input);
  if (input.fresh !== true) {
    const cached = sharedPacks.get(key);
    if (cached !== undefined) return cached;
  }
  // `fresh` is this function's own switch and is ignored by the builder, which
  // reads only the fields it knows.
  const pack = toolPackFixture(input);
  handedOut.push(pack.root);
  if (input.fresh !== true) sharedPacks.set(key, pack);
  return pack;
}

/** Removes every folder `sharedToolPack` handed out. Call it from `afterAll`. */
export function removeSharedToolPacks(): void {
  for (const root of handedOut.splice(0)) {
    // `maxRetries`: a killed child's working directory is inside this tree.
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  sharedPacks.clear();
}

/** One file's `files` entry, from the bytes that will be written. */
function entry(path: string, contents: string | Buffer): {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
} {
  const bytes = typeof contents === "string" ? Buffer.from(contents, "utf8") : contents;
  return { path, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}

let nodeFacts: { readonly size: number; readonly sha256: string } | null = null;

/** This Node's own size and SHA-256, memoised: the file is large and neither ever changes. */
function nodeEntryFacts(): { readonly size: number; readonly sha256: string } {
  if (nodeFacts === null) {
    const bytes = readFileSync(process.execPath);
    nodeFacts = { size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  return nodeFacts;
}

let fixtureBinary: string | null = null;

/**
 * The executable every fixture pack's entry is a hard link to.
 *
 * MEASURED here, and the reason this exists rather than a copy per fixture: the
 * first spawn of an executable at a path the OS has not seen costs about a second
 * of antivirus work (904 ms for a 92 MB Node against 55 ms for a path already
 * known), while a hard link shares the file — and the scan with it — at a cost of
 * 1 ms, so a linked copy spawns in 78 ms. One copy is made under `%TEMP%` and
 * kept: it is a cache in the same sense the pack builders' `nexus-pack-cache` is,
 * it is outside the repository, and a machine may remove it at any time (the
 * next run makes it again).
 */
/**
 * EXPORTED for the tests outside this folder that need a pack entry a machine
 * will really start: the module kit's tool capability (`main/moduleTools.ts`)
 * builds an INSTALLED, signed pack folder, and its entry has to be this same
 * file — the copy exists once, so linking to it is what keeps a second suite
 * from paying for the first spawn of a fresh path again.
 */
export function fixtureExecutable(): string {
  if (fixtureBinary === null) {
    const dir = join(tmpdir(), "nexus-tool-fixture-bin");
    const path = join(dir, "engine.exe");
    mkdirSync(dir, { recursive: true });
    // The size is checked, not just the existence: this is a cache in a shared
    // temporary directory, and a truncated copy left by an interrupted run must
    // be replaced rather than started.
    if (!existsSync(path) || sizeOf(path) !== sizeOf(process.execPath)) {
      rmSync(path, { force: true });
      try {
        linkSync(process.execPath, path);
      } catch {
        // A link across volumes (or past a policy) is not a reason to fail: the
        // copy costs 38 ms and the fixture behaves identically.
        copyFileSync(process.execPath, path);
      }
    }
    fixtureBinary = path;
  }
  return fixtureBinary;
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return -1;
  }
}

/**
 * A folder that is a pack this build will run: the entry, whatever extra files a
 * test needs, and a manifest built by the real parser.
 */
export function toolPackFixture(
  input: {
    readonly kind?: "tool" | "zim";
    readonly tool?: { readonly entry?: string; readonly protocol: ToolProtocol; readonly args?: readonly string[] };
    readonly files?: Readonly<Record<string, string>>;
    /** Replaces the entry with these bytes, so a test can install a pack whose manifest no longer matches it. */
    readonly entryBytes?: string;
  } = {},
): ToolPackFixture {
  const root = mkdtempSync(join(tmpdir(), "nexus-tool-fixture-"));
  const dir = join(root, "pack");
  mkdirSync(dir, { recursive: true });

  const entryPath = join(dir, FIXTURE_ENTRY);
  if (input.entryBytes === undefined) {
    try {
      linkSync(fixtureExecutable(), entryPath);
    } catch {
      copyFileSync(fixtureExecutable(), entryPath);
    }
  } else {
    // The mismatch case writes over the entry, which must therefore NOT be a hard
    // link into the shared cache: writing through the link would change the file
    // every other fixture starts from.
    writeFileSync(entryPath, input.entryBytes);
  }

  const extra = input.files ?? {};
  for (const [path, contents] of Object.entries(extra)) {
    const target = join(dir, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }

  const kind = input.kind ?? "tool";
  const entryFacts = nodeEntryFacts();
  const files = [
    // The manifest describes the entry that WAS installed. `entryBytes` then
    // writes something else to that path without touching the manifest, which is
    // the only way to reach the runner's "these are not the bytes that were
    // signed" refusal with a folder that is otherwise a valid pack.
    { path: FIXTURE_ENTRY, size: entryFacts.size, sha256: entryFacts.sha256 },
    ...Object.entries(extra).map(([path, contents]) => entry(path, contents)),
  ];

  const manifest = parsePackManifest({
    format: 1,
    id: "fixture-tool",
    version: "1.0.0",
    kind,
    title: { sr: "Probni alat", en: "Fixture tool" },
    description: { sr: "Alat za testove.", en: "A tool for tests." },
    files,
    licence: {
      spdx: "GPL-3.0-or-later",
      attribution: "The fixture's own authors",
      url: "https://www.gnu.org/licenses/gpl-3.0.html",
    },
    source: { name: "Nexus tests", url: "https://example.org/fixture" },
    minAppVersion: "1.0.0",
    ...(kind === "tool"
      ? {
          tool: {
            entry: input.tool?.entry ?? FIXTURE_ENTRY,
            protocol: input.tool?.protocol ?? "stdio",
            ...(input.tool?.args === undefined ? {} : { args: input.tool.args }),
          },
        }
      : {}),
  });
  return { root, dir, manifest, entryPath };
}

/** One pack installed the way the app installs one, as the module kit's tool capability reads it. */
export interface InstalledToolPack {
  /** The `<userData>` the capability is pointed at: the registry reads `packs/` under it. */
  readonly userData: string;
  /** The release key the pack was signed with, as the capability is told to verify against. */
  readonly publicKeyPem: string;
  /** `<userData>/packs/<id>/<version>` — the folder a session's entry is resolved under. */
  readonly dir: string;
  /** The entry's absolute path, for a test that replaces its bytes after install. */
  readonly entryPath: string;
}

/**
 * A `tool` pack INSTALLED under `userData`, signed with a throwaway key.
 *
 * `toolPackFixture` above builds a folder the runner can be handed directly; this
 * builds the folder the REGISTRY finds, which is what a module's capability goes
 * through: `<userData>/packs/<id>/<version>/` with the content, `pack.json` and
 * `pack.json.sig`, and a manifest whose kind and `tool` record the real parser
 * accepted. The entry is a hard link to the shared copy of this Node, and the
 * program's fixed `args` are how a fixture script is handed to it — exactly the
 * shape a real pack has.
 */
export function installedToolPack(input: {
  readonly userData: string;
  /** The throwaway pair this pack is signed with — one per test, reused across versions of one id. */
  readonly key: { readonly publicKeyPem: string; readonly privateKey: KeyObject };
  readonly id: string;
  readonly version: string;
  readonly protocol: ToolProtocol;
  /** The manifest's own fixed argument list, which reaches the program before anything a caller appends. */
  readonly args: readonly string[];
}): InstalledToolPack {
  const dir = packVersionDir(input.userData, input.id, input.version);
  mkdirSync(dir, { recursive: true });
  const entryPath = join(dir, FIXTURE_ENTRY);
  try {
    // A LINK to the shared copy, not to `process.execPath`: a link across volumes
    // is refused by the OS, and `fixtureExecutable` explains why one copy exists.
    linkSync(fixtureExecutable(), entryPath);
  } catch {
    copyFileSync(fixtureExecutable(), entryPath);
  }
  const facts = nodeEntryFacts();
  writePack({
    dir,
    key: input.key.privateKey,
    manifest: {
      format: 1,
      id: input.id,
      version: input.version,
      kind: "tool",
      title: { sr: "Probni alat", en: "Fixture tool" },
      description: { sr: "Alat za testove.", en: "A tool for tests." },
      files: [{ path: FIXTURE_ENTRY, size: facts.size, sha256: facts.sha256 }],
      licence: {
        spdx: "GPL-3.0-or-later",
        attribution: "The fixture's own authors",
        url: "https://www.gnu.org/licenses/gpl-3.0.html",
      },
      source: { name: "Nexus tests", url: "https://example.org/fixture" },
      minAppVersion: "1.0.0",
      tool: { entry: FIXTURE_ENTRY, protocol: input.protocol, args: [...input.args] },
    },
  });
  return { userData: input.userData, publicKeyPem: input.key.publicKeyPem, dir, entryPath };
}
