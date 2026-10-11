import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * MAPS' contract: the channels it answers on, the payload each takes, and the
 * API its page calls — declared once, in its own folder (ADR-090).
 *
 * **What is NOT a channel, and why that is the important half.** The map pack's
 * tiles, style and place index are read by the RENDERER, through the
 * `nx-pack://<packId>/<path>` scheme — a range request the pack's own protocol
 * handler answers, with no main-process handler in between and no path crossing
 * the bridge (ADR-091 §6). A channel that took a pack path from the renderer
 * would be a renderer-named file read, which is the primitive that ADR-091
 * spends a paragraph refusing. So this contract carries only what is THIS
 * PROFILE's data: the pins, and where the machine currently is.
 *
 * **Why every mutation answers with the whole view.** The rows here are a few
 * pins, and one read of all of them is smaller than the bookkeeping a per-op
 * delta would need. One result type means the page has exactly one way to
 * update — what main just said — which is the kit's rule for every module.
 */

/**
 * The eight colours a pin may wear, as the WIRE names them: the accent swatch
 * ids `packages/tokens` publishes as `--nx-swatch-*`.
 *
 * Declared here rather than imported from `@nexus/db`, which is where the
 * stored list lives: no file under `shared/` may reach that package (it is
 * SQLite and therefore Node-only, and the renderer shares this file). The two
 * lists are kept in step by `main/register.ts`, the one thing that maps one
 * onto the other — a colour the store learns and the wire does not is a compile
 * error at that mapping, not a pin that fails to draw.
 */
export const MAPS_PIN_COLORS = [
  "zlato",
  "bronza",
  "maslina",
  "suma",
  "zad",
  "ruza",
  "bordo",
  "grafit",
] as const;

export type MapsPinColor = (typeof MAPS_PIN_COLORS)[number];

/** One pin as it crosses the wire. */
export interface MapsPinView {
  readonly id: string;
  readonly title: string;
  /** The note, or `null` — an empty note is stored as nothing rather than as an empty string. */
  readonly note: string | null;
  readonly lat: number;
  readonly lon: number;
  readonly color: MapsPinColor;
}

/**
 * Where the machine is, when something has told main.
 *
 * This is the seam the Devices run fills: a USB GPS receiver speaks NMEA on a
 * serial port, main is the process that owns that port, and this module only
 * needs the two numbers and a "my location" marker. Until that run exists the
 * input is reachable from the page itself, which is why it is a declared op
 * rather than a promise — and it lives in main's MEMORY, not in a table: a fix
 * is a fact about now, and a stale position persisted into a profile would be a
 * marker on yesterday's map.
 */
export interface MapsLocationView {
  readonly lat: number;
  readonly lon: number;
}

/** Everything one read of this module answers with, and what every mutation answers with too. */
export interface MapsView {
  /** By title, the way a person reads them (`Intl.Collator(["sr-Latn", "sr"])`, in the store). */
  readonly pins: readonly MapsPinView[];
  readonly location: MapsLocationView | null;
}

/** One read: whose view is being asked for. */
interface ListPayload {
  profileId: string;
}

/** Dropping a pin: what it says, where it is, and how it looks. */
interface CreatePinPayload {
  profileId: string;
  title: string;
  note: string;
  lat: number;
  lon: number;
  color: MapsPinColor;
}

/** Editing what a pin says. Its position is what the user clicked, and never a field. */
interface UpdatePinPayload {
  profileId: string;
  id: string;
  title: string;
  note: string;
  color: MapsPinColor;
}

/** One row of this module's table, by its own id. The store scopes it to the profile. */
interface RowPayload {
  profileId: string;
  id: string;
}

/** A position, as the Devices run (or the page, today) hands it over. */
interface LocationPayload {
  profileId: string;
  lat: number;
  lon: number;
}

/**
 * The declared ops, as a payload→result map. `ModuleApiOf` turns this into the
 * `nexus.modules.maps.*` methods the page calls, and `defineModuleContract`
 * turns the keys into the channels main answers on.
 */
type MapsOps = {
  list: { request: ListPayload; response: MapsView };
  createPin: { request: CreatePinPayload; response: MapsView };
  updatePin: { request: UpdatePinPayload; response: MapsView };
  removePin: { request: RowPayload; response: MapsView };
  setLocation: { request: LocationPayload; response: MapsView };
  clearLocation: { request: ListPayload; response: MapsView };
};

/** This module's renderer API: one method per op, named after the op. */
export type MapsApi = ModuleApiOf<MapsOps>;

/**
 * The contract the preload builds the bridge from and main refuses foreign ops
 * against. Exported as `contract` because that is the ONE name the kit's globs
 * agree on: `preload/moduleBridge.ts` reads `module.contract` from every
 * `modules/*&#47;shared/ipc.ts` and throws, at startup, for a file that exports
 * none.
 */
export const contract = defineModuleContract<"maps", MapsOps>("maps", [
  "list",
  "createPin",
  "updatePin",
  "removePin",
  "setLocation",
  "clearLocation",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here,
 * which is what makes `window.nexus.modules.maps.list(...)` typed in this
 * module's own page without a line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    maps: MapsApi;
  }
}
