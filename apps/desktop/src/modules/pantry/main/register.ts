import type Database from "better-sqlite3-multiple-ciphers";
import {
  MAX_PANTRY_DOSE_NOTE_LENGTH,
  MAX_PANTRY_LOCATION_NAME_LENGTH,
  MAX_PANTRY_NAME_LENGTH,
  MAX_PANTRY_NOTES_LENGTH,
  MAX_PANTRY_QUANTITY,
  MAX_PANTRY_USE_WITHIN_DAYS,
  PANTRY_CATEGORIES,
  PANTRY_LOG_REASONS,
  PANTRY_UNITS,
  isPantryBarcode,
  isValidDayKey,
  shoppingList,
  stockStatus,
} from "@nexus/core";
import type { ModuleText, PantryCategory, PantryLogReason, PantryUnit } from "@nexus/core";
import {
  MAX_PANTRY_EXPIRY_WINDOW_DAYS,
  PANTRY_EXPORT_VERSION,
  PantryStore,
} from "@nexus/db";
import type { ModuleCall, ModuleHostSurface } from "../../../main/moduleIpc.js";
import {
  contract,
  type PantryItemView,
  type PantryLocationView,
  type PantryShoppingLineView,
  type PantryView,
} from "../shared/ipc.js";
import { buildPantrySection, parsePantrySection } from "./imex.js";

/**
 * PANTRY in the main process (ADR-090): its handlers, its daily reminder, and
 * its archive section.
 *
 * **Why main owns the clock and the verdict.** "Ističe uskoro" is a fact about
 * TODAY, so every read stamps the day here, computes each item's status against
 * it (`@nexus/core`'s `stockStatus`, at the window the profile set) and puts the
 * result on the wire. The page then draws a verdict it did not derive, and the
 * reminder below - which fires with no page open at all - cannot disagree with
 * the chip the user reads. A renderer that worked this out from its own clock
 * would be a second answer to a question that has one.
 *
 * **What main does NOT do about expiry.** Nothing is ever stored about it. The
 * status is derived on every read, exactly as `DocumentStore.deriveStatus`
 * derives one, because a stored "expiring soon" is wrong the next morning and a
 * stored "expired" is wrong forever after that.
 *
 * **The arithmetic is the store's and the engine's.** Every write here is a
 * store method, and every rule about what a quantity or a date may be is
 * `@nexus/core`'s validator, which the store runs. This file validates the wire
 * (SEC-EL-02), maps rows onto the contract, and arms one timer.
 *
 * **Why the reminder is armed in main.** A pantry does not know or care whether
 * a page is open; what it has to say - "three things are about to go off" - is
 * true at nine in the morning, in a profile nobody is looking at. So main arms
 * ONE timer per profile and the host owns its lifetime: every armed timer is
 * cancelled when the session ends, which is what makes the forbidden
 * announcement (a toast about a profile whose database is being closed) not
 * merely avoided here but unrepresentable.
 *
 * **Why it is a toast and not an entry in the notification centre.** The house's
 * notification SCHEDULER derives its candidates from its own sources, and a new
 * source is a new union member in `@nexus/core`, a row in the source→module map,
 * a strings table and an appetite toggle - four shared files the kit exists to
 * keep a module out of. `ModuleContext.notify` is the same OS toast, in main's
 * language, through the app's one notification path; what a source would add is
 * the appetite filter, and this module's own answer to "do you want this" is the
 * window in its settings card.
 */

/** The `{ sr, en }` heading every pantry reminder is announced under. */
const REMINDER_TITLE: ModuleText = {
  sr: "Ostava — ističe uskoro",
  en: "Pantry — expiring soon",
};

/**
 * The local hour a reminder is due.
 *
 * A constant rather than a preference, deliberately: the module has exactly one
 * thing to say and it says it in the morning, and a second settings control that
 * only moves a toast would be the padding SET-006 warns about. A profile that is
 * unlocked at any other hour is reminded at that unlock instead - the app is
 * open and the user is looking at it - and never twice in one day.
 */
const REMINDER_HOUR = 9;

/**
 * Something that can open this module's store for a profile: the shape a
 * handler's `ModuleCall` and a session both have, so the code below is one
 * implementation rather than two that drift.
 */
