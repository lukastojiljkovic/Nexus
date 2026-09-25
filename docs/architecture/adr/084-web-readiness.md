# ADR-084 — Preparing for the web app, without building it

**Status:** accepted (2026-08-02) · **Owner:** supervisor · **Supersedes nothing;
narrows** the cloud/sync ADRs, which remain long-term design.

> **Renumbered from 082 to 084 on 2026-08-16, and the reason is worth one
> paragraph.** Two different decisions were both issued as ADR-082 — this one,
> and „What syncs, and as what" — because the sync ADRs were written into
> `docs/architecture/` directly rather than into `adr/`, where the numbering
> lives. The collision was invisible for exactly as long as nobody looked in
> both directories.
>
> This one moved because it had the fewest bindings: four references, all in
> `architecture/overview.md`. ADR-082's number is cited from nine places in
> shipped source (`packages/sync/src/collections.ts`, migrations 062 and 063,
> `collectionGuard.test.ts`), and renumbering a decision the code names is how a
> comment starts pointing at the wrong document.
>
> **So the numbers here are allocation order, not chronology** — 084 is dated
> 2026-08-02 and 082/083 are dated 2026-08-08. That is now stated rather than
> left to be discovered.
>
> **The hosting target has since changed** and this ADR is superseded on that one
> point: Cloudflare *Workers with static assets*, not Pages — Cloudflare's own
> guidance sends new projects to Workers, and `_headers`/`_redirects` behave
> identically on both, so the reasoning below about response headers stands
> unchanged. Everything else here is still the decision on record.

**Founder decisions, 2026-08-02** — asked and answered in one exchange:

1. **Static hosting on Cloudflare Pages**, not GitHub Pages. *„možemo da se
   pripremimo za cloudflare."*
2. **Privacy preserved: content encrypted client-side, metadata in the clear.**
   *„može to što ti kažeš da je dobro, da čuvamo privatnost i sigurnost
   podataka."*
3. **The sync model is to be planned before it is built.** *„to se isplaniraj
   lepo pa redom kreni da popravljaš."*

Plus the standing instruction that frames all of it: *„kreni lagano da
pripremaš"* — prepare, do not build. **No cloud code ships under this ADR.**

## 1. Why GitHub Pages was refused

It cannot set HTTP response headers. That removes `frame-ancestors` and
`X-Frame-Options`, so any site could embed Nexus in an iframe; a `<meta>` CSP
does **not** cover `frame-ancestors`, so there is no workaround from inside the
page. For a product holding private notes — and a password vault later — that is
a hole rather than a preference.

Cloudflare Pages is the same free static model with a `_headers` file, so the
full CSP the desktop app already runs under has somewhere to live. The *static
hosting* half of the founder's instinct was right; only the host changed.

**What this costs today: nothing.** It is a deployment target, and no deployment
happens under this ADR. It is recorded so the decision is not re-litigated.

## 2. The encryption boundary, stated precisely

**Content is encrypted on the device. Metadata is not.**

- **Encrypted client-side:** note bodies, task titles and notes, event details,
  attachments, the private section, financial amounts and payees, measurements —
  everything a person would call *their data*.
- **In the clear:** row id, profile id, record type, `created_at`/`updated_at`,
  `deleted_at`, and the foreign keys that express structure.

The clear half is exactly what a server needs to enforce row-level security, to
reconcile two devices, and to know what to send — and it is the half that reveals
the least. The pattern is what Obsidian, Standard Notes and Bitwarden all settle
on, for the reason that matters here: **search stays honest.** Nexus already
searches locally through FTS5 (migration 017), so it loses nothing by the server
being unable to read content — the server was never going to do the searching.

**The consequence to accept out loud:** with content opaque, Postgres cannot
filter, sort or report on it. Any future feature that assumes the server can
read a note is refused by this decision, not blocked by a missing implementation.

## 3. The finding that changes the size of this job

**`NexusApi` — the preload bridge — is already the service interface.**

It exists for a security reason: the renderer is untrusted, so every data access
crosses a frozen, typed, one-method-per-channel allowlist. That is the same shape
a client-server API has. So the web build does not need the renderer refactored
off `window.nexus`; it needs **a different implementation of the same object** —
one that talks to a WASM SQLite database in the browser instead of to IPC.

This is a large piece of luck earned by an unrelated discipline, and it is worth
protecting deliberately:

- **`NexusApi` stays the only door.** Nothing in the renderer may reach data any
  other way. This is testable today and cheap to pin.
- **Its methods stay serialisable** — plain data in, plain data out, no handles,
  no callbacks that cannot cross a wire. Mostly true already; the exceptions are
  worth naming before they multiply.
- **The count of distinct methods is the web backend's API surface.** It is being
  measured by the polish audit rather than estimated.

## 4. What „preparation" concretely means, in priority order

1. **Bundle splitting.** The eager renderer chunk is ~6 MB. On desktop that is an
   annoyance; on a phone over mobile data it is the difference between a product
   and a bounce. This is the one item that is fully desktop polish *and* fully
   web preparation, so it goes first and needs no cloud decision behind it.
2. **Prove the renderer builds without Electron.** Not ship it — *build* it, so
   the blockers become a list instead of an assumption. Nobody has ever checked.
3. **Keep `@nexus/db` behind a narrow driver seam.** On the web the database is
   WASM SQLite over OPFS, not `better-sqlite3-multiple-ciphers`. Today the native
   driver's types are imported directly across the package. Nothing needs porting
   yet; what matters is that new code does not deepen the coupling.
4. **Mobile layout.** The app assumes a persistent sidebar and a pointer. The
   audit is measuring what actually breaks at 390 px; the fixes belong with the
   polish pass, because doing them while touching a surface is far cheaper than
   a second pass later.
5. **The sync model — designed, not built.** Its own ADR when the turn comes.
   What is already known: **NOTE is ready** (Yjs CRDTs exist for exactly this);
   everything else is ordinary rows needing a reconciliation rule; and the
   interchange format already defines, per record type and with era-gated
   versioning (ADR-028 §7), precisely what one row is on a wire — which is the
   sync payload definition, already written and already tested.
   **PowerSync** (Postgres↔SQLite, offline-first, works with Supabase) was in the
   earlier cloud design and is re-evaluated there rather than assumed away.

## 5. What this ADR does not decide

The backend itself. Supabase is the founder's candidate and nothing here commits
to it: with content opaque and search local, the server's job shrinks to storage,
auth and reconciliation, and that is a smaller decision made better once the sync
model exists. Auth in particular is untouched — the desktop app's local passcode
account (ADR-018) and a cloud identity are different things, and how they meet is
the sync ADR's problem.
