import { describe, expect, it } from "vitest";
import {
  COMPACT_HISTORY_SHARE,
  KEEP_RECENT_TURNS,
  SUMMARY_MAX_TOKENS,
  compactionCut,
  shouldCompact,
  summarizeConversation,
} from "./compact.js";
import { answerReserveTokens, createEstimator } from "./budget.js";
import { createScriptedModel } from "./fakeModel.js";
import { isFenced } from "./fence.js";
import type { ChatMessage } from "./contract.js";

function exchange(question: string, answer: string): ChatMessage[] {
  return [
    { role: "user", content: question },
    { role: "assistant", content: answer },
  ];
}

const THREE_TURNS: ChatMessage[] = [
  ...exchange("prvo pitanje", "prvi odgovor"),
  { role: "user", content: "napravi zadatak" },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "call_1", name: "tasks.create", arguments: { title: "Kupi hleb" } }],
  },
  { role: "tool", content: '{"id":"t1","title":"Kupi hleb"}', toolCallId: "call_1", ok: true },
  { role: "assistant", content: "Zadatak je napravljen." },
  ...exchange("treće pitanje", "treći odgovor"),
];

describe("compactionCut", () => {
  it("keeps the last turns whole and cuts at a user message, so no call is parted from its result", () => {
    expect(KEEP_RECENT_TURNS).toBe(2);
    // The second turn starts at index 2: everything from there on is kept.
    expect(compactionCut(THREE_TURNS)).toBe(2);
  });

  it("is zero when the thread holds no more than the turns it keeps", () => {
    expect(compactionCut([])).toBe(0);
    expect(compactionCut(exchange("a", "b"))).toBe(0);
    expect(compactionCut([...exchange("a", "b"), ...exchange("c", "d")])).toBe(0);
  });
});

describe("shouldCompact", () => {
  const window = 4096;
  const share = Math.floor((window - answerReserveTokens(window)) * COMPACT_HISTORY_SHARE);

  it("leaves a history that fits in its share of the window alone", () => {
    expect(shouldCompact(THREE_TURNS, window, "sr")).toBe(false);
  });

  it("compacts a history over its share, when there is a head to summarize", () => {
    const estimate = createEstimator("sr");
    const long = "reč ".repeat(Math.ceil((share * 2.4) / 4) + 10);
    expect(estimate(long)).toBeGreaterThan(share);
    const history = [...exchange(long, "odgovor"), ...THREE_TURNS];
    expect(shouldCompact(history, window, "sr")).toBe(true);
    // One enormous turn has no head: the budget's own trimming is all there is.
    expect(shouldCompact(exchange(long, "odgovor"), window, "sr")).toBe(false);
  });
});

describe("summarizeConversation", () => {
  it("asks for a summary with no tools and a bounded answer, from a fenced transcript", async () => {
    const model = createScriptedModel([{ text: "  Korisnik je napravio zadatak „Kupi hleb“.  " }]);
    const summary = await summarizeConversation({
      model,
      earlier: null,
      messages: THREE_TURNS.slice(0, 6),
      locale: "sr",
      signal: new AbortController().signal,
    });
    expect(summary).toBe("Korisnik je napravio zadatak „Kupi hleb“.");
    expect(model.requests).toHaveLength(1);
    const request = model.requests[0];
    expect(request?.tools).toEqual([]);
    expect(request?.maxTokens).toBe(SUMMARY_MAX_TOKENS);
    const [system, user] = request?.messages ?? [];
    expect(system?.role).toBe("system");
    expect(system?.content).toContain("Serbian");
    expect(user?.role).toBe("user");
    expect(isFenced(user?.content ?? "")).toBe(true);
    expect(user?.content).toContain("User: prvo pitanje");
    expect(user?.content).toContain("Assistant: prvi odgovor");
    expect(user?.content).toContain("tasks.create");
    expect(user?.content).toContain('Tool result: {"id":"t1","title":"Kupi hleb"}');
  });

  it("folds the thread's last summary in, so the new one stands for everything before the cut", async () => {
    const model = createScriptedModel([{ text: "Nov sažetak." }]);
    await summarizeConversation({
      model,
      earlier: "Stari sažetak o putovanju.",
      messages: exchange("još jedno", "odgovor"),
      locale: "en",
      signal: new AbortController().signal,
    });
    const user = model.requests[0]?.messages[1]?.content ?? "";
    expect(user).toContain("Stari sažetak o putovanju.");
    expect(user.indexOf("Stari sažetak")).toBeLessThan(user.indexOf("User: još jedno"));
    expect(model.requests[0]?.messages[0]?.content).toContain("English");
  });

  it("summarizes a head larger than the window in passes, each carrying the last one's summary", async () => {
    const passes = Array.from({ length: 10 }, (_, index) => ({ text: `Deo ${index + 1}.` }));
    const model = createScriptedModel(passes, { contextTokens: 2048 });
    const long = "rečenica koja se ponavlja ".repeat(40);
    const messages = [...exchange(long, long), ...exchange(long, long), ...exchange(long, long)];
    const summary = await summarizeConversation({
      model,
      earlier: null,
      messages,
      locale: "sr",
      signal: new AbortController().signal,
    });
    expect(model.requests.length).toBeGreaterThan(1);
    expect(model.requests.length).toBeLessThan(passes.length);
    expect(summary).toBe(`Deo ${model.requests.length}.`);
    // Every pass after the first starts from the summary before it.
    expect(model.requests[1]?.messages[1]?.content).toContain("Deo 1.");
  });

  it("refuses an empty summary and an aborted one rather than storing nothing", async () => {
    await expect(
      summarizeConversation({
        model: createScriptedModel([{ text: "   " }]),
        earlier: null,
        messages: exchange("a", "b"),
        locale: "sr",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/no summary/);
    const controller = new AbortController();
    controller.abort();
    await expect(
      summarizeConversation({
        model: createScriptedModel([{ text: "Sažetak." }]),
        earlier: null,
        messages: exchange("a", "b"),
        locale: "sr",
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/);
  });
});