interface StoreBearer {
  profileDb<T>(profileId: string, open: (db: Database.Database, profileId: string) => T): T;
  now(): number;
}

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  /** The profiles whose daily check is armed, by profile id, so a re-arm replaces the chain rather than stacking on it. */
  const armedReminders = new Map<string, () => void>();
  /**
   * The last day a reminder was SHOWN, by profile.
   *
   * Module state rather than session state, and the difference is the promise:
   * the reminder is once a day, so a lock and unlock an hour later must not
   * repeat it. It is deliberately NOT cleared at `sessionEnd` for that reason -
   * the day a reminder was shown is a fact about the day, not about the session
   * that happened to see it.
   */
  const lastReminded = new Map<string, string>();

  function pantryStore(bearer: StoreBearer, profileId: string): PantryStore {
    return bearer.profileDb(profileId, (db, id) => new PantryStore(db, id));
  }

  /**
   * Everything one read answers with. Every op below answers with this same
   * shape, so the page has exactly one way to learn anything: what main said.
   */
  function viewOf(bearer: StoreBearer, profileId: string, atMs: number): PantryView {
    const store = pantryStore(bearer, profileId);
    const today = localDayKey(atMs);
    const settings = store.settings();
    const rows = store.listItems();

    const locations: PantryLocationView[] = store.listLocations().map((location) => ({
      id: location.id,
      name: location.name,
      rank: location.rank,
      createdAt: location.createdAt,
      updatedAt: location.updatedAt,
    }));

    const items: PantryItemView[] = rows.map((item) => {
      const status = stockStatus(item, today, settings.expiryWindowDays);
      return {
        id: item.id,
        locationId: item.locationId,
        name: item.name,
        category: item.category,
        quantity: item.quantity,
        unit: item.unit,
        minQuantity: item.minQuantity,
        expiryDate: item.expiryDate,
        openedDate: item.openedDate,
        useWithinDays: item.useWithinDays,
        notes: item.notes,
        barcode: item.barcode,
        doseNote: item.doseNote,
        archivedAt: item.archivedAt,
        status,
        // What has to be bought to reach the minimum, or null when the item is
        // not below it. The derived shopping list says the same thing in whole
        // groups; this is the per-row half, so a row can show its own gap.
        needed: status.low && item.minQuantity !== null ? item.minQuantity - item.quantity : null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    });

    const shopping: PantryShoppingLineView[] = store.listShoppingLines().map((line) => ({
      id: line.id,
      name: line.name,
      quantity: line.quantity,
      unit: line.unit,
      itemId: line.itemId,
    }));

    return {
      today,
      locations,
      items,
      // The derived half of the shopping list, computed by the engine from the
      // rows above: an item below its minimum, grouped by shelf, with the
      // quantity that reaches it. Nothing about it is stored.
      autoShopping: shoppingList(rows, store.listLocations()),
      shopping,
      settings: { expiryWindowDays: settings.expiryWindowDays },
    };
  }

  /** What every mutation answers with: the rows read back. */
  function changed(bearer: StoreBearer, profileId: string): PantryView {
    return viewOf(bearer, profileId, bearer.now());
  }

  // --- The reminder ---------------------------------------------------------

  /**
   * Announces what is expired or expiring, at most once per profile per day, and
   * never when there is nothing to say.
   *
   * `silent` is passed and not left to the default: the OS's own notification
   * sound is a thing nobody asked this module for, and the toast is the whole of
   * the reminder. The counts are computed from the same `stockStatus` the page
   * draws, at the same window, so the number in the toast and the chips on
   * screen are one fact.
   */
  function remindIfDue(bearer: StoreBearer, profileId: string): void {
    const atMs = bearer.now();
    const today = localDayKey(atMs);
    if (lastReminded.get(profileId) === today) return;

    const store = pantryStore(bearer, profileId);
    const window = store.settings().expiryWindowDays;
    let expired = 0;
    let soon = 0;
    for (const item of store.listItems()) {
      // An archived item says the user is done with it, so it is not something
      // to be told about: the page's own expiring list leaves those rows out for
      // the same reason (`urgentItems`), and the two must agree or the toast
      // would name an item the card does not show.
      if (item.archivedAt !== null) continue;
      const { expiry } = stockStatus(item, today, window);
      if (expiry === "expired") expired += 1;
      else if (expiry === "soon") soon += 1;
    }
    if (expired === 0 && soon === 0) return;

    // Recorded BEFORE the toast, so a toast that throws cannot make the next
    // unlock a second one.
    lastReminded.set(profileId, today);
    ctx.notify(
      {
        title: REMINDER_TITLE,
        body: {
          sr: `Isteklo: ${expired}. Ističe uskoro: ${soon}.`,
          en: `Expired: ${expired}. Expiring soon: ${soon}.`,
        },
      },
      true,
    );
  }

  /**
   * Arms the next daily check for one profile, replacing any chain already
   * running for it.
   *
   * The timer re-arms ITSELF when it fires, which is the one shape that keeps a
   * reminder working in an app left open for a week. Nothing is thrown out of
   * the callback: this runs where an exception reaches nobody, so a failure is a
   * log and the chain continues - `TimersStore`'s own finished-countdown rule.
   */
  function armReminder(bearer: StoreBearer, profileId: string): void {
    armedReminders.get(profileId)?.();
    const cancel = ctx.armUntil(nextReminderAt(bearer.now()), () => {
      try {
        remindIfDue(bearer, profileId);
      } catch (error) {
        console.error(
          `Nexus: Pantry could not check its expiry window for a profile — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      armReminder(bearer, profileId);
    });
    armedReminders.set(profileId, cancel);
  }

  // --- Items ----------------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return viewOf(call, profileId, call.now());
  });

  ctx.handle("createItem", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    pantryStore(call, profileId).createItem(
      {
        name: itemName(call, payload.name),
        category: category(call, payload.category),
        quantity: quantity(call, payload.quantity, "quantity"),
        unit: unit(call, payload.unit),
        locationId: nullableId(call, payload.locationId, "locationId"),
        minQuantity: nullableQuantity(call, payload.minQuantity, "minQuantity"),
        expiryDate: nullableDay(call, payload.expiryDate, "expiryDate"),
        openedDate: nullableDay(call, payload.openedDate, "openedDate"),
        useWithinDays: nullableUseWithin(call, payload.useWithinDays),
        notes: nullableText(call, payload.notes, "notes", MAX_PANTRY_NOTES_LENGTH),
        barcode: barcode(call, payload.barcode),
        doseNote: nullableText(call, payload.doseNote, "doseNote", MAX_PANTRY_DOSE_NOTE_LENGTH),
      },
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("updateItem", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const id = call.as.asId(payload.id, "id");
    pantryStore(call, profileId).updateItem(
      id,
      {
        name: itemName(call, payload.name),
        category: category(call, payload.category),
        unit: unit(call, payload.unit),
        locationId: nullableId(call, payload.locationId, "locationId"),
        minQuantity: nullableQuantity(call, payload.minQuantity, "minQuantity"),
        expiryDate: nullableDay(call, payload.expiryDate, "expiryDate"),
        openedDate: nullableDay(call, payload.openedDate, "openedDate"),
        useWithinDays: nullableUseWithin(call, payload.useWithinDays),
        notes: nullableText(call, payload.notes, "notes", MAX_PANTRY_NOTES_LENGTH),
        barcode: barcode(call, payload.barcode),
        doseNote: nullableText(call, payload.doseNote, "doseNote", MAX_PANTRY_DOSE_NOTE_LENGTH),
      },
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("changeQuantity", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    pantryStore(call, profileId).changeQuantity(
      call.as.asId(payload.id, "id"),
      delta(call, payload.delta),
      logReason(call, payload.reason),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("archiveItem", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    pantryStore(call, profileId).archiveItem(call.as.asId(payload.id, "id"), instant(call.now()));
    return changed(call, profileId);
  });

  ctx.handle("unarchiveItem", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    pantryStore(call, profileId).unarchiveItem(call.as.asId(payload.id, "id"), instant(call.now()));
    return changed(call, profileId);
  });

  ctx.handle("removeItem", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    pantryStore(call, profileId).softDeleteItem(call.as.asId(payload.id, "id"), instant(call.now()));
    return changed(call, profileId);
  });

  // --- Locations ------------------------------------------------------------

  ctx.handle("createLocation", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    pantryStore(call, profileId).createLocation(
      { name: locationName(call, payload.name) },
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("renameLocation", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    pantryStore(call, profileId).renameLocation(
      call.as.asId(payload.id, "id"),
      locationName(call, payload.name),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("moveLocation", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    pantryStore(call, profileId).moveLocation(
      call.as.asId(payload.id, "id"),
      nullableId(call, payload.beforeId, "beforeId"),
      nullableId(call, payload.afterId, "afterId"),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("removeLocation", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    pantryStore(call, profileId).softDeleteLocation(
      call.as.asId(payload.id, "id"),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  // --- The shopping list ----------------------------------------------------

  ctx.handle("addShoppingLine", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    pantryStore(call, profileId).addShoppingLine(
      {
        name: itemName(call, payload.name),
        quantity: quantity(call, payload.quantity, "quantity"),
        unit: unit(call, payload.unit),
        itemId: nullableId(call, payload.itemId, "itemId"),
      },
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("tickShoppingLine", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    pantryStore(call, profileId).tickShoppingLine(
      call.as.asId(payload.id, "id"),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("removeShoppingLine", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    pantryStore(call, profileId).removeShoppingLine(call.as.asId(payload.id, "id"));
    return changed(call, profileId);
  });

  // --- The module's one preference ------------------------------------------

  ctx.handle("setExpiryWindow", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    pantryStore(call, profileId).setExpiryWindow(
      call.as.asBoundedInteger(payload.days, "days", 1, MAX_PANTRY_EXPIRY_WINDOW_DAYS),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  // --- The session ----------------------------------------------------------

  ctx.onSessionStart((session) => {
    for (const profileId of session.profileIds) {
      try {
        // The check runs at the unlock as well as at nine, because a profile
        // nobody opens at nine would otherwise never hear about its own fridge.
        // `remindIfDue` is what keeps that from becoming two toasts a day.
        remindIfDue(session, profileId);
        armReminder(session, profileId);
      } catch (error) {
        console.error(
          `Nexus: Pantry could not arm its expiry reminder for a profile — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  });

  ctx.onSessionEnd(() => {
    // The host has already cancelled every armed timer by the time this runs;
    // clearing the map is this module keeping its own bookkeeping in step with
    // that, so a chain can never look armed after the session it belonged to is
    // gone. `lastReminded` is deliberately left standing - see its own comment.
    armedReminders.clear();
  });

  // --- The archive (ADR-090 §imex) ------------------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    const store = pantryStore(session, profileId);
    return buildPantrySection(store.exportData(), store.listShoppingLines(), store.settings());
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the whole payload - the version first, and the store's
    // own value through the store's own reader - and throws on anything it will
    // not take, so a refused archive never reaches a write.
    parse: parsePantrySection,
    // The writing half. `undefined` is an archive that says nothing about the
    // pantry, which for a restore that replaces a profile whole means empty: no
    // shelves, no items, no log, no shopping lines, and no preference row, so
    // the profile answers the store's own default rather than a number restated
    // here. The three calls are one transaction - the host wraps every module's
    // `apply` in one - so a refusal anywhere leaves the pantry as it was.
    apply: (payload, session) => {
      const stamp = instant(session.now());
      for (const profileId of session.profileIds) {
        const store = pantryStore(session, profileId);
        // The store's own pair first: it writes the items a shopping line may
        // name, and it empties the tables this half is about to refill.
        store.importData(
          payload?.data ?? {
            version: PANTRY_EXPORT_VERSION,
            locations: [],
            items: [],
            log: [],
          },
        );
        store.replaceShoppingFromArchive(payload?.shopping ?? [], stamp);
        store.setExpiryWindow(payload?.settings.expiryWindowDays ?? null, stamp);
      }
    },
  });
}

/**
 * The one profile a session is about, or `null` when it names none or several.
 *
 * An archive is written ONE profile at a time (`main/imex.ts`'s `handleExport`
 * gathers one profile's `ProfileData`), so "several" is not a shape the exporter
 * meets. Answering `null` rather than guessing is what keeps that true: if a
 * session ever did name several, this module has no single profile its shelves
 * belong to, and the honest payload is none at all rather than the first
 * profile's pantry written under someone else's name.
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/**
 * The day the machine is living in, from the instant the kit injected.
 *
 * The LOCAL day and not the UTC one, on the renderer's own rule
 * (`localTodayKey`): an expiry date is a day on a calendar somebody is holding,
 * and "is this still good" is asked at breakfast rather than at UTC midnight. A
 * bare day key is zone-less, so parsing one back with local `Date` semantics -
 * which every calculation in `@nexus/core` deliberately avoids - never happens
 * here; this is the clock reading, and it happens once per read.
 */
function localDayKey(atMs: number): string {
  const at = new Date(atMs);
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/** The next local `REMINDER_HOUR` at or after `atMs`. Local-time construction, so a DST shift moves the hour with the clock. */
function nextReminderAt(atMs: number): number {
  const at = new Date(atMs);
  const today = new Date(
    at.getFullYear(),
    at.getMonth(),
    at.getDate(),
    REMINDER_HOUR,
  ).getTime();
  if (today > atMs) return today;
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1, REMINDER_HOUR).getTime();
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

// --- Wire validation --------------------------------------------------------

type Call = Pick<ModuleCall, "as">;

/** A category off the wire, refused by name rather than silently stored. */
function category(call: Call, value: unknown): PantryCategory {
  const asString = call.as.asNonEmptyString(value, "category");
  if (!(PANTRY_CATEGORIES as readonly string[]).includes(asString)) {
    throw new Error(`Invalid IPC payload: "category" is not a pantry category.`);
  }
  return asString as PantryCategory;
}

/** A unit off the wire - the six `@nexus/core` publishes, and no seventh. */
function unit(call: Call, value: unknown): PantryUnit {
  const asString = call.as.asNonEmptyString(value, "unit");
  if (!(PANTRY_UNITS as readonly string[]).includes(asString)) {
    throw new Error(`Invalid IPC payload: "unit" is not a pantry unit.`);
  }
  return asString as PantryUnit;
}

/** Why a quantity moved. The sign rule is not checked here: the store and `validatePantryChange` own it. */
function logReason(call: Call, value: unknown): PantryLogReason {
  const asString = call.as.asNonEmptyString(value, "reason");
  if (!(PANTRY_LOG_REASONS as readonly string[]).includes(asString)) {
    throw new Error(`Invalid IPC payload: "reason" is not a pantry change reason.`);
  }
  return asString as PantryLogReason;
}

/** A name off the wire, capped in CHARACTERS - the unit the store measures in. */
function itemName(call: Call, value: unknown): string {
  return call.as.asCappedChars(
    call.as.asNonEmptyString(value, "name"),
    "name",
    MAX_PANTRY_NAME_LENGTH,
  );
}

/** A shelf's name off the wire, on the item name's terms with the shelf's own bound. */
function locationName(call: Call, value: unknown): string {
  return call.as.asCappedChars(
    call.as.asNonEmptyString(value, "name"),
    "name",
    MAX_PANTRY_LOCATION_NAME_LENGTH,
  );
}

/**
 * A finite REAL inside a range.
 *
 * `inclusiveFloor` is the whole of the difference between the two quantities the
 * module carries: a stock quantity may be ZERO (an item that has run out is 0,
 * not a debt) while a shopping line's may not (a line asking for nothing is not
 * a line). The ceiling is `MAX_PANTRY_QUANTITY`, past which the number is a
 * typo, and it is the same number migration 075 checks against.
 */
function boundedQuantity(
  call: Call,
  value: unknown,
  field: string,
  inclusiveFloor: boolean,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (inclusiveFloor ? value < 0 : value <= 0) ||
    value > MAX_PANTRY_QUANTITY
  ) {
    throw new Error(
      `Invalid IPC payload: "${field}" must be a number ${inclusiveFloor ? "from 0" : "above 0"} and at most ${MAX_PANTRY_QUANTITY}.`,
    );
  }
  return value;
}

/** A stock quantity: zero allowed, never negative, never past the ceiling. */
function quantity(call: Call, value: unknown, field: string): number {
  return boundedQuantity(call, value, field, true);
}

/** An optional stock quantity: an explicit null is "no minimum". */
function nullableQuantity(call: Call, value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return boundedQuantity(call, value, field, false);
}

/** A quantity move: never zero, and bounded on both sides by the ceiling. */
function delta(call: Call, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    throw new Error(`Invalid IPC payload: "delta" must be a non-zero number.`);
  }
  if (Math.abs(value) > MAX_PANTRY_QUANTITY) {
    throw new Error(
      `Invalid IPC payload: "delta" must be within ${MAX_PANTRY_QUANTITY} in either direction.`,
    );
  }
  return value;
}

