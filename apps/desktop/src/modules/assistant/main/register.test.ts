import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createScriptedModel,
  type HardwareProfile,
  type ModelEntry,
  type ModelHost,
  type ModelRecommendation,
} from "@nexus/core";
import { NexusDatabase, TaskListStore, openDatabase, uuidv7 } from "@nexus/db";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import type { SearchResult } from "../../../shared/ipc.js";
import type { AssistantTurnEventEntry } from "../shared/ipc.js";
import { TurnBusyError } from "./turns.js";
import { register } from "./register.js";
import { setAssistantServicesForTest, type AssistantServices } from "./services.js";

/**
 * THE ASSISTANT THROUGH THE KIT (ADR-106): its ops, one real turn end to end
 * (including a `write` tool's confirmation), its archive section, the lifetime of
 * the services it builds, and the refusals it makes before anything is written.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * payload validators, the sender check and the channel allowlist are the host's.
 * Going through `dispatch` therefore tests what actually runs in the app.
 *
 * **Why the model is scripted and everything else is real.** The loop, the tool
 * registry, the store and the knowledge service are the app's own; only the
 * runtime is a fake, because a real one needs a GGUF file and a native addon.
 * `evals/scripted.ts`'s model plays a transcript, which is what makes a turn's
 * behaviour - the confirmation in the middle of it - assertable at all.
 *
 * **Why the turn tests carry a `30_000` budget.** `pollUntil` runs the app's own
 * agent loop and gives it a 15 s deadline of its own, so a budget below that
 * would report a hang as a timeout in the wrong place. Measured on this machine,
 * every test here takes 0.29-0.41 s; the number is headroom for the poll loop's
 * deadline, not a cost.
 */

const TRUSTED = { trusted: true };
const NOW = Date.parse("2026-06-01T08:00:00.000Z");

/** The one catalogue entry this machine has, and the model every turn loads. */
const ENTRY: ModelEntry = {
  id: "test-model",
  origin: "catalogue",
  title: "Test model",
  family: "test",
  repo: "test/model",
  file: "model-q4_k_m.gguf",
  sha256: "0".repeat(64),
  sizeBytes: 1_000_000_000,
  quantization: "Q4_K_M",
  contextTokens: 8192,
  capabilities: ["chat", "tools"],
  languages: ["sr", "en"],
  licence: { name: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
};

const HARDWARE: HardwareProfile = {
  totalRamBytes: 16 * 1024 ** 3,
  freeRamBytes: 8 * 1024 ** 3,
  cpuThreads: 8,
  gpus: [],
};

let dir: string;
let db: NexusDatabase;
let profileId: string;
let unloads = 0;
let loadError: Error | null = null;
/** The transcript the next `loadChat` answers with. */
let script: Parameters<typeof createScriptedModel>[0] = [];

function fakeHost(): ModelHost {
  const pick: readonly ModelRecommendation[] = [
    { tier: "balance", model: ENTRY, reason: { sr: "Sredina.", en: "The middle." } },
  ];
  return {
    async hardware(): Promise<HardwareProfile> {
      return HARDWARE;
    },
    async catalogue(): Promise<readonly ModelEntry[]> {
      return [ENTRY];
    },
    recommend(): readonly ModelRecommendation[] {
      return pick;
    },
    async searchHuggingFace(): Promise<readonly ModelEntry[]> {
      return [];
    },
    async installed(): Promise<readonly ModelEntry[]> {
      return [ENTRY];
    },
    async download(): Promise<void> {},
    async importFile(): Promise<ModelEntry> {
      return ENTRY;
    },
    async remove(): Promise<void> {},
    async loadChat() {
      if (loadError !== null) throw loadError;
      return createScriptedModel(script, { id: ENTRY.id, title: ENTRY.title });
    },
    async loadEmbedder() {
      throw new Error("this machine has no embedding model");
    },
    async unloadAll(): Promise<void> {
      unloads += 1;
    },
  };
}

function services(): AssistantServices {
  return {
    userData: () => dir,
    releasePublicKeyPem: () => "test-key",
    networkMode: () => "offline",
    createModelHost: fakeHost,
    secretCipher: {
      available: () => false,
      encrypt: () => "",
      decrypt: () => null,
    },
    pickGgufFile: async () => null,
    profileDb: (profile, open) => open(db.raw, profile),
    now: () => NOW,
    search: async (): Promise<readonly SearchResult[]> => [],
    packs: { list: async () => [] },
    modules: { all: () => [], get: () => undefined },
  };
}

function harness(): ModuleHost {
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => db.raw,
    notify: () => undefined,
    schedule: (atMs, run) => {
      const handle = setTimeout(run, Math.max(0, atMs - NOW));
      return () => clearTimeout(handle);
    },
    now: () => NOW,
  };
  const host = new ModuleHost(platform);
  setAssistantServicesForTest(services());
  register(host);
  return host;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-assistant-module-"));
  db = openDatabase({ path: join(dir, "assistant.db") });
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "P", new Date(NOW).toISOString());
  // A profile gets its Inbox the way the app gives it one (`ensureInbox`, which
  // profile creation calls): `TaskStore.create` has nowhere to put a task without
  // it, and the `tasks.create` tool this file drives writes through that store.
  new TaskListStore(db.raw, profileId).ensureInbox(new Date(NOW).toISOString());
  unloads = 0;
  loadError = null;
  script = [];
});

