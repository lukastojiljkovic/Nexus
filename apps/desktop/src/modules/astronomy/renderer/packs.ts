import type { AsyncState } from "@nexus/ui";
import type { AstronomyPacksView } from "../shared/ipc.js";

/**
 * The installed pack's layout, as a read that can fail.
 *
 * A failure is logged and answered as `failed` rather than thrown: the corner
 * still works without the pack, so the page keeps drawing, and it offers a Retry
 * for the failed read instead of asking again on every tab change. The failure
 * has to stay visible in the state, because a page that treats it as "not yet
 * read" draws the same nothing for a read that broke as for one still in flight.
 */
export async function readTexturePacks(
  read: () => Promise<AstronomyPacksView>,
): Promise<AsyncState<AstronomyPacksView>> {
  try {
    return { status: "ready", data: await read() };
  } catch (failure) {
    console.error("Nexus: the planet textures pack could not be read:", failure);
    return { status: "failed" };
  }
}
