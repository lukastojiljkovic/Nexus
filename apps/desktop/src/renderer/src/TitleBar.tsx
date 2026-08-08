import { useCallback, useEffect, useState, type ReactNode } from "react";
import { formatChord } from "@nexus/core";
import { Icon, type IconName } from "@nexus/ui";
import type { ThemeName } from "@nexus/tokens";
import type { WindowState, WindowViewCommand } from "../../shared/ipc.js";
import { NotePopover } from "./notePopover.js";
import { strings } from "./strings.js";

/**
 * The window's own title strip, drawn by the app (`frame: false`).
 *
 * An operating-system frame is not a neutral container — it is a strip of
 * another product's design language across the top of this one, in the first
 * place a person looks. Drawing it costs three IPC channels and buys back the
 * 40 px that state what this program is.
 *
 * **The mark is the app menu**, and that is where everything the OS menu bar
 * used to hold now lives (founder, 2026-08-08). `frame: false` removed the menu
 * BAR; it did not remove the MENU — its accelerators stayed live until main
 * called `Menu.setApplicationMenu(null)`, which this file previously claimed
 * had happened. „Prikaz"/„Prozor" are not offers any
 * other surface in this app makes: page zoom and full screen belong to the
 * window, and the window is what this strip is. The shell's own commands —
 * search, settings, lock — ride in the same panel as `commands`, because a
 * person looking for „where are the options" opens one menu, not two.
 *
 * What the strip still refuses to become is a toolbar. Nothing lands here that
 * already has a home on a page: the menu is a LIST of commands behind one
 * click, not a row of buttons competing with the sidebar under it.
 */

/** One shell-owned row in the app menu — the commands `TitleBar` cannot reach itself. */
export interface TitleBarCommand {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  /** The live binding, already formatted by the caller. Never a printed constant — a remap has to be visible here too (ADR-040). */
  readonly chord?: string;
  readonly onSelect: () => void;
}

export interface TitleBarProps {
  /** The name of the surface on screen, shown after the product name. Absent while locked. */
  surface: string | null;
  theme: ThemeName;
  onToggleTheme: () => void;
  /** The shell's own menu rows. Empty while locked — there is no profile to act on. */
  commands?: readonly TitleBarCommand[];
}

/**
 * The live window state behind the controls that depend on it.
 *
 * Read once on mount, then pushed: `maximize`/`unmaximize`/`focus` are events
 * only the main process sees, and polling for them would either lag the user's
 * own click or burn a timer forever. The pushed payload is re-validated here
 * rather than trusted — the same rule every store applies to what main sends,
 * and it costs four `typeof` checks.
 */
function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>({
    maximized: false,
    focused: true,
    fullScreen: false,
    zoomLevel: 0,
  });

  useEffect(() => {
    let live = true;
    window.nexus
      .windowState()
      .then((current) => {
        if (live) setState(current);
      })
      .catch(() => {
        // A window that cannot describe itself still draws; the strip simply
        // shows the un-maximised glyph, which is what a fresh window is.
      });
    const stop = window.nexus.onWindowStateChanged((next: WindowState) => {
      if (typeof next?.maximized !== "boolean" || typeof next.focused !== "boolean") return;
      if (typeof next.fullScreen !== "boolean" || typeof next.zoomLevel !== "number") return;
      setState({
        maximized: next.maximized,
        focused: next.focused,
        fullScreen: next.fullScreen,
        zoomLevel: next.zoomLevel,
      });
    });
    return () => {
      live = false;
      stop();
    };
  }, []);

  return state;
}

/**
 * Chromium's zoom LEVEL as the percentage a person recognises: the scale is
 * `1.2 ** level`, so level 0.5 is 110 % and level −1 is 83 %.
 *
 * Rounded to whole percent for display only. The level itself is never derived
 * back from this number — main owns it — so the rounding cannot accumulate.
 */
function zoomPercent(level: number): string {
  return `${String(Math.round(1.2 ** level * 100))}%`;
}

