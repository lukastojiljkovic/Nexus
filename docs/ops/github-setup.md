# GitHub repo setup checklist (one-time, web UI)

Status: **pending** — do these when the remote repo is created. The in-repo
half (CI + security workflows, Dependabot config, PR template, CODEOWNERS)
is already committed under `.github/`.

## Repository

- [ ] Private repository, owner `lukastojiljkovic`
- [ ] Default branch `main`
- [ ] Disable Wikis / Projects / Discussions (unused attack & noise surface)

## Branch protection for `main` — Settings → Rules → Rulesets

- [ ] Require a pull request before merging (apply to admins too)
- [ ] Required status checks: `CI / verify`, `Security / Secret scan (gitleaks)`,
      `Security / Dependency audit`
- [ ] Require branches to be up to date before merging
- [ ] Block force pushes and branch deletion
- [ ] Merge method: **merge commit** (founder preference; squash only on request)

## Code security — Settings → Code security

- [ ] Dependabot alerts: ON
- [ ] Dependabot security updates: ON
      (version updates come from the committed `.github/dependabot.yml`)
- [ ] Secret scanning + push protection: ON if available on the plan;
      for a private repo the gitleaks CI job is the working substitute
- [ ] Private vulnerability reporting: ON if the repo ever goes public

## Actions — Settings → Actions → General

- [ ] Allow GitHub-owned + verified creator actions only
- [ ] Default workflow permissions: read-only `GITHUB_TOKEN`
      (workflows also declare their own `permissions:` explicitly)
- [ ] Require approval for first-time outside contributors

## Later (when relevant)

- [ ] ESLint baseline across packages → then add `lint` to CI and require it
      as a status check (currently no package defines a lint script)
- [ ] CodeQL — when the repo is public or GH Advanced Security is available
- [ ] Require signed commits (optional; set up SSH/GPG signing first)
- [ ] Release/packaging workflow (electron-builder) once v0 packaging starts
