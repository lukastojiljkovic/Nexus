import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createScriptedModel,
  type ChatLoadOverrides,
  type HardwareProfile,
  type ModelEntry,
  type ModelHost,
  type ModelRecommendation,
  type ScriptedChatModel,
} from "@nexus/core";
import {
  ConversationStore,
  DEFAULT_ASSISTANT_RUNTIME,
  NexusDatabase,
  TaskListStore,
  openDatabase,
  uuidv7,
} from "@nexus/db";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import type { VoiceHost } from "../../../main/assistant/voice/host.js";
import type { VoiceReply, VoiceRequest } from "../../../main/assistant/voice/protocol.js";
import { decodeWav, encodeWav } from "../../../main/assistant/voice/wav.js";
import { baseManifest, entry, makeKey, writePack } from "../../../main/packs/fixtures.js";
import { packVersionDir } from "../../../main/packs/registry.js";
import { createDictionaryReader } from "../../translator/main/dictionary.js";
import type { SearchResult } from "../../../shared/ipc.js";
import type { AssistantTurnEventEntry } from "../shared/ipc.js";
import { TurnBusyError } from "./turns.js";
import { register } from "./register.js";
import { assistantMicArmedAt } from "./micAccess.js";
import { setAssistantServicesForTest, type AssistantServices } from "./services.js";
import { createModuleRegistry } from "../../../shared/modules.js";

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

/** The throwaway Ed25519 pair this file's signed voice packs are verified with. Never the release key. */
const packKey = makeKey();

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

/**
 * A model the user downloaded or imported: installed, able to chat, and the pick
 * for NO tier - the state this whole feature exists for.
 */
const DOWNLOADED: ModelEntry = {
  id: "downloaded-model-q4_k_m",
  origin: "huggingface",
  title: "Downloaded model",
  family: "qwen2.5",
  repo: "test/downloaded",
  file: "downloaded-model-q4_k_m.gguf",
  sha256: "1".repeat(64),
  sizeBytes: 2_000_000_000,
  quantization: "Q4_K_M",
  contextTokens: 8192,
  capabilities: ["chat"],
  languages: ["sr", "en"],
  licence: { name: "MIT", url: "https://opensource.org/license/mit" },
};