/** A bare day off the wire, or an explicit null. A string that is not a real calendar day is refused here, not stored. */
function nullableDay(call: Call, value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  const day = call.as.asNonEmptyString(value, field);
  if (!isValidDayKey(day)) {
    throw new Error(`Invalid IPC payload: "${field}" must be a real date (YYYY-MM-DD).`);
  }
  return day;
}

/** "Use within N days": an optional whole number of days inside the published bound. */
function nullableUseWithin(call: Call, value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return call.as.asBoundedInteger(value, "useWithinDays", 1, MAX_PANTRY_USE_WITHIN_DAYS);
}

/** An optional text field: an explicit null (or an absent one) is "nothing written". */
function nullableText(
  call: Call,
  value: unknown,
  field: string,
  maxChars: number,
): string | null {
  const text = call.as.asNullableString(value, field);
  return text === null ? null : call.as.asCappedChars(text, field, maxChars);
}

/** A barcode off the wire: digits only, one of the four real lengths, or null. The store's validator is the guarantee; this is the sentence. */
function barcode(call: Call, value: unknown): string | null {
  const code = call.as.asNullableString(value, "barcode");
  if (code === null) return null;
  if (!isPantryBarcode(code)) {
    throw new Error(
      `Invalid IPC payload: "barcode" must be 8, 12, 13 or 14 digits, with nothing around them.`,
    );
  }
  return code;
}

/** An id off the wire, or an explicit null. */
function nullableId(call: Call, value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return call.as.asId(value, field);
}
