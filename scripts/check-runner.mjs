// No shebang, for the reason the other gates in this directory have none: this
// module is both a CLI (`node scripts/check-runner.mjs`) and an import target
// for its own tests.
//
// WHAT THIS GATE IS, AND — MORE IMPORTANTLY — WHAT IT IS NOT.
//
// It is a STYLE check over source text. It objects to constructs that start a
// process and to a program name written anywhere but the closed table. It cannot
// prove that no command line is ever assembled out of data, and nothing that
// reads source can: the line is built at runtime, and a string built one piece at
// a time from a circuit is, to a reader, an ordinary string. What this file is
// for is the case in between — the hurried edit that imports `child_process`
// into a module with no business starting anything, and the literal that puts a
// program name at a call site.
//
// WHY THIS CAPABILITY IS NOT LIKE THE ONES BEFORE IT.
//
// Until this slice the shipped app had exactly one capability boundary, and it
// was the NETWORK: off by default, structurally out of reach with cloud off,
// guarded by `check:egress` and asserted at the packet layer by
// `main/net/offline.ts`. A user who never turned sync on was in a product that
// could not reach anything. Starting a process is a second capability, and it is
// the sharper of the two — a network call leaves the machine, and a process runs
// ON it. It is authorised by DEV-007 — recorded in `docs/deviations.md`, over
// ADR-085 slice E6 — whose first mitigation is one sentence: **the command line
// is never data**. The command is chosen from a closed table in source, and the
// circuit contributes exactly one value, the workspace path.
//
// RULES 1 TO 4 BELOW ARE THAT MITIGATION, and they are what makes this file a
// security gate rather than a style guide. `child-process` is the module itself;
// `shell` is the option that turns an argv back into a command line; the exec
// family is a second door into the same room; and `spawn-literal` is the literal
// that makes the table optional. They are exempted only at the spawn sites (and
// the runner's test) and for nobody else, and a startup check refuses an entry
// for `shell`, the exec family or a literal at all, because that is the edit the
// deviation exists to prevent rather than a matter of taste.
//
// THE FIFTH RULE IS NOT ONE OF THEM. `toolchain-name` is a VOCABULARY rule: a
// file that NAMES a tool is not a file that runs one, so it has many exemptions
// and its job is different — keeping the names from spreading into places that
// would then have them to build a command line out of. The map below is
// vocabulary-only by construction, and that construction is checked rather than
// trusted.
//
// THE ASSERTION LIVES AT THE RUNTIME, IN THREE PLACES, and this file is
// underneath all three rather than instead of any of them. The table itself
// (`packages/core/src/electronics/runner.ts`) refuses a workspace that is not
// absolute and a distribution whose name begins with a dash, and gives the WSL
// profile `-e` so that its remaining arguments are never joined into a command
// string. The IPC channels take a circuit id and nothing else
// (`shared/ipc.ts`), so the renderer cannot reach the command line at all. And
// the runner — `apps/desktop/src/main/elecRunner.ts` — takes its argv from a
// plan `buildCommand` produced, passes `shell: false`, and asks the plan WHETHER
// THERE IS A CONTAINER rather than spelling a profile's name. This gate was
// written against that path before the file existed; the rules it is not
// exempted from are what keep the shape true now that it does.
//
// Defence in depth means the outer layer is allowed to be imperfect. It does not
// mean it is allowed to be absent.
//
// THE INTERACTION THAT DOES THE WORK, and it is worth naming because it reads
// like a coincidence and is not one: a file allowed to import `child_process` is
// NOT allowed to contain a toolchain word. So the runner cannot write the
// program it starts as a literal — it can only be `argv[0]` of a plan that came
// out of the table — and the installer launch can name no tool at all. What the
// second shape leaves is what its own header argues for: a program path main
// computed from the file IT downloaded and verified, and an argument list
// written in that one file and reachable from nowhere else.
//
// COMMENTS ARE STRIPPED BEFORE MATCHING. A comment is where almost every
// occurrence of these words currently lives: `packages/core/src/index.ts`
// re-states the boundary in prose above the export, `main/index.ts` explains
// twice why a package is a directory rather than a file, `shellStrings.ts`,
// `chassis.ts` and `component.ts` all name a tool in a sentence about it, and so
// do several test files. Every one of those is the rule being DESCRIBED rather
// than broken, and a gate that fires on its own documentation teaches people to
// stop writing the documentation — which is the lesson `check:egress` learned
// first and the reason `strip-comments.mjs` exists as its own module.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The same lexer `check:egress` and `check:elec` use. A second copy would be a
// second reading of one rule, and the first second copy written in this
// repository was blind to a URL; see the module for the whole of that argument.
import { stripComments } from "./strip-comments.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");