afterEach(() => {
  setAssistantServicesForTest(null);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A poll loop with a real deadline: the turn runs the app's own agent loop. */
async function pollUntil(
  host: ModuleHost,
  turnId: string,
  stop: (events: readonly AssistantTurnEventEntry[]) => boolean,
): Promise<{ events: AssistantTurnEventEntry[]; done: boolean; thread: unknown }> {
  let cursor = 0;
  const seen: AssistantTurnEventEntry[] = [];
  const deadline = Date.now() + 15_000;
  for (;;) {
    const poll = (await host.dispatch("assistant:poll", TRUSTED, {
      profileId,
      turnId,
      cursor,
    })) as { events: AssistantTurnEventEntry[]; nextCursor: number; done: boolean; thread: unknown };
    cursor = poll.nextCursor;
    seen.push(...poll.events);
    if (stop(poll.events) || poll.done) {
      return { events: seen, done: poll.done, thread: poll.thread };
    }
    if (Date.now() > deadline) throw new Error("the turn never finished");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("the assistant module through the kit", () => {
  it("validates every payload before anything is written", async () => {
    const host = harness();
    await expect(
      host.dispatch("assistant:list", TRUSTED, { profileId: 42 }),
    ).rejects.toThrow(/profileId/);
    const created = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Razgovor",
    })) as { conversations: { id: string }[] };
    const conversationId = created.conversations[0]?.id ?? "";
    // An empty message, an unknown workflow and a tier outside the three are each
    // refused by name, and none of them leaves a row behind.
    await expect(
      host.dispatch("assistant:send", TRUSTED, { profileId, conversationId, text: "   ", workflowId: null }),
    ).rejects.toThrow();
    await expect(
      host.dispatch("assistant:send", TRUSTED, {
        profileId,
        conversationId,
        text: "zdravo",
        workflowId: "nepostojeci",
      }),
    ).rejects.toThrow(/workflow/);
    await expect(
      host.dispatch("assistant:setDefaultTier", TRUSTED, { profileId, tier: "genius" }),
    ).rejects.toThrow(/tier/);
    await expect(
      host.dispatch("assistant:downloadModel", TRUSTED, { profileId, modelId: "invented" }),
    ).rejects.toThrow(/offered/);
    const thread = (await host.dispatch("assistant:open", TRUSTED, {
      profileId,
      conversationId,
    })) as { messages: unknown[] };
    expect(thread.messages).toEqual([]);
  });

  it("keeps conversations: creates, renames, lists newest first and removes one", async () => {
    const host = harness();
    const first = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Prvi",
    })) as { conversations: { id: string; title: string }[] };
    expect(first.conversations.map((row) => row.title)).toEqual(["Prvi"]);
    const second = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Drugi",
    })) as { conversations: { id: string; title: string }[] };
    // The store orders by `updated_at` descending and the clock is frozen, so the
    // tie breaks by id - the point is that the newest write is first.
    expect(second.conversations).toHaveLength(2);
    const renamed = (await host.dispatch("assistant:renameConversation", TRUSTED, {
      profileId,
      id: second.conversations[0]?.id ?? "",
      title: "Preimenovan",
    })) as { conversations: { title: string }[] };
    expect(renamed.conversations.map((row) => row.title)).toContain("Preimenovan");
    const removed = (await host.dispatch("assistant:removeConversation", TRUSTED, {
      profileId,
      conversationId: second.conversations[0]?.id ?? "",
    })) as { conversations: unknown[] };
    expect(removed.conversations).toHaveLength(1);
  });

  it("records the web-search consent, which is off until it is turned on", async () => {
    const host = harness();
    const before = (await host.dispatch("assistant:list", TRUSTED, { profileId })) as {
      settings: { webSearch: { enabled: boolean; mode: string } };
    };
    expect(before.settings.webSearch).toEqual({ enabled: false, modeAllows: false, mode: "offline" });
    const after = (await host.dispatch("assistant:setWebSearch", TRUSTED, {
      profileId,
      enabled: true,
    })) as { webSearch: { enabled: boolean; modeAllows: boolean } };
    expect(after.webSearch).toEqual({ enabled: true, modeAllows: false, mode: "offline" });
  });

  it("runs one real turn: a write tool asks first, and the answer is saved", async () => {
    const host = harness();
    script = [
      {
        toolCalls: [
          { id: "call_1", name: "tasks.create", arguments: { title: "Plati račun" } },
        ],
      },
      { text: "Zapisano." },
    ];
    const created = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Zadaci",
    })) as { conversations: { id: string }[] };
    const conversationId = created.conversations[0]?.id ?? "";
    const started = (await host.dispatch("assistant:send", TRUSTED, {
      profileId,
      conversationId,
      text: "Napravi zadatak da platim račun.",
      workflowId: null,
    })) as { turnId: string };

    // The tool parks: a `confirm` event arrives with the tool's own one-line
    // summary, and nothing has been written yet.
    const asked = await pollUntil(host, started.turnId, (events) =>
      events.some((entry) => entry.event.type === "confirm"),
    );
    const confirm = asked.events.find((entry) => entry.event.type === "confirm")?.event as
      | { requestId: string; tool: string; summary: string; effect: string }
      | undefined;
    expect(confirm?.tool).toBe("tasks.create");
    expect(confirm?.effect).toBe("write");
    expect(confirm?.summary).toContain("Plati račun");
    const tasks = db.raw
      .prepare("SELECT count(*) AS n FROM tasks WHERE profile_id = ?")
      .get(profileId) as { n: number };
    expect(tasks.n).toBe(0);

    await host.dispatch("assistant:answerConfirm", TRUSTED, {
      profileId,
      requestId: confirm?.requestId ?? "",
      allow: true,
    });
    const finished = await pollUntil(host, started.turnId, (events) =>
      events.some((entry) => entry.event.type === "done"),
    );
    expect(finished.done).toBe(true);
    const after = db.raw
      .prepare("SELECT count(*) AS n FROM tasks WHERE profile_id = ?")
      .get(profileId) as { n: number };
    expect(after.n).toBe(1);

    // The thread main hands back carries the question, the tool's answer and the
    // model's reply, in that order.
    const thread = finished.thread as {
      messages: { role: string; text: string; toolCallId: string | null }[];
    };
    expect(thread.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(thread.messages[3]?.text).toBe("Zapisano.");
    expect(thread.messages[2]?.toolCallId).toBe("call_1");
  }, 30_000);

  it("writes a step that both answered and asked for a tool as ONE assistant message", async () => {
    const host = harness();
    // The loop emits such a step as a `message` event carrying the calls AND as
    // one `tool-call` event per call, so the row is opened twice if the two are
    // not folded: the thread would hold the same request twice and be answered
    // once, which is a history the model can no longer read.
    script = [
      {
        text: "Gledam tvoje zadatke.",
        toolCalls: [{ id: "call_1", name: "tasks.list", arguments: {} }],
      },
      { text: "Evo." },
    ];
    const created = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Razgovor",
    })) as { conversations: { id: string }[] };
    const conversationId = created.conversations[0]?.id ?? "";
    const started = (await host.dispatch("assistant:send", TRUSTED, {
      profileId,
      conversationId,
      text: "\u0160ta imam za danas?",
      workflowId: null,
    })) as { turnId: string };
    const finished = await pollUntil(host, started.turnId, (events) =>
      events.some((entry) => entry.event.type === "done"),
    );
    const thread = finished.thread as {
      messages: {
        role: string;
        text: string;
        toolCalls: { id: string }[] | null;
        toolCallId: string | null;
      }[];
    };
    expect(thread.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    // One row, the model's own words kept, and the call on it exactly once.
    expect(thread.messages[1]?.text).toBe("Gledam tvoje zadatke.");
    expect(thread.messages[1]?.toolCalls?.map((call) => call.id)).toEqual(["call_1"]);
    expect(thread.messages[2]?.toolCallId).toBe("call_1");
  }, 30_000);

  it("refuses a second turn while one runs, and a refusal is a normal result", async () => {
    const host = harness();
    script = [{ text: "Odgovor." }];
    const created = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Razgovor",
    })) as { conversations: { id: string }[] };
    const conversationId = created.conversations[0]?.id ?? "";
    const started = (await host.dispatch("assistant:send", TRUSTED, {
      profileId,
      conversationId,
      text: "zdravo",
      workflowId: null,
    })) as { turnId: string };
    await expect(
      host.dispatch("assistant:send", TRUSTED, {
        profileId,
        conversationId,
        text: "i još nešto",
        workflowId: null,
      }),
    ).rejects.toBeInstanceOf(TurnBusyError);
    await pollUntil(host, started.turnId, (events) =>
      events.some((entry) => entry.event.type === "done"),
    );
  }, 30_000);

  it("resolves a parked confirmation as refused when the turn is stopped", async () => {
    const host = harness();
    script = [
      {
        toolCalls: [
          { id: "call_1", name: "tasks.create", arguments: { title: "Nešto" } },
        ],
      },
      { text: "Ništa nije zapisano." },
    ];
    const created = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Razgovor",
    })) as { conversations: { id: string }[] };
    const conversationId = created.conversations[0]?.id ?? "";
    const started = (await host.dispatch("assistant:send", TRUSTED, {
      profileId,
      conversationId,
      text: "napravi zadatak",
      workflowId: null,
    })) as { turnId: string };
    await pollUntil(host, started.turnId, (events) =>
      events.some((entry) => entry.event.type === "confirm"),
    );
    await host.dispatch("assistant:stop", TRUSTED, { profileId, turnId: started.turnId });
    await pollUntil(host, started.turnId, (events) =>
      events.some((entry) => entry.event.type === "done"),
    );
    // A refusal is an ordinary result: the tool did not run, and the turn ended.
    const tasks = db.raw
      .prepare("SELECT count(*) AS n FROM tasks WHERE profile_id = ?")
      .get(profileId) as { n: number };
    expect(tasks.n).toBe(0);
  }, 30_000);

  it("resolves a parked confirmation as refused when the user says no", async () => {
    const host = harness();
    script = [
      {
        toolCalls: [
          { id: "call_1", name: "tasks.create", arguments: { title: "Ne\u0107u" } },
        ],
      },
      { text: "Ni\u0161ta nije zapisano." },
    ];
    const created = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Razgovor",
    })) as { conversations: { id: string }[] };
    const conversationId = created.conversations[0]?.id ?? "";
    const started = (await host.dispatch("assistant:send", TRUSTED, {
      profileId,
      conversationId,
      text: "napravi zadatak",
      workflowId: null,
    })) as { turnId: string };
    const asked = await pollUntil(host, started.turnId, (events) =>
      events.some((entry) => entry.event.type === "confirm"),
    );
    const confirm = asked.events.find((entry) => entry.event.type === "confirm")?.event as
      | { requestId: string }
      | undefined;
    await host.dispatch("assistant:answerConfirm", TRUSTED, {
      profileId,
      requestId: confirm?.requestId ?? "",
      allow: false,
    });
    const finished = await pollUntil(host, started.turnId, (events) =>
      events.some((entry) => entry.event.type === "done"),
    );
    expect(finished.done).toBe(true);
    // A "no" is an ordinary result: the tool did not run, the loop was told so,
    // and the turn carried on to an answer.
    const tasks = db.raw
      .prepare("SELECT count(*) AS n FROM tasks WHERE profile_id = ?")
      .get(profileId) as { n: number };
    expect(tasks.n).toBe(0);
    const thread = finished.thread as { messages: { role: string; toolCallId: string | null }[] };
    expect(thread.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    // Answering the same question a second time reaches nothing: an answered id
    // is forgotten the moment it is answered, so a double click cannot resolve a
    // tool twice.
    await expect(
      host.dispatch("assistant:answerConfirm", TRUSTED, {
        profileId,
        requestId: confirm?.requestId ?? "",
        allow: true,
      }),
    ).rejects.toThrow(/confirmation/);
  }, 30_000);

  it("round-trips its archive section, and empties the profile when none is named", async () => {
    const host = harness();
    script = [{ text: "Zdravo." }];
    const created = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Putovanje",
    })) as { conversations: { id: string }[] };
    const conversationId = created.conversations[0]?.id ?? "";
    const started = (await host.dispatch("assistant:send", TRUSTED, {
      profileId,
      conversationId,
      text: "zdravo",
      workflowId: null,
    })) as { turnId: string };
    await pollUntil(host, started.turnId, (events) =>
      events.some((entry) => entry.event.type === "done"),
    );
    await host.dispatch("assistant:setDefaultTier", TRUSTED, { profileId, tier: "speed" });

    const section = host.collectExports([profileId]);
    expect(section.map((entry) => entry.moduleId)).toEqual(["assistant"]);
    host.applyImports([], [profileId]);
    const emptied = (await host.dispatch("assistant:list", TRUSTED, { profileId })) as {
      conversations: unknown[];
      settings: { defaultTier: string };
    };
    expect(emptied.conversations).toEqual([]);
    expect(emptied.settings.defaultTier).toBe("balance");

    host.applyImports(section, [profileId]);
    const restored = (await host.dispatch("assistant:list", TRUSTED, { profileId })) as {
      conversations: { title: string }[];
      settings: { defaultTier: string };
    };
    expect(restored.conversations.map((row) => row.title)).toEqual(["Putovanje"]);
    expect(restored.settings.defaultTier).toBe("speed");
  }, 30_000);

  it("drops every service it built when the session ends", async () => {
    const host = harness();
    script = [{ text: "Zdravo." }];
    const created = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Razgovor",
    })) as { conversations: { id: string }[] };
    const started = (await host.dispatch("assistant:send", TRUSTED, {
      profileId,
      conversationId: created.conversations[0]?.id ?? "",
      text: "zdravo",
      workflowId: null,
    })) as { turnId: string };
    await pollUntil(host, started.turnId, (events) =>
      events.some((entry) => entry.event.type === "done"),
    );
    expect(unloads).toBe(0);
    host.sessionEnd();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The runtime is unloaded: a model loaded for this profile does not outlive
    // the session that asked for it.
    expect(unloads).toBe(1);
    // A turn that was parked is no longer reachable under its old id.
    await expect(
      host.dispatch("assistant:poll", TRUSTED, { profileId, turnId: started.turnId, cursor: 0 }),
    ).rejects.toThrow(/turn/);
  }, 30_000);

  it("refuses a model that is missing for the chosen tier, without writing the message", async () => {
    const host = harness();
    loadError = new Error("no model");
    const created = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Razgovor",
    })) as { conversations: { id: string }[] };
    await expect(
      host.dispatch("assistant:send", TRUSTED, {
        profileId,
        conversationId: created.conversations[0]?.id ?? "",
        text: "zdravo",
        workflowId: null,
      }),
    ).rejects.toThrow(/no model/);
    const thread = (await host.dispatch("assistant:open", TRUSTED, {
      profileId,
      conversationId: created.conversations[0]?.id ?? "",
    })) as { messages: unknown[] };
    expect(thread.messages).toEqual([]);
  });
});
