# PRD 10 — Private Notes (PRIV)

**Status:** draft 2026-07-05. Inputs: raw-spec §8, founder decision #6,
`docs/research/private-notes-crypto-ux.md`, SEC-ZK (binding, not restated),
SEC-CR, offline-sync research §5 (ciphertext blob sync).

## 1. Purpose

The maximum-trust space: notes that no one — not the server, not us, not an
attacker with the database — can ever read. PRIV is the privacy-first
persona's reason to install and the strongest claim on the landing page.
Its UX must make real cryptographic guarantees usable by non-experts.

## 2. User stories

- As a user, I want a private section that even the app's creators cannot
  read, so that my most sensitive notes are truly mine.
- As a phone user, I want biometric unlock for daily convenience with a real
  password behind it, so that security doesn't mean friction (Android,
  later).
- As a careless human, I want a recovery key I set up once, so that a
  forgotten password doesn't erase my private life.
- As a user in a shared space, I want the section to lock itself, so that a
  borrowed laptop leaks nothing.

## 3. User experience & flows

**Setup (first open of Private section):** two-sentence honest explanation →
password (account password by default; optional separate passphrase per
crypto-ux OQ#1) → Recovery Kit generated (file download + print option, key
verification by re-entering a short segment) or explicit informed opt-out
(decision #6) → optional biometric enable (Android). **Unlock:** password
prompt (or biometric); section stays open per timeout; manual lock button
persistent; global "panic lock" shortcut. **Locked state:** the section
shows only a lock screen; nothing from inside renders anywhere (search,
lists, notifications, previews). **Password reset interplay:** cloud
password reset without Recovery Kit leaves PRIV locked (AUTH-017 warning);
with Kit, keys re-wrap. **Inside:** the full NOTE editor experience (blocks,
attachments, versions) — private notes are not feature-poor.

## 4. Functional requirements

- **PRIV-001 (M)** The Private section shall be zero-knowledge encrypted per
  SEC-ZK-01..07; every capability below operates within those constraints.
- **PRIV-002 (M)** Setup shall run on first section open (not onboarding),
  with Recovery Kit generation default and verified-save or explicit
  informed opt-out (decision #6, SEC-ZK-04).
- **PRIV-003 (M)** Unlock shall require the vault credential; the section
  auto-locks after a configurable idle timeout (default 5 min), on app
  minimize/sleep (configurable), and via manual lock and panic shortcut.
- **PRIV-004 (M)** While locked, no plaintext artifact of private notes
  (titles, previews, search hits, notification content, thumbnails) shall
  render anywhere in the app or OS (SEC-ZK-06, NTF-006).
- **PRIV-005 (M)** Private notes shall support the full NOTE feature set
  (blocks, markdown, attachments, versions, in-section search) with all
  indexes and history encrypted (SEC-ZK-02); explicit exceptions: no
  sharing, no canvas mirroring outside the section, no flashcard export to
  STUDY (cards would leak content).
- **PRIV-006 (M)** In-section search shall work over an encrypted local
  index, only while unlocked.
- **PRIV-007 (M)** Sync (cloud accounts): encrypted blobs with version
  vectors; conflict = keep both copies visibly (offline-sync research §5).
- **PRIV-008 (M)** Recovery Kit management: view status (saved/opted-out),
  regenerate (invalidates old), re-verify; regeneration prompts after
  password change.
- **PRIV-009 (M)** Moving a note between Private and regular sections shall
  be an explicit, confirmed action explaining the security consequence in
  both directions (encrypt on way in; decrypt + become syncable/searchable
  on way out).
- **PRIV-010 (M)** Export: private notes export only while unlocked, only
  into an encrypted export by default; plaintext export requires the
  SEC-DAR-02 explicit confirmation.
- **PRIV-011 (S)** Separate optional passphrase (distinct from account
  password) — crypto-ux OQ#1 recommendation.
- **PRIV-012 (S)** Clipboard guard: copying from a private note offers
  auto-clear after 30 s (crypto-ux OQ#3).
- **PRIV-013 (S)** Android: biometric unlock via keystore-gated crypto
  (SEC-AND-01); `FLAG_SECURE` on private screens (SEC-AND-03).
- **PRIV-014 (C)** Decoy/nothing-to-see mode research (plausible
  deniability) — explicitly out of scope for v1; listed to record the
  decision.

## 5. Options & settings

Auto-lock timeout; lock-on-minimize; clipboard auto-clear; separate
passphrase; biometric (Android); Recovery Kit status panel.

## 6. Integrations

AUTH (reset-flow warning contract); NOTE (editor reuse — same component,
different storage layer); NTF (generic reminders only); SET (settings
surface); IMEX (encrypted export path). Deliberate non-integrations per
PRIV-005: SHARE, CANV (outside section), STUDY, SRCH global index.

## 7. Edge cases & error states

- Wrong password attempts → escalating delays (mirrors SEC-LOC-02 spirit);
  no lockout that could be abused to deny the owner access permanently.
- Password change while a second device is offline → old-wrapped DEK
  handled by re-wrap protocol on next sync; device prompts for new password.
- Recovery Kit opted-out user forgets password → honest dead end with
  empathetic copy; documented support stance ("we cannot help by design").
- App crash while unlocked → keys held only in memory; next launch starts
  locked (no unlock-state persistence).
- Attachment previews inside private notes render through the same sandbox
  but decrypt only in memory; thumbnail caches encrypted or disabled.
- OS content indexers / search (Spotlight, Windows Search) must be excluded
  from any private-notes storage paths (SEC-ZK-06).

## 8. Acceptance criteria (key)

- Traffic/storage inspection on a synced private note shows ciphertext only;
  server-side database dump contains no recoverable plaintext or titles.
- Lock fires at timeout and on minimize; after lock, global search, recents,
  and notification center contain zero private-note traces.
- Password reset without Kit: account restored, PRIV locked with clear
  explanation; with Kit: full recovery, then Kit-regeneration prompt.
- Kill the app while unlocked → relaunch starts locked.
- Conflict scenario (offline edits both devices) yields two visible copies
  inside the section, no data loss.
- Moving a note out of Private requires typed confirmation and makes it
  searchable; moving in removes it from global index within one sync cycle.

## 9. Open questions

1. ~~Default auto-lock timeout.~~ **Decided (founder 2026-07-05): 5 min
   desktop, 2 min web — both adjustable in settings.**
2. ~~Web app parity.~~ **Decided (founder 2026-07-05): ship on web in v1
   with the documented trust caveat.**
3. ~~Attachment size cap inside PRIV.~~ **Decided (founder 2026-07-05):
   100 MB per file in v1; a premium tier may later raise this to 1 GB+
   (monetization hook — record in roadmap).**

## 10. Future extensions

2SKD hardening; encrypted note sharing between two Nexus users (key
exchange — research-heavy, far post-v1); hardware-key unlock (FIDO2);
encrypted local full-disk-style vault for arbitrary files (VLT adjacency,
post-pen-test per decision #8).
