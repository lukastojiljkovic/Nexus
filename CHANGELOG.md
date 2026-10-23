# Changelog

All notable changes to this project are documented here. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.0] - 2026-10-23

The translator reads 202 languages, the map is whatever part of the world you
download, and every planned content pack is out. The assistant's model runs as
you set it and keeps a long conversation going, and the solar system can be
explored body by body.

### Added

- **A translator for 202 languages.** The Translate tab translates as you type
  between any two of the languages NLLB-200 (Meta AI) reads, on your computer
  and with no internet. The model comes as a signed pack in three sizes: 600M
  (0.91 GB), 1.3B (1.94 GB) and 3.3B (4.47 GB); the larger ones translate
  better and more slowly, and with more than one installed a switch chooses.
  The source language is detected until you pick one, a language is found by
  its name in either interface language, its English name or its code, and
  Serbian can be shown in Latin or Cyrillic. The assistant opens the page with
  a text and a pair of languages. The models are CC BY-NC 4.0, named in their
  packs.
- **Maps of the world.** The Maps page opens on a world outline. A click on a
  territory opens its card: whether it is downloaded, the exact size at each
  detail (overview, towns and roads, or full detail) worked out before anything
  downloads, and download, update and delete. The card moves up to the
  territory's continent or the whole world. A region is cut, as it downloads,
  from the Protomaps daily build of OpenStreetMap; a download pauses, resumes
  and cancels, several regions draw together, and the search reads the places
  of every region downloaded. It needs the Downloads network mode. The largest
  countries at full detail (France, Australia, Brazil, China, the United
  States, Canada and Russia), Europe at full detail and the world at towns and
  roads are too large to plan and are refused with that reason; each of them
  downloads at less detail, and the whole world at full detail is the build
  file itself.
- **Every planned content pack.** New in the catalogue: the planet textures for
  the solar system, the Stockfish 19 chess engine, GNU LibreDWG for DWG
  drawings, the scanner's OCR data for English and Serbian in both scripts, food
  preserving and cooking without power, the USDA canning recipes, the nonogram
  pictures and the three translator models.
- **Nonogram pictures.** With the nonograms-pictures pack, a nonogram of 10, 15
  or 20 cells a side is one of 230 pictures from game-icons.net (CC BY 3.0),
  each proven to have a single solution. A solved board names its picture and
  credits its author.
- **The solar system, body by body.** Dragging turns the view, a right-drag or
  Shift-drag moves it, and the wheel zooms toward the pointer. A click on a
  body or its name flies to it, follows it as time runs and opens its card: its
  distance from the Sun and from the Earth now, how long light from the Earth
  takes to reach it, the nearest body and the distances to the rest, and its
  facts from NASA's planetary fact sheets, generated from the published tables
  rather than typed. "Whole system" brings the camera back.
- **The assistant's runtime.** The "How the model runs" card shows which model
  is in memory and unloads it on request. Per profile, it sets the context
  size, the temperature, top-p, top-k and repeat penalty, each either yours or
  the model's own, and the minutes after which an idle model leaves memory (15
  unless you change it).
- **Summarizing a long conversation.** When a conversation outgrows what the
  model reads at once, its earlier messages are summarized before the answer,
  and the thread marks where; "Summarize earlier messages" does it on request.
  Every message is still kept and shown. The switch is per profile and on
  unless you turn it off. A restored conversation is summarized again when it
  next needs to be.

### Changed

- **Pack catalogue format 2.** 2.5 reads a new signed catalogue whose entries
  pin each pack's signed manifest instead of listing every file, so the list
  no longer grows with a pack's file count. Each pack is published in a release
  of its own. The format-1 catalogue stays as it was, for 2.1 and older.
- **Astronomy's header.** The clock sits in the page's header, and the four
  views and the active view's own switch share one toolbar.
- **The map's credit** names OpenStreetMap, Protomaps and ESA WorldCover.

### Fixed

- **The Nonograms tab opens.** Its zoom readout asked the number formatter for
  a pixel unit no formatter offers, so the tab showed "Screen failed to load"
  from 2.0.0 on. The size is now printed with "px" after it.
