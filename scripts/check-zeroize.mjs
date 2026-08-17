// No shebang, for the reason the other gates in this directory have none: this
// module is both a CLI (`node scripts/check-zeroize.mjs`) and an import target
// for its own tests.
//
// WHY THIS GATE EXISTS. `openContentKey` was written like this:
//
//     try {
//       …
//       return openAll(deps, input, masterKey, wraps, false);   // async
//     } finally {
//       zeroize(masterKey);
//     }
//
// and the `finally` runs AT THE RETURN STATEMENT, not when the returned promise
// settles. So the account's master key was erased in the middle of the very call
// that was using it. Generation 1 opened — its subkeys were derived before the
// first `await` yielded — and generation 2 was decrypted under 32 zero bytes.
//
// EVERY PART OF THAT FAILURE POINTS AWAY FROM THE CAUSE. The symptom is
// `wrap/commitment-mismatch`, whose message is „wrong password, recovery code,
// account or profile" — so it reads as a server serving somebody else's row, or
// as a corrupted record. It is data-dependent: the first key opens, the second
// does not, which reads as one bad row rather than as one bad line. And the code
// is not merely correct-looking; the `finally` is there for a GOOD reason, argued
// in a comment, doing the right thing at the wrong time. `return await` is the
// whole fix, and „add a redundant await" is exactly the edit a reviewer removes.
//
// THE TRIGGER IS `zeroize` AND NOTHING ELSE, and the narrowness is deliberate.
// The class is wider — a file handle closed early, a document destroyed early, a
// transaction flag restored early are all the same ordering mistake — but those
// fail LOUDLY: the next call throws `EBADF`, or the object is gone. Key material
// erased early fails silently, produces plausible ciphertext, and its error
// message accuses something else. A gate that fired on every `finally` in the
// repository would report eight correct sites for one real one, and a gate that
// cries wolf is a gate somebody switches off.
//
// WHAT WOULD SUPERSEDE IT. `@typescript-eslint/return-await` states this rule
// exactly, for every type, with no heuristics — and it needs type information,
// which `eslint.config.mjs` deliberately does not wire up (see its header: lint
// is a fast syntactic pass, `pnpm typecheck` is the type authority). When the
// type-aware-lint arc happens, that rule replaces this file.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { relative } from "node:path";

import { REPO_ROOT, findScanFiles } from "./check-colours.mjs";

/** What the `finally` must be releasing for this gate to have an opinion. */
const RELEASE = "zeroize(";

/**
 * A `return` WHOSE OWN EXPRESSION is a call — an identifier or member path
 * followed directly by `(`. `return await …` is excluded by the pattern.
 *
 * „Whose own expression" is the part that took a second attempt. The first
 * version asked whether the returned line contained a call anywhere, and
 * reported three correct sites: two object literals with a call in one field,
 * and a `new TextDecoder().decode(…)`. A value built from a call is finished by
 * the time `return` runs; only a call in the return POSITION can still be
 * pending when the `finally` fires.
 */
const RETURNS_A_CALL =
  /(?<![\w$.])return\s+(?!await\b|new\b)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;

/**
 * Functions declared in this file that are NOT async, so a call to one cannot
 * produce a promise and the ordering cannot bite.
 *
 * This exemption is not a convenience; without it the gate is wrong. Both
 * `adopt.ts` and `reconnect.ts` legitimately `return refused(…)` inside a try
 * whose finally erases the master key, and `refused` is a local arrow that
 * builds an object literal. Demanding `return await refused(…)` there would be
 * this gate teaching people to write something misleading.
 */
function localSyncFunctions(text) {
  const names = new Set();
  for (const match of text.matchAll(/(^|\n)\s*(?:export\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[2]);
  }
  for (const match of text.matchAll(
    /(^|\n)\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(async\s*)?\(/g,
  )) {
    if (match[3] === undefined) names.add(match[2]);
  }
  // An `async function` declaration re-adds nothing — it is removed here rather
  // than skipped above, because the two patterns can both match one declaration
  // and „declared async anywhere in this file" is the safe reading.
  for (const match of text.matchAll(/(^|\n)\s*(?:export\s+)?async\s+function\s+([A-Za-z_$][\w$]*)/g)) {
    names.delete(match[2]);
  }
  return names;
}

/** The balanced `{ … }` starting at or after `from`, and where it ended. */
function block(text, from) {
  const open = text.indexOf("{", from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return { body: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

/**
 * Every violation in one file.
 *
 * Exported for the tests, which is also why it takes text rather than a path:
 * a gate whose rule can only be exercised against the real repository is a gate
 * that can only be observed passing.
 */
export function scanSource(text) {
  const problems = [];
  const sync = localSyncFunctions(text);
  let at = 0;

  for (;;) {
    const start = text.indexOf("try", at);
    if (start === -1) break;
    at = start + 3;
    // `try` as a word, followed by its block.
    if (/[\w$]/.test(text[start - 1] ?? " ") || !/^\s*\{/.test(text.slice(start + 3))) continue;
    const tryBlock = block(text, start + 3);
    if (tryBlock === null) continue;

    // Each guarded region is carried with the offset it starts at, so a
    // reported line number is the real one rather than one counted from the
    // start of a concatenation.
    const guarded = [{ body: tryBlock.body, at: tryBlock.end - tryBlock.body.length - 1 }];

    // Walk past an optional `catch (…) { … }` to whatever follows. `after`
    // starts at the absolute offset `tryBlock.end`, which is what turns a
    // catch-relative position back into a line number in the file.
    let after = text.slice(tryBlock.end);
    const caught = /^\s*catch\s*(\([^)]*\))?\s*\{/.exec(after);
    if (caught !== null) {
      const catchBlock = block(after, caught.index);
      if (catchBlock === null) continue;
      // A `return` in the catch has the same problem as one in the try.
      guarded.push({
        body: catchBlock.body,
        at: tryBlock.end + catchBlock.end - catchBlock.body.length - 1,
      });
      after = after.slice(catchBlock.end);
    }
    if (!/^\s*finally\s*\{/.test(after)) continue;
    const finallyBlock = block(after, 0);
    if (finallyBlock === null || !finallyBlock.body.includes(RELEASE)) continue;

    for (const region of guarded) {
      for (const match of region.body.matchAll(RETURNS_A_CALL)) {
        const callee = match[1];
        if (callee !== undefined && sync.has(callee)) continue;
        const offset = region.at + (match.index ?? 0);
        problems.push({
          line: text.slice(0, offset).split("\n").length,
          statement: match[0].trim().split("\n").pop()?.trim() ?? match[0].trim(),
        });
      }
    }
  }
  return problems;
}

export function auditZeroize(repoRoot = REPO_ROOT) {
  const problems = [];
  for (const file of findScanFiles(repoRoot)) {
    if (!/\.(?:ts|tsx|mts|cts)$/.test(file)) continue;
    const text = readFileSync(file, "utf8");
    if (!text.includes(RELEASE)) continue;
    for (const problem of scanSource(text)) {
      problems.push(`${relative(repoRoot, file)}:${problem.line}: ${problem.statement}`);
    }
  }
  return problems;
}

// --- CLI --------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = auditZeroize();
  if (problems.length > 0) {
    console.error(
      `A key is erased while it is still in use — ${problems.length} site(s).\n` +
        "In a `try` whose `finally` calls zeroize(), a returned call must be " +
        "`return await`: the finally runs at the return statement, not when the " +
        "promise settles.\n",
    );
    for (const problem of problems) console.error(`  • ${problem}`);
    process.exit(1);
  }
  console.log("zeroize ordering OK");
}
