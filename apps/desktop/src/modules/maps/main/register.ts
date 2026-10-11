import type Database from "better-sqlite3-multiple-ciphers";
import {
  MAX_MAPS_PINS,
  MAX_PIN_NOTE_LENGTH,
  MAX_PIN_TITLE_LENGTH,
  MapsStore,
} from "@nexus/db";
import type { ModuleHostSurface } from "../../../main/moduleIpc.js";
import { MAPS_PIN_COLORS, contract, type MapsPinColor, type MapsView } from "../shared/ipc.js";
import { buildMapsExport, parseMapsExport } from "./imex.js";

/**
 * MAPS in the main process (ADR-090): its handlers, the position it remembers,
 * and its archive section.
 *
 * **What this file does NOT do, and that is the design.** It reads no pack. The
 * tiles, the style and the place index are not this profile's data and are not
 * behind the IPC wall: the renderer reads them through the `nx-pack://` scheme,
 * which is a range request answered inside this process by the pack's own
 * protocol handler, with no path crossing the bridge (ADR-091 §6). A module
 * handler that took a pack path would be a renderer-named file read, and a
 * module handler cannot reach `userData` at all — `main/index.ts` hands a module
 * "a handler per channel it declared, and nothing else".
 *
 * **Where the machine is lives in memory.** A GPS fix is a fact about NOW: it
 * belongs to the session, not to the profile, so it is a `Map` keyed by profile
 * id which `onSessionEnd` empties. Writing it to a table would put a marker on
 * yesterday's map and would put a device fact into every export of the profile.
 *
 * **Why `clearLocation` exists beside `setLocation`.** The pair is the whole
 * interface the Devices run needs: one to say where the receiver is, one to say
 * it has been unplugged. Without the second, a page whose GPS went away would
 * keep drawing a marker for a machine that is no longer there.
 */

/** The position of each open profile, for this session only. */
type Location = { lat: number; lon: number };

/**
 * Something that can open this module's store for a profile: the shape a
 * handler's `ModuleCall` and a session both have, so the code below is one
 * implementation rather than two that drift.
 */
interface StoreBearer {
  profileDb<T>(profileId: string, open: (db: Database.Database, profileId: string) => T): T;
}

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);
  const locations = new Map<string, Location>();

  function mapsStore(bearer: StoreBearer, profileId: string): MapsStore {
    return bearer.profileDb(profileId, (db, id) => new MapsStore(db, id));
  }

  /**
   * The rows as the wire declares them. One mapping, so the store's shape and
   * the wire's cannot drift apart field by field: a column renamed in a
   * migration is a compile error here rather than `undefined` in the renderer.
   */
  function viewOf(bearer: StoreBearer, profileId: string): MapsView {
    return {
      pins: mapsStore(bearer, profileId).listPins().map((pin) => ({
        id: pin.id,
        title: pin.title,
        note: pin.note,
        lat: pin.lat,
        lon: pin.lon,
        color: pin.color,
      })),
      location: locations.get(profileId) ?? null,
    };
  }

  // --- Handlers -------------------------------------------------------------

  ctx.handle("list", (payload, call) => viewOf(call, call.as.asId(payload.profileId, "profileId")));

  ctx.handle("createPin", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    mapsStore(call, profileId).createPin(
      {
        title: title(call, payload.title),
        note: note(call, payload.note),
        lat: call.as.asBoundedNumber(payload.lat, "lat", -90, 90),
        lon: call.as.asBoundedNumber(payload.lon, "lon", -180, 180),
        color: pinColor(call, payload.color),
      },
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("updatePin", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    mapsStore(call, profileId).updatePin(
      call.as.asId(payload.id, "id"),
      {
        title: title(call, payload.title),
        note: note(call, payload.note),
        color: pinColor(call, payload.color),
      },
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("removePin", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    mapsStore(call, profileId).removePin(call.as.asId(payload.id, "id"));
    return viewOf(call, profileId);
  });

  ctx.handle("setLocation", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    locations.set(profileId, {
      lat: call.as.asBoundedNumber(payload.lat, "lat", -90, 90),
      lon: call.as.asBoundedNumber(payload.lon, "lon", -180, 180),
    });
    return viewOf(call, profileId);
  });

  ctx.handle("clearLocation", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    locations.delete(profileId);
    return viewOf(call, profileId);
  });

  // --- The session ----------------------------------------------------------

  ctx.onSessionEnd(() => {
    // A locked session has no position: the marker belongs to the machine that
    // is here now, and a fix that survived the lock would be drawn for whoever
    // unlocks next.
    locations.clear();
  });

  // --- The archive (ADR-090 §imex) -----------------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    return buildMapsExport(mapsStore(session, profileId).listPins());
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the whole payload - the version first - and throws on
    // anything it will not take, so a refused archive never reaches a write.
    parse: parseMapsExport,
    // The writing half. `undefined` is an archive that says nothing about Maps,
    // which for a restore that replaces a profile whole means empty: no pins.
    // The position is untouched either way - it is not archived.
    apply: (payload, session) => {
      for (const profileId of session.profileIds) {
        mapsStore(session, profileId).replaceFromArchive(
          payload?.pins ?? [],
          instant(session.now()),
        );
      }
    },
  });
}

/**
 * The one profile a session is about, or `null` when it names none or several.
 *
 * An archive is written ONE profile at a time (`main/imex.ts`'s `handleExport`
 * gathers one profile's `ProfileData`), so "several" is not a shape the exporter
 * meets. Answering `null` rather than guessing keeps that true: if a session
 * ever did name several, this module has no single profile its pins belong to.
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** A title off the wire, capped at the store's own limit so a title that could never be stored is refused before the store sees it. */
function title(
  call: {
    readonly as: {
      asNonEmptyString(value: unknown, field: string): string;
      asCappedChars(value: unknown, field: string, max: number): string;
    };
  },
  value: unknown,
): string {
  return call.as.asCappedChars(
    call.as.asNonEmptyString(value, "title"),
    "title",
    MAX_PIN_TITLE_LENGTH,
  );
}

/** A note off the wire: empty is allowed, and the store's cap is the one that decides where it becomes `null`. */
function note(
  call: {
    readonly as: {
      asString(value: unknown, field: string): string;
      asCappedChars(value: unknown, field: string, max: number): string;
    };
  },
  value: unknown,
): string {
  return call.as.asCappedChars(call.as.asString(value, "note"), "note", MAX_PIN_NOTE_LENGTH);
}

/**
 * A pin colour off the wire, checked against the WIRE's own list.
 *
 * The store checks its list too, and the two are deliberate: this one is what
 * the renderer can name, and the store's is what a row may hold. A colour the
 * store knows and the wire does not is a colour no screen can ask for, which
 * `imex.ts`'s own mapping turns into a compile error rather than a silent gap.
 */
function pinColor(
  call: { readonly as: { asString(value: unknown, field: string): string } },
  value: unknown,
): MapsPinColor {
  const color = call.as.asString(value, "color");
  if (!(MAPS_PIN_COLORS as readonly string[]).includes(color)) {
    throw new Error(`Invalid IPC payload: "color" is not a pin colour this build knows.`);
  }
  return color as MapsPinColor;
}

/** How many pins one profile may hold, re-exported so the module's test asserts the store's own number. */
export { MAX_MAPS_PINS };
