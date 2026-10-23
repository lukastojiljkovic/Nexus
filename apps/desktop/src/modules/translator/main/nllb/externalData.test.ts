import { describe, expect, it } from "vitest";

import { externalDataFormat } from "./externalData.js";

describe("externalDataFormat", () => {
  it("counts each graph's weight files, and names no graph that has none", () => {
    expect(
      externalDataFormat([
        "encoder_model_quantized.onnx",
        "decoder_model_merged_quantized.onnx",
        "decoder_model_merged_quantized.onnx_data",
        "decoder_model_merged_quantized.onnx_data_1",
      ]),
    ).toEqual({ "decoder_model_merged_quantized.onnx": 2 });
    expect(externalDataFormat(["encoder_model_quantized.onnx", "decoder_model_merged_quantized.onnx"])).toEqual({});
  });
});
