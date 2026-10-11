import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EmergencyCardStore, openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { ModuleHost, type ModulePlatform, type PdfSaveRequest } from "../../../main/moduleIpc.js";
import { register } from "./register.js";

/**
 * The EMERGENCY card through the kit (ADR-090): its ops, the card's own
 * distinction between "not answered" and "answered with nothing", the contact
 * list's order, the PDF it asks main to write, and its archive section.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * refusals, the sender check and the channel allowlist are all the host's. Going
 * through `dispatch` therefore tests what actually runs in the app.
 *
 * Everything is real except the four things the kit injects: a real encrypted
 * database, the real migrations, the real store - and a printer that records what
 * it was asked to print instead of opening a window.
 */

const TRUSTED = { trusted: true };

let dir: string;
let db: NexusDatabase;
let clock = Date.parse("2026-07-01T09:00:00.000Z");

interface Harness {
  readonly host: ModuleHost;
  readonly prints: PdfSaveRequest[];
  /** What the fake save dialog answers: a path, or `null` for a cancelled dialog. */
  answer: string | null;
}

function harness(): Harness {
  const prints: PdfSaveRequest[] = [];
  let answer: string | null = "/tmp/hitna-karta.pdf";
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => db.raw,
    notify: () => undefined,
    schedule: () => () => undefined,
    now: () => clock,
    savePdf: (request) => {
      prints.push(request);
      return Promise.resolve(answer);
    },
  };
  const host = new ModuleHost(platform);
  register(host);
  return {
    host,
    prints,
    get answer() {
      return answer;
    },
    set answer(next: string | null) {
      answer = next;
    },
  };
}

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date(clock).toISOString());
  return id;
}

