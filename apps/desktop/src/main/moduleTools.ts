/**
 * ADR-094's tool packs, as a capability of the module kit (ADR-090).
 *
 * **Why this file exists rather than a module importing `tools/run.ts`.** The
 * runner is the security boundary and it is deliberately dumb: it takes an
 * installed folder and a signed manifest and it will start whatever that
 * manifest names. Deciding WHICH pack that is, and whether it is the one the
 * caller thinks it is, is a different question with a different answer per
 * caller, and every module that asked it would ask it in its own way. So the
 * finding half lives here, once, on top of `packs/registry.ts`'s own two reads
 * and `tools/run.ts`'s one spawn:
 *
 * 1. **`installed()` is what the app can run, and nothing else.** A pack is
 *    listed when the registry lists it AND its kind is `tool` AND its manifest
 *    carries the `tool` record: those two are refused together by
 *    `parsePackManifest`, so this filter is what "a pack this build will start"
 *    means. The manifest's signature was verified before it was read
 *    (`registry.ts`), and the ENTRY's bytes are verified again by the runner
 *    before the first spawn of a session, which is the check that survives a
 *    file replaced after install.
 * 2. **`session()` names one program and one way of speaking to it.** The
 *    caller states the protocol it is going to speak (`uci` for an engine,
 *    `stdio` for a filter) and a pack that speaks the other one is refused by
 *    name: an engine asked over stdin/stdout would be a hung page rather than
 *    an error, and an error the user can read is the whole point of a refusal.
 * 3. **Nothing a renderer sends reaches argv.** This capability is reachable
 *    from a module's MAIN half alone (`ModuleCall.tools`, `ModuleContext.tools`)
 *    and it answers a `ToolSession`, whose `start` takes only what main appends
 *    to the manifest's own fixed argument list. No channel carries a pack id, a
 *    path or an argument, and no renderer ever learns a program's name.
 *
 * **One pack id, two versions installed.** The registry may hold two version
 * folders of one id (an install beside an older copy), so both `pack()` and
 * `session()` answer with the NEWEST version, compared by the app's own
 * `update/version.ts` parser rather than by string order: `1.10.0` sorts before
 * `1.9.0` as text and after it as a version, and the pack a module runs is not
 * the place to discover that difference.
 *
 * **What it does not do.** It does not install, remove or verify a pack (that is
 * ADR-091's card and `packs/packsIpc.ts`), it does not cache a session, and it
 * does not keep one alive: a caller that opens a session owns closing it, and
 * `tools/run.ts` already holds every live one so an app quit can kill them.
 */

import type { PackLicence, PackSource, PackText, ToolProtocol } from "./packs/manifest.js";
import { packVersionDir, readInstalled, type InstalledPack } from "./packs/registry.js";
import { createToolSession, type ToolLimits, type ToolSession } from "./tools/run.js";
import { compareVersions } from "./update/version.js";

/**
 * One installed tool pack, as a module sees it.
 *
 * The manifest's `entry`, `args` and `protocol` are carried because the runner
 * needs them and because the two clients beside it (`tools/uci.ts`,
 * `tools/dwg.ts`) ask the session for them; the licence and the source are
 * carried because ADR-094 requires the app to show them wherever it names the
 * program, and a module that had to read the pack's folder to find them would be
 * a second reader of a signed manifest.
 */
export interface ModuleToolPack {
  readonly id: string;
  readonly version: string;
  readonly title: PackText;
  readonly protocol: ToolProtocol;
  readonly entry: string;
  /** The manifest's fixed arguments, which the runner passes before anything a caller appends. */
  readonly args: readonly string[];
  readonly licence: PackLicence;
  readonly source: PackSource;
}

/** Why a module could not get the tool session it asked for. */
export type ModuleToolRefusal =
  /** Nothing is installed under that id. */
  | "unknown-pack"
  /** Something is installed under that id, and it is not a pack this app runs. */
  | "not-a-tool"
  /** The pack is a tool, and it does not speak the protocol the caller asked for. */
  | "wrong-protocol";

export class ModuleToolError extends Error {
  readonly code: ModuleToolRefusal;

  constructor(code: ModuleToolRefusal, message: string) {
    super(message);
    this.name = "ModuleToolError";
    this.code = code;
  }
}

