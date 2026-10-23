// No shebang: this module is imported for its side effect, never run.
//
// WHY THIS EXISTS. The game logic lives once, in `packages/core/src`, as
// TypeScript that imports its siblings with `.js` specifiers — the convention
// `tsc` and the bundler both expect. Node 24 strips the types from a `.ts` file
// but does not rewrite those specifiers, so a build script that wants the real
// solver has two bad options: copy the solver into the script, where it drifts,
// or build the whole package first. This hook is the third option. Importing it
// makes `import()` of a `.ts` file resolve the `.js` specifiers inside it, and
// the nonogram builder proves its puzzles with the same `solveNonogramLines` the
// game plays with.
//
// It registers once per process. A specifier is rewritten only when its parent
// is a `.ts` file and the `.ts` target exists, so a real `.js` file is untouched.

import { register } from "node:module";

const hook = `
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".js") && context.parentURL?.endsWith(".ts")) {
    const ts = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
    if (existsSync(fileURLToPath(ts))) return next(ts.href, context);
  }
  return next(specifier, context);
}
`;

register("data:text/javascript," + encodeURIComponent(hook));
