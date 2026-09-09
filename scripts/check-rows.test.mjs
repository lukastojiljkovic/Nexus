import { describe, expect, it } from "vitest";

import {
  ALIGNED,
  elementsWithChildren,
  isBare,
  isFlexRow,
  isStacked,
  layoutByClass,
  mixedRowClasses,
  repoMixedRows,
  scanRepo,
  verdict,
} from "./check-rows.mjs";

/**
 * `check:rows` makes „a field row aligns its controls" structural.
 *
 * The class it enforces only becomes VISIBLE when a field gains a label, which
 * is why four rows shipped centred and nobody saw it: while every child was one
 * box tall, `align-items: center` and `align-items: end` drew the same picture.
 * DC-120's labels made the heights differ, and the same four rows went ragged
 * on the same afternoon.
 *
 * This suite's job is to show the gate goes RED on that shape, and — just as
 * important — that it stays quiet on the fifty-odd toolbars and chip rows where
 * `center` is right. A rule that fired on those would be turned off in a week.
 */

describe("what makes a child tall", () => {
  it("counts a labelled field as stacked and a bare one as not", () => {
    expect(isStacked({ name: "TextField", text: '<TextField label="Rok" />' })).toBe(true);
    expect(isStacked({ name: "TextField", text: "<TextField value={v} />" })).toBe(false);
    expect(isBare({ name: "TextField", text: "<TextField value={v} />" })).toBe(true);
  });

  /**
   * THE TRAP, and the reason it is a test rather than a comment: `\b` sits
   * between `-` and `l`, so `/\blabel=/` matches `aria-label=`. A first pass at
   * this rule used exactly that and counted every invisibly-named field as a
   * labelled one — five findings that were not findings, in a gate whose whole
   * subject is telling those two apart.
   */
  it("does not mistake an aria-label for a label", () => {
    const field = { name: "TextField", text: '<TextField aria-label="Rok" value={v} />' };
    expect(isStacked(field)).toBe(false);
    expect(isBare(field)).toBe(true);
  });

  it("reads the inline layout as one box, in both components", () => {
    expect(isStacked({ name: "Select", text: '<Select layout="inline" label="Od" />' })).toBe(false);
    expect(isBare({ name: "Select", text: '<Select layout="inline" label="Od" />' })).toBe(true);
    expect(
      isStacked({ name: "TextField", text: '<TextField layout="inline" label="Od" />' }),
    ).toBe(false);
  });

  /** A `Select` named by text elsewhere renders no label of its own. */
  it("counts an aria-labelledby select as one box", () => {
    const named = { name: "Select", text: "<Select aria-labelledby={id} value={v} />" };
    expect(isStacked(named)).toBe(false);
    expect(isBare(named)).toBe(true);
  });

  it("says nothing about a component whose shape it cannot read", () => {
    const other = { name: "RecurrencePicker", text: "<RecurrencePicker value={r} />" };
    expect(isStacked(other)).toBe(false);
    expect(isBare(other)).toBe(false);
  });
});

describe("elementsWithChildren", () => {
  it("attributes only DIRECT children", () => {
    const source = `
      <div className="row">
        <span><TextField label="A" /></span>
        <Button>Go</Button>
      </div>`;
    const row = elementsWithChildren(source).find((e) => e.text.includes('className="row"'));
    expect(row?.children.map((c) => c.name)).toEqual(["span", "Button"]);
  });

  /**
   * Fragments render nothing, so their children ARE the row's flex items. CAL's
   * two `type="time"` fields live inside `{!allDay && (<>…</>)}` and are laid
   * out by `.cal__form`; a walk that treated the fragment as an element would
   * have found that row unmixed and passed it.
   */
  it("sees through a fragment", () => {
    const source = `
      <div className="row">
        <TextField label="A" />
        <>
          <Button>Go</Button>
        </>
      </div>`;
    const row = elementsWithChildren(source).find((e) => e.text.includes('className="row"'));
    expect(row?.children.map((c) => c.name)).toEqual(["TextField", "Button"]);
  });

  it("is not fooled by a `>` inside a handler", () => {
    const source = `
      <div className="row">
        <TextField label="A" onChange={(e) => set(e.target.value)} className="late" />
        <Button>Go</Button>
      </div>`;
    const row = elementsWithChildren(source).find((e) => e.text.includes('className="row"'));
    expect(row?.children.map((c) => c.name)).toEqual(["TextField", "Button"]);
  });
});

