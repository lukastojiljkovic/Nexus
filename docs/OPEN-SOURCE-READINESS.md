# Open-source readiness

Audit of what Nexus needs before the repository, the binaries and the policies are
fit to publish. Written 2026-10-01 against `main` at `e5aae01`.

The goal is not "put it on GitHub". The goal is that a stranger can find it,
understand it, build it, trust it, and use it without ever needing to talk to the
author. Everything below is either a blocker, a release requirement or an optional
strengthening step.

**Decided:** Apache-2.0 (2026-10-01). `LICENSE`, `NOTICE`, the README licence
section and the root `license` field are prepared in the working tree.

---

## 1. Current state

| Area | Status |
| --- | --- |
| Repository | Private GitHub repo, `lukastojiljkovic/Nexus`, branch `main` |
| Code | Complete desktop app, web app and sync in one pnpm/Turborepo monorepo |
| CI | `ci.yml` (colour gate, build, typecheck, lint, tests), `security.yml` (gitleaks + dependency audit) |
| Dependency licences | `pnpm licenses list --prod` for `@nexus/desktop`: 303 packages. 240 MIT, 39 ISC, 9 Apache-2.0, 7 BSD-3-Clause, and one each of 0BSD, BlueOak-1.0.0, CC0-1.0, MIT AND Zlib, (MPL-2.0 OR Apache-2.0), Python-2.0, Unlicense, and `khroma` with no `license` field (it ships an MIT licence file, which the generator reproduces). No GPL/AGPL/SSPL/Commons-Clause. The whole workspace tree (668 packages) adds only permissive or data licences (CC-BY-4.0 `caniuse-lite`, WTFPL variants). Re-check on every release. |
| Third-party notices | Already solved for binaries: `apps/desktop/scripts/generate-licences.mjs` reads every notice off disk (including Apache `NOTICE` files and the fonts' OpenType name tables), `licences.test.ts` gates the output and CI runs `pnpm check:licences`. Shown in the app under Podešavanja → Licence (ADR-080). |
| Root docs | `README.md`, `CLAUDE.md`, `Makefile`, `tsconfig`, lint and CI config |
| Agent files | `CLAUDE.md` and `docs/prompts/` (7 prompt files) are tracked and would be published |
| Community files | `.github/CODEOWNERS`, `PULL_REQUEST_TEMPLATE.md`, `dependabot.yml` |
| Missing root files | `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `PRIVACY.md`, `TERMS.md`, `SUPPORT.md`, `ROADMAP.md` |
| Missing GitHub files | issue templates, `config.yml`, release workflow, CodeQL, dependency review, Scorecard |
| Licence | Apache-2.0 prepared (`LICENSE`, `NOTICE`, README, root `package.json`). ADR-080 and the header of `licences.ts` still describe Nexus as "commercial, closed-source". |
| Version today | The product is `@nexus/desktop` **1.3.0**. The workspace root is `0.0.0` and is never released. |
| UI language | Serbian only. Copy is centralized in `strings.sr.ts`, so an English locale is an extraction, not a rewrite. |
| Release target | `electron-builder.yml` publishes to `lukastojiljkovic/nexus-releases`, which does not exist. `electron-updater` is a dependency but deliberately not imported (see `apps/desktop/src/main/index.ts`). |
| Docs exposure | `docs/` is version-controlled and contains threat models, security hardening notes, PRDs, roadmaps and internal logs. `.gitignore` already warns that this must be revisited before the repo becomes public. |
| Dangerous local files | `supabase/.temp/start-secrets/**/docker.env` exists locally with generated local secrets. It is git-ignored (verified), but it must never be copied, zipped or attached to a release or an issue. |

The dependency mix is permissive, so **licence compatibility is not the blocker**.
The blockers are the docs/secret review, the name check, and the missing
policies and release pipeline.

---

## 2. Blockers

These must be done before the repository is made public.

### 2.1 Licence: Apache-2.0 (decided)

Chosen over MIT for the explicit patent grant from every contributor, and over
AGPL-3.0 because blocking a hosted fork is not a goal. It is compatible with
every dependency in the tree.

Prepared:

- `LICENSE`: the unmodified Apache-2.0 text.
- `NOTICE`: copyright line plus a pointer to the generated third-party notices.
  Apache-2.0 §4(d) requires redistributors to carry it, so keep it short.
- README `Licence` section and `"license": "Apache-2.0"` in the root `package.json`.

Still to do:

- Supersede ADR-080 with a short ADR: the notice obligation is unchanged (it
  binds any distributed binary, open or closed), only its "commercial,
  closed-source" premise changes. Update the header comment of
  `apps/desktop/src/renderer/src/licences.ts` to match.
- `packages/core/src/electronics/ros.ts` writes `<license>Proprietary</license>`
  into the ROS packages it generates for the user. That is the user's code, not
  Nexus's, and the comment says so. Leave it.

### 2.2 Review `docs/` before it becomes public

`docs/` contains:

- `docs/security/**` — threat models and hardening specifications
- `docs/prd/**` — 38 product requirement documents
- `docs/roadmap.md`, `docs/STATUS.md`, `docs/log/**`
- `docs/architecture/adr/**` — 86 architecture decision records

Public security documentation is good after the issues it describes are fixed.
It is a roadmap for an attacker while they are open. Before publishing:

1. Search for real project refs, pooler URLs, tokens, emails, names, prices,
   customer data and anything about unreleased commercial plans.
2. Decide per directory: publish, publish after redaction, or move to a private
   `docs-internal/` repository.
3. Replace live environment details with placeholders.
4. Add a short `docs/README.md` note saying which documents describe current
   behaviour and which are historical.

### 2.3 Scan the full git history, not just the working tree

`gitleaks` already runs in CI, but run it across all history before publishing:

```sh
gitleaks detect --source . --config .gitleaks.toml --redact
git log --all --oneline -- .env .env.* '**/.env*'
git rev-list --objects --all | grep -Ei '\.env|secret|credential|\.pem|\.p12'
```

If anything is found, rotate the credential first, then decide whether the
history needs rewriting. Deleting a commit is not enough once a secret has been
pushed.

### 2.4 Name and trademark check

"Nexus" is one of the most used product names in software (Sonatype Nexus,
Google Nexus, Nexus Repository, Nexus Mods, and many more). Before publishing:

1. Search GitHub, the Microsoft Store, winget, Flathub, npm and PyPI.
2. Search EUIPO TMview, the WIPO Global Brand Database and the Serbian
   Intellectual Property Office.
3. If the name is already taken in the relevant class, choose a distinctive
   name or a qualified one (for example "Nexus Desk" only if that is free).
4. If the name stays, add a `TRADEMARK.md` that says the code is licensed but
   the name and logo are not, and that the project is not affiliated with any
   other Nexus product.

Do not publish a logo or name policy that claims rights the project cannot
enforce.

### 2.5 Package metadata

Keep `"private": true` on the root and on every workspace package. In npm and
pnpm it only blocks `npm publish`; it has nothing to do with GitHub visibility
or the licence, and nothing here is meant for the npm registry. Flipping it
would only make an accidental publish possible.

Done: `"license": "Apache-2.0"` on the root. Optional, before the switch: add
`repository`, `homepage` and `bugs` to the root `package.json`.

### 2.6 Review the agent files

`CLAUDE.md` and `docs/prompts/` are tracked. Publishing them is fine and common,
but read them as a stranger would first: remove local paths, personal details,
pricing or business plans, and anything that only makes sense inside the
author's machine. Decide whether `docs/prompts/` is useful to contributors; if
not, move it out before the switch. Whatever stays, say in `CONTRIBUTING.md`
that AI coding tools are used and that `CLAUDE.md` holds the same rules as
`CONTRIBUTING.md`.

---

## 3. Required documents

### Root files

| File | Purpose | Notes |
| --- | --- | --- |
| `LICENSE` | The actual licence | Prepared: Apache-2.0, full text, unchanged. |
| `NOTICE` | Attribution (Apache-2.0) | Prepared. |
| `README.md` | Front door | Rewrite: what it is, screenshots, download, build, security, licence, contributing. Say up front that the UI is Serbian only. Licence section already updated. |
| `SECURITY.md` | How to report a vulnerability | Supported versions, private reporting, scope, response expectations, no bounty. |
| `CONTRIBUTING.md` | How to contribute | Build, test, lint, commit style, PR rules, DCO/CLA decision, code of conduct link. |
| `CODE_OF_CONDUCT.md` | Community behaviour | Contributor Covenant 2.1 is the standard choice. |
| `PRIVACY.md` | Data handling | Local data, opt-in E2EE sync, what Supabase sees, retention, GDPR/ZZPL, contact. |
| `TERMS.md` | Terms for distributed binaries | No warranty, limitation of liability, third-party components, trademark notice. |
| `THIRD-PARTY-NOTICES.md` | Dependency licences | Optional for the repo: the binaries already carry `licences.json`. If wanted, render it from that file in the release workflow; never hand-write it. |
| `CHANGELOG.md` | Release history | Keep a Changelog format, SemVer headings. |
| `SUPPORT.md` | Where to ask | Issues vs Discussions, what is in scope. |
| `ROADMAP.md` | Direction | Public, high level, no internal dates that will be missed. |
| `TRADEMARK.md` | Name and logo policy | Only after the name check. |

### GitHub files

| File | Purpose |
| --- | --- |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | Structured bug reports with version, OS, logs, reproduction. |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | Problem first, solution second. |
| `.github/ISSUE_TEMPLATE/config.yml` | Disables blank issues, links to Discussions and Security. |
| `.github/workflows/release.yml` | Builds, signs, attests and publishes artefacts on a tag. |
| `.github/workflows/codeql.yml` | Static analysis for TypeScript/JavaScript. |
| `.github/workflows/dependency-review.yml` | Blocks PRs that add vulnerable or licence-incompatible dependencies. |
| `.github/workflows/scorecard.yml` | OpenSSF Scorecard on a schedule. |
| `CODEOWNERS` | Already present. Keep it as the review rule. |

### Optional but valuable

- `GOVERNANCE.md` — who decides, how maintainers are added, how disputes end.
- `AUTHORS.md` — contributors worth naming.
- `FUNDING.yml` — only if there is a funding channel.
- `CITATION.cff` — only if the project is cited academically.
- `docs/ARCHITECTURE.md` — a short public map of the monorepo, separate from the ADRs.

---

## 4. Policies in detail

### 4.1 `PRIVACY.md`

Nexus is offline-first with opt-in encrypted sync, so the statement must be
exactly as narrow as the behaviour:

- Local-only mode: no network, no telemetry, no analytics, no crash reports.
- Sync off by default; the local path cannot reach the network, enforced by CI.
- When sync is on: account email, device records, timestamps and ciphertext
  reach Supabase; content stays encrypted on the client.
- Retention: what is deleted, what is soft-deleted, when it is purged.
- Legal basis, data subject rights, contact and the supervisory authority.
- GDPR and the Serbian Personal Data Protection Act (ZZPL).
- A "last updated" date and a changelog entry for every material change.

If telemetry is ever added, this document must be updated **before** the
release that adds it, and the feature must be opt-in.

### 4.2 `SECURITY.md`

- Supported versions: latest release and the previous minor, or a clear table.
- Private reporting through GitHub Security Advisories.
- In scope: sync crypto, key handling, IPC boundary, SQL stores, file preview,
  import/export, update channel.
- Out of scope: a compromised OS, a user who exports plaintext, physical access
  to an unlocked device.
- Response: acknowledgement target, triage target, disclosure coordination.
- No bug bounty unless one is funded; say so plainly.

### 4.3 `CONTRIBUTING.md`

Reuse the rules that already exist in `CLAUDE.md` and the Makefile:

- `make verify` must pass before a PR.
- One change per PR; no drive-by refactors.
- Tests are written test-first for data and store logic.
- User-facing copy is Serbian and lives in `strings.sr.ts`; code and docs are
  English. Say whether an English locale is welcome and how it would be added.
- No secrets, no personal data, no generated artefacts.
- Commit style follows the existing conventional prefixes.
- Decide DCO vs CLA. A DCO is contributor-friendly; a CLA retains relicensing
  flexibility. Do not require either without saying why.

### 4.4 `TERMS.md`

Free open-source software still ships binaries, and binaries carry obligations:

- What the app does and does not guarantee.
- No warranty, limitation of liability to the extent permitted by law.
- Third-party components: Electron/Chromium, better-sqlite3-multiple-ciphers,
  Excalidraw, TipTap, Mermaid and the rest; the user also agrees to their terms.
- Encryption notice: the app ships cryptographic functionality; check export
  control rules in the jurisdiction where the binaries are distributed.
- Trademark notice: "Windows" is a trademark of the Microsoft group; Nexus is
  not affiliated with or endorsed by Microsoft or any other Nexus product.
- Contact and change policy.

This is not legal advice. If Nexus ever charges money, adds ads, or hosts a
service, review the EU Product Liability Directive 2024/2853 and the Cyber
Resilience Act with a lawyer. Non-commercial open source is exempt from most of
the CRA, but that exemption disappears as soon as the project becomes
commercial.

### 4.5 `CODE_OF_CONDUCT.md`

Adopt Contributor Covenant 2.1 and add the enforcement contact. An empty
promise is worse than no policy; say who handles reports and how.

---

## 5. Release engineering

### 5.1 Versioning

Adopt SemVer and Keep a Changelog. The desktop app is already `1.3.0`, so the
first public release continues that line (for example `1.4.0`). Restarting at
`0.1.0` would look like a downgrade to every installed copy and to any future
updater. Start `CHANGELOG.md` at the first public version and summarize earlier
history in one entry.

### 5.2 Artefacts

| Platform | Format | Notes |
| --- | --- | --- |
| Windows | NSIS installer | Existing `dist` path; sign it. |
| Linux | AppImage + `tar.gz` | Existing Gentoo documentation; keep the guide current. |
| macOS | `.dmg` / `.zip` | Only when a maintainer can build and sign on macOS. Do not promise what cannot be tested. |

Each release needs:

1. A `SHA256SUMS` file.
2. Build provenance attestation (`actions/attest-build-provenance`).
3. An SBOM in CycloneDX format.
4. A changelog entry and release notes that state requirements, known
   limitations and the exact commit.
5. Third-party notices generated from the exact release tree.

### 5.3 Signing

Unsigned Windows builds trigger SmartScreen. Options:

- SignPath Foundation (free for eligible open-source projects).
- Azure Trusted Signing (check current eligibility and cost).
- An EV certificate if the project is commercial.

Do not claim a release is signed until the signature is verified on the
published artefact.

### 5.4 Update channel

Auto-update is already disarmed: `electron-updater` is a dependency but is not
imported, and the SEC-EL-07 comment in `apps/desktop/src/main/index.ts` lists
the three conditions for re-arming it (Authenticode signing with
`publisherName`, no silent download or install, and an Ed25519 signature over
`latest.yml` checked against a key compiled into the binary). Keep it disarmed
for the first public release.

The `publish` block in `electron-builder.yml` points at
`lukastojiljkovic/nexus-releases`, which does not exist. Once the source repo is
public there is no reason for a separate releases repo: point `publish.repo` at
`Nexus` and let the release workflow upload there.

### 5.5 Reproducibility

- Lockfile committed (already true).
- `engines` and `packageManager` pinned (already true).
- CI builds the release artefact, not a contributor laptop.
- Record the Node, pnpm and Electron versions in the release notes.

---

## 6. GitHub repository settings

Before the visibility switch:

- Description: one sentence, no marketing adjectives.
- Homepage: the project website, `https://lukastojiljkovic.github.io/Nexus/` (§6.1).
- Topics: `offline-first`, `electron`, `react`, `typescript`, `encryption`,
  `privacy`, `local-first`, `sqlite`, `supabase`, `productivity`.
- Social preview image with the real UI, not a logo on a gradient.
- Branch protection on `main`: required PR review, required CI, no force push.
- Secret scanning and push protection enabled.
- Dependabot alerts and security updates enabled.
- Private vulnerability reporting enabled.
- Discussions enabled, with categories for Q&A, ideas and show-and-tell.
- Labels: `good first issue`, `help wanted`, `security`, `bug`, `enhancement`,
  `documentation`.
- Pin a short "start here" issue for new contributors only if the project can
  actually support them.

### 6.1 Project website

`site/` holds the project's landing page and `.github/workflows/pages.yml`
publishes it to GitHub Pages, with the screenshots from `docs/images` copied in
beside it. Pages cannot serve a private repository on the current plan, so the
site goes live with the visibility switch. Before then:

- The download buttons point at `releases/latest` in this repository, so
  `publish.repo` (§5.4) and the release workflow must publish here.
- `llms.txt` links `docs/OVERVIEW.md`; keep it public through the `docs/` review
  (§2.2) or change the link.
- The footer links `LICENSE` and `NOTICE` only. Add `PRIVACY.md`, `TERMS.md`,
  `THIRD-PARTY-NOTICES.md` and `SECURITY.md` to it as they land.
- If the name changes (§2.4), the site, its canonical URL and the screenshots'
  window title change with it.
- Enable Pages with GitHub Actions as the source:
  `gh api -X POST repos/lukastojiljkovic/Nexus/pages -f build_type=workflow`.

---

## 7. Suggested order of work

| Order | Task | Blocking |
| --- | --- | --- |
| 1 | Licence, `LICENSE`, `NOTICE`, README licence section | Prepared, commit it |
| 2 | Supersede ADR-080; update the `licences.ts` header | Yes |
| 3 | Full-history secret scan and rotation if needed | Yes |
| 4 | `docs/` redaction review, agent files review | Yes |
| 5 | Name/trademark check | Yes |
| 6 | `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` | Yes |
| 7 | `PRIVACY.md`, `TERMS.md`, `THIRD-PARTY-NOTICES.md` | Yes for binaries |
| 8 | `CHANGELOG.md`, `SUPPORT.md`, `ROADMAP.md`, issue templates | Before the first public release |
| 9 | Release workflow with SBOM, checksums and attestations | Before the first public release |
| 10 | CodeQL, dependency review, Scorecard | Before or shortly after the first public release |
| 11 | Signing decision and first signed build | Before a broad announcement |
| 12 | Repository visibility switch, Pages, and announcement | Last |

---

## 8. Definition of done for the first public release

- [ ] `LICENSE` and `NOTICE` committed, README and ADRs agree with Apache-2.0.
- [ ] The release version continues from `1.3.0`; `publish.repo` points at a repository that exists.
- [ ] Full-history secret scan is clean, or every finding has been rotated.
- [ ] `docs/` has been reviewed and redacted.
- [ ] Name and trademark check is complete, with a written decision.
- [ ] README, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT, PRIVACY, TERMS and THIRD-PARTY-NOTICES exist and are current.
- [ ] CI is green on `main`; `make verify` passes locally.
- [ ] Release workflow produces a Windows installer and Linux artefacts with checksums, SBOM and attestation.
- [ ] Third-party notices are generated from the release tree.
- [ ] Release notes state requirements, limitations and the exact commit.
- [ ] Branch protection, secret scanning, Dependabot, private vulnerability reporting and Discussions are configured.
- [ ] The announcement names the licence and the exact supported platforms.

---

## 9. Sources

All links resolved on 2026-10-01.

- Choose a License — https://choosealicense.com/
- Open Source Guides, legal and licensing — https://opensource.guide/legal/
- GitHub community standards — https://docs.github.com/communities/setting-up-your-project-for-healthy-contributions
- Contributor Covenant 2.1 — https://www.contributor-covenant.org/version/2/1/code_of_conduct/
- Keep a Changelog — https://keepachangelog.com/
- Semantic Versioning — https://semver.org/
- OpenSSF Scorecard — https://github.com/ossf/scorecard
- SLSA build provenance — https://slsa.dev/
- CycloneDX SBOM — https://cyclonedx.org/
- EU Cyber Resilience Act and non-commercial open source — https://www.lpi.org/blog/2025/09/09/the-cyber-resilience-act-and-open-source/
- EU Product Liability Directive 2024/2853 — https://eur-lex.europa.eu/eli/dir/2024/2853/oj/eng
- Microsoft trademark guidelines — https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks
- SignPath Foundation — https://signpath.org/
- Windows Utility App Playbook, sections 12–14 (local, `Refreshify/WINDOWS-APP-PLAYBOOK.md`):
  legal documents, GitHub release and definition of done.
