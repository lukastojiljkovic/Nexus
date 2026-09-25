# PRD 37 — Landing Page (LAND)

**Status:** draft 2026-07-05. Inputs: raw-spec §27, VISION.md, design-system
research (anti-generic mandate applies doubly here), founder rules: no
fabricated data/statistics ever; name pending (decision #1 — build
name-agnostic).

## 1. Purpose

The public face: convert visitors into downloads/signups by showing (not
claiming) what the product does, with the design quality proving the
product's design story. Deployable independently of the app (SEC-WEB-03
separation), name-swappable (codename gate).

## 2. User stories

- As a visitor, I want to understand in 10 seconds what this app replaces,
  so that I know if it's for me.
- As a skeptic, I want real screenshots and honest privacy claims, so that
  trust starts before install.
- As a Serbian/English visitor, I want the page in my language.
- As an interested user, I want download links per platform and a web-app
  entry, so that starting is one click.

## 3. User experience & flows

Single scroll narrative: **Hero** (one-line promise + real product visual +
download/web CTA) → **Problem** ("50 aplikacija") → **Pillars** (offline-
first, privacy/zero-knowledge, modularity, depth — each with a real UI
vignette) → **Feature sections** (interactive/animated real screenshots:
dashboard, canvas, study, private notes lock) → **Privacy manifesto**
(plain-language: local accounts, E2E private notes, full export, no
telemetry by default) → **FAQ** → **Pricing** (beta: free, full access;
future tiers "uskoro" honestly) → **Download** (Win/macOS/Linux + web app;
Android "uskoro") → **Footer** (blog, kontakt, legal, security.txt).
Motion: tasteful entrance animations per design-system motion budget;
dark/light aware.

## 4. Functional requirements

- **LAND-001 (M)** Static-first site (no app runtime dependencies), CDN-
  deployable, independent repo/deploy path (architecture decision #10);
  meets SEC-WEB-01/03 headers; no third-party scripts except consented
  analytics (SEC-PRIV-02 spirit: privacy-respecting analytics only).
- **LAND-002 (M)** Localization: sr + en with language switch + hreflang;
  content source structured for adding languages (decision #2 later set).
- **LAND-003 (M)** Real content only: screenshots generated from the actual
  app with staged-but-real data; zero invented numbers/testimonials
  (CLAUDE.md rule elevated to requirement); claims audited against shipped
  features per release.
- **LAND-004 (M)** Download section: per-platform artifacts with checksums
  + signature note (SEC-EL-07 trust story), version + changelog link;
  web-app link.
- **LAND-005 (M)** Performance/quality budget: LCP < 2 s on mid-range
  mobile, Lighthouse ≥ 95 across categories, WCAG AA.
- **LAND-006 (M)** SEO/social: meta/OG cards, sitemap; name-agnostic
  templating so the Vesper/codename swap is config, not rewrite.
- **LAND-007 (S)** Blog (SSG): announcements, build-in-public posts; RSS.
- **LAND-008 (S)** FAQ sourced from a structured file (reusable in-app
  help later).
- **LAND-009 (S)** Beta signup: email capture with double opt-in, plain
  privacy note, export/delete honored (GDPR basics; SEC-PRIV-03).
- **LAND-010 (C)** Public roadmap-lite (FDBK integration later).
- **LAND-011 (C)** Press kit page (logo, screenshots, boilerplate).

## 5. Options & settings

n/a (site); CMS-less — content in repo, founder edits via PR-style flow.

## 6. Integrations

FDBK (roadmap later); web app (shared design tokens — the site must look
like the app family); release pipeline (artifact links + checksums
auto-updated); analytics (consented, privacy-respecting, self-hosted class
— architecture picks).

## 7. Edge cases & error states

- Downed download CDN → fallback mirror link logic.
- Language auto-detect wrong → manual switch persists (localStorage, no
  cookies banner needed if analytics consent handled correctly).
- Screenshot drift (UI changed) → release checklist item: refresh
  screenshots (LAND-003 audit).
- JS disabled → full content readable (static-first), animations degrade.

## 8. Acceptance criteria (key)

- Lighthouse ≥ 95 all categories on hero page, mobile emulation.
- Both locales complete (no untranslated strings), hreflang valid.
- Every factual claim on the page maps to a shipped feature (audit
  checklist passes); zero numeric claims without a verifiable source.
- Headers pass securityheaders-class scan (CSP, HSTS…).
- Site deploys with app-name from config; swapping name/logo touches no
  content files.

## 9. Open questions

1. Domain purchase timing (blocked on name decision #1).
2. Analytics choice (privacy-respecting, EU-hostable) — architecture.
3. ~~Beta distribution.~~ **Decided (founder 2026-07-05): direct downloads
   with auto-update only; store channels later.**

## 10. Future extensions

Interactive live demo (web app sandbox mode); localized landing per future
languages; template/community gallery; affiliate/referral for launch.
