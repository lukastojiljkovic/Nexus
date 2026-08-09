// No shebang, for the same reason `scripts/check-tokens.mjs` at the repo root
// has none: this module is both a CLI (`node supabase/scripts/check-rls-wall.mjs`)
// and an import target for its own tests.
//
// WHY THIS GATE EXISTS. The wall in `supabase/migrations/` is invisible. A table
// with row level security and a table without it look identical in every client,
// every dashboard listing and every `select` a developer runs — the difference
// only shows up when somebody else's session asks for your rows, which is not a
// query anybody runs by accident. So the failure mode of this subsystem is not
// „the tests go red"; it is „everything works, for everyone, including the
// people it should not work for".
//
// `supabase/tests/database/` proves the wall against a live database and is the
// authority. But a live database is a thing somebody has to start, and a check
// that needs a running Postgres is a check that gets skipped in CI on the day it
// matters. This one reads the migration SQL as text and needs nothing at all, so
// it can sit in front of every commit. The two are complements: this one catches
// „the new table's migration forgot a line", the pgTAP one catches „the line is
// there and the database disagrees".
//
// WHAT IT CANNOT DO, stated so nobody mistakes a green run for a proof: it reads
// the migrations that are in the repository. A policy dropped by hand in the SQL
// editor, or a table created outside `migrations/`, is invisible here and is
// exactly what the `relrowsecurity`/`relforcerowsecurity` assertion in
// `tests/database/00_rls_enabled.test.sql` exists to catch.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, relative } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const SUPABASE_ROOT = join(HERE, "..");
const MIGRATIONS = join(SUPABASE_ROOT, "migrations");

// Tables that must carry the full wall. `storage.objects` and
// `realtime.messages` are listed by hand because this repository does not create
// them — Supabase does — and a check that only looks at `create table` would
// walk straight past the two tables holding the file bytes and the live change
// stream.
const FOREIGN_WALLED_TABLES = ["storage.objects", "realtime.messages"];

// The four tables whose restrictive gate is the shared predicate. `devices` is
// deliberately absent: it cannot call a function that reads `devices` without
// recursing (42P17), so it carries a row-local variant instead, and asserting
// the shared call there would force somebody to „fix" a comment into a bug.
const GATE_TABLES = ["public.sync_objects", "public.key_wraps", "public.pairing",
                     "public.sync_state"];

const GATE_FUNCTION = "private.nexus_session_is_live";

// The two INSERTs that can create a thing the gate accepts as a voucher. Both
// must demand aal2, and „both" is the word doing the work: the gate asks „is
// there a live `devices` row naming my session", so restricting `pairing` alone
// closes the long way in and leaves the short one — an aal1 session writing its
// own `devices` row — wide open. Neither is a special case of the other; they are
// one rule with two statements, which is exactly the shape that gets half-applied.
const AAL2_INSERT_TABLES = ["public.pairing", "public.devices"];

/**
 * Columns `authenticated` must never be able to write, per table and privilege.
 *
 * Every entry here is a value some OTHER rule treats as a fact — the server's
 * clock, the server's cursor, a row's identity, a latch that is supposed to be
 * single-use, the flag that says whether a client is a browser. A table-level
 * `grant insert, update` hands all of them over at once and turns each of those
 * facts into a value the client chose, without changing a policy or touching a
 * line anybody would review. So the shape is checked, not just the presence: a
 * write grant to `authenticated` must name its columns, and the named columns
 * must not include these.
 */
const FORBIDDEN_WRITE_COLUMNS = {
  "public.sync_objects": {
    insert: ["seq", "created_at", "updated_at"],
    update: ["user_id", "profile_id", "collection", "object_id", "seq",
             "created_at", "updated_at"],
  },
  "public.devices": {
    // `platform` is the only place a browser and a desktop can ever be told
    // apart; a client that writes it is a client describing itself.
    insert: ["id", "platform", "created_at", "revoked_at"],
    update: ["id", "user_id", "session_id", "platform", "created_at"],
  },
  "public.key_wraps": {
    insert: ["id", "created_at"],
    // `kind` and `profile_id` ARE the local-only guarantee: it is modelled as the
    // absence of a `ck_under_mk` row, and an UPDATE that re-points an existing
    // row is a way of making that row exist without inserting one.
    update: ["id", "user_id", "kind", "profile_id", "created_at"],
  },
  "public.pairing": {
    insert: ["id", "attempts", "consumed_at", "burned_at", "expires_at",
             "responder_pub", "responder_confirm"],
    update: ["id", "user_id", "code_id", "initiator_pub", "sealed_payload",
             "completion_token_hash", "attempts", "consumed_at", "expires_at",
             "created_at", "responder_pub", "responder_confirm"],
  },
  "public.sync_state": {
    insert: [],
    update: ["user_id", "device_id", "profile_id", "collection"],
  },
};

