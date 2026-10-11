import {
  MAX_PANTRY_EXPORT_ROWS,
  MAX_PANTRY_EXPIRY_WINDOW_DAYS,
  parsePantryExport,
  type PantryExport,
  type PantrySettings,
  type PantryShoppingLine,
} from "@nexus/db";
import { MAX_ID_LENGTH, MAX_PANTRY_NAME_LENGTH, MAX_PANTRY_QUANTITY, isPantryUnit } from "@nexus/core";
import type { PantryUnit } from "@nexus/core";

/**
 * PANTRY's archive section (ADR-090 imex): what the module puts in
 * `data/modules.ndjson`, and the only reader of it.
 *
 * **Two halves, and the split is not cosmetic.** The pantry itself - shelves,
 * items, the change log - is `PantryStore.exportData`'s value, handed over as
 * it stands: stage 1 built that pair, its own tests pin its shape, and a second
 * spelling of it up here is how the two would drift. What the archive does NOT
 * carry is the module's stage-2 additions, and those are this file's own two
 * fields: the hand-written shopping list (the derived half needs no archive at
 * all - it is a function of the items, which travel) and the one preference.
 *
 * **Why the wrapper carries a `version` of its own.** `data` has the store's
 * own version inside it and `parsePantryExport` checks that. This one is about
 * the WRAPPER: a section written by a later build of this module - one that adds
 * a third field - is refused by name instead of being half-read, exactly as
 * `TIMERS_EXPORT_VERSION` does for the module next door.
 *
 * **Why the bounds are the store's own numbers rather than new ones.**
 * `MAX_PANTRY_EXPORT_ROWS` bounds the pantry collections in the store itself;
 * the shopping list gets the same ceiling for the same reason (a hand-made
 * archive is untrusted input, and every line costs a row), and the name, the
 * quantity and the unit are `@nexus/core`'s published bounds. A second copy of
 * 80 or of a million up here would be two numbers that agree until one moves.
 *
 * **Throwing is the contract.** This is a `ModuleImport.parse`: the host runs it
 * when the section is read (at the preview, so the user hears the refusal before
 * confirming a restore that replaces their profile) and again before any module
 * writes, and it must write nothing itself. So it has no early return and no
 * partial result: it either answers with a fully validated, normalised payload
 * or it throws, and every message names the field that is wrong.
 *
 * The cross-reference is checked LAST, so a link to an item the archive does not
 * carry is refused as the dangling link it is rather than as a broken row - the
 * `parsePantryExport` arrangement one level up.
 */

/** The wrapper's schema version. A new shape is a new number, never a quiet reinterpretation. */
export const PANTRY_SECTION_VERSION = 1;

/** How many hand-written lines one archive may carry - the store's own collection ceiling, applied to this file's list. */
const MAX_SHOPPING_LINES = MAX_PANTRY_EXPORT_ROWS;

/** One hand-written shopping line as the archive carries it: what the user typed, and nothing about the row that held it. */
export interface PantryShoppingExportLine {
  name: string;
  quantity: number;
  unit: PantryUnit;
  /** The archive's own item id, or null; `importData` has written those ids by the time a line is written. */
  itemId: string | null;
}

/** The whole payload. `version` first, so a reader sees the number before the data. */
export interface PantrySection {
  version: number;
  data: PantryExport;
  shopping: PantryShoppingExportLine[];
  /**
   * The module's one preference. `null` is "this archive says nothing about
   * it", which the store answers by DELETING the row - so the profile returns to
   * the shipped default rather than keeping whatever it held before.
   */
  settings: { expiryWindowDays: number | null };
}

/** What `exportData` is handed: the store's three reads, already in hand. */
export function buildPantrySection(
  data: PantryExport,
  shopping: readonly PantryShoppingLine[],
  settings: PantrySettings,
): PantrySection {
  return {
    version: PANTRY_SECTION_VERSION,
    data,
    shopping: shopping.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      unit: line.unit,
      itemId: line.itemId,
    })),
    settings: { expiryWindowDays: settings.expiryWindowDays },
  };
}

/** Reads one archive payload completely, before anything is written. See the file header for the contract. */
export function parsePantrySection(value: unknown): PantrySection {
  const record = asRecord(value, "payload");
  if (record.version !== PANTRY_SECTION_VERSION) {
    throw new Error(
      `Pantry data was written by another version of this module (found ${String(record.version)}, expected ${PANTRY_SECTION_VERSION}).`,
    );
  }

  // The store's own reader, called here so a bad pantry is refused at the
  // PREVIEW rather than when the write is already under way.
  const data = parsePantryExport(record.data);

  const rawShopping = record.shopping;
  if (!Array.isArray(rawShopping)) {
    throw new Error('Pantry data: "shopping" must be an array.');
  }
  if (rawShopping.length > MAX_SHOPPING_LINES) {
    throw new Error(`Pantry data: at most ${MAX_SHOPPING_LINES} shopping lines may be restored.`);
  }
  const shopping = rawShopping.map((entry, index) => asShoppingLine(entry, index));

  const settings = asRecord(record.settings, "settings");
  const window = settings.expiryWindowDays;
  if (window !== null && typeof window !== "number") {
    throw new Error('Pantry data: "settings.expiryWindowDays" must be a number or null.');
  }
  if (
    window !== null &&
    (!Number.isSafeInteger(window) || window < 1 || window > MAX_PANTRY_EXPIRY_WINDOW_DAYS)
  ) {
    throw new Error(
      `Pantry data: an expiry window must be a whole number of days in 1..${MAX_PANTRY_EXPIRY_WINDOW_DAYS}.`,
    );
  }

  const itemIds = new Set(data.items.map((item) => item.id));
  for (const [index, line] of shopping.entries()) {
    if (line.itemId !== null && !itemIds.has(line.itemId)) {
      throw new Error(
        `Pantry data: "shopping[${index}].itemId" names "${line.itemId}", which the archive does not carry.`,
      );
    }
  }

  return { version: PANTRY_SECTION_VERSION, data, shopping, settings: { expiryWindowDays: window } };
}

/** The archive's own structural rule: an object, never an array or a primitive. */
function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Pantry data: "${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** One hand-written line, normalised and inside the bounds the store and migration 075 both enforce. */
function asShoppingLine(value: unknown, index: number): PantryShoppingExportLine {
  const where = `shopping[${index}]`;
  const raw = asRecord(value, where);

  const name = raw.name;
  if (typeof name !== "string") throw new Error(`Pantry data: "${where}.name" must be a string.`);
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PANTRY_NAME_LENGTH) {
    throw new Error(
      `Pantry data: "${where}.name" must be 1..${MAX_PANTRY_NAME_LENGTH} characters.`,
    );
  }

  const quantity = raw.quantity;
  if (
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    quantity > MAX_PANTRY_QUANTITY
  ) {
    throw new Error(
      `Pantry data: "${where}.quantity" must be a number above 0 and at most ${MAX_PANTRY_QUANTITY}.`,
    );
  }

  if (!isPantryUnit(raw.unit)) {
    throw new Error(`Pantry data: "${where}.unit" is not a unit this module knows.`);
  }

  const itemId = raw.itemId ?? null;
  if (
    itemId !== null &&
    (typeof itemId !== "string" ||
      itemId !== itemId.trim() ||
      itemId.length === 0 ||
      itemId.length > MAX_ID_LENGTH)
  ) {
    throw new Error(`Pantry data: "${where}.itemId" must be an id or null.`);
  }

  return { name: trimmed, quantity, unit: raw.unit, itemId: itemId as string | null };
}
