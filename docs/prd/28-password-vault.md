# PRD 28 — Password Vault (VLT) — deferred stub (W)

**Status:** deferred by founder decision #8 (2026-07-04): Won't-have until
well after v1 **and** an external penetration test (SEC-VER-04 passed).

## Recorded intent

Locally encrypted credential storage (raw-spec §26 "opciono"). If revived:
zero-knowledge architecture per SEC-ZK patterns, PRIV-grade unlock UX,
no browser-extension autofill in first iteration (largest attack surface),
import from Bitwarden/KeePass formats.

## Revival gate

Pen test passed + founder go + dedicated threat model (STRIDE, SEC-VER-01)
+ its own ADR set. Until then: no code, no schema, no UI references.
Competing free mature tools (Bitwarden, KeePassXC) make this low-priority;
the module exists in the registry so the prefix stays reserved.
