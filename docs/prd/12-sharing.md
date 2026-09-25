# PRD 12 — Sharing & Collaboration (SHARE)

**Status:** draft 2026-07-05. Inputs: raw-spec §10, founder decision #5
(read-only v1, co-editing later), offline-sync research (snapshot publishing
v1, CRDT-ready future), SEC-API-01 (object-level authz).

## 1. Purpose

Planning together: share notes and boards with other Nexus users (or via
link) — read-only in v1, foundations laid for real-time co-editing later.
Sharing is a cloud-account feature by nature; it must never weaken the
privacy story (private notes are structurally unshareable).

## 2. User stories

- As a planner, I want to share a board with my partner read-only, so that
  we see the same plan.
- As a recipient, I want shared items in a clear "Deljeno sa mnom" section,
  so that others' content never mixes with mine.
- As a sharer, I want to see and revoke exactly who has access, so that
  sharing stays under control.
- As a link sharer, I want an optional public link with revocation, so that
  non-Nexus users can view too.

## 3. User experience & flows

Share action on a note/board → dialog: add recipients by nickname (exact
match only — no user search/directory in v1, anti-harvesting), or create a
view link (off by default; optional expiry); list of current recipients with
revoke. Recipient sees the item under "Deljeno sa mnom" (read-only viewer,
same renderers as owner) with sharer attribution and "kopiraj u moje" (fork)
action. Updates propagate: recipients see the owner's latest published
state (auto-publish on save with small debounce; owner can pause updates —
"freeze snapshot").

## 4. Functional requirements

- **SHARE-001 (M)** Shareable types v1: regular notes and canvas boards.
  Private notes: structurally excluded (PRIV-005). Attachments referenced by
  the shared item are included read-only.
- **SHARE-002 (M)** Recipient addressing by exact nickname (verified cloud
  accounts only); uniform response whether or not the nickname exists
  (SEC-AUTH-02 spirit) — the share appears only if it existed.
- **SHARE-003 (M)** Read-only enforcement server-side (SEC-API-01 object
  authz), not just UI; recipients cannot modify, share onward, or export the
  owner's attachments in bulk (single-file view/download allowed).
- **SHARE-004 (M)** Access management: per-item recipient list with
  revocation (immediate on next sync); owner sees per-item shared status
  badges in their own lists.
- **SHARE-005 (M)** "Deljeno sa mnom" section per profile; forking ("kopiraj
  u moje") creates an independent copy in the recipient's account with
  attribution note.
- **SHARE-006 (M)** Updates: owner-published snapshots propagate to
  recipients; owner "freeze" pauses publishing while keeping access.
- **SHARE-007 (S)** Public view links: unlisted URL, optional expiry and
  revocation, rendered in a minimal web viewer (no account needed); rate
  limits + noindex; owner sees link status. Off by default.
- **SHARE-008 (S)** Share notifications (NTF): recipient notified once per
  share, not per update (digest option).
- **SHARE-009 (C)** Comments on shared items (single thread per item) —
  fast-follow; schema reserved.
- **SHARE-010 (W v1)** Real-time collaborative editing — post-v1; data
  layer is CRDT-ready by design (sync research), server relay + presence to
  be specified in its own PRD when scheduled.

## 5. Options & settings

Default link expiry; share-notification digest; global "disable my
shareability" (nobody can share *to* me) privacy switch.

## 6. Integrations

NOTE/CANV (viewer reuse of renderers); AUTH (verified accounts only; nickname
resolution); NTF (share notifications); PRIV (structural exclusion); LAND
(public link viewer is a web surface, shares the web app's renderer);
STUDY (shared decks — future, riding SHARE-005 fork mechanics).

## 7. Edge cases & error states

- Recipient's account deleted → share entry disappears for owner; no orphan
  access.
- Owner deletes shared item → recipients lose access; their forks unaffected.
- Revocation while recipient offline → access ends at next connectivity;
  cached snapshot becomes inaccessible (viewer requires validation for
  shared content — deliberate exception to offline-first, documented).
- Share to own nickname → friendly error.
- Very large board shared → viewer streams/paginates; same performance
  budgets as owner view.
- Link leaked → revocation invalidates immediately server-side; new link =
  new URL.
- Fork of an item containing note-mirror cards → mirrors flatten to static
  content in the copy (recipient lacks source notes) with notice.

## 8. Acceptance criteria (key)

- Sharing a board to an existing nickname delivers it to their "Deljeno sa
  mnom" within one sync; a non-existent nickname produces the same UI
  feedback for the sharer.
- Recipient API attempts to modify a shared item are rejected server-side.
- Revocation removes recipient access on their next sync; frozen share stops
  updating but stays accessible.
- Public link renders the note in a browser without login; after expiry or
  revocation it returns a clean "nedostupno" page; robots meta prevents
  indexing.
- Fork produces an independent, editable copy with attribution.

## 9. Open questions

1. ~~Max recipients per item.~~ **Decided (founder 2026-07-05): 50 in v1.**
2. Public-link viewer branding (ties to LAND design) — design session.
3. ~~Should recipients see each other?~~ **Decided (founder 2026-07-05):
   hidden by default (owner-only visibility), with a per-share owner option
   to make the participant list visible to everyone.**

## 10. Future extensions

Real-time co-editing with presence (SHARE-010); comments/mentions;
team/workspace layer; shared STUDY decks; permission tiers (comment/edit).
