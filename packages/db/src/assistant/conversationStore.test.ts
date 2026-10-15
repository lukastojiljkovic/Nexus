import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ASSISTANT_EXPORT_VERSION,
  AssistantNotFoundError,
  AssistantValidationError,
  ConversationStore,
  MAX_CONVERSATION_TITLE_LENGTH,
  NexusDatabase,
  emptyAssistantExport,
  openDatabase,
  parseAssistantExport,
  uuidv7,
  type AssistantExport,
} from "../index.js";

/**
 * THE ASSISTANT'S CONVERSATIONS through their store (migration 91, ADR-106).
 *
 * A fresh, real, encrypted-capable database per test - the migrations are the
 * expensive part and this file runs two of them (the one the store writes in,
 * and the one an export is imported into) - so every statement here is the
 * statement the app runs.
 */

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-01T09:30:00.000Z";

let dir: string;
let db: NexusDatabase;
let other: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-assistant-"));
  db = openDatabase({ path: join(dir, "assistant.db") });
  other = openDatabase({ path: join(dir, "restored.db") });
});

afterEach(() => {
  db.close();
  other.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(handle: NexusDatabase = db): string {
  const id = uuidv7();
  handle.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

/** The citation the knowledge base produces for a passage of the app manual. */
const MANUAL_CITATION = {
  kind: "app-manual" as const,
  id: "sr/podesavanja",
  title: "Podešavanja",
  locator: "Moduli",
  location: { module: "settings", settings: "modules" },
};

/** A citation from a pack whose notice is `safety`, which the message must then carry. */
const SAFETY_CITATION = {
  kind: "pack" as const,
  id: "prezivljavanje/hidracija",
  title: "Voda",
  packId: "prezivljavanje",
  safety: true,
  location: { module: "reader" },
};

describe("ConversationStore", () => {
  it("keeps a conversation with its messages, in the order the turn produced them", () => {
    const store = new ConversationStore(db.raw, createProfile());
    const conversation = store.createConversation("Kako da isključim modul?", NOW);

    store.appendTurn(
      conversation.id,
      [
        { role: "user", text: "Kako da isključim modul?" },
        {
          role: "assistant",
          text: "Otvori Podešavanja, pa Moduli.",
          citations: [MANUAL_CITATION],
        },
      ],
      "qwen2.5-7b-instruct-q4_k_m",
      LATER,
    );

    const messages = store.listMessages(conversation.id);
    expect(messages.map((message) => [message.ordinal, message.role, message.text])).toEqual([
      [0, "user", "Kako da isključim modul?"],
      [1, "assistant", "Otvori Podešavanja, pa Moduli."],
    ]);
    expect(messages[1]?.citations).toEqual([MANUAL_CITATION]);
    expect(messages[1]?.safety).toBe(false);
    // The thread's own record of what answered it, and the instant it was last
    // written - both read from the row rather than from the caller.
    const after = store.conversation(conversation.id);
    expect(after?.modelId).toBe("qwen2.5-7b-instruct-q4_k_m");
    expect(after?.updatedAt).toBe(LATER);
  });

  it("flags a message whose citations include a safety pack, and only that one", () => {
    const store = new ConversationStore(db.raw, createProfile());
    const conversation = store.createConversation("Zaglavljen", NOW);
    store.appendTurn(
      conversation.id,
      [
        { role: "assistant", text: "Prvo pozovi 112.", citations: [SAFETY_CITATION] },
        { role: "assistant", text: "Evo gde je kartica.", citations: [MANUAL_CITATION] },
      ],
      null,
      NOW,
    );
    const [first, second] = store.listMessages(conversation.id);
    expect(first?.safety).toBe(true);
    expect(second?.safety).toBe(false);
    // `null` model id: nothing answered, so the thread says nothing about it.
    expect(store.conversation(conversation.id)?.modelId).toBeNull();
  });

  it("keeps a tool exchange as two messages, the call and its answer", () => {
    const store = new ConversationStore(db.raw, createProfile());
    const conversation = store.createConversation("Zadaci", NOW);
    store.appendTurn(
      conversation.id,
      [
        { role: "user", text: "Napravi zadatak da platim račun." },
        {
          role: "assistant",
          text: "",
          toolCalls: [
            { id: "call_1", name: "tasks.create", arguments: { title: "Plati račun" } },
          ],
        },
        {
          role: "tool",
          text: "Napravljen zadatak „Plati račun“.",
          toolCallId: "call_1",
          citations: [MANUAL_CITATION],
        },
      ],
      null,
      NOW,
    );
    const messages = store.listMessages(conversation.id);
    expect(messages[1]?.toolCalls).toEqual([
      { id: "call_1", name: "tasks.create", arguments: { title: "Plati račun" } },
    ]);
    expect(messages[2]?.toolCallId).toBe("call_1");
    expect(messages[2]?.toolCalls).toBeNull();
    // The citation count travels with the tool message's text, which is what a
    // restore must not lose - the page needs it to draw the source under a step.
    expect(messages[2]?.citations).toEqual([MANUAL_CITATION]);
  });

  it("records a tool's outcome in migration 93's column, and reads back all three states", () => {
    const store = new ConversationStore(db.raw, createProfile());
    const conversation = store.createConversation("Alatke", NOW);
    // The column migration 93 adds, on the table migration 91 created: nullable,
    // because "no outcome recorded" is a state a row can be in.
    const columns = (
      db.raw.prepare("PRAGMA table_info(assistant_messages)").all() as {
        name: string;
        type: string;
        notnull: number;
      }[]
    )
      .map((column) => ({ name: column.name, type: column.type, notnull: column.notnull }))
      .filter((column) => column.name === "ok");
    expect(columns).toEqual([{ name: "ok", type: "INTEGER", notnull: 0 }]);

    store.appendTurn(
      conversation.id,
      [
        {
          role: "assistant",
          text: "",
          toolCalls: [{ id: "call_1", name: "tasks.create", arguments: {} }],
        },
        { role: "tool", text: "Napravljen zadatak.", toolCallId: "call_1", ok: true },
        { role: "tool", text: "Nema tog zadatka.", toolCallId: "call_2", ok: false },
        // A tool row with no outcome of its own: every row written before the
        // column existed, and a caller that did not record one.
        { role: "tool", text: "Bez ishoda.", toolCallId: "call_3" },
      ],
      null,
      NOW,
    );

    const messages = store.listMessages(conversation.id);
    expect(messages.map((message) => message.ok)).toEqual([
      undefined,
      true,
      false,
      undefined,
    ]);
    // And the column holds this schema's own boolean - 1, 0 - with NULL for the
    // two rows the question does not belong to.
    const rows = db.raw
      .prepare("SELECT ordinal, ok FROM assistant_messages ORDER BY ordinal")
      .all() as { ordinal: number; ok: number | null }[];
    expect(rows).toEqual([
      { ordinal: 0, ok: null },
      { ordinal: 1, ok: 1 },
      { ordinal: 2, ok: 0 },
      { ordinal: 3, ok: null },
    ]);
  });

  it("refuses an outcome that is not a boolean, and one on a message that is not a tool result", () => {
    const store = new ConversationStore(db.raw, createProfile());
    const conversation = store.createConversation("Alatke", NOW);
    expect(() =>
      store.appendTurn(
        conversation.id,
        [{ role: "tool", text: "Rezultat.", toolCallId: "call_1", ok: "yes" as never }],
        null,
        NOW,
      ),
    ).toThrow(AssistantValidationError);
    expect(() =>
      store.appendTurn(
        conversation.id,
        [{ role: "assistant", text: "Odgovor.", ok: true }],
        null,
        NOW,
      ),
    ).toThrow(AssistantValidationError);
    // A refused turn writes nothing at all.
    expect(store.listMessages(conversation.id)).toEqual([]);

    // The archive reader makes the same refusal, for a section somebody edited by
    // hand, and names the field it is about.
    expect(() =>
      parseAssistantExport({
        version: ASSISTANT_EXPORT_VERSION,
        defaultTier: "balance",
        conversations: [
          {
            title: "Staro",
            modelId: null,
            createdAt: NOW,
            updatedAt: NOW,
            messages: [
              {
                role: "tool",
                text: "Rezultat.",
                citations: [],
                toolCallId: "call_1",
                createdAt: NOW,
                ok: "yes",
              },
            ],
          },
        ],
      }),
    ).toThrow('Assistant data: "conversations[0].messages[0].ok" must be a boolean.');
  });

  it("orders the list newest first and renames one thread without touching the rest", () => {
    const store = new ConversationStore(db.raw, createProfile());
    const first = store.createConversation("Prvi", NOW);
    const second = store.createConversation("Drugi", NOW);
    store.appendTurn(first.id, [{ role: "user", text: "zdravo" }], null, LATER);
    expect(store.listConversations().map((conversation) => conversation.id)).toEqual([
      first.id,
      second.id,
    ]);
    const renamed = store.renameConversation(second.id, "  Preimenovan  ", LATER);
    expect(renamed.title).toBe("Preimenovan");
    expect(store.conversation(first.id)?.title).toBe("Prvi");
  });

  it("removes a conversation and its messages with it", () => {
    const store = new ConversationStore(db.raw, createProfile());
    const conversation = store.createConversation("Obriši me", NOW);
    store.appendTurn(conversation.id, [{ role: "user", text: "zdravo" }], null, NOW);
    store.removeConversation(conversation.id);
    expect(store.listConversations()).toEqual([]);
    const rows = db.raw
      .prepare("SELECT count(*) AS n FROM assistant_messages WHERE conversation_id = ?")
      .get(conversation.id) as { n: number };
    expect(rows.n).toBe(0);
  });

  it("refuses a blank or over-long title, and a conversation that is not this profile's", () => {
    const store = new ConversationStore(db.raw, createProfile());
    expect(() => store.createConversation("   ", NOW)).toThrow(AssistantValidationError);
    expect(() =>
      store.createConversation("x".repeat(MAX_CONVERSATION_TITLE_LENGTH + 1), NOW),
    ).toThrow(AssistantValidationError);
    expect(() => store.renameConversation(uuidv7(), "Naslov", NOW)).toThrow(
      AssistantNotFoundError,
    );
    // Another profile's thread is invisible, not merely unwritable: the store
    // scopes every statement by `profile_id` (SEC-EL-02).
    const mine = store.createConversation("Moja", NOW);
    const stranger = new ConversationStore(db.raw, createProfile());
    expect(stranger.conversation(mine.id)).toBeNull();
    expect(stranger.listConversations()).toEqual([]);
  });

  it("refuses a tool message without a call, and an assistant message that answers one", () => {
    const store = new ConversationStore(db.raw, createProfile());
    const conversation = store.createConversation("N", NOW);
    expect(() =>
      store.appendTurn(conversation.id, [{ role: "tool", text: "rezultat" }], null, NOW),
    ).toThrow(AssistantValidationError);
    expect(() =>
      store.appendTurn(
        conversation.id,
        [{ role: "assistant", text: "rezultat", toolCallId: "call_1" }],
        null,
        NOW,
      ),
    ).toThrow(AssistantValidationError);
  });

  it("refuses a citation whose kind is not a source kind", () => {
    const store = new ConversationStore(db.raw, createProfile());
    const conversation = store.createConversation("N", NOW);
    expect(() =>
      store.appendTurn(
        conversation.id,
        [
          {
            role: "assistant",
            text: "…",
            citations: [{ kind: "telepatija" as never, id: "x", title: "X" }],
          },
        ],
        null,
        NOW,
      ),
    ).toThrow(AssistantValidationError);
  });

  it("answers the shipped tier where no preference is stored, and keeps a chosen one", () => {
    const store = new ConversationStore(db.raw, createProfile());
    expect(store.settings()).toEqual({ defaultTier: "balance", chatModelId: null });
    expect(store.setDefaultTier("speed", NOW)).toEqual({
      defaultTier: "speed",
      chatModelId: null,
    });
    expect(store.settings()).toEqual({ defaultTier: "speed", chatModelId: null });
  });

  it("keeps a chosen chat model, clears it with a tier, and holds it on a row the migration gave a column", () => {
    const store = new ConversationStore(db.raw, createProfile());
    // The column migration 92 adds, on the settings row migration 91 created: the
    // store's own reads and writes below are its only proof of shape.
    const columns = (
      db.raw.prepare("PRAGMA table_info(assistant_settings)").all() as {
        name: string;
        type: string;
        notnull: number;
      }[]
    )
      .map((column) => ({ name: column.name, type: column.type, notnull: column.notnull }))
      .filter((column) => column.name === "chat_model_id");
    expect(columns).toEqual([{ name: "chat_model_id", type: "TEXT", notnull: 0 }]);

    expect(store.setChatModel("qwen2.5-3b-instruct-q4_k_m", NOW)).toEqual({
      defaultTier: "balance",
      chatModelId: "qwen2.5-3b-instruct-q4_k_m",
    });
    expect(store.settings()).toEqual({
      defaultTier: "balance",
      chatModelId: "qwen2.5-3b-instruct-q4_k_m",
    });
    // Choosing a tier again is choosing the tier's own pick: the choice goes.
    expect(store.setDefaultTier("speed", LATER)).toEqual({
      defaultTier: "speed",
      chatModelId: null,
    });
    expect(store.settings()).toEqual({ defaultTier: "speed", chatModelId: null });
    // And clearing by hand is the same state as never having chosen.
    store.setChatModel("qwen2.5-3b-instruct-q4_k_m", LATER);
    expect(store.setChatModel(null, LATER)).toEqual({ defaultTier: "speed", chatModelId: null });
  });

  it("refuses a blank chosen-model id, and writes no row for one", () => {
    const profileId = createProfile();
    const store = new ConversationStore(db.raw, profileId);
    expect(() => store.setChatModel("", NOW)).toThrow(AssistantValidationError);
    // An id is bounded at 200 characters, the same as every other id the wire and
    // the archive readers bound.
    expect(() => store.setChatModel("x".repeat(201), NOW)).toThrow(AssistantValidationError);
    const rows = db.raw
      .prepare("SELECT count(*) AS n FROM assistant_settings WHERE profile_id = ?")
      .get(profileId) as { n: number };
    expect(rows.n).toBe(0);
  });

  it("round-trips through export and import into a fresh database", () => {
    const store = new ConversationStore(db.raw, createProfile());
    const conversation = store.createConversation("Putovanje", NOW);
    store.appendTurn(
      conversation.id,
      [
        { role: "user", text: "Koliko traje put?" },
        {
          role: "assistant",
          text: "Oko tri sata.",
          citations: [SAFETY_CITATION],
          toolCalls: [{ id: "call_1", name: "app.open", arguments: { module: "maps" } }],
        },
      ],
      "llama-3.2-3b-instruct-q4_k_m",
      LATER,
    );
    store.setDefaultTier("intelligence", LATER);
    // A chosen model is DEVICE data - a file on this machine - so the section
    // carries the tier and says nothing about the choice.
    store.setChatModel("downloaded-model-q4_k_m", LATER);
    const section = store.exportData();

    // The section is a plain, versioned value: it survives JSON, which is what an
    // archive does to it.
    const parsed = parseAssistantExport(JSON.parse(JSON.stringify(section)) as unknown);
    expect(parsed.version).toBe(ASSISTANT_EXPORT_VERSION);
    expect("chatModelId" in section).toBe(false);

    const restored = new ConversationStore(other.raw, createProfile(other));
    restored.importData(parsed, NOW);
    expect(restored.settings()).toEqual({ defaultTier: "intelligence", chatModelId: null });
    const [thread] = restored.listConversations();
    expect(thread?.title).toBe("Putovanje");
    expect(thread?.modelId).toBe("llama-3.2-3b-instruct-q4_k_m");
    const messages = restored.listMessages(thread?.id ?? "");
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.citations).toEqual([SAFETY_CITATION]);
    expect(messages[1]?.safety).toBe(true);
    expect(messages[1]?.toolCalls).toEqual([
      { id: "call_1", name: "app.open", arguments: { module: "maps" } },
    ]);
    // Re-minted ids: a conversation's key is this database's own.
    expect(thread?.id).not.toBe(conversation.id);
  });

  it("carries a tool's outcome through an export and back, and takes an export written before it", () => {
    const store = new ConversationStore(db.raw, createProfile());
    const conversation = store.createConversation("Alatke", NOW);
    store.appendTurn(
      conversation.id,
      [
        {
          role: "assistant",
          text: "",
          toolCalls: [{ id: "call_1", name: "tasks.create", arguments: { title: "" } }],
        },
        {
          role: "tool",
          text: "Neuspešno: naslov je obavezan.",
          toolCallId: "call_1",
          ok: false,
        },
      ],
      null,
      NOW,
    );

    const parsed = parseAssistantExport(JSON.parse(JSON.stringify(store.exportData())) as unknown);
    expect(parsed.conversations[0]?.messages[1]).toEqual({
      role: "tool",
      text: "Neuspešno: naslov je obavezan.",
      citations: [],
      toolCallId: "call_1",
      ok: false,
      createdAt: NOW,
    });

    const restored = new ConversationStore(other.raw, createProfile(other));
    restored.importData(parsed, LATER);
    const [thread] = restored.listConversations();
    expect(restored.listMessages(thread?.id ?? "").map((message) => message.ok)).toEqual([
      undefined,
      false,
    ]);

    // An archive written before migration 93 carries no such field at all, which
    // is the same "no outcome recorded" every row of that age holds: accepted on
    // the way in, and read as a tool that was done (`main/register.ts`).
    const old = parseAssistantExport({
      version: ASSISTANT_EXPORT_VERSION,
      defaultTier: "balance",
      conversations: [
        {
          title: "Staro",
          modelId: null,
          createdAt: NOW,
          updatedAt: NOW,
          messages: [
            {
              role: "tool",
              text: "Otvoreno.",
              citations: [],
              toolCallId: "call_1",
              createdAt: NOW,
            },
          ],
        },
      ],
    });
    expect(old.conversations[0]?.messages[0]?.ok).toBeUndefined();
    restored.importData(old, LATER);
    const [older] = restored.listConversations();
    expect(restored.listMessages(older?.id ?? "").map((message) => message.ok)).toEqual([
      undefined,
    ]);
  });

  it("resets a profile to nothing when the archive names no assistant section", () => {
    const store = new ConversationStore(db.raw, createProfile());
    const conversation = store.createConversation("Staro", NOW);
    store.appendTurn(conversation.id, [{ role: "user", text: "zdravo" }], null, NOW);
    store.setDefaultTier("speed", NOW);
    store.setChatModel("downloaded-model-q4_k_m", NOW);
    store.importData(undefined, LATER);
    expect(store.listConversations()).toEqual([]);
    // The row goes, so the choice goes with it: the column is a column of the
    // settings row, not a second table a reset could forget.
    expect(store.settings()).toEqual({ defaultTier: "balance", chatModelId: null });
    // An import into a profile that never had one is the same answer, and the
    // whole write is one transaction: the counters below it are what a partial
    // import would have left behind.
    store.importData(emptyAssistantExport(), LATER);
    expect(store.listConversations()).toEqual([]);
  });

  it("refuses an archive from another version, and one that is not a section at all", () => {
    const store = new ConversationStore(db.raw, createProfile());
    expect(() =>
      store.importData({ version: 99, defaultTier: "balance", conversations: [] } as never, NOW),
    ).toThrow(AssistantValidationError);
    expect(() => parseAssistantExport({ version: 1 })).toThrow(AssistantValidationError);
    expect(() => parseAssistantExport(null)).toThrow(AssistantValidationError);
    // A refused section writes nothing at all.
    const conversation = store.createConversation("Ostaje", NOW);
    expect(() =>
      store.importData({ version: 1, defaultTier: "balance", conversations: "no" } as never, NOW),
    ).toThrow(AssistantValidationError);
    expect(store.conversation(conversation.id)?.title).toBe("Ostaje");
  });

  it("writes the version it read, so a round trip cannot silently reinterpret one", () => {
    const section: AssistantExport = emptyAssistantExport();
    expect(parseAssistantExport(section)).toEqual(section);
  });
});