/** What a module may do with the tool packs installed on this machine. */
export interface ModuleToolsAccess {
  /** Every installed tool pack, newest version per id, sorted by id. */
  installed(): readonly ModuleToolPack[];
  /** One installed tool pack by id, or `null` when that id names no tool pack this build runs. */
  pack(id: string): ModuleToolPack | null;
  /**
   * A session on the installed pack `id`, for a caller that is going to speak
   * `protocol` to it. Refuses by code rather than answering `null`: "this pack
   * is not installed", "this pack is not a program" and "this pack speaks the
   * other protocol" are three different facts and a caller acts differently on
   * each.
   */
  session(id: string, protocol: ToolProtocol): Promise<ToolSession>;
}

/**
 * Where the packs live and what their signatures verify against, plus the two
 * things a test moves: where a session's working directory is made, and the caps
 * its processes run under.
 *
 * `userData` and `publicKeyPem` are FUNCTIONS, like `ModulePacksAccess`'s
 * `userData`, because the account's directory moves with the selected account
 * (ADR-044) and a value captured at startup would keep pointing at the previous
 * one.
 */
export interface ModuleToolsDeps {
  readonly userData: () => string;
  /** The release public key an installed pack's manifest was signed with — `ModulePacksAccess`'s own constant. */
  readonly publicKeyPem: string;
  /** Where `tools/run.ts` makes a session's working directory. `%TEMP%` in the app; injected by a test. */
  readonly tempRoot?: string;
  readonly limits?: ToolLimits;
}

/** One installed pack as this file reads it: the newest version of each id. */
function toolPacks(installed: readonly InstalledPack[]): InstalledPack[] {
  const newest = new Map<string, InstalledPack>();
  for (const pack of installed) {
    if (pack.manifest.kind !== "tool" || pack.manifest.tool === undefined) continue;
    const current = newest.get(pack.manifest.id);
    if (current === undefined || isNewerVersion(pack.manifest.version, current.manifest.version)) {
      newest.set(pack.manifest.id, pack);
    }
  }
  return [...newest.values()].sort((left, right) => compareIds(left.manifest.id, right.manifest.id));
}

/**
 * Ids in one order everywhere, so a caller that lists and a caller that looks
 * one up cannot disagree about which is first.
 *
 * `compareVersions` is asked first because it is the app's own statement of what
 * "newer" means, and a version it cannot read (which the manifest refused long
 * before install) keeps the older folder rather than shadowing it.
 */
function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) === 1;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function viewOf(pack: InstalledPack): ModuleToolPack {
  // `toolPacks` filtered on both, and the compiler cannot see through the
  // filter: the assertion is the filter's own guarantee, stated once.
  const tool = pack.manifest.tool!;
  return {
    id: pack.manifest.id,
    version: pack.manifest.version,
    title: pack.manifest.title,
    protocol: tool.protocol,
    entry: tool.entry,
    args: tool.args ?? [],
    licence: pack.manifest.licence,
    source: pack.manifest.source,
  };
}

export function createModuleTools(deps: ModuleToolsDeps): ModuleToolsAccess {
  function packs(): ModuleToolPack[] {
    return toolPacks(readInstalled(deps.userData(), deps.publicKeyPem)).map(viewOf);
  }

  function pack(id: string): ModuleToolPack | null {
    return packs().find((entry) => entry.id === id) ?? null;
  }

  return {
    installed: packs,
    pack,
    async session(id: string, protocol: ToolProtocol): Promise<ToolSession> {
      const installed = toolPacks(readInstalled(deps.userData(), deps.publicKeyPem)).find(
        (entry) => entry.manifest.id === id,
      );
      if (installed === undefined) {
        // The id may name an installed CONTENT pack, which is not a tool pack and
        // must not be reported as one: a module that asked a ZIM for a move would
        // otherwise read "not installed" and tell the user to install something
        // they already have.
        const anyKind = readInstalled(deps.userData(), deps.publicKeyPem).some(
          (entry) => entry.manifest.id === id,
        );
        throw new ModuleToolError(
          anyKind ? "not-a-tool" : "unknown-pack",
          anyKind
            ? `Pack "${id}" is installed, and it is not a tool pack this build runs.`
            : `No tool pack "${id}" is installed.`,
        );
      }
      const tool = installed.manifest.tool!;
      if (tool.protocol !== protocol) {
        throw new ModuleToolError(
          "wrong-protocol",
          `Pack "${id}" speaks "${tool.protocol}", not "${protocol}".`,
        );
      }
      return await createToolSession({
        dir: packVersionDir(deps.userData(), id, installed.manifest.version),
        manifest: installed.manifest,
        ...(deps.tempRoot === undefined ? {} : { tempRoot: deps.tempRoot }),
        ...(deps.limits === undefined ? {} : { limits: deps.limits }),
      });
    },
  };
}