/**
 * Strip SQL comments while leaving string literals intact.
 *
 * Both halves of that sentence are load-bearing and were learned the obvious
 * way. Comments must go, because this file's own migrations quote dangerous SQL
 * inside prose — migration 003's header contains a literal
 * `update sync_objects set version = 9007…` as the attack it prevents, and a
 * scanner that reads comments would report the defence as the defect. Strings
 * must STAY, because migration 004 issues its `alter table storage.objects …`
 * through `execute` inside a `DO` block, so the only place that wall exists as
 * text is inside a dollar-quoted string; stripping strings would make the file
 * that builds it look like a file that does nothing.
 *
 * Dollar-quoted bodies are treated as code — their delimiters are replaced by
 * whitespace and their contents scanned — because every one of them in this
 * repository is a function body or an `execute`. A dollar-quoted blob of prose
 * would be mis-scanned; there is none, and the pgTAP suite is the backstop.
 */
export function stripComments(sql) {
  let out = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const two = sql.slice(i, i + 2);

    if (two === "--") {
      while (i < n && sql[i] !== "\n") i += 1;
      continue;
    }

    if (two === "/*") {
      // Postgres nests block comments; a naive scan to the first `*/` would
      // resume parsing in the middle of the outer comment.
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql.slice(i, i + 2) === "/*") { depth += 1; i += 2; continue; }
        if (sql.slice(i, i + 2) === "*/") { depth -= 1; i += 2; continue; }
        i += 1;
      }
      continue;
    }

    if (sql[i] === "'") {
      out += "'";
      i += 1;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { out += "''"; i += 2; continue; }
        if (sql[i] === "'") { out += "'"; i += 1; break; }
        out += sql[i];
        i += 1;
      }
      continue;
    }

    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dollar !== null) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const bodyEnd = end === -1 ? n : end;
      // Delimiters become spaces so the body joins the surrounding text as
      // ordinary SQL, and the body is recursed through so its own `--` comments
      // are stripped too.
      out += " " + stripComments(sql.slice(i + tag.length, bodyEnd)) + " ";
      i = end === -1 ? n : end + tag.length;
      continue;
    }

    out += sql[i];
    i += 1;
  }

  return out;
}

/** Read every migration, newest last, as one comment-free lowercase blob. */
export function loadMigrations(dir = MIGRATIONS) {
  const files = readdirSync(dir).filter((f) => extname(f) === ".sql").sort();
  return files.map((file) => ({
    file,
    sql: stripComments(readFileSync(join(dir, file), "utf8")).toLowerCase(),
  }));
}

/** Balanced-paren slice starting at the `(` at or after `from`. */
function parenBlock(sql, from) {
  const open = sql.indexOf("(", from);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === "(") depth += 1;
    else if (sql[i] === ")") {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, i);
    }
  }
  return "";
}

/**
 * Column names declared by a `create table` body. Table constraints are skipped
 * by keyword; anything else at depth zero that starts with an identifier is a
 * column. Good enough because it only ever reads DDL written in this repository,
 * and the pgTAP suite reads the real catalog.
 */
function columnsOf(body) {
  const columns = [];
  let depth = 0;
  let current = "";
  const flush = () => {
    const decl = current.trim();
    current = "";
    if (decl === "") return;
    const first = /^([a-z_][a-z0-9_]*)/.exec(decl);
    if (first === null) return;
    const keyword = first[1];
    if (["constraint", "primary", "unique", "check", "foreign", "exclude", "like"]
      .includes(keyword)) return;
    columns.push(keyword);
  };
  for (const ch of body) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { flush(); continue; }
    current += ch;
  }
  flush();
  return columns;
}

