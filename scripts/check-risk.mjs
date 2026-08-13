// No shebang, for the reason the other gates in this directory have none: this
// module is both a CLI (`node scripts/check-risk.mjs`) and an import target for
// its own tests.
//
// WHAT THIS GATE ENFORCES.
//
// Two hundred and seventy-four professional tools compute quantities that people
// build, dose, cook, drive, file and bill against. Thirty-eight of them are
// `life-safety` and two are `food-safety`, and for those forty the contract says
// one thing above all others (`toolForbidsVerdict`):
//
//     the tool computes a QUANTITY and never renders a judgement.
//
// TypeScript proves the `riskClass` field is present and spelled from the enum.
// It cannot prove that the tool behind it stayed silent about what its number
// means, and it cannot prove that the host is still drawing the notice. Both of
// those are one careless edit away at any time, and both fail SILENTLY: a
// deleted `<ToolRiskNotice/>` renders nothing, which is exactly what a harmless
// tool renders, and „u granicama" under a ratio looks like helpfulness.
//
// So three rules, in the order they matter:
//
//   1. THE HOST STILL DRAWS THE NOTICE. `ToolsPage` renders `ToolRiskNotice`,
//      wraps every surface in `ToolRiskProvider`, and `CopyButton` still calls
//      `useCopySuffix`. Delete any one of those lines and forty tools quietly
//      lose their notice, their travelling line, or both — with every test still
//      green, because no test asserts on a component that renders `null` for the
//      class it was handed.
//
//   2. NO VERDICT IN THE COPY of a forbidden-verdict tool. The Serbian strings
//      of those tools may name a quantity and may name the limit the USER typed.
//      „zadovoljava" is the app choosing which rule applies to a building, a
//      brine or a load it has never seen.
//
//   3. NO VERDICT IN THE ARITHMETIC. `@nexus/core/pro/*` may not return a
//      boolean or an enum that decides. A `passes: boolean` is a verdict that
//      has been moved one file away from where anyone reviews the copy, and it
//      is worse than the sentence because it survives a translation.
//
// The gate is deliberately narrow: it objects to the vocabulary of judgement,
// never to Serbian, never to a number, never to a hedge. A rule that fired on
// ordinary copy is a rule somebody switches off.

import { readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");

const DESKTOP = "apps/desktop/src";

/**
 * Rule 1 — the four lines that make a notice unforgettable, and what each one
 * costs when it goes.
 *
 * Written as „this substring must appear in this file" rather than as a parse,
 * because the failure being guarded against is a DELETION and a deletion is
 * exactly what a substring search sees. Each entry says what breaks, so a red
 * run reads as a consequence rather than as a missing string.
 */
export const HOST_WIRING = [
  {
    file: `${DESKTOP}/renderer/src/ToolsPage.tsx`,
    needle: "<ToolRiskNotice riskClass={selected.riskClass} />",
    breaks: "the notice above every regulated tool stops being drawn at all",
  },
  {
    file: `${DESKTOP}/renderer/src/ToolsPage.tsx`,
    needle: "<ToolRiskProvider value={selected.riskClass}>",
    breaks: "every copied result loses its trailing line, in every tool at once",
  },
  {
    file: `${DESKTOP}/renderer/src/pro/shared.tsx`,
    needle: "useCopySuffix()",
    breaks: "`CopyButton` stops appending the line that travels out of the window",
  },
  {
    file: `${DESKTOP}/renderer/src/toolRisk.tsx`,
    needle: "export function ToolRiskNotice",
    breaks: "there is no notice component left for the host to draw",
  },
];

/**
 * Rule 2 — the vocabulary of judgement, in Serbian.
 *
 * Every entry is a word that answers „is this all right?" rather than „how much
 * is it?". Deliberately absent: „pad" (a voltage drop is a quantity), „granica"
 * (a limit the user typed is a fact about their own input), „tačno" (an exact
 * division is arithmetic) and every hedge — a gate that objected to „približno"
 * would be pushing tools towards overclaiming, which is the opposite of the aim.
 */
export const VERDICT_WORDS = [
  { re: /zadovoljav\w*/iu, why: "says the value meets a rule the app did not choose" },
  { re: /\bne\s+zadovoljav\w*/iu, why: "the same judgement, negated — still a judgement" },
  { re: /\bbezbedn\w*/iu, why: "asserts safety, which is the licensed professional's call" },
  { re: /\bnebezbedn\w*/iu, why: "asserts danger, which is the same call in the other direction" },
  { re: /u\s+skladu\s+sa/iu, why: "a compliance claim, i.e. a warranty" },
  { re: /\bispravn\w*\s+(je|su|prema)/iu, why: "declares the input correct" },
  { re: /\bdozvoljen\w*\s+(je|su)\b/iu, why: "declares the value permitted" },
  { re: /\bprelazi\s+dozvoljen\w*/iu, why: "declares the value not permitted" },
  { re: /\bpreporuč\w*/iu, why: "a recommendation is advice, and advice is what the professional gives" },
  { re: /\bu\s+granicama\b/iu, why: "the verdict written as a location" },
  { re: /\bvan\s+granica\b/iu, why: "the same verdict, negated" },
];

/**
 * Rule 3 — a field whose type is a decision.
 *
 * `ok` is absent on purpose: it is `ProResult`'s discriminant, and it says the
 * function produced an answer rather than that the answer is acceptable.
 */
export const VERDICT_FIELDS =
  /\b(passes|passed|compliant|conforms|acceptable|isSafe|safe|withinLimit|inRange|verdict|approved)\s*\??\s*:\s*boolean/;

/** Where a tool's copy lives, per pack. `softver`'s forty-eight are under `devtools`. */
const STRINGS_FILE = (pack) =>
  pack === "softver"
    ? `${DESKTOP}/renderer/src/strings/devtools.ts`
    : `${DESKTOP}/renderer/src/strings/pro.${pack}.ts`;

const read = (repoRoot, file) => {
  try {
    return readFileSync(join(repoRoot, file), "utf8");
  } catch {
    return undefined;
  }
};

const rel = (repoRoot, file) => relative(repoRoot, file).split(sep).join("/");

/**
 * The registrations, read as TEXT rather than imported.
 *
 * `shared/modules.ts` is TypeScript that pulls in the whole registry, and a gate
 * that has to build the app before it can run is a gate that stops being run.
 * The shape being matched is fixed by the file's own convention — one `id:` and
 * one `riskClass:` per literal, `packs:` where there is one — so a registration
 * written differently enough to escape this is a registration that no longer
 * matches its forty-eight neighbours.
 */
export function readRegistrations(repoRoot = REPO_ROOT) {
  const text = read(repoRoot, `${DESKTOP}/shared/modules.ts`) ?? "";
  const tools = [];
  const re =
    /\bid:\s*"([a-z0-9-]+)"[\s\S]{0,900}?\briskClass:\s*"([a-z-]+)"([\s\S]{0,400}?\bpacks:\s*\[([^\]]*)\])?/g;
  for (const m of text.matchAll(re)) {
    const packs = (m[4] ?? "").match(/"([a-z]+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
    tools.push({ id: m[1], riskClass: m[2], packs });
  }
  return tools;
}

/** Every string literal in a file, with the line it sits on. */
function stringLiterals(text) {
  const out = [];
  let line = 1;
  const re = /"((?:[^"\\\n]|\\.)*)"/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    for (let i = last; i < m.index; i++) if (text[i] === "\n") line++;
    last = m.index;
    out.push({ line, text: m[1] });
  }
  return out;
}

