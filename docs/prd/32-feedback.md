# PRD 32 — Feedback (FDBK)

**Status:** draft 2026-07-05. Inputs: raw-spec §21, beta plan (§24),
SEC-OPS-01 (no PII in diagnostics), SEC-PRIV (consent).

## 1. Purpose

The founder's direct line to users during beta and beyond: feature requests,
bug reports, and impressions — collected with consent, structured enough to
act on, and closing the loop (users see what happened with their input).

## 2. User stories

- As a beta user, I want to request features and report bugs in-app, so
  that feedback costs me seconds.
- As a reporter, I want to attach context (screenshot, logs) knowingly, so
  that reports are useful without leaking my data.
- As a contributor, I want to see status of my submissions, so that
  feedback feels heard (beta-community building).

## 3. User experience & flows

Feedback entry (menu + SET + error screens): type picker (predlog /
greška / utisak) → short form (title, description; for bugs: optional
auto-context checkbox listing exactly what attaches — app version, OS,
module, sanitized recent log excerpt; optional screenshot with built-in
crop/redact) → submit (cloud) or export-as-file (local accounts, manual
send). "Moji predlozi" list with status (primljeno / planirano / u izradi /
isporučeno / neće — with short reason). Roadmap-lite public view (post-v1).

## 4. Functional requirements

- **FDBK-001 (M)** In-app submission of three types with per-type minimal
  forms; works for cloud accounts online; local accounts get export-a-file
  fallback (no hidden network, SEC-LOC-04).
- **FDBK-002 (M)** Diagnostic attachment is opt-in per submission, with the
  exact payload visible before send; logs pass the SEC-OPS-01 scrubber;
  screenshots pass through a redaction step (draw-over).
- **FDBK-003 (M)** Submission statuses maintained by the founder tooling
  (lightweight admin: list, tag, status, reply note); user sees status +
  optional reply in "Moji predlozi".
- **FDBK-004 (M)** Duplicate nudge: before submit, similar existing titles
  shown ("da li je ovo to?") with +1 (vote) instead of new entry.
- **FDBK-005 (S)** Voting on visible requests (beta cohort), sorted board
  view.
- **FDBK-006 (S)** Crash reporter integration: after a crash, next launch
  offers a prefilled bug report (opt-in, scrubbed) — never auto-send.
- **FDBK-007 (C)** NPS-style occasional utisak prompt (max 2×/year, never
  modal-blocking).

## 5. Options & settings

Feedback identity (nickname vs anonymous); crash-prompt on/off.

## 6. Integrations

SET (entry point, settings-search "0 results" hook per SET §7); NTF (status
change notification, opt-in); LAND (public roadmap-lite later); STATS (none
— feedback is explicit, telemetry is separate and stays opt-in).

## 7. Edge cases & error states

- Submit offline (cloud account) → queued with visible outbox, sends when
  online.
- Attachment too large → cap with message (logs excerpt bounded anyway).
- Abuse/spam (public voting) → rate limits (SEC-API-08), report action,
  founder moderation.
- Anonymous + status tracking → local token allows "Moji predlozi" without
  identity.
- Founder replies to a deleted account's feedback → status view simply
  gone; no orphan notifications.

## 8. Acceptance criteria (key)

- Bug report with auto-context shows the full exact payload preview; the
  sent bytes match the preview (test).
- Log scrubber test corpus (tokens, emails, note content) yields zero
  leaks in attached excerpts.
- Duplicate nudge surfaces an existing request on close-title submit; +1
  increments without creating a new item.
- Local account: submission produces a shareable file; no network attempt
  occurs.
- Status change (planirano) appears in user's list and fires opt-in NTF.

## 9. Open questions

1. Founder-side admin: in-app hidden admin mode vs tiny web dashboard —
   architecture (recommendation: web dashboard, same API).
2. ~~Public board in beta?~~ **Decided (founder 2026-07-05): curated
   statuses first; public board when cohort > ~100.**

## 10. Future extensions

Public roadmap page (LAND); changelog in-app tied to isporučeno items;
community discussions; paid-tier priority lanes (post-monetization).
