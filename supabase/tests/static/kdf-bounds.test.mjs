// The Argon2id bounds are written down twice — in `packages/sync-crypto/src/kdf.ts`
// and in the `key_wraps` CHECK constraints — and this file is why that is safe.
//
// The duplication is not laziness: SQL cannot import TypeScript, and both halves
// are load-bearing in different directions. `kdf.ts` refuses to DERIVE under
// parameters outside the range, because they arrive from a server this design
// treats as hostile. The constraints refuse to STORE them, because a wrap the
// client will not open is, for the two `mk_*` slots, a master key nobody can
// reach again.
//
// What makes duplicated numbers dangerous is that they drift silently and only
// one half moves. If the SQL floor were ever lowered below `kdf.ts`'s, the
// database would accept a wrap that no client derives; if `kdf.ts`'s ceiling
// rose above the SQL one, an honest client would produce a wrap the database
// rejects at the worst possible moment — enabling sync for the first time.
//
// Every extraction below asserts its own match count first. A regex that stops
// matching after a rename would otherwise turn this file into a test that passes
// by reading nothing, which is the failure it exists to prevent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../../", import.meta.url);
const read = (relative) => readFileSync(fileURLToPath(new URL(relative, root)), "utf8");

const KDF_TS = read("packages/sync-crypto/src/kdf.ts");
const FLOOR_SQL = read("supabase/migrations/20260808090000_sync_core_tables.sql");
const CEILING_SQL = read("supabase/migrations/20260809200000_kdf_params_ceiling.sql");

/** `64 * 1024` and `16` — the only arithmetic these constants are written with. */
function evaluateProduct(expression) {
  const factors = expression.split("*").map((part) => part.trim());
  assert.ok(
    factors.every((factor) => /^\d+$/.test(factor)),
    `constant "${expression}" is no longer a plain product of integers`,
  );
  return factors.reduce((product, factor) => product * Number(factor), 1);
}

function tsConstant(name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*([\\d\\s*]+);`).exec(KDF_TS);
  assert.ok(match?.[1], `kdf.ts no longer declares ${name}`);
  return evaluateProduct(match[1]);
}

function tsDefaultParam(name) {
  const block = /export const WEB_KDF_PARAMS[^=]*=\s*\{([^}]*)\}/.exec(KDF_TS);
  assert.ok(block?.[1], "kdf.ts no longer declares WEB_KDF_PARAMS as an object literal");
  const match = new RegExp(`${name}\\s*:\\s*([\\d\\s*]+),`).exec(block[1]);
  assert.ok(match?.[1], `WEB_KDF_PARAMS no longer carries ${name}`);
  return evaluateProduct(match[1]);
}

/** Every `(kdf_params ->> 'x')::numeric <op> n` in one migration, as a map. */
function sqlBounds(sql, operator) {
  const pattern = new RegExp(
    `\\(kdf_params ->> '(\\w+)'\\)::numeric\\s*${operator}\\s*(\\d+)`,
    "g",
  );
  const bounds = Object.fromEntries(
    [...sql.matchAll(pattern)].map((match) => [match[1], Number(match[2])]),
  );
  assert.deepEqual(
    Object.keys(bounds).sort(),
    ["iterations", "memoryKiB", "parallelism"],
    `expected exactly three '${operator}' bounds on kdf_params`,
  );
  return bounds;
}

test("the SQL floor is the same floor kdf.ts enforces", () => {
  const floor = sqlBounds(FLOOR_SQL, ">=");
  assert.equal(floor.memoryKiB, tsDefaultParam("memoryKiB"));
  assert.equal(floor.iterations, tsDefaultParam("iterations"));
  // `kdf.ts` has no named parallelism floor: `assertAcceptableParams` requires
  // every parameter to be a positive integer, which is this bound exactly.
  assert.equal(floor.parallelism, 1);
});

test("the SQL ceiling is the same ceiling kdf.ts enforces", () => {
  const ceiling = sqlBounds(CEILING_SQL, "<=");
  assert.equal(ceiling.memoryKiB, tsConstant("MAX_WEB_KDF_MEMORY_KIB"));
  assert.equal(ceiling.iterations, tsConstant("MAX_WEB_KDF_ITERATIONS"));
  assert.equal(ceiling.parallelism, tsConstant("MAX_WEB_KDF_PARALLELISM"));
});

test("every floor is below its ceiling", () => {
  const floor = sqlBounds(FLOOR_SQL, ">=");
  const ceiling = sqlBounds(CEILING_SQL, "<=");
  for (const key of ["memoryKiB", "iterations", "parallelism"]) {
    assert.ok(
      floor[key] <= ceiling[key],
      `${key}: floor ${floor[key]} is above ceiling ${ceiling[key]}, which admits no value at all`,
    );
  }
});

test("the ceiling constraint evaluates its type guards before its casts", () => {
  // `and`/`or` have no guaranteed evaluation order in Postgres and the planner
  // reorders them by cost, so „check the type, then cast" is only true if it is
  // written with `CASE`. Losing that is invisible until a malformed value raises
  // 22P02 from a cast the guard was supposed to divert.
  assert.match(CEILING_SQL, /case\s+when kdf_params is null then true/);
  assert.match(CEILING_SQL, /jsonb_typeof\(kdf_params -> 'memoryKiB'\)\s*is distinct from 'number'/);
});
