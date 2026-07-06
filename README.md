# Nexus

Offline-first, modular life-management platform. Desktop (Electron + React),
web, Android (later).

Monorepo: pnpm workspaces + Turborepo.

```sh
pnpm install
pnpm build
```

| Path | What |
| --- | --- |
| `packages/tokens` | Design tokens (source of truth for all styling) |
| `packages/ui` | Design system components + views engine |
| `apps/*` | Application shells |
