# ADR-010 — Landing Page Stack

**Status:** **SUPERSEDED on the hosting target** — Cloudflare Workers with
static assets (founder, 2026-08-08; see [084](084-web-readiness.md) for the
reasoning, and note that ADR itself says Pages, which Workers has since
replaced as Cloudflare's recommended start) · originally accepted 2026-07-05

> The decisive constraint was found later and is not in this file: a static host
> that cannot set HTTP response headers can send neither a CSP nor
> `frame-ancestors`, and a page that decrypts user data in a browser without a
> CSP has had its primary defence removed. That rules out GitHub Pages for the
> *app*; nothing here about the landing page's content or its analytics stance
> has changed.
**Drives:** LAND PRD; decision #11 (direct download + auto-update
distribution); LAND OQ#2 (analytics) resolved here; SEC-WEB.

## Context

Marketing site: hero, features, FAQ, pricing, download, blog. Deployable
independently of the app, best-possible Core Web Vitals (it *is* the first
product impression and must carry the anti-generic design system), blocked
on nothing — the name decision only gates the domain purchase, not the
build.

## Options considered

1. **Astro.** Static-first, zero JS unless an island opts in, content
   collections for the blog, React islands can reuse `packages/ui`
   components where worth it. MIT-licensed; acquired by Cloudflare
   (Jan 2026) with the framework staying open source — maintenance outlook
   strengthened.
2. **Next.js.** Right when marketing is fused to an authenticated app
   surface — it isn't here; ships router/hydration JS a static site never
   needs.
3. **Plain static/11ty.** Fine for v1, but no component sharing with
   `packages/ui`/`tokens`, which the design-consistency mandate wants.

## Decision

**Astro in `apps/landing`, fully static output, independent deploy.**

- Design tokens compile into the landing CSS from `packages/tokens` — the
  site and the app are visibly the same design language (founder
  consistency mandate); selective React islands only where interactivity
  earns it.
- Blog via content collections (Markdown), sr + en localized routes from
  launch (decision #2 i18n discipline applies to marketing too).
- **Downloads:** direct installers + electron-updater feed (decision #11)
  served from object storage behind the same CDN; checksums + signatures
  published beside binaries (SEC-SC).
- **Analytics (LAND OQ#2 resolved):** Plausible, EU-hosted (or self-hosted
  next to the backend) — cookieless, GDPR-clean, no consent banner needed;
  no third-party trackers, strict CSP, static headers per SEC-WEB.
- **Hosting:** any static host; default Cloudflare Pages for the CDN +
  preview deploys, with the note that EU data concerns are minimal for a
  static site with cookieless analytics. Can move to the VPS reverse proxy
  without code changes.

## Consequences

- The landing can ship before the app (waitlist mode) and iterate without
  touching app CI.
- Domain/name (founder decision #1 gate) blocks only DNS + brand strings —
  structure and content work proceed under the codename.

## Sources

- [Astro under Cloudflare, 2026 state](https://dev.to/polliog/astro-in-2026-why-its-beating-nextjs-for-content-sites-and-what-cloudflares-acquisition-means-6kl);
  [Astro vs Next.js for marketing sites](https://agnitestudio.com/blog/astro-vs-nextjs/).
- [Plausible Analytics](https://plausible.io/) — EU, cookieless.
