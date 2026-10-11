// `dwg2dxf`, as far as `dwg.test.ts` needs it: the CLI shape the real tool
// documents (`dwg2dxf [-y] [-o outfile] DWGFILE`), an output file written where
// `-o` says, and one failure mode that exits non-zero without a drawing.
//
// The real command line is taken from the pack's own man page — `-y` overwrite,
// `-o` "only valid with one single DWGFILE" — and its DXF is not reproduced here:
// what the client is being tested for is the argv it sends, the file it reads
// back, and the caps around both, none of which depends on what a DXF contains.
// The bytes it writes DO depend on the input, so a test can prove the drawing it
// got back is the one this run produced.

import { readFileSync, writeFileSync } from "node:fs";

const argv: readonly string[] = process.argv.slice(2);
// Typed rather than inferred, because this file is TypeScript the app's own
// project checks: a fixture that only ran correctly by luck would be a fixture
// nothing keeps honest.
let output: string | null = null;
let input: string | null = null;

for (let index = 0; index < argv.length; index += 1) {
  const token = argv[index];
  if (token === "-o") {
    output = argv[index + 1] ?? null;
    index += 1;
  } else if (token !== undefined && token !== "-y") {
    input = token;
  }
}

if (input === null || output === null) {
  process.stderr.write("fake-dwg2dxf: expected -o <outfile> <infile>\n");
  process.exit(2);
}

let contents: Buffer;
try {
  contents = readFileSync(input);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(`fake-dwg2dxf: cannot read ${input}: ${reason}\n`);
  process.exit(2);
}

process.stdout.write(`Reading DWG file ${input}\n`);

if (contents.subarray(0, 6).toString("utf8") === "BROKEN") {
  // The real tool's failure shape: a diagnostic on stderr, a non-zero code, no
  // file. A client that trusted the exit code alone would hand on nothing.
  process.stderr.write("READ ERROR 0x1\n");
  process.exit(1);
}

// A minimal DXF whose ENTITIES comment carries the input's length, so the bytes
// that come back identify the run that produced them.
const dxf = `0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n999\nbytes ${contents.byteLength}\n0\nENDSEC\n0\nEOF\n`;
writeFileSync(output, dxf);
process.stdout.write(`Writing DXF file ${output}\n`);
