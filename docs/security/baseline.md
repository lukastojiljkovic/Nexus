# Nexus — Security Baseline

**Status:** binding. Applies to the architecture phase (`docs/prompts/04`), all
implementation work (`docs/prompts/06`), and every release. Agents must comply with
every `SEC-*` rule; a deviation requires the founder's written sign-off in
`docs/deviations.md`. Rules are floors, not ceilings. Parameters and library
choices marked "verify current" must be re-checked against the OWASP Cheat
Sheet Series and official platform security docs at implementation time —
guidance evolves.

Target standard: **OWASP ASVS Level 2** product-wide, **Level 3** for
cryptography, authentication, and the zero-knowledge notes module.

## 0. Threat model (summary)

**Assets, highest first:** private-note plaintext and keys; user credentials
and sessions; personal data (finance, health, study, files — much of it
sensitive by GDPR standards); the auto-update channel; the sync backend.

**Adversaries:** remote attacker abusing the public API; malicious registered
user (IDOR, abuse of shared notes/canvas); attacker with a stolen or borrowed
device; compromised or subpoenaed server — including us (zero-knowledge exists
precisely so this adversary gets nothing); supply-chain attacker (malicious
dependency, hijacked update feed); hostile content (crafted files fed to the
preview pipeline, malicious links); later: malicious plugins and prompt
injection against the AI assistant.

**Trust boundaries:** client ↔ server; Electron renderer ↔ preload ↔ main
process; app ↔ OS keystore; app ↔ user-supplied files and URLs; build ↔
release ↔ update pipeline. Validate at every boundary; trust nothing that
crossed one.

## 1. Golden rules

**Never:**

- Roll your own cryptography — no custom primitives, protocols, or "encoding as
  encryption".
- Store passwords in plaintext or reversibly; log credentials, tokens, keys, or
  private-note material anywhere.
- Commit secrets to the repo or ship them in any client binary (they are
  extractable, always).
- Build SQL or any query by string concatenation.
- Trust client input — every check the UI does, the server does again.
- Disable or weaken TLS certificate validation, in any environment flag that
  could reach production.
- Render user-supplied HTML/markdown unsanitized, or parse untrusted files in
  a privileged process.
- Use MD5/SHA-1 in security contexts, ECB mode, or unauthenticated encryption.

**Always:**

- Least privilege and deny-by-default at every layer; fail closed.
- Defense in depth — no single control's failure may expose an asset.
- Vetted, maintained libraries over hand-rolled security code.
- Keep Electron/Chromium and all dependencies current; security releases are
  adopted within days.
- Security review for any change touching auth, crypto, IPC, or file parsing.

## 2. Cryptography (SEC-CR)

- **SEC-CR-01** Vetted libraries only: libsodium, platform WebCrypto, OS
  keystores. No custom implementations of primitives or protocols.
- **SEC-CR-02** Symmetric encryption is AEAD only: XChaCha20-Poly1305
  (preferred) or AES-256-GCM.
- **SEC-CR-03** Nonces unique per encryption (random 192-bit for XChaCha20);
  key+nonce reuse is a critical bug.
- **SEC-CR-04** Password KDF: Argon2id with OWASP-current parameters (verify
  current; as of writing ≥ 19 MiB memory / 2 iterations minimum — prefer far
  higher on desktop). PBKDF2 only where Argon2 is unavailable, ≥ 600k
  iterations with SHA-256.
- **SEC-CR-05** All randomness for security purposes from a CSPRNG.
- **SEC-CR-06** Key hierarchy: data encrypted under random data-encryption keys
  (DEKs); DEKs wrapped by key-encryption keys derived from user secrets.
  Password change rewraps DEKs — it never re-encrypts data.
- **SEC-CR-07** Secret comparisons in constant time.

## 3. Accounts & authentication (SEC-AUTH)

- **SEC-AUTH-01** Server-side password storage: Argon2id, per-user salt.
- **SEC-AUTH-02** No user enumeration: login, registration, forgot
  password/username return uniform responses with comparable timing.
- **SEC-AUTH-03** Auth endpoints rate-limited per account and per IP with
  escalating delays; instrumented for credential-stuffing detection.
