import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { emptyCalculatorSession, type CalculatorSession } from "@nexus/core";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { register } from "./register.js";

/**
 * The CALCULATOR module through the kit (ADR-090): its ops, the refusals, the
 * session it stores on a commit, and its archive section.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * refusals, the sender check and the channel allowlist are all the host's. Going
 * through `dispatch` therefore tests what actually runs in the app - a typo in an
 * op name or a payload the validators refuse is a rejected promise here, not a
 * surprise on the first click.
 *
 * The ENGINE is not here, deliberately: it runs in the renderer's worker, so what
 * these cases hand `commit` is the pair of strings and the session an evaluation
 * produced. `renderer/engineClient.test.ts` is where the worker is exercised, and
 * `packages/core/src/calculator/` is where the arithmetic is.
 */

const TRUSTED = { trusted: true };
const NOW = "2026-06-01T08:00:00.000Z";

let dir: string;
let db: NexusDatabase;

function harness(): ModuleHost {
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => db.raw,
    notify: () => undefined,
    schedule: () => () => undefined,
    now: () => Date.parse(NOW),
  };
  const host = new ModuleHost(platform);
  register(host);
  return host;
}

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

/** The session `2 + 2` leaves behind: what the worker would have answered, hand-written. */
const COMMITTED: CalculatorSession = {
  version: 1,
  variables: {},
  functions: { f: { params: ["x"], body: "x ^ 2 + 1" } },
  ans: "4",
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-calculator-module-"));
  db = openDatabase({ path: join(dir, "calculator.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the calculator handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    expect(harness().channels()).toEqual([
      "calculator:list",
      "calculator:commit",
      "calculator:setPinned",
      "calculator:removeEntry",
      "calculator:clearHistory",
      "calculator:clearSession",
      "calculator:setAngleMode",
      "calculator:setPrecision",
    ]);
  });

  it("answers an empty read with the engine's defaults, an empty session and one page of history", async () => {
    const host = harness();
    const profileId = createProfile();

    const view = await call<{
      history: unknown[];
      session: CalculatorSession;
      sessionReadable: boolean;
      settings: { angleMode: string; precision: string };
    }>(host, "calculator:list", { profileId });

    expect(view.history).toEqual([]);
    expect(view.session).toEqual(emptyCalculatorSession());
    expect(view.sessionReadable).toBe(true);
    expect(view.settings).toEqual({ angleMode: "deg", precision: "float" });
  });

  it("stores a committed expression with both forms of its result, and the session beside it", async () => {
    const host = harness();
    const profileId = createProfile();

    const view = await call<{
      history: { expression: string; result: string; value: string; pinned: boolean }[];
      session: CalculatorSession;
    }>(host, "calculator:commit", {
      profileId,
      expression: "2 + 2",
      result: "4",
      value: "4",
      session: COMMITTED,
    });

    expect(view.history).toHaveLength(1);
    expect(view.history[0]).toMatchObject({
      expression: "2 + 2",
      result: "4",
      value: "4",
      pinned: false,
    });
    expect(view.session).toEqual(COMMITTED);
    // The row and the session are the same act, so a second read sees both.
    const reread = await call<{ session: CalculatorSession }>(host, "calculator:list", { profileId });
    expect(reread.session).toEqual(COMMITTED);
  });

  it("refuses a payload the wire should never carry, before the store sees it", async () => {
    const host = harness();
    const profileId = createProfile();

    await expect(
      call(host, "calculator:commit", {
        profileId,
        expression: "",
        result: "4",
        value: "4",
        session: COMMITTED,
      }),
    ).rejects.toThrow(/must be a non-empty string/);
    await expect(
      call(host, "calculator:commit", {
        profileId,
        expression: "1".repeat(1001),
        result: "4",
        value: "4",
        session: COMMITTED,
      }),
    ).rejects.toThrow(/must not exceed 1000 characters/);
    // The session is the field the store must never be handed unchecked: it is
    // JSON the RENDERER produced, and core's reader is what judges it.
    await expect(
      call(host, "calculator:commit", {
        profileId,
        expression: "2 + 2",
        result: "4",
        value: "4",
        session: { version: 9 },
      }),
    ).rejects.toThrow(/must be a version-1 object/);
    await expect(
      call(host, "calculator:setAngleMode", { profileId, angleMode: "turn" }),
    ).rejects.toThrow(/must be one of deg, rad, grad/);
    await expect(
      call(host, "calculator:setPrecision", { profileId, precision: "double" }),
    ).rejects.toThrow(/must be one of float, bignumber/);
    // And a field that is not an id at all is refused as an id, not passed on.
    await expect(
      call(host, "calculator:removeEntry", { profileId, id: "  padded  " }),
    ).rejects.toThrow(/not a well-formed id/);
  });

  it("pins, removes and clears rows, and scopes every statement to its own profile", async () => {
    const host = harness();
    const mine = createProfile();
    const theirs = createProfile();

    const first = await call<{ history: { id: string }[] }>(host, "calculator:commit", {
      profileId: mine,
      expression: "1 + 1",
      result: "2",
      value: "2",
      session: emptyCalculatorSession(),
    });
    const id = first.history[0]?.id ?? "";
    expect(id).not.toBe("");

    const pinned = await call<{ history: { id: string; pinned: boolean }[] }>(
      host,
      "calculator:setPinned",
      { profileId: mine, id, pinned: true },
    );
    expect(pinned.history[0]?.pinned).toBe(true);

    const cleared = await call<{ history: { id: string }[] }>(host, "calculator:clearHistory", {
      profileId: mine,
      keepPinned: true,
    });
    expect(cleared.history.map((entry) => entry.id)).toEqual([id]);

    const removed = await call<{ history: unknown[] }>(host, "calculator:removeEntry", {
      profileId: mine,
      id,
    });
    expect(removed.history).toEqual([]);

    const other = await call<{ history: unknown[] }>(host, "calculator:list", {
      profileId: theirs,
    });
    expect(other.history).toEqual([]);
  });

  it("forgets the session, and says so when the stored one cannot be read", async () => {
    const host = harness();
    const profileId = createProfile();
    await call(host, "calculator:commit", {
      profileId,
      expression: "x = 5",
      result: "5",
      value: "5",
      session: { version: 1, variables: { x: "5" }, functions: {}, ans: "5" },
    });

    const forgotten = await call<{ session: CalculatorSession; history: unknown[] }>(
      host,
      "calculator:clearSession",
      { profileId },
    );
    expect(forgotten.session).toEqual(emptyCalculatorSession());
    // The history is NOT the session: forgetting the variables is not an erasure of
    // what was computed.
    expect(forgotten.history).toHaveLength(1);

    // A column that no longer parses is reported rather than read as empty, and a
    // read still answers - the page can then offer the way out.
    db.raw
      .prepare("INSERT INTO calc_sessions (profile_id, session, updated_at) VALUES (?, ?, ?)")
      .run(profileId, "{not json", NOW);
    const broken = await call<{ session: CalculatorSession; sessionReadable: boolean }>(
      host,
      "calculator:list",
      { profileId },
    );
    expect(broken.sessionReadable).toBe(false);
    expect(broken.session).toEqual(emptyCalculatorSession());
  });

  it("changes one preference at a time, keeping the other as it was", async () => {
    const host = harness();
    const profileId = createProfile();

    const radians = await call<{ settings: { angleMode: string; precision: string } }>(
      host,
      "calculator:setAngleMode",
      { profileId, angleMode: "rad" },
    );
    expect(radians.settings).toEqual({ angleMode: "rad", precision: "float" });

    const exact = await call<{ settings: { angleMode: string; precision: string } }>(
      host,
      "calculator:setPrecision",
      { profileId, precision: "bignumber" },
    );
    expect(exact.settings).toEqual({ angleMode: "rad", precision: "bignumber" });
  });
});

