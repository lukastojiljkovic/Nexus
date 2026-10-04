-- Nexus sync — migration 014: the housekeeping job schedules itself.
--
-- WHY THIS IS A MIGRATION AND NOT A DASHBOARD STEP.
-- `public.nexus_sync_housekeeping()` reaps spent pairing rows and stale
-- rate-limit windows. Until this file it was scheduled BY HAND, with the SQL
-- pasted from `supabase/README.md` §5 step 7 — which meant the one job that
-- keeps `private.pair_rate_limit` from growing forever existed as a sentence in
-- a document. A deployment that followed the document and skipped the sentence
-- still had a working wall and a table that grew one row per caller address
-- forever, and nothing anywhere said so. A schedule the schema depends on
-- belongs in the schema.
--
-- THE FUNCTION IS UNCHANGED AND STILL TOUCHES NOTHING THAT MATTERS. Its header
-- (migration 005) argues why a DELETE is correct here and nowhere else: a spent
-- `pairing` row is protocol scratch space with a ten-minute life, not replicated
-- user state. The job grants it nothing it did not already have, and the drift
-- guard still asserts that it cannot reach `sync_objects`, `key_wraps` or
-- `devices`.
--
-- IDEMPOTENT BY CONSTRUCTION. `cron.schedule` with a name that already exists
-- raises in some pg_cron versions and replaces the job in others, so this file
-- unschedules by name first and then schedules. Re-running the migration, or a
-- fresh `db reset`, converges on the same single job instead of accumulating
-- copies that each run the function hourly.
--
-- THE EXTENSION IS CREATED IF IT CAN BE, AND THE MIGRATION SUCCEEDS IF IT
-- CANNOT. On a hosted project `pg_cron` must be enabled into the `postgres`
-- database with a `shared_preload_libraries` entry — the dashboard does that
-- when the extension is toggled on, and a migration role that cannot do it must
-- not abort the entire deploy over a scheduled job. Both blocks therefore fail
-- SOFT and say, in the warning, exactly what a human has to do; the next
-- `supabase db push` schedules the job once the extension exists.

-- No `begin;`/`commit;` — the CLI wraps each migration file in a transaction of
-- its own; migration 001's header has the full reasoning.

-- ---------------------------------------------------------------------------
-- Make the extension available, if this project can.
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'create extension if not exists pg_cron';
exception
  when insufficient_privilege or feature_not_supported or undefined_file
    or invalid_schema_name or duplicate_object then
    raise warning
      'Nexus: pg_cron could not be created (%). Enable the pg_cron extension '
      'from the Supabase dashboard (Database -> Extensions) and re-run '
      '`supabase db push`; the sync housekeeping job is NOT scheduled until '
      'then.', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- Schedule it, idempotently.
-- ---------------------------------------------------------------------------
-- `cron` is resolved at RUN time and the block returns early when the schema is
-- absent, so a project without pg_cron runs this file to completion with one
-- warning rather than a parse error about a schema that does not exist.
do $$
begin
  if to_regnamespace('cron') is null then
    raise warning
      'Nexus: pg_cron is not installed, so the sync housekeeping job was not '
      'scheduled. See the warning above; the job is the only thing that bounds '
      'private.pair_rate_limit.';
    return;
  end if;

  begin
    perform cron.unschedule('nexus-sync-housekeeping');
  exception when others then
    -- No job of that name yet, or a pg_cron version whose unschedule raises
    -- instead of returning. Both mean the same thing here: nothing to replace.
    null;
  end;

  perform cron.schedule(
    'nexus-sync-housekeeping',
    '0 * * * *',
    'select public.nexus_sync_housekeeping()'
  );
end;
$$;
