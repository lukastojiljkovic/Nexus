import { describe, expect, it } from "vitest";

import { readSelection, writeSelection } from "./listDetailUrl.js";

/**
 * The fragment codec behind the list's selection, tested as a pair of
 * inverses: what `writeSelection` writes, `readSelection` reads back, and
 * neither touches a pair it does not own.
 */
describe("readSelection", () => {
  it("reads the value under the surface's own key", () => {
    expect(readSelection("#sel=n-1043", "sel")).toBe("n-1043");
    expect(readSelection("#view=cards&sel=n-1043", "sel")).toBe("n-1043");
  });

  it("percent-decodes both halves", () => {
    expect(readSelection("#m%20oji=a%20b", "m oji")).toBe("a b");
    expect(readSelection("#sel=a%2Bb%25c", "sel")).toBe("a+b%c");
  });

  it("answers null when the key is absent, empty, or has no value at all", () => {
    expect(readSelection("#view=cards", "sel")).toBeNull();
    expect(readSelection("", "sel")).toBeNull();
    // `#sel=` is what clearing the selection by hand leaves behind, and an
    // empty id is not a row.
    expect(readSelection("#sel=", "sel")).toBeNull();
    expect(readSelection("#sel", "sel")).toBeNull();
  });

  it("does not match a key that merely contains the one asked for", () => {
    // `#layout.sel=x` and `#layoutsel=x` are somebody else's keys: reading them
    // as `sel` would make two surfaces share one selection.
    expect(readSelection("#layout.sel=x", "sel")).toBeNull();
    expect(readSelection("#layoutsel=x", "sel")).toBeNull();
  });

  it("takes the first pair when a key was written twice", () => {
    expect(readSelection("#sel=first&sel=second", "sel")).toBe("first");
  });

  it("reads a fragment written without its hash", () => {
    expect(readSelection("sel=n-1", "sel")).toBe("n-1");
  });

  it("survives a stray percent rather than throwing the page away", () => {
    // `decodeURIComponent("100%")` throws, and a fragment is user-typeable
    // text — so a malformed pair is read verbatim and the rest still answers.
    expect(readSelection("#a=100%&sel=n-1", "sel")).toBe("n-1");
    expect(readSelection("#sel=100%", "sel")).toBe("100%");
  });
});

describe("writeSelection", () => {
  it("appends the surface's pair to the fragment that is already there", () => {
    expect(writeSelection("#view=cards", "sel", "n-1043")).toBe("#view=cards&sel=n-1043");
  });

  it("starts a fragment when the page has none", () => {
    expect(writeSelection("", "sel", "n-1043")).toBe("#sel=n-1043");
  });

  it("replaces in place, so the pair does not walk to the end of the fragment", () => {
    expect(writeSelection("#sel=old&view=cards", "sel", "new")).toBe("#sel=new&view=cards");
  });

  it("removes the pair when the selection is cleared", () => {
    expect(writeSelection("#view=cards&sel=n-1", "sel", null)).toBe("#view=cards");
    expect(writeSelection("#sel=n-1", "sel", null)).toBe("");
  });

  it("keeps a fragment it cannot read", () => {
    // `#/route` is not one of this module's pairs, and a codec that dropped it
    // would silently delete somebody else's state.
    expect(writeSelection("#/route", "sel", "a")).toBe("#/route&sel=a");
    expect(writeSelection("#a=1&&b=2", "sel", null)).toBe("#a=1&b=2");
  });

  it("escapes what it writes, so reading it back is the same string", () => {
    const id = "k&v = 100%";
    expect(writeSelection("#view=cards", "sel", id)).toBe("#view=cards&sel=k%26v%20%3D%20100%25");
    expect(readSelection(writeSelection("#view=cards", "sel", id), "sel")).toBe(id);
  });
});