describe("the calculator archive section", () => {
  it("round-trips the history, the session and the preferences between two profiles", async () => {
    const host = harness();
    const source = createProfile();
    const target = createProfile();
    await call(host, "calculator:commit", {
      profileId: source,
      expression: "5 km to mi",
      result: "3,10685596118667 mi",
      value: "3.1068559611866697 mi",
      session: COMMITTED,
    });
    await call(host, "calculator:setAngleMode", { profileId: source, angleMode: "grad" });

    const [section] = host.collectExports([source]);
    expect(section?.moduleId).toBe("calculator");
    host.applyImports([section!], [target]);

    const restored = await call<{
      history: { expression: string; result: string; value: string }[];
      session: CalculatorSession;
      settings: { angleMode: string; precision: string };
    }>(host, "calculator:list", { profileId: target });
    expect(restored.history).toEqual([
      expect.objectContaining({
        expression: "5 km to mi",
        result: "3,10685596118667 mi",
        value: "3.1068559611866697 mi",
      }),
    ]);
    expect(restored.session).toEqual(COMMITTED);
    expect(restored.settings).toEqual({ angleMode: "grad", precision: "float" });
  });

  it("refuses a payload it does not understand, leaving the profile exactly as it found it", async () => {
    const host = harness();
    const profileId = createProfile();
    await call(host, "calculator:commit", {
      profileId,
      expression: "1 + 1",
      result: "2",
      value: "2",
      session: emptyCalculatorSession(),
    });

    const good = {
      version: 1,
      history: [],
      session: emptyCalculatorSession(),
      settings: { angleMode: "deg", precision: "float" },
    };
    const bad = [
      { ...good, version: 99 },
      { ...good, history: "none" },
      // A row whose `value` is missing: the column the `#3` reuse reads.
      {
        ...good,
        history: [
          {
            expression: "1",
            result: "1",
            pinned: false,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      },
      { ...good, settings: { angleMode: "turn", precision: "float" } },
      { ...good, session: { version: 1, variables: { x: 5 } } },
    ];
    for (const payload of bad) {
      expect(() => host.applyImports([{ moduleId: "calculator", payload }], [profileId])).toThrow();
      const after = await call<{ history: { expression: string }[] }>(host, "calculator:list", {
        profileId,
      });
      expect(after.history.map((entry) => entry.expression)).toEqual(["1 + 1"]);
    }
  });

  it("empties the archived state when the section names no calculator entry", async () => {
    const host = harness();
    const profileId = createProfile();
    await call(host, "calculator:commit", {
      profileId,
      expression: "1 + 1",
      result: "2",
      value: "2",
      session: COMMITTED,
    });
    await call(host, "calculator:setAngleMode", { profileId, angleMode: "rad" });

    // An archive with no calculator entry is what a restore of an older archive
    // hands over, and a restore replaces the profile whole.
    host.applyImports([], [profileId]);

    const after = await call<{
      history: unknown[];
      session: CalculatorSession;
      settings: { angleMode: string };
    }>(host, "calculator:list", { profileId });
    expect(after.history).toEqual([]);
    expect(after.session).toEqual(emptyCalculatorSession());
    expect(after.settings).toEqual({ angleMode: "deg", precision: "float" });
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    const host = harness();
    expect(host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});