- **SEC-AUTH-04** Password reset: single-use token, ≤ 30 min TTL, stored
  hashed, invalidated on use and on any password change; all sessions revoked
  on reset.
- **SEC-AUTH-05** Email change requires re-authentication, verification of the
  new address, and notification to the old one. Email verification gates cloud
  features.
- **SEC-AUTH-06** Password policy: minimum length 8+ (encourage passphrases),
  screened against a breached-password corpus (k-anonymity style lookup); no
  composition rules, no forced periodic rotation.
- **SEC-AUTH-07** TOTP two-factor offered; recovery codes single-use and hashed
  at rest.
- **SEC-AUTH-08** Auth events (login, failure bursts, password/email change,
  new device) are audit-logged and, where relevant, user-notified.

## 4. Sessions & tokens (SEC-SES)

- **SEC-SES-01** Web sessions: cookies `httpOnly; Secure; SameSite=Lax` or
  stricter; IDs ≥ 128 bits CSPRNG; rotated on login and privilege change.
- **SEC-SES-02** Native clients: short-lived access token + refresh-token
  rotation with reuse detection — reuse revokes the whole token family.
- **SEC-SES-03** "Remember me" = long-lived refresh token, still rotated and
  individually revocable. Account settings show active sessions/devices with
  remote logout.
- **SEC-SES-04** Every session/token is revocable server-side; logout
  invalidates server-side state, not just the client copy.

## 5. Local accounts & device security (SEC-LOC)

- **SEC-LOC-01** A PIN is low-entropy — never use it directly as an encryption
  key. Derive the unlock key from PIN + a device-bound random secret held in
  the platform keystore (Android Keystore, Windows DPAPI/Credential Manager,
  macOS Keychain, libsecret on Linux).
- **SEC-LOC-02** PIN attempts throttled with escalating delays; the attempt
  counter is bound to keystore-protected state so it cannot be trivially reset.
- **SEC-LOC-03** Forgotten-PIN recovery exactly as specified in the notes: via
  the OS device credential (BiometricPrompt/device PIN, Windows Hello). Never
  security questions, never a backdoor code.
- **SEC-LOC-04** Local accounts generate **zero network traffic**. Enforced in
  code, asserted in automated tests.

## 6. Zero-knowledge private notes (SEC-ZK)

- **SEC-ZK-01** Encryption and decryption happen exclusively client-side; the
  server only ever stores and moves ciphertext.
- **SEC-ZK-02** Everything is ciphertext: content, titles, attachments, and the
  private-notes search index (built and encrypted client-side). Stored metadata
  is minimized to what sync strictly needs.
- **SEC-ZK-03** Keys per SEC-CR-04/06; the master key exists in plaintext only
  in client memory, and never reaches logs, crash dumps, or telemetry.
- **SEC-ZK-04** One-time recovery key generated by default at setup (user-held
  file or printout); the user either confirms they saved it or explicitly
  opts out through an informed "I accept the risk" step. The UI states
  plainly: lose the password and the recovery key, and the data is
  unrecoverable — by design.
- **SEC-ZK-05** AEAD associated data binds each ciphertext to note ID and
  version, preventing swap and rollback splicing.
- **SEC-ZK-06** Private-note plaintext never enters: server-side search,
  notification previews, OS content indexers, crash reporters, or any AI
  feature — unless the user explicitly opts in, per interaction.
- **SEC-ZK-07** Re-authentication (password; biometrics/PIN on Android) is
  required to open the private section after lock, exactly as the notes
  specify.

## 7. Data at rest & deletion (SEC-DAR)

- **SEC-DAR-01** The local database is encrypted at rest (SQLCipher-class),
  keyed via the OS keystore.
- **SEC-DAR-02** Backups and exports are encrypted with a user passphrase by
  default; plaintext export requires an explicit, informed confirmation.
- **SEC-DAR-03** Account deletion deletes server-side data within a defined,
  documented window, including expiry from backups. Deletion is real, not a
  flag.

## 8. Transport (SEC-TLS)

- **SEC-TLS-01** TLS 1.2 minimum, 1.3 preferred, everywhere. HSTS (with
  preload) on all web domains.
- **SEC-TLS-02** Certificate validation is never disabled — no dev-mode
  exceptions that can leak into release builds.