- **The map draws in the installed app.** MapLibre names its worker only when
  it is loaded over http, so at `file://` it started none that worked, and the
  outline and every region stayed blank; only development builds drew. The
  app now names the bundled worker.
- **Map regions and planet textures load.** The page read a region's file with
  `fetch` and a planet's image into WebGL, both from another origin than its
  own, and the two schemes refused any such read. They now allow it.
- **The Tuner opens.** Signals' Tuner tab failed the same way over a hertz
  unit; frequencies are now printed with "Hz" after them.
- **The map's search says "No place matches" only when nothing does.** It said
  so while each query was being read, and again after a pick wrote the place's
  name into the box. A pick now closes the list.
- **Voice input and output.** The voice worker's process loaded a module that
  defines its message loop without starting it, so every dictation and every
  spoken answer waited forever. The process now starts the loop.
- **The assistant reads the content packs.** Its knowledge index expected a
  table of contents no pack builder writes, so the seven published content
  packs (car help, make by hand, the English and Serbian references, survival,
  and the English and Serbian tales) were never indexed. They are now.
- **A model download shows its progress.** The models pane drew the answer that
  started a download and never read again, so it stayed at 0 MB and a finished
  model appeared only once the page was opened again. It now follows the
  download each second until it ends.
- **A turn that ends early says why.** A turn cut short by a full context or
  the step limit, or answered around a failed tool, drew its sentence and then
  lost it when the page read the conversation again, so the thread simply
  stopped. The sentence now stays.
- **The assistant's page opens at once.** It waited for the hardware probe
  before drawing anything, and its status row loaded the embedding model only
  to name it. The page now draws the chat while the probe runs, and the row
  reads the model's name from the disk.
- **English quotes in the English copy** of astronomy, the cookbook, the
  library, puzzles, timers and the translator, which used the Serbian „…“.

### Removed

- **The Bergamot translator** and its six `translate-*` packs, which NLLB
  replaces. 2.5 neither lists nor reads them; the format-1 catalogue keeps them
  for 2.1.

## [2.1.1] - 2026-10-21

Nexus moves to Electron 44.9.0 and the current releases of the libraries it
ships. Nothing else changes in how it works.

### Changed

- **Electron 44.9.0**, from 44.7.0. It brings Chromium 152.0.7977.167, Node.js
  24.22.0 and fixes backported from upstream Chromium and V8. Two of its fixes
  reach code Nexus runs: the Wikipedia catalogue, which is read through
  `session.fetch`, no longer fails for good after Chromium's network service
  restarts, and a utility process, where the assistant's model and its voice
  run, no longer loses a message it posts just before it exits.
- **Updated libraries:** React 19.3.1, the Tiptap editor 3.32.0, MapLibre GL
  6.15.0, music-metadata 12.2.2 and dxf-viewer 1.0.50. The third-party notices
  list the new versions.
- **Build tools:** electron-vite 6.0.0, Vitest 5.0.5, ESLint 10.13.0,
  typescript-eslint 8.71.2 and Turborepo 2.11.9.

## [2.1.0] - 2026-10-16

The assistant reaches every module. It reads and changes your tasks, notes,
calendar, money, studies, training, habits, timers, settings, dashboard,
drawings, circuits and games, asking before every change, and it can sit beside
any page and know which one that is. The pages share one way of drawing a
header, an empty list, a failed read, a question and an undo.

### Added

- **The assistant works in every module.** It has tools for:
  - tasks: lists, projects and their sections, tags, templates, dependencies,
    and moving or re-dating several tasks at once;
  - notes: folders, tags, categories, versions, templates, checklists turned
    into tasks, and flashcard decks;
  - calendar: events, repeating series, templates and the semester;
  - finance, study, fitness, habits, timers, focus, notifications and settings;
  - the dashboard and its boards;
  - canvas (it can draw a sketch, or turn a note into a diagram) and
    electronics (it can build, wire and simulate a circuit);
  - chess, cards, board games, puzzles, the arcade and the mini-apps;
  - people and documents, files and packs, the translator, the calculator, the
    workshop and the scanner.

  Every change asks first. Some things stay with you by design: grading a study
  card, the private vault, a note's attachments, and the network, passcode and
  privacy settings.
