# The recorded UCI sessions

`stockfish-19-uci.txt` is real output, not a hand-written example: the whole
stdout of a session with the engine the `stockfish` pack ships.

## How it was taken

1. The release archive named by the pack's own `sources.json` —
   `stockfish-windows-x86-64-universal.zip` from
   <https://github.com/official-stockfish/Stockfish/releases/tag/sf_19> — was
   fetched and its SHA-256 checked against that file
   (`3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7`).
2. The entry was extracted from it byte for byte:
   `stockfish/stockfish-windows-x86-64-universal.exe`, 103 046 300 bytes,
   SHA-256 `45bc8e4969147db9c2eb533810637994619bff0eacc81ccfd9854394901bcbd0`.
3. It was started with no arguments and, on Windows x64 on 2026-10-10, this
   session was written to its stdin, one line at a time:

   ```
   uci
   isready
   position startpos
   go depth 6
   quit
   ```

4. Its stdout is this file, unchanged — including the `info string` lines a real
   engine writes about its threads and its network, and the `tbhits` field the
   client does not model. Nothing was edited out: a fixture with the awkward
   lines removed would stop testing that the parser skips what it does not know.

## What a fresh run looks like beside it

Both of the following were MEASURED by re-checking the release and re-running the
same session against the same executable:

- **The line endings here are LF, and the engine writes CRLF.** This file is the
  engine's stdout with `\r\n` normalised, because the client splits on `\n` and
  strips one trailing `\r` (`tools/uci.ts`, `feed`), while a fixture that kept the
  carriage returns would leave `"uciok\r"` against an assertion that spells
  `"uciok"`.
- **`nps` and `time` differ between runs; nothing else does.** They are the
  engine's own measurement of how fast the machine it is running on is, and the
  re-run matched this file in every other field of every line: the two identities,
  the nineteen options, the `info string` lines, the depth, the nodes, the score,
  the principal variation of all six iterations, and `bestmove e2e4 ponder d7d5`.
  So a later re-recording that shows a different option list, a different score or
  a different best move is a real finding, and one that differs only in `nps` and
  `time` is this file's own arithmetic.

## How it is used

`../stockfish.test.ts` reads it and asserts what this module's mapping asks of
the engine — the `skill`/`UCI_Elo` bounds the engine advertises, and the level
those bounds produce. The option lines are the engine's own, so a change here
means a change in what Stockfish ships, which is exactly the thing worth being
told about.

Re-record it the same way after a pack version bump; the numbers above are the
ones to check first.
