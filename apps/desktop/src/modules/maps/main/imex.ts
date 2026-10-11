import {
  MAX_MAPS_PINS,
  MAX_PIN_NOTE_LENGTH,
  MAX_PIN_TITLE_LENGTH,
  PIN_COLORS,
  type PinColor,
} from "@nexus/db";
import { MAPS_PIN_COLORS, type MapsPinColor } from "../shared/ipc.js";

/**
 * MAPS' archive payload (ADR-090 §imex): what one module puts in
 * `data/modules.ndjson`, and the only reader of it.
 *
 * **Why this lives in `main/` rather than in `shared/`.** The bounds it enforces
 * are the STORE's — `MAX_PIN_TITLE_LENGTH`, `MAX_PIN_NOTE_LENGTH` and
 * `MAX_MAPS_PINS` come from `@nexus/db`, which no file under `shared/` may
 * import (it is SQLite and therefore Node-only, and the renderer shares that
 * folder). A second copy of 120 and 2 000 up there would be two numbers that
 * agree until one moves.
 *
 * **Why the payload carries no location.** Where the machine is right now is a
 * fact about THIS instant and THIS machine, and an archive is a document about
 * a profile's content. A restored GPS fix would put a "you are here" marker
 * wherever somebody else's laptop was standing, which is worse than no marker at
 * all — so the archive carries the pins a person dropped and nothing live.
 *
 * **Why `version` is checked rather than assumed.** `ProfileData.modules` holds
 * `payload: unknown`, and core says out loud that the shape belongs to the
 * module. The field is what makes that safe: a payload written by a later build
 * of THIS module is refused by name instead of being half-read.
 */

/** The schema of the payload `exportData` writes. A new shape is a new number, never a quiet reinterpretation. */
export const MAPS_EXPORT_VERSION = 1;

/** One pin, as the archive carries it: what the user authored, and nothing about the row that held it. */
export interface MapsPinExport {
  title: string;
  note: string;
  lat: number;
  lon: number;
  color: MapsPinColor;
}

/** The whole payload. `version` first, so a reader sees the number before the data. */
export interface MapsExport {
  version: number;
  pins: MapsPinExport[];
}

/** What `exportData` is handed: the module's own rows, already read from the store. */
export function buildMapsExport(
  pins: readonly { title: string; note: string | null; lat: number; lon: number; color: PinColor }[],
): MapsExport {
  return {
    version: MAPS_EXPORT_VERSION,
    // `null` becomes the empty string on purpose: the payload's note is a
    // string, the store's is nullable, and one spelling of "no note" in the
    // file beats two that a reader would have to normalise.
    pins: pins.map((pin) => ({
      title: pin.title,
      note: pin.note ?? "",
      lat: pin.lat,
      lon: pin.lon,
      // No cast: the store's colour union must BE the wire's, and this line is
      // where a ninth swatch added to one and not the other stops compiling.
      color: pin.color,
    })),
  };
}

/**
 * Reads one payload off an archive, completely, before anything is written.
 *
 * **Throwing is the contract.** This is a `ModuleImport.parse`: the host runs it
 * when the section is read (at the preview, so the user hears the refusal before
 * confirming a restore) and again before any module writes, and it must write
 * nothing itself. So it has no early return and no partial result: it either
 * answers with a fully validated payload or it throws, and every message names
 * the field that is wrong.
 */
export function parseMapsExport(value: unknown): MapsExport {
  const record = asRecord(value, "payload");
  if (record.version !== MAPS_EXPORT_VERSION) {
    throw new Error(
      `Maps data was written by another version of this module (found ${String(record.version)}, expected ${MAPS_EXPORT_VERSION}).`,
    );
  }
  const rawPins = record.pins;
  if (!Array.isArray(rawPins)) throw new Error('Maps data: "pins" must be an array.');
  if (rawPins.length > MAX_MAPS_PINS) {
    throw new Error(`Maps data: at most ${MAX_MAPS_PINS} pins may be restored.`);
  }
  const pins = rawPins.map((entry, index) => readPin(entry, index));
  return { version: MAPS_EXPORT_VERSION, pins };
}

function readPin(entry: unknown, index: number): MapsPinExport {
  const at = `pins[${String(index)}]`;
  const record = asRecord(entry, at);
  return {
    title: asTitle(record.title, at),
    note: asNote(record.note, at),
    lat: asCoordinate(record.lat, `${at}.lat`, 90),
    lon: asCoordinate(record.lon, `${at}.lon`, 180),
    color: asColor(record.color, at),
  };
}

/** The archive's own structural rule: an object, never an array or a primitive. */
function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Maps data: "${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** A pin's title: the store's own bound, applied before the store ever sees it. */
function asTitle(value: unknown, at: string): string {
  if (typeof value !== "string") throw new Error(`Maps data: "${at}.title" must be a string.`);
  const title = value.trim();
  if (title.length === 0 || title.length > MAX_PIN_TITLE_LENGTH) {
    throw new Error(`Maps data: a pin title must be 1..${MAX_PIN_TITLE_LENGTH} characters.`);
  }
  return title;
}

/** A pin's note: possibly empty, and never longer than the store's column allows. */
function asNote(value: unknown, at: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new Error(`Maps data: "${at}.note" must be a string.`);
  if (value.length > MAX_PIN_NOTE_LENGTH) {
    throw new Error(`Maps data: a pin note may be at most ${MAX_PIN_NOTE_LENGTH} characters.`);
  }
  return value;
}

function asCoordinate(value: unknown, field: string, limit: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Maps data: "${field}" must be a finite number.`);
  }
  if (value < -limit || value > limit) {
    throw new Error(`Maps data: "${field}" must be between -${String(limit)} and ${String(limit)}.`);
  }
  return value;
}

/**
 * A pin colour: the STORE's own list, and the wire's list asserted against it
 * here rather than trusted. The two are one list with two spellings — the store
 * needs a `Record` key and the wire a union — so a colour that exists in one and
 * not the other is caught at startup instead of becoming a pin that cannot be
 * restored.
 */
function asColor(value: unknown, at: string): MapsPinColor {
  if (typeof value !== "string" || !(PIN_COLORS as readonly string[]).includes(value)) {
    throw new Error(`Maps data: "${at}.color" is not a pin colour this build knows.`);
  }
  if (!(MAPS_PIN_COLORS as readonly string[]).includes(value)) {
    throw new Error(
      `Maps data: "${at}.color" exists in the database but not on the wire; this build's two lists disagree.`,
    );
  }
  return value as MapsPinColor;
}
