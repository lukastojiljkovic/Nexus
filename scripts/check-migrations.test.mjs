import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { citations, declared, findings, order, scanRepo } from "./check-migrations.mjs";

/**
 * `check:migrations` guards the one thing about the server series that a reader
 * cannot check by looking: that its numbers mean something.
 *
 * Two things have to be shown here and they are different. On a tree of its own,
 * that each of the four clauses fires — because `scanRepo()` returning `[]` is
 * both the correct answer AND the answer a walker pointed at nothing gives, so
 * the live-tree assertions below can never be the proof that the rule works. And
 * on the live tree, that the series is pinned: the numbers it declares are
 * written out here so that renumbering an applied migration becomes a deliberate
 * act with a test to update rather than a tidy-up nobody notices.
 */

/** A tree of its own, with a series and a place to cite it from. */
function fakeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "nexus-migrations-"));
  for (const [name, source] of Object.entries(files)) {
    const full = join(root, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source);
  }
  return root;
}

/** A migration file whose first line declares whatever the test wants declared. */
function migration(declaration) {
  return `-- Nexus sync — migration ${declaration}: a step.\n\nselect 1;\n`;
}

function scan(files) {
  const root = fakeRepo(files);
  try {
    return findings(
      declared(join(root, "migrations")),
      citations(root),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("the order of a series", () => {
  it("sorts a sub-letter after its own number and before the next one", () => {
    const keys = ["004", "003c", "001", "003", "003b", "002"];
    expect(keys.sort((a, b) => {
      const [an, al] = order(a);
      const [bn, bl] = order(b);
      return an - bn || (al < bl ? -1 : al > bl ? 1 : 0);
    })).toEqual(["001", "002", "003", "003b", "003c", "004"]);
  });
});

describe("what a declaration has to be", () => {
  it("reads the number off the first line, and nothing off a later one", () => {
    const root = fakeRepo({
      "migrations/20260808090000_a.sql": migration("001"),
      "migrations/20260808090100_b.sql": "-- A header that says nothing.\n-- see migration 001\n",
    });
    try {
      const files = declared(join(root, "migrations"));
      expect(files.map((f) => f.key)).toEqual(["001", null]);
      expect(files[1].file).toBe("20260808090100_b.sql");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a file that declares nothing rather than passing over it", () => {
    const found = scan({
      "migrations/20260808090000_a.sql": "-- Nexus sync — migration 001: a step.\nselect 1;\n",
      "migrations/20260808090100_b.sql": "-- Nexus sync — no number here.\nselect 1;\n",
    });
    expect(found.map((f) => f.kind)).toEqual(["undeclared"]);
    expect(found[0].file).toBe("20260808090100_b.sql");
  });
});

describe("what the series refuses", () => {
  it("refuses two files claiming one number, and says it once", () => {
    const found = scan({
      "migrations/20260808090000_a.sql": migration("003"),
      "migrations/20260808090100_b.sql": migration("003"),
    });
    // Once, not twice: a duplicate also breaks „strictly increasing", and a
    // second finding for one defect makes the count in the banner a lie.
    expect(found.map((f) => f.kind)).toEqual(["duplicate"]);
    expect(found[0].what).toContain("20260808090000_a.sql");
  });

  it("refuses a series whose numbers run backwards against its filenames", () => {
    const found = scan({
      "migrations/20260808090000_a.sql": migration("005"),
      "migrations/20260808090100_b.sql": migration("004"),
    });
    expect(found.map((f) => f.kind)).toEqual(["order"]);
    expect(found[0].file).toBe("20260808090100_b.sql");
  });

  it("accepts a sub-letter chain, which is the shape the real series uses", () => {
    expect(
      scan({
        "migrations/20260808090000_a.sql": migration("003"),
        "migrations/20260808090100_b.sql": migration("003b"),
        "migrations/20260808090200_c.sql": migration("003c"),
        "migrations/20260808090300_d.sql": migration("004"),
      }),
    ).toEqual([]);
  });
});

describe("what a citation has to name", () => {
  it("refuses a citation of a number the series does not carry", () => {
    const found = scan({
      "migrations/20260808090000_a.sql": migration("001"),
      "functions/thing/index.ts": "// The wall is described in migration 006 of this series.\n",
    });
    expect(found.map((f) => f.kind)).toEqual(["dangling"]);
    expect(found[0].file).toBe("functions/thing/index.ts");
    expect(found[0].line).toBe(1);
    expect(found[0].what).toContain("migration 006");
  });

  it("accepts a citation that resolves, in any file it is written in", () => {
    expect(
      scan({
        "migrations/20260808090000_a.sql": migration("001"),
        "README.md": "The wall is migration 001.\n",
        "config.toml": "# See migration 001 and migration 001.\n",
        "tests/database/x.test.sql": "-- migration 001 revokes anon.\n",
      }),
    ).toEqual([]);
  });

  it("reads a file cited by NAME without finding a number inside its timestamp", () => {
    // The advice the gate itself prints is to cite by filename, so this is the
    // shape most likely to be written next. `20260808090000_...` ends in `000`;
    // without the boundary guards it is read as a citation of „migration 000".
    const root = fakeRepo({
      "migrations/20260809120000_a.sql": migration("008"),
      "README.md": "See `20260809120000_a.sql` and 20260808090000_b.sql.\n",
    });
    try {
      // The only citation in the tree is the migration's own header line: a file
      // does cite itself, and that is why this asserts the list and not its
      // length. What matters is that the README contributed nothing.
      expect(citations(root).map((c) => c.file)).toEqual(["migrations/20260809120000_a.sql"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not mistake a window onto a longer number for a citation", () => {
    // With only a trailing guard, nothing matches `0010` — and `010` does, from
    // its second digit. A number has to be the whole number.
    const root = fakeRepo({
      "migrations/20260808090000_a.sql": migration("001"),
      "README.md": "migration 0010 and migration 0100 are not citations of anything.\n",
    });
    try {
      expect(citations(root).map((c) => c.key)).toEqual(["001"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the live series", () => {
  it("declares exactly the numbers it has, gaps and all, pinned", () => {
    // 006 and 007 are not a mistake to be tidied away: the series numbers
    // LOGICAL STEPS, and those two were folded into the files before them. This
    // list is here so that closing the gap is a decision with a failing test
    // attached, not a drive-by renumbering of applied migrations.
    expect(declared().map((f) => f.key)).toEqual([
      "001", "002", "003", "003b", "003c", "004", "005",
      "008", "009", "010", "011", "012", "013", "014",
    ]);
  });

  it("is green, and finds a real number of citations while being green", () => {
    expect(scanRepo()).toEqual([]);
    // „found nothing" and „looked at nothing" are different answers, so the
    // census is asserted too — a walker that stopped reaching a directory would
    // otherwise show up as a pass.
    expect(citations().length).toBeGreaterThan(100);
  });

  it("would have caught the citation that prompted it, had it been in this tree", () => {
    // The live instance was `packages/sync-transport/src/signal.ts`, outside the
    // scope this gate can honestly claim — see the header. The rule is shown
    // firing on the same sentence where the scope does reach.
    const found = scan({
      "migrations/20260808090000_a.sql": migration("001"),
      "functions/sync-enable/index.ts": "// realtime.topic() is fixed by migration 006.\n",
    });
    expect(found.map((f) => f.kind)).toEqual(["dangling"]);
  });
});