/**
 * The policies that EXIST after every migration has run, as `{ name, table, body }`.
 *
 * `body` EXCLUDES THE HEADER, and that is not tidiness. The first version of
 * this checker tested the whole statement text for `aal2`, and the policy is
 * called `pairing_insert_requires_aal2` — so replacing its predicate with
 * `with check (true)` still matched, and the single rule that stops a
 * password-only session from minting its own device passed while being gone.
 * The mutation test in `tests/static/` is what surfaced it. A predicate check
 * must never be able to read the name of the thing it is checking.
 *
 * DROPS ARE HONOURED, AND THAT WAS NOT ALWAYS TRUE. This function used to
 * collect every `create policy` in the migration set and return them all, which
 * is right exactly while migrations only ever add. The moment one supersedes a
 * policy — `drop policy` then `create policy` under a better name, which is what
 * migration 010 does to the `key_wraps` gate — the old body is still in the blob,
 * still first, and every rule below that picks a policy by shape reads the
 * DEAD one. The checker then audits a rule the database does not have, passes,
 * and says nothing about the rule it does. Statements are therefore replayed in
 * file order into a live set: create writes, drop removes.
 */
function policiesOf(sql) {
  const live = new Map();
  const re = /(create|drop)\s+policy\s+(?:if\s+exists\s+)?([a-z0-9_]+)\s+on\s+([a-z_]+\.[a-z_]+)/g;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const [header, verb, name, table] = match;
    const key = `${table}/${name}`;
    if (verb === "drop") {
      live.delete(key);
      continue;
    }
    const end = sql.indexOf(";", match.index);
    const stop = end === -1 ? sql.length : end;
    live.set(key, { name, table, body: sql.slice(match.index + header.length, stop) });
  }
  return [...live.values()];
}

/**
 * Every `grant … to authenticated` statement, decomposed into
 * `{ table, privileges: Map<privilege, string[] | null> }`.
 *
 * A null column list means the grant was written at table level, i.e. „all
 * columns, including the ones added next year by somebody who was not thinking
 * about this file". That is the regression this parser exists to see, and it is
 * invisible to a text search: `grant insert on public.devices to authenticated`
 * and `grant insert (user_id, session_id, …) on public.devices to authenticated`
 * differ by one parenthesis and by every column the schema will ever gain.
 */
function clientGrantsOf(sql) {
  const grants = [];
  for (const statement of sql.match(/\bgrant\b[^;]*;/g) ?? []) {
    if (!/\bto\s+[^;]*\bauthenticated\b/.test(statement)) continue;
    const table = /\bon\s+([a-z_]+\.[a-z_]+)\b/.exec(statement);
    if (table === null) continue;
    const privileges = new Map();
    const re = /\b(insert|update)\b\s*(\(([^)]*)\))?/g;
    let match;
    while ((match = re.exec(statement)) !== null) {
      const columns = match[3] === undefined
        ? null
        : match[3].split(",").map((c) => c.trim()).filter((c) => c.length > 0);
      privileges.set(match[1], columns);
    }
    if (privileges.size > 0) grants.push({ table: table[1], privileges });
  }
  return grants;
}

// A pattern that would mean a real credential reached the repository. `eyj` is
// the base64 prefix every JWT begins with (`{"`), which covers legacy anon and
// service-role keys; `sb_secret_`/`sb_publishable_` are the current formats.
const SECRET_PATTERNS = [
  { name: "JSON Web Token", re: /eyj[a-z0-9_-]{20,}/i },
  { name: "Supabase secret key", re: /sb_secret_[a-z0-9]{10,}/i },
  { name: "Supabase publishable key", re: /sb_publishable_[a-z0-9]{10,}/i },
  { name: "Postgres URL with a password", re: /postgres(ql)?:\/\/[^\s:@]+:[^\s@]+@/i },
  { name: "hosted project ref", re: /https:\/\/[a-z]{20}\.supabase\.co/i },
];

