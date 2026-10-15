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
//   --model <path.gguf>   the real thing: a GGUF loaded through the runtime's
//                         own llama engine, driven by the real agent loop. The
//                         tools and the passages still come from the scenario,
//                         and each tool a scenario offers under a name the app
//                         has wears the APP's own description and schema (see
//                         `loadToolSpecs`), which is what a real model has to
//                         be judged against.
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
// THE RESOLVE HOOK IS DELIBERATELY NARROW: it fires only when the literal
// specifier ends in `.js` AND the resolver could not find it, and it retries the
// same path with `.ts`. A real `.js` file still wins, and nothing else is
// rewritten. The one other thing it does is what the bundler does without being
// asked: a `.json` import (the model catalogue) is read as JSON, which Node
// refuses to do for a specifier that carries no `with { type: "json" }`. The
// load hook beside it does the bundler's other half — see there.

import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    let resolved;
    try {
      resolved = nextResolve(specifier, context);
    } catch (error) {
      if (typeof specifier === "string" && specifier.endsWith(".js")) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
    return resolved.url.endsWith(".json")
      ? { ...resolved, importAttributes: { ...context.importAttributes, type: "json" } }
      : resolved;
  },
});

/**
 * The second thing the bundler does without being asked: a `.ts` file is read
 * as TypeScript, not as the narrower syntax Node strips on its own.
 *
 * WHY, AND WHY ONLY IN THE REAL MODE. Node's strip-only mode refuses a
 * parameter property, an enum and a namespace, and the app's main-process
 * modules use all three (`packages/core`'s views engine, the model runtime,
 * every store in `@nexus/db`). The real mode READS those modules — the tool
 * registry built in {@link loadToolSpecs} — so it applies Node's own transform,
 * the one `--experimental-transform-types` turns on, from the loader rather than
 * from a flag a maintainer has to remember. The scripted mode reads nothing
 * outside the evals, which strip cleanly, so it registers no transform and
 * prints no warning. (This one does print Node's own `ExperimentalWarning`;
 * the README names it beside the other expected one.)
 */
function transformTypeScript() {
  registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith("file:") || !url.endsWith(".ts")) return nextLoad(url, context);
      const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), {
        mode: "transform",
        sourceUrl: url,
      });
      return { format: "module", source, shortCircuit: true };
    },
  });
}

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

/** The app's tool registry, and the web service the app plugs into it when the user turned web search on. */
const TOOL_REGISTRY = "../apps/desktop/src/main/assistant/tools/index.js";
const WEB_SERVICE = "../apps/desktop/src/main/assistant/web/index.js";

/** A seam the evals never reach: they read declarations, and nothing here runs a tool. */
function refuse() {
  throw new Error("The evals read the tool specs and run no tool.");
}

/**
 * The app's own description and schema for every tool it has, by tool name.
 *
 * WHY THE REAL MODE BUILDS THE APP'S REGISTRY. A scenario says what a tool
 * DOES; what the MODEL is shown — the sentence that says when to reach for it,
 * and the schema of the fields it may send — is the app's. A run that showed a
 * real model an empty schema and the tool's own name measured the harness and
 * not the model: on 2026-10-15, Gemma 4 E2B scored 0 of 4 on the English task
 * scenarios, and one reason was that nothing had told it `tasks.create` has a
 * title.
 *
 * The registry is built the way `tools/index.test.ts` builds it — with fakes,
 * because this process must not open a profile database, install a pack or arm
 * a timer to read a schema. Every seam here is therefore either an empty
 * answer or a refusal, and the web service is stood up with the same kind of
 * stand-in so `web.search` and `web.readPage` wear their real specs too.
 */
async function loadToolSpecs() {
  const tools = await loadPart("the tool registry", TOOL_REGISTRY, "createToolRegistry");
  if (!tools.ok) return { ok: false, reason: tools.reason };
  const web = await loadPart("the web service", WEB_SERVICE, "createWebService");
  try {
    const webService = web.ok
      ? web.factory({
          // Nothing here fetches anything: the scenarios own every result, and
          // the mode is the one the app itself has before a user turns web
          // search on.
          userData: process.cwd(),
          version: "eval",
          mode: () => "offline",
          resolve: () => Promise.resolve([]),
          http: { request: refuse },
          secrets: { apiKey: () => null, setApiKey: refuse, clearApiKey: refuse },
        })
      : null;
    const registry = tools.factory({
      profileDb: refuse,
      now: () => Date.now(),
      search: () => Promise.resolve([]),
      packs: { list: () => Promise.resolve([]) },
      timers: { startCountdown: refuse, listCountdowns: () => [] },
      modules: { all: () => [], get: () => undefined },
      web: webService,
    });
    const specs = {};
    for (const tool of registry.tools({ web: webService !== null })) {
      specs[tool.name] = { description: tool.description, parameters: tool.parameters };
    }
    return { ok: true, specs };
  } catch (error) {
    return { ok: false, reason: `the tool registry could not be built: ${error.message}` };
  }
}

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
    // Before anything outside the evals is imported: the app's own modules use
    // syntax Node strips only under a transform, and the registry below reads
    // them.
    transformTypeScript();
    const engine = await loadPart("the llama engine", "../apps/desktop/src/main/assistant/runtime/llama.js", "createLlamaEngine");
    if (!engine.ok) return skip(engine.reason);
    const loop = await loadPart("the agent loop", "../packages/core/src/assistant/loop.js", "runAgentTurn");
    if (!loop.ok) return skip(loop.reason);

    // The app's own specs, so the model is offered the fields the real tools
    // have. A runner that cannot read them says so and carries on: the real
    // mode's job is to measure the model, and a scenario's own tools still
    // describe themselves, just less.
    const specSource = await loadToolSpecs();
    if (specSource.ok) {
      const count = Object.keys(specSource.specs).length;
      console.error(`assistant-eval: the scenario tools wear ${count} of the app's own specs.`);
    } else {
      console.error(`assistant-eval: warning — ${specSource.reason}`);
      console.error("The scenario tools keep their generic spec for this run.");
    }

    let chatModel;
    try {
      // The engine the app's utility process runs, driven in this process the
      // way the runtime's own smoke test drives it: the model host around it
      // spawns that process through Electron, which a plain Node run does not
      // have. The scenario owns the tools and the passages, so the real mode
      // varies exactly two things against the scripted one: the loop and the
      // model.
      const llama = engine.factory({ onToken: () => {} });
      const hardware = await llama.hardware();
      await llama.loadChat({
        id: "eval",
        title: basename(options.model),
        capabilities: ["chat"],
        modelPath: resolve(options.model),
        contextTokens: 0,
        gpuLayers: "auto",
        threads: hardware.cpuThreads,
      });
      chatModel = llama.chat("eval");
    } catch (error) {
      return skip(`the model could not be loaded: ${error.message}`);
    }

    harness = evals.createHarness({
      runAgentTurn: loop.factory,
      modelFor: () => chatModel,
      timeoutMs: options.timeoutMs,
      ...(specSource.ok ? { toolSpecs: specSource.specs } : {}),
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
