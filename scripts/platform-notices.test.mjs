import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { productionEntries } from "../apps/desktop/scripts/package-notice.mjs";
import { platformNoticeEntries } from "../apps/desktop/scripts/platform-notices.mjs";
import { renderNotices } from "../apps/desktop/scripts/render-notices.mjs";

/**
 * The packaging step's half of the notices (`platform-notices.mjs`).
 *
 * WHY IT IS TESTED AT ALL, and why the fixture is a real directory tree rather
 * than a mock: the property that matters is „the text the installer ships is the
 * text on the disk of the package it ships", and every way of getting that wrong
 * — reading the wrong file, inventing a licence id, listing a package the tree
 * does not hold, or listing one twice — is invisible to `tsc`, to lint and to a
 * build. A build, in particular, can only be observed by a person installing the
 * result, which is why the two halves are pure functions over a directory list.
 *
 * The generator's half (`productionEntries(…, "skip")`) is asserted beside it in
 * the same fixture, because the two are one rule seen from two sides: everything
 * a user could be given, split into „both machines have it" and „only this one
 * does", with nothing in both and nothing in neither.
 */

const scratchRoot = mkdtempSync(join(tmpdir(), "nexus-platform-notices-"));
afterAll(() => rmSync(scratchRoot, { recursive: true, force: true }));

/** One package on disk: a manifest, and a licence file when the case has one. */
function packageAt(name, { os, cpu, licence, licenceText }) {
  const dir = join(scratchRoot, name.replace("/", "+"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, version: "9.9.9", ...(os === undefined ? {} : { os }), ...(cpu === undefined ? {} : { cpu }), ...(licence === undefined ? {} : { license: licence }) }, null, 2),
  );
  if (licenceText !== undefined) writeFileSync(join(dir, "LICENSE"), licenceText);
  return dir;
}

/** pnpm's `licenses list --json` shape: declared licence → packages → paths. */
function licencesFixture() {
  const crossPlatform = packageAt("everywhere", { os: ["win32", "linux", "darwin"], cpu: ["x64"], licence: "MIT", licenceText: "MIT text for everywhere" });
  const sharpWin = packageAt("@img/sharp-win32-x64", { os: ["win32"], cpu: ["x64"], licence: "Apache-2.0 AND LGPL-3.0-or-later", licenceText: "libvips notice, verbatim" });
  const llamaWin = packageAt("@node-llama-cpp/win-x64", { os: ["win32"], cpu: ["x64"], licence: "MIT" });
  const types = packageAt("@types/node", { licence: "MIT", licenceText: "MIT text for @types/node" });
  const ours = packageAt("@nexus/core", { licence: "Apache-2.0", licenceText: "ours" });
  return {
    "MIT": [
      { name: "everywhere", paths: [crossPlatform] },
      { name: "@node-llama-cpp/win-x64", paths: [llamaWin] },
      { name: "@types/node", paths: [types] },
    ],
    "Apache-2.0 AND LGPL-3.0-or-later": [{ name: "@img/sharp-win32-x64", paths: [sharpWin] }],
    "Apache-2.0": [{ name: "@nexus/core", paths: [ours] }],
  };
}

describe("platformNoticeEntries", () => {
  it("returns exactly the platform builds the tree holds, in id order", () => {
    const entries = platformNoticeEntries(licencesFixture());
    expect(entries.map((entry) => entry.id)).toEqual([
      "npm:@img/sharp-win32-x64@9.9.9",
      "npm:@node-llama-cpp/win-x64@9.9.9",
    ]);
  });

  it("reads each notice off that package's own file, and reproduces the declared id when there is none", () => {
    const entries = platformNoticeEntries(licencesFixture());
    const sharp = entries.find((entry) => entry.name === "@img/sharp-win32-x64");
    expect(sharp).toMatchObject({
      version: "9.9.9",
      licence: "Apache-2.0 AND LGPL-3.0-or-later",
      notice: "libvips notice, verbatim",
      status: "file",
      source: "LICENSE",
    });
    // No licence file on disk: the id is reproduced and the text is NOT
    // invented — the same `declared-only` gap the committed file carries.
    const llama = entries.find((entry) => entry.name === "@node-llama-cpp/win-x64");
    expect(llama).toMatchObject({ licence: "MIT", notice: "", status: "declared-only" });
    expect(llama.source).toContain('"license": "MIT"');
  });

  it("leaves out the packages that are in both trees, and our own", () => {
    const ids = platformNoticeEntries(licencesFixture()).map((entry) => entry.id);
    expect(ids).not.toContain("npm:everywhere@9.9.9");
    expect(ids.some((id) => id.startsWith("npm:@types/"))).toBe(false);
    expect(ids.some((id) => id.startsWith("npm:@nexus/"))).toBe(false);
  });

  it("is the generator's other half: the two lists partition the production tree", () => {
    const licences = licencesFixture();
    const both = productionEntries(licences, { platformBuilds: "skip" }).map((entry) => entry.id);
    const only = platformNoticeEntries(licences).map((entry) => entry.id);
    expect(both).toEqual(["npm:everywhere@9.9.9"]);
    expect([...both, ...only].sort()).toEqual(["npm:@img/sharp-win32-x64@9.9.9", "npm:@node-llama-cpp/win-x64@9.9.9", "npm:everywhere@9.9.9"]);
  });

  it("lists a package once, however many peer-dependency paths pnpm reports", () => {
    const licences = licencesFixture();
    const sharpDir = licences["Apache-2.0 AND LGPL-3.0-or-later"][0].paths[0];
    licences["Apache-2.0 AND LGPL-3.0-or-later"].push({
      name: "@img/sharp-win32-x64",
      paths: [sharpDir],
    });
    expect(platformNoticeEntries(licences)).toHaveLength(2);
  });

  it("renders into one document with the committed entries, under one count", () => {
    const licences = licencesFixture();
    const committed = productionEntries(licences, { platformBuilds: "skip" });
    const document = renderNotices({
      packages: [...committed, ...platformNoticeEntries(licences)],
      fonts: [],
    });
    expect(document).toContain("**3 packages**");
    for (const text of ["MIT text for everywhere", "libvips notice, verbatim"]) {
      expect(document).toContain(text);
    }
  });
});
