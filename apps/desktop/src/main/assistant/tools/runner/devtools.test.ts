import { describe, expect, it } from "vitest";
import { type Tool, type ToolContext, type ToolResult } from "@nexus/core";
import { contrastReport, formatColour, COLOUR_FORMATS, parseColour } from "@nexus/core/devtools/colour";
import { textToBase64 } from "@nexus/core/devtools/encoding";
import { convertData, formatIntegerInBase, parseIntegerInBase } from "@nexus/core/devtools/numbers";
import { convertCase, slugify } from "@nexus/core/devtools/text";
import {
  describeCidr,
  findHttpStatus,
  parseCidr,
  parseUuid,
} from "@nexus/core/devtools/system";
import { createModuleRegistry } from "../../../../shared/modules.js";
import { DEFAULT_SHELL_VISIBILITY, type ShellVisibility } from "../../../../shared/moduleVisibility.js";
import { drawerTools } from "../drawer.js";
import { TOOL_RUNNERS } from "./index.js";
import { DEVTOOLS_RUNNERS } from "./devtools.js";
import { quantity } from "./shared.js";

/** Each developer runner, run on fixed inputs, answers the lines its surface draws from the same core call. */
describe("the developer runners", () => {
  it("writes a number in another base, grouped and in capitals", () => {
    const lines = TOOL_RUNNERS.get("number-base")?.run({ value: "ff", from: 16, to: 2 }, "en");
    const digits = formatIntegerInBase(parseIntegerInBase("ff", 16) ?? 0n, 2, { uppercase: true, group: true });
    expect(lines).toEqual([`Base 2: ${digits}`]);
    expect(TOOL_RUNNERS.get("number-base")?.run({ value: "zz", from: 16, to: 2 }, "en")).toBeNull();
  });

  it("converts a data unit the way the data-unit tool does", () => {
    const lines = TOOL_RUNNERS.get("data-unit")?.run({ value: 1, from: "mb-dec", to: "kb-dec" }, "en");
    const result = convertData(1, "mb-dec", "kb-dec");
    expect(result).not.toBeNull();
    expect(lines).toEqual([`Result: ${quantity("en", result ?? 0)} kB`]);
  });

  it("reads an HTTP status from the same table the status tool searches", () => {
    const status = findHttpStatus(404);
    expect(status).toBeDefined();
    expect(TOOL_RUNNERS.get("http-status")?.run({ code: 404 }, "en")).toEqual([
      `Status: 404 ${status?.name ?? ""}`,
      `Note: ${status?.noteEn ?? ""}`,
      `Reference: ${status?.reference ?? ""}`,
    ]);
    expect(TOOL_RUNNERS.get("http-status")?.run({ code: 299 }, "en")).toBeNull();
  });

  it("describes a CIDR block with the report the CIDR tool draws", () => {
    const input = parseCidr("10.0.0.0/30");
    if (input === null) throw new Error("Test setup: the CIDR block did not parse.");
    const report = describeCidr(input);
    const lines = TOOL_RUNNERS.get("cidr")?.run({ block: "10.0.0.0/30" }, "en");
    expect(lines).toEqual([
      `Network: ${report.network}/30`,
      `Netmask: ${report.netmask}`,
      `Broadcast: ${report.broadcast ?? ""}`,
      `First host: ${report.firstHost}`,
      `Last host: ${report.lastHost}`,
      `Usable addresses: ${report.usable.toString()}`,
    ]);
    expect(TOOL_RUNNERS.get("cidr")?.run({ block: "10.0.0.0/33" }, "en")).toBeNull();
  });

  it("writes a version in its canonical form and tests it against a range", () => {
    const run = TOOL_RUNNERS.get("semver")?.run;
    expect(run?.({ version: "v1.4.2-rc.1" }, "en")).toEqual(["Version: 1.4.2-rc.1"]);
    expect(run?.({ version: "1.4.2", range: ">=1.2 <2" }, "en")).toEqual(["Version: 1.4.2", "In range: yes"]);
    expect(run?.({ version: "2.0.0", range: ">=1.2 <2" }, "sr")).toEqual(["Verzija: 2.0.0", "U opsegu: ne"]);
    expect(run?.({ version: "not-a-version" }, "en")).toBeNull();
  });

  it("reads a UUID's variant, version and timestamp", () => {
    const value = "0192f0f0-0000-7000-8000-000000000000";
    const parsed = parseUuid(value);
    expect(parsed).not.toBeNull();
    expect(TOOL_RUNNERS.get("uuid")?.run({ value }, "en")).toEqual([
      `Canonical: ${value}`,
      `Variant: ${parsed?.variant ?? ""}`,
      "Version: 7",
      `Timestamp: ${new Date(parsed?.timestampMs ?? 0).toISOString()}`,
    ]);
  });

  it("encodes and decodes Base64, and refuses a decode it cannot read", () => {
    const run = TOOL_RUNNERS.get("base64")?.run;
    expect(run?.({ direction: "encode", text: "Nexus" }, "en")).toEqual([`Result: ${textToBase64("Nexus")}`]);
    expect(run?.({ direction: "decode", text: textToBase64("Nexus") }, "en")).toEqual(["Result: Nexus"]);
    expect(run?.({ direction: "decode", text: "!!!" }, "en")).toBeNull();
  });

  it("cuts a long output after 200 code points, with an ellipsis", () => {
    const long = "a".repeat(300);
    const lines = TOOL_RUNNERS.get("base64")?.run({ direction: "encode", text: long }, "en");
    const encoded = textToBase64(long);
    expect(lines).toEqual([`Result: ${encoded.slice(0, 200)}…`]);
  });

  it("escapes and unescapes HTML the way the HTML tool does", () => {
    const run = TOOL_RUNNERS.get("html-entities")?.run;
    expect(run?.({ direction: "escape", text: "<a href=\"x\">" }, "en")).toEqual([
      "Result: &lt;a href=&quot;x&quot;&gt;",
    ]);
    expect(run?.({ direction: "unescape", text: "&lt;b&gt;" }, "en")).toEqual(["Result: <b>"]);
  });

  it("converts a percent-encoded value the way the URL tool does", () => {
    const run = TOOL_RUNNERS.get("url-encode")?.run;
    expect(run?.({ direction: "encode", text: "a b&c", escaping: "component" }, "en")).toEqual(["Result: a%20b%26c"]);
    expect(run?.({ direction: "decode", text: "%zz", escaping: "component" }, "en")).toBeNull();
  });

  it("converts identifier case and slugs text", () => {
    expect(TOOL_RUNNERS.get("case-convert")?.run({ text: "hello world", format: "snake" }, "en")).toEqual([
      `Result: ${convertCase("hello world", "snake")}`,
    ]);
    expect(TOOL_RUNNERS.get("slug")?.run({ text: "Zdravo, svete!" }, "en")).toEqual([
      `Result: ${slugify("Zdravo, svete!")}`,
    ]);
  });

  it("writes a colour in every format the colour tool lists", () => {
    const colour = parseColour("red");
    if (colour === null) throw new Error("Test setup: the colour did not parse.");
    expect(TOOL_RUNNERS.get("color-convert")?.run({ colour: "red" }, "en")).toEqual(
      COLOUR_FORMATS.map((format) => `${format}: ${formatColour(colour, format)}`),
    );
    expect(TOOL_RUNNERS.get("color-convert")?.run({ colour: "not a colour" }, "en")).toBeNull();
  });

  it("reports a contrast ratio and the WCAG levels the contrast tool does", () => {
    const black = parseColour("black");
    const white = parseColour("white");
    const report = black !== null && white !== null ? contrastReport(black, white) : null;
    expect(report).not.toBeNull();
    expect(TOOL_RUNNERS.get("contrast")?.run({ text: "black", background: "white" }, "en")).toEqual([
      `Contrast ratio: ${quantity("en", report?.ratio ?? 0)}`,
      "AA, body text: yes",
      "AA, large text: yes",
      "AAA, body text: yes",
      "AAA, large text: yes",
      "AA, non-text: yes",
    ]);
  });

  it("prefills no developer tool, since no developer surface reads the prefill context", () => {
    expect(Object.values(DEVTOOLS_RUNNERS).some((runner) => runner.prefills === true)).toBe(false);
  });
});

describe("drawer.run for a developer tool", () => {
  const PROFILE_ID = "0192f0f0-0000-7000-8000-000000000000";

  /** The professional drawer's module is off by default; the developer tools live there. */
  const SHOW_PRO: ShellVisibility = { ...DEFAULT_SHELL_VISIBILITY, shown: ["pro"] };

  it("answers the slug tool's figure through the registry, with no risk notice", async () => {
    const tools = drawerTools({ modules: createModuleRegistry(), visibility: () => SHOW_PRO });
    const run = tools.find((tool: Tool) => tool.name === "drawer.run");
    if (run === undefined) throw new Error("Test setup: no drawer.run.");
    const context: ToolContext = {
      profileId: PROFILE_ID,
      locale: "en",
      signal: new AbortController().signal,
      confirm: () => Promise.resolve(true),
    };
    const result: ToolResult = await run.run({ tool: "slug", values: { text: "Zdravo, svete!" } }, context);
    expect(result).toEqual({
      ok: true,
      content: `Result of “slug”:\nResult: ${slugify("Zdravo, svete!")}`,
    });
  });
});
