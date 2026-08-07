import { describe, expect, it, vi } from "vitest";
import type { NotificationSchedulerDeps } from "./notifications.js";

// Same two stubs `notificationsGate.test.ts` uses: Electron is here only for the
// OS toast and the resume hook, and neither is under test.
vi.mock("electron", () => ({
  Notification: class {
    static isSupported(): boolean {
      return false;
    }
  },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
}));

// The clock is mocked so „it is 23:30, inside a 22:00–07:00 quiet window" is a
// fact rather than a coincidence of when the suite runs. 23:30 rather than an
// early-morning hour on purpose: a reminder is not derived before the profile's
// `morningHour` at all, so a 03:00 stub would prove nothing about quiet hours —
// there would be no candidate to hold.
vi.mock("./clock.js", () => ({
  localToday: () => "2026-08-07",
  localTime: () => "23:30",
}));

const { runNotificationCheck } = await import("./notifications.js");

const ALL_MODULES: ReadonlySet<string> = new Set([
  "calendar",
  "study",
  "tasks",
  "settings",
  "finance",
  "habits",
]);

/**
 * A document whose 30-day reminder falls on the mocked today. TWO offsets, not
 * one, and that is load-bearing: the SMALLEST offset is the „final warning" and
 * carries `priority: "max"`, which bypasses quiet hours by design. A single-
 * offset document would therefore prove nothing about the quiet gate.
 */
const DOCUMENT = { id: "doc-1", expiryDate: "2026-09-06", reminderOffsets: [30, 7] };

/** The ledger row for that same occurrence, snoozed until a moment already past. */
const SNOOZED = {
  id: "row-1",
  source: "document" as const,
  entityId: DOCUMENT.id,
  occurrenceKey: "30",
  title: "Pasoš ističe",
  body: "za 30 dana",
};

interface Recorded {
  refired: string[];
  dismissed: string[];
  delivered: string[];
}

function makeDeps(options: {
  quiet: boolean;
  enabledSources: string[];
  enabledModules: ReadonlySet<string>;
  snoozed: boolean;
}): { deps: NotificationSchedulerDeps; recorded: Recorded } {
  const recorded: Recorded = { refired: [], dismissed: [], delivered: [] };
  const settings = {
    quietFrom: options.quiet ? "22:00" : null,
    quietTo: options.quiet ? "07:00" : null,
    morningHour: "08:00",
    enabledSources: options.enabledSources,
    snoozeDefault: "1h",
    appetiteAsked: true,
  };
  const deps = {
    listProfiles: () => [{ id: "personal" }],
    activeProfileId: () => "personal",
    planStore: () => ({ syncAll: () => undefined, listBlocksInRange: () => [] }),
    notificationStore: () => ({
      getSettings: () => settings,
      // The occurrence is already in the ledger, which is what makes it a
      // SNOOZED row rather than a fresh candidate — a fresh one would be
      // filtered by `ledgerKeys` and never reach the re-fire loop.
      listLedgerKeys: () => (options.snoozed ? [SNOOZED] : []),
      dueSnoozed: () => (options.snoozed ? [SNOOZED] : []),
      markRefired: (id: string) => {
        recorded.refired.push(id);
        return { title: SNOOZED.title, body: SNOOZED.body };
      },
      dismiss: (id: string) => {
        recorded.dismissed.push(id);
      },
      recordDelivered: (row: { entityId: string }) => {
        recorded.delivered.push(row.entityId);
      },
    }),
    documentStore: () => ({ listActive: () => [DOCUMENT] }),
    eventStore: () => ({ listActive: () => [] }),
    examStore: () => ({ listActive: () => [] }),
    subjectStore: () => ({ listActive: () => [] }),
    taskStore: () => ({ listActive: () => [] }),
    finRecurringStore: () => ({ generateDue: () => 0, listActive: () => [], upcoming: () => [] }),
    finAccountStore: () => ({ listActive: () => [] }),
    habitStore: () => ({ listActive: () => [], listAllEntries: () => [] }),
    enabledModuleIds: () => options.enabledModules,
    getMainWindow: () => null,
  } as unknown as NotificationSchedulerDeps;
  return { deps, recorded };
}