- **The assistant beside any page.** Ctrl+J or the title bar opens it as a
  resizable panel next to the page you are on, sharing its conversations with
  the full page. Docked, it opens each place a tool names as the result
  arrives, the page beside it reads again after a turn that changed it, and the
  assistant is told which page is open, so "this" and "here" mean something.
- **The Tools drawer from the chat.** The assistant finds a tool by name or
  purpose, opens it with its fields filled, and runs the eleven everyday tools
  and thirteen of the developer tools in place, through the same functions
  their pages use, so the figures agree.
- **The assistant shows what each tool did.** Every tool call in a turn is a
  line in plain words, such as "Add a task" or "Read the tasks", marked as
  running, done or not done. The mark comes from the tool's own result, not
  from the model's sentence about it, so an answer that claims a change the
  tool refused or failed is visible as such. The outcome is stored with the
  conversation and carried in its backup.
- **A Wikipedia citation opens the article.** A source the assistant cited from
  a downloaded Wikipedia opens that article in the Wiki module.
- **Reading goals and loans.** The library keeps a yearly goal per kind or
  overall, and records whom a book was lent to, when, an optional due date and
  its return. A culture plan carries its tickets, as a photo or a PDF.
- **Recipe collections.** A recipe can sit on several shelves of the cookbook,
  and a pack that names a collection fills its shelf.
- **Retention per subject and per deck.** A deck or a subject may set its own
  target retention; the profile's is the default.
- **Three dashboard cards:** Reminders, Quick actions and the week's Stats.
- **Browser bookmarks as notes.** A bookmarks file exported from Chrome,
  Firefox or Edge becomes one note per folder under one tag, with a preview and
  an undo.
- **Emergency and signals.** A 72-hour kit checklist and a water and food
  ration calculator; NATO spelling, Grade 1 Braille and a periodic table.
- **Smaller additions:** edit a car service entry; discard a saved board game
  from the lobby; set a task's description and an event's notes and category in
  their forms.

### Changed

- **One way to draw each part of a page.** The pages share the kit's header
  (one main action, with the rest folding behind a ⋯ button in a narrow
  window), its empty states, its loading and failure states with a retry, its
  notices, its questions and its undo offers. A question about a deletion opens
  with focus on its cancelling answer.
- **Deletions ask first** for a canvas board, a circuit, a pantry item or
  location, a calculator history entry and a timer preset. New game asks before
  it throws away a saved puzzle.
- **The tools offered follow the page.** A turn offers the open page's tools
  first, a Serbian word finds its tool when it is inflected or written in
  Cyrillic, and with an embedding model installed the tools closest in meaning
  join them.
- **The chat model stays loaded between turns.** A model in the catalogue can
  carry its own context cap, thinking budget and sampling.
- **A turn ends cleanly.** When its steps or the model's window run out, a last
  step answers without tools. Writes run one at a time, in the order the model
  asked for them, and the answer's language, script and claims are checked, with
  one corrective request when they are wrong.
- **The assistant answers in the language and script you wrote in.** The app
  decides the reply's language, and for Serbian its script, from your message
  and tells the model as a fact. A Serbian Latin answer that drifts into
  Cyrillic, the script of the Serbian Wikipedia's articles, is transliterated.
- **Only the sources an answer used are listed.** Sources the answer cites by
  number are kept and renumbered in order. When it cites none, a source is kept
  only if the answer shares words with it. A safety pack's source is always
  kept, so its notice still shows.
- **General knowledge is allowed, numbers from memory are not.** When your
  library has nothing on a question, the assistant may answer a well-known fact
  and says that it is general knowledge. It never gives a number or a date from
  memory, and questions of health, medicine, law, money and safety are still
  answered only from a source. A small model used to refuse "what is the
  capital of France".
- **The app draws the safety notice.** Under an answer that draws on a safety
  pack, the page shows the notice verbatim. The model is no longer asked to
  quote it, which a small model often did not do.
- **The assistant says when web search is off**, instead of answering a request
  to search the internet as if it had searched.
- **Global shortcuts wait for an open dialog.** A shortcut such as Alt+2 or
  Ctrl+J does nothing while the launcher, the palette or a question is open.
