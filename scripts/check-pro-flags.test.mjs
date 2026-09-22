// The gate, tested — because a gate nobody has watched fail is indistinguishable
// from a gate that cannot fail.
//
// Most of these cases are the OPPOSITE assertion: the shapes that must NOT
// fire. An input's boolean, an unexported interface's boolean, a `boolean[]`,
// a field whose name merely contains a flagged one. That half matters more,
// because a gate that objects to correct code is one somebody switches off, and
// a switched-off gate reads as coverage while enforcing nothing.
//
// The block at the foot of this file is the other half, and it is new. Every
// case above proves ONE FUNNEL: `resultBooleans` finds a flag on an exported
// result interface, `surfaceNames` finds a name in a surface. Neither proves the
// sentence the gate actually enforces — a flag the module declares and the
// surface never names comes back as a FINDING — and until that block existed
// `auditAll` had one call site, which passed no root at all, walked the real
// repository and asserted `toEqual([])`. Empty is the correct answer there, and
// it is ALSO the answer a walk returns when it has stopped pairing modules with
// surfaces, or stopped reading either one. A test that cannot tell those two
// apart is not a control. So `auditAll` is driven here by a tree built to fail
// it, in both directions, with the gate's two census numbers asserted beside the
// verdict — the block says what each of them proves.

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { auditAll, resultBooleans, surfaceNames } from "./check-pro-flags.mjs";

const names = (text) => resultBooleans(text).map((f) => `${f.owner}.${f.name}`);

describe("resultBooleans — what counts as a claim the tool makes", () => {
  it("finds a boolean on an exported result interface", () => {
    expect(names("export interface FooResult {\n  readonly passes: boolean;\n}")).toEqual([
      "FooResult.passes",
    ]);
  });

  it("finds an optional boolean, in both spellings", () => {
    expect(names("export interface R {\n  readonly a?: boolean;\n  readonly b: boolean | undefined;\n}")).toEqual([
      "R.a",
      "R.b",
    ]);
  });

  it("keeps the declaration line, so a finding points at the field and not the file", () => {
    const text = ["export interface R {", "  readonly x: number;", "  readonly flag: boolean;", "}"].join("\n");
    expect(resultBooleans(text)[0]?.line).toBe(3);
  });

  it("ignores an INPUT's boolean — a caller's parameter is not a claim", () => {
    expect(names("export interface FooInput {\n  readonly strict: boolean;\n}")).toEqual([]);
  });

  it("ignores an OPTIONS bag for the same reason", () => {
    expect(names("export interface FormatOptions {\n  readonly compact: boolean;\n}")).toEqual([]);
  });

  it("ignores an UNEXPORTED interface — a lookup table's booleans are working, not output", () => {
    expect(names("interface Scale {\n  readonly feminine: boolean;\n}")).toEqual([]);
  });

  it("attributes a field to the interface it is IN, not to the last exported one above it", () => {
    // The bug this replaces: requiring `export` on the walk-back did not skip
    // an internal table's boolean, it blamed the exported interface above it.
    const text = [
      "export interface Result {",
      "  readonly ok: boolean;",
      "}",
      "",
      "interface Table {",
      "  readonly internal: boolean;",
      "}",
    ].join("\n");
    expect(names(text)).toEqual(["Result.ok"]);
  });

  it("does not read a boolean ARRAY or a function returning one as a flag", () => {
    const text = [
      "export interface R {",
      "  readonly flags: readonly boolean[];",
      "  readonly test: (x: number) => boolean;",
      "}",
    ].join("\n");
    expect(names(text)).toEqual([]);
  });
});

describe("surfaceNames — whole words only", () => {
  it("finds the field where the surface reads it", () => {
    expect(surfaceNames("{result.degenerate && <p/>}", "degenerate")).toBe(true);
  });

  it("does not accept a longer name that merely contains it", () => {
    expect(surfaceNames("{result.degenerateQuartiles}", "degenerate")).toBe(false);
  });

  it("accepts a name reached through a group, since that is still reading it", () => {
    expect(surfaceNames("{result.quartiles.degenerate && <p/>}", "degenerate")).toBe(true);
  });

  it("is false for a surface that never mentions it", () => {
    expect(surfaceNames("{result.q1}\n{result.q3}", "degenerate")).toBe(false);
  });
});

// THE COMPOSITION, on a tree built for it.
//
// The pairing is the whole of it, and it is a NAME pairing: `auditAll` lists
// `packages/core/src/pro`, drops the `.ts` to get a pack name, and asks whether
// `apps/desktop/src/renderer/src/pro` carries `<pack>.tsx`. Nothing is imported,
// no registry is consulted, no module is resolved — so the fixture below is one
// `.ts` and one `.tsx` with the SAME BASENAME, and the census numbers are
// asserted because a fixture whose basename the surface directory does not carry
// is not a near miss: it is read as no pack at all, and reports zero findings in
// perfect silence. (That silence is the same on a real tree, which is where
// `result.ts` lives: the shared kit has no surface of its own, and the gate's
// header is explicit that a helper's boolean is not a claim any screen owes a
// reader.)
//
// Neither fixture file has to compile. Nothing here is parsed, resolved or
// typechecked — the gate asks whether a NAME APPEARS, and a fragment answers
// that question exactly as well as a module does.

