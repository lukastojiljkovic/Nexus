import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExportModuleData } from "@nexus/core";
import { openDatabase, type NexusDatabase } from "@nexus/db";
import {
  ModuleHost,
  ModuleImportError,
  type ModuleBlobSource,
  type ModulePlatform,
} from "./moduleIpc.js";
import { defineModuleContract } from "../shared/moduleApi.js";

/**
 * The module kit's main half (ADR-090), against the real host.
 *
 * What is pinned here is everything the kit PROMISES rather than everything a
 * module happens to do: the three refusals (an undeclared op, a channel outside
 * the module's own prefix, a message from an untrusted sender), the channel set
 * a build answers on, what a handler is handed, the armed-timer lifecycle the
 * host owns, and the archive section's rule that a refusal - at the preview, or
 * by one module in the middle of an apply - leaves the profile as it found it.
 * The platform is a double because `electron` cannot run under Vitest — that
 * split is the whole reason `moduleIpc.ts` has no `electron` import — and it also
 * makes the clock something a test can move instead of wait for.
 */

/** The one event value the double's sender check accepts, so "untrusted" is a value rather than a mock's mood. */
const TRUSTED = { trusted: true };

/**
 * The database the platform hands out, opened the way every other main-process
 * and db test opens one. In memory, and shared by the tests in one `it` only:
 * what these tests assert about it is that a refused section leaves it exactly
 * as it was, which needs a real handle and a real rollback rather than a mock.
 */
let db: NexusDatabase;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
});

afterEach(() => {
  db.close();
});

interface Harness {
  readonly platform: ModulePlatform;
  readonly toasts: { title: string; body: string; silent: boolean }[];
  /** Every timer the host armed, in order — the fake scheduler, with the clock the test owns. */
  readonly timers: { atMs: number; run: () => void; cancelled: boolean }[];
  setNow(value: number): void;
  now(): number;
}

