/**
 * The UCI client: the whole of how Nexus talks to a chess engine (ADR-094).
 *
 * UCI is a LINE protocol over stdin and stdout, invented for exactly this shape
 * — a GUI and an engine in two processes, neither linking the other — and that
 * is why ADR-094 can put a GPL engine in a pack beside an Apache-2.0 app at all
 * (`research/chess/report.md` §2.8). This module is the client half, and it is
 * deliberately thin: it sends the six things a caller needs, reads the four
 * kinds of line that come back, and reports what it read.
 *
 * **Sequential by construction.** One request is in flight at a time; a search
 * is the only operation that both sends and waits, while `stop()` may arrive
 * from outside it. A client that allowed two overlapping requests would need a
 * correlation id the protocol does not carry, and guessing which answer belongs
 * to which question is the bug this shape prevents by making it impossible.
 *
 * **What it does not do.** It does not decide chess: no legality, no evaluation,
 * no book. It also does not launder the engine's numbers — `parseInfo` reports
 * `score`, `nodes` and `nps` as the engine stated them, and a surface that shows
 * a mate score shows the engine's claim, which is why the page that eventually
 * draws one must say whose number it is.
 */

import type { ToolExit, ToolProcess, ToolSession } from "./run.js";

/** What went wrong, as a code a caller can branch on. */
export type UciRefusal =
  /** The engine stopped talking, or died, with a request outstanding. */
  | "engine-exited"
  /** A request was not answered inside this client's deadline. */
  | "timeout"
  /** The engine's output is not the protocol: a malformed handshake, or a search with no limit. */
  | "protocol"
  /** A second request arrived while one was in flight. */
  | "busy";

export class UciError extends Error {
  readonly code: UciRefusal;
  readonly exit: ToolExit | null;

  constructor(code: UciRefusal, message: string, exit: ToolExit | null = null) {
    super(message);
    this.name = "UciError";
    this.code = code;
    this.exit = exit;
  }
}

/** One `option` line's record. `type` stays the engine's own word rather than a closed union. */
export interface UciOption {
  readonly name: string;
  readonly type: string;
  readonly default: string | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly vars: readonly string[];
}

/** A score as the engine stated it: centipawns, or a distance to mate. */
export interface UciScore {
  readonly kind: "cp" | "mate";
  readonly value: number;
  /** True when the score is a bound rather than an exact evaluation. */
  readonly lowerBound: boolean;
  readonly upperBound: boolean;
}

/**
 * One `info` line, as the fields a caller decides with.
 *
 * A missing field is `null` rather than zero: `depth 0` and "no depth reported"
 * are different claims, and a UI that showed the second as the first would be
 * inventing a number.
 */
export interface UciInfo {
  readonly depth: number | null;
  readonly seldepth: number | null;
  readonly multipv: number | null;
  readonly score: UciScore | null;
  readonly nodes: number | null;
  readonly nps: number | null;
  readonly timeMs: number | null;
  readonly hashfull: number | null;
  readonly currmove: string | null;
  readonly pv: readonly string[];
  /** The line as the engine wrote it, trimmed. */
  readonly raw: string;
}

/** What an engine advertised about itself during the handshake. */
export interface UciIdentity {
  readonly name: string | null;
  readonly author: string | null;
}

export interface UciSearchLimits {
  readonly depth?: number;
  readonly nodes?: number;
  readonly mateIn?: number;
  readonly moveTimeMs?: number;
  readonly searchMoves?: readonly string[];
}

export interface UciSearchResult {
  readonly bestmove: string;
  readonly ponder: string | null;
  readonly info: readonly UciInfo[];
  /** True when this search ended because `stop()` was sent rather than because a limit was met. */
  readonly stopped: boolean;
}

export interface UciPosition {
  /** A FEN, or the word `startpos`. */
  readonly fen: string;
  readonly moves?: readonly string[];
}

/** One `bestmove` line: `bestmove <move> [ponder <move>]`. */
export interface UciBestmove {
  readonly move: string;
  readonly ponder: string | null;
}