- **A scan can be cancelled**, and leaving the scanner stops a scan in progress.
- **The user manual covers every module**, and the specification, the product
  documents and the architecture records were brought up to date.

### Fixed

- **A tool call written loosely still runs.** Before a call is checked, a day
  written as "sutra", "tomorrow", "za 3 dana" or "16.10.2026.", a number
  written as text or with a decimal comma, a unit spelled out, a listed value in
  the wrong case and an empty optional field are read as what they mean. The
  model may now leave an optional field out, and a day field is decoded as a
  date. A call that is still wrong is described to the model without repeating
  it, and after two failures the model is told to stop and say why.
- **A tool call you declined is not asked again in the same turn.**
- **Completing a repeating task completes that occurrence.**
- **A paused or cancelled countdown leaves no alarm behind.** The alarm fires
  only for the end it was set for.
- **The undo offers on Canvas and Electronics can be dismissed.**

## [2.0.3] - 2026-10-15

The assistant works in the installed app: it loads a model, answers within the
model's window, reads the Wikipedia you downloaded, and can answer with a model
you found yourself. Accounts made with 1.x are back, and the first launch moves
what 2.x stored into the folder 1.x used.

### Added

- **A model you found or imported can answer.** A model downloaded through the
  Hugging Face search, or imported from a `.gguf` file, served none of the three
  tiers, so the assistant could never use it. Its row under Models now has "Use
  for answers". The choice belongs to the account, choosing a tier again goes
  back to the tier's pick, and a backup does not carry it, because the model file
  stays on this computer.

### Changed

- **The privacy policy describes the app that ships.** Since 2.0.0 it still
  said the update check was the only connection Nexus could make. It now covers
  the Downloads mode and the hosts it reaches, what a model search sends, the
  assistant's web search (a separate consent, confirmed request by request) and
  where packs, libraries and models are stored. The README, the website and
  `llms.txt` name macOS, the three network modes and the modules 2.0 added.

- **TriPeaks and Golf let you turn the stock at any time.** They allowed it
  only when no card on the table could be played, as the Wikipedia articles they
  follow describe. Holding a card back to build a longer run is the main
  decision in both games, so the stock is now open while it has cards. The Golf
  solver answers "unknown" more often as a result: the same search bound now
  covers many more lines.

- **The assistant's instructions are shorter.** The local models it runs have a
  small window, and its standing instructions took a fifth of the room each
  request has. They are now short rules, a quarter shorter, and no rule was
  dropped.

- **Gemma 4 E2B is the fast model.** The three recommended models were ranked by
  file size, and Gemma's smaller models carry large lookup tables that make the
  file big without making each word more work. The ranking now uses the
  parameter count each model's card states, so on a laptop with an 8 GB graphics
  card the picks are Gemma 4 E2B, Qwen3.5 4B and Gemma 4 E4B. Qwen3.5 2B and
  Qwen3-VL 4B are no longer recommended; a copy you installed keeps working.

### Fixed

- **The installed app loads a local model.** Since 2.0.0 the assistant worked
  only in a development checkout. The installer unpacked `node-llama-cpp`
  without the packages it imports, so the worker failed at its first import;
  past that, the library's pre-load test of each llama.cpp build cannot run
  inside an Electron utility process, so every build was refused. The whole
  closure is unpacked now and `pnpm check:unpack` keeps it complete, the test is
  skipped there, and a GPU build that does not load falls back to the CPU one.

- **Accounts from 1.x are back, and nothing made in 2.x is lost.** From 2.0.0
  Nexus kept its data in `%APPDATA%\@nexus\desktop` instead of `%APPDATA%\Nexus`
  (and in `@nexus/desktop` on Linux and macOS), because one module asked
  Electron for the folder before the app had its name, and Electron keeps the
  first answer. So an upgrade from 1.x opened with none of its accounts. The
  folder is `Nexus` again, and the first launch moves into it what 2.x made: its
  accounts with their names, the packs, libraries and models it downloaded, and
  its settings. Nothing is deleted, and an account that exists in both folders is
  never written over. On Windows, a computer with accounts from both versions can
  keep only one of the two keys that guard their passcodes. Nexus keeps the 2.x
  one, so the accounts in use unlock as before, and each 1.x account asks once
  for its Recovery Kit.

