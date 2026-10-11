import type { BodyId } from "@nexus/core";

import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * ASTRONOMY's contract: one op, and it is a READ of the installed content pack.
 *
 * **Why the module needs main at all.** Three of its four views are pure
 * computation over `@nexus/core` and the fourth reads the planet-textures pack,
 * which lives outside the profile database (ADR-091) and is reached only through
 * `ctx.packs()` (a path never crosses the bridge). The place — the module's one
 * preference — is a DEVICE value in `localStorage` (`renderer/prefs.ts`), so it
 * needs no channel; nothing here writes anything.
 *
 * **Why the answer is the pack's URL layout and nothing else.** The renderer
 * cannot name a pack file itself (it does not know which pack is installed, and
 * a file the signed manifest does not list must not be reachable), so main
 * resolves each image the pack declares into an `nx-pack://` address and hands
 * back the layout the view already reads. No bytes, no path, in either
 * direction.
 */

/** One body's images as the pack declares them, with the URLs main resolved. */
export interface PlanetTextureSetView {
  readonly day: string;
  readonly night?: string;
  readonly rings?: string;
  /** The attribution line the pack asks to be shown with these images. */
  readonly credit: string;
}

/** The pack's `textures.json`, with every image path turned into an `nx-pack://` address. */
export interface PlanetTexturesView {
  readonly layout: 1;
  readonly bodies: Readonly<Partial<Record<BodyId, PlanetTextureSetView>>>;
}

/** Everything one read of the packs answers with. */
export interface AstronomyPacksView {
  /** The pack id the module reads — named in the page's copy when it is absent. */
  readonly packId: string;
  /** The installed pack's layout, or `null` when it is not installed or unreadable. */
  readonly textures: PlanetTexturesView | null;
}

/** The module's one op: reading, never writing. */
type AstronomyOps = {
  packs: { request: Record<string, never>; response: AstronomyPacksView };
};

/** This module's renderer API: one method per op, named after the op. */
export type AstronomyApi = ModuleApiOf<AstronomyOps>;

/**
 * The contract the preload builds the bridge from and main refuses foreign ops
 * against. Exported as `contract` because that is the one name the kit's globs
 * agree on.
 */
export const contract = defineModuleContract<"astronomy", AstronomyOps>("astronomy", ["packs"]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here, so
 * `window.nexus.modules.astronomy.packs({})` is typed in the module's own page
 * without a line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    astronomy: AstronomyApi;
  }
}