/**
 * Files the secret scan reads.
 *
 * Dot-FILES are included, and that is the whole point of writing this out: the
 * naive version skipped every name beginning with a dot, which is exactly the
 * set a leaked credential is most likely to be sitting in. `.env.example` is a
 * committed file and must be scanned; `.gitignore` is committed and cheap to
 * read. The real `.env` family is skipped instead — it is gitignored, it holds
 * the developer's own working keys by design, and failing the gate on a
 * correctly configured machine is how a gate gets switched off.
 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    if (entry.startsWith(".") && statSync(join(dir, entry)).isDirectory()) continue;
    if (entry === ".env" || (entry.startsWith(".env.") && !entry.endsWith(".example"))) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// pgTAP assertion functions used by `tests/database/`. Longest names first, so
// the alternation does not match `is` inside `is_empty`.
const TAP_ASSERTIONS =
  /\bselect\s+(isnt_empty|is_empty|has_trigger|throws_ok|lives_ok|isnt|is|ok)\s*\(/g;

/**
 * `plan(N)` must equal the number of assertions in the file.
 *
 * A pgTAP plan is a promise, and both ways of breaking it are bad in a way that
 * is easy to miss. Plan MORE than you assert and the run is red with „looked for
 * 17 tests, ran 16", which reads like a broken test rather than a miscount and
 * gets „fixed" by lowering the number. Plan FEWER and the extra assertions run
 * but their results are outside the plan — pgTAP reports the mismatch, but a
 * suite that has been failing on the count for a while is a suite whose count
 * nobody reads, and at that point an assertion can be deleted for free.
 *
 * Checked statically because these tests need a live Postgres, and the day the
 * count drifts is exactly the day nobody has one running.
 */
export function auditTestPlans(dir = join(SUPABASE_ROOT, "tests", "database")) {
  const problems = [];
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".test.sql")).sort();
  } catch {
    return ["tests/database: directory missing"];
  }
  if (files.length === 0) problems.push("tests/database: no pgTAP tests found");

  for (const file of files) {
    const sql = stripComments(readFileSync(join(dir, file), "utf8")).toLowerCase();
    const planned = /\bselect\s+plan\s*\(\s*(\d+)\s*\)/.exec(sql);
    if (planned === null) {
      problems.push(`${file}: no plan(N)`);
      continue;
    }
    const actual = (sql.match(TAP_ASSERTIONS) ?? []).length;
    if (Number(planned[1]) !== actual) {
      problems.push(`${file}: plan(${planned[1]}) but ${actual} assertions`);
    }
    if (!sql.includes("rollback")) {
      // Every one of these seeds `auth.users` and writes real rows. Without the
      // rollback a „test" run against any database mutates it permanently.
      problems.push(`${file}: does not ROLLBACK — it would leave its fixtures behind`);
    }
  }
  return problems;
}

/**
 * The whole audit. Returns a list of human-readable problems; empty means the
 * wall, as written in the migrations, stands.
 */
