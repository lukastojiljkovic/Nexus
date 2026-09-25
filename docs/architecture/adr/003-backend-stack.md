# ADR-003 — Backend Stack

**Status:** **SUPERSEDED — the backend is Supabase** (founder, 2026-08-08).
Previously: accepted, revised by founder decision 2026-07-05 to Go, which
superseded the same-day Kotlin/Spring draft; decision history below.

> **Nothing in this file describes what is deployed.** There is no Go service,
> no self-managed EU VPS and no hand-rolled session layer. The backend is
> **Supabase**: Postgres with row-level security as the wall, PostgREST as the
> wire, GoTrue for auth with MFA enforced through aal2-restrictive policies, and
> Edge Functions for the three operations a client may not perform for itself.
> What is actually built is thirteen migrations, three Edge Functions and 109
> pgTAP assertions — see `supabase/` and `STATUS.md` §2.
>
> Kept because the *requirements* it derived — what the server must never see,
> what it must enforce rather than trust, the operational obligations — did not
> change with the vendor, and because the rejected alternatives are worth not
> re-litigating.
**Drives:** AUTH, SHARE, FDBK, sync write path (ADR-002), blob storage;
SEC-API, SEC-AUTH, SEC-SES, SEC-TLS, SEC-OPS.

## Context

The backend is deliberately thin: auth, sync write validation, Postgres,
blob storage, sharing ACLs, email, feedback intake. All product
intelligence lives client-side (offline-first). The team is one person;
the product is commercial, so operational boredom and longevity outrank
novelty.

## Options considered

1. **Go + PostgreSQL.** Small static binaries (tens of MB RSS vs a JVM's
   hundreds), instant startup, first-class concurrency for an I/O-bound
   API, tiny deployment surface (single binary in a scratch-class
   container), strong standard library (`net/http` routing since 1.22),
   `golang.org/x/crypto` for Argon2id. Cost: the founder learns the
   language while writing security-critical code — mitigated below.
2. **Kotlin + Spring Boot 3 (JVM 21).** Founder's deepest server stack;
   Spring Security ships hardened auth building blocks. Cost: ~300–500 MB
   idle RSS on the VPS, slower cold starts, heavier images. Was the
   original pick on bus-factor grounds.
3. **NestJS/Fastify (TypeScript).** One language repo-wide, but weaker
   founder ops depth on Node servers and the most assemble-it-yourself
   auth story of the three.
4. **Python.** Slowest for a concurrent API server; founder's Python is
   ML-side; wrong tool here. If the future AI module wants Python it
   becomes its own sidecar service.

## Decision history (kept on record)

- Original decision (2026-07-05, morning): Kotlin/Spring on bus-factor +
  Spring Security grounds.
- Founder challenged it same day ("JVM too slow/heavy?"). Corrected
  premise established first: **the backend never runs on user machines** —
  user-side RAM is governed by the Electron app (its <400 MB idle budget
  lives in the overview), so backend choice is invisible to users; the
  footprint difference affects only our VPS.
- With that correction on the table, the founder still chose **Go** —
  language preference, server footprint/hosting economics, and career
  value. Legitimate founder call, made at the only cheap moment (zero
  backend code existed). Recorded, accepted.

## Decision

**Go (latest stable, currently 1.2x line), PostgreSQL 16+, REST/JSON with
an OpenAPI contract.**

- **Shape:** standard library `net/http` + `http.ServeMux` method/path
  routing; dependencies added only when stdlib genuinely runs out
  (SEC-SC-01: minimal supply chain). Postgres via `pgx`; typed query
  generation (sqlc-class) decided at implementation. Argon2id via
  `golang.org/x/crypto/argon2` with OWASP-current parameters (SEC-CR).
- **API contract:** spec-first OpenAPI; server stubs via `oapi-codegen`,
  TS client for `packages/core` generated from the same spec in CI so
  frontend/backend drift fails the build (this was the Spring plan's
  type-sharing recovery — unchanged).
- **Security mitigation for the new-language risk (binding):** auth,
  session, and reset-flow code stays minimal, isolated in one package,
  built on `x/crypto` primitives only, and every change to it gets the
  explicit baseline review pass (prompt-06 rule) plus test vectors and
  negative tests before merge. No hand-rolled crypto beyond parameter
  wiring. SEC-AUTH-02 anti-enumeration and SEC-SES token rules are
  implemented once, reviewed hard, then frozen.
- **Modules:** auth (ADR-004), sync-write endpoint + bucket rules
  (ADR-002), share/ACL service, blob service (content-addressed,
  S3-compatible EU object storage, presigned upload/download,
  SEC-FILE-02 server-side validation), feedback intake (FDBK), email via
  an EU-friendly transactional provider (SPF/DKIM mandatory, SEC-OPS).
- **Hosting:** Docker Compose on an EU VPS (Hetzner class): reverse proxy
  (TLS 1.2+/1.3, HSTS — SEC-TLS), the Go binary, Postgres, PowerSync
  service, object storage. Go's footprint leaves comfortable headroom on
  8 GB; managed Postgres remains the ops escape hatch. Daily encrypted
  off-site backups with restore drills (SEC-OPS-03).
- **Observability:** structured logs with no PII/content (SEC-OPS-02),
  Prometheus metrics, uptime alerting; rate limiting at proxy +
  per-account application limits (SEC-API-03).

## Consequences

- Two toolchains in the monorepo (Go + pnpm); CI treats `backend/` as its
  own unit (`go vet`, `golangci-lint`, `go test` + Testcontainers-Go).
- Founder invests learning time up front; the thin-backend scope keeps
  that bounded, and the deferred timeline helps — the backend is a
  v0.x-beta deliverable, not v0 (roadmap), so learning starts against
  non-critical endpoints (FDBK intake) before auth is written.
- Single static binary simplifies deploys and shrinks images to a few MB;
  cold starts stop mattering entirely.
- OpenAPI codegen remains load-bearing; contract tests guard it
  (overview testing strategy).
