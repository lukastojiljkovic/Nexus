import { describe, expect, it } from "vitest";
import {
  BACKUP_ARCHIVE_EXTENSION,
  backupFileName,
  backupFilePrefix,
  backupProfileSlug,
  backupTimestamp,
  isBackupDue,
  selectBackupsToDelete,
} from "./backup.js";

// Local wall-clock instants, built from components exactly as `backupTimestamp`
// reads them, so these tests hold in every timezone.
const AT = new Date(2026, 6, 8, 9, 5, 7); // 2026-07-08 09:05:07 local

describe("backupProfileSlug", () => {
  it("lowercases the sanitized name and joins its words with hyphens", () => {
    expect(backupProfileSlug("Luka")).toBe("luka");
    expect(backupProfileSlug("  Moj   Profil  ")).toBe("moj-profil");
  });

  it("keeps Serbian orthography — a filename token, not an ASCII transliteration", () => {
    expect(backupProfileSlug("Škola")).toBe("škola");
  });

  it("survives filesystem-hostile names through sanitizePathSegment's rules", () => {
    expect(backupProfileSlug('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
    expect(backupProfileSlug("CON")).toBe("con_");
  });

  it("falls back to a fixed token when the name collapses to nothing", () => {
    expect(backupProfileSlug("   ")).toBe("profil");
  });
});

describe("backupTimestamp", () => {
  it("formats the LOCAL wall clock as YYYYMMDD-HHmmss (the clock.ts idiom, never toISOString)", () => {
    expect(backupTimestamp(AT)).toBe("20260708-090507");
  });

  it("zero-pads every component", () => {
    expect(backupTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102-030405");
  });
});

describe("backupFileName / backupFilePrefix", () => {
  it("composes prefix + timestamp + the manual encrypted export's exact extension", () => {
    expect(backupFileName("Luka", AT)).toBe("nexus-auto-luka-20260708-090507.nexus");
    expect(backupFilePrefix("Luka")).toBe("nexus-auto-luka-");
    expect(BACKUP_ARCHIVE_EXTENSION).toBe(".nexus");
  });
});

describe("selectBackupsToDelete", () => {
  const own = (timestamp: string): string => `nexus-auto-luka-${timestamp}${BACKUP_ARCHIVE_EXTENSION}`;

  it("returns the oldest files beyond keepLast, oldest first", () => {
    const names = [
      own("20260705-090000"),
      own("20260701-090000"),
      own("20260704-090000"),
      own("20260702-090000"),
      own("20260703-090000"),
    ];
    expect(selectBackupsToDelete(names, "Luka", 3)).toEqual([
      own("20260701-090000"),
      own("20260702-090000"),
    ]);
  });

  it("returns nothing while the folder holds keepLast files or fewer", () => {
    const names = [own("20260701-090000"), own("20260702-090000")];
    expect(selectBackupsToDelete(names, "Luka", 2)).toEqual([]);
    expect(selectBackupsToDelete([], "Luka", 2)).toEqual([]);
  });

  it("never touches anything but this profile's own exact-pattern files", () => {
    const names = [
      own("20260701-090000"),
      own("20260702-090000"),
      own("20260703-090000"),
      // Another profile's backups — a different slug is a different prefix.
      "nexus-auto-ana-20260101-090000.nexus",
      // A crashed run's partial: never a plausible archive, never swept.
      `${own("20260630-090000")}.partial`,
      // A manual export and arbitrary neighbours in the same folder.
      "nexus-export-2026-07-01.nexus",
      "porodica.jpg",
      // Near-misses: a malformed timestamp and a foreign extension.
      "nexus-auto-luka-2026-07-01.nexus",
      "nexus-auto-luka-20260629-090000.nexus.zip",
    ];
    expect(selectBackupsToDelete(names, "Luka", 2)).toEqual([own("20260701-090000")]);
  });

  it("cannot cross profiles whose slug extends this one — the strict timestamp anchor refuses the remainder", () => {
    const names = [
      // Profile "Luka 2"'s file: for profile "Luka" the remainder after its own
      // prefix is "2-20260701-090000", which is not a bare timestamp.
      "nexus-auto-luka-2-20260701-090000.nexus",
      own("20260628-090000"),
      own("20260629-090000"),
      own("20260630-090000"),
    ];
    expect(selectBackupsToDelete(names, "Luka", 2)).toEqual([own("20260628-090000")]);
    expect(selectBackupsToDelete(names, "Luka 2", 2)).toEqual([]);
  });
});

describe("isBackupDue", () => {
  const now = new Date("2026-07-08T09:00:00.000Z");

  it("is due when no run was ever recorded", () => {
    expect(isBackupDue(null, "daily", now)).toBe(true);
    expect(isBackupDue(null, "weekly", now)).toBe(true);
  });

  it("daily: due at 24 hours, not a moment before", () => {
    expect(isBackupDue("2026-07-07T09:00:00.001Z", "daily", now)).toBe(false);
    expect(isBackupDue("2026-07-07T09:00:00.000Z", "daily", now)).toBe(true);
    expect(isBackupDue("2026-07-05T09:00:00.000Z", "daily", now)).toBe(true);
  });

  it("weekly: due at 7 whole days", () => {
    expect(isBackupDue("2026-07-02T09:00:00.000Z", "weekly", now)).toBe(false);
    expect(isBackupDue("2026-07-01T09:00:00.000Z", "weekly", now)).toBe(true);
  });

  it("treats an unreadable stamp as due — a corrupt row must never silently stop backups", () => {
    expect(isBackupDue("yesterday", "daily", now)).toBe(true);
  });
});