export function auditWall(dir = MIGRATIONS, root = SUPABASE_ROOT) {
  const problems = [];
  const migrations = loadMigrations(dir);
  const all = migrations.map((m) => m.sql).join("\n");

  // --- every created table, and its columns -------------------------------
  const tables = new Map();
  const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_]+)\.([a-z_]+)/g;
  let match;
  while ((match = createRe.exec(all)) !== null) {
    const qualified = `${match[1]}.${match[2]}`;
    tables.set(qualified, columnsOf(parenBlock(all, match.index)));
  }
  if (tables.size === 0) problems.push("no `create table` found — is the path right?");

  const policies = policiesOf(all);

  for (const [table, columns] of tables) {
    // 1. ENABLE and FORCE. Both, always. ENABLE alone exempts the table owner,
    //    which is the role that runs every migration, seed and console session.
    if (!all.includes(`alter table ${table} enable row level security`)) {
      problems.push(`${table}: missing ENABLE ROW LEVEL SECURITY`);
    }
    if (!all.includes(`alter table ${table} force row level security`)) {
      problems.push(`${table}: missing FORCE ROW LEVEL SECURITY (ENABLE exempts the owner)`);
    }

    // 2. Supabase's default privileges hand every new public table to `anon`
    //    the instant it is created. RLS then hides the rows, so nothing looks
    //    wrong — until a policy edit turns a quiet empty result into a leak.
    if (!all.includes(`revoke all on ${table} from anon`)) {
      problems.push(`${table}: no REVOKE ALL … FROM anon (Supabase grants new tables to anon)`);
    }

    // 3. Metadata in the clear is the conceded risk, and the schema is where a
    //    reader learns it. A column with no `comment on column` is a leak
    //    nobody has written down.
    for (const column of columns) {
      if (!all.includes(`comment on column ${table}.${column} is`)) {
        problems.push(`${table}.${column}: no COMMENT stating what it leaks`);
      }
    }
  }

  // 3b. The two tables Supabase created and this repository must still wall.
  //     They hold the file bytes and the live change stream, and they are the
  //     two a reviewer never thinks to check precisely because nobody wrote them.
  for (const table of FOREIGN_WALLED_TABLES) {
    if (!all.includes(`alter table ${table} enable row level security`)) {
      problems.push(`${table}: migrations never ENABLE row level security on it`);
    }
    if (!all.includes(`alter table ${table} force row level security`)) {
      problems.push(`${table}: migrations never FORCE row level security on it`);
    }
  }

  for (const table of [...tables.keys(), ...FOREIGN_WALLED_TABLES]) {
    const own = policies.filter((p) => p.table === table);

    // 4. Rows are tombstoned. A DELETE policy is not a smaller version of that
    //    rule; it is the absence of it.
    for (const policy of own) {
      if (/for\s+delete/.test(policy.body)) {
        problems.push(`${table}: policy \`${policy.name}\` grants DELETE — rows are tombstoned`);
      }
      if (/for\s+all/.test(policy.body) && !/as\s+restrictive/.test(policy.body)) {
        problems.push(
          `${table}: permissive FOR ALL policy \`${policy.name}\` also grants DELETE`,
        );
      }
    }

    // 4b. A policy with no `TO` clause applies to PUBLIC, which includes `anon`
    //     — the role behind the publishable key, i.e. the internet. It reads
    //     like a policy that simply forgot a detail; it is a policy addressed to
    //     everybody. Every policy here must name its role.
    for (const policy of own) {
      if (!/\sto\s+(authenticated|service_role|anon)\b/.test(policy.body)) {
        problems.push(
          `${table}: policy \`${policy.name}\` has no TO clause — it applies to PUBLIC`,
        );
      }
    }

    // 5. Permissive policies OR together, so „and the session must be strong"
    //    written as a second permissive policy WIDENS access. Narrowing needs
    //    AS RESTRICTIVE, and every walled table needs at least one.
    const restrictive = own.filter((p) => /as\s+restrictive/.test(p.body));
    if (own.length > 0 && restrictive.length === 0) {
      problems.push(`${table}: has policies but no AS RESTRICTIVE gate`);
    }
    if (own.length === 0 && !table.startsWith("private.")) {
      problems.push(`${table}: no policies at all — unreachable, or a table nobody walled`);
    }
  }

  // 6. Private-schema tables are walled by having RLS forced and NO policy, so
  //    only a BYPASSRLS role reaches them. Assert the absence, or a future
  //    „helpful" policy silently opens them.
  for (const table of tables.keys()) {
    if (!table.startsWith("private.")) continue;
    if (policies.some((p) => p.table === table)) {
      problems.push(`${table}: a private-schema table must have NO policy at all`);
    }
  }

  // 7. The gate predicate is shared, so it cannot drift on one table only.
  for (const table of GATE_TABLES) {
    const gated = policies.some(
      (p) => p.table === table && /as\s+restrictive/.test(p.body) && p.body.includes(GATE_FUNCTION),
    );
    if (!gated) problems.push(`${table}: restrictive gate does not call ${GATE_FUNCTION}()`);
  }

  // 8. The two statements that keep the gate's `OR` from being a self-service
  //    entrance. The gate admits any session a live `devices` row names, so both
  //    ways of obtaining such a row have to demand a second factor: starting a
  //    pairing, and writing the row directly. Restricting only the first is the
  //    error that reads as complete — the reasoning about pairing is elaborate
  //    and correct, and it leaves the shorter path open.
  for (const table of AAL2_INSERT_TABLES) {
    const insertGate = policies.find(
      (p) => p.table === table && /as\s+restrictive/.test(p.body) &&
        /for\s+insert/.test(p.body),
    );
    if (insertGate === undefined || !insertGate.body.includes("aal2")) {
      problems.push(`${table}: INSERT is not restricted to aal2 sessions`);
    }
  }

  // 8a. `devices` is the one table exempt from the shared gate predicate (it
  //     cannot call a function that reads itself — 42P17), so its row-local
  //     replacement is asserted by nobody unless it is asserted here. Without
  //     this, „devices carries a restrictive policy" is satisfied by
  //     `as restrictive for all using (true)`, which is not a gate.
  const devicesGate = policies.find(
    (p) => p.table === "public.devices" && /as\s+restrictive/.test(p.body) &&
      /for\s+all/.test(p.body),
  );
  if (devicesGate === undefined ||
      !devicesGate.body.includes("session_id") || !devicesGate.body.includes("aal2")) {
    problems.push(
      "public.devices: restrictive gate is not the row-local session predicate",
    );
  }

  // 8e. The master-key wraps are desktop-only, and that is a SERVER rule.
  //
  //     `@nexus/sync-crypto`'s `kdf.ts` keeps MK out of the browser by never
  //     giving a browser the function that derives K_wrap. That defence is real
  //     and it is entirely a fact about the WEB BUNDLE — one stray import and
  //     it is gone, with nothing in the database noticing. So the same rule is
  //     written a second time here, where it does not depend on what anybody
  //     imported: `key_wraps` carries a SECOND restrictive policy, on top of the
  //     session gate, keyed on whether a live `devices` row calls the session a
  //     DESKTOP.
  //
  //     Asserted on the shape rather than the name, because a policy renamed is
  //     still the wall and a policy rewritten to `using (true)` is not.
  //
  //     USING AND WITH CHECK ARE CHECKED SEPARATELY AND DIFFER, because the read
  //     half and the write half are different rules. READ confines
  //     `mk_under_kwrap` only — the row whose opener a browser derives from the
  //     password by construction. `mk_under_src` stays readable or account
  //     recovery cannot happen at all: a recovering desktop has no device row
  //     yet, and its opener is the Recovery Kit code, which the password does
  //     not yield.
  //
  //     WRITE TAKES NO EXEMPTION AT ALL, and the write half is therefore checked
  //     for the ABSENCE of `kind` rather than for the presence of the right
  //     exemption. Any branch keyed on the kind is a hole, because authoring a
  //     wrap is a desktop operation in every case: a browser receives content
  //     keys through pairing and never writes the row. The rule is stated that
  //     way because the defect it replaces was an exemption that looked correct
  //     — `kind = 'ck_under_mk' or …`, carrying the read-side argument into the
  //     write side — and any check that asked „is the right exemption present"
  //     would have been satisfied by it.
  const mkGate = policies.find(
    (p) => p.table === "public.key_wraps" && /as\s+restrictive/.test(p.body) &&
      p.body.includes("mk_under_kwrap"),
  );
  const [reads, writes] = mkGate === undefined ? [] : mkGate.body.split(/\bwith\s+check\b/);
  const desktop = (half) => half !== undefined && /platform\s*=\s*'desktop'/.test(half);
  if (!desktop(reads) || !/kind\s*<>\s*'mk_under_kwrap'/.test(reads ?? "") ||
      !desktop(writes) || /\bkind\b/.test(writes ?? "")) {
    problems.push(
      "public.key_wraps: no restrictive policy confines mk_under_kwrap to a desktop session on " +
      "read and EVERY kind on write",
    );
  }

  // 8d. Write grants to `authenticated` must name their columns, and must not
  //     name a column some other rule treats as a fact. See
  //     FORBIDDEN_WRITE_COLUMNS for why each entry is there.
  const clientGrants = clientGrantsOf(all);
  for (const [table, rules] of Object.entries(FORBIDDEN_WRITE_COLUMNS)) {
    const granted = clientGrants.filter((g) => g.table === table);
    for (const [privilege, forbidden] of Object.entries(rules)) {
      const columns = granted
        .map((g) => g.privileges.get(privilege))
        .filter((c) => c !== undefined);
      if (columns.length === 0) continue;
      if (columns.some((c) => c === null)) {
        problems.push(
          `${table}: \`grant ${privilege}\` to authenticated is table-level — ` +
          "it must name its columns",
        );
        continue;
      }
      const flat = columns.flat();
      for (const column of forbidden) {
        if (flat.includes(column)) {
          problems.push(`${table}.${column}: granted ${privilege.toUpperCase()} to authenticated`);
        }
      }
    }
  }

  // 8b. Withholding the DELETE policy and withholding the DELETE privilege do
  //     different jobs, and only one of them is loud. With the privilege but no
  //     policy, `DELETE` succeeds and affects zero rows — which every HTTP
  //     client reports as 204 success. A delete that silently does nothing is
  //     worse than one that fails, because the client believes it worked.
  const deleteGrant = /grant\s+[^;]*\bdelete\b[^;]*\bto\s+[^;]*\b(anon|authenticated)\b/;
  if (deleteGrant.test(all)) {
    problems.push("a GRANT hands DELETE to anon or authenticated — rows are tombstoned");
  }

  // 8c. No SQL anywhere in the migrations may DELETE from replicated user
  //     state. Migration 005's housekeeping function reaps spent pairings and
  //     stale rate-limit buckets, and its comment claims it „cannot touch user
  //     state" — this is what turns that claim into a check. A tombstone is not
  //     a slower delete: a deleted row is indistinguishable from one that never
  //     arrived, so the peer that has not synced yet re-uploads it and the
  //     deletion undoes itself. `service_role` is also denied the privilege in
  //     migration 002, so this is the second of two mechanisms.
  for (const table of ["public.sync_objects", "public.key_wraps", "public.devices",
                       "public.sync_state"]) {
    if (new RegExp(`delete\\s+from\\s+${table.replace(".", "\\.")}\\b`).test(all)) {
      problems.push(`${table}: a migration DELETEs from replicated user state`);
    }
  }

  // 9. RLS `WITH CHECK` sees only NEW, so the transition rules cannot live
  //    there. Without these triggers one statement can freeze an object forever,
  //    or re-wrap a rotated key at the nonce the old key used.
  //
  //    INSERT is named as well as UPDATE. The version bound is the lock-out
  //    defence, and a defence that applies only to rows that already exist is
  //    absent for every row being created — `insert … version = 2^53-1` was legal
  //    while every assertion about the bound passed.
  if (!/create\s+trigger\s+[a-z0-9_]+\s+before\s+insert\s+or\s+update\s+on\s+public\.sync_objects/
    .test(all)) {
    problems.push("public.sync_objects: no BEFORE INSERT OR UPDATE guard trigger");
  }
  if (!/create\s+trigger\s+[a-z0-9_]+\s+before\s+update\s+on\s+public\.key_wraps/.test(all)) {
    problems.push("public.key_wraps: no BEFORE UPDATE guard trigger");
  }
  if (!/create\s+trigger\s+[a-z0-9_]+\s+before\s+update\s+on\s+public\.devices/.test(all)) {
    problems.push("public.devices: no BEFORE UPDATE guard trigger");
  }

  // 10. A function with a mutable search_path that a policy calls is a
  //     privilege-escalation primitive: shadow the table it reads, own the gate.
  const funcRe = /create\s+(?:or\s+replace\s+)?function\s+([a-z_]+\.[a-z0-9_]+)\s*\(/g;
  while ((match = funcRe.exec(all)) !== null) {
    const end = all.indexOf("$", match.index);
    const header = all.slice(match.index, end === -1 ? match.index + 400 : end);
    if (!/set\s+search_path\s*=/.test(header)) {
      problems.push(`${match[1]}(): no \`set search_path\` — shadowable by any schema`);
    }
  }

  // 11. Nothing under `supabase/` may contain a real credential. This is the
  //     cheapest possible check and it is here because the expensive version —
  //     noticing after a push — does not exist.
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(text)) {
        problems.push(`${relative(root, file)}: looks like a real ${name}`);
      }
    }
  }

  return problems;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}` ||
    process.argv[1]?.endsWith("check-rls-wall.mjs")) {
  const problems = [...auditWall(), ...auditTestPlans()];
  if (problems.length > 0) {
    console.error(`RLS wall audit FAILED — ${problems.length} problem(s):\n`);
    for (const problem of problems) console.error(`  • ${problem}`);
    process.exit(1);
  }
  console.log("RLS wall audit OK");
}
