# PRD 06 — Accounts & Auth (AUTH)

**Status:** draft 2026-07-05. Inputs: `docs/notes/raw-spec.md` (login section),
founder decisions #3/#4/#6, `docs/research/private-notes-crypto-ux.md`,
`docs/research/onboarding-ux.md`, `docs/security/baseline.md` (SEC-AUTH,
SEC-SES, SEC-LOC, SEC-ZK-04, SEC-DAR-03 are binding constraints and are not
restated as requirements here).

## 1. Purpose

Every Nexus user starts here. AUTH provides two account types — instant,
offline **local accounts** and server-backed **cloud accounts** — plus the
personal/business profile mechanism. It exists to make the privacy-first
promise real (a full-featured account with zero server contact) while giving
cloud users multi-device sync, sharing, and recovery. Personas: all; the
privacy-first user and the founder (local, desktop) are primary for v0.

## 2. User stories

- As a new user, I want to start using the app immediately without giving an
  email, so that I get value before committing (→ local account).
- As a privacy-first user, I want a guarantee my account never talks to a
  server, so that my data provably stays on my device.
- As a cloud user, I want to log in with my nickname and stay logged in on my
  devices, so that daily use is frictionless.
- As a forgetful user, I want safe recovery paths for password, username, and
  local PIN, so that a lapse doesn't lock me out.
- As a working user, I want personal and business profiles cleanly separated
  with a deliberate switch, so that the two lives never bleed together.
- As a cautious user, I want to see and revoke my active sessions and get
  notified of new logins, so that I can react to compromise.

## 3. User experience & flows

- **First launch:** welcome screen (ONB screen 1) offers "Počni odmah
  (lokalno)" (primary), "Prijavi se" and "Napravi cloud nalog" (secondary).
- **Local account creation:** name (display only) → PIN set (with strength
  hint) → optional biometric enable (Android) → straight into onboarding.
  No network, under 30 seconds.
- **Cloud registration:** nickname (live uniqueness check with suggestions)
  → email → password (strength meter, breached-password warning) → account
  created and usable immediately; verification email sent; a quiet banner
  shows "verify to enable sync/sharing".
- **Login:** nickname + password; optional "remember me" checkbox
  (default on, per raw-spec); 2FA step if enabled.
- **Forgot password:** enter nickname → uniform confirmation → email link →
  new password. The reset screen explicitly warns: private notes require the
  Recovery Kit; without it they stay locked (account itself is restored).
- **Forgot username:** enter email → uniform confirmation → email contains
  the nickname(s) registered to it.
- **Profile switch:** profile tab at login; in-app switcher in the sidebar
  footer — selecting the other profile prompts for password (PIN on local)
  every time; a distinct accent/badge marks the active business profile.
- **Local → cloud upgrade:** from Settings; creates a cloud account and
  migrates all local data into it (progress UI, verify-before-delete);
  original local data removed only after successful migration confirmation.

## 4. Functional requirements

### Account types
- **AUTH-001 (M)** The system shall support two account types: cloud and
  local, feature-equivalent except for network-dependent capabilities (sync,
  sharing, cloud backup, email flows).
- **AUTH-002 (M)** Local account creation shall work fully offline with no
  email, complete in a single short flow, and lead directly into onboarding.
- **AUTH-003 (M)** Local accounts shall generate zero network traffic
  (SEC-LOC-04); the UI shall state this guarantee in plain language.
- **AUTH-004 (M)** Local accounts shall be protected by a PIN (minimum 4
  digits; longer numeric or alphanumeric passcodes allowed), stored and used
  per SEC-LOC-01/02.
- **AUTH-005 (M)** PIN change shall require the current PIN; forgotten-PIN
  reset shall use the OS device credential per SEC-LOC-03.
- **AUTH-006 (S)** The system should support multiple local accounts per
  device with an account picker at launch.
- **AUTH-007 (S)** A local account should be upgradeable to a cloud account
  with complete data migration and explicit success confirmation before any
  local cleanup.

### Cloud registration & verification
- **AUTH-008 (M)** Cloud registration shall require a unique nickname, an
  email address, and a password.
- **AUTH-009 (M)** Nickname uniqueness shall be checked live during
  registration, with suggestions on collision; availability checks are
  rate-limited.
- **AUTH-010 (M)** Password acceptance shall follow SEC-AUTH-06, with a
  strength meter and a non-blocking breached-password warning.
- **AUTH-011 (M)** A verification email shall be sent at registration; the
  account is usable immediately, but sync, sharing, and email-dependent
  features are gated until verified. Resend available with cooldown.