/**
 * The chords the strip's own key handler below actually binds — printed only
 * because they are live, which is the rule every other chord in this app
 * follows (ADR-040).
 *
 * Spelt through `formatChord` rather than typed out, so the menu reads exactly
 * as „Prečice" and the palette do. That is why zooming in prints „Ctrl++": the
 * key IS „+", and the canonical serialization joins with „+".
 */
const chord = (key: string, modifier?: "ctrl" | "alt"): string =>
  formatChord({ ctrl: modifier === "ctrl", alt: modifier === "alt", shift: false, key });

const VIEW_CHORDS: Readonly<Record<WindowViewCommand, string>> = {
  "zoom-in": chord("+", "ctrl"),
  "zoom-out": chord("-", "ctrl"),
  "zoom-reset": chord("0", "ctrl"),
  "fullscreen-toggle": chord("F11"),
};

/** Windows' own window-closing chord. The strip does not bind it — the OS does — and it is printed because the OS honours it. */
const CLOSE_CHORD = chord("F4", "alt");

export function TitleBar({ surface, theme, onToggleTheme, commands = [] }: TitleBarProps) {
  const { maximized, focused, fullScreen, zoomLevel } = useWindowState();
  const [version, setVersion] = useState<string | null>(null);

  const minimize = useCallback(() => void window.nexus.windowMinimize(), []);
  const close = useCallback(() => void window.nexus.windowClose(), []);
  // The returned state is discarded on purpose: main pushes the change through
  // `onWindowStateChanged` regardless, and taking it from both would let the
  // strip disagree with itself for one frame if the two ever raced.
  const toggleMaximize = useCallback(() => void window.nexus.windowToggleMaximize(), []);
  const view = useCallback(
    (command: WindowViewCommand) => void window.nexus.windowView(command),
    [],
  );

  // The foot of the menu names the build. Asked once, and a failure leaves the
  // line out rather than printing „nepoznato" — a version nobody can state is
  // better absent than guessed at.
  useEffect(() => {
    let live = true;
    window.nexus
      .appInfo()
      .then((info) => {
        if (live) setVersion(info.version);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  /**
   * The accelerators the menu prints. They are bound HERE and not in main,
   * because a `globalShortcut` would take Ctrl+0 off every other application on
   * the machine — these are window keys, and the window is the renderer.
   *
   * `Ctrl` without `Alt`, so AltGr (which Windows reports as Ctrl+Alt) still
   * types the characters a Serbian layout puts on those keys. Nothing here
   * fires inside a text field either way: none of these four chords is a
   * character a field could receive.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "F11") {
        event.preventDefault();
        view("fullscreen-toggle");
        return;
      }
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      // Both rows of the keyboard: the main row sends "+"/"-" (and "=" without
      // Shift), the numeric pad sends "+"/"-" outright.
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        view("zoom-in");
      } else if (event.key === "-") {
        event.preventDefault();
        view("zoom-out");
      } else if (event.key === "0") {
        event.preventDefault();
        view("zoom-reset");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view]);

  const s = strings.app.menu;

  /** One menu row: icon, name, and the chord or reading that belongs to it. */
  const item = (
    icon: IconName,
    label: string,
    onSelect: () => void,
    trailing?: ReactNode,
  ): ReactNode => (
    <button key={label} className="app__menu-item" role="menuitem" type="button" onClick={onSelect}>
      <Icon name={icon} size={15} className="app__menu-icon" />
      <span className="app__menu-label">{label}</span>
      {trailing !== undefined && <span className="app__menu-trailing">{trailing}</span>}
    </button>
  );

  return (
    <header
      className={`app__titlebar${focused ? "" : " app__titlebar--blurred"}`}
      // The drag region. Everything interactive inside opts back out with
      // `--no-drag`; a control that forgot to would be un-clickable, since a
      // drag region swallows the press before the DOM sees it.
      onDoubleClick={toggleMaximize}
    >
      <div className="app__titlebar-identity">
        <NotePopover
          label={s.label}
          align="start"
          panelClassName="app__menu-panel"
          triggerClassName="app__menu-trigger"
          triggerContent={
            <>
              <span className="app__brand-mark" aria-hidden="true">
                ✦
              </span>
              <span className="app__brand-name">{strings.app.brand}</span>
              <Icon name="chevronDown" size={12} className="app__menu-caret" />
            </>
          }
        >
          {(dismiss) => {
            const run = (action: () => void) => () => {
              dismiss();
              action();
            };
            return (
              <>
                {commands.length > 0 && (
                  <>
                    {commands.map((command) => (
                      <button
                        key={command.id}
                        className="app__menu-item"
                        role="menuitem"
                        type="button"
                        onClick={run(command.onSelect)}
                      >
                        <Icon name={command.icon} size={15} className="app__menu-icon" />
                        <span className="app__menu-label">{command.label}</span>
                        {command.chord !== undefined && (
                          <span className="app__menu-trailing">{command.chord}</span>
                        )}
                      </button>
                    ))}
                    <div className="note__menu-sep" role="separator" />
                  </>
                )}

                <div className="nx-eyebrow app__menu-section">{s.viewSection}</div>
                {item(
                  "plus",
                  s.zoomIn,
                  run(() => view("zoom-in")),
                  VIEW_CHORDS["zoom-in"],
                )}
                {item(
                  "minus",
                  s.zoomOut,
                  run(() => view("zoom-out")),
                  VIEW_CHORDS["zoom-out"],
                )}
                {item(
                  "target",
                  s.zoomReset,
                  run(() => view("zoom-reset")),
                  // The current reading, and only when it is not the default:
                  // „100%" beside „Stvarna veličina" is the row restating its
                  // own name. Off the default it is the one number that says
                  // why the text looks the size it does.
                  zoomLevel === 0 ? VIEW_CHORDS["zoom-reset"] : zoomPercent(zoomLevel),
                )}
                {item(
                  fullScreen ? "collapse" : "expand",
                  fullScreen ? s.fullScreenLeave : s.fullScreenEnter,
                  run(() => view("fullscreen-toggle")),
                  VIEW_CHORDS["fullscreen-toggle"],
                )}

                <div className="note__menu-sep" role="separator" />
                <div className="nx-eyebrow app__menu-section">{s.windowSection}</div>
                {item("windowMinimize", strings.app.window.minimize, run(minimize))}
                {item(
                  maximized ? "windowRestore" : "windowMaximize",
                  maximized ? strings.app.window.restore : strings.app.window.maximize,
                  run(toggleMaximize),
                )}
                {item("close", strings.app.window.close, run(close), CLOSE_CHORD)}

                {version !== null && (
                  <p className="app__menu-foot">{`${strings.app.brand} ${version}`}</p>
                )}
              </>
            );
          }}
        </NotePopover>
        {surface !== null && (
          <>
            <span className="app__titlebar-sep" aria-hidden="true" />
            <span className="app__titlebar-surface">{surface}</span>
          </>
        )}
      </div>

      <div className="app__titlebar-controls">
        <button
          type="button"
          className="app__titlebar-button app__titlebar-button--theme"
          aria-label={strings.app.themeToggle}
          title={theme === "noc" ? strings.app.themeDan : strings.app.themeNoc}
          onClick={onToggleTheme}
        >
          <Icon name={theme === "noc" ? "sun" : "moon"} size={15} />
        </button>

        <span className="app__titlebar-divider" aria-hidden="true" />

        <button
          type="button"
          className="app__titlebar-button"
          aria-label={strings.app.window.minimize}
          onClick={minimize}
        >
          <Icon name="windowMinimize" size={14} />
        </button>
        <button
          type="button"
          className="app__titlebar-button"
          aria-label={maximized ? strings.app.window.restore : strings.app.window.maximize}
          onClick={toggleMaximize}
        >
          <Icon name={maximized ? "windowRestore" : "windowMaximize"} size={14} />
        </button>
        <button
          type="button"
          className="app__titlebar-button app__titlebar-button--close"
          aria-label={strings.app.window.close}
          onClick={close}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </header>
  );
}