/**
 * The tool ids a copy file declares, mapped to the line range each one owns.
 *
 * The files are one object per tool id (`"stair-geometry": { … }`), so a range
 * runs from a key to the next key — which is enough to attribute a verdict word
 * to the tool that would render it, rather than to the file.
 */
function copyBlocks(text) {
  const lines = text.split("\n");
  const starts = [];
  for (const [i, l] of lines.entries()) {
    const m = /^\s{2}"([a-z0-9-]+)":\s*\{/.exec(l);
    if (m !== null) starts.push({ id: m[1], from: i + 1 });
  }
  return starts.map((s, i) => ({
    ...s,
    to: i + 1 < starts.length ? starts[i + 1].from - 1 : lines.length,
  }));
}

export function auditAll(repoRoot = REPO_ROOT) {
  const findings = [];
  const add = (rule, file, line, detail) => findings.push({ rule, file, line, detail });

  // Rule 1 — the host still draws it.
  for (const w of HOST_WIRING) {
    const text = read(repoRoot, w.file);
    if (text === undefined) {
      add("host-wiring", w.file, 0, `file is missing — ${w.breaks}`);
      continue;
    }
    if (!text.includes(w.needle)) {
      add("host-wiring", w.file, 0, `\`${w.needle}\` is gone — ${w.breaks}`);
    }
  }

  // Rule 2 — no verdict in the copy of a tool that may not render one.
  const tools = readRegistrations(repoRoot);
  const forbidden = new Map();
  for (const t of tools) {
    if (t.riskClass !== "life-safety" && t.riskClass !== "food-safety") continue;
    forbidden.set(t.id, t);
  }
  const packsSeen = new Set(tools.flatMap((t) => t.packs));
  for (const pack of [...packsSeen].sort()) {
    const file = STRINGS_FILE(pack);
    const text = read(repoRoot, file);
    if (text === undefined) continue;
    const literals = stringLiterals(text);
    for (const block of copyBlocks(text)) {
      if (!forbidden.has(block.id)) continue;
      for (const lit of literals) {
        if (lit.line < block.from || lit.line > block.to) continue;
        for (const word of VERDICT_WORDS) {
          const m = word.re.exec(lit.text);
          if (m !== null) add("verdict-copy", file, lit.line, `${block.id}: „${m[0]}" — ${word.why}`);
        }
      }
    }
  }

  // Rule 3 — no verdict in the arithmetic, in any professional module.
  for (const pack of [...packsSeen].sort()) {
    const file = `packages/core/src/pro/${pack}.ts`;
    const text = read(repoRoot, file);
    if (text === undefined) continue;
    for (const [i, l] of text.split("\n").entries()) {
      const m = VERDICT_FIELDS.exec(l);
      if (m !== null) add("verdict-field", file, i + 1, `\`${m[0].trim()}\` decides instead of computing`);
    }
  }

  return { findings, toolCount: tools.length, forbiddenCount: forbidden.size };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, toolCount, forbiddenCount } = auditAll();
  if (findings.length === 0) {
    console.log(
      `check-risk: ${toolCount} registered tools, ${forbiddenCount} of them forbidden a verdict — ` +
        "notice wiring intact, no judgement in copy or in arithmetic.",
    );
    process.exit(0);
  }
  console.error(`check-risk: ${findings.length} finding(s).\n`);
  for (const f of findings) {
    console.error(`  ${f.file}${f.line > 0 ? `:${f.line}` : ""}  [${f.rule}]  ${f.detail}`);
  }
  console.error(
    "\nA tool in these classes computes a quantity. Whether that quantity is\n" +
      "acceptable is a question for the professional who is answerable for it.",
  );
  process.exit(1);
}

export { rel };
