import { describe, expect, it } from "vitest";

import {
  ALLOWLIST,
  assertKnownRuleIds,
  assertNoSecurityExemptions,
  RUNNER_RULES,
  scanRepo,
  scanSource,
} from "./check-runner.mjs";

/** The rule ids a source produced, sorted — the question of WHICH rule fired. */
const ids = (findings) => findings.map((f) => f.rule).sort();

/** The rule each finding was reported by, with the line it was reported on. */
const hits = (findings) => findings.map((f) => `${f.rule}@${f.line}`);

/** One rule's own `what`, looked up rather than indexed, so a reordered table breaks nothing. */
const whatOf = (id) => RUNNER_RULES.find((rule) => rule.id === id).what;

describe("the rules catch what they are for", () => {
  const cases = [
    ["child-process", 'import { spawn } from "node:child_process";'],
    ["child-process", 'const cp = require("node:child_process");'],
    ["child-process", 'const cp = await import("node:child_process");'],
    ["shell", "spawn(argv[0], argv.slice(1), { shell: true });"],
    ["exec-family", 'exec("ls -la")'],
    ["exec-family", "const out = spawnSync(argv[0], argv.slice(1));"],
    ["exec-family", "fork(workerPath);"],
    ["spawn-literal", 'spawn("colcon", ["build"]);'],
    ["toolchain-name", 'const program = "wsl.exe";'],
  ];

  for (const [id, source] of cases) {
    it(`catches ${id} — ${source}`, () => {
      expect(ids(scanSource("some/file.ts", source))).toContain(id);
    });
  }

  it("has a test for every rule, so a new rule cannot arrive untested", () => {
    // The rule that keeps this file honest. Adding a rule to RUNNER_RULES
    // without a case above fails here rather than silently shipping a pattern
    // nobody has ever seen match.
    const tested = [...new Set(cases.map(([id]) => id))].sort();
    expect(RUNNER_RULES.map((r) => r.id).sort()).toEqual(tested);
  });

  it("reports the right line and rule id, counted past a stripped comment", () => {
    // The line number is the whole of a finding's usefulness, and the stripper
    // is the thing that could break it: a block comment is blanked in place and
    // a line comment is cut at its own newline, so the count survives both. The
    // comment below contains THREE of the words this gate refuses, which is what
    // makes the line number worth asserting rather than the fact of a hit.
    const source = [
      "const keep = 1;",
      '// exec("rm -rf /") would be a call here; docker and colcon are prose',
      "",
      'const out = exec("ls -la");',
    ].join("\n");
    expect(hits(scanSource("some/file.ts", source))).toEqual(["exec-family@4"]);
    // And the whole finding at once, so that a field added to it or dropped from
    // it is a red test rather than a change a reader has to notice.
    expect(scanSource("some/file.ts", source)).toEqual([
      {
        file: "some/file.ts",
        line: 4,
        rule: "exec-family",
        what: whatOf("exec-family"),
        text: 'const out = exec("ls -la");',
      },
    ]);
  });

  it("shows the ORIGINAL line, even where the stripper blanked part of it", () => {
    // A finding that quoted the comment-blanked version of its own line would be
    // unreadable in exactly the case a reader most needs it: the line where
    // somebody explained what they were doing, and the explanation is what the
    // message would have removed.
    const source = 'const profile = "docker"; // the user picked this in settings';
    expect(scanSource("some/file.ts", source)[0]?.text).toBe(source);
  });
});

describe("a comment is not a finding", () => {
  it("ignores a toolchain name in prose, which is where almost all of them live", () => {
    // Not a hypothetical: the tree is full of sentences like these, and the
    // first version of this gate's idea would have reported every one of them.
    // Each case carries its OWN delimiters, which is the whole of why it is
    // ignored: a JSDoc line presented without the `/**` that opens it is not a
    // comment to any lexer, and the first draft of this test asserted against
    // exactly that mistake.
    for (const source of [
      "// The user points at a colcon workspace's src/ directory.",
      "/**\n * `wsl.exe` writes UTF-16LE, so a reader that decoded it as UTF-8 sees NULs.\n */",
      "/* docker run needs the image pulled first, which is a network operation */",
      "// `-e` is not decoration: without it wsl.exe joins the arguments into a string",
    ]) {
      expect(scanSource("some/file.ts", source)).toEqual([]);
    }
  });

  it("ignores `shell: true` written in a comment about not passing it", () => {
    for (const source of [
      "// Never pass shell: true to a spawn whose argv came from anywhere.",
      "/**\n * A `shell: true` option here would make the workspace path a program.\n */",
    ]) {
      expect(scanSource("some/file.ts", source)).toEqual([]);
    }
  });

  it("does NOT ignore the same words in a string, which is what code is", () => {
    // The other side of the same line: a template literal full of `//` is not a
    // comment, and the stripper's string tracking is what keeps the two apart.
    // A gate that read a URL as a comment is the defect `strip-comments.mjs`
    // was written to fix, and it would read a command as one too.
    expect(ids(scanSource("some/file.ts", 'const hint = "// run colcon build";'))).toEqual([
      "toolchain-name",
    ]);
  });
});