- **SEC-TLS-03** Certificate pinning in native clients only with a tested
  backup-pin and rotation plan; a botched pin bricks clients, so this is an
  explicit ADR, not a default.

## 9. API & backend (SEC-API)

- **SEC-API-01** Every endpoint authenticates and authorizes at the object
  level — the resource must belong to (or be shared with) the caller, checked
  on every request. IDOR is the top API risk; authorization tests are mandatory
  per endpoint.
- **SEC-API-02** All input schema-validated server-side (type, length, range,
  format); unknown fields rejected where practical; request body and pagination
  sizes capped.
- **SEC-API-03** Parameterized queries only, at the driver/ORM level.
- **SEC-API-04** Server-side fetches of user-supplied URLs (link previews,
  imports) pass an SSRF guard: http/https only; resolved IPs checked against
  private/link-local/metadata ranges; DNS-rebinding safe; redirects re-checked;
  size and time capped.
- **SEC-API-05** Public IDs are non-sequential (UUIDv4/ULID) — as hygiene,
  never as a substitute for SEC-API-01.
- **SEC-API-06** Client-facing errors are generic; detail goes to server logs
  only.
- **SEC-API-07** CORS: explicit origin allowlist; never wildcard with
  credentials.
- **SEC-API-08** Global and per-endpoint rate limits; abuse telemetry.

## 10. Files, previews & rendered content (SEC-FILE)

- **SEC-FILE-01** Every user file is hostile until proven otherwise. Preview
  and conversion parsing runs in a sandboxed, least-privilege process — no
  network, no filesystem beyond the target file, and never in Electron's main
  process.
- **SEC-FILE-02** File type determined by content (magic bytes), not extension;
  per-format size caps.
- **SEC-FILE-03** Archives: zip-slip prevented (normalize entries, reject
  escapes), decompressed size and entry counts capped (zip bombs).
- **SEC-FILE-04** Media processing hardened: pixel/dimension caps
  (decompression bombs), maintained codecs only; EXIF stripped on share.
- **SEC-FILE-05** User rich text/markdown/HTML rendered only through an
  allowlist sanitizer, with CSP as backstop. User content never reaches a
  privileged context (see SEC-EL-04).
- **SEC-FILE-06** Cloud-stored uploads live outside any web root under
  randomized names; served with correct `Content-Type` + `nosniff`, never
  executable or as HTML on the app origin (separate media origin or forced
  download).
- **SEC-FILE-07** Custom parsers (subtitles, importers) are tested against
  malformed and adversarial inputs; fuzzing where feasible.

## 11. Electron hardening (SEC-EL)

- **SEC-EL-01** Every `BrowserWindow`: `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`; `webSecurity` never touched.
- **SEC-EL-02** IPC is a minimal, typed API exposed via `contextBridge` in
  preload. Main validates every message (schema + sender frame). No generic
  "eval"/"invoke anything" channels.
- **SEC-EL-03** Navigation locked down: `will-navigate` and
  `setWindowOpenHandler` enforce allowlists; external links only through a
  vetted `shell.openExternal` wrapper (http/https only).
- **SEC-EL-04** Remote or user content never loads in a privileged window;
  previews render in sandboxed frames with no IPC surface.
- **SEC-EL-05** CSP on every local page; no inline scripts.
- **SEC-EL-06** Electron fuses set (`runAsNode` off, ASAR integrity on, cookie
  encryption on); Electron tracked on latest stable — Chromium CVEs are our
  CVEs.
- **SEC-EL-07** Releases code-signed (Authenticode; macOS notarization);
  auto-update only over TLS **with cryptographic signature verification** of
  updates. The update channel is a crown-jewel asset — a compromised feed is
  remote code execution on every user.

## 12. Web app & landing page (SEC-WEB)

- **SEC-WEB-01** Strict CSP (no `unsafe-inline`/`unsafe-eval`; nonces or
  hashes), `X-Content-Type-Options: nosniff`, `frame-ancestors` restriction,
  conservative `Referrer-Policy`.
- **SEC-WEB-02** CSRF: SameSite cookies plus anti-CSRF tokens on state-changing
  requests (when cookie-authenticated).
- **SEC-WEB-03** No third-party scripts on authenticated app pages. Landing
  page analytics only with consent, isolated from the app origin.

