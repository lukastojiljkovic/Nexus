// Tests for `supabase/scripts/check-rls-wall.mjs`, and they are mostly tests of
// the checker rather than of the migrations.
//
// WHY IT IS ARRANGED THIS WAY. Asserting „the current migrations pass" proves
// almost nothing: a checker with a typo in its table name, a regex that never
// matches, or a rule accidentally commented out passes exactly the same
// assertion, and it does so forever. A security gate that has never been
// observed to fail is indistinguishable from one that cannot fail. So every rule
// below is exercised by BREAKING the real migrations — copying them, removing
// one line, and demanding that the specific problem is reported. If a rule stops
// working, the test that stops working is the one for that rule.
//
// Run: node --test supabase/tests/static/
// These need no database, no Supabase CLI, and no network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { auditTestPlans, auditWall, stripComments } from "../../scripts/check-rls-wall.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPABASE_ROOT = join(HERE, "..", "..");
const MIGRATIONS = join(SUPABASE_ROOT, "migrations");

const CORE = "20260808090000_sync_core_tables.sql";
const RLS = "20260808090100_sync_rls.sql";
const TRIGGER = "20260808090200_sync_objects_guard_trigger.sql";
const KEY_WRAPS = "20260808090250_key_wraps_guard_trigger.sql";
const DEVICES = "20260808090260_devices_guard_trigger.sql";
const STORAGE = "20260808090300_storage_realtime_rls.sql";
const DESKTOP_ONLY = "20260809160000_key_wraps_writes_are_desktop_only.sql";

/**
 * Copy the real migrations, apply one edit, audit the result. The mutation is
 * asserted to have CHANGED something — a `replace` whose pattern has drifted
 * would otherwise silently mutate nothing and the test would be asserting that
 * the unmodified migrations fail, which they do not, so it would look like the
 * rule works while testing nothing at all.
 */
