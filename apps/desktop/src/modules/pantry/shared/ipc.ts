import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";
import type {
  PantryCategory,
  PantryLogReason,
  PantryShoppingGroup,
  PantryStockStatus,
  PantryUnit,
} from "@nexus/core";

/**
 * PANTRY's contract: the channels it answers on, the payload each one takes, and
 * the API its page calls - declared once, in its own folder (ADR-090).
 *
 * **Three processes read this file.** Main globs it through
 * `main/moduleIpc.ts`'s registration glue, the preload through
 * `preload/moduleBridge.ts`, and the module's own page imports its types. None
 * of them lists a channel: `contract.channels` IS the allowlist, and the op
 * names are the channel names, which is what makes "every channel starts with
 * `pantry:`" a property of the declaration rather than of anybody's care.
 *
 * **Why every mutation answers with the whole view.** The rows here are items,
 * shelves and shopping lines, and one write can change all three at once: buying
 * the last missing thing moves a quantity, drops a line off the shopping list
 * and changes an expiry verdict. One result type means the page has exactly one
 * way to update - the same rule for every module, which is the point of the kit -
 * and it is what keeps a wrong local guess impossible: the page renders what main
 * says, never what it hoped.
 *
 * **Why `@nexus/core` types cross this file and `@nexus/db`'s do not.** No file
 * under `shared/` may reach `@nexus/db` (it is SQLite and therefore Node-only,
 * and the renderer shares this file). `@nexus/core` is plain TypeScript that the
 * renderer already imports, so the DERIVED shapes the page draws - the expiry
 * verdict, the shopping list grouping - are its own types rather than a second
 * spelling of them. The two halves are kept in step by `main/register.ts`, which
 * is the only thing that maps a store row onto one of these, and by the compiler,
 * since the core object is what it maps FROM.
 */

