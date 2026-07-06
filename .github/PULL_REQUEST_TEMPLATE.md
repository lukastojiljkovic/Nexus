# What

<!-- One or two sentences: what this PR does and why.
     Reference the requirement ID(s) it implements, e.g. TASK-004. -->

## Checklist

- [ ] `pnpm build`, `pnpm typecheck` and `pnpm test` pass locally
- [ ] Styling uses design tokens only — no raw colors outside `packages/tokens`
- [ ] No new runtime dependencies (or justified below)
- [ ] IPC / preload / CSP changes reviewed against the SEC-EL hardening rules
- [ ] Acceptance criteria of touched requirements are covered by tests
- [ ] Nothing from `docs/` is committed
