// No shebang, for the reason every other script in this directory has none: it
// is run as `node scripts/assistant-eval.mjs`, and Vite does not strip a
// shebang from a file it transforms.
//
// WHAT THIS IS. The command behind `pnpm eval:assistant`. It runs the assistant
// evals in `apps/desktop/src/main/assistant/evals/` against a model and prints
// the report. Two modes:
//
//   --scripted            the checked-in transcripts and the reference loop.
//                         Needs no model and is what proves the harness; the
//                         same scenarios run in the ordinary test suite.
//   --model <path.gguf>   the real thing: a GGUF loaded through the runtime
//                         run's `createModelHost`, driven by the real agent
//                         loop. The tools and the passages still come from the
//                         scenario, so the two modes differ in the loop and the
//                         model and in nothing else — which is what makes their
//                         numbers comparable.
//
// THE REAL MODE IS A SKIP, NOT A FAILURE, WHEN A PART IS ABSENT. Both factories
// it needs are built by other runs of the 2.0 wave and merged after this one, so
// a missing module — or one that cannot be constructed yet — prints what is
// missing and exits 0. It is never part of CI.
//
// WHY IT READS TYPESCRIPT AT ALL. The evals are TypeScript, like the rest of the
// main process, and there is no build step between here and there. Node 24
// strips types on its own, but it does not resolve the `.js` specifier that a
// TypeScript file uses for its `.ts` neighbour — so the hook below teaches the
// resolver that one mapping and everything else is Node's own behaviour.
//
// THE HOOK IS DELIBERATELY NARROW: it fires only when the literal specifier ends
// in `.js` AND the resolver could not find it, and it retries the same path with
// `.ts`. A real `.js` file still wins, and nothing else is rewritten.

import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (typeof specifier === "string" && specifier.endsWith(".js")) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  },
});

const USAGE = `Usage: node scripts/assistant-eval.mjs --scripted
       node scripts/assistant-eval.mjs --model <path.gguf> [--locale sr|en]

Options:
  --scripted          run the checked-in transcripts; no model needed
  --model <path>      a GGUF file to load through the model host
  --locale <sr|en>    score only scenarios in one language
  --scenarios <dir>   a directory of scenario files (default: the evals' own)
  --timeout <ms>      per-scenario timeout (default: 120000)
  --json              print the JSON report instead of the Markdown table
  --out-md <path>     also write the Markdown report to a file
  --out-json <path>   also write the JSON report to a file
  --help              print this text
`;

/** The argument parser: `--flag`, `--key value`, and `--` refuses everything else. */
export function parseArgs(argv) {
  const options = {
    scripted: false,
    model: null,
    locale: null,
    scenarios: null,
    timeoutMs: 120_000,
    json: false,
    outMd: null,
    outJson: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${arg} needs a value`);
      }
      index += 1;
      return next;
    };
    if (arg === "--scripted") options.scripted = true;
    else if (arg === "--model") options.model = value();
    else if (arg === "--locale") {
      const locale = value();
      if (locale !== "sr" && locale !== "en") throw new Error("--locale must be sr or en");
      options.locale = locale;
    } else if (arg === "--scenarios") options.scenarios = value();
    else if (arg === "--out-md") options.outMd = value();
    else if (arg === "--out-json") options.outJson = value();
    else if (arg === "--timeout") {
      const timeout = Number(value());
      if (!Number.isFinite(timeout) || timeout <= 0) throw new Error("--timeout must be a positive number of milliseconds");
      options.timeoutMs = timeout;
    } else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!options.help && options.scripted === (options.model !== null)) {
    throw new Error("choose exactly one of --scripted and --model");
  }
  return options;
}

const EVALS = "../apps/desktop/src/main/assistant/evals/index.js";

/**
 * Loads a module the wave builds, or explains why it is not there yet.
 *
 * Every entry names the file the contract fixes and the factory the module run
 * exports from it, so a skip says which part of the wave is still missing.
 */
async function loadPart(label, specifier, factory) {
  let loaded;
  try {
    loaded = await import(specifier);
  } catch (error) {
    return { ok: false, reason: `${label} could not be imported: ${error.message}` };
  }
  if (typeof loaded[factory] !== "function") {
    return { ok: false, reason: `${label} does not export ${factory}()` };
  }
  return { ok: true, factory: loaded[factory] };
}

function skip(message) {
  console.log(`assistant-eval: skipped — ${message}`);
  console.log("The scripted mode needs none of it: node scripts/assistant-eval.mjs --scripted");
  return 0;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`assistant-eval: ${error.message}\n\n${USAGE}`);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const evals = await import(EVALS);
  const scenarios = evals.loadScenarios(options.scenarios ?? undefined);
  const selected =
    options.locale === null ? scenarios : scenarios.filter((scenario) => scenario.locale === options.locale);
  if (selected.length === 0) {
    console.log(`assistant-eval: no scenarios to run${options.locale === null ? "" : ` for ${options.locale}`}.`);
    return 0;
  }

  let harness;
  let modelLabel;
  if (options.scripted) {
    harness = evals.createHarness({
      runAgentTurn: evals.referenceRunAgentTurn,
      modelFor: (scenario) =>
        evals.createScriptedModel(
          scenario.script,
          scenario.modelContextTokens === undefined ? {} : { contextTokens: scenario.modelContextTokens },
        ),
    });
    modelLabel = "scripted transcript";
  } else {
    const host = await loadPart("the model host", "../apps/desktop/src/main/assistant/runtime/index.js", "createModelHost");
    if (!host.ok) return skip(host.reason);
    const loop = await loadPart("the agent loop", "../packages/core/src/assistant/loop.js", "runAgentTurn");
    if (!loop.ok) return skip(loop.reason);

    let modelHost;
    let chatModel;
    try {
      // The factory's own signature is the runtime run's decision; this runner
      // calls it with no arguments and records that as an assumption in the
      // README. The scenario owns the tools and the passages, so the real mode
      // varies exactly two things against the scripted one: the loop and the
      // model.
      modelHost = host.factory();
      const entry = await modelHost.importFile(resolve(options.model));
      chatModel = await modelHost.loadChat(entry.id, new AbortController().signal);
    } catch (error) {
      return skip(`the real mode could not be wired: ${error.message}`);
    }

    harness = evals.createHarness({
      runAgentTurn: loop.factory,
      modelFor: () => chatModel,
      timeoutMs: options.timeoutMs,
    });
    modelLabel = basename(options.model);
  }

  const suite = await harness.runSuite(selected, modelLabel);
  const markdown = evals.reportMarkdown(suite);
  const json = evals.reportJson(suite);
  console.log(options.json ? json : markdown);
  if (options.outMd !== null) writeFileSync(options.outMd, markdown, "utf8");
  if (options.outJson !== null) writeFileSync(options.outJson, json, "utf8");
  return suite.totals.failed === 0 ? 0 : 1;
}

// The CLI runs only when it is the entry point, so a test can import the parser
// beside it without downloading a model.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
