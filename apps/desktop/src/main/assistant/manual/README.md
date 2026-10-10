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

Modules: `dashboard`, `tasks`, `calendar`, `notes`, `files`, `study`, `priv`,
`finance`, `habits`, `fitness`, `focus`, `tools`, `canvas`, `electronics`, `pro`,
`timers`.

Shell: `search`, `onboarding`, `accounts`, `lock`, `shortcuts`.

Settings: `settings` (the eight categories) and one page per category —
`settings-profile`, `settings-appearance`, `settings-keyboard`,
`settings-modules`, `settings-notifications`, `settings-data`,
`settings-privacy`, `settings-about`.

Common tasks: `dashboard-widgets`, `tasks-recurring`, `calendar-documents`,
`notes-markdown`, `study-cards`, `study-plan`, `finance-transactions`,
`habits-streaks`, `fitness-training`, `focus-session`, `devtools`,
`packs-toolkits`, `backup`, `restore`, `import-archive`, `import-ics`,
`export-ics`, `import-apkg`, `import-csv`, `import-fin-csv`, `import-llm`,
`import-markdown`, `content-packs`, `network-and-updates`.

## To write

The modules whose cores already exist in `packages/core` (and, where they store
anything, in `packages/db`) but whose desktop pages are built in the next wave.
Each gets its own page (or pages) here, in both languages, once its screen is
real:

| Module | Core packages |
| --- | --- |
| Library | `packages/core/src/library` |
| Culture | `packages/core/src/culture` |
| Car | `packages/core/src/car` |
| Pantry | `packages/core/src/pantry` |
| Cookbook | `packages/core/src/cookbook` |
| Recorder | `packages/core/src/recorder` |
| Emergency card | `packages/core/src/emergency` |
| Calculator | `packages/core/src/calculator`, `packages/db/src/calculator` |
| Arcade (games) | `packages/core/src/games` (`bricks`, `blocks`, `snake`, `broj`) |
| Cards | `packages/core/src/games/cards`, `packages/core/src/games/boards-shared` |
| Chess | `packages/core/src/games/chess` |
| Sky (astronomy) | `packages/core/src/sky` |
| Signals | `packages/core/src/signals` |
| Boards (backgammon, draughts, ludo, mlin, …) | `packages/core/src/games` |
| Puzzles (sudoku, nonogram, mahjong, minesweeper, tile2048, …) | `packages/core/src/games` |
| Reader, Maps, Wiki, Translator, Scanner, Workshop, Drawings, Lab | the mini-app engines under `packages/core/src/miniapps` |

Emergency is the one with copy obligations that do not wait: when its page is
written, it says where the Emergency card and the survival packs are and that
112 is the number to call — and gives no medical or survival advice of its own.
