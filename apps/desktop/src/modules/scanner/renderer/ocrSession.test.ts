import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RgbaImage } from "./imageOps.js";
import { createScanSession } from "./ocrSession.js";

/**
 * The session's abort path, with the engine replaced by a double: the real
 * worker needs WebAssembly and a DOM, and neither exists in this test
 * environment. What is pinned is the decision — an abort ends the wait, stops
 * the engine, and never starts a recognition that nobody is waiting for.
 */

const engine = vi.hoisted(() => ({
  recognize: vi.fn(),
  terminate: vi.fn(async () => undefined),
  create: vi.fn(),
}));

vi.mock("tesseract.js", () => ({
  OEM: { LSTM_ONLY: 1 },
  createWorker: engine.create,
}));
vi.mock("./canvasImage.js", () => ({ canvasFromPixels: () => null }));
vi.mock("./ocrAssets.js", () => ({
  OCR_ASSETS: { worker: "file:///app/ocr/worker.js", core: "file:///app/ocr/core/" },
}));

const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) } as RgbaImage;

describe("createScanSession", () => {
  beforeEach(() => {
    engine.recognize.mockReset();
    engine.terminate.mockClear();
    engine.create.mockReset();
    engine.create.mockImplementation(async () => ({
      recognize: engine.recognize,
      terminate: engine.terminate,
    }));
  });

  it("ends a scan that is aborted while the engine recognises, and stops the engine", async () => {
    engine.recognize.mockReturnValue(new Promise(() => undefined));
    const session = createScanSession();
    const controller = new AbortController();

    const scan = session.recognize(image, ["eng"], () => undefined, controller.signal);
    await vi.waitFor(() => expect(engine.recognize).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(scan).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.terminate).toHaveBeenCalledTimes(1);
  });

  it("does not create an engine or recognise anything for a scan that is already cancelled", async () => {
    const session = createScanSession();
    const controller = new AbortController();
    controller.abort();

    await expect(
      session.recognize(image, ["eng"], () => undefined, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.create).not.toHaveBeenCalled();
    expect(engine.recognize).not.toHaveBeenCalled();
  });
});
