# ADR-006 — Code Sharing Across Electron / Web / Android

**Status:** accepted for desktop+web; Android direction set with a
**mandatory re-check gate at Android kickoff** · 2026-07-05
**Drives:** monorepo layout (overview), platform-parity cross-cutting
concern, decision #9 (Android after desktop+web); SEC-EL-01..04.

## Context

Electron + React is founder-fixed for desktop. The web app must be ≈
desktop (PRD parity rule). Android comes later, "adapted, not reduced".
Founder's personal stack includes both React/TS and Kotlin Compose — so
Android has two credible paths and no forced answer today.

## Options considered

1. **One React codebase for desktop + web; Android = React Native (Expo)**
   reusing `packages/core`/`db` (op-sqlite has a PowerSync-compatible
   SQLite path; Yjs runs in RN; expo-sqlite/op-sqlite are
   production-grade in 2026). UI is rebuilt mobile-native in RN primitives
   but logic, sync, schema, and tokens carry over.
2. **Android native (Kotlin + Compose).** Founder skill, best platform
   feel. Cost: second implementation of *all* domain logic, and the Yjs
   problem — Kotlin bindings for yrs (`ykt`) are inactive/unmaintained, so
   collaborative documents would need a Rust-core rewrite (uniffi) or a
   WebView island for the editors.
3. **Capacitor wrapper around the web app.** Cheapest, but "adapted, not
   reduced" dies in a webview shell; rejected on product grounds.

## Decision

- **Desktop + web share one React app.** `apps/desktop` is an Electron
  shell around the same renderer `apps/web` serves; platform differences
  live behind a `platform` interface in `packages/core` (fs, notifications,
  keystore, windowing). Electron hardening per SEC-EL: contextIsolation on,
  nodeIntegration off, sandboxed renderers, typed IPC allowlist in preload,
  CSP in production builds.
- **Shared packages are the law:** `core` (domain + contracts + sync),
  `db` (schema/migrations), `crypto`, `ui` (design system + views engine),
  `tokens` (Style Dictionary → CSS vars now, Compose/RN themes later).
  Nothing in `apps/*` may own business logic — enforced in review; this
  same discipline is the PLUG groundwork (ADR-008).
- **Android default path: React Native + Expo** reusing `core`, `db`
  (op-sqlite), `crypto` (libsodium RN build), and `tokens`. **Kickoff
  gate:** before Android work starts, re-evaluate against native
  Kotlin/Compose with one question — has the RN reuse assumption survived
  desktop+web reality (core truly platform-free, Yjs-in-RN validated by a
  spike)? If core turns out entangled or the RN toolchain fights us, the
  fallback is native Kotlin over the same backend/sync protocol, with
  editors in WebView islands.

## Consequences

- Web parity is nearly free; the real tax is keeping `core` genuinely
  platform-agnostic — CI runs its tests in Node and browser
  environments to keep it honest.
- Design tokens must compile to more than CSS from day one (Style
  Dictionary multi-target), or Android inherits drift later.
- The Android bet is explicitly deferred and de-risked: worst case is a UI
  rewrite, never a data-model or protocol rewrite.

## Sources

- [op-sqlite / RN SQLite landscape 2026](https://vibe.forem.com/eira-wexford/best-sqlite-solutions-for-react-native-app-development-in-2026-3b5l);
  [PowerSync React Native & Expo SDK](https://docs.powersync.com/client-sdks/reference/react-native-and-expo);
  [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/).
- [ykt (Kotlin yrs bindings) — inactive](https://github.com/y-crdt/ykt) —
  the fact that sinks "native Kotlin with CRDTs" as a default.
