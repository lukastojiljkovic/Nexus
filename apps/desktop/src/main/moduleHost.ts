/**
 * Discovery glue for the module kit's main half: find the modules, adopt them.
 *
 * **What is discovered, and what is not.** A module's handlers live in
 * `modules/<id>/main/register.ts`, and this glob is the only place that path is
 * spelled. Registration is EAGER because `ipcMain.handle` must be called before
 * the renderer can ask for anything, and because a module that fails to register
 * should fail at startup where somebody sees it rather than on the first click.
 *
 * **Why this file has no `electron` import.** It is the second half of
 * `moduleIpc.ts`'s split: the rules and the bookkeeping are electron-free so
 * they can be tested, and the Electron-shaped facts arrive as `ModulePlatform`
 * from `index.ts`, which is the only file that owns the window, the database and
 * the notification path.
 */
import { ModuleHost, type ModulePlatform, type ModuleRegisterModule } from "./moduleIpc.js";

/**
 * Every discovered module's registration, keyed by the file it came from. The
 * keys are only used to name a module in a failure message: a register function
 * that throws halfway through is a startup failure, and "which module" is the
 * first thing anybody reading it needs.
 */
const DISCOVERED_MODULES: Record<string, ModuleRegisterModule> = import.meta.glob(
  "../modules/*/main/register.ts",
  { eager: true },
) as Record<string, ModuleRegisterModule>;

/**
 * Builds the process's one host and adopts every discovered module into it.
 *
 * The wrap around `register` is deliberate rather than decorative: a module that
 * registers a channel another module already answers, or claims a channel
 * outside its own prefix, must fail HERE, with its own name in the message,
 * instead of leaving main with a channel nobody can explain.
 */
export function createModuleHost(platform: ModulePlatform): ModuleHost {
  const host = new ModuleHost(platform);
  for (const [path, module] of Object.entries(DISCOVERED_MODULES)) {
    try {
      module.register(host);
    } catch (error) {
      throw new Error(
        `Module registration failed for ${path}: ${error instanceof Error ? error.message : String(error)}`,
        // The original error rides along as the CAUSE rather than only as a
        // string: a module that fails to register has a stack that names the
        // line inside the module, and a message that flattened it would leave
        // this file's own frame as the only thing anybody could read.
        { cause: error },
      );
    }
  }
  return host;
}
