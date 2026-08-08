import { describe, expect, it } from "vitest";
import { applyProjectRef } from "../build/headers.js";

/**
 * The one value that differs between the committed `_headers` and the deployed
 * one, and therefore the one place a header can be forged.
 *
 * A `_headers` file is LINE-ORIENTED: an unindented line starts a new path
 * rule, an indented one is a header. So a project ref carrying a newline does
 * not corrupt the CSP, it appends whatever the attacker wants to the file —
 * which is why the validation here is an allowlist of host characters and why
 * these tests spend most of their length on the ways a value can be wrong.
 */

const HEADERS = [
  "/*",
  "  Content-Security-Policy: default-src 'none'; connect-src https://PROJECT.supabase.co wss://PROJECT.supabase.co",
  "  X-Frame-Options: DENY",
  "",
].join("\n");

describe("applyProjectRef", () => {
  it("replaces every occurrence, not just the first", () => {
    // Both the https and the wss origin name the same host. A `String.replace`
    // with a non-global pattern would substitute the fetch origin and leave the
    // realtime one pointing at a host that does not exist — so sync would work
    // and live updates would not, which is a bug that gets misdiagnosed for a
    // week.
    const out = applyProjectRef(HEADERS, "abcdefghijklmnopqrst");
    expect(out).toContain("https://abcdefghijklmnopqrst.supabase.co");
    expect(out).toContain("wss://abcdefghijklmnopqrst.supabase.co");
    expect(out).not.toContain("PROJECT.supabase.co");
  });

  it("touches nothing else in the file", () => {
    const out = applyProjectRef(HEADERS, "abcdefghijklmnopqrst");
    expect(out.split("\n")).toHaveLength(HEADERS.split("\n").length);
    expect(out).toContain("  X-Frame-Options: DENY");
    expect(out).toContain("default-src 'none'");
  });

  it("refuses a ref that would inject a header", () => {
    expect(() => applyProjectRef(HEADERS, "abc\n  X-Frame-Options: ALLOWALL")).toThrow(
      /not a Supabase project ref/,
    );
  });

  it("refuses a ref that would widen a directive", () => {
    // A space appends a SOURCE; a semicolon appends a whole DIRECTIVE. Both
    // read as an ordinary-looking value in an environment variable.
    expect(() => applyProjectRef(HEADERS, "abc *")).toThrow(/not a Supabase project ref/);
    expect(() => applyProjectRef(HEADERS, "abc; script-src *")).toThrow(
      /not a Supabase project ref/,
    );
  });

  it("refuses an empty ref and a ref that is punctuation", () => {
    expect(() => applyProjectRef(HEADERS, "")).toThrow(/not a Supabase project ref/);
    expect(() => applyProjectRef(HEADERS, "-abc")).toThrow(/not a Supabase project ref/);
    expect(() => applyProjectRef(HEADERS, "abc-")).toThrow(/not a Supabase project ref/);
    expect(() => applyProjectRef(HEADERS, "ABC")).toThrow(/not a Supabase project ref/);
  });

  it("refuses to succeed when there was nothing to substitute", () => {
    // The failure this prevents is the quiet one: a build that "worked" and
    // shipped a policy still naming a host called PROJECT. If the placeholder
    // is ever renamed, this is what says so — at build time, not at first
    // login.
    expect(() => applyProjectRef("/*\n  X-Frame-Options: DENY\n", "abcdefghijklmnopqrst")).toThrow(
      /no `PROJECT.supabase.co` placeholder/,
    );
  });
});
