# PRD 26 — Read Later & Bookmarks (READ) — compact (C-tier)

**Status:** draft 2026-07-05. Inputs: raw-spec §26 (read later, bookmark
manager), SEC-API-04 (fetching), quick-capture idea.

## Purpose

One inbox for the web you mean to return to: articles saved readable
offline, plus organized bookmarks — instead of 400 browser tabs.

## Functional requirements

- **READ-001 (M)** Save URL (paste, quick capture, browser-bookmark import
  via IMEX-007): fetch title/favicon/preview; article extraction to clean
  reader view stored offline (cloud accounts fetch via SSRF guard; local
  accounts fetch client-side).
- **READ-002 (M)** Reader view: typography per design system, progress
  memory, highlight → NOTE excerpt action.
- **READ-003 (M)** Organization: folders + tags (taxonomy consistent with
  NOTE), read/unread/archived states, search incl. article text (SRCH).
- **READ-004 (S)** PDF saves land as DOC files tagged read-later (unified
  "biblioteka za čitanje" view with LIB later).
- **READ-005 (S)** Dead-link detection on open (archived copy is the
  point: reader copy survives link rot).
- **READ-006 (C)** RSS-lite: follow a few feeds into the inbox (post-v1
  candidate; scope guard — Nexus is not a feed reader).

## Integrations

Quick capture (URLs route here); NOTE (highlights); SRCH; IMEX (browser
bookmarks HTML); CANV (link cards can save-to-READ).

## Edge cases

Paywalled/JS-heavy pages → extraction fails gracefully, bookmark-only mode
with notice; very long articles → reader pagination; media-heavy pages →
image caps (SEC-FILE-02 spirit); duplicate URL saves → merge prompt.

## Open questions

1. Full-page snapshot (MHTML-class) vs extracted-article-only storage —
   storage cost vs fidelity; recommendation: article-only v1.