function auditWithMutation(file, mutate) {
  const dir = mkdtempSync(join(tmpdir(), "nexus-rls-"));
  try {
    cpSync(MIGRATIONS, join(dir, "migrations"), { recursive: true });
    const path = join(dir, "migrations", file);
    const before = readFileSync(path, "utf8");
    const after = mutate(before);
    assert.notEqual(after, before, `mutation of ${file} matched nothing — the test has drifted`);
    writeFileSync(path, after);
    return auditWall(join(dir, "migrations"), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertReports(problems, needle) {
  assert.ok(
    problems.some((p) => p.includes(needle)),
    `expected a problem containing ${JSON.stringify(needle)}, got:\n  ${problems.join("\n  ")}`,
  );
}

// ---------------------------------------------------------------------------
// The comment stripper, which everything else is built on.
// ---------------------------------------------------------------------------

test("stripComments removes line comments", () => {
  assert.equal(stripComments("select 1; -- drop table x\nselect 2;").includes("drop"), false);
});

test("stripComments keeps string literals, because the storage wall lives in one", () => {
  // Migration 004 issues its `alter table storage.objects …` through `execute`
  // inside a DO block. If strings were stripped, the file that builds that wall
  // would read as a file that does nothing.
  const kept = stripComments("execute 'alter table storage.objects force row level security';");
  assert.ok(kept.includes("alter table storage.objects force row level security"));
});

test("stripComments does not treat `--` inside a string as a comment", () => {
  assert.ok(stripComments("select '-- not a comment', 2;").includes("2"));
});

test("stripComments handles nested block comments", () => {
  // Postgres nests them; scanning to the first `*/` would resume parsing inside
  // the outer comment and swallow the statement after it.
  assert.ok(stripComments("/* a /* b */ c */ select 9;").includes("select 9"));
});

test("stripComments scans dollar-quoted bodies as code and strips their comments", () => {
  const body = "create function f() returns void as $$ begin -- drop table x\n end; $$;";
  const stripped = stripComments(body);
  assert.ok(stripped.includes("begin"));
  assert.equal(stripped.includes("drop table x"), false);
});

test("stripComments survives an unterminated dollar quote without hanging", () => {
  assert.doesNotThrow(() => stripComments("as $$ begin"));
});

// ---------------------------------------------------------------------------
// The wall as it actually stands.
// ---------------------------------------------------------------------------

test("the shipped migrations pass the wall audit", () => {
  const problems = auditWall(MIGRATIONS, SUPABASE_ROOT);
  assert.deepEqual(problems, [], problems.join("\n"));
});

// ---------------------------------------------------------------------------
// One test per rule, each proving the rule can fail.
// ---------------------------------------------------------------------------

test("catches ENABLE without FORCE — the exemption that hides every policy bug", () => {
  const problems = auditWithMutation(RLS, (sql) =>
    sql.replace("alter table public.sync_objects force row level security;", ""));
  assertReports(problems, "public.sync_objects: missing FORCE ROW LEVEL SECURITY");
});

test("catches a table left ungated by RLS entirely", () => {
  const problems = auditWithMutation(RLS, (sql) =>
    sql.replace("alter table public.key_wraps enable row level security;", ""));
  assertReports(problems, "public.key_wraps: missing ENABLE ROW LEVEL SECURITY");
});

test("catches a table still handed to anon by Supabase's default privileges", () => {
  const problems = auditWithMutation(RLS, (sql) =>
    sql.replace("revoke all on public.devices from anon;", ""));
  assertReports(problems, "public.devices: no REVOKE ALL");
});

test("catches a column whose metadata leak was never written down", () => {
  const problems = auditWithMutation(CORE, (sql) =>
    sql.replace("comment on column public.devices.session_id is", "comment on table public.devices is"));
  assertReports(problems, "public.devices.session_id: no COMMENT stating what it leaks");
});

test("catches a gate downgraded from RESTRICTIVE to permissive", () => {
  // The subtle one. Permissive policies OR together, so this edit does not
  // weaken the gate — it removes it, and widens the table at the same time.
  const problems = auditWithMutation(RLS, (sql) =>
    sql.replace(
      "create policy sync_state_live_session on public.sync_state\n  as restrictive for all to authenticated",
      "create policy sync_state_live_session on public.sync_state\n  for all to authenticated",
    ));
  assertReports(problems, "permissive FOR ALL policy");
});

test("catches a DELETE policy — rows are tombstoned, never removed", () => {
  const problems = auditWithMutation(RLS, (sql) =>
    sql.replace(
      "create policy sync_objects_owner_select on public.sync_objects\n  for select to authenticated",
      "create policy sync_objects_owner_delete on public.sync_objects\n" +
      "  for delete to authenticated using (true);\n\n" +
      "create policy sync_objects_owner_select on public.sync_objects\n  for select to authenticated",
    ));
  assertReports(problems, "grants DELETE");
});

test("catches a GRANT that hands DELETE to a client role", () => {
  const problems = auditWithMutation(RLS, (sql) =>
    sql.replace(
      "grant select on public.key_wraps to authenticated;",
      "grant select, delete on public.key_wraps to authenticated;",
    ));
  assertReports(problems, "hands DELETE to anon or authenticated");
});

test("catches a migration that DELETEs from replicated user state", () => {
  // Migration 005's housekeeping reaps protocol scratch space. The day somebody
  // adds `delete from sync_objects where deleted` to it as a „cleanup", every
  // peer that has not synced yet re-uploads those rows and the deletions undo
  // themselves — silently, on other people's machines.
  const problems = auditWithMutation(RLS, (sql) =>
    `${sql}\ndelete from public.sync_objects where deleted;\n`);
  assertReports(problems, "public.sync_objects: a migration DELETEs from replicated user state");
});

test("catches a policy with no TO clause, which addresses PUBLIC", () => {
  const problems = auditWithMutation(RLS, (sql) =>
    sql.replace(
      "create policy pairing_owner_select on public.pairing\n  for select to authenticated",
      "create policy pairing_owner_select on public.pairing\n  for select",
    ));
  assertReports(problems, "has no TO clause");
});

test("catches a restrictive gate that stopped calling the shared predicate", () => {
  const problems = auditWithMutation(RLS, (sql) =>
    sql.replace(
      "create policy key_wraps_live_session on public.key_wraps\n" +
      "  as restrictive for all to authenticated\n" +
      "  using ((select private.nexus_session_is_live()))\n" +
      "  with check ((select private.nexus_session_is_live()));",
      "create policy key_wraps_live_session on public.key_wraps\n" +
      "  as restrictive for all to authenticated\n" +
      "  using (true);",
    ));
  assertReports(problems, "public.key_wraps: restrictive gate does not call");
});

// THE MASTER-KEY WRAPS, IN BOTH DIRECTIONS. The rule is „only a session a live
// `devices` row calls a desktop may touch a key wrap", and it has two halves
// that differ and fail differently. READ confines `mk_under_kwrap` only; losing
// it hands MK to any browser holding the web password, because K_wrap is derived
// from that password on the way to K_auth. WRITE confines every kind; losing it
// hands a session the ability to overwrite a wrap it cannot read, which locks
// every real device out of the account and, on `mk_under_src`, destroys the way
// back — or, on a `ck_under_mk`, detaches a whole profile's rows from any key.
//
// THE POLICY LIVES IN MIGRATION 010, NOT IN THE RLS MIGRATION. `…_sync_rls.sql`
// still contains the superseded `key_wraps_master_key_is_desktop_only`, dropped
// by 010 and replaced under a name that describes both halves. Mutating the dead
// text would change nothing the database has, which is precisely the confusion
// `policiesOf` had to learn to avoid.
//
// Every mutation below keeps the policy, keeps `as restrictive`, keeps a device
// subquery and keeps the word `desktop`, so every coarser rule still passes.
const MK_GATE = /create policy key_wraps_desktop_only on public\.key_wraps\n[\s\S]*?\n {2}\);\n/;

/** The real subquery, so a mutation differs from the original in one clause only. */
const DESKTOP_EXISTS =
  "    exists (\n" +
  "      select 1 from public.devices d\n" +
  "      where d.user_id = key_wraps.user_id\n" +
  "        and d.session_id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid\n" +
  "        and d.revoked_at is null\n" +
  "        and d.platform = 'desktop'\n" +
  "    )\n";

const mkPolicy = (using, withCheck) =>
  "create policy key_wraps_desktop_only on public.key_wraps\n" +
  "  as restrictive for all to authenticated\n" +
  `  using (\n${using}  )\n  with check (\n${withCheck}  );\n`;

test("catches the master-key wrap losing its desktop-only READ gate", () => {
  const problems = auditWithMutation(DESKTOP_ONLY, (sql) =>
    sql.replace(MK_GATE, mkPolicy(
      "    kind <> 'mk_under_kwrap' or true\n",
      DESKTOP_EXISTS,
    )));
  assertReports(problems, "public.key_wraps: no restrictive policy confines mk_under_kwrap");
});

test("catches the desktop-only gate applied to reads but not to writes", () => {
  // The likelier of the two, and the one a reviewer's eye slides over: the
  // sentence „a master-key wrap is desktop-only" reads as satisfied the moment
  // USING says so, and `with check` is three lines further down.
  const problems = auditWithMutation(DESKTOP_ONLY, (sql) =>
    sql.replace(MK_GATE, mkPolicy(
      `    kind <> 'mk_under_kwrap' or\n${DESKTOP_EXISTS}`,
      "    user_id = (select auth.uid())\n",
    )));
  assertReports(problems, "EVERY kind on write");
});

test("catches the WRITE gate exempting the recovery wrap", () => {
  // It looks like a tidy-up: making the two halves match. It leaves
  // `mk_under_src` writable by any session on the account — which cannot read
  // it, does not need to, and by overwriting it turns „recoverable with the
  // Recovery Kit" into „gone".
  const problems = auditWithMutation(DESKTOP_ONLY, (sql) =>
    sql.replace(MK_GATE, mkPolicy(
      `    kind <> 'mk_under_kwrap' or\n${DESKTOP_EXISTS}`,
      `    kind <> 'mk_under_kwrap' or\n${DESKTOP_EXISTS}`,
    )));
  assertReports(problems, "EVERY kind on write");
});

test("catches the WRITE gate exempting content-key wraps — the defect 010 closed", () => {
  // THE ONE THAT SHIPPED. `ck_under_mk` was exempt from the write half outright,
  // on the read side's reasoning — a browser is supposed to hold content keys —
  // which does not carry: a browser RECEIVES them through pairing and never
  // authors the row. What the branch granted was one UPDATE per profile,
  // permanently detaching every row of it from any key that could open it.
  const problems = auditWithMutation(DESKTOP_ONLY, (sql) =>
    sql.replace(MK_GATE, mkPolicy(
      `    kind <> 'mk_under_kwrap' or\n${DESKTOP_EXISTS}`,
      `    kind = 'ck_under_mk' or\n${DESKTOP_EXISTS}`,
    )));
  assertReports(problems, "EVERY kind on write");
});

test("catches the gate being dropped and not replaced", () => {
  // The rule `policiesOf` had to learn. Every other mutation here rewrites a
  // predicate; this one deletes the statement that creates it, leaving the
  // superseded definition in `…_sync_rls.sql` as the only `create policy` for
  // this table that mentions `mk_under_kwrap`. A checker that collects creates
  // and ignores drops finds that dead body, likes it, and reports nothing.
  const problems = auditWithMutation(DESKTOP_ONLY, (sql) => sql.replace(MK_GATE, ""));
  assertReports(problems, "public.key_wraps: no restrictive policy confines mk_under_kwrap");
});

// BOTH MUTATIONS BELOW REPLACE THE PREDICATE AND KEEP THE POLICY NAME, and both
// name their policy in the pattern rather than matching the predicate alone.
//
// Keeping the name is the original point of these two tests: the first version of
// the checker searched the whole statement for `aal2`, and the policies are called
// `…_insert_requires_aal2`, so `with check (true)` under the original name matched
// and the rule passed while being gone. Naming the policy in the pattern is the
// newer requirement — the two policies now carry the SAME predicate text, so a
// bare `sql.replace` of it mutates whichever appears first in the file and the
// other test silently stops testing anything.
test("catches the pairing INSERT losing its aal2 requirement", () => {
  const problems = auditWithMutation(RLS, (sql) =>
    sql.replace(
      "create policy pairing_insert_requires_aal2 on public.pairing\n" +
      "  as restrictive for insert to authenticated\n" +
      "  with check (coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2');",
      "create policy pairing_insert_requires_aal2 on public.pairing\n" +
      "  as restrictive for insert to authenticated\n  with check (true);",
    ));
  assertReports(problems, "public.pairing: INSERT is not restricted to aal2");
});

test("catches the devices INSERT losing its aal2 requirement", () => {
  // THE OTHER HALF OF THE RULE ABOVE, and the half that was missing. The gate
  // admits any session a live `devices` row names — it never asks how the row got
  // there — so restricting `pairing` closes the long way in and leaves the short
  // one: an aal1 session inserting a row that names its own `session_id`. One
  // statement, and a stolen password reads the whole corpus and every key wrap.
  const problems = auditWithMutation(RLS, (sql) =>
    sql.replace(
      "create policy devices_insert_requires_aal2 on public.devices\n" +
      "  as restrictive for insert to authenticated\n" +
      "  with check (coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2');",
      "create policy devices_insert_requires_aal2 on public.devices\n" +
      "  as restrictive for insert to authenticated\n  with check (true);",
    ));
  assertReports(problems, "public.devices: INSERT is not restricted to aal2");
});

test("catches the devices row-local gate replaced by something that gates nothing", () => {
  // `devices` is the one table exempt from the shared predicate — it cannot call a
  // function that reads itself without 42P17 — so its replacement is asserted
  // nowhere else. Without the rule, `as restrictive … using (true)` satisfies
  // „the table has a restrictive gate".
  // Both `session_id` branches removed and nothing else touched: the policy keeps
  // its name, keeps `as restrictive for all`, and keeps the word `aal2` on the
  // USING side, so every coarser rule still passes. What is gone is the half that
  // confines an aal1 desktop to its own row.
  const problems = auditWithMutation(RLS, (sql) =>
    sql.replace(
      "    or (session_id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid\n" +
      "        and revoked_at is null)\n" +
      "  )\n" +
      "  with check (\n" +
      "    coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'\n" +
      "    or session_id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid\n" +
      "  );",
      "    or true\n  )\n  with check (true);",
    ));
  assertReports(problems, "restrictive gate is not the row-local session predicate");
});

test("catches a column-scoped write grant widened to the whole table", () => {
  // The regression with no visible symptom: policies unchanged, constraints
  // unchanged, every isolation test still green — and the client now writes
  // `platform`, `seq`, `consumed_at` and the rest of the columns other rules
  // treat as facts.
  const problems = auditWithMutation(RLS, (sql) =>
    sql.replace(
      "grant update (name_nonce, name_ciphertext, public_key, last_seen_at, revoked_at)\n" +
      "  on public.devices to authenticated;",
      "grant update on public.devices to authenticated;",
    ));
  assertReports(problems, "`grant update` to authenticated is table-level");
});

test("catches one forbidden column slipped into a write grant", () => {
  // The narrower version of the same defect, and the likelier one: not a rewrite,
  // an addition. `platform` is the only column that could ever distinguish a
  // browser from a desktop, so a client that can write it can call itself either.
  const problems = auditWithMutation(RLS, (sql) =>
    sql.replace(
      "grant insert (user_id, session_id, name_nonce, name_ciphertext, public_key)",
      "grant insert (user_id, session_id, platform, name_nonce, name_ciphertext, public_key)",
    ));
  assertReports(problems, "public.devices.platform: granted INSERT to authenticated");
});

test("catches the sync_objects guard no longer covering INSERT", () => {
  // It guarded UPDATE only, on the reasoning that a first version was bounded by
  // the range CHECK — which bounds it at 2^53-1, the exact number the step rule
  // exists to refuse. An object could be created already frozen.
  const problems = auditWithMutation(TRIGGER, (sql) =>
    sql.replace("before insert or update on public.sync_objects",
      "before update on public.sync_objects"));
  assertReports(problems, "no BEFORE INSERT OR UPDATE guard trigger");
});

test("catches the guard trigger going missing", () => {
  const problems = auditWithMutation(TRIGGER, (sql) =>
    sql.replace("before insert or update on public.sync_objects",
      "before insert on public.sync_objects"));
  assertReports(problems, "no BEFORE INSERT OR UPDATE guard trigger");
});

test("catches the key_wraps guard going missing", () => {
  const problems = auditWithMutation(KEY_WRAPS, (sql) =>
    sql.replace("before update on public.key_wraps", "before delete on public.key_wraps"));
  assertReports(problems, "public.key_wraps: no BEFORE UPDATE guard trigger");
});

test("catches the devices guard going missing", () => {
  // Without it `revoked_at` is a timestamp any aal2 session can clear, and since
  // revoking a device does not end the GoTrue session — the refresh token in that
  // client's hands still works — clearing it hands the machine back.
  const problems = auditWithMutation(DEVICES, (sql) =>
    sql.replace("before update on public.devices", "before delete on public.devices"));
  assertReports(problems, "public.devices: no BEFORE UPDATE guard trigger");
});

test("catches a function with a mutable search_path", () => {
  const problems = auditWithMutation(RLS, (sql) =>
    sql.replace("set search_path = ''\nas $$\n  select\n    coalesce", "as $$\n  select\n    coalesce"));
  assertReports(problems, "no `set search_path`");
});

test("catches storage.objects or realtime.messages left on stock settings", () => {
  const problems = auditWithMutation(STORAGE, (sql) =>
    sql.replace("execute 'alter table realtime.messages force row level security';", ""));
  assertReports(problems, "realtime.messages: migrations never FORCE");
});

test("catches a policy added to a private-schema table", () => {
  // `private.pair_rate_limit` is walled by having RLS forced and NO policy, so
  // only a BYPASSRLS role reaches it. A „helpful" policy is a hole.
  const problems = auditWithMutation(RLS, (sql) =>
    sql.replace(
      "revoke all on private.pair_rate_limit from public;",
      "create policy oops on private.pair_rate_limit for select to authenticated using (true);\n" +
      "revoke all on private.pair_rate_limit from public;",
    ));
  assertReports(problems, "must have NO policy at all");
});

// ---------------------------------------------------------------------------
// The pgTAP plans, checked from here because the day a count drifts is exactly
// the day nobody has a Postgres running.
// ---------------------------------------------------------------------------

test("every pgTAP file's plan matches its assertion count", () => {
  const problems = auditTestPlans(join(SUPABASE_ROOT, "tests", "database"));
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("catches a pgTAP assertion deleted without lowering the plan", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-tap-"));
  try {
    cpSync(join(SUPABASE_ROOT, "tests", "database"), join(dir, "database"), { recursive: true });
    const path = join(dir, "database", "02_guard_trigger.test.sql");
    const before = readFileSync(path, "utf8");
    const after = before.replace(
      /select throws_ok\(\s*\$\$ update public\.sync_objects set collection = 'notes'[\s\S]*?\);\n/,
      "",
    );
    assert.notEqual(after, before, "mutation matched nothing — the test has drifted");
    writeFileSync(path, after);
    const problems = auditTestPlans(join(dir, "database"));
    // THE EXPECTED NUMBERS ARE DERIVED, NOT WRITTEN DOWN. This assertion used to
    // read `plan(19) but 18 assertions`, which made a meta-test of the audit tool
    // fail every time a real assertion was added to the suite it audits — and the
    // repair for that failure is to edit this line, which is precisely how a
    // guard stops guarding. The claim being made is „removing one assertion is
    // reported", and that is what the arithmetic below says.
    const planned = Number(/select plan\((\d+)\)/.exec(before)?.[1]);
    assert.ok(Number.isInteger(planned), "02_guard_trigger.test.sql has no plan()");
    assertReports(problems, `plan(${planned}) but ${planned - 1} assertions`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("catches a pgTAP file that would leave its fixtures behind", () => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-tap-"));
  try {
    cpSync(join(SUPABASE_ROOT, "tests", "database"), join(dir, "database"), { recursive: true });
    const path = join(dir, "database", "01_two_users.test.sql");
    const before = readFileSync(path, "utf8");
    // These seed `auth.users` and write real rows; committing them would mutate
    // whatever database the suite was pointed at.
    const after = before.replace(/\nrollback;\n/, "\ncommit;\n");
    assert.notEqual(after, before, "mutation matched nothing — the test has drifted");
    writeFileSync(path, after);
    assertReports(auditTestPlans(join(dir, "database")), "does not ROLLBACK");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("catches a real credential committed anywhere under supabase/", () => {
  // ASSEMBLED FROM PIECES, NEVER WRITTEN OUT. The first version of this test
  // pasted a JWT-shaped literal into the fixture, and the secret scanner —
  // correctly — flagged this very file, so the audit of the real tree went red.
  // The wrong fix is an allowlist: a secret scanner with an exemption mechanism
  // is a secret scanner that will one day be pointed at a real key. The right
  // fix is that the literal never exists on disk.
  const jwtShaped = ["ey", "JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "0123456789ab"].join("");
  const problems = auditWithMutation(CORE, (sql) => `${sql}\n-- ${jwtShaped}\n`);
  assertReports(problems, "looks like a real JSON Web Token");
});
