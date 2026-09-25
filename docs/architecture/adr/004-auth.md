# ADR-004 — Authentication: Cloud & Local Accounts

**Status:** **local accounts BUILT as designed; cloud accounts SUPERSEDED** —
they are Supabase auth (founder, 2026-08-08), not the hand-built scheme below ·
originally accepted 2026-07-05

> **The two halves aged differently, which is why this needs a line rather than
> a deletion.** The *local* account is built exactly as this ADR describes and
> is shipped: PIN, OS-keystore key wrap, the Recovery Kit, progressive
> back-off. See [018](018-local-account-passcode.md) for what actually shipped.
>
> The *cloud* account is not: there is no Argon2id-over-our-own-endpoint, no
> opaque session table of ours, no nickname quarantine. Sign-in is **GoTrue**,
> and MFA is enforced by the database through aal2-restrictive RLS rather than
> by application code. The decision that matters and is easy to get wrong:
> **the web password is never the root of the local file.** A separate master
> sync key is minted and wrapped twice — under the local data key on the
> desktop, and under a key derived from the web password on the server — so
> nothing about at-rest protection depends on the account.
**Drives:** AUTH PRD (all requirements), SET account surfaces; SEC-CR-01/02,
SEC-AUTH-01..05, SEC-SES-01..04, SEC-LOC-01..04. Founder decisions #3
(nickname+password), #11 (grace 14 d, nickname quarantine, remember-me
defaults).

## Context

Two account modes with different threat models: cloud accounts
(server-verified identity, sessions, sync) and fully local accounts
(PIN-protected, zero server contact, device-bound). The PRD fixes the UX
(nickname login, email reset); this ADR fixes mechanisms.

## Options considered

- **Sessions:** stateless JWTs vs opaque server-side tokens. JWTs can't be
  revoked without a denylist (which reintroduces state) and invite
  algorithm/config bugs; the AUTH PRD requires a sessions list with remote
  revocation (AUTH/SET-002), which is native to server-side sessions.
- **Password hashing:** Argon2id vs bcrypt — baseline already mandates
  Argon2id (SEC-CR); bcrypt kept only as a documented fallback if server
  CPU budget forces it (it won't at beta scale).
- **Local-account protection:** OS-keystore-wrapped keys vs
  PIN-derived-only encryption. PIN-only (4–6 digits) is brute-forceable
  offline; keystore-wrapping binds data to the device + OS credential,
  matching the PRD's device-credential recovery flow.

## Decision

### Cloud accounts

- **Registration:** nickname (unique, quarantined after deletion —
  decision #11; quarantine length: 90 days, tunable) + email + password.
  Argon2id (server-side; parameters per OWASP current guidance, re-tuned
  yearly per SEC-CR-02). Email verification via single-use, expiring,
  hashed-at-rest tokens; account usable before verification, sync gated
  (onboarding research recommendation, ONB PRD).
- **Login:** nickname + password; generic error messages and uniform
  timing for all identity flows (SEC-AUTH-02 anti-enumeration); per-IP and
  per-account rate limits with exponential backoff (SEC-AUTH-03).
- **Sessions:** opaque 256-bit random tokens, stored hashed; web uses
  HttpOnly/Secure/SameSite=Lax cookies (SEC-SES-01), desktop/Android store
  the token via Electron `safeStorage` / Android Keystore (SEC-SES-02).
  Sliding expiry; absolute lifetime cap; "remember me" default on
  desktop/Android, off on web (decision #11). Sessions list + revoke-all
  on password change (SEC-SES-03/04).
- **Reset/recovery:** password reset by nickname → link to account email;
  forgot-nickname via email — both with the same anti-enumeration
  discipline. Password reset never unlocks PRIV (ADR-005 split). Security
  notifications on new-device login and credential changes (AUTH-021,
  NTF-007).
- **2FA:** TOTP optional at v1 (AUTH PRD S-tier); recovery codes generated
  at enrollment.
- **Profile switch (business/personal):** password re-entry required per
  founder decision #4; implemented as a scoped re-auth, not a new session.

### Local accounts

- Local account = local identity record + PIN. Key chain: random 256-bit
  data key (encrypts SQLite at rest, ADR-001) wrapped twice — (a) by a key
  derived from the PIN via Argon2id with per-account salt, and (b) by an
  OS-keystore-protected key (DPAPI / macOS Keychain / Android Keystore)
  enabling the PRD's device-credential recovery when the PIN is forgotten
  (SEC-LOC-02/03).
- PIN attempts throttled with escalating local backoff (SEC-LOC-04);
  no network calls of any kind (SEC-PRIV-02).
- Explicitly documented limitation (honest UX per baseline): a local
  attacker with the user's OS credential can recover the data key — the
  local account protects against other users of the device and casual
  access, not against the device owner's compromised OS account. Stronger
  guarantees belong to PRIV (ADR-005).

## Consequences

- Server-side sessions add a DB table and lookup per request — trivial at
  our scale, and revocation semantics come free.
- The keystore wrap ties local accounts to the device; IMEX backup is the
  documented migration path between devices (IMEX PRD guarantee).
- Argon2id parameters become an operational knob with a yearly review
  entry in the ops runbook (SEC-CR-02).