function integerAt(tokens: readonly string[], index: number): number | null {
  const token = tokens[index];
  if (token === undefined) return null;
  const value = Number(token);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * One `info` line, parsed.
 *
 * Pure on purpose: every field a caller branches on is decided here, where a
 * test can hand it the engine's own line, rather than inside the socket handler
 * where nobody can. Unrecognised tokens are skipped rather than refused —
 * engines extend `info` freely (`wdl`, `ebf`, `tbhits`), and a client that
 * refused an extension would fail on a strictly better engine.
 */
export function parseInfo(line: string): UciInfo {
  const tokens = line.trim().split(/\s+/);
  let depth: number | null = null;
  let seldepth: number | null = null;
  let multipv: number | null = null;
  let score: UciScore | null = null;
  let nodes: number | null = null;
  let nps: number | null = null;
  let timeMs: number | null = null;
  let hashfull: number | null = null;
  let currmove: string | null = null;
  let pv: readonly string[] = [];

  for (let index = 1; index < tokens.length; index += 1) {
    switch (tokens[index]) {
      case "depth":
        depth = integerAt(tokens, index + 1);
        break;
      case "seldepth":
        seldepth = integerAt(tokens, index + 1);
        break;
      case "multipv":
        multipv = integerAt(tokens, index + 1);
        break;
      case "nodes":
        nodes = integerAt(tokens, index + 1);
        break;
      case "nps":
        nps = integerAt(tokens, index + 1);
        break;
      case "time":
        timeMs = integerAt(tokens, index + 1);
        break;
      case "hashfull":
        hashfull = integerAt(tokens, index + 1);
        break;
      case "currmove":
        currmove = tokens[index + 1] ?? null;
        break;
      case "score": {
        const kind = tokens[index + 1];
        const value = integerAt(tokens, index + 2);
        if ((kind === "cp" || kind === "mate") && value !== null) {
          // `lowerbound`/`upperbound` describe a score that is not exact — a
          // cutoff rather than an evaluation — and a caller that showed one as
          // exact would be showing a bound as a fact.
          const bound = tokens.slice(index + 3, index + 5);
          score = {
            kind,
            value,
            lowerBound: bound.includes("lowerbound"),
            upperBound: bound.includes("upperbound"),
          };
        }
        break;
      }
      case "pv":
        pv = tokens.slice(index + 1);
        index = tokens.length;
        break;
      default:
        break;
    }
  }
  return { depth, seldepth, multipv, score, nodes, nps, timeMs, hashfull, currmove, pv, raw: line.trim() };
}

/** The value of `keyword` in an option line's tail, up to the next recognised keyword. */
function keywordValue(tail: string, keyword: string): string | null {
  const match = new RegExp(`\\b${keyword}\\s+(.+?)(?=\\s+(?:default|min|max|var)\\s|$)`).exec(tail);
  return match?.[1]?.trim() ?? null;
}

function numberKeyword(tail: string, keyword: string): number | null {
  const value = keywordValue(tail, keyword);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * One `option` line, parsed: `option name <n> type <t> [default <d>] [min <n>]
 * [max <n>] [var <v>]…`.
 *
 * The name is everything between `name` and `type`, because an option name may
 * contain spaces ("Move Overhead") and `type` is the first keyword that cannot
 * be part of one.
 */
export function parseOption(line: string): UciOption | null {
  const match = /^option\s+name\s+(.+?)\s+type\s+(\S+)(.*)$/.exec(line.trim());
  if (match === null) return null;
  const name = match[1];
  const type = match[2];
  const rest = match[3];
  if (name === undefined || type === undefined || rest === undefined) return null;
  return {
    name,
    type,
    default: keywordValue(rest, "default"),
    min: numberKeyword(rest, "min"),
    max: numberKeyword(rest, "max"),
    vars: [...rest.matchAll(/\bvar\s+(\S+)/g)].map((entry) => entry[1] ?? ""),
  };
}

/** One `bestmove` line: `bestmove <move> [ponder <move>]`, or `bestmove (none)`. */
export function parseBestmove(line: string): UciBestmove | null {
  const match = /^bestmove\s+(\S+)(?:\s+ponder\s+(\S+))?/.exec(line.trim());
  const move = match?.[1];
  if (move === undefined) return null;
  return { move, ponder: match?.[2] ?? null };
}

/**
 * What `go` sends for a set of limits, so the wording lives in one place and a
 * test can pin it.
 *
 * A search with no limit at all is refused: tokens left out mean `go infinite`,
 * which runs until the app closes, and an unbounded search is a caller's mistake
 * rather than a hung window waiting to happen.
 */
export function goCommand(limits: UciSearchLimits): string {
  const tokens: string[] = ["go"];
  if (limits.searchMoves !== undefined && limits.searchMoves.length > 0) {
    tokens.push("searchmoves", ...limits.searchMoves);
  }
  if (limits.depth !== undefined) tokens.push("depth", String(limits.depth));
  if (limits.nodes !== undefined) tokens.push("nodes", String(limits.nodes));
  if (limits.mateIn !== undefined) tokens.push("mate", String(limits.mateIn));
  if (limits.moveTimeMs !== undefined) tokens.push("movetime", String(limits.moveTimeMs));
  if (tokens.length === 1) {
    throw new UciError("protocol", "A UCI search needs at least one limit (depth, nodes, mate or movetime).");
  }
  return `${tokens.join(" ")}\n`;
}

/**
 * What `position` sends: `position startpos moves …` or `position fen … moves …`.
 *
 * **Refused on a line break, because this is where a value becomes a command.**
 * The FEN and the moves come from the app — a position off a board, a move list a
 * page read back from the store — but UCI is a LINE protocol, so a value
 * containing `\n` would arrive as two commands, the second one chosen by whoever
 * wrote the first. `setOption` refuses the same thing for the same reason, and
 * here it matters more: `position` is the command a searching engine is *sent*,
 * where a `setoption` is one it is configured with.
 */
export function positionCommand(position: UciPosition): string {
  if (/[\r\n]/.test(position.fen) || (position.moves ?? []).some((move) => /[\r\n]/.test(move))) {
    throw new UciError("protocol", "A UCI position may not contain a line break.");
  }
  const head = position.fen === "startpos" ? "position startpos" : `position fen ${position.fen}`;
  const moves = position.moves ?? [];
  return moves.length === 0 ? `${head}\n` : `${head} moves ${moves.join(" ")}\n`;
}

interface PendingSearch {
  readonly info: UciInfo[];
  stopped: boolean;
  readonly resolve: (result: UciSearchResult) => void;
  readonly reject: (error: UciError) => void;
}

interface Waiter {
  readonly deliver: (line: string) => void;
  readonly refuse: (error: UciError) => void;
}

/**
 * A started engine, handshaken, with its options read.
 *
 * `start` is the handshake UCI defines: send `uci`, collect `id` and `option`
 * lines until `uciok`, then `isready`/`readyok`. An engine that answers something
 * else, or nothing, is a refusal rather than a retry: the pack's protocol is what
 * its manifest claims it is, and an engine that does not speak UCI means the pack
 * is wrong rather than that the client should be patient.
 *
 * There is no process-level time limit on a UCI engine: it is meant to live for
 * as long as the board is on screen, so `start` asks `run.ts` for an unbounded
 * process and every REQUEST carries its own deadline. The ends are `quit()`, a
 * kill, and the app's own quit handler.
 */
export class UciEngine {
  private readonly proc: ToolProcess;
  private readonly timeoutMs: number;
  private readonly lines: string[] = [];
  private waiter: Waiter | null = null;
  private buffer = "";
  private search: PendingSearch | null = null;
  private exit: ToolExit | null = null;
  private identity: UciIdentity = { name: null, author: null };
  private advertised: UciOption[] = [];

  private constructor(proc: ToolProcess, timeoutMs: number) {
    this.proc = proc;
    this.timeoutMs = timeoutMs;
    proc.onStdout((chunk) => {
      this.feed(chunk.toString("utf8"));
    });
    void proc.exited.then((exit) => {
      this.die(exit);
    });
  }

  /** Starts the entry the session names and completes the UCI handshake. */
  static async start(input: {
    readonly session: ToolSession;
    /** How long any one request may take. Defaults to ten seconds. */
    readonly timeoutMs?: number;
    /** Kills the engine when it aborts. */
    readonly signal?: AbortSignal;
    /** Appended after the manifest's fixed arguments. */
    readonly args?: readonly string[];
  }): Promise<UciEngine> {
    if (input.session.tool.protocol !== "uci") {
      throw new UciError(
        "protocol",
        `Pack entry "${input.session.tool.entry}" is not a UCI tool (protocol "${input.session.tool.protocol}").`,
      );
    }
    const proc = await input.session.start({
      // `null` is "no process deadline": an engine outlives a search.
      timeoutMs: null,
      ...(input.args === undefined ? {} : { args: input.args }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const engine = new UciEngine(proc, input.timeoutMs ?? 10_000);
    try {
      await engine.handshake();
    } catch (error) {
      // A handshake that fails leaves a process that will never be useful, and
      // whoever started it is holding a window rather than a throwaway.
      engine.kill();
      throw error;
    }
    return engine;
  }

  /** The name and author the engine gave for itself, or `null` where it gave none. */
  get id(): UciIdentity {
    return this.identity;
  }

  /** Every option the engine advertised, in the order it sent them. */
  get options(): readonly UciOption[] {
    return this.advertised;
  }

  /** `isready` and wait for `readyok`: the protocol's "everything you sent has been applied". */
  async isReady(): Promise<void> {
    this.write("isready\n");
    for (;;) {
      const line = await this.nextLine();
      if (line === "readyok") return;
    }
  }

  /** `setoption`, then `isready`, because UCI only promises an option was applied by `readyok`. */
  async setOption(name: string, value: string | null = null): Promise<void> {
    if (/[\r\n]/.test(name) || (value !== null && /[\r\n]/.test(value))) {
      // A newline here would be a second command, which is the one thing a line
      // protocol must never let a value do. Option values come from the app and
      // not from a file, but the rule is cheap and the class of bug is not.
      throw new UciError("protocol", "A UCI option name or value may not contain a line break.");
    }
    this.write(value === null ? `setoption name ${name}\n` : `setoption name ${name} value ${value}\n`);
    await this.isReady();
  }

  /** `ucinewgame` plus `isready`: the engine's cue that the next position is unrelated to the last. */
  async newGame(): Promise<void> {
    this.write("ucinewgame\n");
    await this.isReady();
  }

  /** Sets the position the next search starts from. */
  position(position: UciPosition): void {
    this.write(positionCommand(position));
  }

  /**
   * Starts a search and answers with its `bestmove` and every `info` line it sent.
   *
   * The search is bounded by the caller's limits (`goCommand` refuses an
   * unbounded one) and by a second deadline measured on this side: an engine that
   * accepts `go nodes 100000` and then never answers is stopped by the client
   * rather than waited for.
   */
  async go(limits: UciSearchLimits): Promise<UciSearchResult> {
    if (this.search !== null) {
      throw new UciError("busy", "A search is already running; stop it first.");
    }
    const command = goCommand(limits);
    let timer: NodeJS.Timeout | null = null;
    const result = new Promise<UciSearchResult>((resolve, reject) => {
      timer = setTimeout(() => {
        // A search that outlives this client's own deadline is stopped AND
        // refused: `stop` gives a merely slow engine the chance to end cleanly,
        // and the refusal is what the caller sees, because an engine that
        // ignored the limit it was given must not hold a board waiting.
        this.search = null;
        try {
          this.write("stop\n");
        } catch {
          // The engine is already gone; its exit is the answer to why.
        }
        reject(new UciError("timeout", `The engine was still searching after ${String(this.timeoutMs)} ms.`));
      }, this.timeoutMs);
      this.search = {
        info: [],
        stopped: false,
        resolve: (settled) => {
          if (timer !== null) clearTimeout(timer);
          resolve(settled);
        },
        reject: (error) => {
          if (timer !== null) clearTimeout(timer);
          reject(error);
        },
      };
    });
    this.write(command);
    return result;
  }

  /** Asks the running search to stop. The pending `go` resolves when `bestmove` arrives. */
  stop(): void {
    if (this.search === null) return;
    this.search.stopped = true;
    this.write("stop\n");
  }

  /**
   * Ends the session politely: `quit`, then the process's exit.
   *
   * An engine that will not exit is killed, because a pack that ignores `quit`
   * is not a reason to keep a window open; the exit is awaited afterwards either
   * way, so a caller can be sure nothing is left running.
   */
  async quit(): Promise<ToolExit> {
    this.write("quit\n");
    this.proc.endStdin();
    const exit = await this.proc.exited;
    return exit;
  }

  /** Kills the engine now: the same end as `quit`, without the request. */
  kill(): void {
    this.proc.kill();
  }

  private async handshake(): Promise<void> {
    this.write("uci\n");
    for (;;) {
      const line = await this.nextLine();
      if (line.startsWith("id name ")) {
        this.identity = { ...this.identity, name: line.slice("id name ".length).trim() };
      } else if (line.startsWith("id author ")) {
        this.identity = { ...this.identity, author: line.slice("id author ".length).trim() };
      } else if (line.startsWith("option ")) {
        const option = parseOption(line);
        if (option !== null) this.advertised.push(option);
      } else if (line === "uciok") {
        break;
      }
      // Anything else is ignored rather than refused: engines write banners and
      // copyright lines on stdout during start-up, and a client that died on
      // one would fail on a perfectly good engine.
    }
    await this.isReady();
  }

  private write(text: string): void {
    if (this.exit !== null) {
      throw new UciError("engine-exited", "The engine is no longer running.", this.exit);
    }
    this.proc.write(text);
  }

  /**
   * One chunk of the engine's stdout, split into lines and dispatched.
   *
   * A search's `info` lines are consumed here, before any waiter sees them: they
   * arrive between the `go` and the `bestmove`, and a caller awaiting "the next
   * line" must get `bestmove` rather than a hundred evaluations.
   */
  private feed(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const index = this.buffer.indexOf("\n");
      if (index < 0) return;
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      this.dispatch(line);
    }
  }

  private dispatch(line: string): void {
    if (this.search !== null) {
      if (line.startsWith("info")) {
        this.search.info.push(parseInfo(line));
        return;
      }
      const best = parseBestmove(line);
      if (best !== null) {
        const { info, stopped, resolve } = this.search;
        this.search = null;
        resolve({ bestmove: best.move, ponder: best.ponder, info, stopped });
        return;
      }
    }
    if (this.waiter !== null) {
      const { deliver } = this.waiter;
      this.waiter = null;
      deliver(line);
      return;
    }
    this.lines.push(line);
  }

  /** The next line, or a timeout. One waiter at a time, which is what "sequential" means here. */
  private nextLine(): Promise<string> {
    if (this.exit !== null) {
      return Promise.reject(new UciError("engine-exited", "The engine exited before answering.", this.exit));
    }
    const buffered = this.lines.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);
    if (this.waiter !== null) {
      return Promise.reject(new UciError("busy", "A UCI request is already waiting for an answer."));
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new UciError("timeout", `The engine did not answer within ${String(this.timeoutMs)} ms.`));
      }, this.timeoutMs);
      this.waiter = {
        deliver: (line) => {
          clearTimeout(timer);
          resolve(line);
        },
        refuse: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
  }

  /** The engine died. Anything outstanding is refused with the exit it died with. */
  private die(exit: ToolExit): void {
    this.exit = exit;
    const reason =
      exit.spawnError !== null
        ? exit.spawnError
        : `it exited (code ${String(exit.code)}, signal ${String(exit.signal)}${
            exit.stopped === null ? "" : `, stopped: ${exit.stopped}`
          })`;
    const error = new UciError("engine-exited", `The engine is gone: ${reason}.`, exit);
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.refuse(error);
    const search = this.search;
    this.search = null;
    search?.reject(error);
  }
}
