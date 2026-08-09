-- Nexus sync — migration 001: the five tables the server is allowed to hold,
-- and one private schema it holds its own bookkeeping in.
--
-- THE ASSUMPTION THIS FILE IS WRITTEN UNDER. The server is hostile. It holds
-- ciphertext and metadata; it never holds a key that opens anything. Every
-- design choice below follows from that one sentence, and the parts that do NOT
-- follow from it — the metadata that stays in the clear — are the conceded risk.
-- That concession is not recorded in a document somebody has to find. It is
-- recorded as a `comment on column` on EVERY column of every table here, in the
-- database itself, so that `\d+ public.sync_objects` answers „what does the
-- operator of this box learn about me" without a single file being opened.
-- `supabase/scripts/check-rls-wall.mjs` fails if a column is ever added without
-- one, because the moment a column can be added silently the whole disclosure is
-- a snapshot of one afternoon in 2026 rather than a property of the schema.
--
-- WHY THERE IS NO `profiles` TABLE. A profile is a local object with a local
-- name („Posao", „Fakultet"). The server learns that a `profile_id` exists and
-- roughly how busy it is; it never learns what it is called, and there is
-- nothing here for it to learn that from. A profile the user marks local-only is
-- enforced one layer up, in `key_wraps`: its content key is simply never wrapped
-- under MK, so „this profile stays on my computer" is the absence of a row
-- rather than the value of a flag. A flag can be flipped by whoever holds the
-- database. A row that was never written cannot be un-written into existence.
--
-- WHY EVERYTHING CASCADES FROM `auth.users`. Account deletion has to take the
-- ciphertext with it, and it has to do so without any application code running —
-- if „delete my account" depends on a client finishing a loop, then a client
-- that crashes half-way leaves ciphertext behind that the user believes is gone.
-- `on delete cascade` makes erasure a property of the FK graph.

