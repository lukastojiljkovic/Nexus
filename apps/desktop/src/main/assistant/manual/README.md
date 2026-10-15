# The app manual

This is the assistant's knowledge of Nexus itself: one Markdown page per module,
built-in page, Settings category and common task, in `sr/` and `en/`. The
knowledge service indexes these files, and the assistant answers "how do I…",
"where is…" and "what does … do" by quoting them and then opening the place the
page names.

## The page format

```markdown
---
id: tasks-recurring
title: Ponavljajući zadaci
location: { module: tasks }
keywords: [ponavljanje, recurring, svaki dan]
---
Short, factual text: what it is, how to do it step by step with the exact labels
on screen, the shortcuts, the limits.

Povezano: tasks, calendar
```

- `id` is kebab-case and identical in both languages; that is what pairs the two
  halves. A page in one language and not the other is a build-visible defect —
  `pnpm check:manual` fails on it.
- `title` is the name a user reads on screen, in that language.
- `location` is where the page's subject lives: `{ module: <module id> }`, or
  `{ module: settings, settings: <category> }` for a Settings card. A page about
  a screen the assistant cannot open (the lock screen, the account picker) omits
  the key rather than naming a place that does not open.
- `keywords` are the words somebody would actually type, in both languages.
- The last line of the body is `Povezano:` (`Related:` in English) and lists the
  ids of the pages worth reading next. `check:manual` resolves every one of them.

Labels are quoted exactly as the app prints them, in the page's own language:
the manual is only useful if the reader can find the button it names.

## What is written

The rule, rather than a list of names the next module would make stale:

- **Every module the registry declares** has a page in `sr/` and one in `en/`:
  the compiled-in modules in `shared/modules.ts` and the discovered ones under
  `modules/<id>/shared/manifest.ts`. That is the coverage rule in
  `check:manual` — a module with no page is a finding, and a module whose screen
  genuinely is not real yet goes into `COVERAGE_ALLOWLIST` in that script, one
  line per module with the reason beside it.
- **The shell's pages** — onboarding, the account picker, the lock screen,
  search, the shortcut list — are pages too. A screen the assistant can open
  names its place in `location` (`search` is a built-in id, so `{ module: search }`);
  one it cannot open, such as the account picker or the lock screen, omits it.
- **The Settings page and its eight categories** have a page each, so that every
  Settings `location` names a card the assistant can open.
- **A task somebody asks about in words rather than by module** — "how do I
  repeat a task", "how do I import a calendar", "how do content packs arrive" —
  has a page named for the task (`tasks-recurring`, `import-ics`,
  `content-packs`).

`pnpm check:manual` prints the count of all of it: pages per language, paired
ids, related links, and how many of the registry's modules are documented.

## Adding a page

1. Write the page twice: `<id>.md` in `sr/` and again in `en/`, with the same
   `id` in the front matter. The id is what pairs the two halves, so a page in
   one language is a finding in itself.
2. Give it a `location`: `{ module: <module id> }` for a module,
   `{ module: settings, settings: <category> }` for a Settings card, and no
   `location` at all for a screen the assistant cannot open.
3. Run `pnpm check:manual`. It fails on an unpaired page, on a location naming a
   module or a category the app does not have, on a `related` id no page
   carries, and on a module the registry declares that has no page.

Emergency is the one module whose copy carries an obligation that does not wait:
its page says where the Emergency card is and that 112 is the number to call,
and gives no medical or survival advice of its own.
