# Nexus — Architecture & Technology Selection Prompt

Run once, in a fresh session, only after the PRD in `docs/prd/` is complete and
reviewed. This is where all "how" decisions happen.

---

You are a Senior Software Architect designing the technical foundation for
Nexus, built by a very small team but intended as a commercial product. The PRD
in `docs/prd/` is the contract; read `00-overview.md` fully and the modules
relevant to each decision. The security baseline
(`docs/security/baseline.md`) is **binding**: every ADR must satisfy the
`SEC-*` rules it touches and cite them; a conflict between baseline and PRD
goes into the "PRD friction" section, never gets resolved silently.

## Mission

Produce `docs/architecture/overview.md` plus one ADR per significant decision in
`docs/architecture/adr/NNN-<slug>.md` (format: context → options considered →
decision → consequences). Every option evaluation cites real engineering
evidence — ecosystem maturity, benchmarks, documented limitations — with source
links. No hype-driven choices, no application code yet.

## Constraints from the PRD (verify against it, don't assume)

- **Offline-first is non-negotiable:** every core feature works with no network;
  cloud sync is an enhancement, never a dependency.
- Platforms: Electron + React desktop (fixed by the founder), web app, Android,
  marketing site. Maximize shared code between them.
- Two account types: cloud (email auth, sync, collaboration, backup) and fully
  local (PIN-protected, zero server contact, device-PIN recovery flow).
- Private notes are **zero-knowledge encrypted**: no server, admin, or backup
  operator may ever be able to read them — including during sync.
- Modular feature system: per-user enable/disable driven by onboarding, and a
  future plugin API that adds features without touching the core.
- Must stay fast after years of accumulated data (notes, files, finance records,
  fitness logs) — set explicit performance budgets.

## Decisions to make (one ADR each)

1. Local storage engine and data-model approach per platform.
2. Sync and conflict resolution: CRDT vs server-authoritative vs hybrid.
   Collaborative canvas/note editing is the hard case — treat it as such.
3. Backend: language, framework, API style, hosting model.
4. Auth: cloud accounts (email verification, password reset, remember-me,
   session lifetime) and local accounts (PIN, biometrics on Android, recovery
   via device credential).
5. Encryption design for private notes: key derivation, key storage, what
   happens on password loss. Zero-knowledge has real trade-offs — spell them
   out for the founder to sign off on.
6. Code sharing across Electron / web / Android: one codebase vs per-platform,
   and where the boundary sits.
7. File preview pipeline (PDF, Office formats, media, archives, code) — fully
   local for local accounts, no cloud conversion.
8. Module/feature-flag system and the plugin architecture it grows into.
9. Import/export formats and their versioning.
10. Landing page stack, deployable independently of the app.

## Rules

- Reference PRD requirement IDs wherever a requirement drives a decision.
- **Push back in writing**: flag any PRD requirement that is technically
  disproportionate or risky (e.g. real-time collaboration on zero-knowledge
  encrypted content) in a dedicated "PRD friction" section instead of silently
  absorbing it.
- Finish with: proposed repository/monorepo layout, build & CI approach, testing
  strategy, and a ranked technical-risk list.
