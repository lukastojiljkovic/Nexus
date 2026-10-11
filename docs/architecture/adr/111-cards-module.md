# ADR-111 — The Cards module on the kit: one shelf, nine engines, one worker

**Status:** accepted (2026-10-11). **Owner:** the run that built the module.
**Uses ADR-090 (the module kit) and ADR-093 (navigation groups). Amends neither.**
No schema moves: `CardGameStore` and migration 081 (2.0.0) already hold everything
the module records.

## 1. What this is

Nine card engines shipped in 2.0.0 — six solitaires (`klondike`, `freecell`,
`spider`, `pyramid`, `tripeaks`, `golf`) and three against the computer (`hearts`,
`spades`, `tablic`) — reached no screen. This ADR records what putting them on one
screen decided, and the three decisions a later reader would otherwise re-derive:
where the computer thinks, what one press of „Nazad" means at a table, and how a
board draws a legal move without re-deriving a rule.

## 2. The module is a kit folder and nothing else

`apps/desktop/src/modules/cards/` is a manifest, an IPC contract, a `main/register.ts`,
a `main/imex.ts`, a page, a settings-less copy table, an icon and a widget — the
layout `modules/timers/` fixes as the kit's worked example, and the shape
`modules/boards/` (the closest precedent: same `play` group, a table as its page,
saved games and a record, a worker for the computer's move) already proved.

**No migration, and deliberately.** The store's two tables (`cardgame_stats`,
`cardgame_saves`, migration 081) hold the record and the games in progress. The one
preference a reader might expect — the level a new game opens at — has no column,
and stage 2 may not add one, so the level is a field on the new-game panel: chosen
per game and written into the game's own save (`level` travels in the position the
page holds, not in a settings row). A settings card whose value lived only until the
next launch would be a lie about what it stores, so the module publishes no card.

## 3. The computer thinks in a worker, and the level was measured

`heartsChooseMove`, `spadesChooseMove` and `tablicChooseMove` play their level's
strategy, and `hard` is a search: twelve determinizations of the unseen cards for
Hearts, six for Tablić. **Measured on this machine, not assumed:** one `hard` move
costs at most 4.6 ms (Hearts), 1.4 ms (Spades) and 1.9 ms (Tablić), and a whole
game's worth of them — 660 calls for Hearts — costs 88 ms, 179 ms and 83 ms. A few
milliseconds inside one frame is survivable; hundreds on the thread that draws the
table is a window that stops responding. So the choice runs in a **Web Worker**
(`renderer/ai/`), the page shows „Računar misli…", and the worker's message handler
opens with the shared `isOwnOrigin` check, as every worker in the tree now does.

The protocol is a pure function (`answerMoveRequest`) so the promise — a move the
engine's own enumeration offers, or a named refusal, never an exception — is
testable without a worker; `ai.worker.ts` is the two globals around it. The search
is handed a **per-ply** stream (`moveSeed(seed, ply)`), never the deal's own, so a
search's equal-move shuffle cannot shift the dice a saved game's replay expects.

## 4. What one press of „Nazad" means at a table

A solitaire's turn is one action: every action anchors, so undo walks back one card,
and the engine's own `undo*` prices it in the score (Klondike charges −2).

**A game against the computer is different, and this is the decision.** After the
person plays, three other seats answer before it is their turn again. One ply of the
engine's own undo would take back the machine's last card and hand the table to a
seat that has not played — so undo restores an ANCHOR: the position, log and score
as they stood when the person's turn began, taken once per turn in `rules.ts`'s
`stepSession` (the wrapper records the length, so the machine's answers ride on the
same frame). One press takes back the person's move **and** every answer to it, and
the result is a position the rules really produced.

## 5. A board draws the engine's moves; it does not re-derive them

Every solitaire is rendered from one small vocabulary — a `Box` is a column, a cell,
a foundation, the stock, the waste or one card — and the page reads two sets off the
ENGINE's move list: which boxes can be picked up (a move starts there) and which box
the current choice can go to (a move ends there). A click plays the move it found
by those two boxes, so the picture cannot offer a card the rules refuse or hide one
they allow. The two geometry tables „exposed" uses (Pyramid's covering pairs and
TriPeaks' `TRIPEAKS_COVERS`) are checked against the engines' own enumerations by
`table.test.ts`, exactly as `modules/boards/renderer/rules.ts` checks its turn
protocol against `boardEngine`.

## 6. What the module records, and where the score comes from

Every move is `save`d as it is played and the finished deal calls `record`, which
stamps the clock, moves the record and clears the saved game in one op. The score is
**never sent by the page**: the store folds the log through the game's own engine and
reads the score off the state it lands in, so „best" means the best result somebody
reached, in the game's own direction (`CARD_GAME_SCORE_DIRECTION`: Hearts counts
penalties and Golf counts cards left, so for those two a lower score is better).
`won` is the page's, because winning is the engine's `is*Won` and is the one fact the
score alone cannot recover.

The archive section (`main/imex.ts`) is the store's value: `exportData` reads it and
`importData` writes it, with the kit's pure `parse` half being the store's own
`readCardGameArchive` — the reader `importData` runs first, exported for exactly
this, so „parse writes nothing" is true by construction.