- **The uninstaller asks in English, and removes the 2.x data folder too.** Its
  question about deleting local data was only in Serbian. If you choose to
  delete, it now also removes `%APPDATA%\@nexus\desktop`, where 2.0.0 to 2.0.2
  kept their data.

- **Web search names the version that is running.** Its requests said
  `Nexus/1.5.0`, and the model search's said `Nexus/2.0`. Both now send the
  running version with the project's address and a contact, as Wikimedia's
  User-Agent policy asks.

- **The assistant answers.** Every turn on the installed app ended in an error:
  the descriptions and schemas of all 37 tools, written into the request twice,
  did not fit the model's 8192-token window beside the conversation, and the
  context budget never counted them. Each message now offers the model only the
  tools it is about, at most eight and within a set share of the window. The
  system prompt names them instead of repeating their descriptions, and the
  budget counts what they cost. When the model does fail, its reason goes to the
  app's log. Two built-in workflows named tools that do not exist; they name
  real ones now.

- **The assistant's answers end with the answer.** A model that reasons before
  it answers, as Qwen3.5 does, spent the whole reply on its reasoning and
  stopped mid-sentence. Reasoning may now take half of the reply, it shows only
  while the model is writing, and the conversation keeps the answer. The
  assistant is also told today's date, so a task for "tomorrow" gets a real day.

- **The assistant reads the Wikipedia you downloaded.** Its knowledge base was
  built to read the Wiki module's libraries, but nothing connected the two, so
  a downloaded library never reached an answer. For each question it now looks
  up the titles the question names in every library on the computer (for a
  Serbian one also in Cyrillic and without the case ending, so "o Beogradu"
  finds Београд), and cites the opening section of the few articles that
  match.

- **The assistant cites only the articles a question is about.** A Wikipedia
  title list matches the start of a word, so "Šta imam od zadataka za danas?"
  cited a film and a newspaper, and a Serbian question about the capital of
  France lost Француска to titles that only began like it. The assistant now
  reads more titles than it cites and keeps those the question names and that
  carry at least two of its words, best first. A Serbian library's titles and
  passages reach the model in Latin, the script the app writes Serbian in, and a
  tool call is no longer refused for an optional field the model left empty.

## [2.0.2] - 2026-10-14

The downloads that 2.0.0 introduced never finished, and the card table that
2.0.1 added could not be played. Both work now, and the pages that read as
rows keep to one width, centred in the window.

### Fixed

- **Downloads work.** No content pack, Wikipedia library or model ever finished
  downloading. Every file Nexus fetches answers its first request with a
  redirect, and Electron's `fetch` refuses to hand a redirect back to the caller
  that checks each hop against the allowlist. Downloads now go through
  `net.request`, which does.
- **The pack catalogue lists every pack again.** One pack's attribution had line
  breaks, which the manifest check refuses, and the catalogue is read
  all-or-nothing. The dictionary pack is republished as `2026.10.1` with a
  one-line attribution, and the catalogue is re-signed.
- **Model downloads from Hugging Face are allowed.** `huggingface.co` and its
  download CDN, `us.aws.cdn.hf.co`, are on the downloads allowlist.
- **The first Wikipedia or model download on a profile starts.** The space
  check measured a folder that did not exist yet and read the error as a full
  disk.
- **Current Kiwix files open.** Format 6.3 files keep their title index in an
  entry rather than in the header. The reader refused them at open; it now
  reads that entry, so title search works too.
- **The card table has its width.** Every panel of the Cards page shared its class
  name with the playing card and so was a playing card's 3.4rem wide, which
  squeezed the shelf, the table and the record into one narrow strip.
- **A card goes where it is put.** A click on a destination played the first legal
  move out of the chosen pile, wherever that went; it now plays the move into the
  pile that was clicked.
- **Klondike, FreeCell and Spider build on their columns.** A column holding cards
  was never a destination, Klondike's columns could not be picked up at all, and
  FreeCell's columns had no card a click could take. Each now picks up and builds
  as its rules say, and a column a chosen card may go to is lit.
