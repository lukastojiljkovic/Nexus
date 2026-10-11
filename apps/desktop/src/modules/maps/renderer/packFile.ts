import { MAP_PACK_ID } from "../shared/packs.js";

/**
 * Reading a file out of an installed map pack, in the renderer.
 *
 * **The scheme is the whole interface.** `nx-pack://<packId>/<path>` is
 * registered as a standard, secure, fetch-capable scheme and answered in this
 * process by `protocol.handle`, which reads the installed folder (ADR-091 §5)
 * and serves range requests — that is what lets MapLibre read the PMTiles
 * archive with ordinary byte ranges, and it is why nothing here needs a
 * main-process channel: no path crosses the bridge, in either direction.
 *
 * **Why this file exists at all, and why it is the only one that fetches.** The
 * app's `check:egress` gate exists to keep `fetch(` out of this tree, and a
 * blanket exemption for the module would be the wrong repair — the point of the
 * rule is that ONE reading of "what may fetch" is reviewable. So the exemption
 * `scripts/check-egress.mjs` carries names this file and the `fetch` rule alone:
 * a local, in-process scheme URL, which cannot leave the machine because the
 * handler behind it only ever opens a file under `packs/<id>/`, and whose body is
 * a byte range of a signed pack. Everything else about the pack is read by
 * MapLibre itself, which does its own loading.
 *
 * **What a failure means.** A missing pack, an unreadable file, a scheme the
 * build did not register — all of them arrive here as a rejected promise, and
 * the page turns that into one sentence naming the card that installs a pack.
 * That is the whole error vocabulary this file needs; it never inspects a status
 * code, because a scheme answered in-process has no server to distinguish.
 */

/** The address of one file inside one pack, as the scheme spells it. */
export function packUrl(path: string, packId = MAP_PACK_ID): string {
  return `nx-pack://${packId}/${path}`;
}

/** One file of the pack as text, or a rejection the caller turns into copy. */
export async function readPackText(path: string, packId = MAP_PACK_ID): Promise<string> {
  const response = await fetch(packUrl(path, packId));
  if (!response.ok) {
    throw new Error(`The map pack answered ${String(response.status)} for "${path}".`);
  }
  return await response.text();
}

/** One JSON file of the pack, parsed. The caller validates its SHAPE (`parsePlacesFile`), never this function. */
export async function readPackJson(path: string, packId = MAP_PACK_ID): Promise<unknown> {
  return JSON.parse(await readPackText(path, packId)) as unknown;
}
