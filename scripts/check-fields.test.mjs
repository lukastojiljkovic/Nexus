import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { declaredType, findings, inputsInRepo, scanRepo } from "./check-fields.mjs";

/**
 * `check:fields` makes „a surface does not draw its own text field" structural.
 *
 * The class is the last step of [[DC-120]] and the one that regrows, because
 * every other step was a repair and this is the only one that is a rule. What
 * it has to be shown to do is fire on the shape it was written for — on a tree
 * of its own, because `scanRepo()` returning `[]` is the correct answer AND the
 * answer a walk pointed at the wrong directory gives — and stay quiet on the
 * four input types that are somebody else's subject.
 *
 * Its discriminator is `type` rather than the class name, and the suite says so
 * in the one place that matters: the pair of fields that the previous,
 * class-based census could not see at all, because they wear a local class.
 */

/** A tree of its own. Keys are paths from the root, so both packages and apps. */
function fakeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "nexus-fields-"));
  for (const [name, source] of Object.entries(files)) {
    const full = join(root, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source);
  }
  return root;
}

/** One page with one `<input>` in it, wrapped the way a real call site is. */
function page(attributes) {
  return `export function P() {\n  return <div className="row">\n    <input ${attributes} />\n  </div>;\n}\n`;
}

describe("what an input says it is", () => {
  it("reads the type, and calls an absent one what it is — text", () => {
    expect(declaredType('<input type="date" />')).toBe("date");
    expect(declaredType("<input type='time' />")).toBe("time");
    // Absent is NOT the same answer as unknown: it is the HTML default.
    expect(declaredType('<input className="x" />')).toBeNull();
    // A computed type is a question this gate will not guess at.
    expect(declaredType("<input type={kind} />")).toBe("?");
  });

  /**
   * The trap `check:rows` recorded and this file inherits: the value has to be
   * the ATTRIBUTE'S, or an unrelated one that spells a type out fires the rule.
   * `aria-label={s.filters.fromLabel}` is exactly that, one line from a real
   * `type="date"`, and so is an `aria-describedby` reading „file".
   */
  it("takes the attribute's value and never a neighbour's", () => {
    expect(declaredType('<input aria-label="date" type="text" />')).toBe("text");
    expect(declaredType('<input type="text" aria-label="date" />')).toBe("text");
    expect(declaredType('<input placeholder="file" />')).toBeNull();
  });

  it("survives an arrow function before the type", () => {
    expect(declaredType('<input onChange={() => set(v)} type="radio" />')).toBe("radio");
  });
});

describe("the verdict", () => {
  const input = (type) => ({ file: "a.tsx", line: 1, type });

  it("is a finding for a text entry and for one that never said", () => {
    expect(findings([input("text"), input("search"), input(null)])).toHaveLength(3);
  });

  it("names date and time as the primitive's subject, which is the ruling", () => {
    expect(findings([input("date"), input("time"), input("datetime-local")])).toHaveLength(3);
  });

  it("is quiet on the four that draw something else", () => {
    expect(findings([input("radio"), input("checkbox"), input("range"), input("file")])).toEqual([]);
  });
});

