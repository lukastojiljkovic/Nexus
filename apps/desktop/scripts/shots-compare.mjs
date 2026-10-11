// `node apps/desktop/scripts/shots-compare.mjs <old dir> <new dir>` — the answer
// to „did this change anything I can see", for two sweeps of the app.
//
// THIS SCRIPT IS THE ARGUMENT PARSER AND NOTHING ELSE. The comparison itself,
// the report and the diff images are `src/main/shots/compare.mts`, typed
// TypeScript with its own suite, and this file reaches it by importing the
// SOURCE rather than a build: a comparison is a read of two directories, and
// making it wait for `electron-vite build` — or for an Electron launch, which is
// what the `shots` verb needs — would be a comparison tool that costs six
// minutes before it can say „identical".
//
// The `.mts` extension is load-bearing rather than decorative. Node 24 (the
// repo's floor) strips types from a TypeScript file on the way in, so nothing
// has to be built first — but `apps/desktop/package.json` cannot declare
// `type: module` (the Electron build writes CommonJS into `out/`), and Node
// therefore reparses a `.ts` module and prints a MODULE_TYPELESS_PACKAGE_JSON
// warning on every run. `.mts` is TypeScript's own way of saying „this file is
// ESM": no package.json change, and nothing printed.
//
// It deliberately does NOT take the harness lock (`run-lock.mjs`): that lock
// exists because a run wipes the sandbox and writes `out/`, and this command
// only reads two folders a sweep already wrote and writes its own report into
// one of them.

const USAGE = `usage: node apps/desktop/scripts/shots-compare.mjs <old dir> <new dir> [options]

  --fail-on-change        exit 1 when any frame is \`changed\` (noise and
                          size changes never fail the run)
  --noise-pixels=<n>      most differing pixels that still reads as noise
                          (default 100)
  --noise-channel=<n>     largest channel difference, of 255, that still reads
                          as noise (default 32)`;

/** The two positional arguments, or null once a flag has been refused. */
function parse(argv) {
  const dirs = [];
  const options = { failOnChange: false, noisePixels: 100, noiseChannel: 32 };
  for (const arg of argv) {
    if (arg === "--fail-on-change") {
      options.failOnChange = true;
      continue;
    }
    const counted = /^--(noise-pixels|noise-channel)=(\d+)$/.exec(arg);
    if (counted !== null) {
      const value = Number(counted[2]);
      if (counted[1] === "noise-pixels") options.noisePixels = value;
      else options.noiseChannel = value;
      continue;
    }
    if (arg.startsWith("--")) return null;
    dirs.push(arg);
  }
  return dirs.length === 2 ? { oldDir: dirs[0], newDir: dirs[1], options } : null;
}

const parsed = parse(process.argv.slice(2));
if (parsed === null) {
  process.stderr.write(`${USAGE}\n`);
  process.exitCode = 2;
} else {
  // `process.exit` rather than `exitCode` at the end of this would truncate the
  // report whenever it is longer than the pipe buffer the caller gave us — and
  // a report is exactly the kind of output somebody pipes into a file.
  const { runCompare } = await import("../src/main/shots/compare.mts");
  try {
    const { report, exitCode } = runCompare(parsed.oldDir, parsed.newDir, {
      noise: { pixels: parsed.options.noisePixels, channel: parsed.options.noiseChannel },
      failOnChange: parsed.options.failOnChange,
    });
    process.stdout.write(report);
    process.exitCode = exitCode;
  } catch (error) {
    process.stderr.write(
      `shots-compare: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
