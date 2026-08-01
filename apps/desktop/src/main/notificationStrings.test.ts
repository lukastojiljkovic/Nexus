import { describe, expect, it } from "vitest";

import {
  catchUpDigestCopy,
  emptyDigestCounts,
  groupedDigestCopy,
  securityNotificationCopy,
  windowDigestCopy,
  type SecurityNotice,
} from "./notificationStrings.js";

/**
 * The NTF-007 security copy is the one notification text a user may only ever
 * see once, at a moment that matters, so every sentence is pinned here — and the
 * throttle's instant is built from LOCAL y/m/d fields so the same assertion
 * holds whatever time zone the host is set to.
 */

const AT = "2026-07-31T09:00:00.000Z";

describe("securityNotificationCopy", () => {
  it("names the wrong-attempt burst, its count and the wait it imposed", () => {
    const lockedUntil = new Date(2026, 6, 31, 14, 32, 0).toISOString();
    const notice: SecurityNotice = {
      kind: "unlock-throttle",
      at: AT,
      failedAttempts: 5,
      lockedUntil,
    };
    expect(securityNotificationCopy(notice)).toEqual({
      title: "Više pogrešnih pokušaja otključavanja",
      body: "5 pogrešnih pokušaja pre ovog otključavanja · zaključavanje do 31.07.2026. u 14:32",
    });
  });

  it("agrees the attempt count in Serbian (1 / 2-4 / 5+)", () => {
    const body = (failedAttempts: number): string =>
      securityNotificationCopy({
        kind: "unlock-throttle",
        at: AT,
        failedAttempts,
        lockedUntil: new Date(2026, 6, 31, 14, 32, 0).toISOString(),
      }).body;
    expect(body(1)).toContain("1 pogrešan pokušaj ");
    expect(body(3)).toContain("3 pogrešna pokušaja ");
    expect(body(11)).toContain("11 pogrešnih pokušaja ");
  });

  it("states the passcode change and what follows from it", () => {
    expect(securityNotificationCopy({ kind: "passcode-changed", at: AT })).toEqual({
      title: "PIN je promenjen",
      body: "Otključavanje sada traži novi PIN.",
    });
  });

  it("states the Recovery Kit reissue and that the old code is dead", () => {
    expect(securityNotificationCopy({ kind: "recovery-kit-reissued", at: AT })).toEqual({
      title: "Izdat je novi Recovery Kit",
      body: "Stari kod više ne važi.",
    });
  });

  it("names the deleted account by the label it had", () => {
    expect(securityNotificationCopy({ kind: "account-deleted", at: AT, label: "Posao" })).toEqual({
      title: "Nalog je obrisan",
      body: "Nalog „Posao“ je obrisan sa ovog uređaja.",
    });
  });

  it("returns an unparseable instant unchanged rather than rendering a broken date", () => {
    const body = securityNotificationCopy({
      kind: "unlock-throttle",
      at: AT,
      failedAttempts: 5,
      lockedUntil: "not-an-instant",
    }).body;
    expect(body).toContain("not-an-instant");
  });
});

describe("digest counts", () => {
  it("has no security key at all — an always-on notice is never folded (NTF-009)", () => {
    expect(Object.keys(emptyDigestCounts())).toEqual([
      "document",
      "exam",
      "study-day",
      "event",
      "task",
      "subscription",
      "habit",
    ]);
  });

  it("omits a source with no deliveries in it", () => {
    const counts = { ...emptyDigestCounts(), document: 4 };
    expect(groupedDigestCopy(4, counts).body).toBe("4 dokumenta");
  });

  it("lists every contributing source in the fixed order, separated by a middle dot", () => {
    const counts = { ...emptyDigestCounts(), document: 1, "study-day": 1, task: 2 };
    expect(groupedDigestCopy(4, counts).body).toBe("1 dokument · 1 učenje · 2 zadatka");
  });
});

describe("groupedDigestCopy (one oversized pass)", () => {
  it("names the app and agrees the reminder count in Serbian (1 / 2-4 / 5+)", () => {
    const counts = emptyDigestCounts();
    expect(groupedDigestCopy(1, counts).title).toBe("Nexus — 1 podsetnik");
    expect(groupedDigestCopy(4, counts).title).toBe("Nexus — 4 podsetnika");
    expect(groupedDigestCopy(9, counts).title).toBe("Nexus — 9 podsetnika");
  });
});

describe("windowDigestCopy (several arriving inside the rolling window)", () => {
  it("says how many new notifications there are, agreed in Serbian", () => {
    const counts = emptyDigestCounts();
    expect(windowDigestCopy(1, counts).title).toBe("1 novo obaveštenje");
    expect(windowDigestCopy(3, counts).title).toBe("3 nova obaveštenja");
    expect(windowDigestCopy(7, counts).title).toBe("7 novih obaveštenja");
    expect(windowDigestCopy(11, counts).title).toBe("11 novih obaveštenja");
    expect(windowDigestCopy(21, counts).title).toBe("21 novo obaveštenje");
  });

  it("breaks the count down by source in the body, like every other digest", () => {
    const counts = { ...emptyDigestCounts(), event: 2, task: 1 };
    expect(windowDigestCopy(3, counts).body).toBe("2 događaja · 1 zadatak");
  });
});

describe("catchUpDigestCopy (the first pass after unlock)", () => {
  it("says what piled up while the app was closed, agreed in Serbian", () => {
    const counts = emptyDigestCounts();
    expect(catchUpDigestCopy(1, counts).title).toBe("Dok te nije bilo: 1 obaveštenje");
    expect(catchUpDigestCopy(4, counts).title).toBe("Dok te nije bilo: 4 obaveštenja");
    expect(catchUpDigestCopy(6, counts).title).toBe("Dok te nije bilo: 6 obaveštenja");
    expect(catchUpDigestCopy(21, counts).title).toBe("Dok te nije bilo: 21 obaveštenje");
  });

  it("breaks the count down by source in the body, like every other digest", () => {
    const counts = { ...emptyDigestCounts(), document: 2, exam: 1, task: 3 };
    expect(catchUpDigestCopy(6, counts).body).toBe("2 dokumenta · 1 ispit · 3 zadatka");
  });
});
