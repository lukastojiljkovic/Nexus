/**
 * NLLB-200, run. Loaded in the translator's worker process only, never in main.
 *
 * Offline and local, by the voice worker's rules (`main/assistant/voice/inference.ts`):
 * remote models off on every load, no cache directory, and the folder is one
 * main resolved from an installed, signature-verified pack. `q8` is the dtype
 * whose files are the `_quantized` graphs the packs hold.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { env, LogLevel, pipeline } from "@huggingface/transformers";
import type { TranslationPipeline } from "@huggingface/transformers";

import { externalDataFormat } from "./externalData.js";

export interface Translator {
  /** One sentence from `source` to `target`, both NLLB codes. */
  translate(sentence: string, source: string, target: string): Promise<string>;
}

export async function loadTranslator(directory: string): Promise<Translator> {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useFSCache = false;
  env.useBrowserCache = false;
  env.logLevel = LogLevel.ERROR;
  const external = externalDataFormat(readdirSync(join(directory, "onnx")));
  const model: TranslationPipeline = await pipeline("translation", directory, {
    dtype: "q8",
    ...(Object.keys(external).length === 0 ? {} : { use_external_data_format: external }),
  });
  return {
    async translate(sentence, source, target) {
      const output = await model(sentence, { src_lang: source, tgt_lang: target });
      const first = Array.isArray(output) ? output[0] : output;
      return first !== undefined && "translation_text" in first ? first.translation_text : "";
    },
  };
}
