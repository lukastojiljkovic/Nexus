import { useCallback, useEffect, useState } from "react";
import { Icon } from "@nexus/ui";
import type { ThemeName } from "@nexus/tokens";
import type { WindowState } from "../../shared/ipc.js";
import { strings } from "./strings.js";

/**
 * The window's own title strip, drawn by the app (`frame: false`).
 *
 * An operating-system frame is not a neutral container — it is a strip of
 * another product's design language across the top of this one, in the first
 * place a person looks. Drawing it costs three IPC channels and buys back the
 * 40 px that state what this program is.
 *
 * What it carries is deliberately what a title bar is FOR and nothing else:
 * the mark, the product name, and the name of the surface you are standing on.
 * The temptation with a custom strip is to fill it — a search field, a create
 * button, tabs — and every one of those is a control that already has a home
 * somewhere the reader is already looking. A title bar that is also a toolbar
 * is how a custom frame starts looking cheap.
 */
export interface TitleBarProps {
  /** The name of the surface on screen, shown after the product name. Absent while locked. */
  surface: string | null;
  theme: ThemeName;
  onToggleTheme: () => void;
}

/**
 * The live window state behind the two controls that depend on it.
 *
 * Read once on mount, then pushed: `maximize`/`unmaximize`/`focus` are events
 * only the main process sees, and polling for them would either lag the user's
 * own click or burn a timer forever. The pushed payload is re-validated here
 * rather than trusted — the same rule every store applies to what main sends,
 * and it costs two `typeof` checks.
 */
function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>({ maximized: false, focused: true });

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
      if (typeof next?.maximized !== "boolean" || typeof next?.focused !== "boolean") return;
      setState({ maximized: next.maximized, focused: next.focused });
    });
    return () => {
      live = false;
      stop();
    };
  }, []);

  return state;
}

export function TitleBar({ surface, theme, onToggleTheme }: TitleBarProps) {
  const { maximized, focused } = useWindowState();

  const minimize = useCallback(() => void window.nexus.windowMinimize(), []);
  const close = useCallback(() => void window.nexus.windowClose(), []);
  // The returned state is discarded on purpose: main pushes the change through
  // `onWindowStateChanged` regardless, and taking it from both would let the
  // strip disagree with itself for one frame if the two ever raced.
  const toggleMaximize = useCallback(() => void window.nexus.windowToggleMaximize(), []);

  return (
    <header
      className={`app__titlebar${focused ? "" : " app__titlebar--blurred"}`}
      // The drag region. Everything interactive inside opts back out with
      // `--no-drag`; a control that forgot to would be un-clickable, since a
      // drag region swallows the press before the DOM sees it.
      onDoubleClick={toggleMaximize}
    >
      <div className="app__titlebar-identity">
        <span className="app__brand-mark" aria-hidden="true">
          ✦
        </span>
        <span className="app__brand-name">{strings.app.brand}</span>
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