describe("mixedRowClasses", () => {
  it("finds a row that mixes a labelled field with a button", () => {
    const source = `
      <form className="x__form wide">
        <TextField label="Datum" type="date" />
        <Button type="submit">Dodaj</Button>
      </form>`;
    expect([...mixedRowClasses(source).keys()]).toEqual(["x__form", "wide"]);
  });

  it("says nothing when every child is the same shape", () => {
    const allStacked = `
      <form className="x__form">
        <TextField label="Od" />
        <Select label="Do"><option /></Select>
      </form>`;
    const allBare = `
      <form className="y__form">
        <input value={v} />
        <Button>Go</Button>
      </form>`;
    expect([...mixedRowClasses(allStacked).keys()]).toEqual([]);
    expect([...mixedRowClasses(allBare).keys()]).toEqual([]);
  });

  /** The four rows that shipped centred looked exactly like this beforehand. */
  it("says nothing about the row BEFORE the labels arrive", () => {
    const before = `
      <form className="cal__form">
        <input className="cal__title" aria-label="Naziv" />
        <TextField type="date" aria-label="Datum" />
      </form>`;
    expect([...mixedRowClasses(before).keys()]).toEqual([]);
  });

  it("is not set off by prose about a field row", () => {
    const source = `
      {/* <div className="fake"><TextField label="A" /><Button>Go</Button></div> */}
      <div className="real"><Button>Go</Button></div>`;
    expect([...mixedRowClasses(source).keys()]).toEqual([]);
  });
});

describe("layoutByClass", () => {
  it("reads display, direction and alignment", () => {
    const css = ".a {\n  display: flex;\n  flex-direction: column;\n  align-items: end;\n}";
    expect(layoutByClass(css).get("a")).toEqual({
      line: 1,
      display: "flex",
      direction: "column",
      align: "end",
    });
  });

  it("gives every class in a selector list the same block", () => {
    const css = ".a,\n.b {\n  display: flex;\n  align-items: center;\n}";
    expect(layoutByClass(css).get("a")?.align).toBe("center");
    expect(layoutByClass(css).get("b")?.align).toBe("center");
  });

  /**
   * A combinator rule modifies somebody else's box. Reading it would attribute
   * `.tasks__fields > .recur { align-items: stretch }` to BOTH classes, and
   * `.recur` would then be reported for a rule that is not about it.
   */
  it("ignores a rule that reaches into another container", () => {
    const css = ".a > .b {\n  display: flex;\n  align-items: center;\n}";
    expect(layoutByClass(css).has("b")).toBe(false);
    expect(layoutByClass(css).has("a")).toBe(false);
  });
});

describe("verdict", () => {
  const row = (align) => ({ line: 1, display: "flex", direction: null, align });

  it("refuses a centred mixed row", () => {
    expect(verdict(row("center"))?.align).toBe("center");
  });

  it("refuses a row that declares no alignment, because the default is stretch", () => {
    expect(verdict(row(null))?.align).toBe("not declared (so: stretch)");
  });

  /** Identical computed values; taking only one would be a preference, not a rule. */
  it("accepts both spellings of the bottom alignment", () => {
    for (const value of ALIGNED) expect(verdict(row(value))).toBeNull();
    expect([...ALIGNED].sort()).toEqual(["end", "flex-end"]);
  });

  it("says nothing about a column, where align-items is the other axis", () => {
    expect(isFlexRow({ display: "flex", direction: "column", align: null })).toBe(false);
    expect(verdict({ line: 1, display: "flex", direction: "column", align: null })).toBeNull();
  });

  it("says nothing about a container that is not flex at all", () => {
    expect(verdict({ line: 1, display: "grid", direction: null, align: "center" })).toBeNull();
    expect(verdict({ line: 1, display: null, direction: null, align: "center" })).toBeNull();
  });
});

describe("the live tree", () => {
  it("has no mixed field row that fails to align its controls", () => {
    expect(scanRepo()).toEqual([]);
  });

  /**
   * THE TEST THAT WOULD HAVE CAUGHT THE LEXER. `scanRepo()` returning `[]` is
   * the correct answer AND the answer a broken walk gives, so the suite has to
   * ask the other question too: are the rows this gate exists for still being
   * SEEN? While `jsx-elements.mjs` read a type argument as an unclosed element,
   * the census was empty and every assertion above still passed.
   */
  it("still sees the four rows it was written for, so green is not silence", () => {
    const seen = [...repoMixedRows().keys()];
    for (const cls of ["cal__form", "documents__form", "study__exam-form", "study__plan-form"]) {
      expect(seen).toContain(cls);
    }
  });

  it("still finds the rows it is about, so green means checked", () => {
    const source = `
      <form className="cal__form">
        <TextField label="Datum" type="date" />
        <Checkbox checked={x} onChange={f}>Ceo dan</Checkbox>
      </form>`;
    expect(mixedRowClasses(source).has("cal__form")).toBe(true);
  });
});