- **TriPeaks is dealt the right way up.** The table of which cards cover which was
  read backwards, so the peaks lay open and the row of ten was buried; the row of
  ten is now face up at the foot and a card turns over once both cards over it are
  gone, drawn as three peaks above the row.
- **The stock turns with one click** wherever turning it is all it does, rather
  than being picked up with nowhere to put it.
- **Every card on the table can be read.** A covered card shows its rank and suit
  side by side in the band left visible, Golf draws its columns whole, the trick
  in Hearts and Spades and the Tablić table lie in a row, the three computer seats
  are named west, north and east, and Tablić's stock is drawn while it holds
  cards. The Spades bids and the Tablić captures are the app's own buttons.
- **Pages that read as rows keep to one width, centred.** Habits, Focus, Files,
  Study, Fitness, Recorder and Library held their 1180px measure against the left
  edge and left the rest of a wide window as an empty band; they now sit in the
  middle. Reference, Car, Pantry, Timers, Calculator, Signals, The Lab, Reader,
  Translator, Emergency card and Assistant take the same measure instead of
  stretching a row's name and its buttons a thousand pixels apart. Calendar, the
  boards, maps, games and viewers keep the whole width.
- **The Assistant's models are readable before a model is installed.** With no
  conversation list beside it, the models panel was squeezed into that list's
  260px column and broke its text a word per line.
- **Dialogs are set in the app's typeface.** Every dialog drawn over the page,
  All modules among them, fell back to Times New Roman.
- **An empty list's line reads as two sentences**, where its title ran straight
  into its description, and Library's „Create a collection" keeps a button's
  width rather than stretching across a third of the page.

## [2.0.1] - 2026-10-12

The nine card engines that shipped in 2.0.0 reached no screen: they could not be
dealt, played or saved from anywhere in the app. This release is the card table.

### Added

- **The Cards module, one shelf for all nine games.** Six solitaires dealt by the
  player — Klondike, FreeCell, Spider, Pyramid, TriPeaks and Golf — and three
  against the computer — Hearts, Spades and Tablić — each with the variants it
  actually has (one or three at a time, one, two or four suits, one pass), a seed
  you can type, a hint, `Back` to undo, and `Check the deal` for the solitaires
  the solver can settle. The computer's three games think in a dedicated worker,
  so the table never blocks on a search. Serbian and English throughout, and the
  games-in-progress card on the dashboard opens the module where a game was left.
- **A manual page for the module**, in both languages, and its mark in the icon
  set: two cards laid on each other, because the shelf holds nine games and the
  mark names the shelf rather than any one of them.

### Notes

- No schema moves. `CardGameStore` and migration 081 already held the record and
  the games in progress, so this release adds no migration.
- ADR-111 records the three decisions a later reader would otherwise re-derive:
  where the computer thinks, what one press of `Back` means at a table, and how a
  board draws a legal move without re-deriving a rule.

## [2.0.0] - 2026-10-11

Nexus is offline first, and this release is the one that makes that mean
something: the app now ships with a way to hold public knowledge on the machine,
and with twenty-five modules to read, use and work through it — all of them
working without a network, because the app has no other mode.

### Added

- **Content packs, and the catalogue that lists them.** A pack is a folder of
  public content — a dataset, a map, a set of articles, a model, a tool built
  from someone else's open source release — signed with Nexus's own key. The
  app accepts one only when the signature and every file's SHA-256 check out,
  whether it arrives from a folder on a USB stick or from the pack catalogue
  under **Settings → Content packs**. Every pack carries its own licence,
  source and attribution, which are shown in the app before anything is
  downloaded. Downloads need the third network mode, **Downloads**, which is a
  superset of update checks: it reaches a compiled-in list of hosts, one
  request at a time, and every file is pinned by a signed manifest. Offline
  mode is unchanged and still makes no network call at all.
- **Twenty-five modules, each one a folder.** The module kit turns a module
  into a self-contained folder the shell discovers, which is what made it
  possible to add, in one release: the Reader (article packs with search,
  bookmarks and printing), Maps, the offline Wikipedia (its own ZIM reader),
  the Translator, the Assistant, the astronomy corner, Library, Culture,
  Cookbook, Pantry, Car, Recorder, Emergency card, Calculator, Signals,
  mini-apps, Timers, and the games — arcade, cards, boards, puzzles and chess.
