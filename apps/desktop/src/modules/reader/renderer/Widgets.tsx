import { useCallback, useEffect, useState } from "react";
import { EmptyState, Icon, ListRow } from "@nexus/ui";
import {
  declaredText,
  type DashboardWidgetBodyProps,
  type DashboardWidgetRenderer,
} from "../../../renderer/src/moduleKit/moduleSurface.js";
import type { ReaderBookView } from "../shared/ipc.js";
import { copy } from "./copy.js";

/**
 * READER's dashboard card: the books that were left half-read (ADR-090 §widgets).
 *
 * **Why this is a file of its own.** The kit discovers a module's widget bodies
 * from `renderer/Widgets.tsx`, and this is that file: the module brings its own
 * card exactly as it brings its own page, and the dashboard draws it with no edit
 * to `DashboardWidgets.tsx`. What the kit needs synchronously is `visible`, which
 * is why this module is loaded with the dashboard rather than with a page.
 *
 * **Why the card is a list of BOOKS rather than of pages.** The shelf is what the
 * module is about, and "which book was I in" is the fact a person leaves the page
 * to keep; the page they stopped on is one click deeper, and a card that named it
 * would need the book's index loaded to know its title.
 *
 * The card follows its own module's flag: what it draws is a book from this
 * module, so a profile with the Reader switched off has nothing here to see.
 */

function ContinueReadingWidget({ profileId }: DashboardWidgetBodyProps) {
  const [books, setBooks] = useState<readonly ReaderBookView[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const view = await window.nexus.modules.reader.library({ profileId });
      setBooks(view.books);
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: the reader card could not be loaded:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <p className="nx-hint">{copy.widget.loadError}</p>;
  if (books === null) return <p className="nx-hint">{copy.widget.loading}</p>;

  const open = books.filter((book) => book.lastArticle !== null);
  if (open.length === 0) {
    // No action slot: the card's own frame is what opens the module (DASH-005's
    // deep link), so a second control here would be the same navigation twice.
    return <EmptyState variant="inline" title={copy.widget.empty} />;
  }

  return (
    <div className="reader__widget">
      {open.map((book) => (
        <ListRow key={book.id} leading={<Icon name="book" />}>
          <span className="reader__book-title">{declaredText(book.title)}</span>
        </ListRow>
      ))}
    </div>
  );
}

/**
 * The widgets this module publishes, by their OWN ids - the shape
 * `moduleKit/widgets.ts` reads from every `modules/<id>/renderer/Widgets.tsx`.
 *
 * `nastavi` is the id its manifest declares, and the two are compared by
 * `modules.test.ts` through `ModuleRegistry.findWidget`, so a typo here is a card
 * the gallery offers and the page cannot draw - a failing test rather than a
 * blank card.
 */
export const widgets: Readonly<Record<string, DashboardWidgetRenderer>> = {
  nastavi: {
    Body: ContinueReadingWidget,
    visible: (enabled) => enabled.has("reader"),
  },
};
