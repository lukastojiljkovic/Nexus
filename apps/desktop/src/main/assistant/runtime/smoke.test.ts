import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createLlamaEngine } from "./llama.js";

/**
 * THE ONE REAL MODEL TEST, AND WHY IT IS SKIPPED BY DEFAULT.
 *
 * Every other test in this directory runs against fakes, because a suite that
 * needs a multi-gigabyte file is a suite nobody runs. This one loads a real GGUF
 * through the real engine — llama.cpp, the chat template, a real generation — and
 * it runs only when the maintainer points `NEXUS_LLM_SMOKE` at a file:
 *
 *   $env:NEXUS_LLM_SMOKE = "C:\path\to\Qwen3.5-2B-Q4_K_M.gguf"
 *   node node_modules/vitest/vitest.mjs run --configLoader runner src/main/assistant/runtime/smoke.test.ts
 *
 * What it proves that nothing else can: that `getLlama` finds a backend on THIS
 * machine, that the model's own chat template is driven correctly, that tokens
 * stream, and that `unloadAll` gives the memory back. The measured numbers are
 * PRINTED rather than asserted (a machine's free memory is not a constant), with
 * one exception: the VRAM `used` figure after the unload must not exceed the
 * figure while the model was loaded, which is what "unloadAll frees memory" means.
 *
 * MEASURED, maintainer's laptop, 2026-10-10, with the catalogue's smallest entry
 * (`Qwen3.5-2B-Q4_K_M`, 1 280 835 840 bytes): the whole test takes 11.2 s, of
 * which 5.3 s is the 256-token generation. Its budget is 120 s — ten times the
 * measurement, which is the same margin the other slow suites here use.
 */
const smokePath = process.env["NEXUS_LLM_SMOKE"];
const smoke = smokePath === undefined || smokePath === "" ? it.skip : it;

describe("the real model smoke test", () => {
  smoke(
    "loads a GGUF, answers 'Say hi', and frees it again",
    async () => {
      const path = smokePath as string;
      const bytes = statSync(path).size;
      const tokens: string[] = [];
      const engine = createLlamaEngine({
        onToken: (_callId, text) => tokens.push(text),
        log: (message) => console.log(`   ${message}`),
      });

      const before = await engine.hardware();
      const rssBefore = process.memoryUsage().rss;
      console.log(
        `smoke: file ${String(bytes)} bytes, backend ${before.backend}, ` +
          `${String(before.cpuThreads)} math cores, ${String(before.deviceNames.join(" / "))}`,
      );

      const info = await engine.loadChat({
        id: "smoke",
        title: "smoke",
        capabilities: ["chat"],
        modelPath: path,
        contextTokens: 0,
        gpuLayers: "auto",
        threads: before.cpuThreads,
      });
      const loaded = await engine.hardware();
      const rssLoaded = process.memoryUsage().rss;
      console.log(
        `smoke: loaded "${info.id}" with ${String(info.contextTokens)} tokens of context; ` +
          `rss ${String(Math.round(rssBefore / 1048576))} MB -> ${String(Math.round(rssLoaded / 1048576))} MB; ` +
          `VRAM used ${String(loaded.usedVramBytes)} bytes`,
      );

      const model = engine.chat("smoke");
      const started = Date.now();
      const result = await model.complete(
        {
          messages: [
            { role: "system", content: "Odgovaraj kratko." },
            { role: "user", content: "Say hi." },
          ],
          tools: [],
          temperature: 0,
          maxTokens: 256,
        },
        new AbortController().signal,
        (text) => tokens.push(text),
      );
      console.log(
        `smoke: answered in ${String(Date.now() - started)} ms — stopReason ${result.stopReason}, ` +
          `${String(result.promptTokens)} prompt + ${String(result.completionTokens)} completion tokens`,
      );
      console.log(`smoke: "${result.text.replace(/\s+/g, " ").trim()}"`);

      await engine.unloadAll();
      const after = await engine.hardware();
      const rssAfter = process.memoryUsage().rss;
      console.log(
        `smoke: unloaded; VRAM used ${String(after.usedVramBytes)} bytes ` +
          `(was ${String(loaded.usedVramBytes)} with the model loaded, ${String(before.usedVramBytes)} before); ` +
          `rss ${String(Math.round(rssAfter / 1048576))} MB`,
      );

      expect(tokens.join("").trim().length).toBeGreaterThan(0);
      expect(result.completionTokens).toBeGreaterThan(0);
      expect(result.stopReason === "end" || result.stopReason === "length").toBe(true);
      // The property `unloadAll` promises: the card's usage comes back down.
      expect(after.usedVramBytes).toBeLessThanOrEqual(loaded.usedVramBytes);
    },
    120_000,
  );
});