/** An embedding model: installed, and unable to answer, so it may never be chosen. */
const EMBEDDING: ModelEntry = {
  id: "embed-model",
  origin: "huggingface",
  title: "Embedding model",
  family: "bge-m3",
  repo: "test/embed",
  file: "embed-model-f16.gguf",
  sha256: "2".repeat(64),
  sizeBytes: 500_000_000,
  quantization: "F16",
  contextTokens: 8192,
  capabilities: ["embedding"],
  languages: ["sr", "en"],
  licence: { name: "MIT", url: "https://opensource.org/license/mit" },
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
/** How many times the host was asked for the hardware reading: the probe that loads the native runtime. */
let hardwareReads = 0;
let loadError: Error | null = null;
/** The models on this machine, written by the tests that add or remove one. */
let installedEntries: ModelEntry[] = [];
/** Every model id `loadChat` was asked for, in order, and the overrides each load carried. */
let loaded: string[] = [];
let loadOverrides: (ChatLoadOverrides | undefined)[] = [];
/** Every idle time the host was told to keep its models for, in minutes. */
let keptFor: number[] = [];
/** The chat model the fake host holds, as `resident()` answers it. */
let residentChat: string | null = null;
/** The voice worker, as this module sees it: one canned reply per request kind. */
let voiceRequests: VoiceRequest[] = [];
let voiceDisposals = 0;
let voiceTranscript = "Zdravo iz mikrofona.";
/** The transcript the next `loadChat` answers with. */
let script: Parameters<typeof createScriptedModel>[0] = [];
/** The last model loaded, so a test can read what the loop asked it (`ScriptedChatModel.requests`). */
let lastModel: ScriptedChatModel | null = null;

/**
 * The worker's host, faked at the seam `services.ts` hands over.
 *
 * The real one forks a `utilityProcess`, so a test can only reach the module's
 * own half: what is asserted below is that the module ASKS for the right thing
 * (a load before a transcribe, the caption's own language, a WAV on the way in)
 * and turns the worker's answer into the view the page reads.
 */
function fakeVoiceHost(): VoiceHost {
  return {
    async run(request: VoiceRequest): Promise<VoiceReply> {
      voiceRequests.push(request);
      if (request.type === "load") return { id: request.id, type: "ready" };
      if (request.type === "transcribe") {
        return { id: request.id, type: "transcript", text: voiceTranscript };
      }
      if (request.type === "speak") {
        return {
          id: request.id,
          type: "audio",
          pcm: new Float32Array([0.25, -0.25]),
          sampleRate: 16_000,
        };
      }
      return { id: request.id, type: "disposed" };
    },
    async dispose(): Promise<void> {
      voiceDisposals += 1;
    },
  };
}

function fakeHost(): ModelHost {
  const pick: readonly ModelRecommendation[] = [
    { tier: "balance", model: ENTRY, reason: { sr: "Sredina.", en: "The middle." } },
  ];
  return {
    async hardware(): Promise<HardwareProfile> {
      hardwareReads += 1;
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
      return [...installedEntries];
    },
    async download(): Promise<void> {},
    async importFile(): Promise<ModelEntry> {
      return ENTRY;
    },
    async remove(id: string): Promise<void> {
      installedEntries = installedEntries.filter((candidate) => candidate.id !== id);
    },
    async loadChat(id: string, _signal: AbortSignal, overrides?: ChatLoadOverrides) {
      loaded.push(id);
      loadOverrides.push(overrides);
      if (loadError !== null) throw loadError;
      residentChat = id;
      // The window the app itself loads: a chat model is asked for
      // `CHAT_CONTEXT_TOKENS` (8_192). The fake's own default is 4_096, and the
      // tool registry the merged build offers needs more room than that - its
      // system prompt measures 10_958 characters, 4_566 estimated tokens in
      // Serbian, for the 37 tools it declares - so at 4_096 (ceiling 3_072)
      // every turn ended `context-full` before the model was asked anything,
      // and the tests below passed or failed for a reason none of them named.
      const entry = installedEntries.find((candidate) => candidate.id === id);
      lastModel = createScriptedModel(script, {
        id,
        title: entry?.title ?? id,
        contextTokens: entry?.contextTokens ?? ENTRY.contextTokens,
      });
      return lastModel;
    },
    async loadEmbedder() {
      throw new Error("this machine has no embedding model");
    },
    resident() {
      return { chat: residentChat, embedder: null };
    },
    keepLoadedFor(minutes: number): void {
      keptFor.push(minutes);
    },
    async unloadAll(): Promise<void> {
      unloads += 1;
      residentChat = null;
    },
  };
}

function services(): AssistantServices {
  return {
    userData: () => dir,
    appVersion: () => "0.0.0-test",
    releasePublicKeyPem: () => packKey.publicKeyPem,
    networkMode: () => "offline",
    createModelHost: fakeHost,
    createVoiceHost: fakeVoiceHost,
    secretCipher: {
      available: () => false,
      encrypt: () => "",
      decrypt: () => null,
    },
    pickGgufFile: async () => null,
    profileDb: (profile, open) => open(db.raw, profile),
    now: () => NOW,
    search: async (): Promise<readonly SearchResult[]> => [],
    packs: { list: async () => [], catalogue: () => Promise.resolve({ outcome: "ready", entries: [] }), download: () => Promise.resolve({ outcome: "refused", code: "downloads-off" }), remove: () => Promise.resolve({ outcome: "refused", code: "not-a-pack" }), downloadsAllowed: () => false },
    dictionary: createDictionaryReader(() => tmpdir()),
    tools: { installed: () => [], pack: () => null, session: () => Promise.reject(new Error("no pack")) },
    // No ZIM service in this harness: the wiki kind answers nothing, which is
    // the state `knowledge/index.ts` describes for a build without one.
    zimWiki: () => null,
    focus: { start: () => { throw new Error("not expected"); }, stop: () => { throw new Error("not expected"); }, cancel: () => undefined, pause: () => { throw new Error("not expected"); }, resume: () => { throw new Error("not expected"); }, status: () => null },
    notifications: { list: () => [], snooze: () => { throw new Error("not expected"); }, dismiss: () => undefined, settings: () => { throw new Error("not expected"); }, updateSettings: () => { throw new Error("not expected"); }, setSourceEnabled: () => undefined, upcoming: () => [] },
    modules: createModuleRegistry(),
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
  hardwareReads = 0;
  loadError = null;
  installedEntries = [ENTRY];
  loaded = [];
  loadOverrides = [];
  keptFor = [];
  residentChat = null;
  voiceRequests = [];
  voiceDisposals = 0;
  voiceTranscript = "Zdravo iz mikrofona.";
  script = [];
  lastModel = null;
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
  /**
   * A signed voice pack, in the folder the pack installer writes one to.
   *
   * Written through `packs/fixtures.ts` rather than by hand so the signature is
   * real: `readVoicePacks` reads the registry, which verifies every manifest
   * against the key `services()` hands over, so a fixture that skipped the
   * signature would prove the opposite of what this test is for.
   */
  function installVoicePack(input: {
    readonly id: string;
    readonly kind: "stt" | "tts";
    readonly languages: readonly string[];
  }): void {
    const descriptor =
      JSON.stringify({
        format: 1,
        kind: input.kind,
        engine: input.kind === "stt" ? "whisper" : "vits",
        languages: input.languages,
        sampleRate: 16_000,
        upstream: { repo: "test/voice", revision: "main" },
      }) + "\n";
    const weights = "not really a model\n";
    const version = "1.0.0";
    writePack({
      dir: packVersionDir(dir, input.id, version),
      key: packKey.privateKey,
      manifest: baseManifest([entry("voice.json", descriptor), entry("model.onnx", weights)], {
        id: input.id,
        version,
        kind: "model",
      }),
      contents: { "voice.json": descriptor, "model.onnx": weights },
    });
  }

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

  it("names the installed embedding model in the list without loading it", async () => {
    // The fake's `loadEmbedder` throws, so a list that loaded the model would reject.
    installedEntries = [ENTRY, EMBEDDING];
    const host = harness();
    const view = (await host.dispatch("assistant:list", TRUSTED, { profileId })) as {
      knowledge: { embedderId: string | null };
    };
    expect(view.knowledge.embedderId).toBe("embed-model");
  });

  it("says which voice packs are installed, and arms the microphone when the page asks", async () => {
    const host = harness();
    // Nothing installed is the ordinary state of a fresh profile: two empty
    // lists and no pack to name, rather than an error.
    expect(await host.dispatch("assistant:voice", TRUSTED, { profileId })).toEqual({
      speechLanguages: [],
      voiceLanguages: [],
      packs: [],
    });
    expect(assistantMicArmedAt(NOW)).toBe(false);
    await host.dispatch("assistant:capture", TRUSTED, { profileId });
    // Armed for the window the session's permission rule consults, and only then.
    expect(assistantMicArmedAt(NOW)).toBe(true);
    expect(assistantMicArmedAt(NOW + 60_000)).toBe(false);
  });

  it("transcribes a captured utterance through the worker, and speaks a sentence back", async () => {
    const host = harness();
    installVoicePack({ id: "voice-sr", kind: "stt", languages: ["sr", "en"] });
    installVoicePack({ id: "speaks-sr", kind: "tts", languages: ["sr"] });
    const view = (await host.dispatch("assistant:voice", TRUSTED, { profileId })) as {
      speechLanguages: string[];
      voiceLanguages: string[];
      packs: { id: string; kind: string }[];
    };
    expect(view.speechLanguages).toEqual(["sr", "en"]);
    expect(view.voiceLanguages).toEqual(["sr"]);
    // The order is the registry's own - the packs directory read in name order -
    // so what this pins is WHICH packs are listed, not the order they arrive in.
    expect(view.packs.map((pack) => `${pack.id}:${pack.kind}`).sort()).toEqual([
      "speaks-sr:tts",
      "voice-sr:stt",
    ]);

    // A WAV the renderer could have captured, at 8 kHz: main resamples it to the
    // 16 kHz every voice model is defined at, and the worker is handed the WAV
    // decoded - so the assertion below is about the rate, not about the bytes.
    const captured = encodeWav(new Float32Array(800).fill(0.1), 8_000);
    const answered = (await host.dispatch("assistant:transcribe", TRUSTED, {
      profileId,
      language: "sr",
      bytes: captured,
    })) as { text: string };
    expect(answered.text).toBe("Zdravo iz mikrofona.");
    const transcribe = voiceRequests.find((request) => request.type === "transcribe");
    expect(transcribe?.sampleRate).toBe(16_000);
    expect(transcribe && "language" in transcribe ? transcribe.language : null).toBe("sr");

    const spoken = (await host.dispatch("assistant:speak", TRUSTED, {
      profileId,
      language: "sr",
      text: "Helikopter dolazi u zoru.",
    })) as { bytes: Uint8Array; sampleRate: number };
    expect(spoken.sampleRate).toBe(16_000);
    // What comes back is a WAV the page can play: decoding it again is the
    // cheapest proof that the bytes are a file and not an array of numbers.
    const decoded = decodeWav(spoken.bytes);
    expect([...decoded.pcm.slice(0, 2)]).toEqual([0.25, -0.25]);
  });

  it("refuses both halves of the voice with no pack installed, and refuses Serbian speech without a Serbian voice", async () => {
    const host = harness();
    await expect(
      host.dispatch("assistant:transcribe", TRUSTED, {
        profileId,
        language: "sr",
        bytes: encodeWav(new Float32Array(160), 16_000),
      }),
    ).rejects.toThrow(/speech model/);
    await expect(
      host.dispatch("assistant:speak", TRUSTED, {
        profileId,
        language: "sr",
        text: "Zdravo.",
      }),
    ).rejects.toThrow(/voice speaks/);

    // An English voice and a Serbian answer is the refusal ADR-105 section 3
    // exists for: the English voice never reads Serbian, so nothing is spoken.
    installVoicePack({ id: "voice-en", kind: "tts", languages: ["en"] });
    await expect(
      host.dispatch("assistant:speak", TRUSTED, { profileId, language: "sr", text: "Zdravo." }),
    ).rejects.toThrow(/voice speaks/);
    expect(voiceRequests.some((request) => request.type === "speak")).toBe(false);
    // The English voice does speak English, which is what makes the refusal
    // above a rule rather than a missing branch.
    await host.dispatch("assistant:speak", TRUSTED, { profileId, language: "en", text: "Hello." });
    expect(voiceRequests.some((request) => request.type === "speak")).toBe(true);
  });

  it("stops the voice worker when the session ends", async () => {
    const host = harness();
    installVoicePack({ id: "voice-sr", kind: "stt", languages: ["sr"] });
    await host.dispatch("assistant:transcribe", TRUSTED, {
      profileId,
      language: "sr",
      bytes: encodeWav(new Float32Array(160), 16_000),
    });
    expect(voiceDisposals).toBe(0);
    host.sessionEnd();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(voiceDisposals).toBe(1);
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

  it("stores a tool that did NOT act on the tool row's own column, beside its own words", async () => {
    const host = harness();
    // `tasks.complete` with an id no task has: the tool runs, finds nothing and
    // answers with its own sentence - while the model says it did the thing,
    // which is the failure the page states the outcome for.
    script = [
      { toolCalls: [{ id: "call_1", name: "tasks.complete", arguments: { id: "nema-me" } }] },
      { text: "Označio sam zadatak kao završen." },
    ];
    const created = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Razgovor",
    })) as { conversations: { id: string }[] };
    const conversationId = created.conversations[0]?.id ?? "";
    const started = (await host.dispatch("assistant:send", TRUSTED, {
      profileId,
      conversationId,
      text: "Završi zadatak nema-me.",
      workflowId: null,
    })) as { turnId: string };
    const finished = await pollUntil(host, started.turnId, (events) =>
      events.some((entry) => entry.event.type === "done"),
    );
    const thread = finished.thread as {
      messages: { role: string; text: string; ok: boolean | null }[];
    };

    // The row the store keeps: the outcome on its own column (migration 93), and
    // the text exactly as the tool wrote it - the outcome does not ride on the
    // text, so nothing that reads the row has to know a mark to read the words.
    const stored = db.raw
      .prepare(
        "SELECT text, ok FROM assistant_messages WHERE conversation_id = ? AND role = 'tool'",
      )
      .get(conversationId) as { text: string; ok: number | null };
    expect(stored.ok).toBe(0);
    // The tool's own sentence from the row's FIRST character: an outcome that
    // rode on the text would sit in front of this sentence.
    expect(stored.text).toMatch(
      /^(Neuspešno|Failed): (Ne postoji aktivan zadatak|No active task has the id)/,
    );

    // And the thread the page draws: not done, the tool's own sentence - and the
    // row that ASKED for the tool states nothing, because a call has no outcome
    // until it has one.
    expect(thread.messages[2]?.ok).toBe(false);
    expect(thread.messages[2]?.text).toBe(stored.text);
    expect(thread.messages[1]?.ok).toBeNull();

    // A later turn replays the conversation: the model reads the tool's own
    // words, unchanged, and never the outcome the page needed.
    script = [{ text: "Ništa nije promenjeno." }];
    const again = (await host.dispatch("assistant:send", TRUSTED, {
      profileId,
      conversationId,
      text: "i sada?",
      workflowId: null,
    })) as { turnId: string };
    await pollUntil(host, again.turnId, (events) =>
      events.some((entry) => entry.event.type === "done"),
    );
    const replayed = lastModel?.requests
      .at(-1)
      ?.messages.find((message) => message.role === "tool");
    const toolText = thread.messages[2]?.text ?? "";
    expect(toolText).not.toBe("");
    // The loop fences a replayed result as data (`fenceUntrusted`), so the
    // sentence arrives wrapped and otherwise untouched: the tool's words, and
    // nothing this module added to them.
    expect(replayed?.content).toContain(toolText);
  }, 30_000);

  it("reads a tool row saved before the outcome column as a tool that was done", async () => {
    const host = harness();
    const created = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Razgovor",
    })) as { conversations: { id: string }[] };
    const conversationId = created.conversations[0]?.id ?? "";
    // Exactly the row migration 93 left behind: a tool result written before the
    // column existed, whose `ok` is therefore NULL.
    db.raw
      .prepare(
        `INSERT INTO assistant_messages
           (id, profile_id, conversation_id, ordinal, role, text, citations_json,
            tool_calls_json, tool_call_id, ok, safety, created_at)
         VALUES (?, ?, ?, 0, 'tool', ?, '[]', NULL, 'call_1', NULL, 0, ?)`,
      )
      .run(uuidv7(), profileId, conversationId, "Otvoreno.", new Date(NOW).toISOString());

    const thread = (await host.dispatch("assistant:open", TRUSTED, {
      profileId,
      conversationId,
    })) as { messages: { role: string; text: string; ok: boolean | null }[] };
    // A row with no outcome recorded is a tool that did the thing, which is what
    // the page showed for every one of them until the column arrived.
    expect(thread.messages[0]?.ok).toBe(true);
    expect(thread.messages[0]?.text).toBe("Otvoreno.");
  });

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

  it("answers setup from the disk alone, without waiting for the hardware probe", async () => {
    const host = harness();
    const view = (await host.dispatch("assistant:setup", TRUSTED, { profileId })) as Record<string, unknown>;
    expect(hardwareReads).toBe(0);
    expect(view["installed"]).toEqual([{ model: ENTRY, chosen: false }]);
    expect(Object.keys(view)).not.toContain("hardware");
  });

  it("reads the hardware and the picks in probe, and offers the picks for download", async () => {
    installedEntries = [];
    const host = harness();
    await host.dispatch("assistant:setup", TRUSTED, { profileId });
    // A pick nobody has been shown yet cannot be named by a download.
    await expect(
      host.dispatch("assistant:downloadModel", TRUSTED, { profileId, modelId: ENTRY.id }),
    ).rejects.toThrow(/was offered/);
    const probe = await host.dispatch("assistant:probe", TRUSTED, { profileId });
    expect(probe).toEqual({
      hardware: HARDWARE,
      recommendations: [{ tier: "balance", model: ENTRY, reason: { sr: "Sredina.", en: "The middle." } }],
      unavailable: null,
    });
    await host.dispatch("assistant:downloadModel", TRUSTED, { profileId, modelId: ENTRY.id });
  });

  it("reports the chosen model on the setup view, and that a tier clears the choice", async () => {
    const host = harness();
    installedEntries = [ENTRY, DOWNLOADED];
    const before = (await host.dispatch("assistant:setup", TRUSTED, { profileId })) as {
      chatModelId: string | null;
      installed: { model: { id: string }; chosen: boolean }[];
    };
    expect(before.chatModelId).toBeNull();
    expect(before.installed.some((row) => row.chosen)).toBe(false);

    const chosen = (await host.dispatch("assistant:setChatModel", TRUSTED, {
      profileId,
      modelId: DOWNLOADED.id,
    })) as { chatModelId: string | null; installed: { model: { id: string }; chosen: boolean }[] };
    expect(chosen.chatModelId).toBe(DOWNLOADED.id);
    // The choice marks the one row that answers, and the tier's own pick is not
    // marked: `chosen` is the hand-picked model, not the tier.
    expect(chosen.installed.map((row) => [row.model.id, row.chosen])).toEqual([
      [ENTRY.id, false],
      [DOWNLOADED.id, true],
    ]);

    const tiered = (await host.dispatch("assistant:setDefaultTier", TRUSTED, {
      profileId,
      tier: "speed",
    })) as { chatModelId: string | null; installed: { chosen: boolean }[] };
    expect(tiered.chatModelId).toBeNull();
    expect(tiered.installed.some((row) => row.chosen)).toBe(false);
  });

  it("refuses a chosen model that is not installed, and one that cannot chat", async () => {
    const host = harness();
    installedEntries = [ENTRY, EMBEDDING];
    await expect(
      host.dispatch("assistant:setChatModel", TRUSTED, { profileId, modelId: "invented" }),
    ).rejects.toThrow(/installed/);
    await expect(
      host.dispatch("assistant:setChatModel", TRUSTED, { profileId, modelId: EMBEDDING.id }),
    ).rejects.toThrow(/chat/);
    // Neither refusal is a half-write: the profile is left with no choice at all.
    const view = (await host.dispatch("assistant:setup", TRUSTED, { profileId })) as {
      chatModelId: string | null;
    };
    expect(view.chatModelId).toBeNull();
  });

  it("answers with the chosen model, and falls back to the tier's pick once it is removed", async () => {
    const host = harness();
    installedEntries = [ENTRY, DOWNLOADED];
    script = [{ text: "Odgovor." }];
    const created = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Izbor",
    })) as { conversations: { id: string }[] };
    const conversationId = created.conversations[0]?.id ?? "";
    const send = async (text: string): Promise<void> => {
      const started = (await host.dispatch("assistant:send", TRUSTED, {
        profileId,
        conversationId,
        text,
        workflowId: null,
      })) as { turnId: string };
      await pollUntil(host, started.turnId, (events) =>
        events.some((entry) => entry.event.type === "done"),
      );
    };

    // No choice: the balance pick answers, even though a second chat model that
    // serves no tier is installed beside it.
    await send("zdravo");
    expect(loaded).toEqual([ENTRY.id]);

    // Chosen: the downloaded model answers instead of the tier's pick.
    await host.dispatch("assistant:setChatModel", TRUSTED, { profileId, modelId: DOWNLOADED.id });
    await send("i sada ti");
    expect(loaded).toEqual([ENTRY.id, DOWNLOADED.id]);

    // Removed: the choice no longer names anything, so the tier answers again and
    // the setup view stops marking a chosen row.
    await host.dispatch("assistant:removeModel", TRUSTED, { profileId, modelId: DOWNLOADED.id });
    await send("a sada");
    expect(loaded).toEqual([ENTRY.id, DOWNLOADED.id, ENTRY.id]);
    const view = (await host.dispatch("assistant:setup", TRUSTED, { profileId })) as {
      chatModelId: string | null;
      installed: { chosen: boolean }[];
    };
    expect(view.chatModelId).toBeNull();
    expect(view.installed.some((row) => row.chosen)).toBe(false);
  }, 30_000);
});

