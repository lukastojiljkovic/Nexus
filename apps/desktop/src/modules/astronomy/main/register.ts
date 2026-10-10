import type { ModuleCall, ModuleHostSurface } from "../../../main/moduleIpc.js";
import { contract, type AstronomyPacksView } from "../shared/ipc.js";
import { loadPlanetTextures } from "./packData.js";

/**
 * ASTRONOMY in the main process (ADR-090): one handler, and it is a read.
 *
 * The module computes everything else in the renderer over `@nexus/core` — the
 * positions, the day and night, the sky — and keeps its one preference (the
 * place) in `localStorage`, so there is no store, no migration and no clock to
 * own here. What main does own is the installed content pack: a pack lives
 * outside the profile database and only main may look at the packs directory,
 * so `packs` resolves the module's own `textures.json` into `nx-pack://`
 * addresses and hands the renderer the layout (see `packData.ts`).
 *
 * The op takes no profile id and writes nothing, `culture`'s `listArt` on the
 * same terms: an installed pack is a fact about this machine, not about a
 * profile.
 */

/** What a handler's call must offer: the installed packs, as `main/packs/registry.ts` needs them. */
interface PacksBearer {
  packs(): { userData(): string; publicKeyPem: string };
}

async function packsView(call: PacksBearer): Promise<AstronomyPacksView> {
  const access = call.packs();
  return await loadPlanetTextures(access.userData(), access.publicKeyPem);
}

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  ctx.handle("packs", (_payload, call: ModuleCall) => packsView(call));
}