/**
 * The re-fire path used to skip both gates a FRESH candidate goes through.
 * `withinQuiet` was computed once and consumed once — by the fresh filter — so a
 * „Odloži do sutra" landing at 03:00 rang an OS toast in the middle of the
 * night, and a source switched off since the snooze was made re-fired anyway.
 *
 * Holding must be free: a gated row is left completely untouched, so it is
 * still due on the next cycle and delivers the moment the gate opens. That is
 * the assertion that matters — „not shown" would be satisfied by a row that had
 * been silently stamped as re-fired and thereby lost.
 */
describe("runNotificationCheck — a snoozed row re-fires only through the same gate a fresh one does", () => {
  it("holds a due snooze inside quiet hours, writing nothing", () => {
    const { deps, recorded } = makeDeps({
      quiet: true,
      enabledSources: ["document"],
      enabledModules: ALL_MODULES,
      snoozed: true,
    });
    runNotificationCheck(deps);
    expect(recorded.refired).toEqual([]);
    expect(recorded.dismissed).toEqual([]);
  });

  it("re-fires the same row outside quiet hours", () => {
    const { deps, recorded } = makeDeps({
      quiet: false,
      enabledSources: ["document"],
      enabledModules: ALL_MODULES,
      snoozed: true,
    });
    runNotificationCheck(deps);
    expect(recorded.refired).toEqual([SNOOZED.id]);
  });

  it("holds a due snooze whose source the profile has since switched off", () => {
    const { deps, recorded } = makeDeps({
      quiet: false,
      enabledSources: [],
      enabledModules: ALL_MODULES,
      snoozed: true,
    });
    runNotificationCheck(deps);
    expect(recorded.refired).toEqual([]);
    expect(recorded.dismissed).toEqual([]);
  });

  it("holds a due snooze whose MODULE the profile has switched off (SET-007)", () => {
    const { deps, recorded } = makeDeps({
      quiet: false,
      enabledSources: ["document"],
      enabledModules: new Set([...ALL_MODULES].filter((id) => id !== "calendar")),
      snoozed: true,
    });
    runNotificationCheck(deps);
    expect(recorded.refired).toEqual([]);
    expect(recorded.dismissed).toEqual([]);
  });

  it("still dismisses a snoozed row whose occurrence no longer derives — silence there is the PRD's, not a gate's", () => {
    const { deps, recorded } = makeDeps({
      quiet: true,
      enabledSources: ["document"],
      enabledModules: ALL_MODULES,
      snoozed: true,
    });
    // No document ⇒ nothing derives ⇒ the row is stale rather than held.
    (deps as unknown as { documentStore(): { listActive(): unknown[] } }).documentStore = () => ({
      listActive: () => [],
    });
    runNotificationCheck(deps);
    expect(recorded.dismissed).toEqual([SNOOZED.id]);
    expect(recorded.refired).toEqual([]);
  });

  it("derives no fresh candidate at all for a module that is switched off", () => {
    const { deps, recorded } = makeDeps({
      quiet: false,
      enabledSources: ["document"],
      enabledModules: new Set([...ALL_MODULES].filter((id) => id !== "calendar")),
      snoozed: false,
    });
    runNotificationCheck(deps);
    expect(recorded.delivered).toEqual([]);
  });

  it("delivers that same fresh candidate once the module is on", () => {
    const { deps, recorded } = makeDeps({
      quiet: false,
      enabledSources: ["document"],
      enabledModules: ALL_MODULES,
      snoozed: false,
    });
    runNotificationCheck(deps);
    expect(recorded.delivered).toEqual([DOCUMENT.id]);
  });
});