describe("on a tree of its own", () => {
  /**
   * THE SHAPE THE GATE WAS REWRITTEN FOR. `noteFindBar.tsx`'s fields carry
   * `note__find-input` and never spelled the shared class, so a rule phrased as
   * „no call site writes `nx-textfield__input`" would report this file clean —
   * which is what the census said about the live tree for as long as it keyed
   * on the name. The finding here is the element, not the class.
   */
  it("goes red on a hand-rolled field wearing a class of its own", () => {
    const root = fakeRepo({
      "apps/desktop/src/FindBar.tsx": page('type="text" className="note__find-input" value={q}'),
    });
    try {
      const census = inputsInRepo(root);
      // The census first: a walk that found nothing and a walk that read
      // nothing are the same `[]`, and only this tells them apart.
      expect(census).toHaveLength(1);
      expect(census[0]?.file).toBe("apps/desktop/src/FindBar.tsx");
      expect(census[0]?.line).toBe(3);

      const found = scanRepo(root);
      expect(found).toHaveLength(1);
      expect(found[0]?.type).toBe("text");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("goes red on a field that never declared a type at all", () => {
    const root = fakeRepo({
      "apps/desktop/src/Bad.tsx": page('className="x__input" value={q}'),
    });
    try {
      expect(scanRepo(root)).toHaveLength(1);
      expect(scanRepo(root)[0]?.type).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is quiet on a radio, a range and a hidden file picker", () => {
    const root = fakeRepo({
      "apps/desktop/src/Ok.tsx": page('type="radio" className="nx-radio" name="n"'),
      "apps/desktop/src/Ok2.tsx": page('type="range" className="nx-slider" min={0} max={9}'),
      "apps/desktop/src/Ok3.tsx": page('type="file" hidden onChange={pick}'),
    });
    try {
      expect(inputsInRepo(root)).toHaveLength(3);
      expect(scanRepo(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * The primitive is the one file allowed to write a bare text input, and it is
   * exempt by PATH rather than by luck: its element forwards `type` through
   * `{...rest}`, so a real `TextField` rendering a `date` field would otherwise
   * read as an undeclared one.
   */
  it("exempts the primitive, and nothing else in `packages`", () => {
    const root = fakeRepo({
      "packages/ui/src/components/TextField.tsx": page('className="nx-textfield__input" {...rest}'),
      "packages/core/src/Other.tsx": page('type="text" className="x"'),
    });
    try {
      const census = inputsInRepo(root);
      expect(census).toHaveLength(1);
      expect(census[0]?.file).toBe("packages/core/src/Other.tsx");
      expect(scanRepo(root)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is not set off by prose about the shape, or by a wrapped arrow", () => {
    const root = fakeRepo({
      "apps/desktop/src/Doc.tsx": [
        "export function Doc() {",
        "  /* <input type=\"text\" className=\"note__find-input\" /> — the shape this",
        "     gate exists for, quoted in a comment. */",
        "  // <input type=\"text\" /> and again on a line comment",
        "  return (",
        '    <input onChange={() => {}} type="radio" className="nx-radio" />',
        "  );",
        "}",
      ].join("\n"),
    });
    try {
      expect(inputsInRepo(root)).toHaveLength(1);
      expect(scanRepo(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the live tree", () => {
  it("has no text field drawn by hand", () => {
    expect(scanRepo()).toEqual([]);
  });

  /**
   * THE TEST THAT WOULD HAVE CAUGHT A BROKEN WALK. `scanRepo()` returning `[]`
   * is the correct answer AND the answer a walk that found nothing gives, so
   * the verdict alone proves nothing — the census has to be shown to be reading
   * the tree, and the count is exact rather than „greater than zero" for the
   * same reason: a walk that lost one directory would still be non-empty.
   *
   * TWENTY, and the breakdown is the whole claim this gate makes about the app:
   * every intrinsic `<input>` left in it draws something other than a text
   * entry. Eight radios (PRIVATNO's four credential and recovery-kit choices,
   * ELEKTRONIKA's chassis shape, and ELEKTRONIKA's runner profile — one element
   * in source, drawn three times by a `map` over the closed table), six ranges
   * (the dashboard dim slider, CULTURE's seek bar, the LAB's light and two tone
   * controls, the WORKSHOP's toolpath layer), five
   * hidden file pickers (NOTE's attachment input, CULTURE's two imports, the QR
   * reader's image and the SCANNER's page) and one checkbox — the `Checkbox` primitive's own element, which is why the
   * exemption is `TextField.tsx` alone and this one needs none: a checkbox is
   * allowed by TYPE, so a second exempt file would have been a second list to
   * keep.
   *
   * Each radio here carries `.nx-radio`, which the GATE asserts and this census
   * does not: a bare one renders at 13x13 in the OS widget with an eleven-pixel
   * hole in its hit area, and this count would go on being green while it did.
   */
  it("sees exactly the twenty inputs the rule deliberately leaves alone", () => {
    const census = inputsInRepo();
    const counts = {};
    for (const input of census) counts[input.type] = (counts[input.type] ?? 0) + 1;
    expect(counts).toEqual({ radio: 8, range: 6, file: 5, checkbox: 1 });
  });

  /**
   * And the four fields the last two steps converted are GONE from the census,
   * which is the strongest form of „fixed" this rule has to offer: it reads the
   * ELEMENT, so a field that became the primitive's stops existing for it.
   *
   * Two of those four were invisible to the census before this gate, and that
   * is the finding worth keeping. `noteFindBar.tsx`'s pair never carried the
   * shared class — a rule phrased as „no call site writes `nx-textfield__input`"
   * reported that file clean while `notes.css` said out loud that it was a hand
   * copy of the primitive, eight declarations of which five were the
   * primitive's own words character for character. A rule about what a thing IS
   * found it on the day it was written; a rule about what it is CALLED did not
   * find it in four months.
   *
   * The fake-repo test above is what shows the gate would have caught them, so
   * this one is free to assert zero — and the two assertions are only
   * meaningful together.
   */
  it("no longer sees the four converted fields, because there is nothing to see", () => {
    const census = inputsInRepo();
    expect(census.filter((input) => input.file.endsWith("noteFindBar.tsx"))).toEqual([]);
    expect(census.filter((input) => input.file.endsWith("FinancePage.tsx"))).toEqual([]);
  });
});
