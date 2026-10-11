// A UCI engine small enough to read, used by `uci.test.ts` in place of a pack.
//
// It is a fixture rather than a stub: the tests talk to a real process over real
// pipes, so what they exercise is the client's reading of the protocol and not a
// mock's agreement with it. Its output is fixed, which is what makes an exact
// expected value possible — `parseInfo`'s tests take the engine's own lines.
//
// The three searches it can be asked for are deliberately different shapes:
//   `go …`                  answers immediately with two `info` lines.
//   `go … searchmoves stopme`  waits for `stop`, which is what a real engine does
//                           for `go infinite`; the client refuses `go` with no
//                           limit, so a bounded search carries the token.
//   `go … searchmoves silent`  never answers, so the client's own deadline fires.
//   `go … searchmoves quit`  exits mid-search, so the client sees it die.

import { createInterface } from "node:readline";

const BANNER = [
  "Fake Engine 1.0",
  "Nexus tests",
];

let searching = false;
let stopme = false;

function send(line: string): void {
  process.stdout.write(`${line}\n`);
}

const input = createInterface({ input: process.stdin });
input.on("line", (line: string) => {
  const tokens = line.trim().split(/\s+/);
  switch (tokens[0]) {
    case "uci":
      send(`id name ${BANNER[0]}`);
      send(`id author ${BANNER[1]}`);
      send("option name Hash type spin default 16 min 1 max 1024");
      send("option name Threads type spin default 1 min 1 max 8");
      send("option name Move Overhead type spin default 10 min 0 max 5000");
      send("option name UCI_Chess960 type check default false");
      send("option name Style type combo default Normal var Normal var Aggressive");
      send("uciok");
      break;
    case "isready":
      send("readyok");
      break;
    case "ucinewgame":
      break;
    case "position":
      break;
    case "setoption":
      // A real engine stores it; this one only has to prove the client waited for
      // `readyok`, which the next `isready` answers.
      break;
    case "go": {
      if (tokens.includes("quit")) {
        process.exit(0);
      }
      if (tokens.includes("silent")) {
        searching = true;
        break;
      }
      if (tokens.includes("stopme")) {
        stopme = true;
        searching = true;
        send("info depth 1 seldepth 1 multipv 1 score cp 21 nodes 20 nps 20000 time 1 pv e2e4");
        break;
      }
      send("info depth 1 seldepth 1 multipv 1 score cp 21 nodes 20 nps 20000 time 1 pv e2e4 e7e5");
      send(
        "info depth 2 seldepth 4 multipv 1 score cp 12 nodes 200 nps 40000 time 5 hashfull 3 pv d2d4 d7d5",
      );
      send("bestmove e2e4 ponder d7d5");
      break;
    }
    case "stop":
      if (searching && stopme) {
        searching = false;
        stopme = false;
        send("bestmove e2e4 ponder d7d5");
      }
      break;
    case "quit":
      process.exit(0);
      break;
    default:
      break;
  }
});
