# PRD 05 — Notifications (NTF)

**Status:** draft 2026-07-05. Inputs: raw-spec §26 (napredne notifikacije:
snooze, prioriteti, smart reminders), onboarding research (appetite question
moved to first notification moment), SEC-ZK-06 (no private-note content in
notifications).

## 1. Purpose

One delivery system for every module's reminders and alerts — reliable
offline (local scheduling, no server dependency), respectful by default, and
centrally controllable so the all-in-one app never becomes an all-in-one
nuisance.

## 2. User stories

- As a user, I want reminders to fire on time even offline, so that the
  offline-first promise includes notifications.
- As a busy user, I want to snooze anything with one action, so that
  reminders adapt to reality.
- As a notification-averse user, I want per-module control and quiet hours,
  so that the app respects my attention.
- As a security-conscious user, I want login alerts but no sensitive content
  on my lock screen.

## 3. User experience & flows

Native OS notifications (Windows/macOS/Linux; Android later; web app v1 is
in-app-only, browser push later) plus an in-app notification center (bell) listing
recent, snoozed, and missed items. First notification-worthy moment triggers
the appetite question (minimalno/normalno/sve) — not onboarding. Snooze
options on every reminder (10 min / 1 h / večeras / sutra ujutru / custom).
Quiet hours schedule; per-module toggles and priority levels.

## 4. Functional requirements

- **NTF-001 (M)** Modules shall schedule notifications through a single NTF
  contract (source module, entity link, priority, schedule, content
  template); no module fires OS notifications directly.
- **NTF-002 (M)** Scheduling and firing shall be fully local; cloud accounts
  may additionally deliver push (Android/web) later without changing module
  contracts.
- **NTF-003 (M)** Every notification shall support: open-target deep link,
  snooze presets + custom, and dismiss; task reminders add "complete" as an
  inline action.
- **NTF-004 (M)** Notification center shall list delivered/snoozed/missed
  notifications (missed = fired while device off; shown on next launch as a
  digest, never a storm).
- **NTF-005 (M)** Per-module enable/priority settings and global quiet hours
  (with exception list for max-priority, e.g. document expiry final
  warning).
- **NTF-006 (M)** Private-note-related notifications shall never include
  content or titles (SEC-ZK-06) — generic text only ("Podsetnik u privatnoj
  belešci").
- **NTF-007 (M)** Security notifications (AUTH-021) shall be max priority
  and not suppressible by quiet hours.
- **NTF-008 (S)** Appetite presets (minimalno/normalno/sve) should map to
  per-module defaults, asked at first notification moment and changeable in
  settings.
- **NTF-009 (S)** Smart batching: non-urgent notifications within a short
  window coalesce into one.
- **NTF-010 (C)** Smart reminders (learn snooze patterns, suggest better
  default times) — post-v1, local heuristics only.

## 5. Options & settings

Per-module toggles + priority; quiet hours; appetite preset; snooze presets
customization; digest behavior on launch; sound on/off per priority.

## 6. Integrations

All modules via NTF-001 contract (TASK reminders, CAL events + expiry
ladders, STUDY review/plan nudges, FIN renewals, HABIT check-ins, AUTH
security alerts). SET (settings surface); DASH (bell/badge widget).

## 7. Edge cases & error states

- Device asleep at fire time → deliver on wake if still relevant (relevance
  window per notification type); expired-relevance items go to missed
  digest only.
- OS permission denied (web/Android) → in-app center still works; honest
  degraded-mode banner in settings.
- Snoozed reminder's entity completed/deleted meanwhile → snooze silently
  cancelled.
- Clock/timezone changes → reschedule pass over all pending notifications.
- Notification storm guard: > N due simultaneously → single grouped
  notification.
- Profile separation: business notifications don't render while personal
  profile is active beyond a neutral badge (decision #4 spirit), except
  calendar-overlay events which are marked.

## 8. Acceptance criteria (key)

- With network disabled, a task reminder fires on time on desktop.
- Snooze "sutra ujutru" re-fires at the configured morning hour.
- Quiet hours suppress normal reminders, deliver them as digest after, and
  do not suppress a document-expiry final warning or security alert.
- A private-note reminder shows no title/content anywhere in OS UI.
- Killing the app for two days then launching yields one missed digest, not
  40 notifications.

## 9. Open questions

1. ~~Web push in v1 web app or in-app-only there?~~ **Decided (founder
   2026-07-05): in-app only on web in v1; browser push later.**
2. ~~Default morning hour for "sutra ujutru".~~ **Decided (founder
   2026-07-05): 08:00, changeable in settings.**
3. Per-list task reminder defaults — TASK setting or NTF? (TASK owns.)

## 10. Future extensions

Android wearables; scheduled summaries ("nedeljni pregled u nedelju uveče");
cross-device dismiss sync; location triggers (with CAR/errands).