### Login & sessions
- **AUTH-012 (M)** Login shall use nickname + password (founder decision #3).
- **AUTH-013 (M)** "Remember me" (default checked) shall keep the user
  signed in across restarts per SEC-SES-02/03; unchecked sessions end when
  the app closes.
- **AUTH-014 (M)** Users shall see all active sessions/devices (device name,
  platform, last active) and revoke any of them remotely.
- **AUTH-015 (S)** TOTP two-factor authentication should be available with
  one-time recovery codes (SEC-AUTH-07).
- **AUTH-016 (C)** An optional app-level lock (PIN/password/biometric to
  open Nexus itself) may be enabled, independent of the private-notes lock.

### Recovery & credential changes
- **AUTH-017 (M)** Forgot-password shall identify the account by nickname
  and send a reset link to the account email, with uniform responses; the
  reset flow shall surface the private-notes/Recovery-Kit consequence before
  committing.
- **AUTH-018 (M)** Forgot-username shall accept an email and mail back the
  nickname(s), with uniform responses.
- **AUTH-019 (M)** Password change shall require the current password,
  revoke all other sessions, and re-wrap keys (never re-encrypt data).
- **AUTH-020 (M)** Email change shall follow SEC-AUTH-05.
- **AUTH-021 (M)** All security events (new-device login, password/email
  change, 2FA change) shall notify the user (SEC-AUTH-08).

### Deletion
- **AUTH-022 (M)** Account deletion shall require re-authentication and an
  explicit typed confirmation, offer a full export first, apply a 14-day
  grace period (cancelable by logging in), then delete per SEC-DAR-03.
  Local-account deletion is immediate after confirmation (with export offer).

### Profiles (personal / business)
- **AUTH-023 (M)** Each account shall have a personal profile and an optional
  business profile with fully separate module data; only the calendar is
  shared, as an overlay with clear visual distinction of profile origin
  (founder decision #4).
- **AUTH-024 (M)** Profile selection shall be available at login; in-app
  switching shall require the account password (PIN for local accounts) on
  every switch (founder decision #4).
- **AUTH-025 (S)** The active business profile should be visually
  distinguished app-wide (badge and/or distinct accent). *Additional idea.*
- **AUTH-026 (S)** Each profile should have independent feature flags and
  onboarding state (business mini-questionnaire on first entry — see ONB).

## 5. Options & settings

Remember me (default on); 2FA on/off + recovery codes regeneration;
app-level lock (off by default) + auto-lock timing; session list management;
per-profile accent; login notifications (on by default; per-channel in NTF).

## 6. Integrations

ONB (welcome screen is ONB screen 1; business mini-questionnaire ONB-side);
PRIV (Recovery Kit interplay at password reset — PRIV owns vault crypto);
SET (profile editing, nickname change lives in SET but enforces AUTH-009
uniqueness); NTF (security notifications); IMEX (export before deletion);
SYNC cross-cutting (verification gates sync; local accounts have no sync
adapter present).

## 7. Edge cases & error states

- Registration with an email already in use → uniform success-style response
  ("check your email"), mail explains the situation (SEC-AUTH-02).
- Login attempts under throttling → escalating delays with honest UI copy,
  never CAPTCHAs for local accounts (none exist there).
- Offline login to a cloud account: cached credential verification allows
  opening local data; sync resumes when online; a session revoked remotely
  takes effect on next connectivity with local lock-out.
- Device clock skew shall not break token validation windows unreasonably.
- Local→cloud upgrade interrupted mid-migration → resumable; no data loss;
  local copy remains authoritative until final confirmation.
- Profile switch with unsaved editor state → autosave before switch.
- Deleting the business profile alone: allowed, same confirmation + export
  path, personal profile untouched.
- Device-credential PIN reset on a device without any OS credential set →
  explain and point to OS settings; no fallback backdoor.

## 8. Acceptance criteria (key)

- A local account created in airplane mode reaches the dashboard; a network
  monitor for the whole session records zero packets from the app
  (SEC-LOC-04 test).
- Unverified cloud account: editing works, sync/share affordances show the
  verification gate; after clicking the email link, sync starts without
  re-login.
- Password reset: old sessions die, private notes remain locked without
  Recovery Kit, restore correctly with it.
- Five wrong PINs produce visibly escalating delays; OS-credential reset
  restores access without data loss.
- Profile switch always prompts for the credential; calendar shows both
  profiles' events with distinct markers; no other module shows cross-profile
  data.
- Deletion: after grace period, login fails and a subsequent registration
  with the same nickname is possible (nickname released post-deletion).

## 9. Open questions

1. ~~Nickname release policy after deletion.~~ **Decided (founder
   2026-07-05): quarantine period before release (impersonation risk);
   length set in architecture (proposal 90 days).**
2. ~~Grace-period length.~~ **Decided (founder 2026-07-05): 14 days.**
3. ~~"Remember me" defaults.~~ **Decided (founder 2026-07-05): default on
   for desktop/Android, off for web.**
4. Multiple *cloud* accounts simultaneously on one device (account picker) —
   S or C? Deferred to roadmap.

## 10. Future extensions

Passkeys/WebAuthn login; Windows Hello/Touch ID app unlock on desktop;
2SKD-style device secret (crypto-ux research §8); team/organization
accounts; OAuth sign-in — all post-v1, each requires its own ADR.
