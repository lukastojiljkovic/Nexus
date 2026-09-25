# ADR-041 — Custom dashboard background + dim (SET-006)

**Status:** accepted · 2026-07-30 · **migration 030 reserved · interchange 1.9.0 reserved**
**Drives:** SET-006 (PRD 07): a user-chosen image behind the dashboard with a
dim slider for legibility. The design question is storage: a personal photo
must get the same at-rest guarantees as every other user byte (SEC-DAR), and
personalization is *profile* data, so it must survive an archive round trip.

## Decision

### 1. The image is an ordinary blob; the choice is a settings row

- The picked image goes into the **existing encrypted blob store** (ADR-014/
  019/031: one content-addressed store, module-blind by design). No new byte
  path, no plaintext file in `userData` — a family photo on the lock screen
  of a stolen laptop is exactly what SEC-DAR exists to prevent.
- Migration **030**: `dashboard_settings` — `profile_id` (PK, references
  profiles), `background_hash TEXT NULL`, `background_mime TEXT NULL`
  (CHECK: both null or both set), `background_dim INTEGER NOT NULL DEFAULT
  40` (CHECK 0–90). One row per profile, created on first write;
  `DashboardSettingsStore.get` returns defaults when no row exists (the
  `ntf_settings` get-or-default pattern). Every statement `profile_id`-scoped.
- The mime is **stored at pick time from `sniffMime`**, never trusted from
  the file extension — the same rule note images follow. Only
  `isInlineImageMime` formats (png/jpeg/gif/webp) are accepted; anything
  else is refused with a named reason, not silently re-encoded.

### 2. Main owns the picker and the bytes (SEC-EL)

Channels: `dashboard:get-settings`, `dashboard:pick-background` (opens the
native image dialog — the renderer sends no path and no bytes, the
task-attachment precedent), `dashboard:clear-background`,
`dashboard:set-dim`. Pick flow in main: stat before read,
`MAX_BACKGROUND_BYTES = 20 MiB` cap, sniff, encrypt into the store, then
write the settings row; replacing or clearing runs the existing
refcount-gated GC on the previous hash. Caps and dim bounds are exported
constants, imported by the IPC validators, never re-spelled.

### 3. The refcount and mime unions gain a third member

`blobRefCount` and `blobMimeForHash` in main are already the ONE union over
every table that names a hash (hoisted in wave 1 precisely so a new source
is a one-place change, and injected into restore). `dashboard_settings.
background_hash` joins both. A background shared byte-for-byte with an
attachment is one file on disk and survives either row's deletion — no new
GC logic, the invariant does the work.

### 4. Interchange 1.9.0: a new record type, no era flag

`dashboard-settings` NDJSON record (per profile: dim + optional background
hash/mime); the blob joins the existing `blobs/` union, and the checksum
walk already iterates the union of known-and-declared files. New record
types need **no era flag** (the version gate covers them — the ADR-028
rule); pre-1.9.0 archives simply restore to defaults.
`ExportArchiveInput` gains a **required** `dashboardSettings` field (the
ADR-022 forgotten-module-is-a-type-error idiom). The parser twin validates
dim bounds, hash shape, and the both-or-neither pair; restore retargets the
profile id like every other row.

### 5. Rendering and the dim scrim

`DashboardPage` renders a background layer behind its content:
`background-image: url("nx-blob://<hash>")`, cover/center — the existing
read protocol; the CSP's `img-src` already admits the scheme. Above it, a
scrim div with `background: var(--nx-color-bg)` and `opacity: dim/100` —
the scrim IS the theme's paper/vesper surface, so Dan dims toward warm
paper and Noć toward blue-black with **zero new colour values** and no
banned hues. Dim is capped at 90: a fully opaque scrim would be a
background-less dashboard that still pays to decrypt an image.

### 6. Settings UI

A „Kontrolna tabla" card in Settings (own card — module-scoped, like the
Beleške card): current-background thumbnail (the `nx-blob:` URL again),
„Izaberi sliku…", „Ukloni", and the dim slider (0–90, step 5, live
preview), hidden while no background is set — dim of nothing means
nothing. Settings-search entries for the card and both controls. Serbian
copy in `strings.ts`.

## Consequences

- A profile's background travels in its archive and restores byte-exact;
  the export grows by one image — recorded, acceptable, it is user data.
- The dashboard reads one more settings row at mount; widgets are
  untouched — legibility is the scrim's job, not the widgets'.
- GIF backgrounds animate (browser behavior). Not blocked: the format list
  stays the note-image list, one rule everywhere. If it proves distracting
  the founder can narrow the list — one constant.
- SET-006's slider dims the image only; a global UI dim (brightness) is a
  different feature and deliberately not this.