- **A local assistant, with no cloud in it.** A model you choose (or import as
  a `.gguf`), running in the app, with a knowledge base built from your own data
  and packs, tools over your tasks and notes, a voice mode, and web search that
  is off until you turn it on.
- **macOS, as a third platform.** Nexus now builds a `.dmg` beside the Windows
  installer and the Linux AppImage. The macOS build is unsigned and Apple
  silicon only; the release notes say what that means for the first launch and
  `electron-builder.yml` records why.

### Changed

- **Settings is organised by category**, with a search over the whole page, and
  a card for each module that has a preference.
- **The navigation rail groups modules** (Plan, Knowledge, Life, Culture, Make,
  Play), and a module can be hidden without being removed: one setting for the
  whole app, not per profile.
- **Everything public says offline**: the README, the site, the privacy policy
  and the security policy describe the app that exists, with sync and the web
  app on hold permanently.

### Fixed

- **Every screen is photographed in both languages, at the size of a real
  window.** The screenshot harness now lands on every module the registry
  declares, in Serbian and in English, and at the display's own work area rather
  than a fixed 1600 px — which is how the two defects it could not see were
  found: empty states whose text was capped at a quarter of the pane, and
  sub-views of the newer modules that no scene had ever opened.

## [1.5.0] - 2026-10-08

### Added

- **Nexus now asks once, on first start, how it may use the network — and
  remembers the answer.** **Offline only** is the default and makes no network
  call at all, exactly as every release so far. **Offline + update checks** lets
  Nexus contact GitHub for one purpose: checking for and downloading a new
  version of itself. Your notes and data never leave the computer in either
  mode; in update-check mode GitHub sees your IP address, as any website does.
  The question is asked of a new install and of a device upgrading from an older
  version alike.
- **An update check you can turn on.** In **Offline + update checks** mode Nexus
  looks for a new version at most once a day and whenever you press **Check
  now** on the **About** card, shows the version and its release notes, and
  downloads nothing until you press **Download and install**. Every download is
  verified against a key built into the app; anything that does not verify is
  deleted and never run. On Linux the release page is offered instead of a
  self-install. The mode lives in **Settings → Privacy → Network and updates**,
  and a change takes effect after a restart.

### Removed

- **electron-updater is no longer bundled**, so sixteen fewer third-party
  packages ship.

### Security

- A crafted CSV, Anki deck or subtitle file can no longer freeze the import
  while it is being read: the patterns that measured, trimmed and stripped that
  text re-scanned the tail of the file once for every place a match could start,
  so a small file built to repeat one prefix could spend minutes of CPU; the
  markup of a single Anki field at the reader's 256 KiB cap cost nine seconds.
  Each step now scans its input in one pass, and a file with 50 000 repetitions
  answers in well under the time a keystroke takes. The `<script>` and `<style>`
  strip removes the leftmost complete element and repeats until none is left,
  all in one walk of the field, so no arrangement of tags sends it down a slow
  path.
- A `<script>` or `<style>` element whose tags are split around another element,
  so that removing the inner one completes the outer, is now removed with its
  contents instead of surviving into the text of an Anki import, and a subtitle
  line's length no longer counts a tag left behind by nesting one inside
  another. Imported text is shown as text and never run, so both changes are
  about what is counted and displayed.
- The private-attachment, CSV, Markdown and profile-picture picks open each
  chosen file once and read it through that handle, so a file replaced between
  the size check and the read is neither read nor measured against the wrong
  file's size.
- The interface copy tables refuse `__proto__`, `constructor` and `prototype`
  when a language is folded onto them, so a table carrying one of those names
  can no longer write through to `Object.prototype`.
- The screenshot harness writes its lock file owner-only and escapes every
  value it splices into a script it evaluates in the renderer; a report cell
  escapes backslashes as well as pipes.

### Changed

