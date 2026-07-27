#!/usr/bin/env node
/**
 * The Security workflow's build-toolchain dependency scan.
 *
 * The shipped side of the tree is guarded by a plain `pnpm audit --prod
 * --audit-level low` with no exceptions of any kind. This scan covers what is
 * left — the build toolchain, plus electron itself, a devDependency that very
 * much ships — and it is the only place an exception may exist.
 *
 * It exists as a script rather than a flag because pnpm has no way to skip an
 * advisory for a single run: `--ignore` WRITES `auditConfig.ignoreGhsas` into
 * pnpm-workspace.yaml, and that key then applies to every audit invocation
 * including the shipped-dependency one. An allow-list here cannot reach that
 * scan, which is the whole point.
 *
 * SEC-SC-04 makes the dependency scan a blocking gate; SEC-VER-03 sets the bar
 * it blocks at — "any known-exploitable dependency vulnerability". Deciding
 * that a given advisory is not exploitable in this repo is a human judgement,
 * so each entry below has to carry the reasoning and the condition that ends
 * it. An entry that stops matching is itself a failure: upstream has moved and
 * the excuse must go, rather than sit here forever unread.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const MINIMUM_SEVERITY = ["high", "critical"];

/** Advisories this scan tolerates, each with why it is not exploitable here and what retires it. */
const ALLOWED = [
  {
    ghsa: "GHSA-mh99-v99m-4gvg",
    package: "brace-expansion",
    why:
      "Out-of-memory crash from an oversized brace expansion. It reaches us only " +
      "through electron-builder (already at its latest release), and the only patterns " +
      "the expander ever sees are the globs in this repo's own packaging config — there " +
      "is no untrusted input, so it is not exploitable under SEC-VER-03. It also cannot " +
      "be patched away: the advisory marks every release at or below 5.0.7 affected " +
      "while the fix shipped on 5.x alone, so 1.1.16 and 2.1.2 — the newest releases of " +
      "the two majors minimatch@3 and minimatch@5/9 accept — match it permanently, and " +
      "v5 cannot replace them (v1/v2 export `module.exports = fn`, v5 exports " +
      "`{ expand }`, so `require(...)(pattern)` would throw).",
    retireWhen: "electron-builder's tree stops reaching brace-expansion 1.x/2.x.",
  },
];

/** Runs the audit and returns its JSON report. A non-zero exit is expected whenever findings exist. */
async function runAudit() {
  // Through a shell, and deliberately: pnpm is a `.cmd` shim on Windows, which
  // Node refuses to spawn directly. The command is a fixed literal with no
  // interpolation, so there is nothing for a shell to mis-parse.
  const { stdout } = await promisify(exec)("pnpm audit --json", {
    maxBuffer: 32 * 1024 * 1024,
  }).catch((error) => {
    // `pnpm audit` exits non-zero when it finds anything, which is the normal
    // case here — the report is still on stdout. A genuinely broken run gives
    // us no stdout to parse, and that must not pass silently.
    if (error.stdout) return { stdout: error.stdout };
    throw error;
  });
  return JSON.parse(stdout);
}

const report = await runAudit();
const advisories = Object.values(report.advisories ?? {});

const blocking = [];
const matched = new Set();

for (const advisory of advisories) {
  if (!MINIMUM_SEVERITY.includes(advisory.severity)) continue;
  const id = advisory.github_advisory_id;
  const allowance = ALLOWED.find((entry) => entry.ghsa === id);
  if (allowance) {
    matched.add(id);
    console.log(`· tolerated  ${id}  ${advisory.module_name}  — ${allowance.retireWhen}`);
    continue;
  }
  blocking.push(advisory);
}

for (const advisory of blocking) {
  console.error(
    `::error::${advisory.severity} in ${advisory.module_name} ` +
      `(${advisory.vulnerable_versions}) — ${advisory.github_advisory_id}: ${advisory.title}`,
  );
}

const stale = ALLOWED.filter((entry) => !matched.has(entry.ghsa));
for (const entry of stale) {
  console.error(
    `::error::${entry.ghsa} (${entry.package}) no longer appears in the audit. ` +
      `Its allowance in .github/scripts/audit-toolchain.mjs is spent — delete it.`,
  );
}

if (blocking.length > 0 || stale.length > 0) process.exit(1);

console.log(
  `Build toolchain: no blocking advisories (${matched.size} tolerated, each documented in this script).`,
);