function createPerson(profileId: string, name: string): string {
  const id = uuidv7();
  db.raw
    .prepare(
      `INSERT INTO people (id, profile_id, name, kind, month, day, year, note, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    )
    // `birthday` is one of the two kinds migration 020's CHECK allows; the
    // card stores nothing about a person beyond the id it names.
    .run(
      id,
      profileId,
      name,
      "birthday",
      1,
      1,
      null,
      new Date(clock).toISOString(),
      new Date(clock).toISOString(),
    );
  return id;
}

/** One tracked document, inserted through the raw schema: the card's own store is the only thing that can link to one. */
function createDocument(profileId: string, label: string): string {
  const id = uuidv7();
  const at = new Date(clock).toISOString();
  db.raw
    .prepare(
      `INSERT INTO tracked_documents
         (id, profile_id, doc_type, label, expiry_date, reminder_offsets, notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    )
    .run(id, profileId, "custom", label, "2030-01-31", "[]", at, at);
  return id;
}

/**
 * Drops a profile's card rows the way only an ARCHIVE can.
 *
 * A real archive is a snapshot of another machine, so its card id is one this
 * file does not hold - and `EmergencyCardStore.importData` refuses an id that
 * this file already carries under another profile, on purpose. A test of the
 * round trip has to say so rather than pretend the two profiles were ever in
 * two databases, because the refusal is part of what is being trusted here.
 */
function forgetCard(profileId: string): void {
  db.raw
    .prepare(
      `DELETE FROM emergency_contacts
        WHERE card_id IN (SELECT id FROM emergency_cards WHERE profile_id = ?)`,
    )
    .run(profileId);
  db.raw
    .prepare(
      `DELETE FROM emergency_documents
        WHERE card_id IN (SELECT id FROM emergency_cards WHERE profile_id = ?)`,
    )
    .run(profileId);
  db.raw.prepare("DELETE FROM emergency_cards WHERE profile_id = ?").run(profileId);
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

/** The card's whole field set, as the page sends it: every field present, `null` where nothing was answered. */
function fields(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    fullName: "Mila Petrović",
    dateOfBirth: "1988-04-12",
    bloodType: "A+",
    allergies: [{ label: "penicilin", severity: "anaphylaxis" }],
    conditions: null,
    medications: [{ name: "metformin", dose: "1 ujutru" }],
    organDonor: "yes",
    healthInsuranceNumber: "1234567890",
    doctorName: "dr Jovan Jović",
    doctorPhone: "+381 11 000 000",
    notes: "Nosim sobu za inhalaciju.",
    printLanguage: "both",
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-emergency-module-"));
  db = openDatabase({ path: join(dir, "emergency.db") });
  clock = Date.parse("2026-07-01T09:00:00.000Z");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the emergency handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const { host } = harness();
    expect(host.channels()).toEqual([
      "emergency:list",
      "emergency:createCard",
      "emergency:updateCard",
      "emergency:removeCard",
      "emergency:addContact",
      "emergency:updateContact",
      "emergency:removeContact",
      "emergency:moveContact",
      "emergency:printCard",
    ]);
  });

  it("answers a read with the card, its lists and the two libraries they point into", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const personId = createPerson(profileId, "Ana Petrović");

    const empty = await call<{ card: unknown; people: { id: string }[] }>(
      host,
      "emergency:list",
      { profileId },
    );
    expect(empty.card).toBeNull();
    // The libraries arrive with the view, so the page, the card it draws and the
    // sheet it prints all resolve a reference against the same two lists.
    expect(empty.people.map((person) => person.id)).toEqual([personId]);

    const view = await call<{ card: { fullName: string; allergies: unknown[] } }>(
      host,
      "emergency:createCard",
      { profileId, fields: fields() },
    );
    expect(view.card.fullName).toBe("Mila Petrović");
    expect(view.card.allergies).toEqual([{ label: "penicilin", severity: "anaphylaxis" }]);
  });

  it("keeps an answered-empty list apart from an unanswered one", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const answered = await call<{ card: { allergies: unknown } }>(host, "emergency:createCard", {
      profileId,
      fields: fields({ allergies: [] }),
    });
    expect(answered.card.allergies).toEqual([]);

    const unanswered = await call<{ card: { allergies: unknown } }>(host, "emergency:updateCard", {
      profileId,
      fields: fields({ allergies: null }),
    });
    expect(unanswered.card.allergies).toBeNull();
  });

  it("refuses a payload the wire should never carry, before the store sees it", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await call(host, "emergency:createCard", { profileId, fields: fields() });

    // A field that is not an id is refused as an id, not passed on.
    await expect(
      call(host, "emergency:removeContact", { profileId, id: "  padded  " }),
    ).rejects.toThrow(/not a well-formed id/);
    // A blood type that is not one of the nine answers.
    await expect(
      call(host, "emergency:updateCard", { profileId, fields: fields({ bloodType: "A+" }) }),
    ).resolves.toBeDefined();
    await expect(
      call(host, "emergency:updateCard", { profileId, fields: fields({ bloodType: "C" }) }),
    ).rejects.toThrow(/is not a blood type/);
    // An organ-donor answer that is neither.
    await expect(
      call(host, "emergency:updateCard", { profileId, fields: fields({ organDonor: "maybe" }) }),
    ).rejects.toThrow(/must be "yes" or "no"/);
    // A card language the column does not hold.
    await expect(
      call(host, "emergency:updateCard", { profileId, fields: fields({ printLanguage: "de" }) }),
    ).rejects.toThrow(/must be "sr", "en" or "both"/);
    // Text over the store's own cap, refused before the store trims anything.
    await expect(
      call(host, "emergency:updateCard", {
        profileId,
        fields: fields({ notes: "x".repeat(2_001) }),
      }),
    ).rejects.toThrow(/must not exceed 2000 characters/);
    // A list that is not a list, and a row of one that is not an allergy.
    await expect(
      call(host, "emergency:updateCard", { profileId, fields: fields({ allergies: "none" }) }),
    ).rejects.toThrow(/must be a list or null/);
    await expect(
      call(host, "emergency:updateCard", {
        profileId,
        fields: fields({ allergies: [{ label: "penicilin", severity: "deadly" }] }),
      }),
    ).rejects.toThrow(/is not a severity/);
    // The fields themselves, when they are not an object at all.
    await expect(call(host, "emergency:updateCard", { profileId, fields: [] })).rejects.toThrow(
      /expected an object/,
    );
  });
});