const CORE = "packages/core/src/pro";
const SURFACE = "apps/desktop/src/renderer/src/pro";
const MODULE = `${CORE}/gradnja.ts`;
const SURFACE_FILE = `${SURFACE}/gradnja.tsx`;

/** A throwaway repo with exactly the files a case needs, and nothing else. */
function fakeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "nexus-pro-flags-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  }
  return root;
}

/** One exported result interface carrying one boolean, on line 3. */
const RESULT = [
  "export interface UgibResult {",
  "  readonly sagMm: number;",
  "  readonly cantilever: boolean;",
  "}",
].join("\n");

/** The screen that reads the figure and never mentions the caveat — DC-48. */
const SILENT = [
  "export function UgibCard({ result }: { result: UgibResult }) {",
  "  return <p>{result.sagMm} mm</p>;",
  "}",
].join("\n");

/** The same screen one edit later: it reads the flag. */
const NAMES_IT = [
  "export function UgibCard({ result }: { result: UgibResult }) {",
  "  return result.cantilever ? <p>Konzola</p> : null;",
  "}",
].join("\n");

/** The same module with a second boolean beside the first, on line 4. */
const TWO_FLAGS = [
  "export interface UgibResult {",
  "  readonly sagMm: number;",
  "  readonly cantilever: boolean;",
  "  readonly safeServiceability: boolean;",
  "}",
].join("\n");

describe("the composition — a flag its surface never names", () => {
  it("reports the flag, at the field and in the pack's own file", () => {
    const root = fakeRepo({ [MODULE]: RESULT, [SURFACE_FILE]: SILENT });
    const { findings, packCount, flagCount } = auditAll(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe(MODULE);
    expect(findings[0]?.line).toBe(3);
    expect(findings[0]?.detail).toContain("cantilever");
    expect(findings[0]?.detail).toContain("gradnja.tsx");
    // The pair was walked and the module was READ — not merely listed. Without
    // these two the finding could be a coincidence of some other file.
    expect(packCount).toBe(1);
    expect(flagCount).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("says nothing once the surface names it — and still proves it read the tree", () => {
    const root = fakeRepo({ [MODULE]: RESULT, [SURFACE_FILE]: NAMES_IT });
    const { findings, packCount, flagCount } = auditAll(root);
    expect(findings).toEqual([]);
    // `toEqual([])` above is the assertion the real repository makes, and on a
    // fixture the gate never opened it would pass just as quietly. These two are
    // what make it mean something: `packCount` moves only once a module has been
    // paired with a surface, and `flagCount` only once that module has been read
    // and a boolean found in it. A walk that skipped the fixture, or read an
    // empty file, would fail here and not there.
    expect(packCount).toBe(1);
    expect(flagCount).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not let the flag the surface names cover for the one beside it", () => {
    const root = fakeRepo({ [MODULE]: TWO_FLAGS, [SURFACE_FILE]: NAMES_IT });
    const { findings, flagCount } = auditAll(root);
    // Two flags seen, one accounted for. This is the positive control on the
    // negative arm: the verdict is derived from the fixture's own text, so an
    // empty list means the surface answered and not that nothing was asked.
    expect(flagCount).toBe(2);
    const reported = findings.map((f) => f.detail).join("\n");
    expect(reported).toContain("safeServiceability");
    expect(reported).not.toContain("cantilever");
    rmSync(root, { recursive: true, force: true });
  });

  it("walks nothing for a module the surface directory does not pair", () => {
    const root = fakeRepo({ [`${CORE}/result.ts`]: RESULT, [`${SURFACE}/shared.tsx`]: SILENT });
    const { findings, packCount, flagCount } = auditAll(root);
    expect(findings).toEqual([]);
    // The gate's own header exempts the shared kit files by this mechanism and
    // by no other, so a fixture proves it is a property of the name pairing
    // rather than a special case for `result.ts`. It is also the near miss that
    // would hide a whole pack: the basename has to match on both sides.
    expect(packCount).toBe(0);
    expect(flagCount).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("the real repository", () => {
  // This case asserts the verdict and the census, in that order of importance —
  // and it is the reason the fixture block above exists, because on its own the
  // verdict half is an assertion that only the empty answer satisfies. It is
  // kept as the statement of what is true of the tree today; the fixture is what
  // makes it a statement rather than a silence.
  it("has no result flag its surface never names", () => {
    const { findings, packCount, flagCount } = auditAll();
    expect(findings, JSON.stringify(findings, null, 1)).toEqual([]);
    expect(packCount).toBeGreaterThanOrEqual(17);
    // A count this low would mean the walk stopped finding fields, which is how
    // a gate goes quiet without going green-for-the-right-reason.
    expect(flagCount).toBeGreaterThanOrEqual(50);
  });
});
