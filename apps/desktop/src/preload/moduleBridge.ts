/**
 * The preload half of the module kit: one namespace per discovered module, whose
 * methods are built from that module's OWN declared channels and nothing else.
 *
 * **Why this is not a generic `invoke`.** A bridge that took a channel as an
 * argument would hand the renderer the whole main-process surface through one
 * hole, which is what SEC-EL-02 exists to prevent. Here the renderer never names
 * a channel: it calls `nexus.modules.timers.startCountdown(payload)`, and the
 * channel that call lands on was fixed at build time by the module's own
 * `defineModuleContract`. The set of callable channels is therefore exactly the
 * set the discovered modules declared, and it is frozen.
 *
 * **Why the renderer-facing methods take a payload and nothing else.** One rule
 * for every module, so this file needs no per-module code - which is the point
 * of the kit. A method is `(payload) => invoke(its own channel, payload)`; the
 * payload's SHAPE is the module's business and is typed in its `shared/ipc.ts`
 * (`ModuleApiOf`), where main validates it field by field.
 *
 * **Why `bridge` is a parameter.** So this module stays electron-free and can be
 * tested: the test hands it a fake that records the channels it was asked for,
 * which is how "the preload exposes exactly the declared ops" is proven rather
 * than asserted in prose. `preload/index.ts` passes the real `ipcRenderer` and
 * adds no logic of its own.
 */
import type { ModuleContract, ModuleOps, NexusModules } from "../shared/moduleApi.js";

/** The one thing this module needs from Electron's `ipcRenderer`. */
export interface ModuleInvoker {
  invoke(channel: string, payload: unknown): Promise<unknown>;
}

/**
 * Every discovered module's contract, keyed by the file it came from.
 *
 * The pattern is the folder contract (`modules/<id>/shared/ipc.ts`), stated
 * once; each module exports its contract under the one agreed name, `contract`.
 * Eager, because the bridge has to exist before the renderer can call anything.
 */
const DISCOVERED_CONTRACTS: Record<string, { contract: ModuleContract<string, ModuleOps> }> =
  import.meta.glob("../modules/*/shared/ipc.ts", { eager: true }) as Record<
    string,
    { contract: ModuleContract<string, ModuleOps> }
  >;

/**
 * Builds `nexus.modules` from the discovered contracts.
 *
 * Throws rather than skipping a malformed entry: a module whose `ipc.ts` exports
 * no contract is a module whose page cannot talk to main at all, and a bridge
 * that quietly omitted its namespace would turn that into a `TypeError` on the
 * first click instead of a startup failure that names the file.
 */
export function buildModuleBridge(bridge: ModuleInvoker): NexusModules {
  const surface: Record<string, Record<string, (payload: unknown) => Promise<unknown>>> = {};
  for (const [path, module] of Object.entries(DISCOVERED_CONTRACTS)) {
    const contract = module.contract;
    if (contract === undefined) {
      throw new Error(`${path} exports no \`contract\`; a module's shared/ipc.ts must declare one.`);
    }
    const api: Record<string, (payload: unknown) => Promise<unknown>> = {};
    // `contract.ops` IS the allowlist: a channel exists here only because the
    // module declared the op it names, and the op name is the method name.
    for (const op of contract.ops) {
      const channel = contract.channels[op];
      if (channel === undefined) {
        throw new Error(`${path} declares op "${op}" with no channel behind it.`);
      }
      api[op] = (payload) => bridge.invoke(channel, payload);
    }
    surface[contract.id] = Object.freeze(api);
  }
  // The cast goes through `unknown` deliberately: `NexusModules` is an interface
  // MERGED by every discovered module's `shared/ipc.ts` (`moduleApi.ts` says so at
  // length), so it declares members — `timers` among them — that no `Record`
  // computed at runtime can be proved to have. The bridge is exactly what makes
  // the merged type true: it builds one namespace per discovered contract. A
  // direct `as` was a compile error the day the first module arrived, which is
  // the honest shape of "this is constructed, not inferred".
  return Object.freeze(surface) as unknown as NexusModules;
}
