import { describe, expect, it } from "vitest";

import { PROTOCOL_LIMITS, PROTOCOL_VERSION, ProtocolError, parseHostEvent, parseHostRequest } from "./protocol.js";

/**
 * The validators of the main ↔ worker wire, driven from both directions.
 *
 * These are the checks that stand between a worker that has gone wrong and the
 * agent loop, so every case below is either a well-formed message that must be
 * accepted EXACTLY (no field invented, no field dropped) or a malformed one that
 * must be refused with the code that says why. The refusals matter more: a
 * protocol that accepts `stopReason: "whatever"` is a protocol whose consumer has
 * to guess.
 */
describe("parseHostRequest", () => {
  const loadChat = {
    v: PROTOCOL_VERSION,
    kind: "load-chat",
    seq: 7,
    id: "qwen3.5-4b-q4-k-m",
    modelPath: "C:\\Users\\luka\\AppData\\Roaming\\Nexus\\models\\qwen3.5-4b-q4-k-m\\Qwen3.5-4B-Q4_K_M.gguf",
    contextTokens: 262144,
    gpuLayers: "auto",
    threads: 10,
    title: "Qwen3.5 4B (Q4_K_M)",
    capabilities: ["chat", "tools"],
  };

  it("accepts what main actually sends", () => {
    expect(parseHostRequest(loadChat)).toMatchObject({
      kind: "load-chat",
      seq: 7,
      id: "qwen3.5-4b-q4-k-m",
      gpuLayers: "auto",
      threads: 10,
      capabilities: ["chat", "tools"],
    });
    // An absent projector is absent, not null: `exactOptionalPropertyTypes` on
    // both sides means the distinction is real.
    expect("projectorPath" in parseHostRequest(loadChat)).toBe(false);

    const complete = {
      v: PROTOCOL_VERSION,
      kind: "complete",
      seq: 8,
      callId: 1,
      messages: [
        { role: "system", content: "You are Nexus." },
        { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "tasks.create", arguments: {} }] },
        { role: "tool", content: "ok", toolCallId: "call_1" },
      ],
      tools: [
        {
          name: "tasks.create",
          description: { sr: "Pravi zadatak", en: "Creates a task" },
          parameters: { type: "object", properties: {} },
          effect: "write",
        },
      ],
      temperature: 0.8,
    };
    const parsed = parseHostRequest(complete);
    expect(parsed.kind).toBe("complete");
    if (parsed.kind === "complete") {
      expect(parsed.messages).toHaveLength(3);
      expect(parsed.tools[0]?.effect).toBe("write");
      expect(parsed.temperature).toBe(0.8);
    }

    expect(parseHostRequest({ v: PROTOCOL_VERSION, kind: "hardware", seq: 1 })).toEqual({
      v: PROTOCOL_VERSION,
      kind: "hardware",
      seq: 1,
    });
    expect(parseHostRequest({ v: PROTOCOL_VERSION, kind: "abort", callId: 3 })).toEqual({
      v: PROTOCOL_VERSION,
      kind: "abort",
      callId: 3,
    });
    expect(
      parseHostRequest({ v: PROTOCOL_VERSION, kind: "embed", seq: 4, callId: 2, texts: ["hi"] }),
    ).toMatchObject({ kind: "embed", texts: ["hi"] });
  });

  it("refuses a message from another protocol version, and says which", () => {
    expect(() => parseHostRequest({ ...loadChat, v: 99 })).toThrow(ProtocolError);
    expect(() => parseHostRequest({ ...loadChat, v: 99 })).toThrow(/protocol 1/);
  });

  it("refuses the shapes a caller can get wrong", () => {
    const cases: readonly unknown[] = [
      undefined,
      null,
      [],
      { v: PROTOCOL_VERSION, kind: "sing", seq: 1 },
      { v: PROTOCOL_VERSION, kind: "hardware" }, // no seq
      { ...loadChat, seq: 0 }, // ids start at 1
      { ...loadChat, seq: 1.5 },
      { ...loadChat, id: " padded " },
      { ...loadChat, modelPath: "" },
      { ...loadChat, modelPath: "a".repeat(PROTOCOL_LIMITS.pathChars + 1) },
      { ...loadChat, contextTokens: 0 },
      { ...loadChat, contextTokens: PROTOCOL_LIMITS.contextTokens + 1 },
      { ...loadChat, gpuLayers: "most" },
      { ...loadChat, threads: 0 },
      { ...loadChat, threads: 5000 },
      { ...loadChat, title: "" },
      { ...loadChat, capabilities: ["telepathy"] },
      {
        v: PROTOCOL_VERSION,
        kind: "complete",
        seq: 1,
        callId: 1,
        messages: [{ role: "robot", content: "hi" }],
        tools: [],
      },
      {
        v: PROTOCOL_VERSION,
        kind: "complete",
        seq: 1,
        callId: 1,
        messages: [{ role: "user", content: "hi", images: [{ mime: "image/gif", bytes: new Uint8Array(1) }] }],
        tools: [],
      },
      {
        v: PROTOCOL_VERSION,
        kind: "complete",
        seq: 1,
        callId: 1,
        messages: [{ role: "user", content: "hi" }],
        tools: [
          { name: "x", description: { sr: "a" }, parameters: {}, effect: "read" },
        ],
      },
    ];
    for (const value of cases) {
      expect(() => parseHostRequest(value), JSON.stringify(value)).toThrow(ProtocolError);
    }
  });
});

