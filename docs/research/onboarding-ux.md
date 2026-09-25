# Research: Onboarding UX (questionnaire → personalized app)

**Domain:** onboarding flows, personalization surveys, progressive disclosure,
activation research.
**Session:** 2026-07-05 (research phase 1, session 7).
**Nexus context:** the onboarding questionnaire is the heart of the modularity
philosophy (founder: "jako bitno da korisnik ne dobije milion stvari") —
elaborated in `docs/notes/razrade.md`. ONB is (M). This research validates
parts of the razrada and **revises its structure** (see §4).

## 1. Conclusions

1. **Personalization pays, but every blocking screen costs.** Personalized
   onboarding lifts activation 30–50% vs generic flows — but each additional
   screen before first value drops completion ~10–15%, and a six-screen
   pre-value flow loses over half of installers; products reaching value in
   under 5 minutes activate ~3× better
   ([onboarding best practices](https://vmobify.com/blog/app-onboarding-best-practices),
   [Userpilot onboarding guide](https://userpilot.com/blog/user-onboarding-guide/)).
   Consequence: our questionnaire cannot be a long wizard. It splits into a
   **minimal blocking core (3–4 screens)** plus **progressive depth** asked
   inside modules when first opened.
2. **The Notion pattern is our pattern, plus one missing piece.** Notion asks
   use-case + role, then *pre-configures the workspace with example content*
   so the first screen already feels personal
   ([Notion onboarding teardown](https://www.candu.ai/blog/how-notion-crafts-a-personalized-onboarding-experience-6-lessons-to-guide-new-users)).
   We had the answer→feature-flag mapping; the missing piece is
   **pre-population**: the post-onboarding dashboard must not be empty —
   persona-matched starter content (a guided first task, one example board,
   an exam countdown if a student said "ispiti uskoro").
3. **The Duolingo lesson: value before signup.** Duolingo parks account
   creation until after the first lesson, when the user is invested
   ([Duolingo onboarding breakdown](https://userguiding.com/blog/duolingo-onboarding-ux),
   [Appcues on Duolingo](https://goodux.appcues.com/blog/duolingo-user-onboarding)).
   Nexus has a structural advantage here: the **local account is instant** —
   no email, no verification. So the first screen's primary CTA is "Počni
   odmah (lokalno)"; cloud accounts and sync are offered contextually later
   (e.g., when the user wants a second device or sharing). The registration
   wall stops being a wall.
4. **Depth questions live in the modules, not the wizard — progressive
   disclosure.** Patterns with evidence: staged flows, conditional reveals,
   contextual hints, progressive enabling; and **empty states are prime
   onboarding real estate** — each explains what belongs here, why it
   matters, and offers one obvious action
   ([progressive disclosure examples](https://userpilot.com/blog/progressive-disclosure-examples/),
   [SaaS onboarding patterns](https://www.saasui.design/blog/saas-onboarding-ux-examples)).
   So "Pratiš li makroe?" is asked on first open of FIT, not on install day —
   by a user who already chose to open FIT.
5. **Progress indicator and skippability are measurably worth it:** visible
   progress raises completion 20–30%; skip must always exist (→ Essentials
   preset, already in the razrada); every answer must be editable later
   (already in the razrada — re-run questionnaire, never destructive).
6. **Answers must visibly change the app immediately.** The known failure
   mode of onboarding surveys is perceived pointlessness — if choosing
   "student" doesn't visibly shape the next screen, trust burns. The "Tvoj
   Nexus" preview screen (razrada ekran 7) is therefore not decoration; it's
   the payoff moment and stays.

## 2. Landscape

| Product | Pattern | Take for Nexus |
| --- | --- | --- |
| Notion | Light survey (use-case, role) → preconfigured workspace with examples | Our mapping + pre-population |
| Duolingo | Value first, signup parked until invested; motivation questions | Local-account instant start as primary CTA |
| Linear/typical SaaS | Empty states as onboarding; contextual hints | Depth questions & tips live in modules |
| Typical mobile wizards | 6–10 screens of questions upfront | The anti-pattern: completion collapse |

## 3. Revised flow (supersedes razrada screens 0–7 structure)

**Blocking core (3–4 screens, <2 min):**
1. Welcome + account: "Počni odmah (lokalno)" primary, cloud secondary;
   honest one-liner on the difference.
2. Profile: Personal / Business / Both (business setup deferred as decided).
3. Ko si + šta želiš da organizuješ (one screen: occupation chips
   auto-suggest area cards, user confirms/adjusts — multi-select).
4. "Tvoj Nexus": generated dashboard + module list preview, accent/theme
   picker inline, per-module toggle, CTA "Kreni".

**Progressive layer (post-onboarding, contextual):**
- Module first-open: its 1–2 depth questions (exams? macros? budgets?).
- Empty states: explain + one action, per module.
- Feature discovery: contextual hints on first encounter, never tours of
  everything; sync/cloud upsell only at natural moments (second device,
  share attempt, backup nudge after meaningful data exists).

## 4. Razrada revision note

`docs/notes/razrade.md` onboarding section: keep principles (declarative
mapping, ≤7 visible modules, skip→Essentials, re-runnable, no data loss),
**replace** the 8-screen flow with the 4+progressive structure above, and add
pre-population. Style/theme screen merges into "Tvoj Nexus".

## 5. Pitfalls

- **Empty dashboard after onboarding** — the classic broken promise;
  pre-population is mandatory, clearly marked as examples and deletable in
  one action.
- **Asking what you can't yet use:** collecting depth answers for modules the
  user may never open is friction plus privacy-perception damage.
- **Invisible personalization** — answers that don't visibly change anything.
- **Re-run destroying customization:** re-running the questionnaire merges
  (adds/suggests), never resets what the user manually arranged.
- **Onboarding as a one-time event:** discovery continues for weeks;
  progressive enabling and contextual hints are part of ONB's scope, not an
  afterthought.

## 6. Open questions → PRD (ONB)

1. Starter content per persona: guided creation of the first *real* task vs
   pre-made sample items (recommendation: one guided real task + one sample
   board + persona widgets; samples deletable in one click).
2. Cloud accounts: usable before email verification with limits (no sync
   until verified), or verification-gated? (Recommendation: usable
   immediately, sync gated — keeps TTV low; `SEC-AUTH-05` still satisfied.)
3. Where the questionnaire's answer-data lives for local accounts (purely
   local, feeds `SEC-PRIV-02` no-telemetry rule).
4. Business-profile mini-questionnaire content (profession → PRO pack
   suggestion) — design with PRO module PRD.
