#!/usr/bin/env node
/**
 * Renders the third-party notices into one document, from the generated
 * `licences.json` and from nothing else.
 *
 * **Why this is a renderer and not a document.** `generate-licences.mjs`
 * reads every notice off disk, and the app shows them under Podešavanja →
 * Licence. A release, however, also has to hand a stranger a single file that
 * satisfies the notice obligation outside the application — and a
 * hand-maintained one would rot at the next dependency bump, silently, because
 * a notices file that has stopped describing the tree looks exactly like one
 * that has not. So nothing here is typed by hand: this reads what the
 * generator wrote, sorts it, and prints it.
 *
 * **The fence length is load-bearing.** A licence text can itself contain a
 * run of backticks, and a three-backtick fence around such a text ends in the
 * middle of it — producing a document that renders as nonsense while looking
 * correct in a diff. The fence is computed from the content instead.
 *
 * Usage: `node apps/desktop/scripts/render-notices.mjs [outfile]`
 * Default outfile: `THIRD-PARTY-NOTICES.md` at the repository root.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the generator writes its output. */
export const DEFAULT_DATA_FILE = join(
  HERE,
  "..",
  "src",
  "renderer",
  "src",
  "data",
  "licences.json",
);

/** Where a release wants the rendered document. */
export const DEFAULT_OUT_FILE = join(HERE, "..", "..", "..", "THIRD-PARTY-NOTICES.md");

/** The path named in the rendered header, relative to the repository root. */
export const DATA_FILE_LABEL = "apps/desktop/src/renderer/src/data/licences.json";

/**
 * The meaning of `status`, which is the honest half of the generated data and
 * has to travel with it: a reader has to be able to tell a notice that was READ
 * from one that was DECLARED from one that could not be established at all.
 */
const STATUS_MEANING = {
  file: "Read from the licence file the package ships.",
  "declared-only":
    "The package's own manifest declares this licence and ships no copy of the text; the identifier is reproduced and the text is not invented.",
  unknown:
    "No file establishes the licence; the text below is what the package ships, and it is listed as unknown rather than assumed.",
};

/** A fence longer than any run of backticks inside `text`. */
function fenceFor(text) {
  let longest = 0;
  let run = 0;
  for (const character of text) {
    run = character === "`" ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return "`".repeat(Math.max(3, longest + 1));
}

const byNameThenVersion = (a, b) =>
  a.name.localeCompare(b.name) || String(a.version).localeCompare(String(b.version));

/**
 * The whole document, as a string. Pure: same input, same bytes, no clock and
 * no working directory, which is what lets the release workflow diff it and
 * lets the test below assert on it.
 */
export function renderNotices(data) {
  const packages = [...data.packages].sort(byNameThenVersion);
  const fonts = [...data.fonts].sort(byNameThenVersion);

  const lines = [
    "# Third-party notices",
    "",
    "Nexus is distributed under the Apache License 2.0 (see `LICENSE`), and it",
    "ships other people's software inside its installers: React, TipTap, Excalidraw,",
    "Mermaid, KaTeX, `better-sqlite3-multiple-ciphers`, the Electron runtime and",
    "more, plus the font files the canvas editor copies into the build.",
    "",
    "**This document is generated, never written by hand.** It is rendered from",
    `\`${DATA_FILE_LABEL}\`, which in turn is produced by`,
    "`apps/desktop/scripts/generate-licences.mjs` reading every notice off disk —",
    "from each package's own licence file, and for fonts from the OpenType name",
    "table inside the shipped `.woff2` binaries. A notice that was typed by hand can",
    "be subtly wrong, and a wrong notice is worse than a missing one because it",
    "looks paid.",
    "",
    "It covers the production dependency tree of the packaged desktop application:",
    `**${packages.length} packages** and **${fonts.length} font families**.`,
    "Build and test tooling is excluded, because it never reaches a user. Electron",
    "is a development dependency but ships inside the installer, so it is included;",
    "`@types/*` are erased by the compiler and the workspace's own packages are ours,",
    "so both are excluded.",
    "",
    "The same notices are shown inside the application, under **Podešavanja →",
    "Licence**. Electron places its own `LICENSES.chromium.html` beside the",
    "executable.",
    "",
  ];

  if (fonts.length > 0) {
    lines.push("## Font families", "", "| Family | Version | Licence | Notice |", "| --- | --- | --- | --- |");
    for (const font of fonts) {
      lines.push(
        `| ${font.name} | ${font.version ?? ""} | ${font.licence ?? "UNKNOWN"} | ${STATUS_MEANING[font.status] ?? font.status} |`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Packages",
    "",
    "| Package | Version | Licence | How the notice was established |",
    "| --- | --- | --- | --- |",
  );
  for (const entry of packages) {
    lines.push(
      `| ${entry.name} | ${entry.version} | ${entry.licence ?? "UNKNOWN"} | ${STATUS_MEANING[entry.status] ?? entry.status} |`,
    );
  }
  lines.push("", "## Notices", "");

  for (const entry of [...fonts, ...packages]) {
    const fence = fenceFor(entry.notice ?? "");
    lines.push(
      `### ${entry.name}${entry.version ? ` ${entry.version}` : ""}`,
      "",
      `Licence: **${entry.licence ?? "UNKNOWN"}** · ${STATUS_MEANING[entry.status] ?? entry.status}${
        entry.source ? ` · read from \`${entry.source}\`` : ""
      }`,
      "",
      `${fence}text`,
      entry.notice ?? "",
      fence,
      "",
    );
  }

  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

function main(argv) {
  const outFile = argv[0] ? resolve(argv[0]) : DEFAULT_OUT_FILE;
  const data = JSON.parse(readFileSync(DEFAULT_DATA_FILE, "utf8"));
  const rendered = renderNotices(data);
  writeFileSync(outFile, rendered);
  const counts = `${data.packages.length} packages, ${data.fonts.length} font families`;
  console.log(`render-notices: wrote ${outFile} (${counts}, ${rendered.length} bytes)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
