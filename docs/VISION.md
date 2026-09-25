# Nexus — Product Vision

> **Founder-approved north star, and the one document the others may not
> contradict.** [SPECIFICATION.md](SPECIFICATION.md) expands it, never disputes
> it; [STATUS.md](STATUS.md) says how far along it is. Raw ideas live in
> [notes/raw-spec.md](notes/raw-spec.md); this is their distilled intent.
> "Nexus" is a codename — the final name is chosen (with trademark and domain
> checks) before the landing page ships.

**Nexus is the IDE for your life** — one offline-first workspace that replaces
the fifty scattered apps people use to run their private and professional lives.

## The problem

Life runs across dozens of disconnected tools: a todo app, a notes app, a
calendar, a budget spreadsheet, a fitness tracker, flashcards, file converters,
a drawer full of expiring documents nothing reminds you about. Data is
fragmented, nearly every tool demands an account and a cloud, privacy is an
afterthought, and each new tool adds friction instead of removing it.

## The product

A modular, all-in-one life-management platform: desktop app (Electron + React
on Windows, macOS, Linux), web app, Android app, and a marketing landing page —
one account, same data everywhere. No single module is revolutionary, and that
is the point: the product is the **integration**. Everything shares one
dashboard, one search, one calendar, one reminder system, one design language.

## Pillars

1. **Offline-first, forever.** Every core feature works with no internet. Cloud
   sync is an enhancement, never a dependency. Fully local, PIN-protected
   accounts exist for people who never want a server involved at all.
2. **Privacy as architecture, not policy.** Private notes are zero-knowledge
   encrypted — not even we can read them. Security is designed in from the
   first commit (`docs/security/baseline.md`), not patched on later. Full data
   export is a permanent guarantee: Nexus never holds data hostage.
3. **Modular by onboarding.** Dozens of modules, but each user sees only what
   they chose. A visual onboarding questionnaire configures the app per person;
   everything else stays hidden until enabled in Settings. Separate personal
   and business profiles keep both lives cleanly apart.
4. **Depth per module, not a bundle of widgets.** "All-in-one" earns its name
   only if each part is genuinely good: a study hub with spaced repetition and
   exam planning; a fitness hub backed by a real food database including
   Serbian retail chains; personal finance; Milanote-class infinite canvas;
   preview for practically any file format; a full utility belt from unit
   converters to profession-specific calculators. A module ships when it is
   excellent, or not at all.
5. **Sustainable productivity.** Nexus optimizes for lasting output, not
   burnout: Pomodoro, habits and streaks, and **productivity boosters** — break
   activities like a quick sudoku or card game, stretching and eye-rest
   prompts — built into the work rhythm. Rest is part of the system, not a
   distraction from it.

## Who it is for

Students first (the founder is persona #1: exams, job hunt, and life admin in
the same six weeks), then professionals — architects, developers, freelancers —
and anyone drowning in scattered obligations. Long term: profession-specific
module packs on the same modular core.

## What Nexus is not

- Not a social network — sharing and collaboration exist for planning together,
  not for feeds and followers.
- Not a cloud-only subscription that degrades into a paywall — local accounts
  and full export are permanent.
- Not a shallow "everything app" — breadth never excuses a weak module.

## Business direction

Free, fully unlocked beta while the product matures; premium tiers later, with
a large permanent discount for beta users. The landing page and web app drive
reach; the native apps deliver the depth.

## Long-term

An integrated AI assistant that organizes, summarizes, and imports on the
user's behalf; a plugin ecosystem so new capabilities arrive without touching
the core; automation between modules; profession packs. The destination is
simple to state: the first app you open in the morning and the only organizer
you need.
