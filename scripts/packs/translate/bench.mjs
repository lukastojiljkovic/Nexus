// Measures the sentence translator's per-sentence cost, on this machine, on the
// exact bytes a built pack ships.
//
//   node scripts/packs/translate/bench.mjs [pack directory]
//
// The default pack directory is `%TEMP%\nexus-packs\translate-sr-en`, i.e. what
// `node scripts/packs/translate-sr-en/build.mjs` writes. The harness reads the
// pack's three files, runs them through the engine in a worker thread exactly as
// the renderer's worker does (`loadTranslationModel`, then `translate`), and
// prints the load-plus-first-sentence time, the steady-state time per sentence
// and the resident memory before and after.
//
// THE TWO-LINE NODE PATCH, WRITTEN DOWN. `@browsermt/bergamot-translator` 0.4.9's
// Node compatibility shim builds its wasm URL as `new URL("file://" + __filename)`
// and then reads `url.pathname` — which mis-parses a Windows path, so the engine
// cannot load under Node here at all (research run R13 hit this first). The
// published browser worker does not use that shim, which is what the renderer
// runs. This harness therefore applies the same two-line fix to a scratch copy of
// the package's worker in `%TEMP%` — never to the package — and deletes the copy
// when it is done. Nothing else about the worker, the glue or the wasm is
// touched, so the numbers are the engine's own.

import { Worker } from "node:worker_threads";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Resolved from the APP, not from this script: the engine is a dependency of
// `@nexus/desktop`, and pnpm's layout deliberately does not let an unrelated
// folder reach it.
const appRequire = createRequire(new URL("../../../apps/desktop/package.json", import.meta.url));
const packDir = process.argv[2] ?? join(tmpdir(), "nexus-packs", "translate-sr-en");
if (!existsSync(join(packDir, "model.bin"))) {
  console.error(`bench: no pack at ${packDir} — build one first, see docs/packs/.`);
  process.exit(1);
}

const packageWorker = join(appRequire.resolve("@browsermt/bergamot-translator"), "..", "worker");
const scratch = join(tmpdir(), "nexus-bergamot-bench");
mkdirSync(scratch, { recursive: true });

/** Copies the package's worker into the scratch directory with the two-line path fix. */
function patchedWorker() {
  let source = readFileSync(join(packageWorker, "translator-worker.js"), "utf8");
  const pathname = "const buffer = await readFile(url.pathname);";
  const location = "return new URL(`file://${__filename}`);";
  if (!source.includes(pathname) || !source.includes(location)) {
    throw new Error("the package's node shim no longer has the two lines this harness patches");
  }
  source =
    "const { fileURLToPath, pathToFileURL } = require('node:url');\n" +
    source
      .replace(pathname, "const buffer = await readFile(fileURLToPath(url));")
      .replace(location, "return pathToFileURL(__filename);");
  const workerPath = join(scratch, "translator-worker.cjs");
  writeFileSync(workerPath, source, "utf8");
  copyFileSync(join(packageWorker, "bergamot-translator-worker.js"), join(scratch, "bergamot-translator-worker.js"));
  copyFileSync(join(packageWorker, "bergamot-translator-worker.wasm"), join(scratch, "bergamot-translator-worker.wasm"));
  return workerPath;
}

/** One pack file as an ArrayBuffer, exactly the bytes the pack holds. */
function packBytes(name) {
  const file = readFileSync(join(packDir, name));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

/** The sentences measured, chosen to be ordinary Serbian prose rather than a benchmark string. */
const SENTENCES = [
  "Dobar dan, kako ste danas?",
  "Voz je krenuo sa stanice u sedam sati ujutru.",
  "Beograd je glavni grad Srbije i ima oko 1,4 miliona stanovnika.",
  "Molim te, posalji mi knjigu sto pre.",
];

try {
  const worker = new Worker(patchedWorker());
  let serial = 0;
  const pending = new Map();
  worker.on("message", ({ id, result, error }) => {
    const entry = pending.get(id);
    if (entry === undefined) return;
    pending.delete(id);
    if (error !== undefined) entry.reject(new Error(error.message));
    else entry.accept(result);
  });
  worker.on("error", (error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  });
  const call = (name, ...args) =>
    new Promise((accept, reject) => {
      const id = ++serial;
      pending.set(id, { accept, reject });
      worker.postMessage({ id, name, args });
    });

  const files = { model: packBytes("model.bin"), shortlist: packBytes("shortlist.bin"), vocabs: [packBytes("vocab.spm")] };
  console.log(`pack    ${packDir}`);
  console.log(`files   model ${files.model.byteLength} + shortlist ${files.shortlist.byteLength} + vocab ${files.vocabs[0].byteLength} bytes`);

  const before = process.memoryUsage().rss;
  const start = process.hrtime.bigint();
  await call("initialize", { cacheSize: 0 });
  await call("loadTranslationModel", { from: "sr", to: "en" }, files);
  const loaded = Number(process.hrtime.bigint() - start) / 1e6;
  for (const text of SENTENCES) {
    const at = process.hrtime.bigint();
    const out = await call("translate", { models: [{ from: "sr", to: "en" }], texts: [{ text, html: false }] });
    console.log(`  ${(Number(process.hrtime.bigint() - at) / 1e6).toFixed(0).padStart(4)} ms  ${text}  ->  ${out[0].target.text.trim()}`);
  }
  const rounds = 20;
  const steadyStart = process.hrtime.bigint();
  for (let index = 0; index < rounds; index += 1) {
    await call("translate", {
      models: [{ from: "sr", to: "en" }],
      texts: [{ text: SENTENCES[index % SENTENCES.length], html: false }],
    });
  }
  const perSentence = Number(process.hrtime.bigint() - steadyStart) / 1e6 / rounds;
  console.log(
    `load+first ${loaded.toFixed(0)} ms   steady ${perSentence.toFixed(1)} ms/sentence   ` +
      `rss ${(before / 1048576).toFixed(1)} -> ${(process.memoryUsage().rss / 1048576).toFixed(1)} MB`,
  );
  await worker.terminate();
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
