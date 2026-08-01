import { describe, expect, it, vi } from "vitest";
import type { NotificationSchedulerDeps } from "./notifications.js";

// The scheduler module needs Electron only for the OS toast and the resume
// hook — neither is under test here, so both are stubbed just far enough for
// the module to load and for `showNotifications` to no-op.
vi.mock("electron", () => ({
  Notification: class {
    static isSupported(): boolean {
      return false;
    }
  },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
}));

const { runNotificationCheck } = await import("./notifications.js");

/**
 * ADR-058 (NTF active-profile rule): the check loop serves the ACTIVE profile
 * only. Pinned through the first thing `checkProfile` does per profile —
 * `planStore(profileId).syncAll` — so the assertion is "whose stores were
 * touched at all", not an implementation detail of delivery. Everything
 * downstream is exercised with empty data: no candidates, nothing recorded.
 */
function makeDeps(profileIds: readonly string[], activeId: string | null) {
  const checkedProfiles: string[] = [];
  // Reached only AFTER every source read and the derivation itself, so it is the
  // one witness that a check ran to the end rather than dying in the middle and
  // being logged away. It sits on `listLedgerKeys` deliberately: `getSettings`
  // used to carry it and runs BEFORE the source reads, which meant a dep that
  // went missing later (FIN's, then HABIT's) could throw into
  // `logCheckFailure` with these assertions still green.
  const completedProfiles: string[] = [];
  const emptySettings = {
    quietFrom: null,
    quietTo: null,
    morningHour: "08:00",
    enabledSources: [],
    snoozeDefault: "1h",
    appetiteAsked: true,
  };
  const deps = {
    listProfiles: () => profileIds.map((id) => ({ id })),
    activeProfileId: () => activeId,
    planStore: (profileId: string) => ({
      syncAll: () => {
        checkedProfiles.push(profileId);
      },
      listBlocksInRange: () => [],
    }),
    notificationStore: (profileId: string) => ({
      getSettings: () => emptySettings,
      listLedgerKeys: () => {
        completedProfiles.push(profileId);
        return [];
      },
      dueSnoozed: () => [],
    }),
    documentStore: () => ({ listActive: () => [] }),
    eventStore: () => ({ listActive: () => [] }),
    examStore: () => ({ listActive: () => [] }),
    subjectStore: () => ({ listActive: () => [] }),
    taskStore: () => ({ listActive: () => [] }),
    // FIN slice d's two stores are stubbed for a reason worth stating: without
    // them `checkProfile` threw at its first finance read, `logCheckFailure`
    // swallowed it, and the three assertions below still passed — because
    // `syncAll` runs BEFORE that line. Every one of them was measuring a
    // profile loop that never reached the end of a check. A missing stub must
    // fail a test, not go quiet in a log.
    finRecurringStore: () => ({ generateDue: () => 0, listActive: () => [], upcoming: () => [] }),
    finAccountStore: () => ({ listActive: () => [] }),
    // HABIT slice c's store, stubbed for exactly the reason FIN's two are: an
    // absent dep makes `checkProfile` throw at its first habit read, and
    // `logCheckFailure` would swallow it while these assertions still passed.
    habitStore: () => ({ listActive: () => [], listAllEntries: () => [] }),
    getMainWindow: () => null,
  } as unknown as NotificationSchedulerDeps;
  return { deps, checkedProfiles, completedProfiles };
}

describe("runNotificationCheck — ADR-058 active-profile gating", () => {
  it("checks the active profile and ONLY the active profile", () => {
    const { deps, checkedProfiles, completedProfiles } = makeDeps(
      ["personal", "business"],
      "business",
    );
    runNotificationCheck(deps);
    expect(checkedProfiles).toEqual(["business"]);
    // `checkProfile` catches and LOGS its own failures, so „the loop entered
    // this profile" and „the check finished" are two different claims. Both are
    // made here, or a dependency that goes missing later would leave these
    // assertions passing over a check that dies on its first line.
    expect(completedProfiles).toEqual(["business"]);
  });

  it("follows the active id when it changes between checks — the switch landing's restart serves the entered profile", () => {
    let active = "personal";
    const { deps, checkedProfiles } = makeDeps(["personal", "business"], null);
    (deps as { activeProfileId(): string | null }).activeProfileId = () => active;
    runNotificationCheck(deps);
    active = "business";
    runNotificationCheck(deps);
    expect(checkedProfiles).toEqual(["personal", "business"]);
  });

  it("checks nobody when no profile is active — the defensive floor, unreachable while unlocked", () => {
    const { deps, checkedProfiles } = makeDeps(["personal", "business"], null);
    runNotificationCheck(deps);
    expect(checkedProfiles).toEqual([]);
  });
});