describe("the contacts and their order", () => {
  async function withContacts(
    host: ModuleHost,
    profileId: string,
  ): Promise<{ first: string; second: string }> {
    await call(host, "emergency:createCard", { profileId, fields: fields() });
    const first = await call<{ contacts: { id: string }[] }>(host, "emergency:addContact", {
      profileId,
      personId: null,
      name: "Ana",
      phone: "064 111",
      relation: "sestra",
    });
    const second = await call<{ contacts: { id: string }[] }>(host, "emergency:addContact", {
      profileId,
      personId: null,
      name: "Marko",
      phone: "064 222",
      relation: null,
    });
    return {
      first: first.contacts[0]?.id ?? "",
      second: second.contacts[1]?.id ?? "",
    };
  }

  it("appends contacts, moves one between its siblings, and removes it", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const { first, second } = await withContacts(host, profileId);
    expect(first).not.toBe("");
    expect(second).not.toBe("");

    // „Marko" moves up: the new order is Marko, Ana, so the pair a rank is
    // placed between is (nothing above, Ana below).
    const moved = await call<{ contacts: { name: string }[] }>(host, "emergency:moveContact", {
      profileId,
      id: second,
      beforeId: null,
      afterId: first,
    });
    expect(moved.contacts.map((contact) => contact.name)).toEqual(["Marko", "Ana"]);

    // A pair that does not describe a gap - the same row above and below - is the
    // store's own refusal, not a silent no-op.
    await expect(
      call(host, "emergency:moveContact", { profileId, id: second, beforeId: first, afterId: first }),
    ).rejects.toThrow(/do not describe a gap/);

    const after = await call<{ contacts: { name: string }[] }>(host, "emergency:removeContact", {
      profileId,
      id: first,
    });
    expect(after.contacts.map((contact) => contact.name)).toEqual(["Marko"]);
  });

  it("links a contact to a person of the address book, and refuses a person who is not one", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const personId = createPerson(profileId, "Ana Petrović");
    await call(host, "emergency:createCard", { profileId, fields: fields() });

    const linked = await call<{ contacts: { personId: string | null; name: string | null }[] }>(
      host,
      "emergency:addContact",
      { profileId, personId, name: null, phone: null, relation: null },
    );
    expect(linked.contacts[0]).toEqual(
      expect.objectContaining({ personId, name: null }),
    );

    await expect(
      call(host, "emergency:addContact", {
        profileId,
        personId: "no-such-person",
        name: null,
        phone: null,
        relation: null,
      }),
    ).rejects.toThrow(/names no live person/);
  });

  it("takes a card away and leaves it out of every read", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await withContacts(host, profileId);

    const view = await call<{ card: unknown; contacts: unknown[] }>(host, "emergency:removeCard", {
      profileId,
    });
    expect(view.card).toBeNull();
    // The contacts are read THROUGH the card, so a cleared card takes them out
    // of every read while keeping them for the restore.
    expect(view.contacts).toEqual([]);
  });
});

describe("the PDF main writes", () => {
  it("prints the card in both languages, with no path anywhere in the payload", async () => {
    const kit = harness();
    const profileId = createProfile();
    await call(kit.host, "emergency:createCard", { profileId, fields: fields() });

    const result = await call<{ saved: boolean; path?: string }>(kit.host, "emergency:printCard", {
      profileId,
      format: "a6",
    });

    expect(result).toEqual({ saved: true, path: "/tmp/hitna-karta.pdf" });
    expect(kit.prints).toHaveLength(1);
    const request = kit.prints[0];
    expect(request?.html).toContain("Mila Petrović");
    // Both passes, because the card's own `printLanguage` says so.
    expect(request?.html).toContain("Krvna grupa");
    expect(request?.html).toContain("Blood type");
    // The file the dialog opens on is a SUGGESTION built from the card's name;
    // the only path anything writes to is the one the dialog answers.
    expect(request?.defaultPath).toBe("hitna-karta-mila-petrovic.pdf");
    // A6, in the inches `printToPDF` measures paper in.
    expect(request?.pageSize).toEqual({ width: 4.1339, height: 5.8268 });
  });

  it("says nothing was saved when the user closes the dialog", async () => {
    const kit = harness();
    kit.answer = null;
    const profileId = createProfile();
    await call(kit.host, "emergency:createCard", { profileId, fields: fields() });

    const result = await call(kit.host, "emergency:printCard", { profileId, format: "card-a4" });

    expect(result).toEqual({ saved: false });
    // Still printed: the document is built before the dialog answers, and a
    // cancel is a fact about the file rather than about the card.
    expect(kit.prints).toHaveLength(1);
    expect(kit.prints[0]?.pageSize).toEqual({ width: 8.2677, height: 11.6929 });
  });

  it("refuses to print a card that does not exist, and a format it does not know", async () => {
    const kit = harness();
    const profileId = createProfile();

    await expect(
      call(kit.host, "emergency:printCard", { profileId, format: "a6" }),
    ).rejects.toThrow(/no emergency card to print/);
    await expect(
      call(kit.host, "emergency:printCard", { profileId, format: "a2" }),
    ).rejects.toThrow(/must be "a6" or "card-a4"/);
    expect(kit.prints).toHaveLength(0);
  });
});