## 13. Android (SEC-AND)

- **SEC-AND-01** Keys in Android Keystore (hardware-backed where available);
  biometric unlock via `BiometricPrompt` with a `CryptoObject`, so keys are
  actually gated by the biometric, not by an if-statement.
- **SEC-AND-02** Local data via encrypted storage; backup rules exclude
  sensitive data; cleartext traffic disabled in the network security config.
- **SEC-AND-03** Exported components minimized; all incoming intents validated;
  `FLAG_SECURE` on private-note screens.
- **SEC-AND-04** R8 enabled; nothing secret ships in the APK — design assumes
  the APK is public.

## 14. Supply chain & secrets (SEC-SC)

- **SEC-SC-01** Lockfiles committed; versions pinned; automated dependency
  audit (OSV-based) plus an update bot, with human review of updates.
- **SEC-SC-02** New dependency = mini-review: maintenance, provenance,
  typosquatting check, install scripts. Prefer platform/stdlib over a package;
  minimal-dependency policy.
- **SEC-SC-03** Secret scanning (gitleaks-class) in CI and pre-commit; `.env`
  git-ignored from day one; dev/staging/prod credentials separated; any leaked
  secret rotated immediately, no exceptions.
- **SEC-SC-04** CI gates block merge: SAST (Semgrep/CodeQL-class), dependency
  scan, secret scan, plus the security test suite (SEC-VER-03).
- **SEC-SC-05** Only CI-built, signed artifacts are released; the release
  process is documented and repeatable.

## 15. Logging, monitoring & incident response (SEC-OPS)

- **SEC-OPS-01** Structured logs with an explicit denylist: credentials,
  tokens, keys, private-note material, unnecessary PII never logged; scrubbing
  before any third-party sink.
- **SEC-OPS-02** Audit trail for security-relevant events: auth, sharing
  changes, exports, deletions, permission changes.
- **SEC-OPS-03** Alerts on anomalies: failed-login bursts, refresh-token reuse,
  SSRF-guard hits, rate-limit saturation.
- **SEC-OPS-04** Backups encrypted, access-controlled, and restore-tested on a
  schedule — an untested backup is not a backup.
- **SEC-OPS-05** Incident-response runbook before commercial launch: severity
  levels, roles, user notification path, GDPR 72-hour breach-notification
  awareness.
- **SEC-OPS-06** `SECURITY.md` with a responsible-disclosure contact once the
  product is public.

## 16. Privacy (SEC-PRIV)

- **SEC-PRIV-01** Data minimization: every stored field has a justification;
  when in doubt, don't collect.
- **SEC-PRIV-02** Telemetry strictly opt-in and anonymized; none whatsoever for
  local accounts (SEC-LOC-04).
- **SEC-PRIV-03** Full export and real deletion (SEC-DAR-03) are product
  guarantees; a privacy policy ships with the public beta.

## 17. Plugins & AI (SEC-EXT)

- **SEC-EXT-01** Plugins run sandboxed (isolated worker/context) against a
  capability-based API — no direct filesystem, network, or DOM access;
  permissions declared and user-approved at install.
- **SEC-EXT-02** All LLM output is untrusted input: imported data is
  schema-validated before touching user data; model output never triggers
  actions without validation. When the integrated assistant can both read user
  content and act, prompt injection is assumed and mitigated (action
  confirmation, capability limits).
- **SEC-EXT-03** Published import prompts describe a public interchange format
  only — never internal schemas, endpoints, or implementation details (as the
  founder's notes require).

## 18. Verification & release gates (SEC-VER)

- **SEC-VER-01** Each module gets a lightweight threat-model pass at design
  time (STRIDE-style, ~30 minutes, documented in
  `docs/security/threat-models/`).
- **SEC-VER-02** The security test suite covers at minimum: per-endpoint
  authorization, rate limiting, sanitizer bypass attempts, IPC input
  validation, SSRF guard, zip-slip/zip-bomb cases, and the SEC-LOC-04
  no-network assertion.
- **SEC-VER-03** A release is blocked by: any failing security test, any
  unreviewed change to auth/crypto/IPC/parsing code, or any known-exploitable
  dependency vulnerability.
- **SEC-VER-04** External penetration test before charging money or storing
  meaningful third-party user volume.