/** One shelf, as the page draws it: the user's order is the array's own order. */
export interface PantryLocationView {
  readonly id: string;
  readonly name: string;
  readonly rank: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One stock item, with everything the page reads derived IN MAIN.
 *
 * **The verdict and the clock are main's.** `status` is `@nexus/core`'s
 * `stockStatus` computed against the day main stamped, and `needed` is
 * `minQuantity - quantity` where the item is below its minimum. Both are here
 * rather than computed in the page for one reason: main is also what fires the
 * expiry reminder, and a page that worked out "soon" from its own clock and the
 * same window could disagree with the toast that had just been shown. There is
 * one definition of "ističe uskoro" and this file carries it.
 */
export interface PantryItemView {
  readonly id: string;
  readonly locationId: string | null;
  readonly name: string;
  readonly category: PantryCategory;
  readonly quantity: number;
  readonly unit: PantryUnit;
  readonly minQuantity: number | null;
  readonly expiryDate: string | null;
  readonly openedDate: string | null;
  readonly useWithinDays: number | null;
  readonly notes: string | null;
  readonly barcode: string | null;
  readonly doseNote: string | null;
  /** When the user finished with this item, or null while it is current. */
  readonly archivedAt: string | null;
  readonly status: PantryStockStatus;
  /** What has to be bought to reach the minimum, or null when the item is not below it. */
  readonly needed: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One hand-written shopping line, as it crosses the wire. */
export interface PantryShoppingLineView {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
  readonly unit: PantryUnit;
  /** The item ticking this line off restocks, or null for a line that is only a reminder. */
  readonly itemId: string | null;
}

/** The module's one preference, as the settings card and the page read it. */
export interface PantrySettingsView {
  readonly expiryWindowDays: number;
}

/** Everything one read of this module answers with, and what every mutation answers with too (see the header). */
export interface PantryView {
  /** The day every `status` below was computed against, stamped by main (`YYYY-MM-DD`). */
  readonly today: string;
  /** In the user's own order, which is the order they put the shelves in. */
  readonly locations: readonly PantryLocationView[];
  /** Sr-Latn alphabetical, archived items included and carrying their own `archivedAt`. */
  readonly items: readonly PantryItemView[];
  /** What is below its minimum, grouped by shelf - `@nexus/core`'s `shoppingList`. */
  readonly autoShopping: readonly PantryShoppingGroup[];
  /** The lines the user wrote himself, sr-Latn alphabetical. */
  readonly shopping: readonly PantryShoppingLineView[];
  readonly settings: PantrySettingsView;
}

/** One read: whose view is being asked for. */
interface ListPayload {
  profileId: string;
}

/** One row of this module's tables, by its own id. The store scopes it to the profile. */
interface RowPayload {
  profileId: string;
  id: string;
}

/**
 * Every field a new item carries. The optional ones are nullable rather than
 * optional, so the form has exactly one way to say "nothing here" and the store
 * has exactly one shape to read.
 */
interface CreateItemPayload {
  profileId: string;
  name: string;
  category: PantryCategory;
  quantity: number;
  unit: PantryUnit;
  locationId: string | null;
  minQuantity: number | null;
  expiryDate: string | null;
  openedDate: string | null;
  useWithinDays: number | null;
  notes: string | null;
  barcode: string | null;
  doseNote: string | null;
}

/**
 * An edit carries the item's whole field set and NOT its quantity.
 *
 * The whole set rather than a patch, because an explicit `null` and an omitted
 * key would then mean different things across the wire and both would mean
 * "absent" after JSON - the ambiguity `exactOptionalPropertyTypes` exists to make
 * visible. `quantity` is absent on purpose: it moves through `changeQuantity`,
 * which is the one path that writes the log in the same transaction, and the
 * store refuses a patch carrying one rather than ignoring it.
 */
interface UpdateItemPayload {
  profileId: string;
  id: string;
  name: string;
  category: PantryCategory;
  unit: PantryUnit;
  locationId: string | null;
  minQuantity: number | null;
  expiryDate: string | null;
  openedDate: string | null;
  useWithinDays: number | null;
  notes: string | null;
  barcode: string | null;
  doseNote: string | null;
}

/**
 * A quantity move. `reason` is the WIRE half of the sign rule: the store and
 * `@nexus/core`'s `validatePantryChange` both refuse a `bought` that subtracts,
 * so the page cannot record a purchase that empties the shelf.
 */
interface ChangeQuantityPayload {
  profileId: string;
  id: string;
  delta: number;
  reason: PantryLogReason;
}

interface CreateLocationPayload {
  profileId: string;
  name: string;
}

interface RenameLocationPayload {
  profileId: string;
  id: string;
  name: string;
}

/**
 * A reorder between two neighbours the user dropped the row between. Either
 * neighbour may be null, for "to the start" and "to the end"; the store refuses
 * a pair that does not describe a gap, so a drop that landed nowhere is a refusal
 * rather than a silent append.
 */
interface MoveLocationPayload {
  profileId: string;
  id: string;
  beforeId: string | null;
  afterId: string | null;
}

interface AddShoppingLinePayload {
  profileId: string;
  name: string;
  quantity: number;
  unit: PantryUnit;
  /** The stock row ticking this line off restocks, or null for a plain reminder. */
  itemId: string | null;
}

interface SetExpiryWindowPayload {
  profileId: string;
  days: number;
}

/**
 * The declared ops, as a payload→result map. `ModuleApiOf` turns this into the
 * `nexus.modules.pantry.*` methods the page calls, and `defineModuleContract`
 * turns the keys into the channels main answers on.
 */
type PantryOps = {
  list: { request: ListPayload; response: PantryView };
  createItem: { request: CreateItemPayload; response: PantryView };
  updateItem: { request: UpdateItemPayload; response: PantryView };
  changeQuantity: { request: ChangeQuantityPayload; response: PantryView };
  archiveItem: { request: RowPayload; response: PantryView };
  unarchiveItem: { request: RowPayload; response: PantryView };
  removeItem: { request: RowPayload; response: PantryView };
  createLocation: { request: CreateLocationPayload; response: PantryView };
  renameLocation: { request: RenameLocationPayload; response: PantryView };
  moveLocation: { request: MoveLocationPayload; response: PantryView };
  removeLocation: { request: RowPayload; response: PantryView };
  addShoppingLine: { request: AddShoppingLinePayload; response: PantryView };
  tickShoppingLine: { request: RowPayload; response: PantryView };
  removeShoppingLine: { request: RowPayload; response: PantryView };
  setExpiryWindow: { request: SetExpiryWindowPayload; response: PantryView };
};

/** This module's renderer API: one method per op, named after the op. */
export type PantryApi = ModuleApiOf<PantryOps>;

/**
 * The contract the preload builds the bridge from and main refuses foreign ops
 * against. Exported as `contract` because that is the ONE name the kit's globs
 * agree on: `preload/moduleBridge.ts` reads `module.contract` from every
 * `modules/*&#47;shared/ipc.ts` and throws, at startup, for a file that exports
 * none - so a module whose bridge is missing fails loudly instead of becoming a
 * `TypeError` on the first click.
 */
export const contract = defineModuleContract<"pantry", PantryOps>("pantry", [
  "list",
  "createItem",
  "updateItem",
  "changeQuantity",
  "archiveItem",
  "unarchiveItem",
  "removeItem",
  "createLocation",
  "renameLocation",
  "moveLocation",
  "removeLocation",
  "addShoppingLine",
  "tickShoppingLine",
  "removeShoppingLine",
  "setExpiryWindow",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here,
 * which is what makes `window.nexus.modules.pantry.list(...)` typed in this
 * module's own page, in the dashboard widget and in the settings card without a
 * line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    pantry: PantryApi;
  }
}
