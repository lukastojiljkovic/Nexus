import { afterEach, describe, expect, it } from "vitest";

import { strings } from "./strings.js";
import { SHORTCUT_REFERENCE } from "./shortcutsReference.js";
import { BUILTIN_TEMPLATES, mergeTemplateEntries } from "./noteTemplates.js";

/**
 * Proof that the copy registries actually re-read after a language switch.
 *
 * This is the leg of the verification story neither the type checker nor
 * `scripts/check-string-capture.mjs` can cover.
 *
 *  - TypeScript cannot see it, because a string has the same type whenever it
 *    was read.
 *  - The static gate cannot see all of it. It flags module-scope reads written
 *    as `strings.a.b`, which is the common shape — but a registry built at
 *    module scope by COPYING another registry's getter (`REGISTRY.map((r) => ({
 *    name: r.name }))`) contains no `strings.` expression at all, so the gate
 *    walks straight past it while the value is just as frozen.
 *
 * The only thing that catches every shape is asking the question the user
 * would: change the table, and see whether the screen would follow. These
 * tests mutate a leaf directly — which is exactly what `applyLocale` does
 * internally — and assert the registry reports the new text.
 *
 * `strings` is deep-readonly by design, so writing to it needs a cast; that
 * cast is the point of the test and belongs nowhere else.
 */

type Mutable = Record<string, Record<string, Record<string, string>>>;
const table = strings as unknown as Mutable;

/** Swap one leaf, run the assertion, and always put the original back. */
function withLeaf(
  group: string,
  section: string,
  key: string,
  value: string,
  assertion: () => void,
): void {
  const original = table[group]?.[section]?.[key];
  expect(original, `${group}.${section}.${key} must exist`).toBeTypeOf("string");
  const node = table[group]?.[section];
  if (node === undefined) throw new Error("unreachable — guarded above");
  node[key] = value;
  try {
    assertion();
  } finally {
    node[key] = original as string;
  }
}

afterEach(() => {
  // Belt and braces: the table is a process-wide singleton, so a leak here
  // would surface as an unrelated suite failing somewhere else entirely.
  expect(strings.shortcuts.groups.palette).not.toContain("__PROBE__");
});

describe("registries built at module scope stay live", () => {
  it("the shortcuts reference re-reads its group titles", () => {
    const group = SHORTCUT_REFERENCE.find((candidate) => candidate.id === "palette");
    expect(group, "the palette group must exist").toBeDefined();
    withLeaf("shortcuts", "groups", "palette", "__PROBE__ paleta", () => {
      expect(group?.title).toBe("__PROBE__ paleta");
    });
    // And back, so the next language switch is not one-way.
    expect(group?.title).toBe(strings.shortcuts.groups.palette);
  });

  it("the shortcuts reference re-reads its row descriptions", () => {
    const row = SHORTCUT_REFERENCE.flatMap((g) => g.rows).find((r) => r.keys.includes("Enter"));
    expect(row, "a row keyed Enter must exist").toBeDefined();
    withLeaf("shortcuts", "reference", "paletteOpen", "__PROBE__ otvori", () => {
      expect(SHORTCUT_REFERENCE.flatMap((g) => g.rows).some((r) => r.description === "__PROBE__ otvori")).toBe(true);
    });
  });

  it("the built-in note templates re-read their names", () => {
    const template = BUILTIN_TEMPLATES.find((t) => t.id === "builtin:sastanak");
    expect(template, "the sastanak template must exist").toBeDefined();
    withLeaf("notes", "templateBuiltins", "sastanak", "__PROBE__ sastanak", () => {
      expect(template?.name).toBe("__PROBE__ sastanak");
    });
  });

  it("template names survive the copy into TemplateEntry", () => {
    // The shape the static gate is blind to: `mergeTemplateEntries` COPIES
    // `template.name` into a fresh object. That copy is correct only because
    // the function runs per call — if it were ever hoisted to module scope the
    // getters would be read once and frozen, and nothing else in the suite
    // would notice.
    withLeaf("notes", "templateBuiltins", "dnevnik", "__PROBE__ dnevnik", () => {
      const entries = mergeTemplateEntries([]);
      expect(entries.some((entry) => entry.name === "__PROBE__ dnevnik")).toBe(true);
    });
    expect(mergeTemplateEntries([]).some((e) => e.name.includes("__PROBE__"))).toBe(false);
  });
});
