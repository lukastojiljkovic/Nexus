import { join } from "node:path";
import type { BodyId } from "@nexus/core";
import { readFileBounded } from "../../../main/boundedRead.js";
import { packPathProblem } from "../../../main/packs/paths.js";
import { packVersionDir, readInstalled } from "../../../main/packs/registry.js";
import type {
  AstronomyPacksView,
  PlanetTextureSetView,
  PlanetTexturesView,
} from "../shared/ipc.js";

/**
 * The planet-textures pack, read in main and handed to the renderer as URLs.
 *
 * **Why main reads it.** A pack lives outside the profile database (ADR-091) and
 * a module reaches it through `ctx.packs()`; the renderer must never learn a
 * path. So this is the reader: it walks the same installed index the Packs card
 * draws, opens the one file the module understands (`textures.json`), and gives
 * every image the `nx-pack://` address the shell's protocol already serves — a
 * path the pack's SIGNED manifest lists, and nothing else.
 *
 * **One file name, one layout, both checked.** `textures.json` under any folder,
 * layout 1 (the builder's own number). A document claiming another layout is
 * refused rather than read on, exactly as a pack manifest with an unknown
 * `format` is. A pack that is missing, unreadable, of the wrong kind or does not
 * carry the file contributes NOTHING and is not an error — a `dataset` pack may
 * hold data for anything, and "this pack carries nothing this module reads" is
 * the honest answer, which is why the result is `null` rather than a throw.
 *
 * **The body ids are listed here as well as in the view.** A Node reader cannot
 * import the module's renderer (`bodies.ts` pulls in the locale machinery), and
 * the pack builder holds the same list for the same reason. What the list buys
 * is a shape check: a layout naming a body this build does not know is dropped
 * rather than passed through under a type that says it cannot happen.
 */

/** The one pack id this module reads. Named in the page's copy when it is absent. */
export const PLANET_TEXTURES_PACK_ID = "planet-textures";

/** The only `textures.json` layout this build reads. */
export const PLANET_TEXTURES_LAYOUT = 1;

/** The file a pack's images are described in, looked for at any depth. */
export const TEXTURES_FILE_NAME = "textures.json";

/** Before it is read: the layout is a few hundred bytes, so this is generous rather than tight. */
export const MAX_TEXTURES_BYTES = 256 * 1024;

/** The eleven bodies of `@nexus/core`'s contract, in its own order. */
const BODY_IDS: readonly BodyId[] = [
  "sun",
  "mercury",
  "venus",
  "earth",
  "moon",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
];

/** The pack's address for one image: the scheme, the id, and the path the manifest lists. */
export function packUrl(packId: string, path: string): string {
  return `nx-pack://${packId}/${path}`;
}

/**
 * The declared file in a pack that the module is looking for, or `null`.
 *
 * The comparison is on the LAST path segment, so a pack may keep its layout at
 * the root or under `data/`; the shallowest match wins so a pack that carries
 * both reads the one it wrote for this app. Only a path the SIGNED manifest
 * lists is ever answered, and it is re-checked through `packPathProblem` even
 * then — a manifest is signed, but the join is still a join.
 */
export function texturesFile(
  manifest: { readonly files: readonly { readonly path: string }[] },
): string | null {
  const matches = manifest.files
    .map((file) => file.path)
    .filter((path) => path.split("/").at(-1) === TEXTURES_FILE_NAME)
    .filter((path) => packPathProblem(path) === null);
  matches.sort((left, right) => left.split("/").length - right.split("/").length);
  return matches[0] ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A non-empty string, trimmed — the shape every path and credit line has. */
function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

/**
 * One body's entry, with every path resolved to a pack URL.
 *
 * `day` and `credit` are required — an entry without them is not a body this
 * view can draw — while `night` and `rings` are optional, because a pack that
 * carries one body's daytime map and no ring strip is a normal pack rather than
 * a broken one. A path the pack did not declare safely is dropped along with its
 * image: the protocol would refuse to serve it anyway.
 */
function textureSet(value: unknown, packId: string): PlanetTextureSetView | null {
  const record = asRecord(value);
  if (record === null) return null;
  const day = asText(record["day"]);
  const credit = asText(record["credit"]);
  if (day === null || credit === null || packPathProblem(day) !== null) return null;
  const set: {
    day: string;
    credit: string;
    night?: string;
    rings?: string;
  } = { day: packUrl(packId, day), credit };
  const night = asText(record["night"]);
  if (night !== null && packPathProblem(night) === null) set.night = packUrl(packId, night);
  const rings = asText(record["rings"]);
  if (rings !== null && packPathProblem(rings) === null) set.rings = packUrl(packId, rings);
  return set;
}

/**
 * A `textures.json` document, read whole; `null` for anything this build will
 * not draw.
 *
 * Unknown bodies are dropped and a body whose entry is unreadable costs only
 * itself: the view falls back to a neutral tone for a body with no map
 * (`textures.ts`), which is exactly what a partial pack is. That is why this
 * does not throw — the alternative is a pack that half-worked becoming a screen
 * that shows nothing.
 */
export function parseTexturesLayout(value: unknown, packId: string): PlanetTexturesView | null {
  const record = asRecord(value);
  if (record === null || record["layout"] !== PLANET_TEXTURES_LAYOUT) return null;
  const rawBodies = asRecord(record["bodies"]);
  if (rawBodies === null) return null;
  const bodies: Partial<Record<BodyId, PlanetTextureSetView>> = {};
  for (const id of BODY_IDS) {
    const set = textureSet(rawBodies[id], packId);
    if (set !== null) bodies[id] = set;
  }
  return { layout: 1, bodies };
}

/**
 * The installed `planet-textures` pack's layout, or `null`.
 *
 * `kind: "dataset"` is the first gate, on the cookbook's own terms: a `zim` or a
 * `map` pack is content this module has no business opening, and asking the
 * index — rather than walking the packs directory — is what makes "installed"
 * mean what the Packs card means by it.
 */
export async function readPlanetTextures(
  userData: string,
  publicKeyPem: string,
  packId: string = PLANET_TEXTURES_PACK_ID,
): Promise<PlanetTexturesView | null> {
  const installed = readInstalled(userData, publicKeyPem).find(
    (pack) => pack.manifest.id === packId && pack.manifest.kind === "dataset",
  );
  if (installed === undefined) return null;
  const path = texturesFile(installed.manifest);
  if (path === null) return null;
  const dir = packVersionDir(userData, installed.manifest.id, installed.manifest.version);
  const read = await readFileBounded(join(dir, ...path.split("/")), MAX_TEXTURES_BYTES);
  if (read.status !== "ok") return null;
  try {
    return parseTexturesLayout(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.bytes)) as unknown,
      packId,
    );
  } catch {
    return null;
  }
}

/** What the module's one op answers: the pack id always, the layout when it is readable. */
export async function loadPlanetTextures(
  userData: string,
  publicKeyPem: string,
): Promise<AstronomyPacksView> {
  return {
    packId: PLANET_TEXTURES_PACK_ID,
    textures: await readPlanetTextures(userData, publicKeyPem),
  };
}
