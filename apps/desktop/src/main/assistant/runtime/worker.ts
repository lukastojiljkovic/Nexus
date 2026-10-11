/**
 * THE UTILITY PROCESS: llama.cpp's home, and the only entry point to this file
 * is a fork from main.
 *
 * Everything it does is one loop: validate a message, hand it to the engine,
 * answer with a validated event. It holds no state of its own beyond the engine
 * — no database, no userData, no network, no Electron API — which is what makes
 * the split worth having: the process that can block for a minute on a 16 GB
 * model is a process that owns nothing.
 *
 * A MESSAGE IT CANNOT READ IS ANSWERED, never dropped. Silently ignoring one
 * would leave main waiting for an event that will not come, and the user staring
 * at a spinner; the refusal names the protocol version and travels back on the
 * same port.
 */

import { hardwareFromReading } from "./hardware.js";
import { EngineError, createLlamaEngine } from "./llama.js";
import { PROTOCOL_VERSION, ProtocolError, parseHostRequest, type HostEvent } from "./protocol.js";

const engine = createLlamaEngine({
  onToken: (callId, text) => {
    post({ v: PROTOCOL_VERSION, kind: "token", callId, text });
  },
  log: (message) => {
    // Worker logs go to the worker's stderr, which Electron pipes to the parent's
    // console in development and to nothing in a packaged build. They carry the
    // runtime's own diagnostics and never a line of the user's text.
    console.error(message);
  },
});

function post(event: HostEvent): void {
  process.parentPort.postMessage(event);
}

function fail(error: unknown, seq?: number, callId?: number): void {
  const code = error instanceof EngineError ? error.code : "internal";
  const message = error instanceof Error ? error.message : String(error);
  post({
    v: PROTOCOL_VERSION,
    kind: "failed",
    ...(seq === undefined ? {} : { seq }),
    ...(callId === undefined ? {} : { callId }),
    code,
    message,
  });
}

process.parentPort.on("message", (event) => {
  handle(event.data);
});

function handle(value: unknown): void {
  let request;
  try {
    request = parseHostRequest(value);
  } catch (error) {
    if (error instanceof ProtocolError) {
      fail(error, undefined, undefined);
      return;
    }
    throw error;
  }

  switch (request.kind) {
    case "hardware":
      void engine
        .hardware()
        .then((reading) => {
          post({
            v: PROTOCOL_VERSION,
            kind: "hardware",
            seq: request.seq,
            hardware: hardwareFromReading(reading),
          });
        })
        .catch((error: unknown) => {
          fail(error, request.seq);
        });
      return;
    case "load-chat":
      void engine
        .loadChat({
          id: request.id,
          title: request.title,
          capabilities: request.capabilities,
          modelPath: request.modelPath,
          contextTokens: request.contextTokens,
          gpuLayers: request.gpuLayers,
          threads: request.threads,
        })
        .then((info) => {
          post({ v: PROTOCOL_VERSION, kind: "loaded", seq: request.seq, info });
        })
        .catch((error: unknown) => {
          fail(error, request.seq);
        });
      return;
    case "load-embedder":
      void engine
        .loadEmbedder({
          id: request.id,
          modelPath: request.modelPath,
          contextTokens: request.contextTokens,
          threads: request.threads,
        })
        .then((info) => {
          post({
            v: PROTOCOL_VERSION,
            kind: "embedder-ready",
            seq: request.seq,
            modelId: info.modelId,
            dimensions: info.dimensions,
          });
        })
        .catch((error: unknown) => {
          fail(error, request.seq);
        });
      return;
    case "complete":
      void engine
        .complete(request.callId, {
          messages: request.messages,
          tools: request.tools,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
        })
        .then((result) => {
          post({ v: PROTOCOL_VERSION, kind: "result", seq: request.seq, callId: request.callId, result });
        })
        .catch((error: unknown) => {
          fail(error, request.seq, request.callId);
        });
      return;
    case "embed":
      void engine
        .embed(request.callId, request.texts)
        .then((result) => {
          post({
            v: PROTOCOL_VERSION,
            kind: "embedded",
            seq: request.seq,
            callId: request.callId,
            dimensions: result.dimensions,
            // `number[][]` rather than `Float32Array[]`: the typed array is what
            // the engine works in, and a plain array is what the structured clone
            // algorithm is guaranteed to carry and the validator can check
            // component by component.
            vectors: result.vectors.map((vector) => [...vector]),
          });
        })
        .catch((error: unknown) => {
          fail(error, request.seq, request.callId);
        });
      return;
    case "abort":
      try {
        engine.abort(request.callId);
      } catch (error) {
        fail(error, undefined, request.callId);
      }
      return;
    case "unload":
      void engine
        .unloadAll()
        .then(() => {
          post({ v: PROTOCOL_VERSION, kind: "unloaded", seq: request.seq });
        })
        .catch((error: unknown) => {
          fail(error, request.seq);
        });
      return;
  }
}
