import { describe, expect, it } from "vitest";

import { scanFiles, scanRepo, scanSource } from "./check-ids.mjs";

/**
 * `check:ids` makes the bound on an identifier structural instead of
 * remembered.
 *
 * An id is the field nobody thinks of as untrusted input, so at both trust
 * boundaries it got the check that asks whether the string exists and nothing
 * about what it is — 46 `profileId`s in the archive reader, 376 on the IPC wire,
 * none of them capped. Nothing downstream caps one either: stores write through
 * prepared statements and no migration CHECKs an id column past `NOT NULL`.
 *
 * This suite's first job is to show the gate goes RED on each shape that was
 * actually in the tree, including the ones a text-matching version missed; its
 * second is to show it stays quiet on the fields that are not ids and on the
 * bounded helpers themselves, so nothing here needs an exemption list.
 */

const FILE = "apps/desktop/src/main/index.ts";

describe("scanSource — the shapes that were in the tree", () => {
  it("refuses an unbounded id on the wire", () => {
    const findings = scanSource(FILE, 'const id = asNonEmptyString(body.id, "id");');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.expected).toBe("asId");
  });

  it("refuses an unbounded id in the archive reader", () => {
    const findings = scanSource(FILE, 'const p = nonEmptyStr(raw.profileId, "profileId");');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.expected).toBe("idStr");
  });

  /** `asNullableString` allows `""`, which is never „no id“ — that is what `null` says. */
  it("refuses a nullable id validated as a plain nullable string", () => {
    const findings = scanSource(FILE, 'x = asNullableString(body.parentId, "parentId");');
    expect(findings[0]?.expected).toBe("asNullableId");
  });

  /**
   * The shape a regex could not see, and there were 69 of them: the value is a
   * nested call, so „everything up to the last comma“ stops being decidable
   * without a parser. This is why the gate reads the AST.
   */
  it("sees through a nested first argument", () => {
    const source = 'const id = asNonEmptyString(asRecord(payload).profileId, "profileId");';
    expect(scanSource(FILE, source)).toHaveLength(1);
  });

  it("reads the static tail of a template field name", () => {
    const source = "const id = asNonEmptyString(root.id, `${field}[${index}].id`);";
    expect(scanSource(FILE, source)).toHaveLength(1);
  });

  it("reports the line the call is on", () => {
    const source = 'const a = 1;\nconst id = asNonEmptyString(body.id, "id");';
    expect(scanSource(FILE, source)[0]?.line).toBe(2);
  });
});

describe("scanSource — the shapes that are correct", () => {
  it("says nothing about the bounded helpers", () => {
    const source =
      'const a = asId(body.id, "id");\n' +
      'const b = idStr(raw.profileId, "profileId");\n' +
      'const c = asNullableId(body.parentId, "parentId");';
    expect(scanSource(FILE, source)).toEqual([]);
  });

  /** A title, a name and a passphrase are unbounded on purpose; only ids are this rule. */
  it("says nothing about a field that is not an id", () => {
    const source =
      'const a = asNonEmptyString(task.title, "task.title");\n' +
      'const b = asNonEmptyString(body.password, "password");';
    expect(scanSource(FILE, source)).toEqual([]);
  });

  /**
   * `chord.key` is a keyboard key and may legitimately be a single space, which
   * is why the rule is `Id`/`id` and not `*Key`. The two composite keys that ARE
   * identifiers are bounded by hand in the reader.
   */
  it("says nothing about a chord key", () => {
    const source = "const k = asNonEmptyString(chord.key, `${field}.key`);";
    expect(scanSource(FILE, source)).toEqual([]);
  });

  /** A name the source computes is undecidable here, and none of them are ids. */
  it("says nothing about a field name that ends in an interpolation", () => {
    const source = "const c = nonEmptyStr(checksumValue, `checksums.${key}`);";
    expect(scanSource(FILE, source)).toEqual([]);
  });

  /**
   * The gate reads the AST rather than raw text specifically so that the two
   * example calls in `packages/core/src/ids.ts`'s header — which are
   * documentation of the defect — do not trip it. A rule whose own explanation
   * fires it teaches people to stop writing the explanation.
   */
  it("says nothing about a call inside a comment", () => {
    const source = '// nonEmptyStr(raw.profileId, "profileId") was the shape.\nconst x = 1;';
    expect(scanSource(FILE, source)).toEqual([]);
  });
});

describe("the walk", () => {
  /**
   * `packages/db` is out of scope deliberately: a store's validator reads an
   * argument from MAIN, not from a file or the renderer, so it is not this
   * boundary. Both boundaries that ARE in scope must be reachable.
   */
  it("covers both trust boundaries and not the stores", () => {
    const files = scanFiles().map((f) => f.split(/[\\/]/).join("/"));
    expect(files.some((f) => f.endsWith("apps/desktop/src/main/index.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("packages/core/src/imex/importArchive.ts"))).toBe(true);
    expect(files.some((f) => f.includes("packages/db/"))).toBe(false);
  });
});

describe("the repository", () => {
  it("bounds every id at a trust boundary", () => {
    expect(scanRepo()).toEqual([]);
  });
});