-- NO EXPLICIT `begin;` / `commit;` IN THIS FILE, OR IN ANY MIGRATION HERE.
-- The Supabase CLI already applies each migration file inside its own
-- transaction and then records it in `supabase_migrations.schema_migrations`
-- within that same transaction. A `begin;` here is a no-op that warns („there is
-- already a transaction in progress"), and the matching `commit;` ends the
-- RUNNER's transaction rather than one of ours — after which the row recording
-- this migration is written outside the transaction that applied it, and a
-- failure in a later statement leaves a half-applied migration marked as done.
-- Atomicity is the runner's job and it already does it.

-- ---------------------------------------------------------------------------
-- The private schema.
-- ---------------------------------------------------------------------------
-- Two things live here and nothing else: the session-liveness helper that the
-- RLS policies call, and the Edge Function's rate-limit counters. Neither is a
-- user-facing resource, and both are dangerous to expose — the first is the wall
-- itself, the second is a denial-of-service lever (empty somebody's bucket and
-- their pairing stops working).
--
-- `private` is deliberately NOT listed in `[api].schemas` in `config.toml`, so
-- PostgREST will not route to it at all. That is the primary defence; the
-- grants below are the second, because a schema list is one careless edit away
-- from including this one and a REVOKE is not.
create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
-- `authenticated` needs USAGE and nothing else: the RLS policies call a function
-- in here, and a policy is evaluated with the invoker's privileges, so without
-- USAGE every policy on every table would fail closed with „permission denied
-- for schema private" — which is at least loud, but it is loud in production.
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- sync_objects — every synchronised row of every module, as one opaque blob.
-- ---------------------------------------------------------------------------
-- ONE TABLE, NOT FOURTEEN. The desktop has sixty-one migrations' worth of
-- tables; none of their shapes appear here, because a per-module table on the
-- server would publish the product's data model to whoever runs the box, and
-- every new module would need a new migration, a new set of policies and a new
-- chance to forget one. The collection name is the only structure that crosses
-- the wire, and it is coarse (`tasks`, `notes`, `fin_tx`) rather than a column
-- list.
--
-- AN OBJECT ID IS TEXT, AND IT IS ONLY UNIQUE INSIDE ITS PROFILE AND
-- COLLECTION. This column was `uuid` and the primary key was `(user_id,
-- object_id)`, and both were wrong against the client's actual identity model
-- (ADR-082, checked against the real primary keys by
-- `packages/db/src/sync/collectionGuard.test.ts`). An object id is the row's
-- primary key MINUS `profile_id`, which is a uuid for most collections but is
-- also: a natural key (`feature_flags` → `'task'`, `fit_measurements` →
-- `'2026-08-09'`), a composite joined by U+001F (`note_updates` → the note's id,
-- the separator, the sequence number), and — for the six per-profile singletons
-- — THE EMPTY STRING, which is the honest spelling of „this collection holds
-- exactly one object per profile".
--
-- Both errors were silent in the same direction. `uuid` would have rejected five
-- collections outright, and `(user_id, object_id)` would have collided the
-- moment two profiles each had a `calendar_settings` (id `''`) or a
-- `fit_measurements` for the same day: one profile's settings overwriting
-- another's, with the version counter making it look like an ordinary edit.
--
-- `parent_id` IS NOT A FOREIGN KEY, deliberately. It would have to be
-- `foreign key (user_id, profile_id, collection, parent_id) references
-- sync_objects (user_id, profile_id, collection, object_id)` — which does not
-- even typecheck as an idea, since a child's parent is in a DIFFERENT
-- collection — and it would be wrong twice over besides. Sync arrives out of
-- order — a child pulled in the same batch as its parent has a 50 % chance of
-- being applied first — so the constraint would reject perfectly correct traffic
-- and the client would have to topologically sort a batch it cannot read. And a
-- tombstoned parent must NOT take its children with it: deletion is a tombstone
-- that replicates, not a cascade that runs on one machine. The column exists so
-- the server can answer „give me this note's blocks" in one round trip; it is a
-- hint, and the client re-derives the tree from plaintext it alone can read.
create table public.sync_objects (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  profile_id  uuid        not null,
  collection  text        not null,
  object_id   text        not null,
  parent_id   text,
  version     bigint      not null,
  deleted     boolean     not null default false,
  -- WHICH CONTENT KEY SEALED THIS ROW. In the clear, and bound into the row's
  -- AEAD associated data, which is the whole reason it exists.
  --
  -- Rotation is this product's revocation path: `key_wraps.disabled_at` stops
  -- the next hand-out, but a browser that already holds CK_p still holds it, so
  -- actually locking it out means minting a new content key and re-encrypting
  -- the profile. During that pass both keys are live, and without an epoch a
  -- client meeting a row has to TRIAL-DECRYPT under CK_old and then CK_new —
  -- which is the one thing a non-committing AEAD makes genuinely dangerous, and
  -- which leaves a half-finished rotation undiagnosable because nothing in the
  -- database says which rows have been done.
  --
  -- With the epoch bound into the AAD, a row is openable only under the key it
  -- claims: trialling disappears, cross-epoch confusion is unrepresentable, a
  -- row that was re-wrapped but not re-encrypted fails loudly instead of
  -- quietly, and „what is left to rotate" is `where ck_epoch = <old>`. It costs
  -- two bytes and no ciphertext overhead, which is why it is here rather than a
  -- 16-byte per-row commitment tag.
  ck_epoch    smallint    not null default 1,
  nonce       bytea       not null,
  ciphertext  bytea       not null,
  -- `seq` is the pull cursor, and it is NOT in the original column list because
  -- the original column list cannot be pulled from correctly. `updated_at`
  -- looks like a cursor and is not one: two transactions can stamp `now()` in
  -- one order and commit in the other, so a puller that reads „everything after
  -- my last `updated_at`" can step over a row that was stamped before its
  -- watermark and committed after it, and that row is then never seen again.
  -- An identity column has the identical hazard (the value is assigned before
  -- commit), which is why the fix is not the column but the read: the client
  -- re-pulls with a small overlap behind its watermark and applies the result.
  -- That is free, because applying a row twice is a no-op under last-write-wins
  -- — the second apply loses to itself. The overlap costs bandwidth; the
  -- alternative costs a row.
  --
  -- GENERATED ALWAYS, not BY DEFAULT: `by default` lets a client name its own
  -- value outright, and `always` still lets one through `overriding system
  -- value`. Neither is reachable here, because the column-level grants below
  -- never give `authenticated` insert or update on this column at all.
  seq         bigint      not null generated always as identity,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- ALL FOUR COLUMNS, because an object id identifies an object only inside its
  -- profile and its collection — see the header. This is also, incidentally, the
  -- exact tuple the row's AEAD associated data binds, so the key of the row and
  -- the identity the ciphertext commits to are the same four values by
  -- construction rather than by two files agreeing.
  primary key (user_id, profile_id, collection, object_id),

  -- The version ceiling is 2^53-1, not 2^63-1, and the reason is the client
  -- rather than the database. Every client here is JavaScript; `JSON.parse`
  -- turns a bigint over 2^53 into a `number` that is silently NOT the value
  -- that was sent, so an object that reached 2^53 would start comparing wrong
  -- in the LWW merge rather than failing. PostgREST can be asked for strings,
  -- but „every caller remembered to ask" is not a guarantee — a ceiling is.
  -- The trigger in migration 003 enforces the step; this enforces the range,
  -- including on INSERT, which the trigger deliberately does not police.
  constraint sync_objects_version_range
    check (version >= 1 and version <= 9007199254740991),

  -- 24 bytes, so the AEAD is XChaCha20-Poly1305 and not AES-256-GCM. A 96-bit
  -- random nonce collides with probability ~2^-32 after 2^32 messages, and a
  -- sync log over a lifetime of edits is precisely the workload that walks
  -- towards that number; a 192-bit random nonce does not have a birthday bound
  -- worth writing down. Pinning the LENGTH here is what makes the choice
  -- structural instead of a convention a future client can quietly drop.
  constraint sync_objects_nonce_len check (octet_length(nonce) = 24),

  -- Floor 17 = one byte of plaintext plus a 16-byte Poly1305 tag; anything
  -- shorter cannot be an authenticated ciphertext and is a client bug or a
  -- probe. Ceiling 4 MiB stops this table being used as free blob storage:
  -- attachments belong in `storage.objects`, which has its own quota and its
  -- own wall, and a 200 MB row here would sail past both.
  constraint sync_objects_ciphertext_len
    check (octet_length(ciphertext) between 17 and 4194304),

  -- The collection name is the one piece of application structure in the clear,
  -- so it is constrained to a shape rather than left as free text: a lowercase
  -- identifier, at most 64 characters. Free text here is an injection surface
  -- for anything that ever builds a channel name or a file path out of it, and
  -- a place to smuggle a payload into a column the server is allowed to read.
  constraint sync_objects_collection_shape
    check (collection ~ '^[a-z][a-z0-9_]{0,63}$'),

  -- A CEILING, AND NO FLOOR. The longest real id is a `note_updates` composite —
  -- a 36-character uuid, one separator and a sequence number — so 255 is roughly
  -- three times the largest thing the client can produce, which is the right
  -- amount of room for a key whose only job is to be an identifier. The absence
  -- of a floor is the deliberate half: `''` is the object id of all six
  -- per-profile singletons, and a `length > 0` check here would reject
  -- `calendar_settings` forever. Postgres `text` cannot hold a NUL byte, so the
  -- one genuinely dangerous character is already unrepresentable.
  constraint sync_objects_object_id_len check (octet_length(object_id) <= 255),

  -- A parent is a real object of a real collection, so unlike `object_id` it may
  -- not be empty: „hangs off the object with no id" names nothing.
  constraint sync_objects_parent_id_len
    check (parent_id is null or octet_length(parent_id) between 1 and 255),

  -- Epochs start at 1 and only ever go up. The ceiling is smallint's, which is
  -- 32 767 rotations of one profile's content key — a number no user reaches,
  -- and one that keeps the column two bytes.
  constraint sync_objects_ck_epoch_range check (ck_epoch >= 1)
);

comment on table public.sync_objects is
  'Encrypted per-object rows for every module. Server sees ciphertext plus the '
  'metadata documented on each column.';

comment on column public.sync_objects.user_id is
  'LEAKS: which account a row belongs to. Unavoidable — it is the tenancy key '
  'every RLS policy here is written against.';
comment on column public.sync_objects.profile_id is
  'LEAKS: that N distinct profiles exist and how much traffic each carries. '
  'Never leaks a profile name; the server has no table that holds one.';
comment on column public.sync_objects.collection is
  'LEAKS: which module a row belongs to (tasks/notes/fin_tx/...), and therefore '
  'which modules the user uses and how heavily. Conceded: it is the routing key '
  'for pulls and part of the AEAD associated data, so it cannot be encrypted.';
comment on column public.sync_objects.object_id is
  'LEAKS: a stable per-object identifier, so the server can count objects and '
  'watch one object change over time. For five collections it is a natural key '
  '(a module name, a date), which leaks slightly more than a uuid would; for '
  'the six per-profile singletons it is the empty string. Client-minted; never '
  'derived from content. Unique only within (user_id, profile_id, collection).';
comment on column public.sync_objects.parent_id is
  'LEAKS: the SHAPE of the object graph (which rows hang off which) without any '
  'of its content. A hint for batched reads, not a foreign key — see the header.';
comment on column public.sync_objects.ck_epoch is
  'LEAKS: how many times this profile''s content key has been rotated, and '
  'which rows are still on an older one — i.e. that a rotation is in progress '
  'and how far it has got. Conceded: it is bound into the AEAD associated data '
  'so a client never has to trial-decrypt under two keys, which is the point.';
comment on column public.sync_objects.version is
  'LEAKS: how many times an object has been edited. Also the optimistic-'
  'concurrency counter and part of the AEAD associated data, so a server cannot '
  'replay an older ciphertext under a newer version.';
comment on column public.sync_objects.deleted is
  'LEAKS: that an object was deleted, and when. Bound into the AEAD associated '
  'data so the server cannot strip a tombstone and resurrect the old ciphertext.';
comment on column public.sync_objects.nonce is
  'LEAKS: nothing. 24 fresh random bytes for EVERY version — the guard trigger '
  'refuses an update that reuses the previous one (NX005). Reuse under one key '
  'is keystream reuse plus Poly1305 one-time-key reuse, i.e. both the plaintext '
  'and the forging capability, and the AAD cannot help: it feeds the tag only.';
comment on column public.sync_objects.ciphertext is
  'LEAKS: the approximate SIZE of the plaintext, and nothing else. Padding is a '
  'client decision; the server cannot add it without being able to remove it.';
comment on column public.sync_objects.seq is
  'LEAKS: the total ordering of writes across all users of this instance, i.e. '
  'instance-wide write volume. Server-assigned; clients can neither read a '
  'meaning into it nor write it (no column grant).';
comment on column public.sync_objects.created_at is
  'LEAKS: when an object first reached the server. Server clock, not the '
  'client''s — a client timestamp would be both a lie surface and a fingerprint.';
comment on column public.sync_objects.updated_at is
  'LEAKS: when an object last changed on the server. Set by the guard trigger, '
  'never by the client (no column grant), so it is a fact about the server.';

-- The only pull there is: „this profile's rows in this collection, after cursor
-- N". `seq` last, because the first three are equality predicates and the
-- fourth is the range scan.
create index sync_objects_pull
  on public.sync_objects (user_id, profile_id, collection, seq);

-- The initial hydration of a device that has just paired: everything, in cursor
-- order, without naming a profile. Distinct from the index above because that
-- one cannot serve a query with no equality on `profile_id`.
create index sync_objects_user_seq on public.sync_objects (user_id, seq);

-- The batched-children read `parent_id` exists for. Partial, because the vast
-- majority of rows are roots and indexing their NULLs buys nothing — and scoped
-- by `profile_id`, because a parent id is only unique inside its profile, so
-- without it the „give me this note's blocks" read would answer with the blocks
-- of a same-id object in a different profile.
create index sync_objects_children
  on public.sync_objects (user_id, profile_id, parent_id)
  where parent_id is not null;

-- A UNIQUE INDEX THAT IS A CRYPTOGRAPHIC CONTROL, NOT A PERFORMANCE ONE.
--
-- The scope is exactly the scope over which a repeated nonce is a break: one
-- content key seals one profile at one epoch, so `(user_id, profile_id,
-- ck_epoch, nonce)` is the tuple that must not repeat. A nonce reused across
-- two DIFFERENT epochs is harmless — different key — and this correctly permits
-- it, which a coarser index would not.
--
-- WHAT IT CATCHES THAT THE TRIGGER CANNOT. Migration 003's NX005 rule compares a
-- row's new nonce against the one it is replacing, and that is one row deep: it
-- sees a client that re-sent the nonce it just parsed, and nothing else. The
-- dangerous real failure is a broken generator — a `randomBytes` returning
-- zeros, a test double reaching a production build, a counter that resets after
-- a reinstall — and that repeats ACROSS rows, where NX005 never looks. Two
-- different objects sealed under one key at one nonce is the identical break as
-- one object sealed twice: the keystream is a function of (key, nonce) alone,
-- so their ciphertexts XOR to the XOR of their plaintexts, and the repeated
-- Poly1305 one-time key forges either.
--
-- Neither mechanism proves global uniqueness, and this one cannot: the table
-- holds only each row's CURRENT nonce, so history is structurally unavailable.
-- What it converts is „we hope clients draw fresh bytes" into „a client that
-- does not stops working on its second row", which is the strongest statement
-- available to a server that holds no key.
create unique index sync_objects_nonce_unique
  on public.sync_objects (user_id, profile_id, ck_epoch, nonce);

-- ---------------------------------------------------------------------------
-- key_wraps — the key hierarchy, as ciphertext.
-- ---------------------------------------------------------------------------
-- WHAT THIS TABLE IS FOR, IN ONE LINE: it lets a user who still knows a secret
-- (the web password, or the sync recovery code) get back a key they never had
-- to remember, and it lets the desktop hand a browser exactly one profile's
-- content key without handing over the master key.
--
-- THE LOCAL-ONLY GUARANTEE LIVES HERE, AND IT LIVES AS AN ABSENCE. A profile is
-- web-enabled if and only if there is a `ck_under_mk` row for it. Marking a
-- profile local-only is not a column being set to false anywhere — it is this
-- row never being written. Whoever holds this database can flip any boolean in
-- it; they cannot conjure a wrap of a key they have never seen.
--
-- WHAT THIS TABLE CANNOT ENFORCE, stated plainly because the README repeats it:
-- the rule „MK must never enter a browser" is a CLIENT rule. Nothing in a JWT
-- distinguishes a browser from a desktop — both are HTTP clients with a bearer
-- token — so RLS cannot express it. What the server enforces is that the MK
-- wraps are useless without a secret the server does not hold; what the web
-- client enforces is that it never asks for them.
create table public.key_wraps (
  id          uuid        not null default gen_random_uuid() primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  kind        text        not null,
  profile_id  uuid,
  -- WHICH GENERATION OF THE CONTENT KEY THIS WRAP HOLDS, and the reason this
  -- table has more than one row per profile at all.
  --
  -- `sync_objects.ck_epoch` exists precisely so that two generations can be live
  -- at once: a rotation re-encrypts a profile row by row, and until it finishes
  -- the account holds rows on both. Without this column the slot key was
  -- `(user_id, kind, profile_id)` — exactly ONE `ck_under_mk` per profile — so
  -- storing CK at epoch 2 REPLACED CK at epoch 1, and every row the rotation had
  -- not reached yet became permanently unopenable by every device. A rotation
  -- that was interrupted, or merely slow, destroyed the data it was protecting.
  -- The epoch turns a replacement into an append.
  --
  -- Null for the two `mk_*` slots, and that is not a spare field left empty: the
  -- master key is not rotated by this mechanism, and a number sitting there would
  -- imply a generation that nothing mints and nothing reads.
  --
  -- IT MUST ALSO BE IN THE CLIENT'S ASSOCIATED DATA, like `kind` and
  -- `profile_id` and for the same reason — see the AAD note under this table. A
  -- wrap moved between epochs still opens under MK and yields the WRONG content
  -- key for the epoch it now claims, which the client cannot detect from the
  -- bytes.
  epoch       smallint,
  nonce       bytea       not null,
  wrapped     bytea       not null,
  -- THE KEY-COMMITMENT TAG, AND IT HAS TO BE A COLUMN OF ITS OWN.
  --
  -- `wrap.ts` derives two subkeys from the KEK — one to encrypt with, one that
  -- IS this tag — and refuses to attempt the AEAD at all unless the tag it
  -- recomputes matches. That is what makes a wrong password answer „wrong
  -- password" instead of handing back a key-shaped 32 bytes that decrypt
  -- garbage, and it is what closes the partitioning-oracle family of attacks
  -- against the two password-derived slots.
  --
  -- The client produced this tag from the first commit and the schema had
  -- nowhere to put it, which is a quiet way to lose a defence: a transport that
  -- maps `SealedKey` onto `(nonce, wrapped)` simply drops the field, key-
  -- committing wrapping silently becomes ordinary wrapping, and every test still
  -- passes because the client checks the tag against the tag it just derived.
  -- NOT NULL is the whole fix — a wrap that arrives without one cannot be
  -- stored.
  commit_tag  bytea       not null,
  kdf_salt    bytea,
  kdf_params  jsonb,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz,
  -- Retiring a wrap without deleting a row. No table here has a DELETE policy
  -- (migration 002 explains why), so „stop web-enabling this profile" has to be
  -- representable as an UPDATE or it is not representable at all. Read the
  -- honest limit with it: a browser that ALREADY received this content key
  -- still holds it, so setting this column is not revocation on its own — the
  -- content key must be rotated and the profile's rows re-encrypted under the
  -- new one. This column records intent and stops the next hand-out; it does
  -- not reach into a machine that already has the key. The local-only
  -- guarantee is unaffected, because that one is still the absence of the row.
  disabled_at timestamptz,

  constraint key_wraps_kind
    check (kind in ('mk_under_kwrap', 'mk_under_src', 'ck_under_mk')),

  -- A content-key wrap without a profile is meaningless, and a master-key wrap
  -- WITH one is a category error that would make the local-only guarantee
  -- ambiguous — „is this profile web-enabled?" must have exactly one answer, and
  -- an `mk_*` row carrying a stray `profile_id` would give it a second one.
  constraint key_wraps_profile_presence check (
    (kind = 'ck_under_mk' and profile_id is not null)
    or (kind <> 'ck_under_mk' and profile_id is null)
  ),

  -- The epoch travels with `profile_id` and is bound by the same argument: a
  -- content-key wrap belongs to one generation of one profile, and a master-key
  -- wrap belongs to no generation at all. Written as its own constraint rather
  -- than folded into the one above so a failure names which half is wrong.
  --
  -- The ceiling matches `sync_objects_ck_epoch_range`: both are `smallint`, and
  -- a wrap at an epoch no row could ever carry is a wrap for nothing.
  constraint key_wraps_epoch_presence check (
    (kind = 'ck_under_mk' and epoch is not null and epoch >= 1)
    or (kind <> 'ck_under_mk' and epoch is null)
  ),

  -- 24 bytes here for the same reason as `sync_objects`, and this one is a
  -- DECISION rather than an inherited constant. `key_wraps` sees O(devices ×
  -- rotations) seals — a few dozen in an account's life — so a 96-bit nonce
  -- would have been statistically fine here. It is 24 anyway because one AEAD
  -- means one code path, one set of test vectors and one thing to get right, and
  -- because a schema in which two tables pin two nonce widths invites a client
  -- to pick the wrong one. Uniformity, stated, not uniformity by copy-paste.
  constraint key_wraps_nonce_len check (octet_length(nonce) = 24),
  -- EXACTLY 48: a 32-byte key plus a 16-byte Poly1305 tag. Every wrap in this
  -- table seals one symmetric key and nothing else, so a range would only be
  -- room for something that is not a wrapped key.
  constraint key_wraps_wrapped_len check (octet_length(wrapped) = 48),
  constraint key_wraps_commit_tag_len check (octet_length(commit_tag) = 32),
  -- A password-derived wrap MUST carry its salt and its Argon2id parameters,
  -- or the client cannot reproduce the key and the wrap is a brick. An
  -- MK-under-MK wrap must not, because there is no password in that path and a
  -- salt sitting there would imply one.
  constraint key_wraps_kdf_presence check (
    (kind in ('mk_under_kwrap', 'mk_under_src')
      and kdf_salt is not null and octet_length(kdf_salt) = 16
      and kdf_params is not null)
    or (kind = 'ck_under_mk' and kdf_salt is null and kdf_params is null)
  ),

  -- THE COST PARAMETERS HAVE A FLOOR, because they are the only thing standing
  -- between „somebody has this database" and „somebody has this account".
  --
  -- `kdf_params` is client-written, and a client that wrote `{"memoryKiB": 8,
  -- "iterations": 1, "parallelism": 1}` would produce a wrap that opens under a
  -- dictionary attack at a few million guesses a second. That client would be a
  -- bug or a downgrade — and the user would never know, because the wrap works
  -- perfectly. The floor is RFC 9106's SECOND recommended configuration (64 MiB,
  -- t=3, p=4), which is the one meant for memory-constrained environments and
  -- is therefore the lowest setting this product can call defensible on a
  -- laptop. Raising the real parameters later is unaffected: they are recorded
  -- per row precisely so they can go UP without locking anyone out.
  --
  -- The shape is checked as well as the values, because `kdf_params` is `jsonb`
  -- and a missing key compares as NULL, which is neither true nor false — so
  -- without the `?` existence tests a params object with no `iterations` at all
  -- would pass a `>=` check by being unknown rather than by being large enough.
  constraint key_wraps_kdf_params_floor check (
    kdf_params is null
    or (
      jsonb_typeof(kdf_params) = 'object'
      and kdf_params ? 'memoryKiB' and kdf_params ? 'iterations'
      and kdf_params ? 'parallelism'
      and jsonb_typeof(kdf_params -> 'memoryKiB') = 'number'
      and jsonb_typeof(kdf_params -> 'iterations') = 'number'
      and jsonb_typeof(kdf_params -> 'parallelism') = 'number'
      and (kdf_params ->> 'memoryKiB')::numeric >= 65536
      and (kdf_params ->> 'iterations')::numeric >= 3
      and (kdf_params ->> 'parallelism')::numeric >= 1
    )
  )
);

