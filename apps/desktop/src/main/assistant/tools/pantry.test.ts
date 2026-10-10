import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NexusDatabase, PantryStore, openDatabase, uuidv7 } from "@nexus/db";
import type { ConfirmRequest, Tool, ToolContext } from "@nexus/core";
import { pantryTools } from "./pantry.js";

/**
 * The PANTRY tools over a real database.
 *
 * The verdicts are `@nexus/core`'s `stockStatus` and nothing else, so what this
 * suite pins is which items it is asked about, what the line says, and that the
 * window the answer used is the one the profile holds unless the model named
 * another — a "what expires soon" that quietly used its own idea of "soon" would
 * be the whole feature failing.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-pantry-"));
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

function store(): PantryStore {
  return new PantryStore(db.raw, profileId);
}

function tools(): readonly Tool[] {
  return pantryTools({ profileDb: (id, open) => open(db.raw, id), now: () => NOW_MS });
}

function toolOf(name: string): Tool {
  const found = tools().find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

function contextFor(locale: "sr" | "en", allow: boolean): {
  readonly context: ToolContext;
  readonly confirms: ConfirmRequest[];
} {
  const confirms: ConfirmRequest[] = [];
  return {
    confirms,
    context: {
      profileId,
      locale,
      signal: new AbortController().signal,
      confirm: (request) => {
        confirms.push(request);
        return Promise.resolve(allow);
      },
    },
  };
}

describe("pantry.expiring", () => {
  it("names the items whose expiry is near, most urgent first, with where they sit", async () => {
    const fridge = store().createLocation({ name: "Frižider" }, NOW_ISO);
    store().createItem(
      {
        name: "Mleko",
        category: "food",
        quantity: 1,
        unit: "l",
        locationId: fridge.id,
        expiryDate: "2026-10-12",
      },
      NOW_ISO,
    );
    store().createItem(
      { name: "Jogurt", category: "food", quantity: 2, unit: "pcs", expiryDate: "2026-10-08" },
      NOW_ISO,
    );
    // Far past the window, so it is not this list's business.
    store().createItem(
      { name: "Brašno", category: "food", quantity: 1, unit: "kg", expiryDate: "2027-03-01" },
      NOW_ISO,
    );

    const result = await toolOf("pantry.expiring").run({ days: 7 }, contextFor("sr", true).context);
    expect(result).toEqual({
      ok: true,
      content: [
        "Ističe (2):",
        "U narednih 7 dana.",
        "- Jogurt: 2 kom, isteklo pre 2 dana",
        "- Mleko: 1 l, u „Frižider“, ističe za 2 dana",
      ].join("\n"),
    });
  });

  it("uses the profile's own window when the model named none", async () => {
    store().setExpiryWindow(3, NOW_ISO);
    store().createItem(
      { name: "Sir", category: "food", quantity: 1, unit: "kg", expiryDate: "2026-10-15" },
      NOW_ISO,
    );

    const within = await toolOf("pantry.expiring").run(
      { days: 5 },
      contextFor("en", true).context,
    );
    expect(within).toEqual({
      ok: true,
      content: ["Expiring (1):", "Within the next 5 days.", "- Sir: 1 kg, expires in 5 days"].join(
        "\n",
      ),
    });

    const result = await toolOf("pantry.expiring").run({}, contextFor("en", true).context);
    expect(result).toEqual({
      ok: true,
      content: "Nothing expires within the next 3 days.",
    });
  });

  it("says nothing is expiring rather than answering with the whole pantry", async () => {
    store().createItem({ name: "So", category: "food", quantity: 1, unit: "kg" }, NOW_ISO);
    const result = await toolOf("pantry.expiring").run({ days: 0 }, contextFor("sr", true).context);
    expect(result).toEqual({
      ok: true,
      content: "Ništa ne ističe u narednih 0 dana.",
    });
  });
});

describe("pantry.add", () => {
  it("asks, then writes the item with the shelf the user named", async () => {
    const fridge = store().createLocation({ name: "Frižider" }, NOW_ISO);
    const recorder = contextFor("sr", true);
    const result = await toolOf("pantry.add").run(
      { name: "Mleko", quantity: 1, unit: "l", expiry: "2026-10-12", location: "frizider" },
      recorder.context,
    );

    expect(recorder.confirms).toEqual([
      { tool: "pantry.add", summary: "Dodaj „Mleko“ u ostavu, 1 l (Hrana)", effect: "write" },
    ]);
    const rows = store().listItems();
    expect(rows).toHaveLength(1);
    const created = rows[0];
    if (created === undefined) throw new Error("no item was written");
    expect(created).toMatchObject({
      name: "Mleko",
      category: "food",
      quantity: 1,
      unit: "l",
      locationId: fridge.id,
      expiryDate: "2026-10-12",
      archivedAt: null,
    });
    expect(result).toEqual({
      ok: true,
      content: `Dodato u ostavu: „Mleko“ (${created.id}).`,
      navigateTo: { module: "pantry" },
    });
  });

  it("refuses a shelf the pantry does not have, naming the ones it does", async () => {
    store().createLocation({ name: "Frižider" }, NOW_ISO);
    const result = await toolOf("pantry.add").run(
      { name: "Mleko", quantity: 1, unit: "l", location: "Podrum" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toBe(
      "Failed: No place “Podrum” in the pantry. The places that exist: Frižider.",
    );
    expect(store().listItems()).toEqual([]);
  });

  it("writes nothing when the user declines", async () => {
    const result = await toolOf("pantry.add").run(
      { name: "Mleko", quantity: 1, unit: "l" },
      contextFor("en", false).context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(store().listItems()).toEqual([]);
  });

  it("refuses a quantity no pantry row may carry", async () => {
    const result = await toolOf("pantry.add").run(
      { name: "Mleko", quantity: 1_000_001, unit: "l" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toBe(
      'Failed: "quantity" must be a number between 0 and 1000000.',
    );
  });
});
