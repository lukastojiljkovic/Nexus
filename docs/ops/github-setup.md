# GitHub repository settings (web UI)

**Status: the repository is public, and every setting below was applied on
2026-10-05, except the release environment and the last section.** They live only in the GitHub web UI and
its API. The in-repo half — CI, the security, CodeQL, Scorecard, release and
Pages workflows, the Dependabot config, the pull-request template and
CODEOWNERS — is committed under `.github/`. Run this list once before the first
release and again after any change to the repository's settings.

## Repository

- [x] Public repository, owner `lukastojiljkovic`
- [x] Default branch `main`
- [x] Disable Wikis and Projects (unused attack and noise surface)

## Branch protection for `main` — Settings → Rules → Rulesets

- [x] Require a pull request before merging, with no bypass, admins included
      (ruleset `main`, no approving review required: there is one maintainer)
- [x] Required status checks: `CI / verify`, `CI / database`, `Security /
      Secret scan (gitleaks)`, `Security / Dependency audit`
- [x] Require branches to be up to date before merging
- [x] Block force pushes and branch deletion
- [x] Merge methods: **merge commit** (founder preference) and squash, for
      when it is asked for

## Code security — Settings → Code security

- [x] Dependabot alerts: ON
- [x] Dependabot security updates: ON (version updates come from the committed
      `.github/dependabot.yml`)
- [x] Secret scanning + push protection: ON
- [x] Private vulnerability reporting: ON, matching the route
      [SECURITY.md](../../SECURITY.md) describes
- [x] Code scanning: the CodeQL workflow is gated on
      `!github.event.repository.private`, so it started by itself; its first
      run on `main` (2026-10-05) is green, as is Scorecard's

## Actions — Settings → Actions → General

- [x] Allow GitHub-owned actions plus the two third-party actions the
      workflows use (`pnpm/action-setup`, `ossf/scorecard-action`), and require
      SHA pinning: every `uses:` is pinned already. The list also binds actions
      nested inside a composite one, which is why the Supabase CLI comes from
      its release tarball rather than `supabase/setup-cli`
- [x] Default workflow permissions: read-only `GITHUB_TOKEN` (workflows also
      declare their own `permissions:` explicitly)
- [x] Require approval for first-time outside contributors

## Release signing key — Settings → Environments

- [ ] Environment `release`, limited to tags matching `v*`: the `sign` job in
      `release.yml` declares it, and it is the only job that reads the key
- [ ] `NEXUS_RELEASE_SIGNING_KEY` as a secret of `release`, then the
      repository-level secret of that name deleted (it was set there on
      2026-10-07, before the environment existed)

## Later, when relevant

- [ ] Require signed commits (optional; set up SSH/GPG signing first)
- [ ] The `release.yml` draft release is published by a human after the
      artefacts, checksums and notes are read