-- NULLS NOT DISTINCT is the load-bearing word. Without it the two MK rows have
-- `profile_id = null`, every NULL is distinct from every other, and the unique
-- index silently permits a SECOND master-key wrap per user — at which point
-- „which one is current" is a question the schema no longer answers and a
-- rotation that half-failed is indistinguishable from one that succeeded.
-- `epoch` is part of the slot, so one profile holds one wrap PER GENERATION and
-- a rotation appends rather than overwrites. The two `mk_*` slots carry a null
-- epoch and are still one-per-user, which is what `nulls not distinct` keeps
-- true across both of the nullable columns at once.
create unique index key_wraps_one_per_slot
  on public.key_wraps (user_id, kind, profile_id, epoch) nulls not distinct;

comment on table public.key_wraps is
  'Wrapped keys. Every row is opaque; the server holds no unwrapping secret. '
  'AEAD associated data MUST bind "nexus/sync/key-wrap/v2" || user_id || kind || '
  'coalesce(profile_id, '''') || epoch, or a wrap can be moved between slots — '
  'including between epochs of one profile, which yields the wrong content key '
  'for the generation it claims.';

-- THE AAD REQUIREMENT ABOVE IS NOT DECORATION, and it is the one rule in this
-- table the database cannot enforce for itself. Without `profile_id` inside the
-- associated data, a `ck_under_mk` row re-pointed from profile P1 to profile P2
-- still opens cleanly under MK — it just yields the WRONG content key, and the
-- client has no way to notice. Two consequences follow, and the second is the
-- serious one. A client would encrypt P2's rows under CK_P1; and „this profile
-- stays on my computer", which is supposed to be the ABSENCE of a row, would be
-- one UPDATE away from being present. Migration 002 withholds the UPDATE grant on
-- `kind` and `profile_id` so no client can perform that move, and the trigger in
-- migration 003 refuses it on the paths that have privileges — but the party this
-- design calls hostile owns the database and needs neither. Only the AAD reaches
-- that far, which is why it is stated in the schema rather than in a client.

comment on column public.key_wraps.id is
  'LEAKS: nothing. Random surrogate key.';
comment on column public.key_wraps.user_id is
  'LEAKS: which account the wrap belongs to. The tenancy key.';
comment on column public.key_wraps.kind is
  'LEAKS: which recovery paths the account has armed (web password, sync '
  'recovery code) and that a per-profile content key exists. The hierarchy is '
  'public design; which slots are filled is the only new information.';
comment on column public.key_wraps.profile_id is
  'LEAKS: WHICH profiles are web-enabled. Its absence is the local-only '
  'guarantee: a profile with no ck_under_mk row can never be opened by a '
  'browser session, because there is nothing to send it.';
comment on column public.key_wraps.epoch is
  'LEAKS: how many times this profile''s content key has been rotated — the same '
  'fact sync_objects.ck_epoch already concedes, and it is the join between them. '
  'Null for the two mk_* slots, which are not rotated by this mechanism. Part of '
  'the slot identity and therefore of the AEAD associated data.';
comment on column public.key_wraps.nonce is
  'LEAKS: nothing. 24 random bytes, and fresh whenever `wrapped` changes — the '
  'guard trigger refuses a re-wrap that keeps the old nonce (NX101). This is the '
  'rotation path: a NEW content key re-wrapped under the SAME MK at the SAME '
  'nonce publishes CK_old XOR CK_new to anyone who held CK_old, which is exactly '
  'the party a rotation is performed to lock out.';
comment on column public.key_wraps.wrapped is
  'LEAKS: nothing beyond its length, which is fixed by the key size.';
comment on column public.key_wraps.commit_tag is
  'LEAKS: nothing. Public by design — it is an HKDF output over the KEK, and a '
  'client checks it BEFORE attempting the AEAD so a wrong password fails as a '
  'wrong password rather than as 32 bytes of garbage. Its presence is what '
  'makes the two password-derived slots key-committing.';
comment on column public.key_wraps.kdf_salt is
  'LEAKS: nothing (16 random bytes). Public by construction — a salt is not a '
  'secret, and hiding it would only stop the legitimate client re-deriving.';
comment on column public.key_wraps.kdf_params is
  'LEAKS: the Argon2id cost parameters, hence roughly the weakest device the '
  'account is expected to run on. Public by construction, same as the salt.';
comment on column public.key_wraps.created_at is
  'LEAKS: when this recovery path was armed.';
comment on column public.key_wraps.rotated_at is
  'LEAKS: when it was last rotated, i.e. that a password change or a recovery '
  'happened at a particular time.';
comment on column public.key_wraps.disabled_at is
  'LEAKS: that a profile stopped being web-enabled, and when. Not revocation on '
  'its own — a browser that already holds the key still holds it; see the '
  'column comment in the DDL.';

-- ---------------------------------------------------------------------------
-- devices — one row per client that holds keys, and the session gate's anchor.
-- ---------------------------------------------------------------------------
-- `session_id` IS THE POINT OF THIS TABLE, not `name`. The restrictive policy in
-- migration 002 asks „is the session presenting this JWT still a session I have
-- not revoked", and it can only ask that because the session id is written down
-- here at the moment the session is minted. Revocation is then a single UPDATE
-- that takes effect on the next statement — as opposed to waiting out an access
-- token's lifetime, which is the usual and much worse answer.
--
-- A ROW IN THIS TABLE IS A CREDENTIAL, and that is the sentence to read twice.
-- The gate in migration 002 admits any session a live row here vouches for, so
-- whoever can write a row here can let themselves in. Migration 002 therefore
-- demands aal2 for the INSERT — exactly as it does for `pairing`, and for the
-- same reason. Without that, a stolen web password yields an aal1 session which
-- inserts one row naming its OWN `session_id`, is immediately vouched for by it,
-- and reads the entire encrypted corpus plus every key wrap: the second factor
-- would be a requirement on the long path (pairing) and no requirement at all on
-- the short one.
--
-- THE DEVICE NAME IS CIPHERTEXT. „Luka's ThinkPad" is a name, a person and a
-- machine; the server has no use for it, and pairing shows it to the user
-- AFTER the handshake, out of a payload the peer decrypted. Storing it as
-- plaintext would be the single most identifying string in this database. Its
-- AEAD associated data must bind „nexus/sync/device-name/v1" ‖ user_id ‖ id, or
-- a name can be moved between device rows by whoever holds this database.
create table public.devices (
  id             uuid        not null default gen_random_uuid() primary key,
  user_id        uuid        not null references auth.users (id) on delete cascade,
  session_id     uuid        not null,
  -- DEFAULTED, AND NOT IN THE CLIENT'S INSERT GRANT (migration 002). A column a
  -- client fills in is a column that says what the client felt like saying, and
  -- this one is the only place in the schema where „browser" and „desktop" could
  -- ever be distinguished at all. The only writer that may state `desktop` is
  -- `pair-complete`, which holds the service-role key and only reaches this row
  -- after a completed handshake; everything a client inserts for itself lands as
  -- `web`. That does not by itself make „MK must never enter a browser" a server
  -- rule — see the README — but it is the difference between a column that is
  -- evidence and a column that is a self-description.
  platform       text        not null default 'web',
  name_nonce     bytea       not null,
  name_ciphertext bytea      not null,
  public_key     bytea,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  revoked_at     timestamptz,

  constraint devices_platform check (platform in ('desktop', 'web')),
  constraint devices_name_nonce_len check (octet_length(name_nonce) = 24),
  constraint devices_name_len check (octet_length(name_ciphertext) between 17 and 1024),
  constraint devices_public_key_len
    check (public_key is null or octet_length(public_key) = 32)
);

-- One live row per auth session. A second row against the same session id would
-- mean revoking one leaves the other alive, and the gate in migration 002 asks
-- `exists`, so the account would stay open after the user pressed „odjavi" —
-- the exact failure a revocation feature exists to prevent. Partial, because
-- revoked rows are history and history repeats.
create unique index devices_one_live_per_session
  on public.devices (session_id) where revoked_at is null;

create index devices_user_live
  on public.devices (user_id) where revoked_at is null;

-- Not a performance index. It exists so `sync_state` can carry a TENANT-SCOPED
-- foreign key: `references devices (id)` alone would let one account's cursor row
-- point at another account's device, because a bare `id` reference says nothing
-- about who owns the target. Nobody guesses a uuid, so the practical exposure is
-- small — but the composite key makes the cross-tenant reference unrepresentable
-- instead of merely improbable, and it stops a foreign account's `on delete
-- cascade` reaching into rows it has no relationship with.
create unique index devices_id_within_user on public.devices (user_id, id);

comment on table public.devices is
  'Clients holding keys for an account. Anchors the session-liveness gate.';

comment on column public.devices.id is
  'LEAKS: nothing. Random surrogate key.';
comment on column public.devices.user_id is
  'LEAKS: which account the device belongs to. The tenancy key.';
comment on column public.devices.session_id is
  'LEAKS: the link between this device row and a GoTrue session, hence which '
  'requests came from which device. Required: it is what makes revocation '
  'immediate rather than „when the access token expires".';
comment on column public.devices.platform is
  'LEAKS: desktop vs web. Two values, chosen so it cannot become an OS/version '
  'fingerprint — the moment it holds "Windows 11 26200" it is a tracking key. '
  'Server-attested: only pair-complete (service_role) may write ''desktop''; a '
  'client has no INSERT grant on this column and always lands as ''web''.';
comment on column public.devices.name_nonce is
  'LEAKS: nothing. 24 random bytes.';
comment on column public.devices.name_ciphertext is
  'LEAKS: the LENGTH of the device name. The name itself is encrypted because '
  'it is usually a person plus a machine and the server has no use for either.';
comment on column public.devices.public_key is
  'LEAKS: a stable 32-byte X25519 identity for the device — a permanent '
  'pseudonym. Nullable so a device that has no long-term identity does not '
  'acquire one just by existing.';
comment on column public.devices.created_at is
  'LEAKS: when the device was paired.';
comment on column public.devices.last_seen_at is
  'LEAKS: an activity trace — roughly when each device was last used.';
comment on column public.devices.revoked_at is
  'LEAKS: when a device was signed out. Never deleted: a revoked row is the '
  'proof that the session id is dead, and deleting it would make the gate '
  'fall back to „unknown session", which is exactly the wrong default.';

-- ---------------------------------------------------------------------------
-- pairing — one in-flight handshake, and nothing that survives it.
-- ---------------------------------------------------------------------------
-- WHO INSERTS. The browser, and it must already be at aal2 (migration 002
-- enforces that). It has to be the browser, because at the moment of the FIRST
-- pairing the desktop has no session at all — that is the whole point of the
-- exercise — so the desktop cannot write anything through PostgREST. The
-- desktop's half of the handshake arrives later, through the `pair-complete`
-- Edge Function, which is the only party with a service-role key.
--
-- `code_id` IS NOT THE PAIRING CODE AND MUST NEVER BE ITS PLAIN HASH. The code
-- carries ~65 bits; a plain SHA-256 of it is a 65-bit search a server operator
-- finishes over a lunch break, and with the code they can run the handshake as
-- the impostor. The client derives this handle with the same Argon2id pass that
-- stretches the code into the handshake PSK, so the search costs 2^65 Argon2id
-- evaluations rather than 2^65 hashes. That is a cost, not an impossibility —
-- which is why the code lives ten minutes, burns on the first AEAD failure, and
-- why the short authentication string is shown on BOTH screens: the last line
-- of defence against a server that did the search is a human comparing four
-- characters.
--
-- NOTHING IN THIS TABLE IS A BEARER TOKEN. `completion_token_hash` is the hash
-- of a random 256-bit value the browser generated and sealed inside
-- `sealed_payload` under the handshake key. Only a peer that actually completed
-- the ECDH can open the payload, so possession of the token PROVES the
-- handshake happened. This is why `pair-complete` may never accept anything
-- derived from the code: the code is a channel binding, not an authorisation.
create table public.pairing (
  id                    uuid        not null default gen_random_uuid() primary key,
  user_id               uuid        not null references auth.users (id) on delete cascade,
  code_id               bytea       not null,
  initiator_pub         bytea       not null,
  initiator_confirm     bytea,
  responder_pub         bytea,
  responder_confirm     bytea,
  sealed_payload        bytea       not null,
  completion_token_hash bytea       not null,
  attempts              smallint    not null default 0,
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null default now() + interval '10 minutes',
  consumed_at           timestamptz,
  burned_at             timestamptz,

  constraint pairing_code_id_len check (octet_length(code_id) = 32),
  constraint pairing_initiator_pub_len check (octet_length(initiator_pub) = 32),
  constraint pairing_responder_pub_len
    check (responder_pub is null or octet_length(responder_pub) = 32),
  constraint pairing_confirm_len check (
    (initiator_confirm is null or octet_length(initiator_confirm) = 32)
    and (responder_confirm is null or octet_length(responder_confirm) = 32)
  ),
  constraint pairing_sealed_len check (octet_length(sealed_payload) between 17 and 8192),
  constraint pairing_token_hash_len check (octet_length(completion_token_hash) = 32),
  constraint pairing_attempts_range check (attempts >= 0 and attempts <= 10),
  -- Ten minutes is the design; the CHECK bounds it at one hour so that a client
  -- computing its own `expires_at` — which it must, since the column is
  -- writable — cannot quietly hand itself a pairing code that lives a week.
  constraint pairing_ttl check (
    expires_at > created_at and expires_at <= created_at + interval '1 hour'
  )
);

-- Two live handshakes could otherwise share a `code_id`, and „which row does
-- this code mean" would be answered by whichever the planner returned first.
-- Partial on the live window for the same reason as `devices`: a consumed or
-- burned row is history, and history must not block the next attempt.
create unique index pairing_live_code
  on public.pairing (code_id) where consumed_at is null and burned_at is null;

-- The Edge Function's only lookup. Not partial: it must find a row that has
-- already been consumed in order to REFUSE it, and a partial index would hide
-- exactly the rows a replay is trying to reuse.
create unique index pairing_token on public.pairing (completion_token_hash);

create index pairing_expiry on public.pairing (expires_at);

comment on table public.pairing is
  'In-flight device pairings. Rows are short-lived and single-use; see header.';

comment on column public.pairing.id is
  'LEAKS: nothing. Random surrogate key.';
comment on column public.pairing.user_id is
  'LEAKS: that this account is pairing a device right now, and how often it '
  'does. Required: it is what binds the minted session to the right account.';
comment on column public.pairing.code_id is
  'LEAKS: a blinded handle for the pairing code. Argon2id-derived, NOT a plain '
  'hash — a plain hash would put a ~65-bit code inside a lunch break.';
comment on column public.pairing.initiator_pub is
  'LEAKS: an ephemeral X25519 public key, discarded with the row. No long-term '
  'identity, so it links nothing to anything.';
comment on column public.pairing.initiator_confirm is
  'LEAKS: nothing. Key-confirmation MAC; meaningless without the shared secret.';
comment on column public.pairing.responder_pub is
  'LEAKS: the desktop''s ephemeral X25519 public key, and by its presence, that '
  'the desktop has answered. Written only by the pair-complete function.';
comment on column public.pairing.responder_confirm is
  'LEAKS: nothing. Key-confirmation MAC from the desktop side.';
comment on column public.pairing.sealed_payload is
  'LEAKS: its length. Contains the completion token and the device metadata, '
  'sealed under the handshake key; the server cannot open it.';
comment on column public.pairing.completion_token_hash is
  'LEAKS: nothing usable — it is the hash of a value the server never sees, and '
  'the value is 256 random bits, so it cannot be searched. This column is the '
  'single-use ledger, not a credential.';
comment on column public.pairing.attempts is
  'LEAKS: how many times completion was tried. Server-written only (no client '
  'grant); `nexus_pair_claim` increments it on every presentation, hit or miss, '
  'and REFUSES the row once it reaches 10 — so it is a latch rather than a '
  'statistic. The CHECK bounds it so the counter cannot itself be spun forever.';
comment on column public.pairing.created_at is
  'LEAKS: when pairing started.';
comment on column public.pairing.expires_at is
  'LEAKS: when it stops being valid. CHECK-bounded to one hour past creation so '
  'a client cannot mint itself a long-lived code.';
comment on column public.pairing.consumed_at is
  'LEAKS: whether the pairing succeeded, and when. The single-use latch.';
comment on column public.pairing.burned_at is
  'LEAKS: that a handshake failed authentication — i.e. that somebody typed a '
  'wrong code, or that an attacker tried. Burning on the FIRST AEAD failure is '
  'what keeps a ~65-bit code out of reach of online guessing.';

-- ---------------------------------------------------------------------------
-- sync_state — each device's cursor, so a pull resumes instead of restarting.
-- ---------------------------------------------------------------------------
-- This table is a convenience and the client must treat it as one: it is the
-- server's copy of a number the client already knows, kept here so a reinstall
-- resumes rather than re-downloading a lifetime of ciphertext. A hostile server
-- can rewind it, which is why `last_seq` is a FLOOR the client raises rather
-- than a value it trusts — rewinding costs bandwidth and re-application of rows
-- that are idempotent anyway, and it cannot make the client miss a row.
create table public.sync_state (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  device_id  uuid        not null,
  profile_id uuid        not null,
  collection text        not null,
  last_seq   bigint      not null default 0,
  updated_at timestamptz not null default now(),

  primary key (user_id, device_id, profile_id, collection),

  -- COMPOSITE, so the reference carries the tenant. `references devices (id)`
  -- would be satisfied by ANY device row in the table, including another
  -- account's: the constraint would be checking that a uuid exists, not that it
  -- is yours. Nothing here is readable across accounts either way — the policies
  -- see to that — but a cross-tenant reference is still a relationship the schema
  -- should not be able to express, and it would hand a foreign account's
  -- `on delete cascade` a path into rows it has nothing to do with.
  constraint sync_state_device_within_user
    foreign key (user_id, device_id) references public.devices (user_id, id)
    on delete cascade,

  constraint sync_state_last_seq_range check (last_seq >= 0),
  constraint sync_state_collection_shape
    check (collection ~ '^[a-z][a-z0-9_]{0,63}$')
);

comment on table public.sync_state is
  'Per-device pull cursors. Advisory: the client owns the authoritative copy.';

comment on column public.sync_state.user_id is
  'LEAKS: which account. The tenancy key.';
comment on column public.sync_state.device_id is
  'LEAKS: which device is how far behind — an activity and presence trace.';
comment on column public.sync_state.profile_id is
  'LEAKS: which profiles a given device syncs, i.e. which profiles that device '
  'is allowed to open.';
comment on column public.sync_state.collection is
  'LEAKS: which modules that device syncs.';
comment on column public.sync_state.last_seq is
  'LEAKS: how far through the log a device has read. Advisory only — see the '
  'table header on why a rewind by a hostile server is harmless.';
comment on column public.sync_state.updated_at is
  'LEAKS: when the device last synced.';

-- ---------------------------------------------------------------------------
-- private.pair_rate_limit — the Edge Function's counters.
-- ---------------------------------------------------------------------------
-- In `private` because it is a denial-of-service lever, not a user resource:
-- anyone who can write here can lock a user out of pairing, and anyone who can
-- delete from here has removed the rate limit. It has RLS enabled and forced
-- and NOT ONE POLICY, which is the strongest wall this database can build — the
-- only roles that can read it are those with BYPASSRLS, which in Supabase means
-- `service_role`, which means the Edge Function and nothing else.
create table private.pair_rate_limit (
  bucket_key   text        not null primary key,
  window_start timestamptz not null default now(),
  hits         integer     not null default 0,

  constraint pair_rate_limit_hits_range check (hits >= 0)
);

comment on table private.pair_rate_limit is
  'Rate-limit counters for pair-complete. Unreachable except via service_role.';

comment on column private.pair_rate_limit.bucket_key is
  'LEAKS: nothing to a client — unreachable. To an operator: a salted hash of a '
  'caller IP, or a pairing row id. Never a raw IP: this table would otherwise '
  'become an access log with a different name.';
comment on column private.pair_rate_limit.window_start is
  'LEAKS: when the current window opened. Operator-visible only.';
comment on column private.pair_rate_limit.hits is
  'LEAKS: attempts in the current window. Operator-visible only.';

