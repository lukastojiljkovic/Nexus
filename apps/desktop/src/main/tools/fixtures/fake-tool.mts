// A tool the tests start through `run.ts`, with a mode per behaviour under test.
//
// It is a plain Node program started as the ENTRY's argv (`node fake-tool.mts
// <mode>`), which is how the tests get a real process without compiling one: the
// pack folder they build holds a hard link to this machine's Node named
// `engine.exe`, so the entry really is an executable and the runner never learns
// that this fixture exists. The modes exist because the interesting half of the
// runner is what it does when a program MISBEHAVES, and each of these misbehaves
// in one way on purpose.
//
// `ok`       prints where it ran and what it was given, then exits 0.
// `spam`     writes far past the output cap and never notices.
// `hang`     keeps the event loop alive and never exits.
// `stubborn` ignores SIGTERM (POSIX) and hangs, so the SIGKILL fallback runs.
// `fail`     writes to stderr and exits non-zero.
// `touch`    writes a file into its working directory, proving where that is.

import { writeFileSync } from "node:fs";

// The mode is the first argument that is not a flag, so a pack's fixed `--fixed`
// (which the argv test asserts on) can sit in front of it.
const args = process.argv.slice(2);
const mode = args.find((argument) => !argument.startsWith("-")) ?? "ok";

switch (mode) {
  case "ok": {
    process.stdout.write(`cwd: ${process.cwd()}\n`);
    process.stdout.write(`env: ${Object.keys(process.env).sort().join(",")}\n`);
    process.stdout.write(`argv: ${args.join(" ")}\n`);
    process.stdout.write(`secret: ${process.env.NEXUS_TOOL_TEST_SECRET ?? "absent"}\n`);
    process.exitCode = 0;
    break;
  }
  case "spam": {
    const line = `${"x".repeat(1023)}\n`;
    for (let index = 0; index < 256; index += 1) process.stdout.write(line);
    break;
  }
  case "hang": {
    process.stdout.write("ready\n");
    setInterval(() => undefined, 1000);
    break;
  }
  case "stubborn": {
    process.on("SIGTERM", () => undefined);
    process.stdout.write("ready\n");
    setInterval(() => undefined, 1000);
    break;
  }
  case "fail": {
    process.stderr.write("this tool failed on purpose\n");
    process.exitCode = 3;
    break;
  }
  case "touch": {
    writeFileSync("touched.txt", "the working directory is mine\n");
    process.stdout.write("touched\n");
    break;
  }
  default: {
    process.stderr.write(`unknown mode "${mode}"\n`);
    process.exitCode = 2;
  }
}
