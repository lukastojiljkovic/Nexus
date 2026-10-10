import { describe, expect, it } from "vitest";

import { allowsExternalUrl } from "./external.js";

/**
 * The external-link rule (ADR-103), as a table.
 *
 * The rule is the whole security story of the credits screen: `shell.openExternal`
 * hands the string to the operating system, so what may be handed over is a
 * decision rather than a check at the call site. `openExternalUrl` is one line
 * around this function and is not tested here (it needs Electron); everything
 * that decides anything is.
 */
describe("what may be opened in the user's browser", () => {
  it("allows a plain https address", () => {
    expect(allowsExternalUrl("https://creativecommons.org/licenses/by-sa/4.0/")).toBe(true);
    expect(allowsExternalUrl("https://www.kiwix.org/")).toBe(true);
    expect(allowsExternalUrl("https://example.org/a/b?c=d#e")).toBe(true);
  });

  it("refuses every scheme but https", () => {
    expect(allowsExternalUrl("http://example.org/")).toBe(false);
    expect(allowsExternalUrl("file:///C:/Windows/System32/calc.exe")).toBe(false);
    expect(allowsExternalUrl("javascript:alert(1)")).toBe(false);
    expect(allowsExternalUrl("ms-settings:privacy")).toBe(false);
    expect(allowsExternalUrl("\\\\server\\share\\setup.exe")).toBe(false);
    expect(allowsExternalUrl("C:\\Windows\\System32\\calc.exe")).toBe(false);
  });

  it("refuses an address that carries credentials, which is not the address it appears to be", () => {
    expect(allowsExternalUrl("https://user:secret@example.org/")).toBe(false);
    expect(allowsExternalUrl("https://user@example.org/")).toBe(false);
  });

  it("refuses an unparseable or empty address, and an over-long one", () => {
    expect(allowsExternalUrl("")).toBe(false);
    expect(allowsExternalUrl("not a url")).toBe(false);
    expect(allowsExternalUrl(`https://example.org/${"a".repeat(4096)}`)).toBe(false);
  });
});