- **Settings is organised into categories.** The page was one column of
  twenty-seven cards with a wrapping chip index above it; it now has eight
  categories — profile and security, appearance, keyboard, modules,
  notifications, data, privacy, about — with the categories beside the cards on
  a wide window and a drill-down list on a narrow one. The card that held
  eleven separate things keeps backup, auto-backup and restore and is now
  "Backup and restore", while the seven importers and the calendar export are
  each their own page under "Import and export". Searching still reaches every
  setting, and now shows results from every category at once, grouped under its
  heading.

## [1.4.0] - 2026-10-05

The first public release. No earlier version was tagged or published; this one
carries the Apache-2.0 licence, the release pipeline and the corrections below.

### Added

- The project is licensed under **Apache-2.0** (`LICENSE`, `NOTICE`), and
  ADR-087 records the decision that supersedes ADR-080's closed-source premise.
- Community and policy documents: `SECURITY.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `PRIVACY.md`, `TERMS.md`, `SUPPORT.md`, `ROADMAP.md`.
- Issue templates and a release workflow that produces checksums, an SBOM,
  build provenance and the third-party notices for a tagged release.
- A project website, published with the repository by a Pages workflow.
- Every page in the renderer is its own chunk, so the canvas engine and the
  other large surfaces left the startup path. The tools drawer fetches a
  toolkit when one of its tools is opened, and it no longer ships with the
  rest of the shell.
- **The interface ships in English as well as Serbian**, and the language is a
  first-class preference: on first run the app follows the system language
  (Serbian for `sr*`, English otherwise), remembers the choice, and switches at
  runtime from Settings → Appearance — including the main process's native
  dialogs, OS notifications and the demo profile's seeded content. Dates,
  numbers, money and alphabetical order follow the same choice, and the food
  and electronics catalogues, the generated Arduino sketch and ROS package
  carry English text too.

### Fixed

- **The sync housekeeping job is scheduled by a migration** rather than by hand
  in the SQL editor, idempotently and with the `pg_cron` extension created if
  needed.
- The Supabase README no longer claims the migration forces RLS on
  `storage.objects` and `realtime.messages` — it cannot, and the migration's
  header says so.
- Row ids minted in the same millisecond sort in the order they were minted.
- Leaving a canvas board no longer writes an empty board, and the canvas
  autosave keeps one write per board on the wire.
- Every exit that closes an editor waits for the last edit to reach disk, so
  closing a note or a canvas no longer loses it.
- The harness sandbox is applied before `ready`, so renderer storage lands in
  the sandbox rather than in the developer's own profile.

### Security

- **The packaged executable is hardened with Electron fuses**: `RunAsNode`,
  `NODE_OPTIONS` and the CLI inspect arguments are off, cookie encryption is on,
  embedded asar integrity validation is on, and the app loads only from the
  asar. `GrantFileProtocolExtraPrivileges` stays on because the renderer still
  loads from `file://`.

## 1.3.0 - 2026-09-23

The first entry summarises everything up to this version, because the project
grew from its own first commit in one line rather than through a series of
announced releases. Nothing before this has ever been published: there are no
tags and no downloads.

### Added

- **The desktop application**, an offline-first life-management workspace:
  tasks, calendar, notes, documents, study, habits, focus timer, fitness and
  nutrition, finance, canvas, the professional toolkits, and Electronics — an
  Arduino and Raspberry Pi workbench that derives a wiring sketch, a ROS 2
  package and a URDF from a circuit, and can run a plan on the user's own
  toolchain.
- **Encrypted local storage** — one SQLite database under a passcode-derived
  key, with a Recovery Kit, multiple local accounts, and no network dependency.
- **The optional sync substrate** — an end-to-end encrypted design in which the
  server holds ciphertext only, with the local data key, a master sync key and
  per-profile content keys kept apart. The engine, the transport and the server
  schema are built and tested; no hosted backend has ever been deployed, and
  cloud access is off by default.
- **Generated third-party notices**, read from the shipped dependency tree and
  shown in the application, rather than written by hand.
- **Linux builds** — AppImage, tarball and a Gentoo ebuild.

[1.5.0]: https://github.com/lukastojiljkovic/Nexus/releases/tag/v1.5.0
[1.4.0]: https://github.com/lukastojiljkovic/Nexus/releases/tag/v1.4.0
