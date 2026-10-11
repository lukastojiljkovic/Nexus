import type { ArcadeResultPayload } from "../../shared/ipc.js";

/**
 * What every game on the page is handed (ADR-090): the page's own keys
 * handshake, and nothing else.
 *
 * A game is handed ONE function and holds everything else itself. It does not
 * receive the view - the shelf and the stats table above it are the page's
 * business - and it does not receive a profile id, because a game never talks to
 * main: it reports a finished result to the page, and the page is what writes.
 * That boundary is what keeps a game a value a person can replay from a seed,
 * exactly as the engines are.
 */
export interface BoardGameProps {
  readonly onFinish: (result: ArcadeResultPayload) => void;
}

/**
 * Whether the focused element is a control a key press belongs to.
 *
 * A game that stole Space from a focused button would break the button, and one
 * that stole a digit from the Minesweeper custom-board fields would be the worst
 * kind of help - so every game ignores a key while a control has focus, and every
 * game moves focus to its own board when it starts or resumes. Two games reading
 * this one rule is also why it is here rather than in one of them.
 */
export function aControlHasFocus(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (active.isContentEditable) return true;
  return (
    active.closest("input, textarea, select, button, a, [role='textbox'], [role='button']") !== null
  );
}