describe("parseHostEvent", () => {
  it("accepts the events the worker sends", () => {
    expect(
      parseHostEvent({
        v: PROTOCOL_VERSION,
        kind: "hardware",
        seq: 1,
        hardware: {
          totalRamBytes: 33_963_352_064,
          freeRamBytes: 15_940_681_728,
          cpuThreads: 10,
          gpus: [{ name: "NVIDIA GeForce RTX 4070 Laptop GPU", vramBytes: 6_723_469_312, backend: "vulkan" }],
        },
      }),
    ).toMatchObject({ kind: "hardware", seq: 1 });

    expect(
      parseHostEvent({
        v: PROTOCOL_VERSION,
        kind: "loaded",
        seq: 2,
        info: { id: "qwen3.5-2b-q4-k-m", title: "Qwen3.5 2B", capabilities: ["chat", "tools"], contextTokens: 8192 },
      }),
    ).toMatchObject({ kind: "loaded" });

    expect(parseHostEvent({ v: PROTOCOL_VERSION, kind: "token", callId: 4, text: "hi" })).toEqual({
      v: PROTOCOL_VERSION,
      kind: "token",
      callId: 4,
      text: "hi",
    });

    const result = parseHostEvent({
      v: PROTOCOL_VERSION,
      kind: "result",
      seq: 3,
      callId: 4,
      result: {
        text: "Zdravo",
        toolCalls: [{ id: "call_1", name: "app.open", arguments: { module: "notes" } }],
        stopReason: "tool-calls",
        promptTokens: 128,
        completionTokens: 8,
      },
    });
    expect(result).toMatchObject({ kind: "result" });
    if (result.kind === "result") expect(result.result.toolCalls[0]?.id).toBe("call_1");

    expect(
      parseHostEvent({
        v: PROTOCOL_VERSION,
        kind: "embedded",
        seq: 5,
        callId: 9,
        dimensions: 3,
        vectors: [[0.1, 0.2, 0.3]],
      }),
    ).toMatchObject({ kind: "embedded", dimensions: 3 });

    expect(parseHostEvent({ v: PROTOCOL_VERSION, kind: "unloaded", seq: 6 })).toMatchObject({ kind: "unloaded" });

    // A failure may carry neither id, one, or both: a refusal from the validator
    // itself has no request to point at.
    expect(parseHostEvent({ v: PROTOCOL_VERSION, kind: "failed", code: "load", message: "no" })).toMatchObject({
      kind: "failed",
      code: "load",
    });
    expect(
      parseHostEvent({ v: PROTOCOL_VERSION, kind: "failed", seq: 3, callId: 4, code: "refused", message: "busy" }),
    ).toMatchObject({ kind: "failed", seq: 3, callId: 4 });
  });

  it("refuses an event it cannot act on", () => {
    const cases: readonly unknown[] = [
      { v: PROTOCOL_VERSION, kind: "thought", seq: 1 },
      { v: PROTOCOL_VERSION, kind: "token", callId: 0, text: "hi" },
      {
        v: PROTOCOL_VERSION,
        kind: "result",
        seq: 1,
        callId: 1,
        result: { text: "", toolCalls: [], stopReason: "maybe", promptTokens: 0, completionTokens: 0 },
      },
      {
        v: PROTOCOL_VERSION,
        kind: "result",
        seq: 1,
        callId: 1,
        result: { text: "", toolCalls: [], stopReason: "end", promptTokens: -1, completionTokens: 0 },
      },
      { v: PROTOCOL_VERSION, kind: "embedded", seq: 1, callId: 1, dimensions: 3, vectors: [[0.1, 0.2]] },
      { v: PROTOCOL_VERSION, kind: "embedded", seq: 1, callId: 1, dimensions: 2, vectors: [[0.1, Number.NaN]] },
      { v: PROTOCOL_VERSION, kind: "hardware", seq: 1, hardware: { totalRamBytes: 1, freeRamBytes: 1, cpuThreads: 1, gpus: [] } },
      {
        v: PROTOCOL_VERSION,
        kind: "hardware",
        seq: 1,
        hardware: {
          totalRamBytes: 1,
          freeRamBytes: 1,
          cpuThreads: 1,
          gpus: [{ name: "x", vramBytes: 1, backend: "opencl" }],
        },
      },
      { v: PROTOCOL_VERSION, kind: "failed", code: "sad", message: "no" },
      { v: PROTOCOL_VERSION, kind: "loaded", seq: 1, info: { id: "x", title: "x", capabilities: ["nope"], contextTokens: 1 } },
      { v: PROTOCOL_VERSION, kind: "loaded", seq: 1, info: { id: "x", title: "x", capabilities: ["chat"], contextTokens: 0 } },
    ];
    for (const value of cases) {
      expect(() => parseHostEvent(value), JSON.stringify(value)).toThrow(ProtocolError);
    }
  });
});