describe("the card's archive section", () => {
  it("round-trips the card and its contacts between two profiles", async () => {
    const kit = harness();
    const source = createProfile();
    const target = createProfile();
    createPerson(source, "Ana Petrović");
    await call(kit.host, "emergency:createCard", { profileId: source, fields: fields() });
    await call(kit.host, "emergency:addContact", {
      profileId: source,
      personId: null,
      name: "Marko",
      phone: "064 222",
      relation: "brat",
    });

    const [section] = kit.host.collectExports([source]);
    expect(section?.moduleId).toBe("emergency");
    forgetCard(source);
    kit.host.applyImports([section!], [target]);

    const restored = await call<{
      card: { fullName: string; printLanguage: string };
      contacts: { name: string | null; personId: string | null; rank: string }[];
    }>(kit.host, "emergency:list", { profileId: target });
    expect(restored.card.fullName).toBe("Mila Petrović");
    expect(restored.card.printLanguage).toBe("both");
    expect(restored.contacts.map((contact) => contact.name)).toEqual(["Marko"]);
  });

  it("refuses a payload it does not understand, leaving the profile exactly as it found it", async () => {
    const kit = harness();
    const profileId = createProfile();
    await call(kit.host, "emergency:createCard", { profileId, fields: fields() });

    // Three shapes a later build (or a hand-edited archive) could produce: a
    // version this build does not know, a card that is not a whole card, and a
    // contact naming neither a person nor a name.
    for (const payload of [
      { version: 99, card: null, contacts: [], documents: [] },
      { version: 1, card: { id: "x" }, contacts: [], documents: [] },
      {
        version: 1,
        card: null,
        contacts: [
          {
            id: "c1",
            personId: null,
            name: null,
            phone: null,
            relation: null,
            rank: "i0",
            createdAt: "2026-07-01T09:00:00.000Z",
            updatedAt: "2026-07-01T09:00:00.000Z",
          },
        ],
        documents: [],
      },
    ]) {
      expect(() => kit.host.applyImports([{ moduleId: "emergency", payload }], [profileId])).toThrow();
      const after = await call<{ card: { fullName: string } | null }>(kit.host, "emergency:list", {
        profileId,
      });
      expect(after.card?.fullName).toBe("Mila Petrović");
    }
  });

  it("empties the card when the archive names no Emergency entry", async () => {
    const kit = harness();
    const profileId = createProfile();
    await call(kit.host, "emergency:createCard", { profileId, fields: fields() });

    // A restore replaces a profile whole, so a section that says nothing about
    // this module means EMPTY rather than "leave it alone".
    kit.host.applyImports([], [profileId]);

    const after = await call<{ card: unknown; contacts: unknown[] }>(kit.host, "emergency:list", {
      profileId,
    });
    expect(after.card).toBeNull();
    expect(after.contacts).toEqual([]);
  });

  it("carries a document reference, which no op creates but an archive can", async () => {
    const kit = harness();
    const source = createProfile();
    const target = createProfile();
    const documentId = createDocument(source, "Zdravstvena knjižica");
    await call(kit.host, "emergency:createCard", { profileId: source, fields: fields() });
    // Added through the store rather than through an op: a card built by the
    // page links no documents yet (see the module report), so this is the shape
    // an ARCHIVE writes - and the one the archive has to read back.
    new EmergencyCardStore(db.raw, source).addDocument(
      { documentId, mode: "number" },
      new Date(clock).toISOString(),
    );

    const [section] = kit.host.collectExports([source]);
    forgetCard(source);
    kit.host.applyImports([section!], [target]);

    const restored = await call<{ documents: { documentId: string; mode: string }[] }>(
      kit.host,
      "emergency:list",
      { profileId: target },
    );
    expect(restored.documents).toEqual([
      expect.objectContaining({ documentId, mode: "number" }),
    ]);
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    const kit = harness();
    expect(kit.host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});