describe("the exec-family rule's lookbehind", () => {
  it("does NOT fire on a regular expression's own exec — the case it exists for", () => {
    // THIS TEST IS THE REASON `(?<![.\w$])` IS IN THE PATTERN, so it is a case of
    // its own rather than a line in a list. Without the lookbehind the rule fires
    // on `re.exec(text)`, and this repository calls that widely — the closed
    // table does it twice, in `versionIn` and in `wslPath`. A gate that fired on
    // those would be given an exemption within the week, and the exemption would
    // then sit in a security gate covering a file that also happens to hold a
    // real `exec(`. Narrowing the pattern is the repair; an allowlist entry is
    // the wreckage.
    for (const source of [
      "const found = /\\d+\\.\\d+/.exec(line);",
      "const drive = DRIVE.exec(hostPath);",
      "if (matcher.exec(text) !== null) return true;",
      "const ref = window.regexp.exec(source);",
    ]) {
      expect(scanSource("some/file.ts", source)).toEqual([]);
    }
  });

  it("still fires on a bare call, which is the thing that starts a process", () => {
    expect(ids(scanSource("some/file.ts", 'exec("ls")'))).toContain("exec-family");
    expect(ids(scanSource("some/file.ts", "execFile(file, args, cb)"))).toContain("exec-family");
    expect(ids(scanSource("some/file.ts", "fork(modulePath)"))).toContain("exec-family");
  });
});

describe("the toolchain rule's boundaries", () => {
  it("fires on each of the five words, and on their capitals", () => {
    // Case-insensitive on purpose: a rule a capital letter defeats is not a rule,
    // and the next file to name a tool will not necessarily spell it the way the
    // table does.
    for (const word of ["colcon", "ros2", "gazebo", "docker", "wsl.exe"]) {
      const plain = `const program = "${word}";`;
      const shouted = `const program = "${word.toUpperCase()}";`;
      expect(ids(scanSource("some/file.ts", plain))).toContain("toolchain-name");
      expect(ids(scanSource("some/file.ts", shouted))).toContain("toolchain-name");
    }
  });

  it("does not fire on a column key that only reads like a toolchain name", () => {
    // The four lines the boundary exists for. `colConcentration` and
    // `colContribution` are Serbian table-column keys in shipped UI, and to a
    // boundary-free case-insensitive match they begin with `colcon` — four
    // findings that no exemption could honestly cover, in a gate whose whole
    // authority depends on its output being worth reading.
    for (const line of [
      "head={[s.colProduct, s.colDosePerHa, s.colConcentration]}",
      'colContribution: "Ponderisano",',
    ]) {
      expect(scanSource("some/file.tsx", line)).toEqual([]);
    }
  });

  it("does not reach a toolchain word welded into an identifier — the boundary's price", () => {
    // The other half of the same decision, pinned so that a later reader meets it
    // as a choice rather than as a surprise. `gazebo_ros` and `colcon_ws` are
    // plugin and directory names, not programs: an invocation is always a program
    // followed by a space, which is why paying this price costs nothing the rule
    // is actually for. A name that appears as a literal instead of as `argv[0]`
    // is `spawn-literal`'s subject either way.
    for (const source of ['const bridge = "gazebo_ros";', 'const ws = "colcon_ws";']) {
      expect(scanSource("some/file.ts", source)).toEqual([]);
    }
  });
});

