import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { renderNotices } from "../apps/desktop/scripts/render-notices.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The rendered notices are a RELEASE ARTEFACT — the file a redistributor is
 * expected to carry — and until this suite existed nothing in the repository
 * rendered it, so nothing could notice it going wrong.
 *
 * The property worth testing is not "the text looks like a licence". It is that
 * the document is a faithful, deterministic projection of the generated data:
 * every entry present, nothing invented, the order stable, and the code fences
 * unable to end early inside a licence that contains backticks of its own.
 */
const FIXTURE = {
  packages: [
    {
      id: "npm:zeta@2.0.0",
      name: "zeta",
      version: "2.0.0",
      licence: "MIT",
      notice: "MIT text for zeta",
      status: "file",
      source: "LICENSE",
    },
    {
      id: "npm:alpha@1.0.0",
      name: "alpha",
      version: "1.0.0",
      licence: "Apache-2.0",
      notice: "Contains a fence:\n```\nnot really a fence\n```\nend",
      status: "declared-only",
    },
  ],
  fonts: [
    {
      id: "font:Beta",
      name: "Beta",
      version: "Version 1.0",
      licence: "OFL-1.1",
      notice: "OFL text",
      status: "file",
      source: "Beta-Regular.woff2 name table",
    },
  ],
};

const scratch = mkdtempSync(join(tmpdir(), "nexus-render-notices-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("renderNotices", () => {
  it("is deterministic", () => {
    expect(renderNotices(FIXTURE)).toBe(renderNotices(FIXTURE));
  });

  it("sorts by name, so a regeneration cannot reorder the document", () => {
    const rendered = renderNotices(FIXTURE);
    expect(rendered.indexOf("alpha")).toBeLessThan(rendered.indexOf("zeta"));
  });

  it("carries every entry and the counts, and invents nothing", () => {
    const rendered = renderNotices(FIXTURE);
    expect(rendered).toContain("**2 packages**");
    expect(rendered).toContain("**1 font families**");
    for (const name of ["alpha", "zeta", "Beta"]) {
      expect(rendered).toContain(name);
    }
    // The notices themselves travel verbatim.
    expect(rendered).toContain("MIT text for zeta");
    expect(rendered).toContain("OFL text");
  });

  it("explains a declared-only notice rather than implying the text was read", () => {
    const rendered = renderNotices(FIXTURE);
    expect(rendered).toContain("ships no copy of the text");
  });

  it("uses a fence longer than any run of backticks inside the notice", () => {
    const rendered = renderNotices(FIXTURE);
    // `alpha`'s notice contains a three-backtick run of its own, so a
    // three-backtick fence would close in the middle of the licence text and
    // the rest of the document would render as prose.
    const alpha = rendered.slice(rendered.indexOf("### alpha"));
    const opener = alpha.split("\n").find((line) => line.startsWith("`"));
    expect(opener).toBe("````text");
  });

  it("writes the document where it is told to", () => {
    const dataFile = join(scratch, "licences.json");
    writeFileSync(dataFile, JSON.stringify(FIXTURE));
    const out = join(scratch, "out.md");
    // The CLI reads the repository's own data file, so this asserts the
    // argument handling and the exit code rather than the content.
    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, "apps", "desktop", "scripts", "render-notices.mjs"), out],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("render-notices: wrote");
    expect(readFileSync(out, "utf8").length).toBeGreaterThan(1000);
  });
});