function harness(): Harness {
  const toasts: Harness["toasts"] = [];
  const timers: Harness["timers"] = [];
  let clock = 1_000;
  const platform: ModulePlatform = {
    // The real check refuses a frame this app did not serve (SEC-EL-02); the
    // double refuses every event but one, which is the same rule with a name.
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    // Handed straight through to `call.profileDb`'s opener and to the archive
    // section's transaction, so both run against a real connection.
    database: () => db.raw,
    // The kit's attach path needs a window, blob keys and a dialog, none of
    // which exist under Vitest — so this double answers a cancelled pick and a
    // no-op release. What the path DOES is not this file's subject: it is
    // `moduleAttachments.ts`, exercised by the CAR module's own register test.
    attachFiles: async () => ({ canceled: true }),
    releaseBlob: async () => undefined,
    notify: (copy) => toasts.push(copy),
    schedule: (atMs, run) => {
      const entry = { atMs, run, cancelled: false };
      timers.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    now: () => clock,
  };
  return {
    platform,
    toasts,
    timers,
    setNow: (value) => {
      clock = value;
    },
    now: () => clock,
  };
}

/** One two-op contract, so a test can talk about a module without a module existing. */
type SampleOps = {
  ping: { request: { who: string }; response: { pong: boolean } };
  echo: { request: { text: string }; response: string };
};
const contract = defineModuleContract<"sample", SampleOps>("sample", ["ping", "echo"]);

/** Registers a do-nothing handler for every op the contract declares — what a module's own `register` does, and what actually installs a channel. */
function handleAll(ctx: { handle: (op: never, handler: never) => void }): void {
  for (const op of contract.ops) {
    ctx.handle(op as never, ((payload: unknown) => payload) as never);
  }
}

describe("ModuleHost.adopt", () => {
  it("answers every channel the contract declares, and nothing else", () => {
    const host = new ModuleHost(harness().platform);
    handleAll(host.adopt(contract));

    expect(host.channels()).toEqual(["sample:ping", "sample:echo"]);
    return expect(host.dispatch("sample:nope", TRUSTED, {})).rejects.toThrow(
      /No module answers channel/,
    );
  });

  it("refuses a contract that claims a channel outside the module's own prefix", () => {
    const host = new ModuleHost(harness().platform);
    const foreign = defineModuleContract<"sample", SampleOps>("sample", ["ping", "echo"]);
    // Hand-built rather than declared, because `defineModuleContract` cannot
    // produce one: this is the shape a module would have to fake to answer for
    // another module, which is exactly what the refusal is for.
    const smuggled = {
      id: foreign.id,
      ops: ["ping"] as const,
      channels: { ping: "other:ping" },
    };

    expect(() => host.adopt(smuggled as never)).toThrow(/not under its own "sample:" prefix/);
    expect(host.channels()).toEqual([]);
  });

  it("refuses a channel another module already answers", () => {
    const host = new ModuleHost(harness().platform);
    handleAll(host.adopt(contract));

    // A second module claiming the same channel is refused when it is ADOPTED,
    // which is before any of its handlers are installed — so a build cannot end
    // up with one `ipcMain.handle` per module on the same channel, the second
    // silently replacing the first.
    expect(() => host.adopt(contract)).toThrow(/already handled by another module/);
  });

  it("refuses an op its contract does not declare, at registration", () => {
    const host = new ModuleHost(harness().platform);
    const ctx = host.adopt(contract);
    handleAll(ctx);

    expect(() => ctx.handle("nope" as never, (() => undefined) as never)).toThrow(
      /has no declared op "nope"/,
    );
    // The refusal happened BEFORE the channel was installed, so the module's own
    // two ops are what it answers and nothing else.
    expect(host.channels()).toEqual(["sample:ping", "sample:echo"]);
  });

  it("refuses an untrusted sender before the handler runs", async () => {
    const host = new ModuleHost(harness().platform);
    const ctx = host.adopt(contract);
    let ran = 0;
    ctx.handle("ping", () => {
      ran += 1;
      return { pong: true };
    });

    await expect(host.dispatch("sample:ping", { untrusted: true }, {})).rejects.toThrow(
      /did not come from this app/,
    );
    expect(ran).toBe(0);
    await expect(host.dispatch("sample:ping", TRUSTED, {})).resolves.toEqual({ pong: true });
    expect(ran).toBe(1);
  });

  it("hands a handler the shared validators, the profile's database and the clock", async () => {
    const kit = harness();
    const host = new ModuleHost(kit.platform);
    const ctx = host.adopt(contract);
    const opened: string[] = [];
    ctx.handle("echo", (payload, call) => {
      const record = call.as.asRecord(payload);
      opened.push(call.as.asId(record.text, "id"));
      const table = call.profileDb("profile-1", (db, profileId) => {
        opened.push(profileId);
        return db;
      });
      return `${String(table !== null)}:${String(call.now())}`;
    });

    await expect(
      host.dispatch("sample:echo", TRUSTED, { text: "profile-1" }),
    ).resolves.toBe("true:1000");
    expect(opened).toEqual(["profile-1", "profile-1"]);
  });
});

describe("ModuleHost's armed timers", () => {
  it("re-arms in bounded hops, so a machine that slept through the moment still fires", () => {
    const kit = harness();
    const host = new ModuleHost(kit.platform);
    const ctx = host.adopt(contract);
    let fired = 0;
    // An instant a long way off: the host must not hand the platform one
    // enormous delay, or a suspended machine would never wake the timer.
    ctx.armUntil(10_000_000, () => {
      fired += 1;
    });

    expect(kit.timers).toHaveLength(1);
    expect(kit.timers[0]?.atMs).toBe(31_000);
    // Drive the hops forward until the instant is behind the clock.
    for (let hop = 0; hop < 400 && fired === 0; hop += 1) {
      const entry = kit.timers[kit.timers.length - 1];
      if (entry === undefined) break;
      kit.setNow(entry.atMs);
      entry.run();
    }
    expect(fired).toBe(1);
  });

  it("fires at once for an instant that has already passed", () => {
    const kit = harness();
    const host = new ModuleHost(kit.platform);
    const ctx = host.adopt(contract);
    let fired = 0;
    ctx.armUntil(kit.now() - 60_000, () => {
      fired += 1;
    });

    expect(fired).toBe(1);
    expect(kit.timers).toEqual([]);
  });

  it("cancels every armed timer when the session ends", () => {
    const kit = harness();
    const host = new ModuleHost(kit.platform);
    const ctx = host.adopt(contract);
    let fired = 0;
    ctx.armUntil(kit.now() + 5_000, () => {
      fired += 1;
    });

    host.sessionEnd();

    expect(kit.timers.every((timer) => timer.cancelled)).toBe(true);
    kit.setNow(kit.now() + 60_000);
    expect(fired).toBe(0);
  });
});

describe("ModuleHost's archive section", () => {
  const section: readonly ExportModuleData[] = [{ moduleId: "sample", payload: { any: "thing" } }];

  function withExporting() {
    const kit = harness();
    const host = new ModuleHost(kit.platform);
    const ctx = host.adopt(contract);
    return { kit, host, ctx };
  }

  /** A SECOND module, so a section can name two and the all-or-nothing rule has two things to be all-or-nothing about. */
  const otherContract = defineModuleContract<"other", SampleOps>("other", ["ping", "echo"]);

  /** The error a call refuses with, so a test can assert the CODE beside the sentence `restore.ts` maps onto the wire. */
  function refusalOf(run: () => void): ModuleImportError {
    try {
      run();
    } catch (error) {
      if (error instanceof ModuleImportError) return error;
      throw error;
    }
    throw new Error("Test setup: the call was expected to refuse.");
  }

  it("omits a module that has nothing to say, rather than writing undefined", () => {
    const { host, ctx } = withExporting();
    ctx.exportData(() => undefined);

    expect(host.collectExports(["profile-1"])).toEqual([]);
  });

  it("names the module a section belongs to, with the profile the session opened", () => {
    const { host, ctx } = withExporting();
    const seen: string[] = [];
    ctx.exportData((session) => {
      seen.push(...session.profileIds);
      return { presets: [] };
    });

    expect(host.collectExports(["profile-9"])).toEqual([
      { moduleId: "sample", payload: { presets: [] } },
    ]);
    expect(seen).toEqual(["profile-9"]);
  });

  it("refuses a section naming a module this build does not know, and says which", () => {
    const { host } = withExporting();

    expect(() => host.assertImportable([{ moduleId: "ghost", payload: null }])).toThrow(
      /module "ghost", which this build does not know/,
    );
  });

  it("refuses a payload a module will not take, naming the module and the reason", () => {
    const { host, ctx } = withExporting();
    ctx.importData({
      parse: (value) => {
        if (value === "bad") throw new Error("sample data: not a payload this module knows.");
        return value;
      },
      apply: () => undefined,
    });

    const refused = refusalOf(() =>
      host.assertImportable([{ moduleId: "sample", payload: "bad" }]),
    );

    // The code is what `restore.ts` turns into its `invalid-module-data` problem,
    // and the module's own sentence rides inside the message: "which module
    // refused, and why" is what a reader can act on.
    expect(refused.code).toBe("invalid-module-data");
    expect(refused.message).toMatch(/module "sample"/);
    expect(refused.message).toMatch(/not a payload this module knows/);
    // A module id this build did not adopt keeps its own code.
    expect(refusalOf(() => host.assertImportable([{ moduleId: "ghost", payload: null }])).code).toBe(
      "unknown-module",
    );
  });

  it("writes nothing when it refuses a section, previewed or applied", () => {
    const { host, ctx } = withExporting();
    // A table this test owns, so "wrote nothing" is a row count rather than a
    // claim: the module's `apply` below is what would put a row in it.
    db.raw.exec("CREATE TABLE kit_probe (id TEXT PRIMARY KEY)");
    ctx.importData({
      parse: (value) => value,
      apply: (_parsed, session) => {
        for (const profileId of session.profileIds) {
          session.profileDb(profileId, (handle) => {
            handle.prepare("INSERT INTO kit_probe (id) VALUES (?)").run(profileId);
          });
        }
      },
    });

    expect(() => host.assertImportable([{ moduleId: "sample", payload: 1 }])).not.toThrow();
    expect(() =>
      host.applyImports(
        [{ moduleId: "sample", payload: 1 }, { moduleId: "ghost", payload: 2 }],
        ["profile-1"],
      ),
    ).toThrow(/module "ghost"/);

    expect(db.raw.prepare("SELECT id FROM kit_probe").all()).toEqual([]);
  });

  it("parses every payload before it applies any of them", () => {
    const kit = harness();
    const host = new ModuleHost(kit.platform);
    const first = host.adopt(contract);
    const second = host.adopt(otherContract);
    let applied = 0;
    first.importData({
      parse: (value) => value,
      apply: () => {
        applied += 1;
      },
    });
    second.importData({
      parse: () => {
        throw new Error("other data: a payload this module will not take.");
      },
      apply: () => {
        applied += 1;
      },
    });

    expect(() =>
      host.applyImports(
        [
          { moduleId: "sample", payload: 1 },
          { moduleId: "other", payload: 2 },
        ],
        ["profile-1"],
      ),
    ).toThrow(/module "other"/);

    // The first module's payload was fine and its `apply` still did not run: a
    // section is read whole before any of it is written.
    expect(applied).toBe(0);
  });

  it("rolls back every module's writes when a later one refuses", () => {
    const kit = harness();
    const host = new ModuleHost(kit.platform);
    const first = host.adopt(contract);
    const second = host.adopt(otherContract);
    db.raw.exec("CREATE TABLE kit_probe (id TEXT PRIMARY KEY)");
    first.importData({
      parse: (value) => value,
      apply: (_parsed, session) => {
        for (const profileId of session.profileIds) {
          session.profileDb(profileId, (handle) => {
            // Through the handle's own transaction, exactly as a store writes:
            // nested inside the kit's, it becomes a savepoint.
            handle
              .transaction(() => {
                handle.prepare("INSERT INTO kit_probe (id) VALUES (?)").run(profileId);
              })();
          });
        }
      },
    });
    second.importData({
      parse: (value) => value,
      apply: () => {
        throw new Error("other data: refused after the first module wrote.");
      },
    });

    expect(() => host.applyImports([{ moduleId: "sample", payload: 1 }], ["profile-1"])).toThrow(
      /refused after the first module wrote/,
    );

    // One transaction covers every module, so the row the first one wrote is gone.
    expect(db.raw.prepare("SELECT id FROM kit_probe").all()).toEqual([]);
  });

  it("applies every adopted module, the one the section omits with no payload at all", () => {
    const kit = harness();
    const host = new ModuleHost(kit.platform);
    const first = host.adopt(contract);
    const second = host.adopt(otherContract);
    const seen: unknown[] = [];
    first.importData({
      parse: (value) => value,
      apply: (parsed) => {
        seen.push(parsed);
      },
    });
    second.importData({
      parse: (value) => value,
      apply: (parsed) => {
        seen.push(parsed === undefined ? "absent" : parsed);
      },
    });

    host.applyImports(section, ["profile-1"]);

    expect(seen).toEqual([{ any: "thing" }, "absent"]);
  });

  it("refuses every entry before running a single importer", () => {
    const { host, ctx } = withExporting();
    let imported = 0;
    ctx.importData({
      parse: (value) => value,
      apply: () => {
        imported += 1;
      },
    });

    expect(() =>
      host.applyImports(
        [{ moduleId: "sample", payload: 1 }, { moduleId: "ghost", payload: 2 }],
        ["profile-1"],
      ),
    ).toThrow(/module "ghost"/);
    expect(imported).toBe(0);
  });

  it("applies a known section to every profile the session names", () => {
    const { host, ctx } = withExporting();
    const applied: { profileId: string; payload: unknown }[] = [];
    ctx.importData({
      parse: (value) => value,
      apply: (parsed, session) => {
        for (const profileId of session.profileIds) applied.push({ profileId, payload: parsed });
      },
    });

    host.applyImports(section, ["profile-1", "profile-2"]);

    expect(applied).toEqual([
      { profileId: "profile-1", payload: { any: "thing" } },
      { profileId: "profile-2", payload: { any: "thing" } },
    ]);
  });
});

describe("ModuleHost's session hooks", () => {
  it("hands every module the profile ids the session opened, and the end of it", () => {
    const kit = harness();
    const host = new ModuleHost(kit.platform);
    const ctx = host.adopt(contract);
    const starts: string[][] = [];
    let ends = 0;
    ctx.onSessionStart((session) => starts.push([...session.profileIds]));
    ctx.onSessionEnd(() => {
      ends += 1;
    });

    host.sessionStart(["profile-1", "profile-2"]);
    host.sessionEnd();

    expect(starts).toEqual([["profile-1", "profile-2"]]);
    expect(ends).toBe(1);
  });
});

/**
 * ADR-108's hook, against the real host. What a module registers here is what
 * main's blob union, its `nx-blob:` mime lookup and the archive's `blobs/` list
 * are built from, so the three properties pinned below are the ones a module
 * that forgot to register would silently break: its file survives collection,
 * its bytes reach an export, and its rows' hashes reach a restore.
 */
describe("ModuleHost's blob hook (ADR-108)", () => {
  const PHOTO = { sha256: "a".repeat(64), sizeBytes: 4_096 };
  /** A hash no module ever names — the one a collector may take. */
  const STRANGER = "b".repeat(64);

  /** One registered module whose two rows name `PHOTO`; `counts` is how many, so a test can move it. */
  function withPhotoBlobs(
    host: ModuleHost,
    ctx: { blobs: (source: ModuleBlobSource) => void },
    counts = 2,
  ): void {
    ctx.blobs({
      refCount: (_session, _profileId, sha256) => (sha256 === PHOTO.sha256 ? counts : 0),
      mimeForHash: (_session, _profileId, sha256) =>
        sha256 === PHOTO.sha256 ? "image/jpeg" : null,
      exportBlobs: () => [PHOTO],
      importBlobs: () => [PHOTO],
    });
  }

  it("counts a registered module's rows, and answers zero and null for a hash none of them names", () => {
    const host = new ModuleHost(harness().platform);
    const ctx = host.adopt(contract);
    withPhotoBlobs(host, ctx);

    expect(host.blobRefCount("profile-1", PHOTO.sha256)).toBe(2);
    expect(host.blobMimeForHash("profile-1", PHOTO.sha256)).toBe("image/jpeg");
    // Zero is the whole of what makes a file collectable: `blobRefCount` sums
    // this answer with the built-in tables', so an unregistered hash is one
    // nothing protects - which is the behaviour a module that names blobs and
    // forgets this registration would get for its own files.
    expect(host.blobRefCount("profile-1", STRANGER)).toBe(0);
    expect(host.blobMimeForHash("profile-1", STRANGER)).toBeNull();
  });

  it("hands the module a session over the real database and the profiles it was asked about", () => {
    const host = new ModuleHost(harness().platform);
    const ctx = host.adopt(contract);
    let seen: readonly string[] = [];
    let openedTheRealDatabase = false;
    ctx.blobs({
      refCount: (session, profileId) => {
        seen = session.profileIds;
        // The handle is the platform's own, one `prepare` away from a real row:
        // a source reads a module's tables through exactly this call.
        const row = session.profileDb(profileId, (db) =>
          db.prepare("SELECT 1 AS one").get() as { one: number },
        );
        openedTheRealDatabase = row.one === 1;
        return 1;
      },
      mimeForHash: () => null,
      exportBlobs: () => [],
      importBlobs: () => [],
    });

    expect(host.blobRefCount("profile-9", PHOTO.sha256)).toBe(1);
    expect(seen).toEqual(["profile-9"]);
    expect(openedTheRealDatabase).toBe(true);
  });

  it("answers the export's blobs from every registered module, and the import's by module", () => {
    const host = new ModuleHost(harness().platform);
    const ctx = host.adopt(contract);
    withPhotoBlobs(host, ctx);
    // The import half is asked only of a section this build can already restore:
    // the host parses every payload first, so a module with no importer is
    // refused before any blob question is put to it.
    ctx.importData({ parse: (value) => value, apply: () => undefined });

    expect(host.collectBlobs(["profile-1"])).toEqual([PHOTO]);
    const section = [{ moduleId: "sample", payload: { photo: PHOTO.sha256 } }];
    expect(host.collectImportBlobs(section)).toEqual([
      { moduleId: "sample", sha256: PHOTO.sha256, sizeBytes: PHOTO.sizeBytes },
    ]);
    // A section this build adopted but has no blob source for names no blob: a
    // module with no files is not a missing answer, it is an empty one.
    expect(host.collectImportBlobs([])).toEqual([]);
  });

  it("counts a hash one module names twice once, so a restore writes the file once", () => {
    const host = new ModuleHost(harness().platform);
    const ctx = host.adopt(contract);
    ctx.importData({ parse: (value) => value, apply: () => undefined });
    ctx.blobs({
      refCount: () => 0,
      mimeForHash: () => null,
      exportBlobs: () => [],
      importBlobs: () => [PHOTO, { ...PHOTO, sizeBytes: PHOTO.sizeBytes }],
    });

    expect(host.collectImportBlobs([{ moduleId: "sample", payload: {} }])).toEqual([
      { moduleId: "sample", sha256: PHOTO.sha256, sizeBytes: PHOTO.sizeBytes },
    ]);
  });

  it("refuses a section a module's own parse will not take, before it answers any blob", () => {
    const host = new ModuleHost(harness().platform);
    const ctx = host.adopt(contract);
    ctx.importData({
      parse: () => {
        throw new Error("sample data is not a value this build reads");
      },
      apply: () => undefined,
    });
    withPhotoBlobs(host, ctx);

    // The same refusal the preview and the apply run, from the same code: the
    // blob question is asked only of a payload that build can read.
    expect(() => host.collectImportBlobs([{ moduleId: "sample", payload: {} }])).toThrow(
      ModuleImportError,
    );
  });
});
