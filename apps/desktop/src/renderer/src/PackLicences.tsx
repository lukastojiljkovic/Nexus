import { useEffect, useState } from "react";

import type { InstalledPackView } from "../../shared/ipc.js";
import { openExternalLink } from "./links.js";
import { formatPackSize, packText, sortPacksByTitle } from "./packsView.js";
import { activeLocale, strings } from "./strings.js";

/**
 * ADR-103's „Licence paketa" block on the About card.
 *
 * A content pack carries somebody else's work under somebody else's terms, and
 * the licence, the attribution and the source are what its author requires to
 * travel with it. The Packs card shows them for each pack it lists; this block
 * is the one place they are all together, which is where a person looks when
 * the question is „what am I distributing" rather than „what am I downloading".
 *
 * It reads the installed list rather than keeping its own copy, exactly as the
 * Packs card does, and it draws the pack's licence even when the pack is a
 * safety pack — the disclaimer and the licence are different obligations and
 * neither replaces the other.
 *
 * The addresses open through `openExternalLink`, never in this window: the
 * rule that decides which addresses may be opened at all is main's.
 */
export function PackLicences() {
  const s = strings.settings.about;
  const locale = activeLocale();
  const [packs, setPacks] = useState<InstalledPackView[] | null>(null);

  useEffect(() => {
    let live = true;
    void window.nexus
      .packsList()
      .then((list) => {
        if (live) setPacks(list);
      })
      .catch(() => {
        // A read that failed leaves the block on its loading line rather than
        // claiming there is nothing installed, which would be a lie about the
        // user's own disk.
      });
    const off = window.nexus.onPacksChanged((list) => {
      setPacks(list);
    });
    return () => {
      live = false;
      off();
    };
  }, []);

  return (
    <div className="packs__licences">
      <p className="nx-hint">{s.packLicences}</p>
      <p className="nx-hint nx-hint--prose">{s.packLicencesHint}</p>
      {packs === null ? (
        <p className="nx-hint">{strings.app.loading}</p>
      ) : packs.length === 0 ? (
        <p className="nx-hint">{s.packLicencesEmpty}</p>
      ) : (
        <ul className="packs__list">
          {sortPacksByTitle(packs, locale).map((pack) => (
            <li className="packs__row" key={pack.id}>
              <div className="packs__row-head">
                <span className="packs__row-title">{packText(pack.title, locale)}</span>
                <span className="packs__row-meta">
                  {pack.version} · {pack.kind} · {formatPackSize(pack.size)}
                </span>
              </div>
              <p className="nx-hint">
                {strings.settings.contentPacks.licenceLabel}: {pack.licence.spdx} ·{" "}
                {strings.settings.contentPacks.attributionLabel}: {pack.licence.attribution}
              </p>
              <p className="nx-hint">
                {strings.settings.contentPacks.sourceLabel}: {pack.source.name} ·{" "}
                <button
                  type="button"
                  className="packs__link"
                  onClick={() => openExternalLink(pack.source.url)}
                >
                  {pack.source.url}
                </button>
              </p>
              <p className="nx-hint">
                <button
                  type="button"
                  className="packs__link"
                  onClick={() => openExternalLink(pack.licence.url)}
                >
                  {pack.licence.url}
                </button>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