describe("the assistant's runtime: context, sampling and memory", () => {
  const RUNTIME = {
    contextTokens: 16_384,
    temperature: 0.4,
    topP: null,
    topK: 40,
    repeatPenalty: null,
    idleUnloadMinutes: 5,
    autoCompact: false,
  };

  async function sendOne(host: ModuleHost): Promise<void> {
    const created = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Rad",
    })) as { conversations: { id: string }[] };
    const started = (await host.dispatch("assistant:send", TRUSTED, {
      profileId,
      conversationId: created.conversations[0]?.id ?? "",
      text: "zdravo",
      workflowId: null,
    })) as { turnId: string };
    await pollUntil(host, started.turnId, (events) => events.some((entry) => entry.event.type === "done"));
  }

  it("answers the defaults and the bounds in the setup view of a profile that set nothing", async () => {
    const host = harness();
    const view = (await host.dispatch("assistant:setup", TRUSTED, { profileId })) as {
      runtime: { options: unknown; limits: { contextTokens: { min: number; max: number } } };
      resident: unknown;
    };
    expect(view.runtime.options).toEqual(DEFAULT_ASSISTANT_RUNTIME);
    expect(view.runtime.limits.contextTokens).toMatchObject({ min: 2048, max: 131_072 });
    expect(view.resident).toEqual({ chat: null, embedder: null });
  });

  it("loads with the profile's runtime options, and keeps the model for the idle time they name", async () => {
    const host = harness();
    script = [{ text: "Odgovor." }];
    const view = (await host.dispatch("assistant:setRuntime", TRUSTED, {
      profileId,
      runtime: RUNTIME,
    })) as { runtime: { options: unknown } };
    expect(view.runtime.options).toEqual(RUNTIME);
    // A changed idle time applies to the model in memory now, not at the next turn.
    expect(keptFor.at(-1)).toBe(5);

    await sendOne(host);
    // Only what the profile set travels: a `null` is the model's own value.
    expect(loadOverrides).toEqual([{ contextTokens: 16_384, temperature: 0.4, topK: 40 }]);
    expect(keptFor.at(-1)).toBe(5);
  }, 30_000);

  it("loads a profile that set nothing with no overrides at all", async () => {
    const host = harness();
    script = [{ text: "Odgovor." }];
    await sendOne(host);
    expect(loadOverrides).toEqual([{}]);
    expect(keptFor.at(-1)).toBe(15);
  }, 30_000);

  it("refuses a runtime option outside its bounds, and keeps the last one", async () => {
    const host = harness();
    await host.dispatch("assistant:setRuntime", TRUSTED, { profileId, runtime: RUNTIME });
    for (const wrong of [
      { ...RUNTIME, temperature: 9 },
      { ...RUNTIME, contextTokens: 100 },
      { ...RUNTIME, topK: 2.5 },
      { ...RUNTIME, idleUnloadMinutes: null },
      { ...RUNTIME, idleUnloadMinutes: undefined },
      { ...RUNTIME, autoCompact: "yes" },
      "all of them",
    ]) {
      await expect(
        host.dispatch("assistant:setRuntime", TRUSTED, { profileId, runtime: wrong }),
        JSON.stringify(wrong),
      ).rejects.toThrow();
    }
    const view = (await host.dispatch("assistant:setup", TRUSTED, { profileId })) as {
      runtime: { options: unknown };
    };
    expect(view.runtime.options).toEqual(RUNTIME);
  });

  it("names the model in memory, and lets it go on request", async () => {
    const host = harness();
    script = [{ text: "Odgovor." }];
    await sendOne(host);
    const before = (await host.dispatch("assistant:setup", TRUSTED, { profileId })) as {
      resident: { chat: string | null };
    };
    expect(before.resident.chat).toBe(ENTRY.id);
    const after = (await host.dispatch("assistant:unloadModels", TRUSTED, { profileId })) as {
      resident: { chat: string | null };
    };
    expect(unloads).toBe(1);
    expect(after.resident.chat).toBeNull();
  }, 30_000);
});

