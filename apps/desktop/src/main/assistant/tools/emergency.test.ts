import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EmergencyCardStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import type { Tool, ToolContext } from "@nexus/core";
import { emergencyTools } from "./emergency.js";

/**
 * The EMERGENCY tool over a real database.
 *
 * Two things are worth pinning here and nothing else: that the card's own words
 * are read back as they were stored (dates in the active locale, allergies with
 * their severity, the contacts in the user's own order), and that the answer
 * always ENDS with the disclaimer the assistant's rules require.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-emergency-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function store(): EmergencyCardStore {
  return new EmergencyCardStore(db.raw, profileId);
}

function tool(): Tool {
  const found = emergencyTools({ profileDb: (id, open) => open(db.raw, id) }).find(
    (entry) => entry.name === "emergency.card",
  );
  if (found === undefined) throw new Error('Test setup: no tool "emergency.card".');
  return found;
}

function context(locale: "sr" | "en"): ToolContext {
  return {
    profileId,
    locale,
    signal: new AbortController().signal,
    confirm: () => Promise.resolve(true),
  };
}

describe("emergency.card", () => {
  it("says so when the profile has no card", async () => {
    expect(await tool().run({}, context("sr"))).toEqual({
      ok: true,
      content: "Ovaj profil nema karticu za hitne slučajeve.",
    });
    expect(await tool().run({}, context("en"))).toEqual({
      ok: true,
      content: "This profile has no emergency card.",
    });
  });

  it("reads the card's own fields, its contacts, and carries the notice", async () => {
    const cards = store();
    cards.create(
      {
        fullName: "Ana Anić",
        dateOfBirth: "1990-10-12",
        bloodType: "A+",
        allergies: [{ label: "Penicilin", severity: "severe" }],
        conditions: ["Astma"],
        medications: [{ name: "Ventolin", dose: "2 udaha" }],
        organDonor: "yes",
        healthInsuranceNumber: "12345",
        doctorName: "Dr Marko Marković",
        doctorPhone: "+3816012345",
        notes: "Alergija na penicilin.",
      },
      NOW_ISO,
    );
    cards.addContact({ name: "Jovan", phone: "+3816411122", relation: "brat" }, NOW_ISO);

    const result = await tool().run({}, context("sr"));

    expect(result.ok).toBe(true);
    expect(result.content).toBe(
      [
        "Kartica za hitne slučajeve:",
        "- Ime i prezime: Ana Anić",
        "- Datum rođenja: 12. oktobar 1990.",
        "- Krvna grupa: A+",
        "- Alergije: Penicilin (severe)",
        "- Stanja: Astma",
        "- Lekovi: Ventolin (2 udaha)",
        "- Davalac organa: da",
        "- Zdravstveno osiguranje: 12345",
        "- Lekar: Dr Marko Marković, +3816012345",
        "- Napomene: Alergija na penicilin.",
        "- Kontakti:",
        "  - Jovan (+3816411122, brat)",
        "- Povezani dokumenti: 0",
        "",
        "Obaveštenje ispod mora da ide uz svaki odgovor koji koristi ovu karticu.",
        "Samo za informisanje. Nije zamena za stručnu pomoć. Proveri informacije. U hitnom slučaju pozovi 112.",
      ].join("\n"),
    );
  });

  it("leaves out every field nobody filled in", async () => {
    store().create({ fullName: "Ana Anić" }, NOW_ISO);
    const result = await tool().run({}, context("en"));
    expect(result.content).toBe(
      [
        "Emergency card:",
        "- Name: Ana Anić",
        "- Linked documents: 0",
        "",
        "The notice below must travel with every answer that uses this card.",
        "For reference only. Not a substitute for professional help. Check the information. In an emergency, call 112.",
      ].join("\n"),
    );
  });
});
