import type { ModuleText } from "../modules/copy.js";

/**
 * A label a manifest declares, in either of the two forms the app reads.
 *
 * - a **dotted path** into the renderer's `strings` table - `"dashboard.today.title"`
 *   - which is what every compiled-in module declares, and how one Serbian file
 *   stays the whole copy of the shell;
 * - a **`{ sr, en }` pair**, carried by the module that declares it, which is
 *   how a module discovered from its own folder names something the shell draws
 *   before that module's page chunk loads (see `ModuleCopyDeclaration`).
 *
 * One union rather than two contracts, because both answer the same question -
 * "what is this thing called" - and a declaration that could answer it only one
 * way would be a second contract for the second kind of module. The renderer
 * resolves both through `resolveLabel` (`renderer/src/moduleKit/labels.ts`),
 * which is the only reader.
 */
export type LabelText = string | ModuleText;