describe("the allowlist is an allowlist", () => {
  it("names only rules that exist, so an exemption cannot quietly mean nothing", () => {
    const known = new Set(RUNNER_RULES.map((rule) => rule.id));
    const unknown = [...ALLOWLIST].flatMap(([path, exempt]) =>
      exempt.filter((id) => !known.has(id)).map((id) => `${path}:${id}`),
    );
    expect(unknown).toEqual([]);
  });

  it("fails loudly on a stale id — the mistake check:egress was burned by", () => {
    // `check:egress` shipped three entries exempting `"absolute-url"`, a rule id
    // that had been split into four narrower ones and had not existed for a long
    // time. Nothing was unsafe — an unknown id exempts nothing — but the file
    // read as though a decision had been made, and the day a rule took that name
    // the three files would have started being exempt from it. The check runs at
    // import; it is a function so that this test can hand it the mistake instead
    // of taking the startup behaviour on faith.
    const stale = new Map([["some/file.ts", ["absolute-url"]]]);
    expect(() => assertKnownRuleIds(RUNNER_RULES, stale)).toThrow(/"absolute-url"/);
    expect(() => assertKnownRuleIds(RUNNER_RULES, stale)).toThrow(/some\/file\.ts/);
    expect(() => assertKnownRuleIds()).not.toThrow();
  });

  it("exempts only the named rule, not the whole file", () => {
    const file = "apps/desktop/src/main/elecRunner.ts";
    expect(ALLOWLIST.get(file)).toContain("child-process");
    expect(scanSource(file, 'import { spawn } from "node:child_process";')).toEqual([]);
    // The file that may import the module may still not name a program, and may
    // still not ask for a shell. Those two are exempted NOWHERE, deliberately:
    // they are the shapes DEV-007 exists to prevent, so the one file allowed to
    // spawn is held to them.
    expect(ids(scanSource(file, 'spawn("colcon")'))).toEqual(["spawn-literal", "toolchain-name"]);
    const shelled = "spawn(argv[0], argv.slice(1), { shell: true });";
    expect(ids(scanSource(file, shelled))).toEqual(["shell"]);
  });

  it("does NOT exempt the spawn site from the vocabulary rule", () => {
    // A decision rather than an omission, and it is the reason the plan carries
    // the container's name: the file asks whether there IS one, so it never
    // spells a profile — and a file that cannot spell a tool cannot build a
    // command line out of one. If this goes red the repair has come undone, and
    // the answer is the table rather than an entry in the map below.
    const file = "apps/desktop/src/main/elecRunner.ts";
    expect(ALLOWLIST.get(file)).not.toContain("toolchain-name");
    expect(ids(scanSource(file, 'const p = target.profile === "docker";'))).toEqual([
      "toolchain-name",
    ]);
    expect(scanSource(file, 'if (active.container === null) return "exited";')).toEqual([]);
  });

  it("lets the runner's test spell what its fixtures assert, and nothing else", () => {
    const file = "apps/desktop/src/main/elecRunner.test.ts";
    expect(ALLOWLIST.get(file)).toContain("child-process");
    expect(ALLOWLIST.get(file)).toContain("toolchain-name");
    expect(scanSource(file, 'expect(argv.slice(0, 2)).toEqual(["docker", "run"]);')).toEqual([]);
    // A fixture is as capable of starting a process as anything else in the tree.
    expect(ids(scanSource(file, 'spawn("colcon")'))).toEqual(["spawn-literal"]);
    expect(ids(scanSource(file, "spawn(argv[0], [], { shell: true });"))).toEqual(["shell"]);
  });

  it("refuses an exemption for a rule that is exempted for NOBODY", () => {
    // The quiet mistake: a red gate on a file that wants an exemption for a
    // smell, and the shortest path to green is to add the rule id beside it. In
    // this gate the thing that would be papered over is the deviation itself.
    for (const id of ["shell", "exec-family", "spawn-literal"]) {
      const bad = new Map([["some/file.ts", [id]]]);
      expect(() => assertNoSecurityExemptions(bad)).toThrow(new RegExp(`"${id}"`));
    }
    expect(() => assertNoSecurityExemptions()).not.toThrow();
    // `child-process` is not one of the three: one file may import the module,
    // and that entry is the whole of the exemption.
    const spawnSite = new Map([["apps/desktop/src/main/elecRunner.ts", ["child-process"]]]);
    expect(() => assertNoSecurityExemptions(spawnSite)).not.toThrow();
  });

  it("does not extend to a neighbouring file", () => {
    const beside = "apps/desktop/src/main/other.ts";
    const imported = 'import { spawn } from "node:child_process";';
    expect(ids(scanSource(beside, imported))).toEqual(["child-process"]);
    const sibling = "packages/core/src/electronics/other.ts";
    expect(ids(scanSource(sibling, 'const p = "docker";'))).toEqual(["toolchain-name"]);
  });

  it("is keyed by exact path, so an exempted module does not exempt its own package", () => {
    // `ros.ts` may name a tool because the package it generates does. `code.ts`
    // beside it may not — the exemption is a path, not a directory.
    const beside = "packages/core/src/electronics/code.ts";
    expect(scanSource("packages/core/src/electronics/ros.ts", 'const a = "colcon";')).toEqual([]);
    expect(ids(scanSource(beside, 'const a = "colcon";'))).toEqual(["toolchain-name"]);
  });
});

describe("the repository itself", () => {
  it("is clean end to end", () => {
    // The assertion the CLI makes, run here so a red gate is a red TEST — the
    // form people actually notice — and not only a red pipeline step.
    //
    // It is the one test in this file that can be red for a reason that is not
    // this gate's: the walk covers the whole tree, so a lane that is mid-edit
    // produces a finding here with nothing wrong with any rule. A red run wants
    // `node scripts/check-runner.mjs` and a reading of the finding — never a
    // widened allowlist, which is what `assertNoSecurityExemptions` above exists
    // to make loud.
    expect(scanRepo()).toEqual([]);
  });
});
