import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CultureStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import type { ConfirmRequest, Tool, ToolContext } from "@nexus/core";
import { cultureTools } from "./culture.js";

/**
 * The CULTURE tools over a real database: the programme, and writing a plan onto
 * it. A plan is a thing still ahead, so what this suite pins is the split — what
 * is ahead in the order it happens, and the past plans that are still waiting
 * for an answer.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-culture-"));
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

function store(): CultureStore {
  return new CultureStore(db.raw, profileId);
}

function tools(): readonly Tool[] {
  return cultureTools({ profileDb: (id, open) => open(db.raw, id), now: () => NOW_MS });
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

describe("culture.programme", () => {
  it("reads what is ahead, in the order it happens, with the place", async () => {
    store().createPlan(
      {
        kind: "theatre",
        title: "Hamlet",
        venue: "Narodno pozorište",
        city: "Beograd",
        date: "2026-11-05",
        startTime: "20:00",
      },
      NOW_ISO,
    );
    store().createPlan(
      { kind: "concert", title: "Koncert", venue: "Sava Centar", date: "2026-10-20" },
      NOW_ISO,
    );

    const result = await toolOf("culture.programme").run({}, contextFor("sr", true).context);
    expect(result).toEqual({
      ok: true,
      content: [
        "Predstoji (2):",
        "- 20. oktobar 2026: Koncert „Koncert“, Sava Centar",
        "- 5. novembar 2026, 20:00: Pozorište „Hamlet“, Narodno pozorište, Beograd",
      ].join("\n"),
    });
  });

  it("keeps the past and the ahead apart, and says which of the two is empty", async () => {
    store().createPlan(
      { kind: "cinema", title: "Film", venue: "Dvorana", date: "2026-09-01" },
      NOW_ISO,
    );
    const past = await toolOf("culture.programme").run(
      { when: "past" },
      contextFor("en", true).context,
    );
    expect(past).toEqual({
      ok: true,
      content: ["Past plans with no answer (1):", "- 1 September 2026: Cinema “Film”, Dvorana"].join(
        "\n",
      ),
    });

    const ahead = await toolOf("culture.programme").run(
      { when: "ahead" },
      contextFor("en", true).context,
    );
    expect(ahead).toEqual({ ok: true, content: "Nothing is on the programme ahead." });
  });
});

describe("culture.plan", () => {
  it("asks, then writes the plan", async () => {
    const recorder = contextFor("en", true);
    const result = await toolOf("culture.plan").run(
      { title: "Hamlet", kind: "theatre", venue: "Narodno pozorište", date: "2026-11-05" },
      recorder.context,
    );
    expect(recorder.confirms).toEqual([
      {
        tool: "culture.plan",
        summary: "Write the plan “Hamlet” (Theatre) for 5 November 2026",
        effect: "write",
      },
    ]);
    const rows = store().listPlans();
    expect(rows).toHaveLength(1);
    const created = rows[0];
    if (created === undefined) throw new Error("no plan was written");
    expect(created).toMatchObject({
      kind: "theatre",
      title: "Hamlet",
      venue: "Narodno pozorište",
      date: "2026-11-05",
      visitId: null,
    });
    expect(result).toEqual({
      ok: true,
      content: `The plan is written: “Hamlet” (${created.id}).`,
      navigateTo: { module: "culture" },
    });
  });

  it("writes nothing when the user declines, and refuses a link that is not a web page", async () => {
    const declined = await toolOf("culture.plan").run(
      { title: "Hamlet", kind: "theatre", venue: "Narodno pozorište", date: "2026-11-05" },
      contextFor("en", false).context,
    );
    expect(declined).toEqual({ ok: false, content: "The user declined." });
    expect(store().listPlans()).toEqual([]);

    const badLink = await toolOf("culture.plan").run(
      {
        title: "Hamlet",
        kind: "theatre",
        venue: "Narodno pozorište",
        date: "2026-11-05",
        link: "narodnopozoriste.rs/hamlet",
      },
      contextFor("en", true).context,
    );
    expect(badLink).toEqual({
      ok: false,
      content: "Failed: A link must start with http:// or https://.",
    });
    expect(store().listPlans()).toEqual([]);
  });
});
