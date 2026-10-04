# GitHub repository settings (web UI)

**Status: the repository is public; the settings below live only in the GitHub
web UI.** The in-repo half — CI, the security, CodeQL, Scorecard, release and
Pages workflows, the Dependabot config, the pull-request template and CODEOWNERS
— is committed under `.github/`. Run this list once before the first release and
again after any change to the repository's settings.

## Repository

- [x] Public repository, owner `lukastojiljkovic`
- [x] Default branch `main`
- [ ] Disable Wikis and Projects (unused attack and noise surface)

## Branch protection for `main` — Settings → Rules → Rulesets

- [ ] Require a pull request before merging (apply to admins too)
- [ ] Required status checks: `CI / verify`, `Security / Secret scan
      (gitleaks)`, `Security / Dependency audit`
- [ ] Require branches to be up to date before merging
- [ ] Block force pushes and branch deletion
- [ ] Merge method: **merge commit** (founder preference; squash only on
      request)

## Code security — Settings → Code security

- [ ] Dependabot alerts: ON
- [ ] Dependabot security updates: ON (version updates come from the committed
      `.github/dependabot.yml`)
- [ ] Secret scanning + push protection: ON
- [ ] Private vulnerability reporting: ON, matching the route
      [SECURITY.md](../../SECURITY.md) describes
- [ ] Code scanning: the CodeQL workflow is gated on
      `!github.event.repository.private`, so it starts by itself; confirm the
      first run on `main` is green

## Actions — Settings → Actions → General

- [ ] Allow GitHub-owned + verified creator actions only
- [ ] Default workflow permissions: read-only `GITHUB_TOKEN` (workflows also
      declare their own `permissions:` explicitly)
- [ ] Require approval for first-time outside contributors

## Later, when relevant

- [ ] Require signed commits (optional; set up SSH/GPG signing first)
- [ ] The `release.yml` draft release is published by a human after the
      artefacts, checksums and notes are read