describe("compacting a long conversation", () => {
  /** More than 0.4 of an 8 192-token window's ceiling in either language: 12 000 characters. */
  const LONG = "reč ".repeat(3000);

  const THREE_TURNS: readonly (readonly [string, string])[] = [
    ["prvo pitanje", "prvi odgovor"],
    ["drugo pitanje", "drugi odgovor"],
    ["treće pitanje", "treći odgovor"],
  ];

  async function conversation(host: ModuleHost): Promise<string> {
    const created = (await host.dispatch("assistant:createConversation", TRUSTED, {
      profileId,
      title: "Dug razgovor",
    })) as { conversations: { id: string }[] };
    return created.conversations[0]?.id ?? "";
  }

  /** Writes finished exchanges straight into the store, as earlier turns would have. */
  function seed(conversationId: string, exchanges: readonly (readonly [string, string])[]): void {
    const store = new ConversationStore(db.raw, profileId);
    for (const [question, answer] of exchanges) {
      store.appendTurn(
        conversationId,
        [
          { role: "user", text: question },
          { role: "assistant", text: answer, citations: [] },
        ],
        ENTRY.id,
        new Date(NOW).toISOString(),
      );
    }
  }

  async function send(host: ModuleHost, conversationId: string) {
    const started = (await host.dispatch("assistant:send", TRUSTED, {
      profileId,
      conversationId,
      text: "a sada?",
      workflowId: null,
    })) as { turnId: string };
    return await pollUntil(host, started.turnId, () => false);
  }

  async function compact(host: ModuleHost, conversationId: string) {
    const started = (await host.dispatch("assistant:compact", TRUSTED, {
      profileId,
      conversationId,
    })) as { turnId: string };
    return await pollUntil(host, started.turnId, () => false);
  }

  function compactions(events: readonly AssistantTurnEventEntry[]): string[] {
    return events.flatMap(({ event }) => (event.type === "compaction" ? [event.status] : []));
  }

  function summaryOf(thread: unknown): unknown {
    return (thread as { summary: unknown }).summary;
  }

  it("summarizes the head of a thread that outgrew its share of the window, and the turn reads the summary", async () => {
    const host = harness();
    const conversationId = await conversation(host);
    seed(conversationId, [[LONG, "prvi odgovor"], ...THREE_TURNS.slice(1)]);
    script = [{ text: "Korisnik je poslao dug tekst." }, { text: "Odgovor." }];
    const turn = await send(host, conversationId);

    expect(compactions(turn.events)).toEqual(["running", "done"]);
    const [summarize, answer] = lastModel?.requests ?? [];
    expect(summarize?.tools).toEqual([]);
    expect(summarize?.messages[1]?.content).toContain("User: reč reč");
    // The answer is asked with the summary in the system prompt and without the
    // turn it stands for, which the thread still holds.
    expect(answer?.messages[0]?.content).toContain("Korisnik je poslao dug tekst.");
    expect(answer?.messages.some((message) => message.content.includes(LONG))).toBe(false);
    expect(answer?.messages.some((message) => message.content === "drugo pitanje")).toBe(true);
    expect(summaryOf(turn.thread)).toEqual({ text: "Korisnik je poslao dug tekst.", through: 2 });
    expect((turn.thread as { messages: unknown[] }).messages).toHaveLength(8);
  }, 30_000);

  it("answers from the whole thread when the summary fails, and stores none", async () => {
    const host = harness();
    const conversationId = await conversation(host);
    seed(conversationId, [[LONG, "prvi odgovor"], ...THREE_TURNS.slice(1)]);
    script = [{ text: "   " }, { text: "Odgovor." }];
    const turn = await send(host, conversationId);
    expect(compactions(turn.events)).toEqual(["running", "failed"]);
    expect(turn.events.some((entry) => entry.event.type === "done")).toBe(true);
    expect(summaryOf(turn.thread)).toBeNull();
  }, 30_000);

  it("leaves a long thread whole when the profile turned compaction off", async () => {
    const host = harness();
    await host.dispatch("assistant:setRuntime", TRUSTED, {
      profileId,
      runtime: { ...DEFAULT_ASSISTANT_RUNTIME, autoCompact: false },
    });
    const conversationId = await conversation(host);
    seed(conversationId, [[LONG, "prvi odgovor"], ...THREE_TURNS.slice(1)]);
    script = [{ text: "Odgovor." }];
    const turn = await send(host, conversationId);
    expect(compactions(turn.events)).toEqual([]);
    expect(lastModel?.requests).toHaveLength(1);
    expect(summaryOf(turn.thread)).toBeNull();
  }, 30_000);

  it("compacts by hand, folds the last summary into the next, and refuses a thread too short to compact", async () => {
    const host = harness();
    const conversationId = await conversation(host);
    seed(conversationId, THREE_TURNS);
    script = [{ text: "Prvi sažetak." }];
    const first = await compact(host, conversationId);
    expect(compactions(first.events)).toEqual(["running", "done"]);
    expect(lastModel?.requests[0]?.messages[1]?.content).toContain("User: prvo pitanje");
    expect(summaryOf(first.thread)).toEqual({ text: "Prvi sažetak.", through: 2 });

    // What is left after a summary is the two turns a compaction always keeps.
    await expect(
      host.dispatch("assistant:compact", TRUSTED, { profileId, conversationId }),
    ).rejects.toThrow(/too short/);

    seed(conversationId, [
      ["četvrto pitanje", "četvrti odgovor"],
      ["peto pitanje", "peti odgovor"],
    ]);
    script = [{ text: "Drugi sažetak." }];
    const second = await compact(host, conversationId);
    const request = lastModel?.requests[0]?.messages[1]?.content ?? "";
    expect(request).toContain("Prvi sažetak.");
    expect(request).toContain("User: drugo pitanje");
    expect(request).not.toContain("prvo pitanje");
    expect(summaryOf(second.thread)).toEqual({ text: "Drugi sažetak.", through: 6 });
    const opened = (await host.dispatch("assistant:open", TRUSTED, {
      profileId,
      conversationId,
    })) as { messages: unknown[] };
    expect(summaryOf(opened)).toEqual({ text: "Drugi sažetak.", through: 6 });
    expect(opened.messages).toHaveLength(10);
  }, 30_000);

  it("refuses to compact while a turn runs in the profile", async () => {
    const host = harness();
    const conversationId = await conversation(host);
    seed(conversationId, THREE_TURNS);
    script = [{ text: "Odgovor." }];
    const started = (await host.dispatch("assistant:send", TRUSTED, {
      profileId,
      conversationId,
      text: "a sada?",
      workflowId: null,
    })) as { turnId: string };
    await expect(
      host.dispatch("assistant:compact", TRUSTED, { profileId, conversationId }),
    ).rejects.toBeInstanceOf(TurnBusyError);
    await pollUntil(host, started.turnId, () => false);
  }, 30_000);
});