// The same roots and the same ignores as `check:egress`, verbatim, and for the
// same reason: both gates are asking about the SHIPPED app. `scripts/` is
// therefore outside this walk — which is why the entry for this gate's own test
// file in ALLOWLIST is inert, and says so.
const SCAN_ROOTS = ["apps/desktop/src", "apps/web/src", "packages"];

const IGNORED_DIRS = new Set(["node_modules", "dist", "out", ".turbo", "shots", "coverage"]);

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".css"]);

/**
 * What may not appear in source, and why each one is on the list.
 *
 * Ordered as the capability narrows: reaching the module, then the shapes that
 * turn a list of arguments back into a command line, then the literal that makes
 * the table optional, then the names themselves.
 */
export const RUNNER_RULES = [
  /**
   * The module that starts a process.
   *
   * TWO files may import it — `apps/desktop/src/main/elecRunner.ts`, the runner,
   * and `apps/desktop/src/main/update/launch.ts`, the installer launch — plus
   * the runner's own test, and those three entries are the whole of the
   * exemption (see ALLOWLIST). Everything else that starts a process is a
   * finding regardless of how innocent the call looks, because the interesting
   * question about a new `spawn` is never whether this particular one is safe:
   * it is whether the capability has begun to spread, and a capability spreads
   * one file at a time.
   *
   * An import statement and a `require` are the two shapes a module is usually
   * reached by, and a dynamic `import("node:child_process")` is the third: the
   * same module, through a call, for the case where an import statement is
   * inconvenient. A rule that names some of the ways to reach a module has not
   * closed a hole, it has documented one — and the third shape is the one an
   * edit reaches for when the first two are already matched.
   */
  {
    id: "child-process",
    pattern: /(?:from\s+|require\s*\(\s*|import\s*\(\s*)["']node:child_process["']/,
    what: "node:child_process",
  },
  /**
   * `shell: true`, and allowed NOWHERE — not even in the two files allowed to
   * spawn.
   *
   * This option is the whole attack in one word. A spawn without a shell hands
   * its arguments to the program as a LIST, which the program reads element by
   * element; a spawn with one joins them into a command LINE and gives that line
   * to `cmd.exe` or to `/bin/sh`, which re-reads it — so the first space inside
   * an argv element becomes a word boundary, `&` begins a second command, and the
   * workspace path stops being a value and becomes a small program.
   *
   * Every hardening in the table is written against a world in which nothing
   * between argv and the program re-reads the text. A shell IS that re-reading,
   * so there is no exception to make here and no profile that needs one: the
   * build is `colcon build`, which parses its own arguments, and a launcher that
   * cannot be handed an argv is not a launcher.
   */
  { id: "shell", pattern: /\bshell\s*:\s*true\b/, what: "shell: true" },
  /**
   * The exec family — `exec`, `execSync`, `execFile`, `execFileSync`,
   * `spawnSync`, `fork` — and each of them is a second door to the same room.
   * `exec` and `execSync` take a command STRING and run it through a shell;
   * `execFile` and `spawnSync` start a process as `spawn` does; `fork` starts a
   * whole Node process. The exemption on `child-process` names one file and a
   * single rule id, so a file allowed to call `spawn` is not thereby allowed to
   * call any of these.
   *
   * A NEGATIVE LOOKBEHIND, AND IT IS LOAD-BEARING.
   *
   * `re.exec(text)` is a REGULAR EXPRESSION and not a process, and this
   * repository uses it widely — `runner.ts` alone calls it twice, in `versionIn`
   * against a version banner and in `wslPath` against a drive letter. A rule
   * that fired on `re.exec(` would fire on a dozen correct lines, and the repair
   * a reader reaches for when a gate cries wolf is not a narrower gate: it is an
   * exemption, and then a second one. `(?<![.\w$])` is what makes the rule mean
   * „a bare call to something named exec“ — the only shape in which one of these
   * is a process. Somebody will eventually be tempted to delete it as noise; that
   * is the edit this paragraph exists to argue with.
   */
  {
    id: "exec-family",
    pattern: /(?<![.\w$])(exec|execSync|execFile|execFileSync|spawnSync|fork)\s*\(/,
    what: "an exec-family call, which takes a command line rather than an argv",
  },
  /**
   * A spawn whose program name is a LITERAL, and allowed nowhere.
   *
   * `spawn` itself is not forbidden — one file may use it — but the program name
   * must arrive as `argv[0]` of a plan the table produced rather than as a string
   * at the call site. A literal here says the opposite: that the author knew the
   * program, which means the command line came from somewhere other than the
   * table, which means the one sentence DEV-007 rests on has stopped being true
   * while every runtime assertion downstream goes on passing. The array that
   * follows a correct call is built from `plan.argv`, so the first element of the
   * call never needs to be a literal — and `spawn(argv[0], argv.slice(1))` is the
   * shape this rule is asking for.
   */
  {
    id: "spawn-literal",
    pattern: /\bspawn\s*\(\s*["'`]/,
    what: "spawn() with a literal program name",
  },
  /**
   * The five names a command line can begin with, anywhere on a comment-stripped
   * line.
   *
   * These are the words `packages/core/src/index.ts` names when it says the
   * command lines are written down in one file and nowhere else — so a hit
   * outside the files in ALLOWLIST means a second place has learned a tool's
   * name, and that is the first step towards a second place building a command.
   * Almost every legitimate hit is a file that NAMES a tool without ever running
   * one: the table, the package the code export generates, the URDF that carries
   * a `<gazebo>` element, and the Serbian copy that has to say „colcon“ because
   * that is what the user will type.
   *
   * THE BOUNDARIES ARE NOT DECORATION, and the price they charge is worth naming.
   *
   * The match is case-insensitive, because a rule that a capital letter defeats
   * is not a rule: the copy labels the Docker profile `"Docker"`, and the profile
   * is `"wsl"` in the table and `WSL` in a heading. But `colcon` under a
   * case-insensitive match is also the first six characters of
   * `colConcentration` and `colContribution`, which are Serbian table-column
   * keys — and a boundary-free version of this rule, run over the stripped tree,
   * reports those four lines and no others in a file that is not already exempt.
   * Four findings no honest exemption could cover, in shipped UI, and a gate
   * whose output is a fifth noise is a gate people learn to scroll past — which
   * is worse than not having it, because it also carries the authority of having
   * run.
   *
   * What the boundary costs is the welded identifiers: `gazebo_ros` and
   * `colcon_ws` are not findings, because `_` is a word character and the word
   * never ends. That cost is near zero here, which is why it was worth paying: an
   * invocation is always a program followed by a space, so every name this rule
   * is actually for is caught, and a program name that appears as a literal
   * instead of as `argv[0]` is already `spawn-literal`'s subject.
   */
  {
    id: "toolchain-name",
    pattern: /\b(colcon|ros2|gazebo|docker|wsl\.exe)\b/i,
    what: "a toolchain program name (colcon, ros2, gazebo, docker, wsl.exe)",
  },
];

/**
 * Files allowed to contain an otherwise-forbidden construct, each with the
 * reason IN THIS FILE rather than in a comment at the site.
 *
 * Three properties make this an allowlist and not a hole. It is keyed by exact
 * repo-relative path, so a new file never inherits an exemption; each entry names
 * the rule ids it exempts, so a file that may import the module is still not a
 * file that may name a tool; and the four rules that make a command line out of
 * data are exempted at the spawn sites and nowhere else, which
 * `assertNoSecurityExemptions` below refuses to let anybody widen in passing.
 *
 * What is left is vocabulary: every other entry is a file that NAMES a tool.
 */
export const ALLOWLIST = new Map([
  [
    // The runner's spawn — one of the two places in the application that is
    // allowed to start a process. The entry names the path this gate was written
    // against, so that whoever adds a second spawn site finds a decision here
    // rather than an empty map. That second site has since been added, in the
    // entry below, and it is a different shape rather than a widening of this
    // one.
    //
    // It exempts `child-process` ALONE, which is the point of naming ids instead
    // of paths. `shell`, the exec family and `spawn-literal` are exempted
    // nowhere, and for the same reason: the spawn here is `argv[0]` of a plan
    // `buildCommand` produced, with `shell: false`, and holding the files that
    // may spawn to those three is what keeps the deviation's first mitigation
    // checkable rather than remembered.
    //
    // `toolchain-name` is NOT exempted here either, and that one is deliberate
    // rather than an omission: the file must not be able to spell a tool's name
    // at all, because a file that cannot spell one cannot build a command line
    // out of one, whatever else it does. The cost of that is real — the profile
    // ids ARE `docker` and `wsl`, so a comparison against a profile is a finding
    // — and the repair belongs in the table rather than here. It has been made:
    // `buildCommand` puts the container's name on the plan, so the file asks
    // whether there IS one (`plan.container !== null`) and never which profile
    // it came from. If this file appears in a `toolchain-name` finding, the
    // repair has come undone and the finding is the correct outcome.
    "apps/desktop/src/main/elecRunner.ts",
    ["child-process"],
  ],
  [
    // The update's installer launch — the second file allowed to reach
    // `node:child_process`, and a DIFFERENT shape rather than a widening of the
    // entry above. The program here is not chosen from a table and could not be:
    // it is the path `update/service.ts` built under `userData/updates/`, hashed
    // while streaming and hashed again immediately before this call, and it is
    // the only thing the spawn is ever handed — no renderer reaches it. The
    // argument list is a literal in that one file, written down rather than
    // assembled, so `spawn-literal` (which is why `argv[0]` here is a parameter
    // and never a string) is what keeps this entry from being a hole.
    //
    // `toolchain-name` is not exempted, for the same reason as above, and it
    // costs nothing here: an installer is not a toolchain. `shell` and the exec
    // family are exempted for nobody, and this file is held to them — an
    // installer started through a shell would turn the path back into a command
    // line, which is the one thing its verification cannot protect.
    "apps/desktop/src/main/update/launch.ts",
    ["child-process"],
  ],
  [
    // A runner is not testable without a process to start, and this one is not
    // testable without the WORDS: it asserts the argv a Docker profile produces,
    // so `docker`, `--network`, the image reference and the profile id are the
    // SUBJECT of its assertions, and a fixture that could not spell them would
    // be asserting nothing. The exemption is the vocabulary rule only — the test
    // is held to `shell`, the exec family and `spawn-literal` exactly as the
    // file it tests is, because a test is as capable of starting a process as
    // anything else in the tree.
    "apps/desktop/src/main/elecRunner.test.ts",
    ["child-process", "toolchain-name"],
  ],
  [
    // The DECISION layer's test, and the same exemption for the same reason:
    // its stub runner answers with the argv a real one would, because the
    // property under test is that the command the user was shown and the
    // command that runs are one string. It asserts them against the table
    // rather than in place of it — `runner.ts`'s own test is what pins the
    // literal — and the file it tests needs no exemption at all, which is the
    // more useful fact: `elecRunnerIpc.ts` decides WHICH profile runs without
    // ever spelling one.
    "apps/desktop/src/main/elecRunnerIpc.test.ts",
    ["toolchain-name"],
  ],
  [
    // THE TABLE ITSELF — the one file in the repository where these words are
    // supposed to appear, and the only file that may choose a command line.
    // Its header is the argument for why the commands live in `@nexus/core`
    // rather than beside the spawn: a `.nexus.zip` is an ordinary shareable
    // artefact, so in the threat that matters the circuit on the other side of
    // it was written by whoever sent the file.
    "packages/core/src/electronics/runner.ts",
    ["toolchain-name"],
  ],
  [
    // The generated ROS 2 package's own contents: a README and a launch file
    // that tell the user to run `colcon build`. This is data Nexus WRITES, on
    // its way to a disk the user then builds from — it is not a command Nexus
    // runs, and the file has no way to run one.
    "packages/core/src/electronics/ros.ts",
    ["toolchain-name"],
  ],
  [
    // The generated URDF, whose Gazebo elements are part of the document's
    // schema: `<gazebo reference="...">` is an element name, and a URDF without
    // one is a robot nobody can simulate.
    "packages/core/src/electronics/urdf.ts",
    ["toolchain-name"],
  ],
  [
    // The copy shown when a profile refuses, which has to be able to name the
    // profile the user picked. It is main-process text and nothing else: there
    // is no spawn in this file and no import that could reach one.
    "apps/desktop/src/main/shellStrings.ts",
    ["toolchain-name"],
  ],
  [
    // The Serbian user-facing copy, which has to name the tool to be copy: the
    // profile labels read „colcon koji je već na PATH-u“ and „Docker“, and a
    // table that could not say which toolchain a profile uses would be
    // describing it in the abstract. Which tool it names is decided by the
    // probe, never by the renderer.
    "apps/desktop/src/renderer/src/strings/electronics.ts",
    ["toolchain-name"],
  ],
  [
    // The SAME copy in English, and the same exemption for the same reason:
    // the profile labels read "colcon that is already on this computer's PATH"
    // and "Docker", and a translation that could not name the toolchain it is
    // describing would be a worse translation than the one the user cannot
    // understand. Which tool it names is decided by the probe, never by the
    // renderer — this file is a leaf of the copy table and imports nothing.
    "apps/desktop/src/renderer/src/strings/electronics.en.ts",
    ["toolchain-name"],
  ],
  [
    // The wire contract, which REDECLARES the profile ids rather than importing
    // them: it imports nothing, by its own standing rule, so a type it needs is
    // a type it writes down. What it writes down is the feature's vocabulary —
    // the three ids the runner channels carry — and not a command, which is what
    // the same file's comment about those channels exists to say.
    "apps/desktop/src/shared/ipc.ts",
    ["toolchain-name"],
  ],
  [
    // A migration's CHECK constraint listing the three ids. A schema is a place
    // vocabulary is written down, and this one is the shape of the settings row
    // rather than anything that runs: the column it constrains holds the id the
    // user chose, and a constraint that could not name the ids would be
    // constraining nothing.
    "packages/db/src/migrations/069-elec-settings.ts",
    ["toolchain-name"],
  ],
  [
    // The store test's fixtures, which write the chosen profile id the way the
    // store will be asked to: `choice: "docker"` is the value under test, so the
    // word is the subject of those assertions rather than an accident of the
    // test's prose. The file is held to the security rules like any other.
    "packages/db/src/electronics/elecSettingsStore.test.ts",
    ["toolchain-name"],
  ],
  [
    // The table's own test — the file that asserts what the commands ARE, and
    // therefore the file that has to write them down a second time. It asserts
    // them against the table rather than in place of it: a literal in a test is
    // a claim about the table, and `assertKnownRuleIds` below keeps the claims
    // in this gate honest for the same reason.
    "packages/core/src/electronics/runner.test.ts",
    ["toolchain-name"],
  ],
  [
    // Two test NAMES in the generated package's own test, describing what the
    // package must contain: that it emits every file `colcon` needs, and that
    // `ros2 run` finds the node. The artefact's text is the subject of the
    // assertion — a name that could not say which tool the package is for would
    // be describing it in the abstract — and a name is not a call.
    "packages/core/src/electronics/ros.test.ts",
    ["toolchain-name"],
  ],
  [
    // This gate's own test, which names every forbidden construct by
    // construction — the shape `crypto-import-sites.test.mjs` has and says so
    // about: excluding the definition is not an exemption, because there is
    // nothing in it to run.
    //
    // It is INERT TODAY, and saying so is the honest thing rather than leaving a
    // reader to assume the walk reaches here: `SCAN_ROOTS` is `check:egress`'s
    // three app/package roots, and `scripts/` is not one of them. The entry is
    // kept because the walk is the thing most likely to widen, and this file is
    // the one that would then be a finding on the day it did.
    "scripts/check-runner.test.mjs",
    ["toolchain-name"],
  ],
]);

/**
 * The rules that are exempted for NOBODY.
 *
 * DEV-007's first mitigation is that no command line is ever data, and these
 * three are the shapes that turn data into one: a shell that re-reads an argv as
 * a command line, an exec-family call that takes a command string by
 * construction, and a literal program name that makes the closed table optional.
 * (`child-process` is not here — one file IS allowed to import the module, and
 * that entry is the whole of it.)
 *
 * Written as a set and enforced at startup rather than left to the map's
 * discipline, for the reason every gate in this repository exists: a rule nobody
 * can forget beats a rule everybody has read. An exemption for one of these is a
 * decision somebody has to make in `docs/deviations.md` and then argue for HERE,
 * which is a different act from adding a line to a map.
 */
const UNEXEMPTABLE = new Set(["shell", "exec-family", "spawn-literal"]);

/**
 * No allowlist entry may exempt one of the rules that are exempted for nobody.
 *
 * The mistake this prevents is the quiet one: a gate goes red on a file that
 * genuinely needs an exemption for a smell, and the shortest path to green is to
 * add the rule id beside it. That is how an allowlist becomes wallpaper, and in
 * this gate the wall it would paper over is the deviation itself. The check is a
 * function so the test can hand it the mistake, exactly as `assertKnownRuleIds`
 * is.
 */
export function assertNoSecurityExemptions(allowlist = ALLOWLIST) {
  for (const [path, ids] of allowlist) {
    for (const id of ids) {
      if (UNEXEMPTABLE.has(id)) {
        throw new Error(
          `check-runner: allowlist entry ${path} exempts "${id}", which is exempted for nobody. ` +
            `A command line is never data (DEV-007, docs/deviations.md); if a file genuinely ` +
            `needs this, the argument belongs there and in the rule table, not in this map.`,
        );
      }
    }
  }
}

/**
 * Every id in the allowlist has to be a rule that exists.
 *
 * `check:egress` was burned by exactly this: three entries exempted
 * `"absolute-url"`, a rule id split into four narrower ones long before, and
 * nothing in the file could tell a reader whether the exemption meant something
 * or nothing. Nothing was unsafe — an unknown id exempts nothing, so the gate
 * stayed fail-closed — but an exemption that means nothing today means something
 * the day a rule takes that name, and the shape is what was wrong rather than
 * the effect.
 *
 * Factored into a named function rather than left inline as `check:egress` has
 * it, for one reason: the check must be exercisable. An inline loop at module
 * scope can only be tested by importing the module twice with different content,
 * so the test that matters — a stale id THROWS — is the test nobody writes, and
 * the behaviour then rests on a paragraph. It is called below, at import, which
 * is what makes a stale entry a failure at startup rather than a sentence that
 * reads true.
 */
export function assertKnownRuleIds(rules = RUNNER_RULES, allowlist = ALLOWLIST) {
  const known = new Set(rules.map((rule) => rule.id));
  for (const [path, ids] of allowlist) {
    for (const id of ids) {
      if (!known.has(id)) {
        throw new Error(
          `check-runner: allowlist entry ${path} exempts "${id}", which is not a rule id. ` +
            `Known ids: ${[...known].join(", ")}.`,
        );
      }
    }
  }
}

assertKnownRuleIds();
assertNoSecurityExemptions();

function isIgnored(path) {
  return path.split(sep).some((segment) => IGNORED_DIRS.has(segment));
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (isIgnored(full)) continue;
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      yield* walk(full);
    } else if (SCANNED_EXTENSIONS.has(extname(full))) {
      yield full;
    }
  }
}

/**
 * Scans one file's text. Exported so the tests can drive it with a string
 * instead of a fixture tree — a gate whose own tests need files on disk is a
 * gate whose tests get skipped.
 */
export function scanSource(relPath, source) {
  const exempt = ALLOWLIST.get(relPath.split(sep).join("/")) ?? [];
  const findings = [];
  const lines = stripComments(source).split(/\r?\n/);
  const originalLines = source.split(/\r?\n/);
  for (const rule of RUNNER_RULES) {
    if (exempt.includes(rule.id)) continue;
    lines.forEach((line, index) => {
      if (rule.pattern.test(line)) {
        // Reported from the ORIGINAL line, so the message a human reads is the
        // code as written rather than the comment-blanked version of it. The
        // line NUMBER is right either way, because the stripper blanks a comment
        // body while keeping every line break in it.
        const text = (originalLines[index] ?? line).trim();
        findings.push({ file: relPath, line: index + 1, rule: rule.id, what: rule.what, text });
      }
    });
  }
  return findings;
}

export function scanRepo(root = REPO_ROOT) {
  const findings = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of walk(join(root, scanRoot))) {
      // Normalised to forward slashes, which is how an ALLOWLIST key is spelled
      // and how a reader copies a finding out of the failure output —
      // `check:elec` does the same, and on Windows the `relative()` result is
      // otherwise reported with backslashes and has to be retyped to be used.
      const rel = relative(root, file).split(sep).join("/");
      findings.push(...scanSource(rel, readFileSync(file, "utf8")));
    }
  }
  return findings;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = scanRepo();
  if (findings.length > 0) {
    console.error(
      `Runner audit FAILED — ${findings.length} construct(s) that start a process ` +
        `or name a toolchain:\n`,
    );
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}  ${f.what}\n    ${f.text}`);
    }
    console.error(
      "\nThe command line is never data (DEV-007, ADR-085 slice E6): every command\n" +
        "the runner executes is written down in packages/core/src/electronics/runner.ts,\n" +
        "and the circuit contributes exactly one value — the workspace path.\n" +
        "\n" +
        "If a hit above is a file that NAMES a tool without running one — the table,\n" +
        "the code it generates, the copy that describes it — add that path and the rule\n" +
        "id to ALLOWLIST in scripts/check-runner.mjs WITH ITS REASON. If it is a spawn,\n" +
        "or a shell, or an import of child_process anywhere but\n" +
        "apps/desktop/src/main/elecRunner.ts and apps/desktop/src/main/update/launch.ts,\n" +
        "the answer is not an exemption: the command belongs in the table, and the file\n" +
        "should get one from buildCommand() and spawn argv[0] with no shell set.",
    );
    process.exit(1);
  }
  console.log("Runner audit OK");
}
