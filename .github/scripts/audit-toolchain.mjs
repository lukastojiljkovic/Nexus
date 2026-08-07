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
/**
 * Advisories this scan tolerates, each with why it is not exploitable here and
 * what retires it.
 *
 * **Empty on 2026-08-07, and that is the healthy state.** The one entry it
 * carried — `GHSA-mh99-v99m-4gvg` on `brace-expansion` — argued that the fix
 * had shipped on 5.x alone and could therefore never reach the 1.x/2.x lines
 * `minimatch@3` and `minimatch@5/9` accept. Upstream has since backported it
 * (1.1.18, 2.1.4), the overrides in `pnpm-workspace.yaml` moved past it, and
 * the advisory stopped appearing at all — at which point this script failed the
 * job on the SPENT allowance rather than letting the excuse sit here unread,
 * which is exactly what it was built to do.
 */
const ALLOWED = [];

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
