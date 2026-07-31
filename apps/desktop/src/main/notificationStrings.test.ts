import { describe, expect, it } from "vitest";

import {
  emptyDigestCounts,
  groupedDigestCopy,
  securityNotificationCopy,
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

describe("groupedDigestCopy with security events", () => {
  it("counts them under their own Serbian noun", () => {
    const counts = { ...emptyDigestCounts(), task: 1, security: 2 };
    expect(groupedDigestCopy(3, counts).body).toBe("1 zadatak · 2 bezbednosna obaveštenja");
  });

  it("omits them when there are none, exactly like every other source", () => {
    const counts = { ...emptyDigestCounts(), document: 4 };
    expect(groupedDigestCopy(4, counts).body).toBe("4 dokumenta");
  });
});
